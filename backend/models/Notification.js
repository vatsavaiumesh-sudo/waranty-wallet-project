import mongoose from 'mongoose';

const notificationSchema = new mongoose.Schema(
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
    title: {
      type: String,
      required: true,
      trim: true
    },
    message: {
      type: String,
      required: true,
      trim: true
    },
    daysRemaining: {
      type: Number,
      required: true
    },
    // Expiry reminders use the configured interval (e.g. 30, 7, 1, 0).
    // Security notifications use a negative, event-unique value so that the
    // legacy unique index { user, warranty, reminderInterval } cannot block
    // multiple correction alerts for the same warranty.
    reminderInterval: {
      type: Number,
      required: true // e.g. 30, 7, 1, 0; negative for security events
    },
    type: {
      type: String,
      enum: ['EXPIRY_REMINDER', 'SECURITY_CORRECTION', 'GENERAL'],
      default: 'EXPIRY_REMINDER'
    },
    details: {
      type: mongoose.Schema.Types.Mixed,
      default: null
    },
    // Idempotency key for event-driven notifications (security corrections).
    dedupeKey: {
      type: String,
      default: null
    },
    isRead: {
      type: Boolean,
      default: false,
      index: true
    },
    // Legacy fields retained for existing clients.
    sentEmail: {
      type: Boolean,
      default: false
    },
    emailError: {
      type: String,
      default: null
    },
    // Durable delivery state used by the retry worker.
    emailStatus: {
      type: String,
      enum: ['not_required', 'pending', 'sent', 'failed'],
      default: 'not_required',
      index: true
    },
    emailAttempts: {
      type: Number,
      default: 0,
      min: 0
    },
    lastEmailAttemptAt: {
      type: Date,
      default: null
    },
    emailProviderId: {
      type: String,
      default: null
    },
    // Retry scheduling. Failed deliveries are retried with backoff until the
    // attempt cap or a permanent provider error is reached.
    nextEmailRetryAt: {
      type: Date,
      default: null
    },
    emailRetryable: {
      type: Boolean,
      default: true
    },
    emailLastErrorCode: {
      type: String,
      default: null
    }
  },
  {
    timestamps: true
  }
);

// Guarantee idempotency: Only 1 expiry notification per user, warranty, and
// reminder interval. Security notifications use unique negative intervals.
notificationSchema.index(
  { user: 1, warranty: 1, reminderInterval: 1 },
  { unique: true }
);

// Event-driven notifications can also be guarded by an explicit key.
notificationSchema.index(
  { dedupeKey: 1 },
  { unique: true, partialFilterExpression: { dedupeKey: { $type: 'string' } } }
);

// Retry worker scans pending/failed email deliveries.
notificationSchema.index({ emailStatus: 1, emailAttempts: 1, createdAt: 1 });
notificationSchema.index({ emailStatus: 1, emailRetryable: 1, nextEmailRetryAt: 1 });

const Notification = mongoose.model('Notification', notificationSchema);

export default Notification;
