import Warranty from '../models/Warranty.js';
import Notification from '../models/Notification.js';
import {
  calculateDaysRemainingInTimeZone,
  selectReminderInterval
} from '../utils/warrantyHelpers.js';
import {
  applyDeliveryResult,
  dispatchNotificationEmail,
  retryPendingNotificationEmails
} from './notificationService.js';

/**
 * Process expiry reminders for active warranties.
 *
 * Reliability properties:
 * - Only one reminder interval is created per warranty per run. This prevents a
 *   late or restarted scheduler from sending several backlogged emails at once.
 * - The unique index { user, warranty, reminderInterval } prevents duplicate
 *   reminders across repeated or concurrent runs.
 * - Reminder days are calculated in the user's configured IANA timezone.
 * - Soft-deleted warranties are excluded.
 * - Failed emails retain a pending/failed state and are retried by the durable
 *   retry worker instead of being silently dropped.
 *
 * @param {Object} options
 * @param {string} [options.targetUserId] - Optional user ID to process single user
 * @param {boolean} [options.simulateEmail] - Kept for API compatibility; test
 *   mode is controlled by NODE_ENV in the email service.
 * @returns {Promise<Object>} Summary of processed reminders
 */
export const processWarrantyReminders = async (options = {}) => {
  const { targetUserId = null } = options;

  const now = new Date();
  const maxLookahead = new Date(now);
  maxLookahead.setUTCDate(maxLookahead.getUTCDate() + 35);

  const warrantyQuery = {
    deletedAt: null,
    warrantyExpiryDate: { $gte: new Date(now.getTime() - 24 * 60 * 60 * 1000), $lte: maxLookahead }
  };

  if (targetUserId) {
    warrantyQuery.user = targetUserId;
  }

  const upcomingWarranties = await Warranty.find(warrantyQuery).populate(
    'user',
    'name email timezone reminderPreferences'
  );

  const report = {
    processedCount: upcomingWarranties.length,
    notificationsCreated: 0,
    emailsSent: 0,
    emailsFailed: 0,
    skippedDuplicate: 0,
    skippedNoEmail: 0,
    retriedEmails: null,
    errors: []
  };

  for (const warranty of upcomingWarranties) {
    try {
      const user = warranty.user;
      if (!user) continue;

      const userTimeZone = user.timezone || 'UTC';
      const daysRemaining = calculateDaysRemainingInTimeZone(
        warranty.warrantyExpiryDate,
        userTimeZone,
        now
      );

      if (!Number.isFinite(daysRemaining) || daysRemaining < 0) continue;

      const reminderPreferences = user.reminderPreferences || {
        emailReminders: true,
        inAppReminders: true,
        reminderDays: [30, 7, 1]
      };

      const configuredDays = reminderPreferences.reminderDays || [30, 7, 1];
      const interval = selectReminderInterval(daysRemaining, configuredDays);

      if (interval === null) continue;

      // Check for an existing reminder at this interval. Also covers the
      // window before a unique-index conflict is reported.
      const existing = await Notification.findOne({
        user: user._id,
        warranty: warranty._id,
        reminderInterval: interval
      });

      if (existing) {
        report.skippedDuplicate++;
        continue;
      }

      const countdownText =
        daysRemaining === 0
          ? 'expires today!'
          : daysRemaining === 1
            ? 'expires in 1 day!'
            : `expires in ${daysRemaining} days!`;

      const title =
        daysRemaining === 0
          ? `⚠️ Warranty Expiring Today: ${warranty.productName}`
          : `Warranty Expiring Soon: ${warranty.productName} (${daysRemaining}d remaining)`;

      const message =
        `The warranty coverage for your product "${warranty.productName}" ${countdownText} ` +
        'Please check your purchase records and original invoice if warranty service is needed.';

      const wantsEmail = Boolean(
        reminderPreferences.emailReminders !== false && user.email
      );

      let notificationDoc;
      try {
        notificationDoc = await Notification.create({
          user: user._id,
          warranty: warranty._id,
          title,
          message,
          daysRemaining,
          reminderInterval: interval,
          type: 'EXPIRY_REMINDER',
          details: { interval, timezone: userTimeZone },
          isRead: false,
          sentEmail: false,
          emailStatus: wantsEmail ? 'pending' : 'not_required'
        });
        report.notificationsCreated++;
      } catch (createErr) {
        // E11000 duplicate key error means another run created it concurrently.
        if (createErr.code === 11000) {
          report.skippedDuplicate++;
          continue;
        }
        throw createErr;
      }

      if (!wantsEmail) {
        if (!user.email) report.skippedNoEmail++;
        continue;
      }

      let emailResult;
      try {
        emailResult = await dispatchNotificationEmail(notificationDoc, {
          user,
          warranty
        });
      } catch (error) {
        emailResult = {
          success: false,
          error: error.message || 'Email dispatch failed.',
          code: 'DISPATCH_ERROR',
          retryable: true
        };
      }
      await applyDeliveryResult(notificationDoc, emailResult);

      if (emailResult.success) {
        report.emailsSent++;
      } else {
        report.emailsFailed++;
      }
    } catch (err) {
      report.errors.push({
        warrantyId: warranty._id,
        error: err.message
      });
    }
  }

  // Retry failed/pending correction and expiry emails after creating new work.
  try {
    report.retriedEmails = await retryPendingNotificationEmails({ limit: 50 });
  } catch (error) {
    report.errors.push({ warrantyId: 'retry-worker', error: error.message });
  }

  return report;
};
