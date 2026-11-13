import mongoose from 'mongoose';

/**
 * Immutable metadata captured for an uploaded invoice/receipt.
 *
 * The invoice file itself is stored by storageService. This subdocument keeps
 * the original filename, MIME type, size, uploader, storage reference, and a
 * SHA-256 checksum of the exact bytes that were uploaded.
 */
const invoiceVersionSchema = new mongoose.Schema(
  {
    originalName: { type: String, default: '' },
    mimeType: { type: String, default: '' },
    size: { type: Number, default: 0 },
    checksum: { type: String, default: '' },
    storageUrl: { type: String, default: '' },
    storageKey: { type: String, default: '' },
    isCloud: { type: Boolean, default: false },
    uploadedAt: { type: Date, default: null },
    uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    replacedAt: { type: Date, default: null },
    replacedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    reason: { type: String, default: '' }
  },
  { _id: false }
);

const extractionSchema = new mongoose.Schema(
  {
    provider: { type: String, default: 'none' },
    method: { type: String, default: 'none' },
    status: {
      type: String,
      enum: ['success', 'partial', 'provider_unavailable', 'failed', 'not_attempted'],
      default: 'not_attempted'
    },
    extractedAt: { type: Date, default: null },
    textLength: { type: Number, default: 0 },
    // Structured fields: { fieldName: { value, confidence, status, evidence } }
    fields: { type: mongoose.Schema.Types.Mixed, default: {} },
    missingFields: { type: [String], default: [] },
    warnings: { type: [String], default: [] }
  },
  { _id: false }
);

const invoiceSchema = new mongoose.Schema(
  {
    originalName: { type: String, default: '' },
    mimeType: { type: String, default: '' },
    size: { type: Number, default: 0 },
    checksum: { type: String, default: '' },
    storageUrl: { type: String, default: '' },
    storageKey: { type: String, default: '' },
    isCloud: { type: Boolean, default: false },
    uploadedAt: { type: Date, default: null },
    uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    status: {
      type: String,
      enum: ['stored', 'extracted', 'confirmed', 'removed'],
      default: 'stored'
    },
    extraction: { type: extractionSchema, default: () => ({}) },
    versions: { type: [invoiceVersionSchema], default: [] },
    removedAt: { type: Date, default: null },
    removalReason: { type: String, default: '' }
  },
  { _id: false }
);

/**
 * Durable metadata for the product image. The legacy `productImage` string is
 * retained for compatibility, while this subdocument records where the image
 * is actually stored and whether that location is persistent cloud storage.
 */
const productImageMetaSchema = new mongoose.Schema(
  {
    storageUrl: { type: String, default: '' },
    storageKey: { type: String, default: '' },
    provider: { type: String, default: '' },
    isCloud: { type: Boolean, default: false },
    mimeType: { type: String, default: '' },
    size: { type: Number, default: 0 },
    checksum: { type: String, default: '' },
    sourceUrl: { type: String, default: '' },
    uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    uploadedAt: { type: Date, default: null },
    status: {
      type: String,
      enum: ['persisted', 'local', 'legacy_external', 'unknown'],
      default: 'unknown'
    }
  },
  { _id: false }
);

const warrantySchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Warranty must belong to a user'],
      index: true
    },
    productName: {
      type: String,
      required: [true, 'Product name is required'],
      trim: true
    },
    brand: {
      type: String,
      trim: true,
      default: ''
    },
    modelNumber: {
      type: String,
      trim: true,
      default: ''
    },
    category: {
      type: String,
      required: [true, 'Category is required'],
      enum: ['Electronics', 'Appliances', 'Furniture', 'Vehicles', 'Accessories', 'Other'],
      default: 'Other'
    },
    purchaseDate: {
      type: Date,
      required: [true, 'Purchase date is required']
    },
    warrantyStartDate: {
      type: Date,
      default: null
    },
    warrantyDuration: {
      type: Number,
      required: [true, 'Warranty duration is required'],
      min: [1, 'Warranty duration must be at least 1']
    },
    warrantyUnit: {
      type: String,
      required: [true, 'Warranty unit is required'],
      enum: ['Days', 'Months', 'Years'],
      default: 'Months'
    },
    warrantyExpiryDate: {
      type: Date,
      required: [true, 'Warranty expiry date is required']
    },
    store: {
      type: String,
      trim: true,
      default: ''
    },
    price: {
      type: Number,
      min: [0, 'Price cannot be negative'],
      default: null
    },
    currency: {
      type: String,
      trim: true,
      uppercase: true,
      default: ''
    },
    invoiceNumber: {
      type: String,
      trim: true,
      default: ''
    },
    serialNumber: {
      type: String,
      trim: true,
      default: ''
    },
    notes: {
      type: String,
      trim: true,
      default: ''
    },
    productImage: {
      type: String,
      default: ''
    },
    // Durable storage metadata for the product image (new records). Existing
    // records without this subdocument continue to use `productImage`.
    productImageMeta: {
      type: productImageMetaSchema,
      default: undefined
    },
    // Retained for backward compatibility with existing records and API clients.
    invoiceFile: {
      type: String,
      default: ''
    },
    // New evidence record. Existing records may not have this subdocument.
    invoice: {
      type: invoiceSchema,
      default: undefined
    },
    // confirmed: user reviewed and confirmed the values.
    // legacy_unverified: record created before evidence tracking existed.
    evidenceStatus: {
      type: String,
      enum: ['confirmed', 'legacy_unverified', 'extracted_unreviewed'],
      default: 'legacy_unverified'
    },
    recordVersion: {
      type: Number,
      default: 1,
      min: 1
    },
    lastCorrectionAt: {
      type: Date,
      default: null
    },
    lastCorrectionBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null
    },
    deletedAt: {
      type: Date,
      default: null
    }
  },
  {
    timestamps: true
  }
);

// Compound text index on product name, brand, store
warrantySchema.index({ productName: 'text', brand: 'text', store: 'text' });
// Compound index on user and expiry date for fast scoped queries and notifications
warrantySchema.index({ user: 1, warrantyExpiryDate: 1 });
// Supports active-record queries that exclude soft-deleted records.
warrantySchema.index({ user: 1, deletedAt: 1, warrantyExpiryDate: 1 });
// Invoice checksum lookup for integrity diagnostics (not a secret).
warrantySchema.index({ 'invoice.checksum': 1 }, { sparse: true });

const Warranty = mongoose.model('Warranty', warrantySchema);

export default Warranty;
