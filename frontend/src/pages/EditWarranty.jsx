import React, { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useProductImageSearch } from '../hooks/useProductImageSearch';
import {
  ArrowLeft,
  Upload,
  FileText,
  Image as ImageIcon,
  DollarSign,
  Tag,
  Store,
  Hash,
  X,
  AlertCircle,
  Clock,
  ShieldCheck,
  Info,
  Lock,
  BadgeCheck,
  ScanLine
} from 'lucide-react';
import { fetchWarrantyById, updateWarranty, getFileUrl } from '../services/api';
import {
  calculateExpiryDate,
  formatCalendarDate,
  toDateInputValue
} from '../utils/expiry';
import { computeSensitiveChanges, newRequestId } from '../utils/controlledEdit';
import { useAuth } from '../context/AuthContext';
import LoadingSpinner from '../components/LoadingSpinner';
import SecureActionModal from '../components/SecureActionModal';

const CATEGORIES = ['Electronics', 'Appliances', 'Furniture', 'Vehicles', 'Accessories', 'Other'];
const UNITS = ['Days', 'Months', 'Years'];

const SensitiveBadge = ({ invoiceBacked, fromInvoice }) => {
  if (!invoiceBacked) return null;
  return (
    <span className="ml-2 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900/60 align-middle">
      <Lock className="w-3 h-3" />
      {fromInvoice ? 'Invoice-backed' : 'Protected'}
    </span>
  );
};

