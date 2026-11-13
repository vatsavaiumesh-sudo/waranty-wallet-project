import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  computeFileChecksum,
  computeBufferChecksum,
  detectFileSignature,
  validateFileSignature,
  sanitizeOriginalName
} from '../utils/fileUtils.js';
import {
  processAndStoreInvoice,
  buildInvoiceFromDraft,
  verifyInvoiceIntegrity
} from '../services/invoiceEvidenceService.js';

const uploadsDir = fileURLToPath(new URL('../uploads/', import.meta.url));
const cleanup = [];

const writeUpload = (name, buffer) => {
  fs.mkdirSync(uploadsDir, { recursive: true });
  const fullPath = path.join(uploadsDir, name);
  fs.writeFileSync(fullPath, buffer);
  cleanup.push(fullPath);
  return fullPath;
};

afterEach(() => {
  while (cleanup.length) {
    const target = cleanup.pop();
    try {
      if (fs.existsSync(target)) fs.unlinkSync(target);
    } catch {
      // Best-effort test cleanup only.
    }
  }
});

const PDF_BYTES = Buffer.from('%PDF-1.4\n1 0 obj <<>> endobj\n%%EOF\n', 'latin1');
const JPG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
const PNG_BYTES = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00
]);

describe('Invoice integrity - checksums and file signatures', () => {
  test('SHA-256 checksum is identical whether read from a buffer or disk', () => {
    const fullPath = writeUpload('integrity-checksum.pdf', PDF_BYTES);
    const fromBuffer = computeFileChecksum({ buffer: PDF_BYTES });
    const fromDisk = computeFileChecksum({ path: fullPath });

    assert.strictEqual(fromBuffer.length, 64);
    assert.strictEqual(fromBuffer, fromDisk);
    assert.strictEqual(fromBuffer, computeBufferChecksum(PDF_BYTES));
  });

  test('a changed file produces a different checksum', () => {
    const original = computeBufferChecksum(Buffer.from('original invoice'));
    const tampered = computeBufferChecksum(Buffer.from('original invoice '));
    assert.notStrictEqual(original, tampered);
  });

  test('detects real file types from magic bytes', () => {
    assert.strictEqual(detectFileSignature(PDF_BYTES), 'pdf');
    assert.strictEqual(detectFileSignature(JPG_BYTES), 'jpg');
    assert.strictEqual(detectFileSignature(PNG_BYTES), 'png');
    assert.strictEqual(detectFileSignature(Buffer.from('plain text')), 'unknown');
  });

  test('rejects a file whose content does not match its extension', () => {
    const fakePdf = writeUpload('fake.pdf', Buffer.from('this is not a pdf'));
    const result = validateFileSignature({ path: fakePdf, originalname: 'fake.pdf' });

    assert.strictEqual(result.valid, false);
    assert.strictEqual(result.detected, 'unknown');
  });

  test('rejects unsupported extensions and accepts genuine documents', () => {
    const exe = writeUpload('payload.exe', Buffer.from('MZ binary'));
    assert.strictEqual(
      validateFileSignature({ path: exe, originalname: 'payload.exe' }).valid,
      false
    );

    const realPdf = writeUpload('real.pdf', PDF_BYTES);
    assert.strictEqual(
      validateFileSignature({ path: realPdf, originalname: 'real.pdf' }).valid,
      true
    );
  });

  test('sanitizes malicious original filenames to prevent path traversal', () => {
    const sanitized = sanitizeOriginalName('../../etc/passwd<>:"|?*.pdf');
    assert.strictEqual(sanitized.includes('..'), false);
    assert.strictEqual(sanitized.includes('/'), false);
    assert.strictEqual(sanitized.includes('\\'), false);
    assert.ok(sanitized.endsWith('.pdf'));
  });
});

