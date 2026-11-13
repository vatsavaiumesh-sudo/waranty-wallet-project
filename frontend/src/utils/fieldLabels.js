/**
 * Field metadata shared by the correction modal, audit history, and invoice
 * review. Keep this list in sync with backend/utils/controlledEditHelpers.js.
 */

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

export const FIELD_LABELS = {
  productName: 'Product name',
  brand: 'Brand',
  modelNumber: 'Model number',
  serialNumber: 'Serial number',
  purchaseDate: 'Purchase date',
  warrantyStartDate: 'Warranty start date',
  warrantyDuration: 'Warranty duration',
  warrantyUnit: 'Warranty unit',
  store: 'Seller / store',
  price: 'Purchase amount',
  currency: 'Currency',
  invoiceNumber: 'Invoice number',
  category: 'Category',
  notes: 'Notes',
  productImage: 'Product image',
  invoice: 'Invoice evidence'
};

export const getFieldLabel = (field) => FIELD_LABELS[field] || field;

export const EVIDENCE_STATUS_LABELS = {
  confirmed: 'Confirmed by you',
  extracted_unreviewed: 'Extracted — not confirmed',
  legacy_unverified: 'Legacy record — unverified'
};
