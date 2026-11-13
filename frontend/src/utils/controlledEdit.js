import { SENSITIVE_FIELDS, getFieldLabel } from './fieldLabels';

/**
 * Client-side mirror of backend/utils/controlledEditHelpers.js.
 *
 * This is a UX aid only. The backend re-computes the changes and enforces the
 * correction workflow; a compromised frontend cannot bypass it.
 */

const isEmpty = (value) => value === undefined || value === null || value === '';

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

  return String(value).trim();
};

const displayValue = (field, value) => {
  if (isEmpty(value)) return '—';

  if (field === 'purchaseDate' || field === 'warrantyStartDate') {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return date.toISOString().slice(0, 10);
  }

  return String(value);
};

export const computeSensitiveChanges = (original = {}, next = {}) => {
  const changes = [];

  for (const field of SENSITIVE_FIELDS) {
    if (next[field] === undefined) continue;

    if (
      normalizeComparable(field, original[field]) !== normalizeComparable(field, next[field])
    ) {
      changes.push({
        field,
        label: getFieldLabel(field),
        previousValue: displayValue(field, original[field]),
        newValue: displayValue(field, next[field])
      });
    }
  }

  return changes;
};

export const newRequestId = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `req-${Date.now()}-${Math.random().toString(16).slice(2)}`;
};
