import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  generateSecurityEmailHtml,
  sendSecurityCorrectionEmail,
  escapeHtml,
  sendEmail
} from '../services/emailService.js';
import {
  dispatchNotificationEmail,
  applyDeliveryResult
} from '../services/notificationService.js';

let previousNodeEnv;
let previousResendKey;

beforeEach(() => {
  previousNodeEnv = process.env.NODE_ENV;
  previousResendKey = process.env.RESEND_API_KEY;
  process.env.NODE_ENV = 'test';
});

afterEach(() => {
  if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = previousNodeEnv;

  if (previousResendKey === undefined) delete process.env.RESEND_API_KEY;
  else process.env.RESEND_API_KEY = previousResendKey;
});

const sampleChanges = [
  {
    field: 'productName',
    previousValue: 'H2R Racing Helmet',
    newValue: 'Pagani'
  },
  {
    field: 'serialNumber',
    previousValue: 'SN-1',
    newValue: 'SN-2'
  }
];

describe('Security correction email content', () => {
  test('includes product, previous value, new value, reason, and security notice', () => {
    const html = generateSecurityEmailHtml({
      userName: 'Test Owner',
      productName: 'H2R Racing Helmet',
      changes: sampleChanges,
      reason: 'Typo correction after checking the paper invoice.',
      correctionAt: '2026-11-09T10:00:00.000Z',
      warrantyUrl: 'https://example.test/warranties/abc'
    });

    assert.match(html, /H2R Racing Helmet/);
    assert.match(html, /Pagani/);
    assert.match(html, /SN-1/);
    assert.match(html, /SN-2/);
    assert.match(html, /Typo correction/);
    assert.match(html, /original invoice has not been modified/i);
    assert.match(html, /https:\/\/example\.test\/warranties\/abc/);
  });

  test('escapes untrusted invoice and reason values in HTML', () => {
    const html = generateSecurityEmailHtml({
      userName: '<script>alert(1)</script>',
      productName: '<img src=x onerror=alert(1)>',
      changes: sampleChanges,
      reason: '<b>not bold</b>',
      correctionAt: '2026-11-09T10:00:00.000Z',
      warrantyUrl: 'https://example.test/warranties/abc'
    });

    assert.strictEqual(html.includes('<script>alert(1)</script>'), false);
    assert.strictEqual(html.includes('<img src=x onerror=alert(1)>'), false);
    assert.strictEqual(html.includes('<b>not bold</b>'), false);
    assert.match(html, /&lt;script&gt;/);
  });

  test('escapeHtml handles null, quotes, and ampersands', () => {
    assert.strictEqual(escapeHtml(null), '');
    assert.strictEqual(escapeHtml(`"'&<>`), '&quot;&#39;&amp;&lt;&gt;');
  });

  test('uses the mandatory security subject line when dispatching', async () => {
    const originalLog = console.log;
    const logged = [];
    console.log = (message) => logged.push(String(message));

    try {
      const result = await sendSecurityCorrectionEmail({
        toEmail: 'owner@example.com',
        userName: 'Owner',
        productName: 'H2R Racing Helmet',
        changes: sampleChanges,
        reason: 'Correction reason with enough detail.',
        correctionAt: new Date(),
        warrantyId: 'warranty-1'
      });

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.simulated, true);
      assert.ok(
        logged.some((line) =>
          line.includes('Security Alert: Important changes were made to your Warranty Wallet record')
        )
      );
    } finally {
      console.log = originalLog;
    }
  });
});

describe('Security notification delivery state', () => {
  test('routes a security notification to the account owner email', async () => {
    const originalLog = console.log;
    const logged = [];
    console.log = (message) => logged.push(String(message));

    try {
      const result = await dispatchNotificationEmail(
        {
          type: 'SECURITY_CORRECTION',
          details: {
            productName: 'H2R Racing Helmet',
            changes: sampleChanges,
            reason: 'Reason text long enough.',
            correctionAt: new Date()
          },
          warranty: 'warranty-1',
          createdAt: new Date()
        },
        {
          user: { email: 'owner@example.com', name: 'Owner' },
          warranty: { _id: 'warranty-1', productName: 'H2R Racing Helmet' }
        }
      );

      assert.strictEqual(result.success, true);
      assert.ok(logged.some((line) => line.includes('owner@example.com')));
    } finally {
      console.log = originalLog;
    }
  });

  test('refuses to dispatch when the account has no email address', async () => {
    const result = await dispatchNotificationEmail(
      { type: 'SECURITY_CORRECTION', details: {} },
      { user: {}, warranty: { _id: 'warranty-1' } }
    );

    assert.strictEqual(result.success, false);
    assert.match(result.error, /email address/i);
  });

  test('records successful delivery without duplicating the notification', async () => {
    let saves = 0;
    const notification = {
      emailAttempts: 0,
      save: async () => {
        saves++;
      }
    };

    await applyDeliveryResult(notification, { success: true, id: 'provider-1' });

    assert.strictEqual(notification.emailStatus, 'sent');
    assert.strictEqual(notification.sentEmail, true);
    assert.strictEqual(notification.emailProviderId, 'provider-1');
    assert.strictEqual(notification.emailAttempts, 1);
    assert.strictEqual(saves, 1);
  });

  test('retains a retryable failed state when the provider rejects delivery', async () => {
    const notification = {
      emailAttempts: 2,
      save: async () => {}
    };

    await applyDeliveryResult(notification, {
      success: false,
      error: 'temporary provider outage'
    });

    assert.strictEqual(notification.emailStatus, 'failed');
    assert.strictEqual(notification.sentEmail, false);
    assert.strictEqual(notification.emailError, 'temporary provider outage');
    assert.strictEqual(notification.emailAttempts, 3);
  });
});

describe('Email provider configuration honesty', () => {
  test('returns a clear failure instead of pretending delivery works when Resend is unset', async () => {
    process.env.NODE_ENV = 'production';
    delete process.env.RESEND_API_KEY;

    const result = await sendEmail({
      toEmail: 'owner@example.com',
      subject: 'Test',
      html: '<p>Test</p>'
    });

    assert.strictEqual(result.success, false);
    assert.match(result.error, /not configured/i);
  });
});