const EditWarranty = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});

  const [original, setOriginal] = useState(null);

  const [formData, setFormData] = useState({
    productName: '',
    brand: '',
    modelNumber: '',
    category: 'Electronics',
    purchaseDate: '',
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

  const [existingProductImage, setExistingProductImage] = useState('');

  const [productImageFile, setProductImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const [selectedOnlineImage, setSelectedOnlineImage] = useState('');

  // Controlled-correction modal state
  const [secureOpen, setSecureOpen] = useState(false);
  const [secureError, setSecureError] = useState('');
  const [requestId, setRequestId] = useState('');
  const [submittingSensitive, setSubmittingSensitive] = useState(false);

  const imageSearchQuery = [formData.productName, formData.brand].filter(Boolean).join(' ').trim();
  const {
    results: onlineImages,
    loading: onlineImageSearchLoading,
    error: onlineImageSearchError
  } = useProductImageSearch(imageSearchQuery);

  const invoiceBacked = Boolean(original?.isInvoiceBacked);
  const invoiceStatus = original?.invoice?.status || (original?.invoiceFile ? 'legacy' : 'none');

  useEffect(() => {
    const loadData = async () => {
      try {
        setLoading(true);
        const res = await fetchWarrantyById(id);
        if (res.success) {
          const w = res.data;
          setOriginal(w);

          setFormData({
            productName: w.productName || '',
            brand: w.brand || '',
            modelNumber: w.modelNumber || '',
            category: w.category || 'Other',
            purchaseDate: toDateInputValue(w.purchaseDate),
            warrantyStartDate: toDateInputValue(w.warrantyStartDate),
            warrantyDuration:
              w.warrantyDuration !== null && w.warrantyDuration !== undefined
                ? String(w.warrantyDuration)
                : '',
            warrantyUnit: w.warrantyUnit || 'Months',
            store: w.store || '',
            price: w.price !== null && w.price !== undefined ? String(w.price) : '',
            currency: w.currency || '',
            invoiceNumber: w.invoiceNumber || '',
            serialNumber: w.serialNumber || '',
            notes: w.notes || ''
          });

          setExistingProductImage(w.productImage || '');
        } else {
          setError('Failed to fetch warranty data.');
        }
      } catch (err) {
        console.error(err);
        setError('Error loading product details.');
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [id]);

  const sensitiveChanges = useMemo(
    () => (original ? computeSensitiveChanges(original, formData) : []),
    [original, formData]
  );

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

    if ((name === 'productName' || name === 'brand') && selectedOnlineImage) {
      setSelectedOnlineImage('');
      if (imagePreview === selectedOnlineImage) {
        setImagePreview(existingProductImage ? getFileUrl(existingProductImage) : null);
      }
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

  const removeImage = () => {
    setProductImageFile(null);
    setSelectedOnlineImage('');
    setImagePreview(null);
    setExistingProductImage('');
  };

  const validateForm = () => {
    const errors = {};
    if (!formData.productName.trim()) errors.productName = 'Product name is required';
    if (!formData.category) errors.category = 'Category is required';
    if (!formData.purchaseDate) errors.purchaseDate = 'Purchase date is required';
    if (!formData.warrantyDuration || Number(formData.warrantyDuration) <= 0) {
      errors.warrantyDuration = 'Valid warranty duration is required (minimum 1)';
    }
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const buildSubmission = ({ reason, freshPassword, freshGoogleCredential } = {}) => {
    const submissionData = new FormData();
    Object.keys(formData).forEach((key) => {
      submissionData.append(key, formData[key]);
    });

    if (productImageFile) {
      submissionData.append('productImage', productImageFile);
    } else if (selectedOnlineImage) {
      submissionData.append('onlineProductImage', selectedOnlineImage);
    } else if (!existingProductImage) {
      submissionData.append('removeProductImage', 'true');
    }

    // Invoice evidence is never sent through the ordinary update endpoint.
    // Replacement/removal uses the dedicated actions on Warranty Details.

    if (reason) submissionData.append('correctionReason', reason);
    if (freshPassword) submissionData.append('freshPassword', freshPassword);
    if (freshGoogleCredential) {
      submissionData.append('freshGoogleCredential', freshGoogleCredential);
    }
    if (requestId) submissionData.append('requestId', requestId);

    return submissionData;
  };

  const persistUpdate = async (options = {}) => {
    const response = await updateWarranty(id, buildSubmission(options));
    if (response.success) {
      navigate(`/warranties/${id}`, {
        state: {
          message:
            response.protectedFieldsChanged?.length > 0
              ? 'Sensitive details corrected. The account owner was notified.'
              : 'Warranty updated successfully!'
        }
      });
      return { ok: true };
    }
    return { ok: false, message: response.message || 'Failed to update warranty.' };
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (submitting || submittingSensitive) return;
    if (!validateForm()) return;

    const nextRequestId = newRequestId();
    setRequestId(nextRequestId);
    setError('');

    // Invoice-backed records require an explicit reason and fresh
    // authentication. The backend independently enforces this.
    if (invoiceBacked && sensitiveChanges.length > 0) {
      setSecureError('');
      setSecureOpen(true);
      return;
    }

    try {
      setSubmitting(true);
      const result = await persistUpdate();
      if (!result.ok) setError(result.message);
    } catch (err) {
      console.error(err);
      setError(err.response?.data?.message || 'Server error occurred while updating warranty.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSecureConfirm = async ({ reason, freshPassword, freshGoogleCredential }) => {
    try {
      setSubmittingSensitive(true);
      setSecureError('');
      const result = await persistUpdate({ reason, freshPassword, freshGoogleCredential });
      if (!result.ok) setSecureError(result.message);
    } catch (err) {
      console.error(err);
      setSecureError(
        err.response?.data?.message || 'Server error occurred while applying the correction.'
      );
    } finally {
      setSubmittingSensitive(false);
    }
  };

  if (loading) {
    return <LoadingSpinner label="Loading product data for editing..." />;
  }

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6 animate-fadeIn">
      <Link
        to={`/warranties/${id}`}
        className="inline-flex items-center space-x-2 text-sm font-semibold text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        <span>Cancel &amp; Back to Details</span>
      </Link>

      <div>
        <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 dark:text-white tracking-tight">
          Edit Warranty
        </h1>
        <p className="text-slate-500 dark:text-slate-400 text-sm mt-1">
          Update product details, notes, and warranty length. Invoice-backed fields require a
          reason and a fresh identity check.
        </p>
      </div>

      {invoiceBacked && (
        <div className="p-4 rounded-xl border border-amber-200 dark:border-amber-900/50 bg-amber-50 dark:bg-amber-950/30 text-amber-800 dark:text-amber-300 text-xs flex items-start gap-2">
          <ShieldCheck className="w-4 h-4 shrink-0 mt-0.5" />
          <span>
            This record is backed by invoice evidence. Changing fields marked{' '}
            <strong>Invoice-backed</strong> requires a meaningful reason, a fresh identity check,
            is written to the audit history, and notifies the account owner. The original invoice
            is never replaced by this form.
          </span>
        </div>
      )}

      {error && (
        <div className="p-4 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/60 rounded-xl flex items-center space-x-3 text-rose-700 dark:text-rose-300 text-sm">
          <AlertCircle className="w-5 h-5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <form onSubmit={handleSubmit} className="bg-white dark:bg-dark-850 rounded-2xl border border-slate-200/90 dark:border-dark-750/80 shadow-xs p-6 sm:p-8 space-y-8 transition-colors">
        <div>
          <h2 className="text-base font-bold text-slate-900 dark:text-white pb-3 border-b border-slate-100 dark:border-dark-800 flex items-center space-x-2">
            <Tag className="w-5 h-5 text-blue-600 dark:text-blue-400" />
            <span>1. Product Information</span>
          </h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 mt-4">
            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1.5">
                Product Name <span className="text-rose-500">*</span>
                <SensitiveBadge invoiceBacked={invoiceBacked} fromInvoice={original?.hasOriginalInvoice} />
              </label>
              <input
                type="text"
                name="productName"
                placeholder="Product Name"
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
                <SensitiveBadge invoiceBacked={invoiceBacked} />
              </label>
              <input
                type="text"
                name="brand"
                value={formData.brand}
                onChange={handleInputChange}
                className="w-full px-4 py-2.5 bg-slate-50 dark:bg-dark-900 border border-slate-200 dark:border-dark-700 rounded-xl text-sm text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1.5">
                Model Number
                <SensitiveBadge invoiceBacked={invoiceBacked} />
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

            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1.5">
                Serial Number / IMEI
                <SensitiveBadge invoiceBacked={invoiceBacked} />
              </label>
              <div className="relative">
                <Hash className="w-4 h-4 text-slate-400 dark:text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  name="serialNumber"
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
            <Store className="w-5 h-5 text-blue-600 dark:text-blue-400" />
            <span>2. Purchase Information</span>
          </h2>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-5 mt-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1.5">
                Purchase Date <span className="text-rose-500">*</span>
                <SensitiveBadge invoiceBacked={invoiceBacked} />
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
                <SensitiveBadge invoiceBacked={invoiceBacked} />
              </label>
              <input
                type="text"
                name="store"
                value={formData.store}
                onChange={handleInputChange}
                className="w-full px-4 py-2.5 bg-slate-50 dark:bg-dark-900 border border-slate-200 dark:border-dark-700 rounded-xl text-sm text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1.5">
                Purchase Amount
                <SensitiveBadge invoiceBacked={invoiceBacked} />
              </label>
              <div className="relative">
                <DollarSign className="w-4 h-4 text-slate-400 dark:text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  name="price"
                  value={formData.price}
                  onChange={handleInputChange}
                  className="w-full pl-9 pr-4 py-2.5 bg-slate-50 dark:bg-dark-900 border border-slate-200 dark:border-dark-700 rounded-xl text-sm text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1.5">
                Currency
                <SensitiveBadge invoiceBacked={invoiceBacked} />
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
                <SensitiveBadge invoiceBacked={invoiceBacked} />
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
          </div>
        </div>

        <div>
          <h2 className="text-base font-bold text-slate-900 dark:text-white pb-3 border-b border-slate-100 dark:border-dark-800 flex items-center space-x-2">
            <Clock className="w-5 h-5 text-blue-600 dark:text-blue-400" />
            <span>3. Warranty Details</span>
          </h2>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-5 mt-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1.5">
                Warranty Start Date
                <SensitiveBadge invoiceBacked={invoiceBacked} />
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
                <SensitiveBadge invoiceBacked={invoiceBacked} />
              </label>
              <input
                type="number"
                min="1"
                name="warrantyDuration"
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
                <SensitiveBadge invoiceBacked={invoiceBacked} />
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
            <span>4. Product Image</span>
          </h2>

          <div className="mt-4 space-y-4">
            {onlineImageSearchLoading && (
              <div className="flex items-center space-x-2 text-sm text-slate-500 dark:text-slate-400">
                <span className="w-4 h-4 border-2 border-slate-300 border-t-blue-600 rounded-full animate-spin" />
                <span>Searching for product image...</span>
              </div>
            )}

            {!onlineImageSearchLoading && onlineImageSearchError && (
              <p className="text-xs text-rose-500">{onlineImageSearchError}</p>
            )}

            {!onlineImageSearchLoading && !onlineImageSearchError && imageSearchQuery.length >= 3 && onlineImages.length === 0 && (
              <p className="text-xs text-slate-500 dark:text-slate-400">
                No suggested images found. You can upload a photo manually.
              </p>
            )}

            {onlineImages.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-slate-600 dark:text-slate-300 mb-2">
                  Suggested product images
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

            {imagePreview || existingProductImage ? (
              <div className="flex flex-col sm:flex-row sm:items-center gap-4">
                <div className="relative w-40 h-40 rounded-2xl overflow-hidden border border-slate-200 dark:border-dark-700 shadow-xs shrink-0">
                  <img
                    src={imagePreview || getFileUrl(existingProductImage)}
                    alt="Product Preview"
                    className="w-full h-full object-cover"
                  />
                  {selectedOnlineImage && !productImageFile && (
                    <span className="absolute bottom-1 left-1 text-[10px] bg-black/60 text-white px-1.5 py-0.5 rounded-md">
                      Online image
                    </span>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2">
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
                  Upload product photo
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
          </div>
        </div>

        <div>
          <h2 className="text-base font-bold text-slate-900 dark:text-white pb-3 border-b border-slate-100 dark:border-dark-800 flex items-center space-x-2">
            <FileText className="w-5 h-5 text-blue-600 dark:text-blue-400" />
            <span>5. Invoice / Receipt Document</span>
          </h2>

          <div className="mt-4 p-4 rounded-xl border border-slate-200 dark:border-dark-750 bg-slate-50 dark:bg-dark-900 flex items-start gap-3">
            <Lock className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
            <div className="text-xs text-slate-600 dark:text-slate-300">
              <p className="font-semibold text-slate-800 dark:text-slate-200">
                {invoiceStatus === 'removed'
                  ? 'Invoice evidence has been removed'
                  : invoiceStatus === 'stored' || invoiceStatus === 'confirmed'
                    ? 'Original invoice preserved'
                    : invoiceStatus === 'legacy'
                      ? 'Legacy invoice attached (no checksum)'
                      : 'No invoice attached'}
              </p>
              <p className="mt-1 leading-relaxed">
                Invoice evidence cannot be replaced or removed through this form. Use{' '}
                <Link to={`/warranties/${id}`} className="font-semibold underline">
                  Warranty Details
                </Link>{' '}
                to verify, replace, or remove the invoice. Those actions require a reason and a
                fresh identity check, and the original file is retained in version history.
              </p>
            </div>
          </div>
        </div>

        <div>
          <h2 className="text-base font-bold text-slate-900 dark:text-white pb-3 border-b border-slate-100 dark:border-dark-800 flex items-center space-x-2">
            <Info className="w-5 h-5 text-blue-600 dark:text-blue-400" />
            <span>6. Additional Notes &amp; Terms</span>
          </h2>

          <div className="mt-4">
            <textarea
              name="notes"
              rows="3"
              value={formData.notes}
              onChange={handleInputChange}
              className="w-full px-4 py-2.5 bg-slate-50 dark:bg-dark-900 border border-slate-200 dark:border-dark-700 rounded-xl text-sm text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>

        {invoiceBacked && sensitiveChanges.length > 0 && (
          <div className="p-4 rounded-xl border border-amber-200 dark:border-amber-900/50 bg-amber-50 dark:bg-amber-950/30 text-amber-800 dark:text-amber-300 text-xs flex items-start gap-2">
            <ScanLine className="w-4 h-4 shrink-0 mt-0.5" />
            <span>
              {sensitiveChanges.length} invoice-backed field
              {sensitiveChanges.length === 1 ? '' : 's'} changed. Saving will open the secure
              confirmation step.
            </span>
          </div>
        )}

        <div className="pt-4 border-t border-slate-100 dark:border-dark-800 flex items-center justify-end space-x-4">
          <Link
            to={`/warranties/${id}`}
            className="px-5 py-2.5 text-sm font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-dark-800 rounded-xl transition-colors"
          >
            Cancel
          </Link>
          <button
            type="submit"
            disabled={submitting || submittingSensitive}
            className="inline-flex items-center space-x-2 px-6 py-2.5 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 dark:bg-blue-600 dark:hover:bg-blue-500 rounded-xl shadow-sm shadow-blue-600/20 transition-all focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
          >
            {submitting ? (
              <>
                <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                <span>Updating Warranty...</span>
              </>
            ) : invoiceBacked && sensitiveChanges.length > 0 ? (
              <>
                <Lock className="w-4 h-4" />
                <span>Review &amp; Confirm Changes</span>
              </>
            ) : (
              <span>Save Changes</span>
            )}
          </button>
        </div>
      </form>

      <SecureActionModal
        isOpen={secureOpen}
        onClose={() => {
          if (!submittingSensitive) {
            setSecureOpen(false);
            setSecureError('');
          }
        }}
        onConfirm={handleSecureConfirm}
        title="Confirm invoice-backed corrections"
        description="These fields are supported by the original invoice. Confirm the reason and your identity to apply the correction."
        changes={sensitiveChanges}
        confirmLabel="Apply correction"
        loading={submittingSensitive}
        error={secureError}
        authMethods={user?.authMethods || { google: false, password: false }}
      />
    </div>
  );
};

export default EditWarranty;
