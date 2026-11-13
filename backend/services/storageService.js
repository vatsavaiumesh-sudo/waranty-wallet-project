import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { v2 as cloudinary } from 'cloudinary';
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { computeFileChecksum } from '../utils/fileUtils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const localUploadsDir = path.join(__dirname, '../uploads');

// Ensure local uploads directory exists for fallback
if (!fs.existsSync(localUploadsDir)) {
  fs.mkdirSync(localUploadsDir, { recursive: true });
}

/**
 * Template values from the environment examples must never be treated as real
 * credentials. Otherwise the AWS SDK falls back to its default AWS endpoint
 * with an invalid key instead of using the local storage fallback.
 */
const isPlaceholderStorageCredential = (value) => {
  const normalized = String(value || '').trim();
  if (!normalized) return true;
  return (
    /^(your[_-]|replace[_-]?with|changeme|placeholder)/i.test(normalized) ||
    /^<[^>]+>$/.test(normalized) ||
    normalized.toLowerCase() === 'you will have.'
  );
};

/**
 * Check if cloud S3/R2 storage is fully configured via environment variables
 */
export const isCloudStorageConfigured = () => {
  const bucket = process.env.S3_BUCKET || process.env.R2_BUCKET;
  const accessKey = process.env.S3_ACCESS_KEY_ID || process.env.R2_ACCESS_KEY_ID;
  const secretKey = process.env.S3_SECRET_ACCESS_KEY || process.env.R2_SECRET_ACCESS_KEY;
  return Boolean(
    bucket &&
      !isPlaceholderStorageCredential(accessKey) &&
      !isPlaceholderStorageCredential(secretKey)
  );
};

/**
 * Create S3 client instance
 */
let s3ClientInstance = null;
const getS3Client = () => {
  if (s3ClientInstance) return s3ClientInstance;

  const endpoint = process.env.S3_ENDPOINT || process.env.R2_ENDPOINT;
  const accessKeyId = process.env.S3_ACCESS_KEY_ID || process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY || process.env.R2_SECRET_ACCESS_KEY;
  const region = process.env.S3_REGION || process.env.R2_REGION || 'auto';

  s3ClientInstance = new S3Client({
    region,
    ...(endpoint ? { endpoint } : {}),
    credentials: {
      accessKeyId,
      secretAccessKey
    }
  });

  return s3ClientInstance;
};

const getBucketName = () => process.env.S3_BUCKET || process.env.R2_BUCKET || '';

/**
 * Determine whether Cloudinary is configured from server-side environment variables.
 */
export const isCloudinaryConfigured = () => {
  return Boolean(
    process.env.CLOUDINARY_CLOUD_NAME &&
      process.env.CLOUDINARY_API_KEY &&
      process.env.CLOUDINARY_API_SECRET
  );
};

/**
 * Isolated test runs must never reach a real cloud bucket, even when realistic
 * credentials happen to be present in the environment.
 */
export const isTestStorageMode = () => process.env.USE_TEST_DATABASE === 'true';

/**
 * Images need either Cloudinary or S3/R2 to be durable in production.
 */
export const isPersistentImageStorageConfigured = () =>
  isCloudinaryConfigured() || isCloudStorageConfigured();

/**
 * Configuration status without exposing any credential values. Used by the
 * reminder/repair scripts to report setup honestly.
 */
export const getStorageProviderStatus = () => ({
  cloudinary: isCloudinaryConfigured(),
  s3OrR2: isCloudStorageConfigured(),
  persistentImageStorage: isPersistentImageStorageConfigured(),
  testDatabaseMode: isTestStorageMode()
});

const configuredPublicHostnames = () =>
  [process.env.S3_PUBLIC_DOMAIN, process.env.R2_PUBLIC_DOMAIN]
    .filter(Boolean)
    .map((value) => {
      try {
        return new URL(value).hostname.toLowerCase();
      } catch {
        return '';
      }
    })
    .filter(Boolean);

