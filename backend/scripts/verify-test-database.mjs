/**
 * Read-only check that the isolated test database is reachable.
 *
 * - Forces USE_TEST_DATABASE=true for this process only.
 * - Refuses the production database name.
 * - Prints only the sanitized hostname and database name.
 * - Performs NO writes: no models are imported, autoIndex is disabled, and the
 *   connection is closed immediately.
 *
 * Usage: npm run db:test:check
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dns from 'node:dns';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import {
  resolveMongoConnection,
  TEST_DATABASE_NAME,
  UnsafeDatabaseTargetError
} from '../config/databaseTarget.js';

process.env.USE_TEST_DATABASE = 'true';

const backendDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

dotenv.config({ path: path.join(backendDir, '.env.local') });
dotenv.config({ path: path.join(backendDir, '.env') });

dns.setServers(['8.8.8.8', '1.1.1.1']);

const fail = (payload) => {
  console.log(JSON.stringify({ ok: false, ...payload }, null, 2));
  process.exitCode = 1;
};

let target;

try {
  target = resolveMongoConnection();
} catch (error) {
  if (error instanceof UnsafeDatabaseTargetError) {
    fail({ reason: error.message });
  } else {
    fail({ reason: 'The test database target could not be resolved safely.' });
  }
}

if (target) {
  if (target.mode !== 'test' || target.databaseName !== TEST_DATABASE_NAME) {
    fail({
      reason: `Refusing to connect: expected "${TEST_DATABASE_NAME}" but resolved "${target.databaseName || '(none)'}".`
    });
  } else {
    try {
      await mongoose.connect(target.uri, {
        serverSelectionTimeoutMS: 15000,
        autoIndex: false
      });

      const conn = mongoose.connection;

      console.log(
        JSON.stringify(
          {
            ok: true,
            mode: target.mode,
            databaseName: conn.name,
            hostname: conn.host,
            port: conn.port ?? null,
            srv: String(target.uri).startsWith('mongodb+srv://'),
            writesPerformed: false
          },
          null,
          2
        )
      );

      await mongoose.disconnect();
    } catch (error) {
      console.log(
        JSON.stringify(
          {
            ok: false,
            errorName: error?.name || 'Error',
            databaseName: target.databaseName,
            note: 'Connection failed. No URI, username, password, or token was printed.'
          },
          null,
          2
        )
      );
      process.exitCode = 1;
      try {
        await mongoose.disconnect();
      } catch {
        /* ignore */
      }
    }
  }
}
