# Warranty Wallet — Product Tracker

Warranty Wallet is a full-stack web application for tracking purchased products, warranty periods, expiry dates, countdowns, invoices, and product images. It supports authenticated users, dashboard statistics, search/filter/sort, notifications, profile photos, online product-image suggestions, and persistent image storage.

## Features

- **Dashboard summary:** total products, active warranties, expiring soon, and expired items.
- **Warranty expiry calculation:** supports **Days**, **Months**, and **Years**.
- **Calendar-aware dates:** handles month-end dates and leap years.
- **Countdown labels:** `15 days left`, `1 day left`, `Expires today`, and `Expired 3 days ago`.
- **Search, filtering, and sorting:** by product name, brand, store, category, status, date, and title.
- **Product image search:** searches online images and allows selecting, changing, removing, or manually uploading an image.
- **Manual image uploads:** product photos and profile photos with size and MIME validation.
- **Invoice-backed records:** upload an invoice and preserve the original file with its filename, MIME type, size, uploader, timestamp, storage reference, and SHA-256 checksum.
- **Automatic invoice reading:** local PDF text extraction fills what it can read; optional Google Cloud Vision OCR handles scanned documents or images. Missing fields stay empty and are entered manually — nothing is guessed.
- **Controlled sensitive edits:** changes to invoice-backed fields require a reason and a server-verified fresh identity check, preserve old and new values, increment the record version, and notify the account owner.
- **Append-only audit history:** creation, updates, corrections, invoice replacement/removal, and deletion are recorded per warranty and scoped to the owner.
- **Invoice evidence protection:** ordinary edits cannot replace or remove the invoice file. Replacement/removal uses dedicated actions, preserves previous versions, and never deletes the original bytes.
- **Reliable reminders:** configurable reminder days, timezone-aware calendar calculations, one due interval per run, duplicate-safe unique indexing, and durable email retry state.
- **Security emails:** mandatory owner notifications for sensitive corrections and invoice evidence changes, with honest delivery status when email is not configured.
- **Invoice storage:** upload and view invoice/receipt files with authorized access.
- **Cloudinary image storage:** profile photos and product images can use Cloudinary when configured.
- **Legacy storage compatibility:** local disk and S3/R2 paths remain supported.
- **Authentication:** email/password registration, login, logout, password reset, and Google sign-in.
- **Profile management:** name, email, avatar, notification preferences, and profile photo replacement/removal.
- **Owner-scoped data:** users can access and modify only their own warranties.
- **Notifications and reminders:** in-app notifications and scheduled expiry reminder processing.
- **Light/dark theme:** responsive SaaS-style interface.
- **Responsive layout:** works on desktop and mobile.

## Technology stack

### Frontend

- React 18.2
- Vite 5.2
- Tailwind CSS 3.4
- React Router DOM 6.22
- Axios 1.6
- Lucide React 0.368
- `@react-oauth/google` 0.13

### Backend

- Node.js with Express 4.19
- MongoDB with Mongoose 8.3
- JSON Web Tokens
- bcryptjs
- Multer
- Cloudinary
- AWS SDK S3 for S3/R2-compatible storage
- Google Auth Library
- Helmet, CORS, and express-rate-limit
- Resend for email delivery

### Testing

- Backend: Node.js built-in test runner
- Frontend: Vite production build

## Project structure

