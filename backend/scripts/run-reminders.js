/**
 * ==============================================================================
 * WARRANTY WALLET — STANDALONE REMINDER RUNNER SCRIPT
 * ==============================================================================
 *
 * Purpose:
 *   Executes the warranty expiry reminder process from the command line or
 *   a scheduled hosted cron job (e.g. Render Cron Job, GitHub Actions, AWS EventBridge).
 *
 * Safety Guarantees:
 *   - Idempotent: uses Notification unique compound index.
 *   - Will NOT send duplicate emails or notifications on repeated runs.
 *   - Safe error handling without logging credentials.
 *
 * Usage:
 *   node backend/scripts/run-reminders.js
 * ==============================================================================
 */

import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import connectDB from '../config/db.js';
import { processWarrantyReminders } from '../services/reminderService.js';
import { getEmailProviderStatus } from '../services/emailService.js';

// Match server.js precedence so a hosted cron job uses the same configuration
// as the API process.
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../.env.local') });
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const runReminders = async () => {
  console.log('\n======================================================');
  console.log('  🔔 WARRANTY WALLET: SCHEDULED EXPIRY REMINDERS RUNNER');
  console.log('======================================================');
  console.log(` Timestamp: ${new Date().toISOString()}`);
  console.log('------------------------------------------------------\n');

  const hasMongoTarget =
    Boolean(process.env.MONGODB_URI) ||
    (process.env.USE_TEST_DATABASE === 'true' && Boolean(process.env.MONGODB_URI_TEST));

  if (!hasMongoTarget) {
    console.error('❌ MONGODB_URI environment variable is not defined.');
    process.exit(1);
  }

  const provider = getEmailProviderStatus();
  console.log(
    ` Email provider: ${
      provider.testMode
        ? 'SIMULATED (test mode)'
        : provider.configured
          ? 'configured'
          : 'NOT CONFIGURED (emails will fail and be retried)'
    }`
  );

  try {
    console.log('Connecting to MongoDB...');
    // Use the same test-database guard as the API process so a test-mode cron
    // run can never touch the production database.
    await connectDB();

    if (mongoose.connection.readyState !== 1) {
      console.error('❌ Could not establish a MongoDB connection.');
      process.exit(1);
    }

    console.log('✅ Connected successfully.\n');

    console.log('Scanning upcoming expirations and processing reminders...');
    const report = await processWarrantyReminders();

    console.log('\n--- Reminders Processing Report ---');
    console.log(`Eligible Warranties Checked: ${report.processedCount}`);
    console.log(`New Notifications Created:   ${report.notificationsCreated}`);
    console.log(`Reminder Emails Dispatched:  ${report.emailsSent}`);
    console.log(`Reminder Emails Failed:      ${report.emailsFailed || 0}`);
    console.log(`Skipped Duplicates:         ${report.skippedDuplicate}`);
    if (report.retriedEmails) {
      console.log(
        `Retried Pending Emails:     ${report.retriedEmails.sent} sent, ${report.retriedEmails.failed} failed`
      );
    }

    if (report.errors.length > 0) {
      console.warn(`\n⚠️ Encountered ${report.errors.length} non-fatal item error(s):`);
      report.errors.forEach((e) => console.warn(`   - [Warranty ${e.warrantyId}]: ${e.error}`));
    }

    console.log('\n✅ Reminders job finished successfully.');
    await mongoose.disconnect();
    process.exit(0);
  } catch (err) {
    console.error('❌ Fatal error in reminders runner:', err.message);
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
    process.exit(1);
  }
};

runReminders();
