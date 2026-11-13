import { test, describe, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { S3Client } from '@aws-sdk/client-s3';
import {
  generateUniqueKey,
  isCloudStorageConfigured,
  storeFile
} from '../services/storageService.js';

const uploadsDir = fileURLToPath(new URL('../uploads/', import.meta.url));

const STORAGE_ENV_KEYS = [
  'S3_BUCKET',
  'S3_ACCESS_KEY_ID',
  'S3_SECRET_ACCESS_KEY',
  'S3_REGION',
  'S3_ENDPOINT',
  'S3_PUBLIC_DOMAIN',
  'R2_BUCKET',
  'R2_ACCESS_KEY_ID',
  'R2_SECRET_ACCESS_KEY',
  'R2_REGION',
  'R2_ENDPOINT',
  'R2_PUBLIC_DOMAIN',
  'USE_TEST_DATABASE'
];

let previousEnv;
let cleanupPaths;

const clearStorageEnvironment = () => {
  for (const key of STORAGE_ENV_KEYS) delete process.env[key];
};

const pdfFile = () => ({
  originalname: 'sample_warranty_wallet_invoice.pdf',
  buffer: Buffer.from('%PDF-1.4 test data'),
  mimetype: 'application/pdf',
  fieldname: 'invoiceFile'
});

const rememberLocalUpload = (stored) => {
  cleanupPaths.push(path.join(uploadsDir, path.basename(stored.url)));
};

beforeEach(() => {
  previousEnv = Object.fromEntries(STORAGE_ENV_KEYS.map((key) => [key, process.env[key]]));
  cleanupPaths = [];
  clearStorageEnvironment();
  mock.restoreAll();
});

afterEach(() => {
  mock.restoreAll();

  for (const key of STORAGE_ENV_KEYS) {
    if (previousEnv[key] === undefined) delete process.env[key];
    else process.env[key] = previousEnv[key];
  }

  while (cleanupPaths.length) {
    const target = cleanupPaths.pop();
    try {
      if (fs.existsSync(target)) fs.unlinkSync(target);
    } catch {
      // Best-effort test cleanup only.
    }
  }
});

describe('Persistent Storage Service', () => {
  test('generateUniqueKey generates clean paths scoped to folder and user ID', () => {
    const userId = 'user_abc123';
    const key = generateUniqueKey('invoices', 'receipt_march.pdf', userId);

    assert.ok(key.startsWith('invoices/user_abc123/'));
    assert.ok(key.endsWith('.pdf'));
    // Ensure random bytes included for collision prevention
    assert.ok(key.length > 30);
  });

  test('generateUniqueKey falls back safely when user ID is null or empty', () => {
    const key = generateUniqueKey('images', 'laptop.png', null);
    assert.ok(key.startsWith('images/general/'));
    assert.ok(key.endsWith('.png'));
  });

  test('storeFile rejects dangerous or disallowed file extensions', async () => {
    const maliciousFile = {
      originalname: 'exploit.exe',
      buffer: Buffer.from('fake data'),
      mimetype: 'application/octet-stream'
    };

    await assert.rejects(
      async () => {
        await storeFile(maliciousFile, 'invoices', '123');
      },
      {
        message: /File type .exe is not supported/
      }
    );
  });

  test('storeFile safely accepts supported files (jpg, png, pdf, webp)', async () => {
    const validFile = {
      originalname: 'invoice.pdf',
      buffer: Buffer.from('%PDF-1.4 test data'),
      mimetype: 'application/pdf',
      fieldname: 'invoiceFile'
    };

    const stored = await storeFile(validFile, 'invoices', 'user_test_99');
    assert.ok(stored);
    assert.ok(typeof stored.url === 'string');
    assert.ok(typeof stored.key === 'string');
    assert.strictEqual(stored.isCloud, false);
    rememberLocalUpload(stored);
  });
});

describe('Cloud storage provider selection', () => {
  test('template placeholder credentials are not treated as configured cloud storage', async () => {
    process.env.S3_BUCKET = 'warranty-wallet-uploads';
    process.env.S3_ACCESS_KEY_ID = 'your_storage_access_key_id';
    process.env.S3_SECRET_ACCESS_KEY = 'your_storage_secret_access_key';
    process.env.S3_REGION = 'us-east-1';

    const send = mock.method(S3Client.prototype, 'send', async () => {
      throw new Error('S3 must not be called for placeholder credentials');
    });

    assert.strictEqual(isCloudStorageConfigured(), false);

    const stored = await storeFile(pdfFile(), 'invoices', 'user_placeholder_test');
    rememberLocalUpload(stored);

    assert.strictEqual(stored.isCloud, false);
    assert.match(stored.url, /^\/uploads\//);
    assert.strictEqual(send.mock.callCount(), 0);
  });

  test('test database mode keeps invoice uploads local even with realistic cloud credentials', async () => {
    process.env.USE_TEST_DATABASE = 'true';
    process.env.S3_BUCKET = 'warranty-wallet-test-bucket';
    process.env.S3_ACCESS_KEY_ID = 'AKIATESTONLYEXAMPLE';
    process.env.S3_SECRET_ACCESS_KEY = 'test-only-secret-value';
    process.env.S3_REGION = 'us-east-1';
    process.env.S3_ENDPOINT = 'http://127.0.0.1:1';

    const send = mock.method(S3Client.prototype, 'send', async () => {
      throw new Error('S3 must not be called in test database mode');
    });

    assert.strictEqual(isCloudStorageConfigured(), true);

    const stored = await storeFile(pdfFile(), 'invoices', 'user_test_db');
    rememberLocalUpload(stored);

    assert.strictEqual(stored.isCloud, false);
    assert.match(stored.url, /^\/uploads\//);
    assert.strictEqual(send.mock.callCount(), 0);
  });

  test('normal development still uploads to configured S3/R2 storage', async () => {
    delete process.env.USE_TEST_DATABASE;
    process.env.S3_BUCKET = 'warranty-wallet-test-bucket';
    process.env.S3_ACCESS_KEY_ID = 'AKIATESTONLYEXAMPLE';
    process.env.S3_SECRET_ACCESS_KEY = 'test-only-secret-value';
    process.env.S3_REGION = 'us-east-1';
    // A local endpoint is used so the test cannot reach a real provider even if
    // the mocked transport is ever bypassed.
    process.env.S3_ENDPOINT = 'http://127.0.0.1:1';

    const send = mock.method(S3Client.prototype, 'send', async () => ({}));

    const stored = await storeFile(pdfFile(), 'invoices', 'user_cloud_test');

    assert.strictEqual(stored.isCloud, true);
    assert.match(stored.key, /^invoices\/user_cloud_test\//);
    assert.strictEqual(stored.url, `cloud://${stored.key}`);
    assert.strictEqual(send.mock.callCount(), 1);
    assert.strictEqual(send.mock.calls[0].arguments[0].input.Bucket, 'warranty-wallet-test-bucket');
  });
});
