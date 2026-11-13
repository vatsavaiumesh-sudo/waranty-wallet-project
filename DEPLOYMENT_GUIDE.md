# Warranty Wallet — Production Deployment & Operations Guide

This guide details the exact steps and configuration checklist required to deploy, migrate, and maintain the **Warranty Wallet** full-stack application across **Vercel** (Frontend), **Render** (Backend), **MongoDB Atlas** (Database), **Cloudflare R2 / AWS S3** (Object Storage), and **Resend** (Email Delivery).

---

## 1. Architecture Summary

The frontend is a React/Vite SPA on Vercel. It calls the Express backend on Render using Bearer JWT authentication. The backend uses MongoDB Atlas for data, Cloudinary for profile and product images, S3/R2 or local disk for invoice files, Google OAuth for sign-in, optional Google Cloud Vision for OCR, and Resend for email reminders.

```text
Browser -> Vercel frontend -> Render backend -> MongoDB Atlas
Render backend -> Cloudinary (profile/product images)
Render backend -> S3/R2/local storage (invoice files)
Browser -> Google Identity Services -> backend Google ID-token verification
Render backend -> Google Cloud Vision (optional OCR, only when configured)
Render backend -> Resend (email reminders and security alerts)
Scheduler (Render Cron / GitHub Actions) -> run-reminders.js -> MongoDB + Resend
```

Invoice evidence is stored as a subdocument on the warranty with its original filename, MIME type, size, uploader, timestamp, storage reference, and SHA-256 checksum. Sensitive corrections and invoice replacement/removal are recorded in an append-only `AuditEvent` collection and notify the account owner.

## 2. Pre-Deployment Configuration Checklist

### 2.1 MongoDB Atlas Setup
1. Create a MongoDB Atlas Cluster (M0 Free tier or dedicated).
2. Go to **Network Access** and add your backend's IP (or allow `0.0.0.0/0` with strong database user credentials).
3. In **Database Access**, create a user with `readWrite` privileges on the `warranty-wallet` database.
4. Copy the connection string format:
   ```
   mongodb+srv://<username>:<password>@cluster0.xxxxx.mongodb.net/warranty-wallet?retryWrites=true&w=majority
   ```

### 2.2 Cloudflare R2 (or AWS S3) Setup
1. Log in to the Cloudflare Dashboard and navigate to **R2**.
2. Click **Create Bucket** and name it (e.g., `warranty-wallet-uploads`).
3. Set the bucket permissions to **Private** (default) — invoice documents are protected and served via short-lived signed URLs.
4. Go to **R2 > Manage R2 API Tokens**, create a token with **Object Read & Write** permissions on the bucket.
5. Record:
   - Account ID / S3 Endpoint: `https://<account_id>.r2.cloudflarestorage.com`
   - Access Key ID
   - Secret Access Key
6. Set `S3_ENDPOINT` to the R2 endpoint and `S3_REGION=auto` for R2. Template placeholder values are rejected; if valid storage credentials or the endpoint are missing, invoices fall back to local disk instead of calling AWS with an invalid key.

### 2.2a Google OAuth Setup
1. Open Google Cloud Console and create or select a project.
2. Configure the OAuth consent screen.
3. Create an OAuth 2.0 Web application client.
4. Add authorized JavaScript origins for every frontend origin, including local development and the Vercel production URL.
5. Use the same client ID in `VITE_GOOGLE_CLIENT_ID` and backend `GOOGLE_CLIENT_ID`.
6. Do not place a Google client secret in frontend code. The current implementation uses ID-token verification on the backend.

### 2.2b Cloudinary Setup
1. Create a Cloudinary account.
2. Record the cloud name, API key, and API secret in the backend hosting environment only.
3. Set `CLOUDINARY_UPLOAD_FOLDER` if a custom folder is desired.
4. Cloudinary is used for profile photos and product images. Invoice files remain on S3/R2/local storage.

