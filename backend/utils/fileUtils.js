import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

/**
 * Compute a SHA-256 checksum over the exact uploaded bytes.
 * @param {{buffer?: Buffer, path?: string}} file - Multer file object
 * @returns {string}
 */
export const computeFileChecksum = (file) => {
  if (!file) throw new Error('File is required to compute a checksum');

  const buffer = file.buffer || (file.path ? fs.readFileSync(file.path) : null);
  if (!buffer) throw new Error('File content is not available to compute a checksum');

  return crypto.createHash('sha256').update(buffer).digest('hex');
};

export const computeBufferChecksum = (buffer) =>
  crypto.createHash('sha256').update(buffer).digest('hex');

/**
 * Detect the real file type from magic bytes.
 * @param {Buffer} buffer
 * @returns {'pdf'|'jpg'|'png'|'webp'|'unknown'}
 */
export const detectFileSignature = (buffer) => {
  if (!buffer || buffer.length < 4) return 'unknown';

  if (buffer.subarray(0, 4).toString('latin1') === '%PDF') return 'pdf';

  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'jpg';

  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return 'png';
  }

  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString('latin1') === 'RIFF' &&
    buffer.subarray(8, 12).toString('latin1') === 'WEBP'
  ) {
    return 'webp';
  }

  return 'unknown';
};

const extensionType = (filename) => {
  const ext = path.extname(filename || '').toLowerCase();
  if (ext === '.pdf') return 'pdf';
  if (ext === '.jpg' || ext === '.jpeg') return 'jpg';
  if (ext === '.png') return 'png';
  if (ext === '.webp') return 'webp';
  return 'unknown';
};

/**
 * Verify that a file's magic bytes match its extension. Browser-provided MIME
 * types and extensions are not trusted on their own.
 * @param {{path?: string, buffer?: Buffer, originalname: string}} file
 * @returns {{valid: boolean, detected: string, expected: string, message?: string}}
 */
export const validateFileSignature = (file) => {
  const expected = extensionType(file?.originalname || '');
  let buffer = file?.buffer;

  if (!buffer && file?.path && fs.existsSync(file.path)) {
    const fd = fs.openSync(file.path, 'r');
    try {
      const header = Buffer.alloc(16);
      const bytesRead = fs.readSync(fd, header, 0, 16, 0);
      buffer = header.subarray(0, bytesRead);
    } finally {
      fs.closeSync(fd);
    }
  }

  const detected = detectFileSignature(buffer);

  if (expected === 'unknown') {
    return { valid: false, detected, expected, message: 'Unsupported file extension.' };
  }

  if (detected !== expected) {
    return {
      valid: false,
      detected,
      expected,
      message: `File content does not match its extension. Expected ${expected.toUpperCase()} but detected ${detected.toUpperCase()}.`
    };
  }

  return { valid: true, detected, expected };
};

/**
 * Remove a temporary upload after validation failure.
 */
export const removeTempFile = (file) => {
  try {
    if (file?.path && fs.existsSync(file.path)) fs.unlinkSync(file.path);
  } catch (error) {
    console.error('Failed to remove rejected upload:', error.message);
  }
};

/**
 * Best-effort display filename that cannot traverse paths.
 */
export const sanitizeOriginalName = (name) =>
  path
    .basename(String(name || 'document'))
    .replace(/[\u0000-\u001f<>:"/\\|?*]/g, '_')
    .slice(0, 180);