/**
 * Derive the S3/R2 object key from a stored reference. Public storage URLs are
 * supported so deletion and signing operate on the object key, not the full URL.
 *
 * @param {string} fileRef
 * @returns {string|null}
 */
export const getS3KeyFromFileRef = (fileRef) => {
  if (!fileRef || typeof fileRef !== 'string') return null;

  if (fileRef.startsWith('cloud://')) {
    return fileRef.slice('cloud://'.length) || null;
  }

  if (!/^https?:\/\//i.test(fileRef)) return null;

  try {
    const url = new URL(fileRef);
    const hostname = url.hostname.toLowerCase();
    const knownHost =
      configuredPublicHostnames().includes(hostname) ||
      hostname.endsWith('.r2.dev') ||
      hostname.endsWith('.amazonaws.com');

    if (!knownHost) return null;

    const key = decodeURIComponent(url.pathname.replace(/^\/+/, ''));
    return key || null;
  } catch {
    return null;
  }
};

/**
 * Whether a reference belongs to a storage backend this application manages.
 * External third-party URLs must never be deleted from, or used as an S3 key.
 *
 * @param {string} fileRef
 * @returns {boolean}
 */
export const isRecognizedStoredFileRef = (fileRef) => {
  if (!fileRef || typeof fileRef !== 'string') return false;
  if (fileRef.startsWith('/uploads/') || fileRef.startsWith('cloud://')) return true;
  if (getCloudinaryPublicId(fileRef)) return true;
  return Boolean(getS3KeyFromFileRef(fileRef));
};

const getStoredFileSize = (file) => {
  if (!file) return 0;
  if (typeof file.size === 'number' && Number.isFinite(file.size)) return file.size;
  if (file.buffer) return file.buffer.length;
  if (file.path) {
    try {
      return fs.statSync(file.path).size;
    } catch {
      return 0;
    }
  }
  return 0;
};

const getStoredFileChecksum = (file) => {
  try {
    return computeFileChecksum(file);
  } catch {
    return '';
  }
};

const buildStorageMetadata = (file, stored) => ({
  ...stored,
  mimeType: file?.mimetype || '',
  size: getStoredFileSize(file),
  checksum: getStoredFileChecksum(file),
  originalName: file?.originalname || ''
});

/**
 * Encapsulated Cloudinary operations so tests can substitute mock implementations.
 */
export const cloudinaryClient = {
  configured: isCloudinaryConfigured,
  configure() {
    if (!isCloudinaryConfigured()) return false;
    cloudinary.config({
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      api_key: process.env.CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_API_SECRET,
      secure: true
    });
    return true;
  },
  async upload(file, options = {}) {
    this.configure();
    const uploadOptions = {
      resource_type: 'image',
      unique_filename: true,
      overwrite: false,
      invalidate: true,
      ...options
    };

    let source = file.path;
    if (!source && file.buffer) {
      const dataUri = `data:${file.mimetype || 'application/octet-stream'};base64,${file.buffer.toString('base64')}`;
      source = dataUri;
    }

    if (!source) {
      throw new Error('File source is required for Cloudinary upload');
    }

    return await cloudinary.uploader.upload(source, uploadOptions);
  },
  async destroy(publicId) {
    this.configure();
    return await cloudinary.uploader.destroy(publicId, {
      resource_type: 'image',
      invalidate: true
    });
  }
};

export const getCloudinaryPublicId = (fileRef) => {
  if (!fileRef) return null;

  if (fileRef.startsWith('cloudinary://')) {
    return fileRef.slice('cloudinary://'.length) || null;
  }

  if (!/^https?:\/\//i.test(fileRef)) {
    return null;
  }

  try {
    const url = new URL(fileRef);
    if (!url.hostname.includes('res.cloudinary.com')) return null;
    const parts = url.pathname.split('/').filter(Boolean);
    const uploadIndex = parts.indexOf('upload');
    if (uploadIndex === -1) return null;
    const afterUpload = parts.slice(uploadIndex + 1);
    const withoutVersion =
      afterUpload.length && /^v\d+$/.test(afterUpload[0])
        ? afterUpload.slice(1)
        : afterUpload;
    const withExtension = withoutVersion.join('/');
    return withExtension.replace(/\.[^/.]+$/, '') || null;
  } catch {
    return null;
  }
};

export const isImageFolder = (folder) => {
  const value = String(folder || '').toLowerCase();
  return value !== 'invoices' && value !== 'invoice' && value !== 'documents';
};

/**
 * Generate a safe, sanitized, unique storage key
 */
export const generateUniqueKey = (folder, originalname, userId) => {
  const ext = path.extname(originalname).toLowerCase();
  const safeRandom = crypto.randomBytes(8).toString('hex');
  const userPrefix = userId ? String(userId) : 'general';
  return `${folder}/${userPrefix}/${Date.now()}-${safeRandom}${ext}`;
};

/**
 * Upload a file to cloud storage or local disk fallback
 * @param {Object} file - Multer file object
 * @param {string} folder - Destination folder ('images' or 'invoices')
 * @param {string} userId - User ID
 * @returns {Promise<{ key: string, url: string, isCloud: boolean }>}
 */
export const storeFile = async (file, folder = 'uploads', userId = '') => {
  if (!file) return null;

  // Isolated browser-testing runs use local disk only. This prevents a test
  // upload from reaching a real bucket even if cloud credentials are present.
  // Checked before Cloudinary so image uploads are isolated too.
  const testDatabaseMode = isTestStorageMode();

  // Cloudinary is used only for images. Invoices/private docs remain on the
  // existing storage path (S3/R2/local fallback).
  if (!testDatabaseMode && isImageFolder(folder) && isCloudinaryConfigured()) {
    const fileExt = path.extname(file.originalname || '').toLowerCase();
    const allowedImageExts = ['.jpg', '.jpeg', '.png', '.webp'];
    if (!allowedImageExts.includes(fileExt)) {
      throw new Error(`File type ${fileExt} is not supported. Allowed: JPG, PNG, WEBP`);
    }

    const safeBase = String(path.basename(file.originalname || 'image', fileExt))
      .replace(/[^a-zA-Z0-9_-]/g, '_')
      .slice(0, 40);
    const publicId = `${crypto.randomBytes(8).toString('hex')}${safeBase ? '-' + safeBase : ''}`;
    const uploadFolder = [process.env.CLOUDINARY_UPLOAD_FOLDER || 'warranty-wallet', folder, String(userId || 'general')]
      .filter(Boolean)
      .join('/');

    try {
      const uploaded = await cloudinaryClient.upload(file, {
        public_id: publicId,
        folder: uploadFolder
      });

      return buildStorageMetadata(file, {
        key: uploaded.public_id,
        url: uploaded.secure_url,
        isCloud: true,
        provider: 'cloudinary'
      });
    } finally {
      // Multer may store a temporary file; remove it whether upload succeeds or fails.
      if (file.path && fs.existsSync(file.path)) {
        try {
          fs.unlinkSync(file.path);
        } catch (e) {
          console.error('Failed to remove temp upload file:', e);
        }
      }
    }
  }

  const fileExt = path.extname(file.originalname).toLowerCase();
  const allowedExts = ['.jpg', '.jpeg', '.png', '.webp', '.pdf'];
  if (!allowedExts.includes(fileExt)) {
    throw new Error(`File type ${fileExt} is not supported. Allowed: JPG, PNG, WEBP, PDF`);
  }

  // If Cloud Storage is configured, upload to S3 / Cloudflare R2
  if (!testDatabaseMode && isCloudStorageConfigured()) {
    const s3 = getS3Client();
    const bucket = getBucketName();
    const objectKey = generateUniqueKey(folder, file.originalname, userId);

    // Read buffer whether multer used disk or memory
    const fileBuffer = file.buffer || fs.readFileSync(file.path);

    // Public URL or cloud reference
    const publicDomain = process.env.S3_PUBLIC_DOMAIN || process.env.R2_PUBLIC_DOMAIN;
    const url = publicDomain ? `${publicDomain.replace(/\/$/, '')}/${objectKey}` : `cloud://${objectKey}`;

    // Capture metadata before the temporary upload file is cleaned up.
    const storageMetadata = buildStorageMetadata(file, {
      key: objectKey,
      url,
      isCloud: true,
      provider: process.env.R2_BUCKET ? 'r2' : 's3'
    });

    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: objectKey,
      Body: fileBuffer,
      ContentType: file.mimetype,
      Metadata: {
        originalName: encodeURIComponent(file.originalname),
        uploadedBy: String(userId || 'system')
      }
    });

    try {
      await s3.send(command);
    } finally {
      // If multer created a temporary file on disk, clean it up even on failure.
      if (file.path && fs.existsSync(file.path)) {
        try {
          fs.unlinkSync(file.path);
        } catch (e) {
          console.error('Failed to remove temp upload file:', e);
        }
      }
    }

    return storageMetadata;
  }

  // Local fallback is acceptable for development and isolated tests, but it is
  // not durable across production restarts/redeploys. Report that honestly.
  if (isImageFolder(folder) && process.env.NODE_ENV === 'production' && !testDatabaseMode) {
    console.warn(
      'Product image stored on local disk because no persistent image storage is configured. ' +
        'Configure Cloudinary or S3/R2 for durable product images.'
    );
  }

  // Fallback: Store on local disk (if Multer already stored to disk, use that path)
  if (file.path) {
    const relativePath = `/uploads/${path.basename(file.path)}`;
    return buildStorageMetadata(file, {
      key: path.basename(file.path),
      url: relativePath,
      isCloud: false,
      provider: 'local'
    });
  }

  // If buffer only in local fallback
  const uniqueName = `${file.fieldname}-${Date.now()}-${Math.round(Math.random() * 1e9)}${fileExt}`;
  const destPath = path.join(localUploadsDir, uniqueName);
  fs.writeFileSync(destPath, file.buffer);

  return buildStorageMetadata(file, {
    key: uniqueName,
    url: `/uploads/${uniqueName}`,
    isCloud: false,
    provider: 'local'
  });
};

