/**
 * Field classification and comparison helpers for controlled warranty editing.
 *
 * These rules are enforced on the backend. Frontend hints are only a UX aid.
 */

// Fields that describe the purchase and are backed by invoice evidence.
export const SENSITIVE_FIELDS = [
  'productName',
  'brand',
  'modelNumber',
  'purchaseDate',
  'warrantyStartDate',
  'warrantyDuration',
  'warrantyUnit',
  'store',
  'price',
  'currency',
  'invoiceNumber',
  'serialNumber'
];

// Fields that can be edited without the correction workflow.
export const NON_SENSITIVE_FIELDS = ['category', 'notes', 'productImage'];

// Fields that ordinary warranty updates must never write.
export const PROTECTED_BODY_FIELDS = [
  'user',
  'invoice',
  'invoiceFile',
  'recordVersion',
  'evidenceStatus',
  'deletedAt',
  'lastCorrectionAt',
  'lastCorrectionBy'
];

export const MIN_CORRECTION_REASON_LENGTH = 10;
export const MAX_CORRECTION_REASON_LENGTH = 500;

const isEmpty = (value) => value === undefined || value === null || value === '';

/**
 * Normalizes a value for equality comparison without changing the value that
 * will be stored.
 */
export const normalizeComparable = (field, value) => {
  if (isEmpty(value)) return '';

  if (field === 'purchaseDate' || field === 'warrantyStartDate') {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '' : date.toISOString();
  }

  if (field === 'price' || field === 'warrantyDuration') {
    const number = Number(value);
    return Number.isFinite(number) ? number : '';
  }

  if (field === 'warrantyUnit') {
    return String(value).trim();
  }

  return String(value).trim();
};

const humanize = (value) => {
  if (value instanceof Date) return value.toISOString();
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
};

/**
 * Returns the sensitive changes requested by a request body. Only fields that
 * are present in the body and actually differ from the current record are
 * included.
 *
 * @param {Object} warranty
 * @param {Object} body
 * @returns {Array<{field: string, previousValue: *, newValue: *}>}
 */
export const computeSensitiveChanges = (warranty, body = {}) => {
  const changes = [];

  for (const field of SENSITIVE_FIELDS) {
    if (body[field] === undefined) continue;

    const previousValue = warranty[field];
    const newValue = body[field];

    if (
      normalizeComparable(field, previousValue) !==
      normalizeComparable(field, newValue)
    ) {
      changes.push({
        field,
        previousValue: humanize(previousValue),
        newValue: humanize(newValue)
      });
    }
  }

  return changes;
};

/**
 * Returns true when an ordinary update tries to touch invoice evidence or
 * server-managed fields.
 */
export const findProtectedBodyFields = (body = {}) => {
  return PROTECTED_BODY_FIELDS.filter((field) => body[field] !== undefined);
};

/**
 * Validates a correction reason. Returns a structured result so callers can
 * return a useful API error.
 */
export const validateCorrectionReason = (reason) => {
  const cleaned = typeof reason === 'string' ? reason.trim() : '';

  if (!cleaned) {
    return {
      valid: false,
      message: 'A correction reason is required for changes to invoice-backed fields.'
    };
  }

  if (cleaned.length < MIN_CORRECTION_REASON_LENGTH) {
    return {
      valid: false,
      message: `Please provide a meaningful correction reason of at least ${MIN_CORRECTION_REASON_LENGTH} characters.`
    };
  }

  if (cleaned.length > MAX_CORRECTION_REASON_LENGTH) {
    return {
      valid: false,
      message: `Correction reason cannot exceed ${MAX_CORRECTION_REASON_LENGTH} characters.`
    };
  }

  return { valid: true, reason: cleaned };
};

/**
 * Produces a stable, unique-enough negative reminderInterval for a security
 * notification. The legacy Notification unique index keys on
 * { user, warranty, reminderInterval }, so each correction alert needs its own
 * negative value.
 */
export const securityReminderInterval = (now = Date.now()) => {
  return -1 * (Math.floor(now / 1000) * 1000 + Math.floor(Math.random() * 1000));
};

/**
 * Human-readable labels used by audit history and correction emails.
 */
export const FIELD_LABELS = {
  productName: 'Product name',
  brand: 'Brand',
  modelNumber: 'Model number',
  purchaseDate: 'Purchase date',
  warrantyStartDate: 'Warranty start date',
  warrantyDuration: 'Warranty duration',
  warrantyUnit: 'Warranty unit',
  store: 'Seller / store',
  price: 'Purchase amount',
  currency: 'Currency',
  invoiceNumber: 'Invoice number',
  serialNumber: 'Serial number',
  category: 'Category',
  notes: 'Notes',
  productImage: 'Product image'
};

export const fieldLabel = (field) => FIELD_LABELS[field] || field;
