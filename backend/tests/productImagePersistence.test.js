import { test, describe, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';
import { S3Client } from '@aws-sdk/client-s3';

import Warranty from '../models/Warranty.js';
import {
  cloudinaryClient,
  isPersistentImageStorageConfigured,
  storeFile
} from '../services/storageService.js';
import {
  PRODUCT_IMAGE_MAX_BYTES,
  downloadAndStoreRemoteImage
} from '../services/productImageSearchService.js';
import {
  buildProductImageMeta,
  isDurableProductImageUrl,
  isLocallyStoredProductImage,
  isPersistedProductImage,
  persistProductImage,
  planProductImageChange
} from '../services/productImageService.js';

const uploadsDir = fileURLToPath(new URL('../uploads/', import.meta.url));

const MANAGED_ENV = [
  'NODE_ENV',
  'USE_TEST_DATABASE',
  'CLOUDINARY_CLOUD_NAME',
  'CLOUDINARY_API_KEY',
  'CLOUDINARY_API_SECRET',
  'CLOUDINARY_UPLOAD_FOLDER',
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
  'R2_PUBLIC_DOMAIN'
];

const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64'
);

const originalFetch = globalThis.fetch;
let previousEnv;
let cleanupPaths;

const clearStorageEnvironment = () => {
  for (const key of MANAGED_ENV) delete process.env[key];
};

const rememberLocalUpload = (url) => {
  if (url?.startsWith('/uploads/')) {
    cleanupPaths.push(path.join(uploadsDir, path.basename(url)));
  }
};

const imageFile = () => ({
  originalname: 'product.png',
  buffer: TINY_PNG,
  mimetype: 'image/png',
  fieldname: 'productImage',
  size: TINY_PNG.length
});

const mockImageResponse = (body = TINY_PNG, contentType = 'image/png', extraHeaders = {}) =>
  new Response(body, {
    status: 200,
    headers: {
      'content-type': contentType,
      ...extraHeaders
    }
  });

beforeEach(() => {
  previousEnv = Object.fromEntries(MANAGED_ENV.map((key) => [key, process.env[key]]));
  cleanupPaths = [];
  clearStorageEnvironment();
  mock.restoreAll();
  globalThis.fetch = originalFetch;
  process.env.NODE_ENV = 'test';
  process.env.USE_TEST_DATABASE = 'true';
});

