import http from 'http';
import https from 'https';
import { URL } from 'url';
import { storeFile } from './storageService.js';
import {
  computeBufferChecksum,
  detectFileSignature
} from '../utils/fileUtils.js';

export const PRODUCT_IMAGE_MAX_BYTES = 5 * 1024 * 1024;

const ALLOWED_IMAGE_MIME_TYPES = Object.freeze(['image/jpeg', 'image/png', 'image/webp']);

const normalizeMimeType = (contentType) => {
  const normalized = String(contentType || '')
    .split(';')[0]
    .trim()
    .toLowerCase();
  return normalized === 'image/jpg' ? 'image/jpeg' : normalized;
};

const signatureForMime = (mimeType) => {
  if (mimeType === 'image/jpeg') return 'jpg';
  if (mimeType === 'image/png') return 'png';
  if (mimeType === 'image/webp') return 'webp';
  return 'unknown';
};

/**
 * Read a fetch response body while enforcing the maximum image size. This avoids
 * buffering an arbitrarily large response before the size check.
 */
const readResponseBufferWithLimit = async (response, maxBytes) => {
  if (!response.body || typeof response.body.getReader !== 'function') {
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > maxBytes) {
      throw new Error(`Image exceeds maximum allowed size of ${Math.round(maxBytes / (1024 * 1024))}MB`);
    }
    return buffer;
  }

  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
    total += chunk.length;
    if (total > maxBytes) {
      try {
        await reader.cancel();
      } catch {
        // Best-effort cancellation only.
      }
      throw new Error(`Image exceeds maximum allowed size of ${Math.round(maxBytes / (1024 * 1024))}MB`);
    }
    chunks.push(chunk);
  }

  return Buffer.concat(chunks);
};

/**
 * Verify hostname is safe and not resolving to private/internal networks (SSRF prevention)
 * @param {string} hostname
 * @returns {boolean}
 */
export const isSafePublicHostname = (hostname) => {
  if (!hostname) return false;
  const lower = hostname.toLowerCase();

  // Block localhost and standard loopback identifiers
  if (
    lower === 'localhost' ||
    lower.endsWith('.localhost') ||
    lower.endsWith('.local') ||
    lower.endsWith('.internal')
  ) {
    return false;
  }

  // Check IPv4 private and link-local ranges
  const ipv4Match = lower.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4Match) {
    const [_, oct1, oct2] = ipv4Match.map(Number);
    if (oct1 === 127) return false; // 127.0.0.0/8 Loopback
    if (oct1 === 10) return false; // 10.0.0.0/8 Private
    if (oct1 === 169 && oct2 === 254) return false; // 169.254.0.0/16 Link-local / Cloud metadata
    if (oct1 === 192 && oct2 === 168) return false; // 192.168.0.0/16 Private
    if (oct1 === 172 && oct2 >= 16 && oct2 <= 31) return false; // 172.16.0.0/12 Private
    if (oct1 === 0) return false; // 0.0.0.0/8
  }

  // Block IPv6 loopback
  if (lower === '::1' || lower === '[::1]' || lower.startsWith('fe80:')) {
    return false;
  }

  return true;
};

/**
 * Searches for high-quality product images online using legitimate public APIs.
 * Supports Wikimedia Commons API (zero-config, CC open product license) and Unsplash API (if configured).
 * 
 * @param {string} query - Product name / model to search
 * @returns {Promise<Array<{ id: string, title: string, thumbnailUrl: string, imageUrl: string, source: string }>>}
 */
/**
 * Allow only the approved image hosts used by the configured image providers.
 * This prevents downloading from arbitrary user-supplied image URLs.
 * @param {string} hostname
 * @returns {boolean}
 */
export const isApprovedImageHost = (hostname) => {
  if (!hostname) return false;
  const lower = hostname.toLowerCase();
  const approvedSuffixes = ['.wikimedia.org', '.unsplash.com'];
  return (
    lower === 'upload.wikimedia.org' ||
    lower === 'images.unsplash.com' ||
    approvedSuffixes.some((suffix) => lower.endsWith(suffix))
  );
};