/**
 * Delete a file safely from cloud storage or local disk.
 *
 * External third-party URLs (for example a legacy image URL) are intentionally
 * left untouched. Only references that belong to a storage backend managed by
 * this application are deleted.
 */
export const deleteStoredFile = async (fileRef) => {
  if (!fileRef || !isRecognizedStoredFileRef(fileRef)) return;

  const testMode = isTestStorageMode();
  const cloudinaryPublicId = getCloudinaryPublicId(fileRef);

  if (cloudinaryPublicId && !testMode && isCloudinaryConfigured()) {
    try {
      await cloudinaryClient.destroy(cloudinaryPublicId);
    } catch (error) {
      console.error(`Error deleting Cloudinary file ${fileRef}:`, error.message);
    }
    return;
  }

  try {
    // Local file fallback
    if (fileRef.startsWith('/uploads/')) {
      const filename = path.basename(fileRef);
      const fullPath = path.join(localUploadsDir, filename);
      if (fs.existsSync(fullPath)) {
        fs.unlink(fullPath, (err) => {
          if (err) console.error(`Error deleting local file ${fullPath}:`, err.message);
        });
      }
      return;
    }

    // S3 / R2 object reference or public storage URL.
    const key = getS3KeyFromFileRef(fileRef);
    if (key && !testMode && isCloudStorageConfigured()) {
      const s3 = getS3Client();
      await s3.send(
        new DeleteObjectCommand({
          Bucket: getBucketName(),
          Key: key
        })
      );
    }
  } catch (error) {
    console.error(`Error deleting file ${fileRef}:`, error.message);
  }
};