afterEach(() => {
  mock.restoreAll();
  globalThis.fetch = originalFetch;

  for (const key of MANAGED_ENV) {
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

describe('Product image durability classification', () => {
  test('recognizes Cloudinary, R2, and S3 public URLs as durable', () => {
    assert.strictEqual(
      isDurableProductImageUrl(
        'https://res.cloudinary.com/demo/image/upload/v1/warranty-wallet/images/user/a.png'
      ),
      true
    );
    assert.strictEqual(
      isDurableProductImageUrl('https://pub-abc123.r2.dev/images/user/a.png'),
      true
    );
    assert.strictEqual(
      isDurableProductImageUrl('https://bucket.s3.amazonaws.com/images/user/a.png'),
      true
    );
    assert.strictEqual(isDurableProductImageUrl('cloud://images/user/a.png'), true);
  });

  test('does not treat temporary third-party image URLs as durable', () => {
    assert.strictEqual(
      isDurableProductImageUrl('https://images.unsplash.com/photo-123?w=600'),
      false
    );
    assert.strictEqual(
      isDurableProductImageUrl('https://upload.wikimedia.org/wikipedia/commons/a.png'),
      false
    );
    assert.strictEqual(isDurableProductImageUrl('/uploads/product.png'), false);
    assert.strictEqual(isDurableProductImageUrl(''), false);
  });

  test('treats local test/development uploads as persisted but not durable', () => {
    assert.strictEqual(isLocallyStoredProductImage('/uploads/product.png'), true);
    assert.strictEqual(isPersistedProductImage('/uploads/product.png'), true);
    assert.strictEqual(isDurableProductImageUrl('/uploads/product.png'), false);
    assert.strictEqual(
      isPersistedProductImage('https://images.unsplash.com/photo-123'),
      false
    );
  });

  test('builds durable metadata for cloud storage', () => {
    const meta = buildProductImageMeta(
      {
        url: 'https://res.cloudinary.com/demo/image/upload/v1/a.png',
        key: 'warranty-wallet/images/user/a',
        isCloud: true,
        provider: 'cloudinary',
        mimeType: 'image/png',
        size: 123,
        checksum: 'abc123'
      },
      { sourceUrl: 'https://upload.wikimedia.org/a.png', uploadedBy: 'user-a' }
    );

    assert.strictEqual(meta.status, 'persisted');
    assert.strictEqual(meta.isCloud, true);
    assert.strictEqual(meta.provider, 'cloudinary');
    assert.strictEqual(meta.sourceUrl, 'https://upload.wikimedia.org/a.png');
    assert.strictEqual(meta.size, 123);
  });

  test('builds local metadata without claiming cloud persistence', () => {
    const meta = buildProductImageMeta({
      url: '/uploads/product.png',
      key: 'product.png',
      isCloud: false,
      provider: 'local',
      mimeType: 'image/png',
      size: 10
    });

    assert.strictEqual(meta.status, 'local');
    assert.strictEqual(meta.isCloud, false);
  });
});

describe('Product image update planning', () => {
  test('preserves an existing image during an unrelated edit', () => {
    const plan = planProductImageChange({
      existingUrl: 'https://res.cloudinary.com/demo/a.png'
    });
    assert.deepStrictEqual(plan, { action: 'keep', reason: 'no_change' });
  });

  test('does not re-upload an unchanged persisted image', () => {
    const plan = planProductImageChange({
      existingUrl: 'https://res.cloudinary.com/demo/a.png',
      onlineUrl: 'https://res.cloudinary.com/demo/a.png'
    });
    assert.deepStrictEqual(plan, { action: 'keep', reason: 'same_image' });
  });

  test('replaces the image when a new online image is selected', () => {
    const plan = planProductImageChange({
      existingUrl: 'https://res.cloudinary.com/demo/a.png',
      onlineUrl: 'https://images.unsplash.com/photo-456'
    });
    assert.deepStrictEqual(plan, { action: 'replace', reason: 'online_selection' });
  });

  test('replaces the image for a manual upload', () => {
    const plan = planProductImageChange({
      existingUrl: '/uploads/old.png',
      hasUpload: true
    });
    assert.deepStrictEqual(plan, { action: 'replace', reason: 'manual_upload' });
  });

  test('removes the image only when explicitly requested', () => {
    const plan = planProductImageChange({
      existingUrl: '/uploads/old.png',
      removeRequested: true
    });
    assert.deepStrictEqual(plan, { action: 'remove', reason: 'remove_requested' });
  });
});

describe('Product image persistence failure handling', () => {
  test('returns a structured failure when storage throws, without a URL', async () => {
    const result = await persistProductImage(
      { file: imageFile(), userId: 'user-a' },
      {
        storeFile: async () => {
          throw new Error('storage unavailable');
        }
      }
    );

    assert.strictEqual(result.ok, false);
    assert.match(result.error, /storage unavailable/);
    assert.strictEqual(result.url, undefined);
  });

  test('returns a structured failure when the remote download throws', async () => {
    const result = await persistProductImage(
      { remoteUrl: 'https://images.unsplash.com/photo-1', userId: 'user-a' },
      {
        downloadAndStoreRemoteImage: async () => {
          throw new Error('download failed');
        }
      }
    );

    assert.strictEqual(result.ok, false);
    assert.match(result.error, /download failed/);
    assert.strictEqual(result.url, undefined);
  });

  test('returns permanent metadata when storage succeeds', async () => {
    const result = await persistProductImage(
      { remoteUrl: 'https://images.unsplash.com/photo-1', userId: 'user-a' },
      {
        downloadAndStoreRemoteImage: async () => ({
          url: 'https://res.cloudinary.com/demo/image/upload/v1/a.png',
          key: 'warranty-wallet/images/user-a/a',
          isCloud: true,
          provider: 'cloudinary',
          mimeType: 'image/png',
          size: 10,
          checksum: 'abc'
        })
      }
    );

    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.meta.status, 'persisted');
    assert.strictEqual(result.meta.isCloud, true);
  });
});

describe('Test-mode storage isolation', () => {
  test('image uploads stay local even when Cloudinary and S3 credentials are present', async () => {
    process.env.CLOUDINARY_CLOUD_NAME = 'test-cloud';
    process.env.CLOUDINARY_API_KEY = 'test-key';
    process.env.CLOUDINARY_API_SECRET = 'test-secret';
    process.env.S3_BUCKET = 'warranty-wallet-test-bucket';
    process.env.S3_ACCESS_KEY_ID = 'AKIATESTONLYEXAMPLE';
    process.env.S3_SECRET_ACCESS_KEY = 'test-only-secret-value';
    process.env.S3_REGION = 'us-east-1';

    const cloudinaryUpload = mock.method(cloudinaryClient, 'upload', async () => {
      throw new Error('Cloudinary must not be called in test database mode');
    });
    const s3Send = mock.method(S3Client.prototype, 'send', async () => {
      throw new Error('S3 must not be called in test database mode');
    });

    assert.strictEqual(isPersistentImageStorageConfigured(), true);

    const stored = await storeFile(imageFile(), 'images', 'user-test');
    rememberLocalUpload(stored.url);

    assert.strictEqual(stored.isCloud, false);
    assert.strictEqual(stored.provider, 'local');
    assert.match(stored.url, /^\/uploads\//);
    assert.strictEqual(stored.mimeType, 'image/png');
    assert.strictEqual(stored.size, TINY_PNG.length);
    assert.strictEqual(stored.checksum.length, 64);
    assert.strictEqual(cloudinaryUpload.mock.callCount(), 0);
    assert.strictEqual(s3Send.mock.callCount(), 0);
  });
});

describe('Remote image download validation', () => {
  test('downloads a valid PNG, verifies bytes, and stores it locally in test mode', async () => {
    process.env.CLOUDINARY_CLOUD_NAME = 'test-cloud';
    process.env.CLOUDINARY_API_KEY = 'test-key';
    process.env.CLOUDINARY_API_SECRET = 'test-secret';

    const cloudinaryUpload = mock.method(cloudinaryClient, 'upload', async () => {
      throw new Error('Cloudinary must not be called in test database mode');
    });
    globalThis.fetch = async () =>
      mockImageResponse(TINY_PNG, 'image/png');

    const stored = await downloadAndStoreRemoteImage(
      'https://upload.wikimedia.org/wikipedia/commons/thumb/a.png',
      'user-test'
    );
    rememberLocalUpload(stored.url);

    assert.match(stored.url, /^\/uploads\//);
    assert.strictEqual(stored.mimeType, 'image/png');
    assert.strictEqual(stored.size, TINY_PNG.length);
    assert.strictEqual(stored.checksum.length, 64);
    assert.strictEqual(
      stored.sourceUrl,
      'https://upload.wikimedia.org/wikipedia/commons/thumb/a.png'
    );
    assert.strictEqual(cloudinaryUpload.mock.callCount(), 0);
  });

  test('rejects SVG content types instead of storing them as images', async () => {
    globalThis.fetch = async () =>
      mockImageResponse('<svg xmlns="http://www.w3.org/2000/svg"></svg>', 'image/svg+xml');

    await assert.rejects(
      () =>
        downloadAndStoreRemoteImage(
          'https://upload.wikimedia.org/wikipedia/commons/a.svg',
          'user-test'
        ),
      /Invalid content type/
    );
  });

  test('rejects content whose bytes do not match the declared image type', async () => {
    globalThis.fetch = async () =>
      mockImageResponse(Buffer.from('not actually a png'), 'image/png');

    await assert.rejects(
      () =>
        downloadAndStoreRemoteImage(
          'https://upload.wikimedia.org/wikipedia/commons/a.png',
          'user-test'
        ),
      /does not match its declared type/
    );
  });

  test('rejects an image larger than the 5MB limit before downloading it', async () => {
    globalThis.fetch = async () =>
      mockImageResponse(TINY_PNG, 'image/png', {
        'content-length': String(PRODUCT_IMAGE_MAX_BYTES + 1)
      });

    await assert.rejects(
      () =>
        downloadAndStoreRemoteImage(
          'https://upload.wikimedia.org/wikipedia/commons/a.png',
          'user-test'
        ),
      /maximum allowed size/
    );
  });

  test('rejects an unapproved image host for user-facing selections', async () => {
    let fetchCalls = 0;
    globalThis.fetch = async () => {
      fetchCalls++;
      return mockImageResponse();
    };

    await assert.rejects(
      () =>
        downloadAndStoreRemoteImage(
          'https://images.example.com/product.png',
          'user-test'
        ),
      /not approved for download/
    );
    assert.strictEqual(fetchCalls, 0);
  });

  test('repair mode may download a legacy public host after SSRF checks', async () => {
    globalThis.fetch = async () => mockImageResponse(TINY_PNG, 'image/png');

    const stored = await downloadAndStoreRemoteImage(
      'https://legacy-images.example.com/product.png',
      'user-test',
      { allowAnyPublicHost: true }
    );
    rememberLocalUpload(stored.url);

    assert.match(stored.url, /^\/uploads\//);
  });

  test('repair mode still blocks private and metadata addresses', async () => {
    let fetchCalls = 0;
    globalThis.fetch = async () => {
      fetchCalls++;
      return mockImageResponse();
    };

    await assert.rejects(
      () =>
        downloadAndStoreRemoteImage('http://127.0.0.1/image.png', 'user-test', {
          allowAnyPublicHost: true
        }),
      /restricted destination hostname/
    );
    await assert.rejects(
      () =>
        downloadAndStoreRemoteImage(
          'http://169.254.169.254/latest/meta-data',
          'user-test',
          { allowAnyPublicHost: true }
        ),
      /restricted destination hostname/
    );
    assert.strictEqual(fetchCalls, 0);
  });
});

describe('Warranty image compatibility and repair safety', () => {
  test('stores product image metadata while keeping the legacy productImage field', () => {
    const warranty = new Warranty({
      user: new mongoose.Types.ObjectId(),
      productName: 'Test Product',
      category: 'Electronics',
      purchaseDate: new Date('2026-01-01T00:00:00.000Z'),
      warrantyDuration: 12,
      warrantyUnit: 'Months',
      warrantyExpiryDate: new Date('2027-01-01T00:00:00.000Z'),
      productImage: 'https://res.cloudinary.com/demo/image/upload/v1/a.png',
      productImageMeta: {
        storageUrl: 'https://res.cloudinary.com/demo/image/upload/v1/a.png',
        storageKey: 'warranty-wallet/images/user/a',
        provider: 'cloudinary',
        isCloud: true,
        mimeType: 'image/png',
        size: 10,
        checksum: 'abc',
        status: 'persisted'
      }
    });

    assert.strictEqual(warranty.validateSync(), undefined);
    assert.strictEqual(warranty.productImageMeta.status, 'persisted');
    assert.strictEqual(
      warranty.productImage,
      'https://res.cloudinary.com/demo/image/upload/v1/a.png'
    );
  });

  test('existing records without metadata still validate', () => {
    const warranty = new Warranty({
      user: new mongoose.Types.ObjectId(),
      productName: 'Legacy Product',
      category: 'Other',
      purchaseDate: new Date('2026-01-01T00:00:00.000Z'),
      warrantyDuration: 1,
      warrantyUnit: 'Years',
      warrantyExpiryDate: new Date('2027-01-01T00:00:00.000Z'),
      productImage: 'https://images.unsplash.com/photo-legacy'
    });

    assert.strictEqual(warranty.validateSync(), undefined);
    assert.strictEqual(warranty.productImageMeta, undefined);
  });

  test('repair script is dry-run by default and never deletes records or files', () => {
    const scriptPath = fileURLToPath(
      new URL('../scripts/repair-product-images.js', import.meta.url)
    );
    const content = fs.readFileSync(scriptPath, 'utf8');

    assert.ok(content.includes("!args.includes('--execute') || args.includes('--dry-run')"));
    assert.ok(content.includes('product-image-repair-map.json'));
    assert.ok(content.includes('allowAnyPublicHost: true'));
    assert.ok(!content.includes('deleteMany'));
    assert.ok(!content.includes('findByIdAndDelete'));
    assert.ok(!content.includes('fs.unlink'));
    assert.ok(content.includes('{ _id: warranty._id, productImage: originalUrl }'));
  });
});
