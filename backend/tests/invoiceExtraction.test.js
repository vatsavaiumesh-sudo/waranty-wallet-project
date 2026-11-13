import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import zlib from 'zlib';
import { fileURLToPath } from 'url';
import {
  extractTextFromPdfBuffer,
  extractInvoice,
  parseInvoiceText,
  parseDateToken
} from '../services/invoiceExtractionService.js';

const SAMPLE_PDF_PATH = fileURLToPath(
  new URL('./fixtures/sample_warranty_wallet_invoice.pdf', import.meta.url)
);

const escapePdfText = (value) =>
  String(value).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');

/**
 * Minimal ASCII85 encoder used only to build compressed test PDFs.
 */
const ascii85Encode = (buffer) => {
  let output = '';
  for (let index = 0; index < buffer.length; index += 4) {
    const chunk = buffer.subarray(index, index + 4);
    const padded = Buffer.alloc(4);
    chunk.copy(padded);

    let value = padded.readUInt32BE(0);
    const digits = [];
    for (let position = 0; position < 5; position++) {
      digits.unshift(value % 85);
      value = Math.floor(value / 85);
    }

    const encoded = digits.map((digit) => String.fromCharCode(digit + 33)).join('');
    output += encoded.slice(0, chunk.length + 1);
  }
  return `${output}~>`;
};

const buildPdf = ({ contentStream, dictionary = '', ascii85 = false }) => {
  let stream;
  if (ascii85) {
    const compressed = zlib.deflateSync(Buffer.from(contentStream, 'latin1'));
    stream = Buffer.from(ascii85Encode(compressed), 'latin1');
  } else {
    stream = Buffer.from(contentStream, 'latin1');
  }

  return Buffer.from(
    [
      '%PDF-1.4',
      '1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj',
      '2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj',
      '3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj',
      `4 0 obj << /Length ${stream.length}${dictionary} >>`,
      'stream',
      stream.toString('latin1'),
      'endstream',
      'endobj',
      '5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj',
      'trailer << /Root 1 0 R /Size 6 >>',
      '%%EOF',
      ''
    ].join('\n'),
    'latin1'
  );
};

/**
 * Build a small but structurally valid PDF that stores text in an uncompressed
 * content stream. This exercises the local extractor without any external
 * service or binary dependency.
 */
const buildTextPdf = (lines) => {
  const contentLines = ['BT', '/F1 12 Tf', '72 720 Td'];
  lines.forEach((line, index) => {
    if (index > 0) contentLines.push('0 -16 Td');
    contentLines.push(`(${escapePdfText(line)}) Tj`);
  });
  contentLines.push('ET');
  return buildPdf({ contentStream: contentLines.join('\n') });
};

const buildCompressedTextPdf = (lines) => {
  const contentLines = ['BT', '/F1 12 Tf', '72 720 Td'];
  lines.forEach((line, index) => {
    if (index > 0) contentLines.push('0 -16 Td');
    contentLines.push(`(${escapePdfText(line)}) Tj`);
  });
  contentLines.push('ET');
  return buildPdf({
    contentStream: contentLines.join('\n'),
    dictionary: ' /Filter [ /ASCII85Decode /FlateDecode ]',
    ascii85: true
  });
};

const SAMPLE_INVOICE_LINES = [
  'Tax Invoice',
  'Seller: Speed Motors Pvt Ltd',
  'Invoice Number: INV-2026-0042',
  'Invoice Date: 12-10-2026',
  'Product Name: H2R Racing Helmet',
  'Brand: Example Brand',
  'Model Number: H2R-X1',
  'Serial Number: SN-99887766',
  'Warranty: 2 years from purchase',
  'Total: INR 24,999.00'
];

describe('Invoice extraction - local PDF text', () => {
  test('extracts embedded text from a text-based PDF buffer', () => {
    const pdf = buildTextPdf(SAMPLE_INVOICE_LINES);
    const result = extractTextFromPdfBuffer(pdf);

    assert.ok(result.streamCount >= 1, 'expected at least one decoded content stream');
    assert.match(result.text, /H2R Racing Helmet/);
    assert.match(result.text, /INV-2026-0042/);
    assert.match(result.text, /Example Brand/);
  });

  test('returns warnings instead of throwing for a corrupt PDF', () => {
    const result = extractTextFromPdfBuffer(Buffer.from('%PDF-1.4\nnot really a pdf', 'latin1'));
    assert.strictEqual(result.text, '');
    assert.ok(Array.isArray(result.warnings));
  });
});