const streamToBuffer = async (body) => {
  if (!body) return Buffer.alloc(0);
  if (typeof body.transformToByteArray === 'function') {
    return Buffer.from(await body.transformToByteArray());
  }
  const chunks = [];
  for await (const chunk of body) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
};

/**
 * Read the exact stored bytes for integrity verification.
 * Only local uploads, configured S3/R2 objects, or known storage provider
 * domains are allowed. This value comes from the database, not from a request
 * parameter, but the host allow-list keeps verification from becoming an SSRF
 * primitive if a record is ever tampered with.
 *
 * @param {string} fileRef
 * @returns {Promise<Buffer>}
 */
export const readStoredFile = async (fileRef) => {
  if (!fileRef) throw new Error('File reference is required');

  if (fileRef.startsWith('/uploads/')) {
    const fullPath = path.join(localUploadsDir, path.basename(fileRef));
    if (!fs.existsSync(fullPath)) throw new Error('Stored file was not found on disk');
    return fs.readFileSync(fullPath);
  }

  const cloudKey = getS3KeyFromFileRef(fileRef);
  if (cloudKey && isCloudStorageConfigured()) {
    const s3 = getS3Client();
    const response = await s3.send(
      new GetObjectCommand({ Bucket: getBucketName(), Key: cloudKey })
    );
    return streamToBuffer(response.Body);
  }

  if (!fileRef.startsWith('http') && isCloudStorageConfigured()) {
    const s3 = getS3Client();
    const key = fileRef.replace(/^cloud:\/\//, '');
    const response = await s3.send(
      new GetObjectCommand({ Bucket: getBucketName(), Key: key })
    );
    return streamToBuffer(response.Body);
  }

  if (/^https?:\/\//i.test(fileRef)) {
    const url = new URL(fileRef);
    const allowedHosts = [
      process.env.S3_PUBLIC_DOMAIN,
      process.env.R2_PUBLIC_DOMAIN
    ]
      .filter(Boolean)
      .map((value) => {
        try {
          return new URL(value).hostname.toLowerCase();
        } catch {
          return '';
        }
      })
      .filter(Boolean);

    const hostname = url.hostname.toLowerCase();
    const isKnownStorageHost =
      allowedHosts.includes(hostname) ||
      hostname === 'res.cloudinary.com' ||
      hostname.endsWith('.r2.dev') ||
      hostname.endsWith('.amazonaws.com');

    if (!isKnownStorageHost) {
      throw new Error('Stored file host is not approved for integrity verification');
    }

    const response = await fetch(fileRef, {
      signal: AbortSignal.timeout(20000),
      redirect: 'error'
    });
    if (!response.ok) {
      throw new Error(`Unable to download stored file (HTTP ${response.status})`);
    }
    return Buffer.from(await response.arrayBuffer());
  }

  throw new Error('Unsupported storage reference');
};

/**
 * Generate a short-lived presigned URL (15 minutes) for private documents (e.g. invoices)
 */
export const getSignedFileUrl = async (fileRef, expiresInSeconds = 900) => {
  if (!fileRef) return '';

  const cloudKey = getS3KeyFromFileRef(fileRef);
  if (cloudKey && isCloudStorageConfigured()) {
    const s3 = getS3Client();
    const command = new GetObjectCommand({
      Bucket: getBucketName(),
      Key: cloudKey
    });

    return await getSignedUrl(s3, command, { expiresIn: expiresInSeconds });
  }

  if (!fileRef.startsWith('http') && !fileRef.startsWith('/uploads/') && isCloudStorageConfigured()) {
    const s3 = getS3Client();
    const bucket = getBucketName();
    const key = fileRef.replace(/^cloud:\/\//, '');

    const command = new GetObjectCommand({
      Bucket: bucket,
      Key: key
    });

    return await getSignedUrl(s3, command, { expiresIn: expiresInSeconds });
  }

  // Local fallback: returns standard static url
  return fileRef;
};
