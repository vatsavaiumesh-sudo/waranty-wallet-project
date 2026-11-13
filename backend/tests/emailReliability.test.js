import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  sendEmail,
  setEmailTransportForTests,
  resetEmailTransportForTests
} from '../services/emailService.js';
import {
  MAX_EMAIL_ATTEMPTS,
  applyDeliveryResult,
  computeNextEmailRetryAt,
  dispatchNotificationEmail,
  isNotificationOwnershipConsistent
} from '../services/notificationService.js';
import Notification from '../models/Notification.js';

const MANAGED_ENV = [
  'NODE_ENV',
  'USE_TEST_DATABASE',
  'RESEND_API_KEY',
  'EMAIL_FROM',
  'EMAIL_SEND_TIMEOUT_MS',
  'CLIENT_URL'
];

let previousEnv;

beforeEach(() => {
  previousEnv = Object.fromEntries(MANAGED_ENV.map((key) => [key, process.env[key]]));
  for (const key of MANAGED_ENV) delete process.env[key];

  process.env.NODE_ENV = 'production';
  process.env.EMAIL_FROM = 'Warranty Wallet <notifications@example.test>';
  process.env.CLIENT_URL = 'https://example.test';
  resetEmailTransportForTests();
});

afterEach(() => {
  resetEmailTransportForTests();
  for (const key of MANAGED_ENV) {
    if (previousEnv[key] === undefined) delete process.env[key];
    else process.env[key] = previousEnv[key];
  }
});

const transport = (impl) => ({ emails: { send: impl } });

const message = {
  toEmail: 'owner@example.com',
  subject: 'Warranty reminder',
  html: '<p>Reminder</p>'
};

const expiryNotification = (overrides = {}) => ({
  type: 'EXPIRY_REMINDER',
  user: 'user-a',
  warranty: 'warranty-a',
  daysRemaining: 7,
  emailAttempts: 0,
  save: async () => {},
  ...overrides
});

describe('Email delivery reliability', () => {
  test('sends to the authenticated owner recipient through the provider', async () => {
    const calls = [];
    setEmailTransportForTests(
      transport(async (payload) => {
        calls.push(payload);
        return { data: { id: 'provider-message-1' } };
      })
    );

    const result = await sendEmail(message);

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.id, 'provider-message-1');
    assert.strictEqual(calls.length, 1);
    assert.deepEqual(calls[0].to, ['owner@example.com']);
    assert.strictEqual(calls[0].from, 'Warranty Wallet <notifications@example.test>');
    assert.strictEqual(calls[0].subject, 'Warranty reminder');
  });

  test('retries transient provider failures with a scheduled backoff', async () => {
    setEmailTransportForTests(
      transport(async () => {
        const error = new Error('temporary provider outage');
        error.statusCode = 503;
        throw error;
      })
    );

    const result = await sendEmail(message);

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.retryable, true);
    assert.strictEqual(result.code, 'PROVIDER_ERROR');
  });

  test('does not retry permanent provider rejections', async () => {
    setEmailTransportForTests(
      transport(async () => ({
        error: { message: 'Invalid recipient', statusCode: 422 }
      }))
    );

    const result = await sendEmail(message);

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.retryable, false);
    assert.strictEqual(result.code, 'PROVIDER_REJECTED');
  });

  test('treats a provider timeout as a retryable failure, never a success', async () => {
    process.env.EMAIL_SEND_TIMEOUT_MS = '20';
    setEmailTransportForTests(transport(() => new Promise(() => {})));

    const result = await sendEmail(message);

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.retryable, true);
    assert.strictEqual(result.code, 'PROVIDER_TIMEOUT');
  });

  test('rejects an invalid recipient before contacting the provider', async () => {
    let calls = 0;
    setEmailTransportForTests(
      transport(async () => {
        calls++;
        return { data: { id: 'should-not-happen' } };
      })
    );

    const result = await sendEmail({ ...message, toEmail: 'not-an-email' });

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.code, 'INVALID_RECIPIENT');
    assert.strictEqual(result.retryable, false);
    assert.strictEqual(calls, 0);
  });

  test('reports an unconfigured provider honestly instead of pretending delivery', async () => {
    resetEmailTransportForTests();
    delete process.env.RESEND_API_KEY;

    const result = await sendEmail(message);

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.code, 'PROVIDER_NOT_CONFIGURED');
    assert.match(result.error, /not configured/i);
  });
});

