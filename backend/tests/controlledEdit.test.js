import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeSensitiveChanges,
  findProtectedBodyFields,
  validateCorrectionReason,
  securityReminderInterval,
  fieldLabel,
  MIN_CORRECTION_REASON_LENGTH
} from '../utils/controlledEditHelpers.js';
import { isInvoiceBacked, decorateWarranty } from '../utils/warrantyHelpers.js';

describe('Controlled editing - field classification', () => {
  test('detects a changed sensitive field with old and new values', () => {
    const warranty = {
      productName: 'H2R Racing Helmet',
      brand: 'Example Brand',
      purchaseDate: new Date('2026-10-12T00:00:00.000Z'),
      price: 100,
      warrantyDuration: 24,
      warrantyUnit: 'Months'
    };

    const changes = computeSensitiveChanges(warranty, {
      productName: 'Pagani',
      brand: 'Example Brand',
      purchaseDate: '2026-10-12',
      price: '100',
      warrantyDuration: 24,
      warrantyUnit: 'Months'
    });

    assert.strictEqual(changes.length, 1);
    assert.strictEqual(changes[0].field, 'productName');
    assert.strictEqual(changes[0].previousValue, 'H2R Racing Helmet');
    assert.strictEqual(changes[0].newValue, 'Pagani');
  });

  test('treats normalized equal dates and numbers as unchanged', () => {
    const warranty = {
      purchaseDate: new Date('2026-10-12T00:00:00.000Z'),
      price: 24999,
      warrantyDuration: 2
    };

    const changes = computeSensitiveChanges(warranty, {
      purchaseDate: '2026-10-12',
      price: '24999.00',
      warrantyDuration: '2'
    });

    assert.deepStrictEqual(changes, []);
  });

  test('detects changes to warranty start date, unit, currency, and invoice number', () => {
    const changes = computeSensitiveChanges(
      {
        warrantyStartDate: new Date('2026-01-01T00:00:00.000Z'),
        warrantyUnit: 'Years',
        currency: 'USD',
        invoiceNumber: 'INV-1'
      },
      {
        warrantyStartDate: '2026-02-01',
        warrantyUnit: 'Months',
        currency: 'INR',
        invoiceNumber: 'INV-2'
      }
    );

    assert.deepStrictEqual(
      changes.map((change) => change.field).sort(),
      ['currency', 'invoiceNumber', 'warrantyStartDate', 'warrantyUnit'].sort()
    );
  });

  test('rejects server-managed and invoice metadata fields in ordinary updates', () => {
    const protectedFields = findProtectedBodyFields({
      productName: 'Legitimate field',
      invoiceFile: '/uploads/evil.pdf',
      invoice: { checksum: 'forged' },
      recordVersion: 999,
      evidenceStatus: 'confirmed',
      user: 'someone-else',
      deletedAt: null
    });

    assert.deepStrictEqual(protectedFields.sort(), [
      'deletedAt',
      'evidenceStatus',
      'invoice',
      'invoiceFile',
      'recordVersion',
      'user'
    ]);
  });

  test('allows ordinary updates when no protected fields are present', () => {
    assert.deepStrictEqual(findProtectedBodyFields({ notes: 'New note' }), []);
  });
});

describe('Controlled editing - correction reasons', () => {
  test('rejects a missing or whitespace-only reason', () => {
    assert.strictEqual(validateCorrectionReason('').valid, false);
    assert.strictEqual(validateCorrectionReason('   ').valid, false);
    assert.strictEqual(validateCorrectionReason(undefined).valid, false);
  });

  test(`rejects a reason shorter than ${MIN_CORRECTION_REASON_LENGTH} characters`, () => {
    assert.strictEqual(validateCorrectionReason('too short').valid, false);
  });

  test('accepts and trims a meaningful reason', () => {
    const result = validateCorrectionReason('  Corrected the serial number to match the invoice.  ');
    assert.strictEqual(result.valid, true);
    assert.strictEqual(result.reason, 'Corrected the serial number to match the invoice.');
  });

  test('rejects an excessively long reason', () => {
    assert.strictEqual(validateCorrectionReason('x'.repeat(501)).valid, false);
  });
});

describe('Controlled editing - evidence protection and labels', () => {
  test('treats verified invoice metadata as invoice-backed', () => {
    assert.strictEqual(
      isInvoiceBacked({ invoice: { checksum: 'abc', status: 'confirmed' } }),
      true
    );
  });

  test('treats legacy invoiceFile records as invoice-backed', () => {
    assert.strictEqual(isInvoiceBacked({ invoiceFile: '/uploads/legacy.pdf' }), true);
  });

  test('does not treat a removed invoice or empty record as invoice-backed', () => {
    assert.strictEqual(
      isInvoiceBacked({ invoice: { checksum: 'abc', status: 'removed' } }),
      false
    );
    assert.strictEqual(isInvoiceBacked({}), false);
  });

  test('security notifications get unique negative reminder intervals', () => {
    const first = securityReminderInterval(1700000000000);
    const second = securityReminderInterval(1700000000000);
    assert.ok(first < 0);
    assert.ok(second < 0);
    assert.notStrictEqual(first, second);
  });

  test('field labels are human readable', () => {
    assert.strictEqual(fieldLabel('productName'), 'Product name');
    assert.strictEqual(fieldLabel('unknownField'), 'unknownField');
  });

  test('decorated warranty exposes evidence flags and defaults legacy status', () => {
    const expiry = new Date();
    expiry.setUTCDate(expiry.getUTCDate() + 20);

    const decorated = decorateWarranty({
      productName: 'Legacy TV',
      warrantyExpiryDate: expiry,
      invoiceFile: '/uploads/legacy.pdf'
    });

    assert.strictEqual(decorated.evidenceStatus, 'legacy_unverified');
    assert.strictEqual(decorated.isInvoiceBacked, true);
    assert.strictEqual(decorated.hasOriginalInvoice, false);
    assert.strictEqual(decorated.recordVersion, 1);
  });
});
