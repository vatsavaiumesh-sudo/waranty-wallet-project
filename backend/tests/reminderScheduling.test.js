import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  selectReminderInterval,
  calculateDaysRemainingInTimeZone,
  calculateDaysRemaining,
  getCalendarDateKey,
  getWarrantyStatus
} from '../utils/warrantyHelpers.js';

describe('Reminder scheduling - interval selection', () => {
  test('selects the 30-day reminder inside the 30-day window', () => {
    assert.strictEqual(selectReminderInterval(30), 30);
    assert.strictEqual(selectReminderInterval(29), 30);
    assert.strictEqual(selectReminderInterval(21), 30);
  });

  test('selects the 7-day reminder inside the 7-day window', () => {
    assert.strictEqual(selectReminderInterval(7), 7);
    assert.strictEqual(selectReminderInterval(6), 7);
    assert.strictEqual(selectReminderInterval(2), 7);
  });

  test('selects the 1-day reminder on the day before expiry', () => {
    assert.strictEqual(selectReminderInterval(1), 1);
  });

  test('selects the expiry-day reminder when the warranty expires today', () => {
    assert.strictEqual(selectReminderInterval(0), 0);
  });

  test('returns null for expired warranties and invalid day counts', () => {
    assert.strictEqual(selectReminderInterval(-1), null);
    assert.strictEqual(selectReminderInterval(-30), null);
    assert.strictEqual(selectReminderInterval(Number.NaN), null);
    assert.strictEqual(selectReminderInterval(Infinity), null);
  });

  test('respects custom user reminder days and still includes expiry day', () => {
    assert.strictEqual(selectReminderInterval(14, [14, 3]), 14);
    assert.strictEqual(selectReminderInterval(10, [14, 3]), 14);
    assert.strictEqual(selectReminderInterval(3, [14, 3]), 3);
    assert.strictEqual(selectReminderInterval(2, [14, 3]), 3);
    assert.strictEqual(selectReminderInterval(0, [14, 3]), 0);
  });

  test('returns only one interval per run to avoid backlog bursts', () => {
    const result = selectReminderInterval(5, [30, 7, 1]);
    assert.strictEqual(result, 7);
    assert.strictEqual(typeof result, 'number');
  });
});

describe('Reminder scheduling - timezone-aware day counts', () => {
  const expiry = '2026-01-01T00:00:00.000Z';
  const now = new Date('2025-12-31T02:00:00.000Z');

  test('counts calendar days in UTC', () => {
    assert.strictEqual(calculateDaysRemainingInTimeZone(expiry, 'UTC', now), 1);
  });

  test('counts calendar days in a negative-offset timezone', () => {
    // At 02:00 UTC on Dec 31 it is still Dec 30 in Los Angeles.
    assert.strictEqual(
      calculateDaysRemainingInTimeZone(expiry, 'America/Los_Angeles', now),
      1
    );
  });

  test('counts calendar days in a positive-offset timezone', () => {
    // At 20:00 UTC on Dec 31 it is already 01:30 on Jan 1 in Kolkata, so the
    // expiry date has arrived even though UTC is still a day behind.
    const lateUtc = new Date('2025-12-31T20:00:00.000Z');
    assert.strictEqual(
      calculateDaysRemainingInTimeZone(expiry, 'Asia/Kolkata', lateUtc),
      0
    );
  });

  test('falls back to UTC for an invalid timezone name', () => {
    assert.strictEqual(
      calculateDaysRemainingInTimeZone(expiry, 'Not/ARealZone', now),
      1
    );
  });

  test('returns a negative count after expiry', () => {
    assert.ok(calculateDaysRemaining('2025-12-01T00:00:00.000Z', new Date('2025-12-31T00:00:00.000Z')) < 0);
  });

  test('produces a stable UTC calendar key for a local date', () => {
    assert.strictEqual(
      getCalendarDateKey('2026-01-01T00:00:00.000Z', 'UTC'),
      Date.UTC(2026, 0, 1)
    );
  });

  test('expired-status boundaries remain consistent with reminder logic', () => {
    assert.strictEqual(getWarrantyStatus(0), 'EXPIRING_SOON');
    assert.strictEqual(getWarrantyStatus(-1), 'EXPIRED');
  });
});
