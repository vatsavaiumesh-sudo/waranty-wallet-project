/**
 * Helper utilities for calculating warranty expiry, status, and remaining days.
 *
 * All calendar-day comparisons are normalized to UTC calendar dates so the
 * backend does not produce off-by-one results when the server runs in a
 * different local timezone. User-facing reminder decisions can additionally be
 * calculated in the user's configured IANA timezone.
 */

/**
 * Calculates warranty expiry date based on purchase date, duration, and unit.
 * @param {Date|string} purchaseDate
 * @param {number} duration
 * @param {string} unit - 'Days', 'Months' or 'Years'
 * @returns {Date}
 */
export const calculateExpiryDate = (purchaseDate, duration, unit) => {
  const date = new Date(purchaseDate);
  const numDuration = Number(duration) || 0;

  if (unit === 'Days') {
    // Preserve UTC to avoid timezone off-by-one errors.
    date.setUTCDate(date.getUTCDate() + numDuration);
    return date;
  }

  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  const day = date.getUTCDate();
  const hours = date.getUTCHours();
  const minutes = date.getUTCMinutes();
  const seconds = date.getUTCSeconds();
  const milliseconds = date.getUTCMilliseconds();

  let totalMonths = year * 12 + month;
  if (unit === 'Years') {
    totalMonths += numDuration * 12;
  } else {
    // Default to Months (calendar-aware, clamps month-end dates safely).
    totalMonths += numDuration;
  }

  const newYear = Math.floor(totalMonths / 12);
  const newMonth = ((totalMonths % 12) + 12) % 12;

  // Clamp the day to the last valid day of the target month (handles
  // month-end dates and February in leap/non-leap years).
  const lastDayOfTargetMonth = new Date(
    Date.UTC(newYear, newMonth + 1, 0)
  ).getUTCDate();
  const clampedDay = Math.min(day, lastDayOfTargetMonth);

  return new Date(
    Date.UTC(newYear, newMonth, clampedDay, hours, minutes, seconds, milliseconds)
  );
};

/**
 * Returns a UTC timestamp representing the calendar date (year-month-day) of a
 * moment in a specific IANA timezone.
 * @param {Date|string} date
 * @param {string} timeZone
 * @returns {number}
 */
export const getCalendarDateKey = (date, timeZone = 'UTC') => {
  const value = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(value.getTime())) return NaN;

  let formatter;
  try {
    formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: timeZone || 'UTC',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    });
  } catch {
    // Invalid timezone string: fall back to UTC instead of throwing.
    formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'UTC',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    });
  }

  const parts = formatter.formatToParts(value);
  const find = (type) => Number(parts.find((part) => part.type === type)?.value);
  return Date.UTC(find('year'), find('month') - 1, find('day'));
};

/**
 * Calculates days remaining until warranty expiry date in the given timezone.
 * @param {Date|string} expiryDate
 * @param {string} timeZone
 * @param {Date} [now]
 * @returns {number} Integer representing remaining days (negative if expired)
 */
export const calculateDaysRemainingInTimeZone = (
  expiryDate,
  timeZone = 'UTC',
  now = new Date()
) => {
  const todayKey = getCalendarDateKey(now, timeZone);
  const expiryKey = getCalendarDateKey(expiryDate, timeZone);
  if (Number.isNaN(todayKey) || Number.isNaN(expiryKey)) return NaN;
  return Math.round((expiryKey - todayKey) / (1000 * 60 * 60 * 24));
};

/**
 * Calculates days remaining until warranty expiry date using UTC calendar days.
 * @param {Date|string} expiryDate
 * @param {Date} [now]
 * @returns {number} Integer representing remaining days (negative if expired)
 */
export const calculateDaysRemaining = (expiryDate, now = new Date()) => {
  return calculateDaysRemainingInTimeZone(expiryDate, 'UTC', now);
};