describe('Invoice field parsing', () => {
  test('parses labelled invoice fields without fabricating values', () => {
    const parsed = parseInvoiceText(SAMPLE_INVOICE_LINES.join('\n'));

    assert.strictEqual(parsed.fields.productName.value, 'H2R Racing Helmet');
    assert.strictEqual(parsed.fields.brand.value, 'Example Brand');
    assert.strictEqual(parsed.fields.modelNumber.value, 'H2R-X1');
    assert.strictEqual(parsed.fields.serialNumber.value, 'SN-99887766');
    assert.strictEqual(parsed.fields.invoiceNumber.value, 'INV-2026-0042');
    assert.strictEqual(parsed.fields.store.value, 'Speed Motors Pvt Ltd');
    assert.strictEqual(parsed.fields.purchaseDate.value, '2026-10-12');
    assert.strictEqual(parsed.fields.price.value, 24999);
    assert.strictEqual(parsed.fields.currency.value, 'INR');
    assert.strictEqual(parsed.fields.warrantyDuration.value, 2);
    assert.strictEqual(parsed.fields.warrantyUnit.value, 'Years');

    // Every extracted value still requires user review.
    for (const field of Object.values(parsed.fields)) {
      assert.strictEqual(field.status, 'needs_review');
    }
  });

  test('leaves missing fields missing rather than inventing values', () => {
    const parsed = parseInvoiceText('Tax Invoice\nProduct Name: Desk Lamp\nTotal: $40.00');

    assert.strictEqual(parsed.fields.productName.value, 'Desk Lamp');
    assert.strictEqual(parsed.fields.warrantyDuration, undefined);
    assert.strictEqual(parsed.fields.brand, undefined);
    assert.strictEqual(parsed.fields.serialNumber, undefined);
    assert.ok(parsed.missingFields.includes('warrantyDuration'));
    assert.ok(parsed.missingFields.includes('brand'));
    assert.ok(parsed.missingFields.includes('serialNumber'));
  });

  test('flags ambiguous day/month dates and interprets them as day-first', () => {
    const parsed = parseInvoiceText('Invoice Date: 05/06/2026\nProduct Name: Router');
    assert.strictEqual(parsed.fields.purchaseDate.value, '2026-06-05');
    assert.ok(parsed.warnings.some((warning) => warning.includes('ambiguous')));
  });

  test('warns when the invoice appears to contain multiple products', () => {
    const parsed = parseInvoiceText(
      [
        'Product Name: First Product',
        'Qty 1 Item Description Unit Price',
        'Qty 2 Item Description Unit Price',
        'Qty 3 Item Description Unit Price'
      ].join('\n')
    );

    assert.ok(parsed.warnings.some((warning) => warning.includes('multiple item lines')));
  });

  test('parses common date token formats deterministically', () => {
    assert.strictEqual(parseDateToken('2026-10-12').value, '2026-10-12');
    assert.strictEqual(parseDateToken('12 Oct 2026').value, '2026-10-12');
    assert.strictEqual(parseDateToken('Oct 12, 2026').value, '2026-10-12');
    assert.strictEqual(parseDateToken('31/12/2026').value, '2026-12-31');
    assert.strictEqual(parseDateToken('not a date').value, null);
  });
});

describe('Invoice extraction orchestration', () => {
  test('extracts the full text PDF through extractInvoice', async () => {
    const result = await extractInvoice({
      buffer: buildTextPdf(SAMPLE_INVOICE_LINES),
      mimetype: 'application/pdf',
      originalName: 'invoice.pdf'
    });

    assert.strictEqual(result.provider, 'local-pdf-text');
    assert.strictEqual(result.method, 'embedded-text');
    assert.ok(['success', 'partial'].includes(result.status));
    assert.strictEqual(result.fields.productName.value, 'H2R Racing Helmet');
    assert.ok(result.textLength > 20);
  });

  test('reports provider_unavailable for images when OCR is not configured', async () => {
    const previousKey = process.env.GOOGLE_VISION_API_KEY;
    delete process.env.GOOGLE_VISION_API_KEY;

    try {
      const result = await extractInvoice({
        buffer: Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x01]),
        mimetype: 'image/jpeg',
        originalName: 'receipt.jpg'
      });

      assert.strictEqual(result.status, 'provider_unavailable');
      assert.ok(result.warnings.some((warning) => warning.includes('GOOGLE_VISION_API_KEY')));
      assert.deepStrictEqual(result.fields, {});
      assert.ok(result.missingFields.includes('productName'));
    } finally {
      if (previousKey !== undefined) process.env.GOOGLE_VISION_API_KEY = previousKey;
    }
  });

  test('marks unreadable input as failed without throwing', async () => {
    const result = await extractInvoice({
      buffer: Buffer.from('this is not an invoice', 'utf8'),
      mimetype: 'application/pdf',
      originalName: 'broken.pdf'
    });

    assert.ok(['failed', 'provider_unavailable'].includes(result.status));
    assert.deepStrictEqual(result.fields, {});
  });
});

describe('Invoice extraction - compressed PDF streams', () => {
  test('decodes ASCII85 + FlateDecode content streams', () => {
    const pdf = buildCompressedTextPdf(SAMPLE_INVOICE_LINES);
    const result = extractTextFromPdfBuffer(pdf);

    assert.ok(result.streamCount >= 1, 'expected at least one decoded content stream');
    assert.match(result.text, /H2R Racing Helmet/);
    assert.strictEqual(
      result.warnings.some((warning) => /compressed PDF stream/.test(warning)),
      false
    );
  });
});

