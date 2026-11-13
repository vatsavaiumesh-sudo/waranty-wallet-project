import fs from 'fs';
import { storeFile, readStoredFile } from './storageService.js';
import { extractInvoice } from './invoiceExtractionService.js';
import {
  computeFileChecksum,
  computeBufferChecksum,
  sanitizeOriginalName
} from '../utils/fileUtils.js';

/**
 * Store an invoice and capture immutable evidence metadata.
 *
 * Ordering matters: the checksum is computed before storage because the
 * storage layer may move or remove Multer's temporary file. Extraction runs on
 * the same original bytes. A failed OCR/extraction never prevents the file from
 * being stored; it only affects the review suggestions.
 *
 * @param {Object} file - Multer file
 * @param {string} userId
 * @returns {Promise<Object>} evidence metadata
 */
export const processAndStoreInvoice = async (file, userId) => {
  if (!file) throw new Error('Invoice file is required');

  const buffer = file.buffer || fs.readFileSync(file.path);
  const checksum = computeFileChecksum({ buffer });
  const originalName = sanitizeOriginalName(file.originalname);

  let extraction;
  try {
    extraction = await extractInvoice({
      buffer,
      mimetype: file.mimetype,
      originalName
    });
  } catch (error) {
    extraction = {
      provider: 'none',
      method: 'none',
      status: 'failed',
      extractedAt: new Date(),
      textLength: 0,
      fields: {},
      missingFields: [],
      warnings: [`Invoice extraction failed: ${error.message}`]
    };
  }

  const stored = await storeFile(file, 'invoices', userId);
  const foundFields = extraction.fields ? Object.keys(extraction.fields).length : 0;

  return {
    originalName,
    mimeType: file.mimetype,
    size: file.size || buffer.length,
    checksum,
    storageUrl: stored.url,
    storageKey: stored.key,
    isCloud: Boolean(stored.isCloud),
    uploadedAt: new Date(),
    uploadedBy: userId,
    status: foundFields > 0 ? 'extracted' : 'stored',
    extraction,
    versions: []
  };
};

/**
 * Copy a pending draft's evidence metadata onto a warranty without re-uploading.
 */
export const buildInvoiceFromDraft = (draft) => ({
  originalName: draft.originalName,
  mimeType: draft.mimeType,
  size: draft.size,
  checksum: draft.checksum,
  storageUrl: draft.storageUrl,
  storageKey: draft.storageKey,
  isCloud: draft.isCloud,
  uploadedAt: draft.createdAt || new Date(),
  uploadedBy: draft.user,
  status: 'confirmed',
  extraction:
    draft.extraction || {
      provider: 'none',
      method: 'none',
      status: 'not_attempted',
      extractedAt: null,
      textLength: 0,
      fields: {},
      missingFields: [],
      warnings: []
    },
  versions: []
});

/**
 * Verify that the stored bytes still match the sha256 captured at upload.
 * @param {Object} warranty
 * @returns {Promise<Object>}
 */
export const verifyInvoiceIntegrity = async (warranty) => {
  let invoice = warranty?.invoice;

  // A removed invoice retains its latest evidence version in history.
  if (invoice?.status === 'removed' && Array.isArray(invoice.versions) && invoice.versions.length) {
    invoice = invoice.versions[invoice.versions.length - 1];
  }

  const fileRef = invoice?.storageUrl || warranty?.invoiceFile;

  if (!fileRef) {
    return {
      available: false,
      verified: false,
      message: 'No invoice evidence is available for this warranty.'
    };
  }

  if (!invoice?.checksum) {
    return {
      available: true,
      verified: null,
      message:
        'This invoice was uploaded before checksum tracking was introduced. Its original checksum is unavailable, so integrity cannot be verified.'
    };
  }

  const buffer = await readStoredFile(fileRef);
  const computedChecksum = computeBufferChecksum(buffer);

  return {
    available: true,
    verified: computedChecksum === invoice.checksum,
    storedChecksum: invoice.checksum,
    computedChecksum,
    size: buffer.length,
    message:
      computedChecksum === invoice.checksum
        ? 'The stored invoice matches the checksum recorded at upload.'
        : 'The stored invoice no longer matches the recorded checksum. Preserve a copy and investigate before relying on it.'
  };
};