describe('Test-mode email isolation', () => {
  test('NODE_ENV=test simulates delivery even when a transport is injected', async () => {
    process.env.NODE_ENV = 'test';
    let calls = 0;
    setEmailTransportForTests(
      transport(async () => {
        calls++;
        return { data: { id: 'real-provider-must-not-be-called' } };
      })
    );

    const result = await sendEmail(message);

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.simulated, true);
    assert.strictEqual(calls, 0);
  });

  test('USE_TEST_DATABASE=true simulates delivery even with provider credentials present', async () => {
    process.env.USE_TEST_DATABASE = 'true';
    process.env.RESEND_API_KEY = 're_test_dummy_key_for_isolation_only';
    let calls = 0;
    setEmailTransportForTests(
      transport(async () => {
        calls++;
        return { data: { id: 'real-provider-must-not-be-called' } };
      })
    );

    const result = await sendEmail(message);

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.simulated, true);
    assert.strictEqual(calls, 0);
  });
});

describe('Recipient ownership isolation', () => {
  test('ownership guard accepts a consistent notification, user, and warranty', () => {
    assert.strictEqual(
      isNotificationOwnershipConsistent(
        { user: 'user-a' },
        { _id: 'user-a', email: 'owner@example.com' },
        { user: 'user-a' }
      ),
      true
    );
  });

  test('ownership guard rejects a notification whose user differs from the recipient', () => {
    assert.strictEqual(
      isNotificationOwnershipConsistent(
        { user: 'user-a' },
        { _id: 'user-b', email: 'other@example.com' },
        { user: 'user-a' }
      ),
      false
    );
  });

  test('ownership guard rejects a warranty that belongs to another user', () => {
    assert.strictEqual(
      isNotificationOwnershipConsistent(
        { user: 'user-a' },
        { _id: 'user-a', email: 'owner@example.com' },
        { user: 'user-b' }
      ),
      false
    );
  });

  test('dispatch never emails another user when the record is malformed', async () => {
    let calls = 0;
    setEmailTransportForTests(
      transport(async () => {
        calls++;
        return { data: { id: 'should-not-happen' } };
      })
    );

    const result = await dispatchNotificationEmail(
      { ...expiryNotification(), user: 'user-a' },
      {
        user: { _id: 'user-b', email: 'other@example.com', name: 'Other' },
        warranty: { _id: 'warranty-a', user: 'user-a', productName: 'TV' }
      }
    );

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.code, 'OWNERSHIP_MISMATCH');
    assert.strictEqual(result.retryable, false);
    assert.strictEqual(calls, 0);
  });

  test('dispatch sends only to the notification owner email', async () => {
    const calls = [];
    setEmailTransportForTests(
      transport(async (payload) => {
        calls.push(payload);
        return { data: { id: 'owner-message' } };
      })
    );

    const result = await dispatchNotificationEmail(expiryNotification(), {
      user: { _id: 'user-a', email: 'owner@example.com', name: 'Owner' },
      warranty: {
        _id: 'warranty-a',
        user: 'user-a',
        productName: 'Television',
        brand: 'Example',
        warrantyExpiryDate: '2026-12-01T00:00:00.000Z'
      }
    });

    assert.strictEqual(result.success, true);
    assert.strictEqual(calls.length, 1);
    assert.deepEqual(calls[0].to, ['owner@example.com']);
    assert.strictEqual(calls[0].to.includes('other@example.com'), false);
  });
});

