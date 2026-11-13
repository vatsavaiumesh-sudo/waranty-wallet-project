import { storeFile } from './storageService.js';
import { downloadAndStoreRemoteImage } from './productImageSearchService.js';

/**
 * Product image persistence helpers.
 *
 * A product image is only considered durable when it lives in persistent cloud
 * storage (Cloudinary, S3, or Cloudflare R2). A local `/uploads/...` reference is
 * still a valid stored image for development/test, but it is not durable across
 * production restarts or redeploys.
 */

export const PRODUCT_IMAGE_MAX_BYTES = 5 * 1024 * 1024;

const configuredPublicHosts = () =>
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
 * Whether a URL points at an application-managed durable image store.
 * External provider URLs (for example an Unsplash temporary URL) are not
 * durable and must be downloaded and re-uploaded before being stored.
 *
 * @param {string} url
 * @returns {boolean}
 */
export const isDurableProductImageUrl = (url) => {
  if (!url || typeof url !== 'string') return false;

  if (url.startsWith('cloudinary://') || url.startsWith('cloud://')) {
    return true;
  }

  if (!/^https?:\/\//i.test(url)) return false;

  try {
    const hostname = new URL(url).hostname.toLowerCase();
    if (hostname === 'res.cloudinary.com' || hostname.endsWith('.cloudinary.com')) {
      return true;
    }
    if (hostname.endsWith('.r2.dev') || hostname.endsWith('.amazonaws.com')) {
      return true;
    }
    return configuredPublicHosts().includes(hostname);
  } catch {
    return false;
  }
};

/**
 * Whether the image is stored on the backend local disk. This is acceptable for
 * local development and isolated test mode, but is not a production durability
 * guarantee.
 *
 * @param {string} url
 * @returns {boolean}
 */
export const isLocallyStoredProductImage = (url) =>
  typeof url === 'string' && url.startsWith('/uploads/');

/**
 * A persisted image is either durable cloud storage or local test/development
 * storage. It is safe to render without re-downloading.
 *
 * @param {string} url
 * @returns {boolean}
 */
export const isPersistedProductImage = (url) =>
  isDurableProductImageUrl(url) || isLocallyStoredProductImage(url);

/**
 * Normalize storage-service output into the metadata stored on a warranty.
 *
 * @param {Object} stored - result from storeFile/downloadAndStoreRemoteImage
 * @param {Object} options
 * @returns {Object}
 */
export const buildProductImageMeta = (
  stored,
  { sourceUrl = '', uploadedBy = null, uploadedAt = new Date() } = {}
) => {
  if (!stored || !stored.url) return null;

  const isCloud = Boolean(stored.isCloud);
  const provider = stored.provider || (isCloud ? 's3' : 'local');
  const status = isCloud
    ? 'persisted'
    : provider === 'local'
      ? 'local'
      : isDurableProductImageUrl(stored.url)
        ? 'persisted'
        : 'legacy_external';

  return {
    storageUrl: stored.url,
    storageKey: stored.key || '',
    provider,
    isCloud,
    mimeType: stored.mimeType || '',
    size: Number(stored.size) || 0,
    checksum: stored.checksum || '',
    sourceUrl: sourceUrl || stored.sourceUrl || '',
    uploadedBy: uploadedBy || null,
    uploadedAt,
    status
  };
};

/**
 * Decide what to do with a product image during an update.
 *
 * This deliberately keeps the existing image when the request does not ask for
 * a change, and it does not re-upload an image that is already persisted and
 * unchanged.
 *
 * @param {Object} options
 * @param {string} options.existingUrl
 * @param {boolean} options.hasUpload
 * @param {string} options.onlineUrl
 * @param {boolean} options.removeRequested
 * @returns {{action: 'keep'|'replace'|'remove', reason: string}}
 */
export const planProductImageChange = ({
  existingUrl = '',
  hasUpload = false,
  onlineUrl = '',
  removeRequested = false
} = {}) => {
  if (removeRequested) {
    return { action: 'remove', reason: 'remove_requested' };
  }

  if (hasUpload) {
    return { action: 'replace', reason: 'manual_upload' };
  }

  const requested = typeof onlineUrl === 'string' ? onlineUrl.trim() : '';

  if (!requested) {
    return { action: 'keep', reason: 'no_change' };
  }

  // The client may echo back the currently stored URL. Never re-download or
  // duplicate an image that is already persisted for this record.
  if (existingUrl && requested === existingUrl) {
    return { action: 'keep', reason: 'same_image' };
  }

  return { action: 'replace', reason: 'online_selection' };
};

/**
 * Persist a manually uploaded file or a selected remote image.
 *
 * Failures are returned as structured results so callers can keep the existing
 * warranty image and still save the rest of the record.
 *
 * @param {Object} options
 * @param {Object} [options.file] - Multer file object
 * @param {string} [options.remoteUrl] - Selected online image URL
 * @param {string} options.userId - Authenticated owner ID
 * @param {boolean} [options.allowAnyPublicHost] - Repair-script only
 * @param {Object} [deps] - Injectable storage functions for tests
 * @returns {Promise<{ok: boolean, url?: string, meta?: Object, error?: string}>}
 */
export const persistProductImage = async (
  { file = null, remoteUrl = '', userId, allowAnyPublicHost = false } = {},
  deps = {}
) => {
  const store = deps.storeFile || storeFile;
  const download = deps.downloadAndStoreRemoteImage || downloadAndStoreRemoteImage;

  if (file) {
    try {
      const stored = await store(file, 'images', userId);
      if (!stored || !stored.url) {
        return { ok: false, error: 'Image storage did not return a URL.' };
      }
      return {
        ok: true,
        url: stored.url,
        meta: buildProductImageMeta(stored, { uploadedBy: userId })
      };
    } catch (error) {
      return { ok: false, error: error.message || 'Image upload failed.' };
    }
  }

  if (remoteUrl) {
    try {
      const stored = await download(remoteUrl, userId, { allowAnyPublicHost });
      if (!stored || !stored.url) {
        return { ok: false, error: 'Image storage did not return a URL.' };
      }
      return {
        ok: true,
        url: stored.url,
        meta: buildProductImageMeta(stored, {
          sourceUrl: remoteUrl,
          uploadedBy: userId
        })
      };
    } catch (error) {
      return { ok: false, error: error.message || 'Image download failed.' };
    }
  }

  return { ok: true, url: '', meta: null };
};