### 2.3 Resend (Email Reminders) Setup
1. Sign up at [Resend.com](https://resend.com).
2. Add and verify your custom domain in **Domains** (add the required DKIM and SPF records in your DNS provider).
3. Under **API Keys**, create a new key with sending permissions.
4. Set your verified sender email (e.g., `Warranty Wallet <notifications@yourdomain.com>`).
   *(Note: Resend allows testing with `onboarding@resend.dev` to your account email address if a custom domain is not yet configured).*
5. Real delivery is not verified until a test message actually arrives. If `RESEND_API_KEY` or `EMAIL_FROM` is missing, the API records the email as failed rather than claiming success. Failed emails retain a retryable state and are retried by the reminder job.

### 2.4 Google Cloud Vision OCR (Optional)
Text-based PDF invoices are read locally by the backend and do not require any external service. Scanned PDFs and image invoices need OCR.
1. Enable the Cloud Vision API in Google Cloud Console.
2. Create an API key restricted to the Cloud Vision API.
3. Set `GOOGLE_VISION_API_KEY` in the backend environment only.
4. If the key is absent, invoice images are stored and the UI reports that automatic reading is unavailable; the user enters the fields manually. No value is invented.

---

## 3. Backend Deployment on Render

1. Create a new **Web Service** on Render and link your GitHub repository.
2. Configure the service settings:
   - **Root Directory**: `backend`
   - **Environment**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Health Check Path**: `/api/health`
3. Add Environment Variables in Render Dashboard under **Environment**:

| Key | Example Value | Description |
| :--- | :--- | :--- |
| `NODE_ENV` | `production` | Enables production security & logging modes |
| `PORT` | `10000` | Port automatically assigned by Render |
| `MONGODB_URI` | `mongodb+srv://user:pass@cluster.mongodb.net/warranty-wallet` | Atlas connection string |
| `CLIENT_URL` | `https://your-warranty-app.vercel.app` | Explicit CORS allowed origin |
| `JWT_SECRET` | *(64-char random string)* | Used to sign JWT session tokens |
| `JWT_EXPIRE` | `7d` | Token validity duration |
| `GOOGLE_CLIENT_ID` | *(same Web client ID as frontend)* | Google OAuth client ID used for ID-token verification |
| `CLOUDINARY_CLOUD_NAME` | *(your cloud name)* | Cloudinary cloud name |
| `CLOUDINARY_API_KEY` | *(your API key)* | Cloudinary API key |
| `CLOUDINARY_API_SECRET` | *(your API secret)* | Cloudinary API secret, backend-only |
| `CLOUDINARY_UPLOAD_FOLDER` | `warranty-wallet` | Optional Cloudinary folder |
| `UNSPLASH_ACCESS_KEY` | *(optional)* | Optional enhanced product-image search provider |
| `S3_BUCKET` | `warranty-wallet-uploads` | Private R2/S3 bucket name |
| `S3_ACCESS_KEY_ID` | *(your access key)* | Storage access key |
| `S3_SECRET_ACCESS_KEY`| *(your secret key)* | Storage secret access key |
| `S3_ENDPOINT` | `https://<account_id>.r2.cloudflarestorage.com` | R2 endpoint URL |
| `S3_REGION` | `auto` | Set to `auto` for R2 or e.g. `us-east-1` for AWS |
| `RESEND_API_KEY` | `re_xxxxxxxxxxxxxxxx` | Resend API key |
| `EMAIL_FROM` | `Warranty Wallet <notifications@yourdomain.com>` | Verified sender address |
| `GOOGLE_VISION_API_KEY` | *(optional)* | Optional OCR for scanned/image invoices |
| `CRON_SECRET` | *(32-char random string)* | Protects the reminder cron webhook |

4. Deploy the service and verify `/api/health` returns HTTP 200 with `status: "ok"`.

### 3.1 Scheduled Expiry Reminders (Cron Job on Render)
1. On Render, click **New + > Cron Job**.
2. Link the repository and set:
   - **Root Directory**: `backend`
   - **Command**: `node scripts/run-reminders.js` (equivalent to `npm run reminders`)
   - **Schedule**: `0 9 * * *` (runs every day at 09:00 UTC)
3. Share the same Environment Variables as your Web Service.

The reminder run is intentionally outside the API process. It does not depend on the backend staying awake, and it exits after one pass. Reliability properties in the current implementation:
- Only the most urgent due interval is created per warranty per run, so a late or restarted scheduler does not burst several backlogged emails.
- The unique index on `{ user, warranty, reminderInterval }` prevents duplicates across repeated or concurrent runs.
- Reminder day counts use each user's configured IANA timezone.
- Soft-deleted warranties are excluded.
- Failed emails retain a pending/failed state and are retried by the same job (up to the configured attempt limit).
- Security correction notifications use unique negative intervals so they are not blocked by the expiry uniqueness index.

*(Alternative: Use an external cron scheduler such as GitHub Actions or cron-job.org sending a `POST` request to `https://<your-backend>.onrender.com/api/notifications/process-reminders` with header `x-cron-secret: <CRON_SECRET>`)*.

Production verification requires a real scheduled run. A local run demonstrates the logic but cannot prove the hosted scheduler is configured or awake.

---

## 4. Frontend Deployment on Vercel

1. Import your repository into Vercel.
2. Configure project settings:
   - **Framework Preset**: `Vite`
   - **Root Directory**: `frontend`
   - **Build Command**: `npm run build`
   - **Output Directory**: `dist`
3. Set Environment Variables:
   - `VITE_API_URL`: `https://<your-render-backend-service>.onrender.com/api`
   - `VITE_GOOGLE_CLIENT_ID`: same Google Web client ID used by the backend
4. Deploy the project.
5. Verify client-side routing:
   The repository includes [frontend/vercel.json](file:///c:/Users/sudheer/OneDrive/Desktop/Warranty%20Wallet/frontend/vercel.json) with SPA rewrites to ensure direct navigation to `/warranties` and `/warranties/:id` succeeds without 404s.

---

## 5. Safe Database & File Migrations

### 5.1 Pre-Migration Database Backup
Always capture a snapshot before migrating data:
```bash
mongodump --uri="<MONGODB_URI>" --collection=warranties --out=./backup-pre-migration
```

### 5.2 Legacy Records Migration (Associating Unowned Records)
1. Run dry-run audit (read-only, no database modifications):
   ```bash
   node backend/scripts/migrate-legacy-warranties.js --dry-run
   ```
2. When ready, designate an explicit registered user account to own legacy warranties:
   ```bash
   node backend/scripts/migrate-legacy-warranties.js --owner-email=your-admin@example.com --execute
   ```
3. The script verifies count consistency and prints an audit report.

### 5.3 Local Uploads to Cloud Storage Migration
1. Run dry-run audit of local `/uploads/` files:
   ```bash
   node backend/scripts/migrate-files-to-cloud.js --dry-run
   ```
2. Execute upload to R2/S3:
   ```bash
   node backend/scripts/migrate-files-to-cloud.js --execute
   ```
3. A rollback map `backend/scripts/file-migration-map.json` is exported.
4. **Safety Rule**: Keep local files in `backend/uploads/` until you have verified production cloud operations. Do not delete local files prematurely.

---

## 6. Rollback Procedures

### 6.1 Database Rollback
If a database rollback is ever required:
```bash
mongorestore --uri="<MONGODB_URI>" --nsInclude="warranty-wallet.warranties" ./backup-pre-migration/warranty-wallet/warranties.bson
```

### 6.2 Cloud File Rollback
To restore database references back to local paths:
```javascript
// Reverts references using file-migration-map.json
const map = JSON.parse(fs.readFileSync('backend/scripts/file-migration-map.json'));
for (const item of map) {
  await Warranty.findByIdAndUpdate(item.warrantyId, { [item.field]: item.oldRef });
}
```

### 6.3 Deployment Rollback
- **Vercel**: Instant Rollback to previous deployment via **Deployments > Instant Rollback**.
- **Render**: Rollback via **Manual Deploy > Deploy a specific commit** or revert the commit in Git.

---

## 7. Post-Deployment Verification

Verify these against the deployed environment rather than assuming they work:

1. **Health:** `GET https://<backend>/api/health` returns HTTP 200.
2. **Database indexes:** confirm Atlas created the indexes declared by Mongoose, especially:
   - `notifications` unique `{ user, warranty, reminderInterval }`
   - `auditevents` idempotency/owner indexes
   - `invoiceuploads` owner/status indexes
   - `warranties` owner and `deletedAt` indexes
3. **Invoice upload:** upload a real test invoice, confirm the stored checksum, then run `GET /api/warranties/:id/invoice/verify` and expect `verified: true`.
4. **Sensitive correction:** change an invoice-backed field, provide a reason and fresh authentication, confirm the record version increments, the audit event appears, and the security notification is created.
5. **Email:** require a real delivered test email before claiming delivery works. Check the notification's `emailStatus` and `emailAttempts`.
6. **Scheduler:** trigger the hosted cron job and confirm the report prints processed warranties and no duplicate notifications are created on a second run.
7. **Soft delete:** delete a test warranty and confirm it disappears from the list while its invoice evidence and audit history remain in the database.

## 8. Invoice Evidence Retention

- Ordinary warranty edits never replace or delete invoice evidence.
- Replacing or removing an invoice preserves the previous file reference, checksum, actor, reason, and timestamp in `invoice.versions`.
- Soft-deleting a warranty sets `deletedAt`; it does not purge invoice files.
- Physical deletion of stored files is an explicit operational decision. No automatic purge is implemented.
- Existing records without checksums remain readable and are labeled `legacy_unverified`; they are not given fabricated evidence.

## 9. Isolated Test Database for Local End-to-End Testing

The local backend and the Render backend are both configured against the same MongoDB Atlas cluster and historically used the same `warranty_wallet` database. Never run browser tests against that database.

The backend now supports an explicit, process-scoped test mode:

- `USE_TEST_DATABASE=true` enables test mode **for that process only**. It is not read from, written to, or required in any `.env` file.
- If `MONGODB_URI_TEST` is set, that URI is used and its database name must be exactly `warranty_wallet_test`.
- Otherwise the existing `MONGODB_URI` is reused with only the database-name segment replaced by `warranty_wallet_test`. Credentials and the host stay in memory and are never printed.
- `npm run dev:test` starts the API through `scripts/start-test-server.mjs`, which runs the guard before importing the server.
- `npm run db:test:check` performs a read-only connectivity check and prints only the hostname and database name.

Refusal conditions (the process exits with a non-zero status):

- `USE_TEST_DATABASE` is enabled while `NODE_ENV=production`, or while Render markers (`RENDER`, `RENDER_SERVICE_ID`) are present.
- The resolved database name is `warranty_wallet`.
- The resolved database name is anything other than exactly `warranty_wallet_test`.
- No MongoDB URI is available.

### 9.1 Safe PowerShell commands

Run from the repository root. These commands contain no credentials and do not place any URI in shell history or console output.

```powershell
cd backend
$env:USE_TEST_DATABASE = 'true'
npm run db:test:check   # read-only: prints database name + hostname only
npm run dev:test        # starts the API in test mode (default port 5000)
```

Expected confirmation in the server log:

```text
MongoDB Connected (TEST DATABASE: warranty_wallet_test) @ <hostname>
```

When finished, stop the server with `Ctrl+C`, then clean the shell variable:

```powershell
Remove-Item Env:USE_TEST_DATABASE
```

If you prefer a completely separate test URI/cluster, provide it without echoing it:

```powershell
$secure = Read-Host -AsSecureString 'Paste the dedicated TEST MongoDB URI'
$env:MONGODB_URI_TEST = [System.Runtime.InteropServices.Marshal]::PtrToStringBSTR([System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))
$env:USE_TEST_DATABASE = 'true'
npm run db:test:check
npm run dev:test
```

The test URI must end with the database name `warranty_wallet_test`, otherwise startup is refused.

### 9.2 Isolating production

- No `.env` or `.env.local` file was read, modified, or required to change.
- Render environment variables must not include `USE_TEST_DATABASE` or `MONGODB_URI_TEST`; the code refuses test mode when Render markers are present regardless.
- Production behavior is unchanged when `USE_TEST_DATABASE` is absent: the original `MONGODB_URI` is used exactly as before.
- Database writes during browser testing go only to `warranty_wallet_test`. Index creation on first real use is expected in that database and does not touch `warranty_wallet`.

### 9.3 Readiness and cleanup

- `npm run db:test:check` must report `databaseName: "warranty_wallet_test"` and `ok: true` before any browser test.
- The test database is created lazily by MongoDB when the first document is written. The preparation step performs no writes.
- Removing test data is an explicit owner decision; no automatic cleanup runs. The `warranty_wallet` database is never touched by test mode.
