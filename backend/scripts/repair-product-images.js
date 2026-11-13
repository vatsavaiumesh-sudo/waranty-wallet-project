/**
 * ==============================================================================
 * WARRANTY WALLET — SAFE PRODUCT IMAGE REPAIR / MIGRATION SCRIPT
 * ==============================================================================
 *
 * Purpose:
 *   Finds warranty records whose product image still points at an external,
 *   temporary third-party URL and copies those images into the application's
 *   configured persistent image storage (Cloudinary or S3/R2).
 *
 * Safety guarantees:
 *   - Dry-run by default. Live changes require `--execute`.
 *   - Never deletes the original external image URL or any stored file.
 *   - Only updates a warranty when the new image was downloaded, validated, and
 *     stored successfully.
 *   - Uses a conditional update so a concurrent edit is never overwritten.
 *   - Writes a rollback map (`product-image-repair-map.json`) during execution.
 *   - Idempotent: already-durable images are skipped.
 *   - Invoices are never touched.
 *
 * Usage:
 *   node backend/scripts/repair-product-images.js --dry-run
 *   node backend/scripts/repair-product-images.js --execute
 *   node backend/scripts/repair-product-images.js --execute --limit=25
 * ==============================================================================
 */

import dotenv from 'dotenv';
import mongoose from 'mongoose';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import Warranty from '../models/Warranty.js';
import { resolveMongoConnection } from '../config/databaseTarget.js';
import {
  isPersistentImageStorageConfigured,
  isTestStorageMode
} from '../services/storageService.js';
import { downloadAndStoreRemoteImage } from '../services/productImageSearchService.js';
import {
  buildProductImageMeta,
  isDurableProductImageUrl
} from '../services/productImageService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../.env.local') });
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const args = process.argv.slice(2);
const isDryRun = !args.includes('--execute') || args.includes('--dry-run');
const limitArg = args.find((arg) => arg.startsWith('--limit='));
const parsedLimit = limitArg ? Number(limitArg.split('=')[1]) : 0;
const limit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? Math.floor(parsedLimit) : 0;

const isExternalImage = (url) =>
  typeof url === 'string' &&
  /^https?:\/\//i.test(url) &&
  !isDurableProductImageUrl(url);

const runRepair = async () => {
  console.log('\n======================================================');
  console.log('  🖼️ WARRANTY WALLET: PRODUCT IMAGE REPAIR UTILITY');
  console.log('======================================================');
  console.log(` Mode: ${isDryRun ? '🔍 DRY RUN (audit only)' : '⚡ LIVE EXECUTION'}`);
  console.log('------------------------------------------------------\n');

  let target;
  try {
    target = resolveMongoConnection();
  } catch (error) {
    console.error(`❌ Refusing to run: ${error.message}`);
    process.exit(1);
  }

  if (!target.uri) {
    console.error('❌ MONGODB_URI is not configured.');
    process.exit(1);
  }

  if (!isDryRun && !isPersistentImageStorageConfigured()) {
    console.error(
      '❌ Persistent image storage is not configured. Configure Cloudinary or S3/R2 before executing.'
    );
    console.error('   No database records were changed.');
    process.exit(1);
  }

  if (!isDryRun && isTestStorageMode()) {
    console.warn(
      '⚠️ USE_TEST_DATABASE is enabled. Uploads are forced to local test storage, so this run is not a production repair.'
    );
  }

  try {
    await mongoose.connect(target.uri);
    console.log(
      `✅ Connected to ${target.databaseName || 'configured database'} (${target.mode} mode).\n`
    );

    const query = { productImage: { $regex: '^https?://' } };
    let warranties = await Warranty.find(query).select(
      '_id user productImage productImageMeta deletedAt'
    );

    warranties = warranties.filter((warranty) => isExternalImage(warranty.productImage));
    if (limit > 0) warranties = warranties.slice(0, limit);

    console.log(`External product image references found: ${warranties.length}`);

    if (warranties.length === 0) {
      console.log('\n🎉 No product images need repair.');
      await mongoose.disconnect();
      return;
    }

    if (isDryRun) {
      console.log('\n🔍 DRY RUN SUMMARY:');
      warranties.forEach((warranty) => {
        console.log(`   - [Warranty ${warranty._id}] ${warranty.productImage}`);
      });
      console.log(`\n- ${warranties.length} image(s) would be downloaded and stored durably.`);
      console.log('- Original external URLs would remain untouched.');
      console.log('- No database records were changed.');
      console.log('\nTo execute: configure Cloudinary or S3/R2 and run:');
      console.log('  node backend/scripts/repair-product-images.js --execute\n');
      await mongoose.disconnect();
      return;
    }

    const repairMap = [];
    let repaired = 0;
    let failed = 0;
    let skipped = 0;

    for (const warranty of warranties) {
      const originalUrl = warranty.productImage;

      try {
        const stored = await downloadAndStoreRemoteImage(originalUrl, warranty.user, {
          allowAnyPublicHost: true
        });

        const meta = buildProductImageMeta(stored, {
          sourceUrl: originalUrl,
          uploadedBy: warranty.user
        });

        // Conditional update: do not overwrite a concurrent image change.
        const result = await Warranty.updateOne(
          { _id: warranty._id, productImage: originalUrl },
          { $set: { productImage: stored.url, productImageMeta: meta } }
        );

        if (result.modifiedCount === 0) {
          skipped++;
          console.log(
            `⚠️ Skipped [Warranty ${warranty._id}]: image changed while repairing.`
          );
          continue;
        }

        repairMap.push({
          warrantyId: warranty._id,
          oldRef: originalUrl,
          newRef: stored.url,
          storageKey: stored.key,
          provider: stored.provider,
          repairedAt: new Date().toISOString()
        });

        repaired++;
        console.log(
          `✅ [${repaired}/${warranties.length}] Repaired [Warranty ${warranty._id}] -> ${stored.url}`
        );
      } catch (error) {
        failed++;
        console.error(
          `❌ Failed [Warranty ${warranty._id}]: ${error.message}`
        );
      }
    }

    if (repairMap.length > 0) {
      const mapPath = path.join(__dirname, 'product-image-repair-map.json');
      fs.writeFileSync(mapPath, JSON.stringify(repairMap, null, 2));
      console.log(`\nRollback mapping saved: ${mapPath}`);
    }

    console.log('\n======================================================');
    console.log(`  REPAIR REPORT:`);
    console.log(`  Repaired: ${repaired}`);
    console.log(`  Failed:   ${failed}`);
    console.log(`  Skipped:  ${skipped}`);
    console.log('  Original external URLs were not deleted.');
    console.log('======================================================\n');

    await mongoose.disconnect();
  } catch (error) {
    console.error(`❌ Product image repair error: ${error.message}`);
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
    process.exit(1);
  }
};

runRepair();