```text
Warranty Wallet/
├── backend/
│   ├── config/db.js
│   ├── controllers/
│   │   ├── authController.js
│   │   ├── notificationController.js
│   │   ├── warrantyController.js
│   │   └── warrantyEvidenceController.js
│   ├── middleware/
│   │   ├── authMiddleware.js
│   │   ├── errorHandler.js
│   │   └── uploadMiddleware.js
│   ├── models/
│   │   ├── AuditEvent.js
│   │   ├── InvoiceUpload.js
│   │   ├── Notification.js
│   │   ├── User.js
│   │   └── Warranty.js
│   ├── routes/
│   │   ├── authRoutes.js
│   │   ├── notificationRoutes.js
│   │   ├── productRoutes.js
│   │   └── warrantyRoutes.js
│   ├── scripts/
│   │   ├── migrate-files-to-cloud.js
│   │   ├── migrate-legacy-warranties.js
│   │   └── run-reminders.js
│   ├── services/
│   │   ├── auditService.js
│   │   ├── emailService.js
│   │   ├── freshAuthService.js
│   │   ├── invoiceEvidenceService.js
│   │   ├── invoiceExtractionService.js
│   │   ├── notificationService.js
│   │   ├── productImageSearchService.js
│   │   ├── reminderService.js
│   │   └── storageService.js
│   ├── tests/
│   ├── utils/
│   │   ├── controlledEditHelpers.js
│   │   ├── fileUtils.js
│   │   └── warrantyHelpers.js
│   ├── server.js
│   ├── package.json
│   ├── .env.example
│   └── .env.local.example
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   ├── InvoiceReviewPanel.jsx
│   │   │   └── SecureActionModal.jsx
│   │   ├── context/
│   │   ├── hooks/
│   │   ├── pages/
│   │   ├── services/
│   │   └── utils/
│   │       ├── controlledEdit.js
│   │       ├── expiry.js
│   │       └── fieldLabels.js
│   ├── package.json
│   ├── vite.config.js
│   ├── .env.example
│   └── .env.local.example
├── AGENTS.md
├── DEPLOYMENT_GUIDE.md
├── PROJECT_MEMORY.md
├── README.md
└── .gitignore
```

## Installation

### Prerequisites

- Node.js v18 or newer recommended
- MongoDB Atlas or another MongoDB connection
- Optional Google OAuth, Cloudinary, S3/R2, and Resend credentials

### Backend

```powershell
cd backend
npm install
npm run dev
```

The backend runs on `http://localhost:5000` by default.

### Frontend

```powershell
cd frontend
npm install
npm run dev
```

The frontend runs on `http://localhost:5173` by default.

## Environment variables

Do not commit real environment files. Use the `.env.example` or `.env.local.example` templates and enter values locally.

### Frontend variables

- `VITE_API_URL`
- `VITE_GOOGLE_CLIENT_ID`

### Backend variables

- `PORT`
- `NODE_ENV`
- `CLIENT_URL`
- `MONGODB_URI`
- `JWT_SECRET`
- `JWT_EXPIRE`
- `GOOGLE_CLIENT_ID`
- `CLOUDINARY_CLOUD_NAME`
- `CLOUDINARY_API_KEY`
- `CLOUDINARY_API_SECRET`
- `CLOUDINARY_UPLOAD_FOLDER`
- `S3_BUCKET`
- `S3_ACCESS_KEY_ID`
- `S3_SECRET_ACCESS_KEY`
- `S3_REGION`
- `S3_ENDPOINT`
- `S3_PUBLIC_DOMAIN`
- `RESEND_API_KEY`
- `EMAIL_FROM`
- `CRON_SECRET`
- `GOOGLE_VISION_API_KEY` (optional OCR for scanned invoices; text PDFs work without it)
- `UNSPLASH_ACCESS_KEY` (optional)
- `USE_TEST_DATABASE` (process-only flag for local testing; never set in Render)
- `MONGODB_URI_TEST` (optional dedicated test URI; only read when `USE_TEST_DATABASE=true`)

Frontend `VITE_` variables are exposed to the browser and must not contain secrets. Google client IDs are public identifiers, but Cloudinary, database, JWT, OCR, email, and storage credentials must remain backend-only. `USE_TEST_DATABASE` and `MONGODB_URI_TEST` are for local testing only and must not be added to Render environment settings.

## Scripts

### Backend

```powershell
npm start
npm run dev
npm run dev:test
npm run db:test:check
npm test
npm run reminders
```

`npm run reminders` runs the expiry reminder check once (intended for a scheduler or cron job), then exits. It is not a replacement for a persistent scheduler; see `DEPLOYMENT_GUIDE.md`.

`npm run dev:test` starts the API against the isolated `warranty_wallet_test` database and refuses to start in production-like environments or if the resolved database name is not exact. `npm run db:test:check` performs a read-only connectivity check for that test database and prints only its hostname and database name. Never run browser tests against `npm run dev` when it is connected to production data.

