/**
 * Database target resolution with test-database safety guards.
 *
 * Production behavior is unchanged: when USE_TEST_DATABASE is not enabled, the
 * existing MONGODB_URI is returned untouched.
 *
 * Test behavior is opt-in only:
 *   - Set USE_TEST_DATABASE=true as a process environment variable.
 *   - Optionally provide MONGODB_URI_TEST to use a dedicated test URI.
 *   - Otherwise the configured MONGODB_URI is reused with its database name
 *     replaced by warranty_wallet_test.
 *
 * Hard guards:
 *   - Refuses to run in a production-like environment (NODE_ENV=production,
 *     Render) even if USE_TEST_DATABASE is set.
 *   - Refuses unless the resolved database name is exactly
 *     warranty_wallet_test.
 *   - Refuses the known production database name outright.
 *
 * This module never logs or returns credentials for display. Callers must only
 * report the database name and hostname.
 */

export const TEST_DATABASE_NAME = 'warranty_wallet_test';

// Known databases that must never be used by the test workflow.
export const BLOCKED_DATABASE_NAMES = Object.freeze(['warranty_wallet']);

export class UnsafeDatabaseTargetError extends Error {
  constructor(message) {
    super(message);
    this.name = 'UnsafeDatabaseTargetError';
    this.code = 'UNSAFE_DATABASE_TARGET';
  }
}

const TRUTHY_FLAGS = new Set(['true', '1', 'yes', 'on']);

export const isTestDatabaseRequested = () => {
  const value = String(process.env.USE_TEST_DATABASE || '').trim().toLowerCase();
  return TRUTHY_FLAGS.has(value);
};

export const extractDatabaseName = (uri) => {
  if (typeof uri !== 'string' || !uri.trim()) return '';
  try {
    const parsed = new URL(uri);
    return decodeURIComponent(parsed.pathname.replace(/^\/+/, '')).trim();
  } catch {
    return '';
  }
};

export const replaceDatabaseName = (uri, databaseName) => {
  const parsed = new URL(uri);
  parsed.pathname = `/${databaseName}`;
  return parsed.toString();
};

const isProductionLikeEnvironment = () =>
  process.env.NODE_ENV === 'production' ||
  Boolean(process.env.RENDER) ||
  Boolean(process.env.RENDER_SERVICE_ID);

const assertSafeTestTarget = (databaseName) => {
  if (BLOCKED_DATABASE_NAMES.includes(databaseName)) {
    throw new UnsafeDatabaseTargetError(
      `Refusing to use the production database "${databaseName}" for testing.`
    );
  }

  if (databaseName !== TEST_DATABASE_NAME) {
    throw new UnsafeDatabaseTargetError(
      `Refusing to start: USE_TEST_DATABASE requires the database name to be exactly "${TEST_DATABASE_NAME}".`
    );
  }
};

/**
 * @returns {{ uri: string, databaseName: string, mode: 'configured' | 'test' }}
 */
export const resolveMongoConnection = () => {
  const baseUri = String(process.env.MONGODB_URI || '').trim();

  if (!isTestDatabaseRequested()) {
    return {
      uri: baseUri,
      databaseName: extractDatabaseName(baseUri),
      mode: 'configured'
    };
  }

  if (isProductionLikeEnvironment()) {
    throw new UnsafeDatabaseTargetError(
      'Refusing to enable the test database in a production-like environment.'
    );
  }

  const explicitTestUri = String(process.env.MONGODB_URI_TEST || '').trim();
  const targetUri =
    explicitTestUri || (baseUri ? replaceDatabaseName(baseUri, TEST_DATABASE_NAME) : '');

  if (!targetUri) {
    throw new UnsafeDatabaseTargetError(
      'No MongoDB URI is available. Set MONGODB_URI_TEST or configure MONGODB_URI before enabling USE_TEST_DATABASE.'
    );
  }

  const databaseName = extractDatabaseName(targetUri);
  assertSafeTestTarget(databaseName);

  return { uri: targetUri, databaseName, mode: 'test' };
};
