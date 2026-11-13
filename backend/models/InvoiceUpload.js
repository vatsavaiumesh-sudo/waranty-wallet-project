import mongoose from 'mongoose';

/**
 * Temporary evidence record created when a user uploads an invoice for
 * extraction, before they confirm the warranty form.
 *
 * The file is already stored in persistent storage, so confirming the warranty
 * only needs to copy this metadata onto the Warranty record. This avoids asking
 * the browser to upload the same file twice.
 */
const invoiceUploadSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    originalName: { type: String, default: '' },
    mimeType: { type: String, default: '' },
    size: { type: Number, default: 0 },
    checksum: { type: String, default: '' },
    storageUrl: { type: String, default: '' },
    storageKey: { type: String, default: '' },
    isCloud: { type: Boolean, default: false },
    extraction: { type: mongoose.Schema.Types.Mixed, default: null },
    status: {
      type: String,
      enum: ['ready', 'consumed'],
      default: 'ready',
      index: true
    },
    consumedByWarranty: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Warranty',
      default: null
    }
  },
  {
    timestamps: true
  }
);

invoiceUploadSchema.index({ user: 1, createdAt: -1 });

const InvoiceUpload = mongoose.model('InvoiceUpload', invoiceUploadSchema);

export default InvoiceUpload;
