import Notification from '../models/Notification.js';
import {
  sendExpiryReminderEmail,
  sendSecurityCorrectionEmail
} from './emailService.js';
import { securityReminderInterval } from '../utils/controlledEditHelpers.js';

const MAX_EMAIL_ATTEMPTS = 5;
const EMAIL_RETRY_BASE_MS = 5 * 60 * 1000;
const EMAIL_RETRY_MAX_MS = 6 * 60 * 60 * 1000;

/**
 * Exponential backoff for transient email failures. Attempt 1 waits 5 minutes,
 * attempt 2 waits 10 minutes, and so on, capped at 6 hours.
 *
 * @param {number} attempt - 1-based attempt number
 * @param {Date} [now]
 * @returns {Date|null}
 */
export const computeNextEmailRetryAt = (attempt, now = new Date()) => {
  const numericAttempt = Number(attempt);
  if (!Number.isFinite(numericAttempt) || numericAttempt < 1) return null;
  const delay = Math.min(
    EMAIL_RETRY_BASE_MS * 2 ** (numericAttempt - 1),
    EMAIL_RETRY_MAX_MS
  );
  return new Date(now.getTime() + delay);
};

const asId = (value) => {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (value._id) return String(value._id);
  return String(value);
};

/**
 * Ensure a notification, its resolved recipient, and its warranty all belong to
 * the same account. This is the last line of defence against a malformed record
 * ever sending one user's warranty reminder to another user's email address.
 *
 * @param {Object} notification
 * @param {Object} user
 * @param {Object} warranty
 * @returns {boolean}
 */
export const isNotificationOwnershipConsistent = (notification, user, warranty) => {
  const notificationUserId = asId(notification?.user);
  const userId = asId(user?._id || user);
  const warrantyUserId = asId(warranty?.user);

  if (notificationUserId && userId && notificationUserId !== userId) return false;
  if (notificationUserId && warrantyUserId && notificationUserId !== warrantyUserId) {
    return false;
  }
  if (userId && warrantyUserId && userId !== warrantyUserId) return false;

  return true;
};

const formatExpiryDate = (value) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC'
  });
};

/**
 * Send the email associated with a notification document.
 * Returns { success, id?, error?, simulated? }.
 */
export const dispatchNotificationEmail = async (notification, { user, warranty } = {}) => {
  if (!notification || !user?.email) {
    return {
      success: false,
      error: 'Notification has no deliverable email address.',
      code: 'MISSING_RECIPIENT',
      retryable: false
    };
  }

  if (!isNotificationOwnershipConsistent(notification, user, warranty)) {
    return {
      success: false,
      error: 'Notification owner does not match the warranty owner.',
      code: 'OWNERSHIP_MISMATCH',
      retryable: false
    };
  }

  if (notification.type === 'SECURITY_CORRECTION') {
    const details = notification.details || {};
    return sendSecurityCorrectionEmail({
      toEmail: user.email,
      userName: user.name,
      productName: details.productName || warranty?.productName || 'Your product',
      changes: details.changes || [],
      reason: details.reason || notification.message,
      correctionAt: details.correctionAt || notification.createdAt,
      warrantyId: warranty?._id || notification.warranty
    });
  }

  if (notification.type === 'EXPIRY_REMINDER') {
    return sendExpiryReminderEmail({
      toEmail: user.email,
      userName: user.name,
      productName: warranty?.productName || 'Your product',
      brand: warranty?.brand || '',
      expiryDate: formatExpiryDate(warranty?.warrantyExpiryDate),
      daysRemaining: notification.daysRemaining,
      warrantyId: warranty?._id || notification.warranty
    });
  }

  return { success: false, error: `Unsupported notification type: ${notification.type}` };
};

/**
 * Persist the outcome of a delivery attempt without discarding the notification
 * when the provider is temporarily unavailable.
 */
export const applyDeliveryResult = async (notification, result) => {
  notification.emailAttempts = (notification.emailAttempts || 0) + 1;
  notification.lastEmailAttemptAt = new Date();

  if (result.success) {
    notification.emailStatus = 'sent';
    notification.sentEmail = true;
    notification.emailError = null;
    notification.emailProviderId = result.id || null;
    notification.emailLastErrorCode = null;
    notification.emailRetryable = false;
    notification.nextEmailRetryAt = null;
  } else {
    const attempts = notification.emailAttempts;
    const retryable =
      result.retryable !== false && attempts < MAX_EMAIL_ATTEMPTS;

    notification.emailStatus = 'failed';
    notification.sentEmail = false;
    notification.emailError = result.error || 'Email delivery failed.';
    notification.emailProviderId = null;
    notification.emailLastErrorCode = result.code || null;
    notification.emailRetryable = retryable;
    notification.nextEmailRetryAt = retryable
      ? computeNextEmailRetryAt(attempts)
      : null;
  }

  await notification.save();
  return result;
};

/**
 * Create an in-app security notification and attempt to deliver its email.
 * The database correction has already been committed before this runs.
 */