export const searchProductImages = async (query) => {
  if (!query || query.trim().length < 2) {
    return [];
  }

  const cleanQuery = query.trim().slice(0, 100);

  // 1. If custom Unsplash API key configured in environment
  if (process.env.UNSPLASH_ACCESS_KEY) {
    try {
      const unsplashUrl = `https://api.unsplash.com/search/photos?query=${encodeURIComponent(
        cleanQuery
      )}&per_page=6&orientation=squarish`;
      const res = await fetch(unsplashUrl, {
        headers: {
          Authorization: `Client-ID ${process.env.UNSPLASH_ACCESS_KEY}`
        },
        signal: AbortSignal.timeout(6000)
      });
      if (res.ok) {
        const data = await res.json();
        if (data.results && data.results.length > 0) {
          return data.results.map((item) => ({
            id: String(item.id),
            title: item.alt_description || item.description || cleanQuery,
            thumbnailUrl: item.urls.small || item.urls.thumb,
            imageUrl: item.urls.regular || item.urls.small,
            source: 'Unsplash'
          }));
        }
      }
    } catch (err) {
      console.warn('Unsplash API search error, falling back to public registry:', err.message);
    }
  }

  // 2. Default Zero-Config: Wikimedia Commons public product image registry
  try {
    const wikiUrl = `https://en.wikipedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(
      cleanQuery
    )}&gsrlimit=8&prop=pageimages&piprop=thumbnail|original&pithumbsize=600&format=json&origin=*`;

    const res = await fetch(wikiUrl, {
      headers: {
        'User-Agent': 'WarrantyWalletApp/2.0 (product-image-assistant)'
      },
      signal: AbortSignal.timeout(6000)
    });

    if (!res.ok) {
      return [];
    }

    const data = await res.json();
    if (!data.query || !data.query.pages) {
      return [];
    }

    const results = [];
    for (const pageId of Object.keys(data.query.pages)) {
      const page = data.query.pages[pageId];
      if (page.thumbnail && page.thumbnail.source) {
        const thumbUrl = page.thumbnail.source;
        // Skip common icons, flags, and SVGs
        if (
          !thumbUrl.includes('.svg.') &&
          !thumbUrl.includes('Flag_of') &&
          !thumbUrl.includes('Logo')
        ) {
          results.push({
            id: String(page.pageid),
            title: page.title || cleanQuery,
            thumbnailUrl: thumbUrl,
            imageUrl: page.original?.source || thumbUrl,
            source: 'Wikimedia'
          });
        }
      }
    }

    return results.slice(0, 6);
  } catch (error) {
    console.error('Online image search error:', error.message);
    return [];
  }
};

/**
 * Downloads a validated online image and copies it into application persistent storage.
 * Strictly verifies SSRF protection, allowed protocols, MIME types, magic bytes, and size <= 5MB.
 *
 * @param {string} remoteUrl - The chosen image URL
 * @param {string} userId - Authenticated user ID
 * @param {Object} [options]
 * @param {boolean} [options.allowAnyPublicHost] - Repair-script only: allow a legacy
 *   public image host after SSRF checks. User-facing selections still require an
 *   approved provider host.
 * @returns {Promise<{ key: string, url: string, isCloud: boolean, provider: string, mimeType: string, size: number, checksum: string, sourceUrl: string }>}
 */
export const downloadAndStoreRemoteImage = async (
  remoteUrl,
  userId,
  { allowAnyPublicHost = false } = {}
) => {
  if (!remoteUrl) {
    throw new Error('Image URL is required');
  }

  let parsed;
  try {
    parsed = new URL(remoteUrl);
  } catch {
    throw new Error('Invalid image URL.');
  }

  // Enforce HTTPS / HTTP protocols
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('Disallowed protocol. Only HTTP and HTTPS are permitted.');
  }

  // SSRF Protection check
  if (!isSafePublicHostname(parsed.hostname)) {
    throw new Error('Invalid or restricted destination hostname.');
  }

  // Restrict user-facing downloads to approved image hosts returned by
  // configured providers. The repair script may opt into any public host.
  if (!allowAnyPublicHost && !isApprovedImageHost(parsed.hostname)) {
    throw new Error('Image host is not approved for download.');
  }

  const response = await fetch(remoteUrl, {
    headers: {
      'User-Agent': 'WarrantyWalletApp/2.0 (image-downloader)'
    },
    signal: AbortSignal.timeout(25000),
    redirect: 'error'
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch image from source (HTTP ${response.status})`);
  }

  const contentType = normalizeMimeType(response.headers.get('content-type'));

  if (!ALLOWED_IMAGE_MIME_TYPES.includes(contentType)) {
    throw new Error(
      `Invalid content type "${contentType || 'unknown'}". Only JPEG, PNG, and WEBP images are accepted.`
    );
  }

  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > PRODUCT_IMAGE_MAX_BYTES) {
    throw new Error(
      `Image exceeds maximum allowed size of ${Math.round(PRODUCT_IMAGE_MAX_BYTES / (1024 * 1024))}MB`
    );
  }

  const buffer = await readResponseBufferWithLimit(response, PRODUCT_IMAGE_MAX_BYTES);
  if (!buffer.length) {
    throw new Error('Downloaded image is empty.');
  }

  // Browser/provider content types are not trusted on their own. Verify the
  // actual bytes so an SVG or HTML response cannot be stored as a JPEG.
  const detected = detectFileSignature(buffer);
  const expected = signatureForMime(contentType);
  if (detected !== expected) {
    throw new Error(
      `Image content does not match its declared type "${contentType}".`
    );
  }

  const extMap = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp'
  };

  const ext = extMap[contentType];
  const simulatedFile = {
    originalname: `online-product-${Date.now()}${ext}`,
    buffer,
    mimetype: contentType,
    fieldname: 'productImage',
    size: buffer.length
  };

  const stored = await storeFile(simulatedFile, 'images', userId);

  return {
    ...stored,
    mimeType: contentType,
    size: buffer.length,
    checksum: computeBufferChecksum(buffer),
    sourceUrl: remoteUrl
  };
};