describe('Invoice integrity - evidence records', () => {
  test('processAndStoreInvoice captures checksum, metadata, and extraction status', async () => {
    const stored = await processAndStoreInvoice(
      {
        buffer: PDF_BYTES,
        originalname: 'My Invoice.pdf',
        mimetype: 'application/pdf',
        size: PDF_BYTES.length
      },
      'test-user-id'
    );

    assert.strictEqual(stored.originalName, 'My Invoice.pdf');
    assert.strictEqual(stored.mimeType, 'application/pdf');
    assert.strictEqual(stored.size, PDF_BYTES.length);
    assert.strictEqual(stored.checksum, computeBufferChecksum(PDF_BYTES));
    assert.strictEqual(stored.uploadedBy, 'test-user-id');
    assert.ok(stored.uploadedAt instanceof Date);
    assert.ok(stored.storageUrl.startsWith('/uploads/'));
    assert.strictEqual(stored.extraction.provider, 'none');

    const filename = path.basename(stored.storageUrl);
    cleanup.push(path.join(uploadsDir, filename));
  });

  test('buildInvoiceFromDraft copies the draft evidence without re-uploading', () => {
    const evidence = buildInvoiceFromDraft({
      originalName: 'receipt.pdf',
      mimeType: 'application/pdf',
      size: 1234,
      checksum: 'abc123',
      storageUrl: '/uploads/receipt.pdf',
      storageKey: 'receipt.pdf',
      isCloud: false,
      createdAt: new Date('2026-01-02T00:00:00.000Z'),
      user: 'user-1',
      extraction: { status: 'partial', fields: {} }
    });

    assert.strictEqual(evidence.checksum, 'abc123');
    assert.strictEqual(evidence.status, 'confirmed');
    assert.strictEqual(evidence.uploadedBy, 'user-1');
    assert.strictEqual(evidence.uploadedAt.toISOString(), '2026-01-02T00:00:00.000Z');
  });

  test('verifies a stored invoice and detects a modified file', async () => {
    const bytes = Buffer.from('%PDF-1.4\ninvoice evidence\n%%EOF\n', 'latin1');
    const fullPath = writeUpload('verify-me.pdf', bytes);
    const checksum = computeBufferChecksum(bytes);

    const warranty = {
      invoice: { checksum, storageUrl: '/uploads/verify-me.pdf', status: 'stored' }
    };

    const intact = await verifyInvoiceIntegrity(warranty);
    assert.strictEqual(intact.available, true);
    assert.strictEqual(intact.verified, true);

    fs.writeFileSync(fullPath, Buffer.concat([bytes, Buffer.from('tampered')]));
    const modified = await verifyInvoiceIntegrity(warranty);
    assert.strictEqual(modified.verified, false);
    assert.notStrictEqual(modified.computedChecksum, modified.storedChecksum);
  });

  test('reports unavailable integrity verification for legacy invoices without a checksum', async () => {
    const result = await verifyInvoiceIntegrity({
      invoiceFile: '/uploads/legacy-invoice.pdf'
    });

    assert.strictEqual(result.available, true);
    assert.strictEqual(result.verified, null);
    assert.match(result.message, /checksum is unavailable/i);
  });

  test('uses the latest preserved version when the invoice is marked removed', async () => {
    const bytes = Buffer.from('%PDF-1.4\nremoved evidence\n%%EOF\n', 'latin1');
    writeUpload('removed-version.pdf', bytes);
    const checksum = computeBufferChecksum(bytes);

    const result = await verifyInvoiceIntegrity({
      invoice: {
        status: 'removed',
        checksum: '',
        storageUrl: '',
        versions: [
          {
            checksum,
            storageUrl: '/uploads/removed-version.pdf',
            originalName: 'removed-version.pdf'
          }
        ]
      }
    });

    assert.strictEqual(result.verified, true);
    assert.strictEqual(result.storedChecksum, checksum);
  });
});

describe('Invoice integrity - extraction failure', () => {
  test('keeps the original invoice bytes and checksum when text extraction fails', async () => {
    const previousKey = process.env.GOOGLE_VISION_API_KEY;
    delete process.env.GOOGLE_VISION_API_KEY;

    try {
      const bytes = Buffer.from(
        '%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\n%%EOF\n',
        'latin1'
      );

      const stored = await processAndStoreInvoice(
        {
          buffer: bytes,
          originalname: 'scanned-invoice.pdf',
          mimetype: 'application/pdf',
          size: bytes.length
        },
        'test-user-id'
      );

      assert.strictEqual(stored.checksum, computeBufferChecksum(bytes));
      assert.strictEqual(stored.status, 'stored');
      assert.deepStrictEqual(stored.extraction.fields, {});
      assert.ok(['failed', 'provider_unavailable'].includes(stored.extraction.status));
      assert.ok(stored.storageUrl.startsWith('/uploads/'));

      const storedPath = path.join(uploadsDir, path.basename(stored.storageUrl));
      cleanup.push(storedPath);
      assert.ok(fs.existsSync(storedPath), 'original invoice must still be stored');
      assert.ok(fs.readFileSync(storedPath).equals(bytes), 'stored bytes must be unchanged');

      const integrity = await verifyInvoiceIntegrity({
        invoice: {
          checksum: stored.checksum,
          storageUrl: stored.storageUrl,
          status: 'stored'
        }
      });
      assert.strictEqual(integrity.available, true);
      assert.strictEqual(integrity.verified, true);
    } finally {
      if (previousKey === undefined) delete process.env.GOOGLE_VISION_API_KEY;
      else process.env.GOOGLE_VISION_API_KEY = previousKey;
    }
  });
});