### Frontend

```powershell
npm run dev
npm run build
npm run lint
npm run preview
```

## API endpoints

All warranty, profile, notification, and image-search endpoints require authentication unless noted.

### Health

- `GET /api/health`

### Authentication

- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/google`
- `POST /api/auth/logout`
- `POST /api/auth/forgot-password`
- `PUT /api/auth/reset-password/:resetToken`
- `GET /api/auth/me`
- `PUT /api/auth/preferences`
- `PUT /api/auth/avatar`
- `DELETE /api/auth/avatar`

### Warranties

- `GET /api/warranties`
- `GET /api/warranties/stats`
- `GET /api/warranties/:id`
- `POST /api/warranties`
- `PUT /api/warranties/:id` (ordinary updates; invoice fields are rejected)
- `DELETE /api/warranties/:id` (soft delete; invoice evidence retained)
- `GET /api/warranties/:id/invoice`
- `GET /api/warranties/:id/invoice-url`
- `POST /api/warranties/invoice/extract` (multipart `invoiceFile`; stores a review draft and returns extracted fields)
- `GET /api/warranties/:id/invoice/verify` (checksum integrity check)
- `POST /api/warranties/:id/invoice/replace` (fresh auth + reason; preserves the previous version)
- `DELETE /api/warranties/:id/invoice` (fresh auth + reason; marks removed without deleting bytes)
- `GET /api/warranties/:id/audit` (owner-scoped append-only history)

### Products

- `GET /api/products/image-search?q=...`

### Notifications

- `GET /api/notifications`
- `DELETE /api/notifications`
- `PUT /api/notifications/read-all`
- `PUT /api/notifications/:id/read`
- `DELETE /api/notifications/:id`
- `POST /api/notifications/process-reminders`

## Testing

Run backend tests:

```powershell
cd backend
npm test
```

The `npm test` script uses Node's built-in test runner over `tests/**/*.test.js`. The current suite covers authentication, warranty date helpers, storage, invoice extraction and parsing, checksum integrity, controlled editing, security emails, and reminder scheduling.

Build the frontend:

```powershell
cd frontend
npm run build
```

The build verifies that the React/Vite application compiles for production.

External services are not exercised by the automated suite. Real OCR, real email delivery, production scheduling, and production MongoDB index creation require configured credentials and deployment verification.

## Deployment

Deployment and rollback instructions are in `DEPLOYMENT_GUIDE.md`.

The application is designed for:

- Frontend: Vercel
- Backend: Render
- Database: MongoDB Atlas
- Object storage: S3/R2 or Cloudinary, depending on configuration
- Email: Resend

## Security notes

- JWT bearer tokens are used for API authorization.
- Google ID tokens are verified on the backend.
- Warranty data is scoped by authenticated user.
- Uploaded files are validated by size, extension, MIME type, and magic-byte signature.
- Uploaded invoices are checksummed with SHA-256 so integrity can be verified later.
- Ordinary warranty updates cannot write invoice metadata or server-managed fields.
- Replacing or removing invoice evidence requires a meaningful reason and a fresh, server-verified authentication proof (password or Google ID token).
- Sensitive corrections store old/new values, actor, timestamp, and record version in an append-only audit log, and notify the account owner.
- Deleting a warranty is a soft delete; the original invoice evidence is retained rather than purged.
- Cloudinary is used only for images; invoices remain on S3/R2 or local storage.
- Template placeholder storage credentials are not treated as valid cloud configuration; uploads then use the local disk fallback instead of calling AWS with an invalid key.
- When `USE_TEST_DATABASE=true`, invoice uploads are forced to local disk even if cloud credentials are present.
- Email delivery state is recorded honestly. If `RESEND_API_KEY` / `EMAIL_FROM` is not configured, the API reports failure instead of pretending a message was sent.
- Real `.env` files are ignored by Git and must not be committed.

## Notes

The older README content described authentication and cloud storage as future improvements. Those features are now implemented in the current codebase. See `PROJECT_MEMORY.md` for the detailed implementation history and `DEPLOYMENT_GUIDE.md` for production setup.