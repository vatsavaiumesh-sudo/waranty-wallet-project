import mongoose from 'mongoose';

/**
 * Append-only audit history for important warranty operations.
 *
 * Application endpoints only create or read these documents. There is no
 * update/delete API. Direct database access can still modify documents, so the
 * audit log is tamper-evident only to the extent that the database itself is
 * protected.
 */
const changeSchema = new mongoose.Schema(
  {
    field: { type: String, required: true },
    previousValue: { type: mongoose.Schema.Types.Mixed, default: null },
    newValue: { type: mongoose.Schema.Types.Mixed, default: null }
  },
  { _id: false }
);

const auditEventSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    warranty: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Warranty',
      required: true,
      index: true
    },
    actor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    actorEmail: {
      type: String,
      default: ''
    },
    action: {
      type: String,
      required: true,
      enum: [
        'WARRANTY_CREATED',
        'WARRANTY_UPDATED',
        'SENSITIVE_CORRECTION',
        'INVOICE_UPLOADED',
        'INVOICE_REPLACED',
        'INVOICE_REMOVED',
        'WARRANTY_DELETED'
      ],
      index: true
    },
    changes: { type: [changeSchema], default: [] },
    reason: { type: String, default: '' },
    recordVersion: { type: Number, default: 1 },
    invoiceId: { type: mongoose.Schema.Types.ObjectId, default: null },
    requestId: { type: String, default: null },
    metadata: {
      freshAuthMethod: { type: String, default: '' },
      ipAddress: { type: String, default: '' },
      userAgent: { type: String, default: '' }
    }
  },
  {
    timestamps: true
  }
);

auditEventSchema.index({ warranty: 1, createdAt: -1 });
auditEventSchema.index({ user: 1, createdAt: -1 });
// Idempotency guard for retried correction requests. Sparse so events without
// a request ID are not forced to share a value.
auditEventSchema.index(
  { user: 1, requestId: 1 },
  { unique: true, partialFilterExpression: { requestId: { $type: 'string' } } }
);

const AuditEvent = mongoose.model('AuditEvent', auditEventSchema);

export default AuditEvent;
