import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import {
  ArrowLeft,
  Upload,
  FileText,
  Image as ImageIcon,
  DollarSign,
  Tag,
  Store,
  Hash,
  FileCheck,
  X,
  AlertCircle,
  Clock,
  ShieldCheck,
  Info,
  ScanLine,
  BadgeCheck
} from 'lucide-react';
import { createWarranty, extractInvoice } from '../services/api';
import { useProductImageSearch } from '../hooks/useProductImageSearch';
import { calculateExpiryDate, formatCalendarDate } from '../utils/expiry';
import InvoiceReviewPanel from '../components/InvoiceReviewPanel';

const CATEGORIES = ['Electronics', 'Appliances', 'Furniture', 'Vehicles', 'Accessories', 'Other'];
const UNITS = ['Days', 'Months', 'Years'];

const FromInvoiceBadge = ({ fields, name }) =>
  fields && fields[name] ? (
    <span className="ml-2 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-bold bg-blue-50 text-blue-700 border border-blue-200 dark:bg-blue-950/50 dark:text-blue-300 dark:border-blue-900/60 align-middle">
      <ScanLine className="w-3 h-3" />
      From invoice
    </span>
  ) : null;

const AddWarranty = () => {
  const navigate = useNavigate();

  const [formData, setFormData] = useState({
    productName: '',
    brand: '',
    modelNumber: '',
    category: 'Electronics',
    purchaseDate: new Date().toISOString().split('T')[0],
    warrantyStartDate: '',
    warrantyDuration: '',
    warrantyUnit: 'Months',
    store: '',
    price: '',
    currency: '',
    invoiceNumber: '',
    serialNumber: '',
    notes: ''
  });

  const [productImageFile, setProductImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const [selectedOnlineImage, setSelectedOnlineImage] = useState('');
  const [invoiceFile, setInvoiceFile] = useState(null);
  const [invoiceUpload, setInvoiceUpload] = useState(null);
  const [invoiceProcessing, setInvoiceProcessing] = useState(false);
  const [invoiceError, setInvoiceError] = useState('');
  const [extractedFields, setExtractedFields] = useState({});

  const imageSearchQuery = [formData.productName, formData.brand].filter(Boolean).join(' ').trim();
  const {
    results: onlineImages,
    loading: onlineImageSearchLoading
  } = useProductImageSearch(imageSearchQuery);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});

  const expiryBaseDate = formData.warrantyStartDate || formData.purchaseDate;
  const expiryPreviewDate =
    expiryBaseDate && formData.warrantyDuration
      ? calculateExpiryDate(expiryBaseDate, formData.warrantyDuration, formData.warrantyUnit)
      : null;

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    if (fieldErrors[name]) {
      setFieldErrors((prev) => ({ ...prev, [name]: '' }));
    }
  };

  const handleImageChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      if (file.size > 5 * 1024 * 1024) {
        setError('Image file size must be less than 5MB');
        return;
      }
      setProductImageFile(file);
      setSelectedOnlineImage('');
      setImagePreview(URL.createObjectURL(file));
      setError('');
    }
  };

  const handleSelectOnlineImage = (url) => {
    setSelectedOnlineImage(url);
    setProductImageFile(null);
    setImagePreview(url);
    setError('');
  };

  const applyExtractedFields = (fields) => {
    if (!fields || typeof fields !== 'object') return;

    setFormData((prev) => {
      const next = { ...prev };
      const assign = (key, field) => {
        if (field && field.value !== undefined && field.value !== null && field.value !== '') {
          next[key] = String(field.value);
        }
      };

      assign('productName', fields.productName);
      assign('brand', fields.brand);
      assign('modelNumber', fields.modelNumber);
      assign('serialNumber', fields.serialNumber);
      assign('purchaseDate', fields.purchaseDate);
      assign('warrantyStartDate', fields.warrantyStartDate);
      assign('store', fields.store);
      assign('invoiceNumber', fields.invoiceNumber);
      assign('currency', fields.currency);
      assign('price', fields.price);

      // Only accept duration when the invoice itself states both the number
      // and the unit. Never infer a warranty period.
      if (fields.warrantyDuration?.value && fields.warrantyUnit?.value) {
        next.warrantyDuration = String(fields.warrantyDuration.value);
        next.warrantyUnit = fields.warrantyUnit.value;
      }

      return next;
    });
  };

  const processInvoice = async (file) => {
    setInvoiceProcessing(true);
    setInvoiceError('');
    setInvoiceUpload(null);
    setExtractedFields({});

    try {
      const submission = new FormData();
      submission.append('invoiceFile', file);
      const response = await extractInvoice(submission);

      if (response.success && response.data) {
        setInvoiceUpload(response.data);
        const fields = response.data.extraction?.fields || {};
        setExtractedFields(fields);
        applyExtractedFields(fields);
      } else {
        setInvoiceError(response.message || 'The invoice could not be read automatically.');
      }
    } catch (err) {
      console.error(err);
      setInvoiceError(
        err.response?.data?.message ||
          'Invoice reading failed. You can still enter the details manually and save with the invoice attached.'
      );
    } finally {
      setInvoiceProcessing(false);
    }
  };

  const handleInvoiceChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      setError('Document file size must be less than 5MB');
      return;
    }
    setInvoiceFile(file);
    setError('');
    await processInvoice(file);
  };

  const removeImage = () => {
    setProductImageFile(null);
    setSelectedOnlineImage('');
    setImagePreview(null);
  };

  const removeInvoice = () => {
    setInvoiceFile(null);
    setInvoiceUpload(null);
    setExtractedFields({});
    setInvoiceError('');
  };

  const validateForm = () => {
    const errors = {};
    if (!formData.productName.trim()) errors.productName = 'Product name is required';
    if (!formData.category) errors.category = 'Category is required';
    if (!formData.purchaseDate) errors.purchaseDate = 'Purchase date is required';
    if (!formData.warrantyDuration || Number(formData.warrantyDuration) <= 0) {
      errors.warrantyDuration = 'Enter the warranty duration stated by the manufacturer or invoice';
    }
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (loading || invoiceProcessing) return;
    if (!validateForm()) return;

    try {
      setLoading(true);
      setError('');

      const submissionData = new FormData();
      Object.keys(formData).forEach((key) => {
        submissionData.append(key, formData[key]);
      });

      if (productImageFile) {
        submissionData.append('productImage', productImageFile);
      } else if (selectedOnlineImage) {
        submissionData.append('onlineProductImage', selectedOnlineImage);
      }

      // Use the reviewed draft so the file is not uploaded twice. If extraction
      // failed before a draft was created, still attach the original file.
      if (invoiceUpload?.uploadId) {
        submissionData.append('invoiceUploadId', invoiceUpload.uploadId);
      } else if (invoiceFile) {
        submissionData.append('invoiceFile', invoiceFile);
      }

      const response = await createWarranty(submissionData);
      if (response.success) {
        navigate('/warranties', { state: { message: 'Warranty product added successfully!' } });
      } else {
        setError(response.message || 'Failed to save warranty.');
      }
    } catch (err) {
      console.error(err);
      setError(err.response?.data?.message || 'Server error occurred while saving warranty.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6 animate-fadeIn">
      <Link
        to="/warranties"
        className="inline-flex items-center space-x-2 text-sm font-semibold text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        <span>Back to Warranties</span>
      </Link>

      <div>
        <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 dark:text-white tracking-tight">
          Add New Warranty
        </h1>
        <p className="text-slate-500 dark:text-slate-400 text-sm mt-1">
          Start with an invoice to auto-fill what can be read, then review every value before saving.
        </p>
      </div>

      {error && (
        <div className="p-4 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/60 rounded-xl flex items-center space-x-3 text-rose-700 dark:text-rose-300 text-sm">
          <AlertCircle className="w-5 h-5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Step 1: invoice upload and review */}
      <div className="bg-white dark:bg-dark-850 rounded-2xl border border-slate-200/90 dark:border-dark-750/80 shadow-xs p-6 sm:p-8 space-y-4 transition-colors">
        <div>
          <h2 className="text-base font-bold text-slate-900 dark:text-white pb-3 border-b border-slate-100 dark:border-dark-800 flex items-center space-x-2">
            <FileText className="w-5 h-5 text-blue-600 dark:text-blue-400" />
            <span>1. Invoice / Receipt (optional)</span>
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-3">
            Upload a text PDF, scanned PDF, JPG, or PNG. The original file is preserved with a SHA-256
            checksum. If automatic reading is unavailable, you can still fill the form manually.
          </p>
        </div>

        {invoiceProcessing && (
          <div className="p-4 rounded-xl border border-blue-200/80 dark:border-blue-900/50 bg-blue-50/70 dark:bg-blue-950/30 flex items-center space-x-3 text-sm text-blue-800 dark:text-blue-300">
            <span className="w-4 h-4 border-2 border-blue-300 border-t-blue-700 rounded-full animate-spin" />
            <span>Reading invoice and storing the original evidence...</span>
          </div>
        )}

        {invoiceError && (
          <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/50 text-amber-800 dark:text-amber-300 text-xs flex items-start gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{invoiceError}</span>
          </div>
        )}

        {invoiceFile ? (
          <div className="flex items-center justify-between p-4 rounded-xl border border-slate-200 dark:border-dark-700 bg-slate-50 dark:bg-dark-900 gap-3">
            <div className="flex items-center space-x-3 overflow-hidden">
              <FileCheck className="w-6 h-6 text-blue-600 dark:text-blue-400 shrink-0" />
              <div className="truncate">
                <p className="text-sm font-semibold text-slate-800 dark:text-slate-200 truncate">
                  {invoiceFile.name}
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {(invoiceFile.size / (1024 * 1024)).toFixed(2)} MB • {invoiceFile.type || 'Document'}
                  {invoiceUpload?.invoice?.checksum ? ' • checksum captured' : ''}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={removeInvoice}
              disabled={invoiceProcessing}
              className="p-1.5 text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 rounded-lg hover:bg-slate-100 dark:hover:bg-dark-800 transition-colors disabled:opacity-50"
              title="Remove invoice from this form"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        ) : (
          <label className="flex flex-col items-center justify-center p-6 border-2 border-dashed border-slate-300 dark:border-dark-700 rounded-2xl hover:border-blue-400 dark:hover:border-blue-500 hover:bg-slate-50 dark:hover:bg-dark-900 cursor-pointer transition-colors group">
            <div className="w-12 h-12 rounded-xl bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 flex items-center justify-center mb-2 group-hover:scale-105 transition-transform">
              <Upload className="w-6 h-6" />
            </div>
            <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">
              Upload invoice or purchase receipt
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              Supports PDF, JPG, PNG, WEBP (Max 5MB)
            </p>
            <input
              type="file"
              accept="application/pdf,image/jpeg,image/png,image/webp"
              onChange={handleInvoiceChange}
              className="hidden"
            />
          </label>
        )}

        {invoiceUpload && (
          <InvoiceReviewPanel
            invoice={invoiceUpload.invoice}
            extraction={invoiceUpload.extraction}
            onClear={removeInvoice}
          />
        )}
      </div>

      {/* Steps 2-5: confirmed warranty details */}
      <form
        onSubmit={handleSubmit}
        className="bg-white dark:bg-dark-850 rounded-2xl border border-slate-200/90 dark:border-dark-750/80 shadow-xs p-6 sm:p-8 space-y-8 transition-colors"
      >
        <div>
          <h2 className="text-base font-bold text-slate-900 dark:text-white pb-3 border-b border-slate-100 dark:border-dark-800 flex items-center space-x-2">
            <Tag className="w-5 h-5 text-blue-600 dark:text-blue-400" />
            <span>2. Product Information</span>
          </h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 mt-4">
            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1.5">
                Product Name <span className="text-rose-500">*</span>
                <FromInvoiceBadge fields={extractedFields} name="productName" />
              </label>
              <input
                type="text"
                name="productName"
                placeholder="e.g. Sony WH-1000XM5 Noise Canceling Headphones"
                value={formData.productName}
                onChange={handleInputChange}
                className={`w-full px-4 py-2.5 bg-slate-50 dark:bg-dark-900 border ${
                  fieldErrors.productName ? 'border-rose-500' : 'border-slate-200 dark:border-dark-700'
                } rounded-xl text-sm text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500`}
              />
              {fieldErrors.productName && (
                <p className="mt-1 text-xs text-rose-500">{fieldErrors.productName}</p>
              )}
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1.5">
                Brand / Manufacturer
                <FromInvoiceBadge fields={extractedFields} name="brand" />
              </label>
              <input
                type="text"
                name="brand"
                placeholder="e.g. Sony, Apple, Samsung"
                value={formData.brand}
                onChange={handleInputChange}
                className="w-full px-4 py-2.5 bg-slate-50 dark:bg-dark-900 border border-slate-200 dark:border-dark-700 rounded-xl text-sm text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1.5">
                Model Number
                <FromInvoiceBadge fields={extractedFields} name="modelNumber" />
              </label>
              <input
                type="text"
                name="modelNumber"
                placeholder="e.g. WH-1000XM5"
                value={formData.modelNumber}
                onChange={handleInputChange}
                className="w-full px-4 py-2.5 bg-slate-50 dark:bg-dark-900 border border-slate-200 dark:border-dark-700 rounded-xl text-sm text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1.5">
                Category <span className="text-rose-500">*</span>
              </label>
              <select
                name="category"
                value={formData.category}
                onChange={handleInputChange}
                className="w-full px-4 py-2.5 bg-slate-50 dark:bg-dark-900 border border-slate-200 dark:border-dark-700 rounded-xl text-sm font-medium text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {CATEGORIES.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        <div>
          <h2 className="text-base font-bold text-slate-900 dark:text-white pb-3 border-b border-slate-100 dark:border-dark-800 flex items-center space-x-2">
            <Store className="w-5 h-5 text-blue-600 dark:text-blue-400" />
            <span>3. Purchase Information</span>
          </h2>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-5 mt-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1.5">
                Purchase Date <span className="text-rose-500">*</span>
                <FromInvoiceBadge fields={extractedFields} name="purchaseDate" />
              </label>
              <input
                type="date"
                name="purchaseDate"
                value={formData.purchaseDate}
                onChange={handleInputChange}
                className={`w-full px-4 py-2.5 bg-slate-50 dark:bg-dark-900 border ${
                  fieldErrors.purchaseDate ? 'border-rose-500' : 'border-slate-200 dark:border-dark-700'
                } rounded-xl text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500`}
              />
              {fieldErrors.purchaseDate && (
                <p className="mt-1 text-xs text-rose-500">{fieldErrors.purchaseDate}</p>
              )}
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1.5">
                Store / Vendor
                <FromInvoiceBadge fields={extractedFields} name="store" />
              </label>
              <input
                type="text"
                name="store"
                placeholder="e.g. Best Buy, Amazon"
                value={formData.store}
                onChange={handleInputChange}
                className="w-full px-4 py-2.5 bg-slate-50 dark:bg-dark-900 border border-slate-200 dark:border-dark-700 rounded-xl text-sm text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1.5">
                Purchase Amount
                <FromInvoiceBadge fields={extractedFields} name="price" />
              </label>
              <div className="relative">
                <DollarSign className="w-4 h-4 text-slate-400 dark:text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  name="price"
                  placeholder="0.00"
                  value={formData.price}
                  onChange={handleInputChange}
                  className="w-full pl-9 pr-4 py-2.5 bg-slate-50 dark:bg-dark-900 border border-slate-200 dark:border-dark-700 rounded-xl text-sm text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1.5">
                Currency
                <FromInvoiceBadge fields={extractedFields} name="currency" />
              </label>
              <input
                type="text"
                name="currency"
                maxLength="3"
                placeholder="USD, INR, EUR"
                value={formData.currency}
                onChange={handleInputChange}
                className="w-full px-4 py-2.5 bg-slate-50 dark:bg-dark-900 border border-slate-200 dark:border-dark-700 rounded-xl text-sm uppercase text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1.5">
                Invoice Number
                <FromInvoiceBadge fields={extractedFields} name="invoiceNumber" />
              </label>
              <input
                type="text"
                name="invoiceNumber"
                placeholder="e.g. INV-2026-0042"
                value={formData.invoiceNumber}
                onChange={handleInputChange}
                className="w-full px-4 py-2.5 bg-slate-50 dark:bg-dark-900 border border-slate-200 dark:border-dark-700 rounded-xl text-sm text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1.5">
                Serial Number / IMEI
                <FromInvoiceBadge fields={extractedFields} name="serialNumber" />
              </label>
              <div className="relative">
                <Hash className="w-4 h-4 text-slate-400 dark:text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  name="serialNumber"
                  placeholder="e.g. SN-8923048204-X"
                  value={formData.serialNumber}
                  onChange={handleInputChange}
                  className="w-full pl-9 pr-4 py-2.5 bg-slate-50 dark:bg-dark-900 border border-slate-200 dark:border-dark-700 rounded-xl text-sm font-mono text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
          </div>
        </div>

        <div>
          <h2 className="text-base font-bold text-slate-900 dark:text-white pb-3 border-b border-slate-100 dark:border-dark-800 flex items-center space-x-2">
            <Clock className="w-5 h-5 text-blue-600 dark:text-blue-400" />
            <span>4. Warranty Details</span>
          </h2>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-5 mt-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1.5">
                Warranty Start Date (optional)
                <FromInvoiceBadge fields={extractedFields} name="warrantyStartDate" />
              </label>
              <input
                type="date"
                name="warrantyStartDate"
                value={formData.warrantyStartDate}
                onChange={handleInputChange}
                className="w-full px-4 py-2.5 bg-slate-50 dark:bg-dark-900 border border-slate-200 dark:border-dark-700 rounded-xl text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <p className="mt-1 text-[11px] text-slate-400">
                Leave blank to use the purchase date.
              </p>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1.5">
                Warranty Duration <span className="text-rose-500">*</span>
                <FromInvoiceBadge fields={extractedFields} name="warrantyDuration" />
              </label>
              <input
                type="number"
                min="1"
                name="warrantyDuration"
                placeholder="Enter duration"
                value={formData.warrantyDuration}
                onChange={handleInputChange}
                className={`w-full px-4 py-2.5 bg-slate-50 dark:bg-dark-900 border ${
                  fieldErrors.warrantyDuration ? 'border-rose-500' : 'border-slate-200 dark:border-dark-700'
                } rounded-xl text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500`}
              />
              {fieldErrors.warrantyDuration && (
                <p className="mt-1 text-xs text-rose-500">{fieldErrors.warrantyDuration}</p>
              )}
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1.5">
                Unit <span className="text-rose-500">*</span>
                <FromInvoiceBadge fields={extractedFields} name="warrantyUnit" />
              </label>
              <select
                name="warrantyUnit"
                value={formData.warrantyUnit}
                onChange={handleInputChange}
                className="w-full px-4 py-2.5 bg-slate-50 dark:bg-dark-900 border border-slate-200 dark:border-dark-700 rounded-xl text-sm font-medium text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {UNITS.map((u) => (
                  <option key={u} value={u}>
                    {u}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {!formData.warrantyDuration && (
            <div className="mt-4 p-3 rounded-xl border border-amber-200 dark:border-amber-900/50 bg-amber-50 dark:bg-amber-950/30 text-amber-800 dark:text-amber-300 text-xs flex items-start gap-2">
              <Info className="w-4 h-4 shrink-0 mt-0.5" />
              <span>
                The warranty duration is not inferred from the product category or model. Enter the
                duration stated by the seller, manufacturer, or invoice.
              </span>
            </div>
          )}

          {expiryPreviewDate && (
            <div className="mt-4 p-4 rounded-xl border border-blue-200/80 dark:border-blue-900/50 bg-blue-50/70 dark:bg-blue-950/30 flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <ShieldCheck className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                <div>
                  <p className="text-xs font-semibold text-blue-900 dark:text-blue-300">
                    Calculated Warranty Expiry:
                  </p>
                  <p className="text-sm font-bold text-blue-800 dark:text-blue-200">
                    {formatCalendarDate(expiryPreviewDate)}
                  </p>
                </div>
              </div>
              <span className="text-xs px-2.5 py-1 rounded-md bg-blue-100 dark:bg-blue-900/60 text-blue-700 dark:text-blue-300 font-semibold flex items-center gap-1">
                <BadgeCheck className="w-3.5 h-3.5" />
                Calendar-aware
              </span>
            </div>
          )}
        </div>

        <div>
          <h2 className="text-base font-bold text-slate-900 dark:text-white pb-3 border-b border-slate-100 dark:border-dark-800 flex items-center space-x-2">
            <ImageIcon className="w-5 h-5 text-blue-600 dark:text-blue-400" />
            <span>5. Product Image</span>
          </h2>

          <div className="mt-4 space-y-4">
            {onlineImageSearchLoading && (
              <div className="flex items-center space-x-2 text-sm text-slate-500 dark:text-slate-400">
                <span className="w-4 h-4 border-2 border-slate-300 border-t-blue-600 rounded-full animate-spin" />
                <span>Searching for product image...</span>
              </div>
            )}

            {!onlineImageSearchLoading && onlineImages.length > 0 && !imagePreview && (
              <div>
                <p className="text-xs font-semibold text-slate-600 dark:text-slate-300 mb-2">
                  Suggested product images (click to use)
                </p>
                <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                  {onlineImages.map((img) => (
                    <button
                      type="button"
                      key={img.id}
                      onClick={() => handleSelectOnlineImage(img.imageUrl || img.thumbnailUrl)}
                      className="relative aspect-square rounded-xl overflow-hidden border border-slate-200 dark:border-dark-700 hover:border-blue-500 transition-all group"
                      title={img.title}
                    >
                      <img
                        src={img.thumbnailUrl || img.imageUrl}
                        alt={img.title}
                        className="w-full h-full object-cover"
                        loading="lazy"
                      />
                    </button>
                  ))}
                </div>
              </div>
            )}

            {!onlineImageSearchLoading &&
              formData.productName.trim().length >= 3 &&
              onlineImages.length === 0 && (
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  No online image found. You can upload a photo manually.
                </p>
              )}

            {imagePreview ? (
              <div className="flex flex-col sm:flex-row sm:items-center gap-4">
                <div className="relative w-40 h-40 rounded-2xl overflow-hidden border border-slate-200 dark:border-dark-700 shadow-xs shrink-0">
                  <img src={imagePreview} alt="Preview" className="w-full h-full object-cover" />
                  {selectedOnlineImage && !productImageFile && (
                    <span className="absolute bottom-1 left-1 text-[10px] bg-black/60 text-white px-1.5 py-0.5 rounded-md">
                      Online image
                    </span>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedOnlineImage('');
                      setImagePreview(null);
                      setProductImageFile(null);
                    }}
                    className="inline-flex items-center space-x-1 px-3 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-dark-800 hover:bg-slate-200 dark:hover:bg-dark-700 rounded-xl transition-colors"
                  >
                    <span>Change image</span>
                  </button>
                  <button
                    type="button"
                    onClick={removeImage}
                    className="inline-flex items-center space-x-1 px-3 py-2 text-xs font-semibold text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/40 hover:bg-rose-100 dark:hover:bg-rose-900/30 rounded-xl transition-colors"
                  >
                    <X className="w-3.5 h-3.5" />
                    <span>Remove image</span>
                  </button>
                  <label className="inline-flex items-center space-x-1 px-3 py-2 text-xs font-semibold text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/40 hover:bg-blue-100 dark:hover:bg-blue-900/30 rounded-xl transition-colors cursor-pointer">
                    <Upload className="w-3.5 h-3.5" />
                    <span>Upload manually</span>
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      onChange={handleImageChange}
                      className="hidden"
                    />
                  </label>
                </div>
              </div>
            ) : (
              <label className="flex flex-col items-center justify-center p-6 border-2 border-dashed border-slate-300 dark:border-dark-700 rounded-2xl hover:border-blue-400 dark:hover:border-blue-500 hover:bg-slate-50 dark:hover:bg-dark-900 cursor-pointer transition-colors group">
                <div className="w-12 h-12 rounded-xl bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 flex items-center justify-center mb-2 group-hover:scale-105 transition-transform">
                  <Upload className="w-6 h-6" />
                </div>
                <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">
                  Upload product photo manually
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                  Supports JPG, PNG, WEBP (Max 5MB)
                </p>
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={handleImageChange}
                  className="hidden"
                />
              </label>
            )}

            {!onlineImageSearchLoading && onlineImages.length > 0 && imagePreview && (
              <details className="text-xs">
                <summary className="cursor-pointer text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200">
                  Change suggested image
                </summary>
                <div className="mt-2 grid grid-cols-4 gap-2">
                  {onlineImages.map((img) => (
                    <button
                      type="button"
                      key={img.id}
                      onClick={() => handleSelectOnlineImage(img.imageUrl || img.thumbnailUrl)}
                      className="relative aspect-square rounded-lg overflow-hidden border border-slate-200 dark:border-dark-700 hover:border-blue-500 transition-all"
                      title={img.title}
                    >
                      <img
                        src={img.thumbnailUrl || img.imageUrl}
                        alt={img.title}
                        className="w-full h-full object-cover"
                        loading="lazy"
                      />
                    </button>
                  ))}
                </div>
              </details>
            )}
          </div>
        </div>

        <div>
          <h2 className="text-base font-bold text-slate-900 dark:text-white pb-3 border-b border-slate-100 dark:border-dark-800 flex items-center space-x-2">
            <Info className="w-5 h-5 text-blue-600 dark:text-blue-400" />
            <span>6. Additional Notes & Terms</span>
          </h2>

          <div className="mt-4">
            <textarea
              name="notes"
              rows="3"
              placeholder="e.g. Requires registration within 30 days of purchase. Includes 2 years on compressor."
              value={formData.notes}
              onChange={handleInputChange}
              className="w-full px-4 py-2.5 bg-slate-50 dark:bg-dark-900 border border-slate-200 dark:border-dark-700 rounded-xl text-sm text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>

        <div className="pt-4 border-t border-slate-100 dark:border-dark-800 flex items-center justify-end space-x-4">
          <Link
            to="/warranties"
            className="px-5 py-2.5 text-sm font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-dark-800 rounded-xl transition-colors"
          >
            Cancel
          </Link>
          <button
            type="submit"
            disabled={loading || invoiceProcessing}
            className="inline-flex items-center space-x-2 px-6 py-2.5 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 dark:bg-blue-600 dark:hover:bg-blue-500 rounded-xl shadow-sm shadow-blue-600/20 transition-all focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
          >
            {loading ? (
              <>
                <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                <span>Saving Warranty...</span>
              </>
            ) : (
              <span>Confirm & Save Warranty</span>
            )}
          </button>
        </div>
      </form>
    </div>
  );
};

export default AddWarranty;