/**
 * Determines status based on remaining days.
 * Rules:
 * - ACTIVE: > 30 days remaining
 * - EXPIRING_SOON: 0 to 30 days remaining
 * - EXPIRED: < 0 days remaining
 * @param {number} daysRemaining
 * @returns {'ACTIVE' | 'EXPIRING_SOON' | 'EXPIRED'}
 */
export const getWarrantyStatus = (daysRemaining) => {
  if (daysRemaining < 0) {
    return 'EXPIRED';
  } else if (daysRemaining <= 30) {
    return 'EXPIRING_SOON';
  } else {
    return 'ACTIVE';
  }
};

/**
 * Formats days remaining into human-readable text.
 * Examples:
 * - "245 days left"
 * - "12 days left"
 * - "Expires today"
 * - "Expired 18 days ago"
 * @param {number} daysRemaining
 * @returns {string}
 */
export const formatDaysRemainingText = (daysRemaining) => {
  if (daysRemaining < 0) {
    const absDays = Math.abs(daysRemaining);
    return absDays === 1 ? 'Expired 1 day ago' : `Expired ${absDays} days ago`;
  } else if (daysRemaining === 0) {
    return 'Expires today';
  } else if (daysRemaining === 1) {
    return '1 day left';
  } else {
    return `${daysRemaining} days left`;
  }
};

/**
 * Selects the single most urgent reminder interval that is due for a warranty.
 *
 * Only one interval is returned per run. This prevents a late or restarted
 * scheduler from sending several backlogged reminders (for example 30-day and
 * 7-day) at the same moment. The returned value is the smallest configured
 * interval that is greater than or equal to the remaining days, plus 0 for the
 * expiry day itself.
 *
 * @param {number} daysRemaining
 * @param {number[]} reminderDays
 * @returns {number|null}
 */
export const selectReminderInterval = (daysRemaining, reminderDays = [30, 7, 1]) => {
  if (!Number.isFinite(daysRemaining) || daysRemaining < 0) return null;

  const configured = Array.isArray(reminderDays)
    ? reminderDays.map(Number).filter((day) => Number.isFinite(day) && day >= 0)
    : [];

  const intervals = [...new Set([...(configured.length ? configured : [30, 7, 1]), 0])]
    .sort((a, b) => b - a);

  const applicable = intervals.filter((interval) => daysRemaining <= interval);
  if (applicable.length === 0) return null;

  return Math.min(...applicable);
};

/**
 * Whether a warranty has invoice evidence that must be protected by the
 * controlled-correction workflow.
 * @param {Object} warrantyDoc
 * @returns {boolean}
 */
export const isInvoiceBacked = (warrantyDoc) => {
  if (!warrantyDoc) return false;
  const invoice = warrantyDoc.invoice;
  return Boolean(
    (invoice && invoice.checksum && invoice.status !== 'removed') ||
      warrantyDoc.invoiceFile
  );
};

/**
 * Decorates a raw warranty database object with computed runtime fields:
 * daysRemaining, status, formattedDaysLeft, evidence flags
 * @param {Object} warrantyDoc
 * @returns {Object}
 */
export const decorateWarranty = (warrantyDoc) => {
  const warrantyObj = warrantyDoc.toObject ? warrantyDoc.toObject() : { ...warrantyDoc };
  const daysRemaining = calculateDaysRemaining(warrantyObj.warrantyExpiryDate);
  const status = getWarrantyStatus(daysRemaining);
  const formattedDaysLeft = formatDaysRemainingText(daysRemaining);
  const invoiceBacked = isInvoiceBacked(warrantyObj);

  return {
    ...warrantyObj,
    daysRemaining,
    status,
    formattedDaysLeft,
    recordVersion: warrantyObj.recordVersion || 1,
    evidenceStatus:
      warrantyObj.evidenceStatus ||
      (warrantyObj.invoice || warrantyObj.invoiceFile ? 'legacy_unverified' : 'legacy_unverified'),
    isInvoiceBacked: invoiceBacked,
    hasOriginalInvoice: Boolean(warrantyObj.invoice && warrantyObj.invoice.checksum)
  };
};
