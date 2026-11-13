/**
 * Start the backend against the isolated test database.
 *
 * Safety properties:
 *   - Sets USE_TEST_DATABASE=true for this process only (no env file changes).
 *   - Resolves the target before the app starts and refuses to continue unless
 *     the database name is exactly warranty_wallet_test.
 *   - Refuses production-like environments and the production database name.
 *   - Prints only the database name and hostname, never a URI or credentials.
 *
 * Usage: npm run dev:test
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import {
  resolveMongoConnection,
  TEST_DATABASE_NAME,
  UnsafeDatabaseTargetError
} from '../config/databaseTarget.js';

process.env.USE_TEST_DATABASE = 'true';

const backendDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

// Same precedence as server.js: .env.local wins, .env is the fallback.
dotenv.config({ path: path.join(backendDir, '.env.local') });
dotenv.config({ path: path.join(backendDir, '.env') });

let target;

try {
  target = resolveMongoConnection();
} catch (error) {
  if (error instanceof UnsafeDatabaseTargetError) {
    console.error(`Refusing to start: ${error.message}`);
  } else {
    console.error('Refusing to start: the test database target could not be resolved safely.');
  }
  process.exit(1);
}

if (target.mode !== 'test' || target.databaseName !== TEST_DATABASE_NAME) {
  console.error(
    `Refusing to start: expected test database "${TEST_DATABASE_NAME}" but got "${target.databaseName || '(none)'}".`
  );
  process.exit(1);
}

console.log(
  `[warranty-wallet] Test database mode: ${target.databaseName}. Starting backend; production data is not used by this process.`
);

// Import the normal server entry point only after the guard has passed.
await import('../server.js');