describe('Durable email delivery state', () => {
  test('a failed attempt is not marked delivered and schedules a retry', async () => {
    const notification = expiryNotification();
    const before = Date.now();

    await applyDeliveryResult(notification, {
      success: false,
      error: 'temporary provider outage',
      code: 'PROVIDER_ERROR',
      retryable: true
    });

    assert.strictEqual(notification.emailStatus, 'failed');
    assert.strictEqual(notification.sentEmail, false);
    assert.strictEqual(notification.emailRetryable, true);
    assert.strictEqual(notification.emailLastErrorCode, 'PROVIDER_ERROR');
    assert.ok(notification.nextEmailRetryAt instanceof Date);
    assert.ok(notification.nextEmailRetryAt.getTime() > before);
  });

  test('a successful attempt marks delivery and clears retry state', async () => {
    const notification = expiryNotification({
      emailAttempts: 2,
      emailRetryable: true,
      nextEmailRetryAt: new Date()
    });

    await applyDeliveryResult(notification, {
      success: true,
      id: 'provider-message-1'
    });

    assert.strictEqual(notification.emailStatus, 'sent');
    assert.strictEqual(notification.sentEmail, true);
    assert.strictEqual(notification.emailAttempts, 3);
    assert.strictEqual(notification.emailProviderId, 'provider-message-1');
    assert.strictEqual(notification.emailRetryable, false);
    assert.strictEqual(notification.nextEmailRetryAt, null);
  });

  test('stops retrying after the maximum attempt count', async () => {
    const notification = expiryNotification({
      emailAttempts: MAX_EMAIL_ATTEMPTS - 1
    });

    await applyDeliveryResult(notification, {
      success: false,
      error: 'still failing',
      code: 'PROVIDER_ERROR',
      retryable: true
    });

    assert.strictEqual(notification.emailAttempts, MAX_EMAIL_ATTEMPTS);
    assert.strictEqual(notification.emailStatus, 'failed');
    assert.strictEqual(notification.emailRetryable, false);
    assert.strictEqual(notification.nextEmailRetryAt, null);
  });

  test('does not schedule a retry for a permanent failure', async () => {
    const notification = expiryNotification();

    await applyDeliveryResult(notification, {
      success: false,
      error: 'invalid recipient',
      code: 'PROVIDER_REJECTED',
      retryable: false
    });

    assert.strictEqual(notification.emailRetryable, false);
    assert.strictEqual(notification.nextEmailRetryAt, null);
  });

  test('backoff grows with each attempt and caps safely', () => {
    const now = new Date('2026-01-01T00:00:00.000Z');
    const first = computeNextEmailRetryAt(1, now);
    const second = computeNextEmailRetryAt(2, now);
    const capped = computeNextEmailRetryAt(20, now);

    assert.ok(second.getTime() > first.getTime());
    assert.ok(capped.getTime() - now.getTime() <= 6 * 60 * 60 * 1000);
    assert.strictEqual(computeNextEmailRetryAt(0, now), null);
    assert.strictEqual(computeNextEmailRetryAt(Number.NaN, now), null);
  });

  test('duplicate reminder prevention is enforced by the unique schema index', () => {
    const indexes = Notification.schema.indexes();
    const uniqueReminderIndex = indexes.find(
      ([fields, options]) =>
        fields.user === 1 &&
        fields.warranty === 1 &&
        fields.reminderInterval === 1 &&
        options?.unique === true
    );

    assert.ok(uniqueReminderIndex);
  });

  test('reminder cron entry point keeps the guarded DB connection and reminder service', () => {
    const scriptPath = fileURLToPath(
      new URL('../scripts/run-reminders.js', import.meta.url)
    );
    const content = fs.readFileSync(scriptPath, 'utf8');

    assert.ok(content.includes('connectDB'));
    assert.ok(content.includes('processWarrantyReminders'));
    assert.ok(content.includes('retryPendingNotificationEmails') === false);
    assert.ok(content.includes('mongoose.disconnect'));
  });
});
