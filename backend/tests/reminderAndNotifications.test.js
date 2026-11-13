import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { sendExpiryReminderEmail } from '../services/emailService.js';
import { selectReminderInterval } from '../utils/warrantyHelpers.js';
import Notification from '../models/Notification.js';

describe('Reminders & Notification System', () => {
  test('sendExpiryReminderEmail simulates email delivery in test environment without sending real emails', async () => {
    process.env.NODE_ENV = 'test';

    const result = await sendExpiryReminderEmail({
      toEmail: 'customer@example.com',
      userName: 'John Doe',
      productName: 'MacBook Pro M3',
      brand: 'Apple',
      expiryDate: 'Dec 15, 2026',
      daysRemaining: 7,
      warrantyId: 'mock_warranty_id_123'
    });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.simulated, true);
    assert.ok(result.id.startsWith('sim-'));
  });

  test('Notification schema indexes enforce uniqueness on user, warranty, reminderInterval', () => {
    // Inspect compound indexes on Notification model
    const indexes = Notification.schema.indexes();
    const uniqueIndex = indexes.find(
      ([fields, options]) =>
        fields.user === 1 &&
        fields.warranty === 1 &&
        fields.reminderInterval === 1 &&
        options?.unique === true
    );

    assert.ok(uniqueIndex, 'Compound unique index { user: 1, warranty: 1, reminderInterval: 1 } must be registered');
  });

  test('Only the most urgent due reminder interval is selected per run', () => {
    // A warranty with 5 days remaining is inside both the 30-day and 7-day
    // windows. The scheduler must send only the 7-day reminder this run, then
    // skip later runs at the same interval thanks to the uniqueness guard.
    assert.strictEqual(selectReminderInterval(5, [30, 7, 1]), 7);
    assert.strictEqual(selectReminderInterval(20, [30, 7, 1]), 30);
    assert.strictEqual(selectReminderInterval(1, [30, 7, 1]), 1);
    assert.strictEqual(selectReminderInterval(0, [30, 7, 1]), 0);
    assert.strictEqual(selectReminderInterval(-1, [30, 7, 1]), null);
  });
});
