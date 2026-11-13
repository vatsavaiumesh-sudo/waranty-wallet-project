import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { sendEmail } from '../services/emailService.js';

const originalFetch = globalThis.fetch;
let previousNodeEnv;
let previousResendKey;
let previousUseTestDatabase;

beforeEach(() => {
  previousNodeEnv = process.env.NODE_ENV;
  previousResendKey = process.env.RESEND_API_KEY;
  previousUseTestDatabase = process.env.USE_TEST_DATABASE;
});

afterEach(() => {
  globalThis.fetch = originalFetch;

  if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = previousNodeEnv;

  if (previousResendKey === undefined) delete process.env.RESEND_API_KEY;
  else process.env.RESEND_API_KEY = previousResendKey;

  if (previousUseTestDatabase === undefined) delete process.env.USE_TEST_DATABASE;
  else process.env.USE_TEST_DATABASE = previousUseTestDatabase;
});

const message = {
  toEmail: 'owner@example.com',
  subject: 'Test isolation',
  html: '<p>Test isolation</p>'
};

describe('Email isolation in test database mode', () => {
  test('simulates delivery without calling Resend even when no provider is configured', async () => {
    process.env.NODE_ENV = 'development';
    process.env.USE_TEST_DATABASE = 'true';
    delete process.env.RESEND_API_KEY;

    let fetchCalls = 0;
    globalThis.fetch = async () => {
      fetchCalls++;
      throw new Error('Resend must not be called in test database mode');
    };

    const result = await sendEmail(message);

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.simulated, true);
    assert.match(result.id, /^sim-/);
    assert.strictEqual(fetchCalls, 0);
  });

  test('never calls Resend in test database mode even when RESEND_API_KEY is configured', async () => {
    process.env.NODE_ENV = 'development';
    process.env.USE_TEST_DATABASE = 'true';
    process.env.RESEND_API_KEY = 're_test_dummy_key_for_isolation_only';

    let fetchCalls = 0;
    globalThis.fetch = async () => {
      fetchCalls++;
      throw new Error('Resend must not be called in test database mode');
    };

    const result = await sendEmail(message);

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.simulated, true);
    assert.match(result.id, /^sim-/);
    assert.strictEqual(fetchCalls, 0);
  });

  test('normal development keeps the existing provider-not-configured behavior', async () => {
    process.env.NODE_ENV = 'development';
    delete process.env.USE_TEST_DATABASE;
    delete process.env.RESEND_API_KEY;

    const result = await sendEmail(message);

    assert.strictEqual(result.success, false);
    assert.match(result.error, /not configured/i);
    assert.strictEqual(result.simulated, undefined);
  });
});