export const createSecurityCorrectionNotification = async ({
  user,
  warranty,
  changes,
  reason,
  requestId
}) => {
  const productName = warranty?.productName || 'Your product';
  const correctionAt = new Date();
  const changedFields = changes.map((change) =>
    String(change.field || '').replace(/([A-Z])/g, ' $1').trim()
  );

  const notification = await Notification.create({
    user: user._id,
    warranty: warranty._id,
    title: 'Security alert: important warranty details changed',
    message:
      `Sensitive details for "${productName}" were corrected: ${changedFields.join(', ')}. ` +
      'The original invoice was not modified.',
    daysRemaining: 0,
    reminderInterval: securityReminderInterval(),
    type: 'SECURITY_CORRECTION',
    details: {
      productName,
      changes,
      reason,
      correctionAt
    },
    dedupeKey: requestId
      ? `security:${user._id}:${requestId}`
      : `security:${user._id}:${warranty._id}:${Date.now()}`,
    isRead: false,
    emailStatus: 'not_required'
  });

  const securityEmailsEnabled = user?.reminderPreferences?.securityEmails !== false;
  if (!securityEmailsEnabled || !user?.email) {
    return { notification, emailResult: { success: false, skipped: true } };
  }

  notification.emailStatus = 'pending';
  notification.emailRetryable = true;
  notification.nextEmailRetryAt = null;
  await notification.save();

  let result;
  try {
    result = await dispatchNotificationEmail(notification, { user, warranty });
  } catch (error) {
    result = {
      success: false,
      error: error.message || 'Email dispatch failed.',
      code: 'DISPATCH_ERROR',
      retryable: true
    };
  }
  await applyDeliveryResult(notification, result);

  return { notification, emailResult: result };
};

/**
 * Retry pending/failed notification emails. Safe to call repeatedly: the same
 * notification document is updated, so successful sends are never repeated.
 *
 * @param {Object} options
 * @param {number} options.limit
 * @returns {Promise<Object>} summary
 */
export const retryPendingNotificationEmails = async ({ limit = 20 } = {}) => {
  const summary = {
    checked: 0,
    sent: 0,
    failed: 0,
    skipped: 0
  };

  const now = new Date();
  const pending = await Notification.find({
    emailStatus: { $in: ['pending', 'failed'] },
    emailAttempts: { $lt: MAX_EMAIL_ATTEMPTS },
    emailRetryable: { $ne: false },
    $or: [{ nextEmailRetryAt: null }, { nextEmailRetryAt: { $lte: now } }]
  })
    .sort({ createdAt: 1 })
    .limit(Math.min(Math.max(limit, 1), 100))
    .populate('user', 'name email reminderPreferences')
    .populate('warranty', 'productName brand warrantyExpiryDate user');

  for (const notification of pending) {
    summary.checked++;

    if (!notification.user || !notification.user.email) {
      notification.emailStatus = 'not_required';
      notification.emailError = 'No email address on the account.';
      notification.emailRetryable = false;
      notification.nextEmailRetryAt = null;
      await notification.save();
      summary.skipped++;
      continue;
    }

    if (!notification.warranty) {
      notification.emailStatus = 'failed';
      notification.emailError = 'Warranty record no longer exists.';
      notification.emailRetryable = false;
      notification.nextEmailRetryAt = null;
      await notification.save();
      summary.skipped++;
      continue;
    }

    if (
      !isNotificationOwnershipConsistent(
        notification,
        notification.user,
        notification.warranty
      )
    ) {
      notification.emailStatus = 'failed';
      notification.emailError =
        'Notification owner does not match the warranty owner.';
      notification.emailLastErrorCode = 'OWNERSHIP_MISMATCH';
      notification.emailRetryable = false;
      notification.nextEmailRetryAt = null;
      await notification.save();
      summary.skipped++;
      continue;
    }

    // Respect the user's current preferences. A reminder that failed while
    // email was enabled should not be delivered after the user turns it off.
    const preferences = notification.user.reminderPreferences || {};
    if (
      (notification.type === 'EXPIRY_REMINDER' && preferences.emailReminders === false) ||
      (notification.type === 'SECURITY_CORRECTION' && preferences.securityEmails === false)
    ) {
      notification.emailStatus = 'not_required';
      notification.emailError = 'Email delivery disabled by the account owner.';
      notification.emailRetryable = false;
      notification.nextEmailRetryAt = null;
      await notification.save();
      summary.skipped++;
      continue;
    }

    let result;
    try {
      result = await dispatchNotificationEmail(notification, {
        user: notification.user,
        warranty: notification.warranty
      });
    } catch (error) {
      result = {
        success: false,
        error: error.message || 'Email dispatch failed.',
        code: 'DISPATCH_ERROR',
        retryable: true
      };
    }
    await applyDeliveryResult(notification, result);

    if (result.success) {
      summary.sent++;
    } else {
      summary.failed++;
    }
  }

  return summary;
};

export { MAX_EMAIL_ATTEMPTS };
