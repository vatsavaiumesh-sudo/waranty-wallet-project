import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  BLOCKED_DATABASE_NAMES,
  TEST_DATABASE_NAME,
  UnsafeDatabaseTargetError,
  extractDatabaseName,
  isTestDatabaseRequested,
  replaceDatabaseName,
  resolveMongoConnection
} from '../config/databaseTarget.js';

// Fake credentials and host. No real connection is opened by these tests.
const BASE_URI =
  'mongodb+srv://demo:demo@cluster.example.mongodb.net/warranty_wallet?retryWrites=true&w=majority';
const EXPLICIT_TEST_URI =
  'mongodb+srv://demo:demo@cluster.example.mongodb.net/warranty_wallet_test?retryWrites=true&w=majority';

const MANAGED_KEYS = [
  'USE_TEST_DATABASE',
  'MONGODB_URI',
  'MONGODB_URI_TEST',
  'NODE_ENV',
  'RENDER',
  'RENDER_SERVICE_ID'
];

let originalEnv;

beforeEach(() => {
  originalEnv = {};
  for (const key of MANAGED_KEYS) {
    originalEnv[key] = process.env[key];
  }

  for (const key of MANAGED_KEYS) {
    delete process.env[key];
  }

  process.env.MONGODB_URI = BASE_URI;
});

afterEach(() => {
  for (const key of MANAGED_KEYS) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
});

const assertUnsafe = (fn) => {
  assert.throws(fn, (error) => {
    assert.ok(error instanceof UnsafeDatabaseTargetError);
    assert.equal(error.code, 'UNSAFE_DATABASE_TARGET');
    return true;
  });
};

test('without the flag, the configured URI is returned unchanged', () => {
  const target = resolveMongoConnection();

  assert.equal(target.mode, 'configured');
  assert.equal(target.uri, BASE_URI);
  assert.equal(target.databaseName, 'warranty_wallet');
  assert.equal(isTestDatabaseRequested(), false);
});

test('MONGODB_URI_TEST is ignored unless the test flag is enabled', () => {
  process.env.MONGODB_URI_TEST = EXPLICIT_TEST_URI;

  const target = resolveMongoConnection();

  assert.equal(target.mode, 'configured');
  assert.equal(target.databaseName, 'warranty_wallet');
});

test('test mode rewrites only the database name and keeps the host', () => {
  process.env.USE_TEST_DATABASE = 'true';

  const target = resolveMongoConnection();

  assert.equal(target.mode, 'test');
  assert.equal(target.databaseName, TEST_DATABASE_NAME);
  assert.equal(new URL(target.uri).hostname, 'cluster.example.mongodb.net');
  assert.equal(new URL(target.uri).pathname, `/${TEST_DATABASE_NAME}`);
  assert.match(target.uri, /^mongodb\+srv:\/\//);
});

test('test mode accepts an explicit MONGODB_URI_TEST pointing at the test database', () => {
  process.env.USE_TEST_DATABASE = 'true';
  process.env.MONGODB_URI_TEST = EXPLICIT_TEST_URI;

  const target = resolveMongoConnection();

  assert.equal(target.mode, 'test');
  assert.equal(target.databaseName, TEST_DATABASE_NAME);
});

test('test mode refuses an explicit URI that points at the production database', () => {
  process.env.USE_TEST_DATABASE = 'true';
  process.env.MONGODB_URI_TEST = BASE_URI;

  assertUnsafe(() => resolveMongoConnection());
});

test('test mode refuses any database name other than the exact test name', () => {
  process.env.USE_TEST_DATABASE = 'true';
  process.env.MONGODB_URI_TEST =
    'mongodb+srv://demo:demo@cluster.example.mongodb.net/warranty_wallet_staging';

  assertUnsafe(() => resolveMongoConnection());
});

test('test mode refuses to run in a production-like environment', () => {
  process.env.USE_TEST_DATABASE = 'true';

  process.env.NODE_ENV = 'production';
  assertUnsafe(() => resolveMongoConnection());

  delete process.env.NODE_ENV;
  process.env.RENDER = 'true';
  assertUnsafe(() => resolveMongoConnection());

  delete process.env.RENDER;
  process.env.RENDER_SERVICE_ID = 'srv-example';
  assertUnsafe(() => resolveMongoConnection());
});

test('test mode refuses to start without any MongoDB URI', () => {
  process.env.USE_TEST_DATABASE = 'true';
  delete process.env.MONGODB_URI;

  assertUnsafe(() => resolveMongoConnection());
});

test('production database names are listed as blocked', () => {
  assert.deepEqual(BLOCKED_DATABASE_NAMES, ['warranty_wallet']);
});

test('URI helpers parse and replace database names safely', () => {
  assert.equal(extractDatabaseName(BASE_URI), 'warranty_wallet');
  assert.equal(extractDatabaseName('not-a-uri'), '');
  assert.equal(extractDatabaseName(''), '');

  const replaced = replaceDatabaseName(BASE_URI, TEST_DATABASE_NAME);
  assert.equal(extractDatabaseName(replaced), TEST_DATABASE_NAME);
  assert.equal(new URL(replaced).hostname, 'cluster.example.mongodb.net');
});