describe('Invoice extraction - exact sample invoice', () => {
  test('extracts the expected fields from the sample warranty invoice PDF', async () => {
    const buffer = fs.readFileSync(SAMPLE_PDF_PATH);
    const original = Buffer.from(buffer);

    const result = await extractInvoice({
      buffer,
      mimetype: 'application/pdf',
      originalName: 'sample_warranty_wallet_invoice.pdf'
    });

    assert.strictEqual(result.provider, 'local-pdf-text');
    assert.strictEqual(result.method, 'embedded-text');
    assert.ok(buffer.equals(original), 'extraction must not modify the original bytes');
    assert.strictEqual(
      result.warnings.some((warning) => /compressed PDF stream/.test(warning)),
      false
    );

    assert.strictEqual(result.fields.productName.value, 'Dell Inspiron 15 Laptop');
    assert.strictEqual(result.fields.modelNumber.value, 'Inspiron 3530');
    assert.strictEqual(result.fields.serialNumber.value, 'SAMPLE-SN-2026-001');
    assert.strictEqual(result.fields.invoiceNumber.value, 'TZ-2026-10482');
    assert.strictEqual(result.fields.store.value, 'TechZone Electronics');
    assert.strictEqual(result.fields.purchaseDate.value, '2026-11-10');
    assert.strictEqual(result.fields.price.value, 55990);
    assert.strictEqual(result.fields.currency.value, 'INR');
    assert.strictEqual(result.fields.warrantyDuration.value, 1);
    assert.strictEqual(result.fields.warrantyUnit.value, 'Years');
    assert.strictEqual(result.fields.warrantyStartDate.value, '2026-11-10');

    // Missing values stay missing rather than being guessed.
    assert.strictEqual(result.fields.brand, undefined);
    assert.strictEqual(result.fields.warrantyEndDate, undefined);
    assert.ok(result.missingFields.includes('brand'));
    assert.ok(result.missingFields.includes('warrantyEndDate'));

    for (const extracted of Object.values(result.fields)) {
      assert.doesNotMatch(String(extracted.value), /[\u0000-\u001f\u007f]/);
    }
  });
});

describe('Invoice extraction - corrupted text rejection', () => {
  test('rejects garbled PDF text instead of returning a corrupted product name', async () => {
    const garbage = 'f/[c4oS>!dSaKPKU0ZGf[?8==E;^#!;#hm Fa\'Zl@A"d:9\u0001\u0002\u0003';
    const pdf = buildTextPdf([
      'Tax Invoice',
      `Product Name: ${garbage}`,
      'Total: USD 99.00'
    ]);

    const result = await extractInvoice({
      buffer: pdf,
      mimetype: 'application/pdf',
      originalName: 'garbled.pdf'
    });

    assert.strictEqual(result.fields.productName, undefined);
    for (const extracted of Object.values(result.fields)) {
      assert.doesNotMatch(String(extracted.value), /[\u0000-\u001f\u007f]/);
    }
  });

  test('does not invent fields from binary-only text', () => {
    const parsed = parseInvoiceText(
      '\u0001\u0002f/[c4oS>!dSaKPKU0ZGf[?8==E;^#!;#hm\u0003\u0004'
    );

    assert.deepStrictEqual(parsed.fields, {});
    assert.ok(parsed.missingFields.includes('productName'));
    assert.ok(parsed.missingFields.includes('invoiceNumber'));
  });
});

describe('Invoice currency recognition', () => {
  test('recognises INR codes, symbols, and words', () => {
    const cases = [
      ['Total: INR 999.00', 'INR'],
      ['Total: ₹ 1,299.00', 'INR'],
      ['Total: Rs. 2,499.00', 'INR'],
      ['Amount in words: Rupees Two Thousand Only', 'INR'],
      ['Total: $40.00', 'USD'],
      ['Total: €40.00', 'EUR']
    ];

    for (const [line, expected] of cases) {
      const parsed = parseInvoiceText(`Product Name: Test Item\n${line}`);
      assert.strictEqual(parsed.fields.currency.value, expected, line);
    }
  });
});

describe('Invoice extraction - optional OCR provider', () => {
  test('uses the configured OCR provider through a mocked fetch call', async () => {
    const previousKey = process.env.GOOGLE_VISION_API_KEY;
    const previousFetch = globalThis.fetch;
    process.env.GOOGLE_VISION_API_KEY = 'test-key';
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        responses: [
          {
            fullTextAnnotation: {
              text: 'Product Name: OCR Camera\nInvoice Number: OCR-7788\nTotal: INR 1,500.00'
            }
          }
        ]
      })
    });

    try {
      const result = await extractInvoice({
        buffer: Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x01]),
        mimetype: 'image/jpeg',
        originalName: 'receipt.jpg'
      });

      assert.strictEqual(result.provider, 'google-cloud-vision');
      assert.strictEqual(result.method, 'ocr');
      assert.strictEqual(result.fields.productName.value, 'OCR Camera');
      assert.strictEqual(result.fields.invoiceNumber.value, 'OCR-7788');
      assert.strictEqual(result.fields.currency.value, 'INR');
    } finally {
      globalThis.fetch = previousFetch;
      if (previousKey === undefined) delete process.env.GOOGLE_VISION_API_KEY;
      else process.env.GOOGLE_VISION_API_KEY = previousKey;
    }
  });
});
