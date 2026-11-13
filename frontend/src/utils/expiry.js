/**
 * Calendar-aware warranty expiry calculations.
 *
 * This mirrors the backend `calculateExpiryDate` implementation so the review
 * form preview and the stored expiry date cannot disagree. Everything is done
 * in UTC: date-only form inputs (`YYYY-MM-DD`) are parsed by the browser as UTC
 * midnight, and the backend stores them that way.
 */

export const calculateExpiryDate = (startDate, duration, unit) => {
  const date = new Date(startDate);
  if (Number.isNaN(date.getTime())) return null;

  const amount = Number(duration) || 0;

  if (unit === 'Days') {
    date.setUTCDate(date.getUTCDate() + amount);
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
  totalMonths += unit === 'Years' ? amount * 12 : amount;

  const newYear = Math.floor(totalMonths / 12);
  const newMonth = ((totalMonths % 12) + 12) % 12;

  // Clamp month-end dates (e.g. Jan 31 + 1 month = Feb 28/29).
  const lastDayOfTargetMonth = new Date(Date.UTC(newYear, newMonth + 1, 0)).getUTCDate();
  const clampedDay = Math.min(day, lastDayOfTargetMonth);

  return new Date(
    Date.UTC(newYear, newMonth, clampedDay, hours, minutes, seconds, milliseconds)
  );
};

/**
 * Format a calendar date in UTC so a date-only value does not shift backwards
 * for users in negative-offset timezones.
 */
export const formatCalendarDate = (value) => {
  if (!value) return 'N/A';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Invalid Date';
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  }).format(date);
};

/**
 * Convert a Date/ISO string to the `YYYY-MM-DD` value expected by input[type=date].
 */
export const toDateInputValue = (value) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 10);
};
