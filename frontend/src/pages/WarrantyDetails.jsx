import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
  ArrowLeft,
  Edit3,
  Trash2,
  Calendar,
  Clock,
  Store,
  DollarSign,
  Hash,
  FileText,
  ExternalLink,
  Package,
  AlertCircle,
  FileCheck,
  Tag,
  ShieldCheck,
  ShieldAlert,
  ShieldQuestion,
  RefreshCw,
  Upload,
  History,
  Lock,
  BadgeCheck,
  X
} from 'lucide-react';
import {
  fetchWarrantyById,
  deleteWarranty,
  getFileUrl,
  fetchInvoiceUrl,
  verifyInvoiceIntegrity,
  replaceWarrantyInvoice,
  removeWarrantyInvoice,
  fetchWarrantyAudit
} from '../services/api';
import { formatDate, formatCurrency } from '../utils/formatters';
import { EVIDENCE_STATUS_LABELS, getFieldLabel } from '../utils/fieldLabels';
import { newRequestId } from '../utils/controlledEdit';
import { useAuth } from '../context/AuthContext';
import StatusBadge from '../components/StatusBadge';
import LoadingSpinner from '../components/LoadingSpinner';
import ConfirmModal from '../components/ConfirmModal';
import SecureActionModal from '../components/SecureActionModal';

const ACTION_LABELS = {
  WARRANTY_CREATED: 'Warranty created',
  WARRANTY_UPDATED: 'Warranty updated',
  SENSITIVE_CORRECTION: 'Sensitive correction',
  INVOICE_UPLOADED: 'Invoice uploaded',
  INVOICE_REPLACED: 'Invoice replaced',
  INVOICE_REMOVED: 'Invoice removed',
  WARRANTY_DELETED: 'Warranty archived'
};

const formatBytes = (bytes) => {
  const value = Number(bytes) || 0;
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(2)} MB`;
};

const formatDateTime = (value) => {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date);
};

const EvidenceBadge = ({ status, invoiceBacked }) => {
  const map = {
    confirmed: {
      label: 'Confirmed',
      Icon: BadgeCheck,
      cls: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-900/50'
    },
    extracted_unreviewed: {
      label: 'Extracted — unconfirmed',
      Icon: ShieldQuestion,
      cls: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900/50'
    },
    legacy_unverified: {
      label: 'Legacy — unverified',
      Icon: ShieldAlert,
      cls: 'bg-slate-100 text-slate-600 border-slate-200 dark:bg-dark-800 dark:text-slate-300 dark:border-dark-700'
    }
  };
  const config = map[status] || map.legacy_unverified;
  const Icon = config.Icon;

  return (
    <span
      className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-bold uppercase tracking-wider border ${config.cls}`}
      title={EVIDENCE_STATUS_LABELS[status] || ''}
    >
      <Icon className="w-3.5 h-3.5" />
      {config.label}
      {!invoiceBacked && ' • no invoice'}
    </span>
  );
};

const WarrantyDetails = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [warranty, setWarranty] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState('');

  // Delete modal state
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  // Invoice viewing and verification
  const [openingInvoice, setOpeningInvoice] = useState(false);
  const [verifyState, setVerifyState] = useState(null);
  const [verifying, setVerifying] = useState(false);
  const [verifyError, setVerifyError] = useState('');

  // Invoice replace / remove
  const [invoiceAction, setInvoiceAction] = useState(null); // 'replace' | 'remove'
  const [replacementFile, setReplacementFile] = useState(null);
  const [invoiceActionLoading, setInvoiceActionLoading] = useState(false);
  const [invoiceActionError, setInvoiceActionError] = useState('');
  const [invoiceRequestId, setInvoiceRequestId] = useState('');

  // Audit history
  const [audit, setAudit] = useState([]);
  const [auditLoading, setAuditLoading] = useState(true);
  const [auditError, setAuditError] = useState('');

  const loadWarranty = async () => {
    const res = await fetchWarrantyById(id);
    if (res.success) {
      setWarranty(res.data);
      return res.data;
    }
    throw new Error('Warranty details not found.');
  };

  const loadAudit = async () => {
    try {
      setAuditLoading(true);
      setAuditError('');
      const res = await fetchWarrantyAudit(id);
      if (res.success) setAudit(res.data || []);
    } catch (err) {
      console.error(err);
      setAuditError('Could not load the audit history.');
    } finally {
      setAuditLoading(false);
    }
  };

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        setLoading(true);
        setError(null);
        const data = await fetchWarrantyById(id);
        if (!cancelled) {
          if (data.success) setWarranty(data.data);
          else setError('Warranty details not found.');
        }
      } catch (err) {
        console.error(err);
        if (!cancelled) setError('Failed to load warranty product details.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    loadAudit();

    return () => {
      cancelled = true;
    };
  }, [id]);

  const handleDeleteConfirm = async () => {
    try {
      setIsDeleting(true);
      const res = await deleteWarranty(id);
      if (res.success) {
        navigate('/warranties', { state: { message: 'Warranty deleted successfully' } });
      }
    } catch (err) {
      console.error(err);
      alert('Failed to delete warranty. Please try again.');
    } finally {
      setIsDeleting(false);
      setDeleteModalOpen(false);
    }
  };

  if (loading) {
    return <LoadingSpinner label="Loading product warranty details..." />;
  }

  if (error || !warranty) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-12 text-center animate-fadeIn">
        <div className="p-6 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/60 rounded-2xl max-w-lg mx-auto">
          <AlertCircle className="w-10 h-10 text-rose-600 dark:text-rose-400 mx-auto mb-3" />
          <h3 className="text-lg font-bold text-rose-900 dark:text-rose-200 mb-1">Product Not Found</h3>
          <p className="text-sm text-rose-700 dark:text-rose-300 mb-4">{error}</p>
          <Link
            to="/warranties"
            className="inline-flex items-center space-x-2 px-4 py-2 bg-rose-600 text-white rounded-xl text-sm font-semibold hover:bg-rose-700 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Return to Warranties</span>
          </Link>
        </div>
      </div>
    );
  }

  const {
    _id,
    productName,
    brand,
    category,
    modelNumber,
    purchaseDate,
    warrantyStartDate,
    warrantyDuration,
    warrantyUnit,
    warrantyExpiryDate,
    store,
    price,
    currency,
    invoiceNumber,
    serialNumber,
    notes,
    productImage,
    invoiceFile,
    invoice,
    evidenceStatus,
    isInvoiceBacked,
    recordVersion,
    status,
    formattedDaysLeft
  } = warranty;

  const invoiceStatus = invoice?.status || (invoiceFile ? 'legacy' : 'none');
  const invoiceAvailable = invoiceStatus !== 'removed' && Boolean(invoiceFile || invoice?.storageUrl);

  const handleViewInvoice = async () => {
    if (!invoiceAvailable) return;
    try {
      setOpeningInvoice(true);
      const res = await fetchInvoiceUrl(id);
      if (res.success && res.url) {
        window.open(res.url, '_blank', 'noopener,noreferrer');
      } else {
        window.open(getFileUrl(invoice?.storageUrl || invoiceFile), '_blank', 'noopener,noreferrer');
      }
    } catch (err) {
      console.error('Invoice URL fetch error:', err);
      window.open(getFileUrl(invoice?.storageUrl || invoiceFile), '_blank', 'noopener,noreferrer');
    } finally {
      setOpeningInvoice(false);
    }
  };

  const handleVerify = async () => {
    try {
      setVerifying(true);
      setVerifyError('');
      setVerifyState(null);
      const res = await verifyInvoiceIntegrity(id);
      if (res.success) {
        setVerifyState(res.data);
      } else {
        setVerifyError('Verification could not be completed.');
      }
    } catch (err) {
      console.error(err);
      setVerifyError(
        err.response?.data?.message || 'Verification failed. The document may be unavailable.'
      );
    } finally {
      setVerifying(false);
    }
  };

  const openInvoiceAction = (type) => {
    setInvoiceAction(type);
    setInvoiceActionError('');
    setReplacementFile(null);
    setInvoiceRequestId(newRequestId());
  };

  const closeInvoiceAction = () => {
    if (invoiceActionLoading) return;
    setInvoiceAction(null);
    setInvoiceActionError('');
    setReplacementFile(null);
  };

  const handleInvoiceActionConfirm = async ({
    reason,
    freshPassword,
    freshGoogleCredential
  }) => {
    try {
      setInvoiceActionLoading(true);
      setInvoiceActionError('');

      if (invoiceAction === 'replace') {
        if (!replacementFile) {
          setInvoiceActionError('Please choose the replacement invoice document.');
          return;
        }
        const formData = new FormData();
        formData.append('invoiceFile', replacementFile);
        formData.append('reason', reason);
        formData.append('requestId', invoiceRequestId);
        if (freshPassword) formData.append('freshPassword', freshPassword);
        if (freshGoogleCredential) {
          formData.append('freshGoogleCredential', freshGoogleCredential);
        }

        const res = await replaceWarrantyInvoice(id, formData);
        if (!res.success) {
          setInvoiceActionError(res.message || 'Invoice replacement failed.');
          return;
        }
        setNotice('Invoice replaced. The previous version was preserved in the audit history.');
      } else {
        const res = await removeWarrantyInvoice(id, {
          reason,
          requestId: invoiceRequestId,
          ...(freshPassword ? { freshPassword } : {}),
          ...(freshGoogleCredential ? { freshGoogleCredential } : {})
        });
        if (!res.success) {
          setInvoiceActionError(res.message || 'Invoice removal failed.');
          return;
        }
        setNotice(
          'Invoice marked as removed. The original evidence file was retained and the action was audited.'
        );
      }

      setInvoiceAction(null);
      setReplacementFile(null);
      await loadWarranty();
      await loadAudit();
    } catch (err) {
      console.error(err);
      setInvoiceActionError(
        err.response?.data?.message || 'The invoice action could not be completed.'
      );
    } finally {
      setInvoiceActionLoading(false);
    }
  };

  const verificationBadge = () => {
    if (!verifyState) return null;

    if (verifyState.verified === true) {
      return (
        <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900/50 text-emerald-700 dark:text-emerald-300 text-xs flex items-start gap-2">
          <ShieldCheck className="w-4 h-4 shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold">Checksum matches</p>
            <p className="mt-0.5 break-all font-mono text-[10px]">{verifyState.storedChecksum}</p>
          </div>
        </div>
      );
    }

    if (verifyState.verified === false) {
      return (
        <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900/50 text-rose-700 dark:text-rose-300 text-xs flex items-start gap-2">
          <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold">Checksum mismatch — the stored file changed</p>
            <p className="mt-0.5 break-all font-mono text-[10px]">
              expected {verifyState.storedChecksum}
            </p>
            <p className="break-all font-mono text-[10px]">
              actual {verifyState.computedChecksum}
            </p>
          </div>
        </div>
      );
    }

    return (
      <div className="p-3 rounded-xl bg-slate-100 dark:bg-dark-800 border border-slate-200 dark:border-dark-700 text-slate-600 dark:text-slate-300 text-xs flex items-start gap-2">
        <ShieldQuestion className="w-4 h-4 shrink-0 mt-0.5" />
        <span>{verifyState.message}</span>
      </div>
    );
  };

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6 animate-fadeIn">
      <div className="flex items-center justify-between">
        <Link
          to="/warranties"
          className="inline-flex items-center space-x-2 text-sm font-semibold text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back to Warranties</span>
        </Link>

        <div className="flex items-center space-x-3">
          <Link
            to={`/warranties/${_id}/edit`}
            className="inline-flex items-center space-x-1.5 px-4 py-2 text-sm font-semibold text-slate-700 dark:text-slate-200 bg-white dark:bg-dark-800 border border-slate-300 dark:border-dark-700 rounded-xl hover:bg-slate-50 dark:hover:bg-dark-750 transition-colors shadow-xs"
          >
            <Edit3 className="w-4 h-4 text-slate-500 dark:text-slate-400" />
            <span>Edit</span>
          </Link>
          <button
            onClick={() => setDeleteModalOpen(true)}
            className="inline-flex items-center space-x-1.5 px-4 py-2 text-sm font-semibold text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/60 rounded-xl hover:bg-rose-100 dark:hover:bg-rose-900/50 transition-colors"
          >
            <Trash2 className="w-4 h-4" />
            <span>Delete</span>
          </button>
        </div>
      </div>

      {notice && (
        <div className="p-4 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900/50 text-emerald-800 dark:text-emerald-300 text-sm flex items-start justify-between gap-3">
          <span className="flex items-start gap-2">
            <BadgeCheck className="w-4 h-4 shrink-0 mt-0.5" />
            {notice}
          </span>
          <button
            type="button"
            onClick={() => setNotice('')}
            className="text-emerald-600 dark:text-emerald-400 hover:opacity-70"
            aria-label="Dismiss"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      <div className="bg-white dark:bg-dark-850 rounded-2xl border border-slate-200/90 dark:border-dark-750/80 shadow-xs overflow-hidden transition-colors">
        <div className="grid grid-cols-1 md:grid-cols-3 border-b border-slate-200 dark:border-dark-750">
          <div className="md:col-span-1 bg-slate-100 dark:bg-dark-800 min-h-[260px] relative flex items-center justify-center border-b md:border-b-0 md:border-r border-slate-200 dark:border-dark-750">
            {productImage ? (
              <img
                src={getFileUrl(productImage)}
                alt={productName}
                className="w-full h-full object-cover"
                onError={(e) => {
                  e.target.onerror = null;
                  e.target.style.display = 'none';
                  if (e.target.nextSibling) {
                    e.target.nextSibling.style.display = 'flex';
                  }
                }}
              />
            ) : null}
            <div
              className={`w-full h-full flex flex-col items-center justify-center p-6 text-slate-400 dark:text-slate-600 bg-gradient-to-br from-slate-100 to-slate-200/60 dark:from-dark-800 dark:to-dark-900 ${
                productImage ? 'hidden' : 'flex'
              }`}
            >
              <Package className="w-16 h-16 stroke-[1.5] mb-2" />
              <span className="text-xs font-medium text-slate-500 dark:text-slate-400">No Image Uploaded</span>
            </div>
          </div>

          <div className="md:col-span-2 p-6 sm:p-8 flex flex-col justify-between space-y-6">
            <div>
              <div className="flex flex-wrap items-center gap-2 mb-2">
                <span className="px-2.5 py-1 rounded-md text-xs font-semibold bg-slate-100 dark:bg-dark-800 text-slate-700 dark:text-slate-300 uppercase tracking-wider flex items-center gap-1 border border-slate-200/60 dark:border-dark-700">
                  <Tag className="w-3.5 h-3.5 text-slate-400" />
                  {category}
                </span>
                <StatusBadge status={status} />
                <EvidenceBadge status={evidenceStatus} invoiceBacked={isInvoiceBacked} />
              </div>

              {brand && (
                <p className="text-xs font-semibold text-blue-600 dark:text-blue-400 uppercase tracking-widest">
                  {brand}
                </p>
              )}

              <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 dark:text-white tracking-tight mt-1">
                {productName}
              </h1>

              <div className="flex flex-wrap gap-x-5 gap-y-1 mt-2 text-xs text-slate-500 dark:text-slate-400">
                {modelNumber && <span>Model: <strong className="text-slate-700 dark:text-slate-200">{modelNumber}</strong></span>}
                {invoiceNumber && <span>Invoice #: <strong className="text-slate-700 dark:text-slate-200">{invoiceNumber}</strong></span>}
                <span>Record v{recordVersion || 1}</span>
              </div>
            </div>

            <div className="p-4 rounded-xl border bg-slate-50 dark:bg-dark-900 border-slate-200/80 dark:border-dark-750 flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <Clock className="w-5 h-5 text-blue-600 dark:text-blue-400 shrink-0" />
                <div>
                  <p className="text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">Warranty Expiry</p>
                  <p className="text-sm font-bold text-slate-900 dark:text-slate-100">{formatDate(warrantyExpiryDate)}</p>
                </div>
              </div>
              <div className="text-right">
                <span className="inline-block px-3 py-1 rounded-lg text-xs font-bold bg-blue-100 dark:bg-blue-950/60 text-blue-800 dark:text-blue-300 border border-blue-200 dark:border-blue-900/40">
                  {formattedDaysLeft}
                </span>
              </div>
            </div>
          </div>
        </div>

        <div className="p-6 sm:p-8 grid grid-cols-1 md:grid-cols-2 gap-8">
          <div className="space-y-6">
            <h2 className="text-base font-bold text-slate-900 dark:text-white uppercase tracking-wider border-b border-slate-100 dark:border-dark-800 pb-2">
              Purchase Information
            </h2>

            <div className="space-y-4 text-sm">
              <div className="flex items-start space-x-3">
                <Calendar className="w-5 h-5 text-slate-400 dark:text-slate-500 mt-0.5 shrink-0" />
                <div>
                  <p className="text-xs text-slate-500 dark:text-slate-400 font-medium">Purchase Date</p>
                  <p className="font-semibold text-slate-800 dark:text-slate-200">{formatDate(purchaseDate)}</p>
                </div>
              </div>

              <div className="flex items-start space-x-3">
                <Clock className="w-5 h-5 text-slate-400 dark:text-slate-500 mt-0.5 shrink-0" />
                <div>
                  <p className="text-xs text-slate-500 dark:text-slate-400 font-medium">Warranty Duration</p>
                  <p className="font-semibold text-slate-800 dark:text-slate-200">
                    {warrantyDuration} {warrantyUnit}
                  </p>
                  {warrantyStartDate && (
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      Starts {formatDate(warrantyStartDate)}
                    </p>
                  )}
                </div>
              </div>

              <div className="flex items-start space-x-3">
                <Store className="w-5 h-5 text-slate-400 dark:text-slate-500 mt-0.5 shrink-0" />
                <div>
                  <p className="text-xs text-slate-500 dark:text-slate-400 font-medium">Store / Vendor</p>
                  <p className="font-semibold text-slate-800 dark:text-slate-200">{store || '—'}</p>
                </div>
              </div>

              <div className="flex items-start space-x-3">
                <DollarSign className="w-5 h-5 text-slate-400 dark:text-slate-500 mt-0.5 shrink-0" />
                <div>
                  <p className="text-xs text-slate-500 dark:text-slate-400 font-medium">Purchase Amount</p>
                  <p className="font-semibold text-slate-800 dark:text-slate-200">
                    {formatCurrency(price, currency)}
                  </p>
                </div>
              </div>

              <div className="flex items-start space-x-3">
                <Hash className="w-5 h-5 text-slate-400 dark:text-slate-500 mt-0.5 shrink-0" />
                <div>
                  <p className="text-xs text-slate-500 dark:text-slate-400 font-medium">Serial Number</p>
                  <p className="font-mono text-slate-800 dark:text-slate-200 font-medium">{serialNumber || '—'}</p>
                </div>
              </div>
            </div>
          </div>

          <div className="space-y-6">
            <h2 className="text-base font-bold text-slate-900 dark:text-white uppercase tracking-wider border-b border-slate-100 dark:border-dark-800 pb-2">
              Invoice Evidence
            </h2>

            <div className="space-y-3">
              {invoiceAvailable ? (
                <>
                  <button
                    type="button"
                    onClick={handleViewInvoice}
                    disabled={openingInvoice}
                    className="w-full flex items-center justify-between p-4 rounded-xl border border-slate-200 dark:border-dark-750 bg-slate-50 dark:bg-dark-900 hover:bg-blue-50/60 dark:hover:bg-dark-800 hover:border-blue-300 dark:hover:border-blue-600 transition-all group text-left focus:outline-none"
                  >
                    <div className="flex items-center space-x-3 overflow-hidden">
                      <FileCheck className="w-6 h-6 text-blue-600 dark:text-blue-400 shrink-0" />
                      <div className="min-w-0">
                        <span className="text-sm font-semibold text-slate-800 dark:text-slate-200 group-hover:text-blue-700 dark:group-hover:text-blue-400 block truncate">
                          {openingInvoice
                            ? 'Generating secure link...'
                            : invoice?.originalName || 'View attached invoice'}
                        </span>
                        <span className="text-[11px] text-slate-400 block">
                          {invoice?.mimeType || 'Document'}
                          {invoice?.size ? ` • ${formatBytes(invoice.size)}` : ''}
                          {invoice?.checksum ? ' • checksum recorded' : ' • legacy file'}
                        </span>
                      </div>
                    </div>
                    <ExternalLink className="w-4 h-4 text-slate-400 dark:text-slate-500 group-hover:text-blue-600 dark:group-hover:text-blue-400 shrink-0" />
                  </button>

                  <div className="text-[11px] text-slate-500 dark:text-slate-400 space-y-1 px-1">
                    {invoice?.uploadedAt && (
                      <p>Uploaded {formatDateTime(invoice.uploadedAt)}</p>
                    )}
                    {invoice?.checksum && (
                      <p className="font-mono break-all">SHA-256 {invoice.checksum}</p>
                    )}
                    {invoice?.versions?.length > 0 && (
                      <p>
                        {invoice.versions.length} previous version
                        {invoice.versions.length === 1 ? '' : 's'} preserved
                      </p>
                    )}
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={handleVerify}
                      disabled={verifying}
                      className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-900/50 rounded-xl hover:bg-blue-100 dark:hover:bg-blue-900/30 transition-colors disabled:opacity-50"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${verifying ? 'animate-spin' : ''}`} />
                      <span>{verifying ? 'Verifying...' : 'Verify integrity'}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => openInvoiceAction('replace')}
                      className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-dark-800 border border-slate-200 dark:border-dark-700 rounded-xl hover:bg-slate-200 dark:hover:bg-dark-700 transition-colors"
                    >
                      <Upload className="w-3.5 h-3.5" />
                      <span>Replace</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => openInvoiceAction('remove')}
                      className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/50 rounded-xl hover:bg-rose-100 dark:hover:bg-rose-900/30 transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Remove</span>
                    </button>
                  </div>
                </>
              ) : (
                <div className="p-4 rounded-xl border border-dashed border-slate-200 dark:border-dark-750 text-slate-500 dark:text-slate-400 text-xs space-y-2">
                  <div className="flex items-center space-x-2 font-medium">
                    <FileText className="w-4 h-4" />
                    <span>
                      {invoiceStatus === 'removed'
                        ? 'Invoice evidence was removed (original file retained in history)'
                        : 'No invoice document attached'}
                    </span>
                  </div>
                  {invoiceStatus !== 'removed' && (
                    <button
                      type="button"
                      onClick={() => openInvoiceAction('replace')}
                      className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-900/50 rounded-xl hover:bg-blue-100 dark:hover:bg-blue-900/30 transition-colors"
                    >
                      <Upload className="w-3.5 h-3.5" />
                      <span>Attach invoice</span>
                    </button>
                  )}
                </div>
              )}

              {verifyError && (
                <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/50 text-amber-800 dark:text-amber-300 text-xs flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{verifyError}</span>
                </div>
              )}

              {verificationBadge()}
            </div>

            <div className="space-y-2 pt-2">
              <p className="text-xs text-slate-500 dark:text-slate-400 font-medium">Notes & Instructions</p>
              {notes ? (
                <p className="text-sm text-slate-700 dark:text-slate-300 bg-slate-50 dark:bg-dark-900 p-4 rounded-xl border border-slate-200 dark:border-dark-750 leading-relaxed whitespace-pre-line">
                  {notes}
                </p>
              ) : (
                <p className="text-xs text-slate-400 dark:text-slate-500 italic">No notes provided.</p>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Audit history */}
      <div className="bg-white dark:bg-dark-850 rounded-2xl border border-slate-200/90 dark:border-dark-750/80 shadow-xs p-6 sm:p-8">
        <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-dark-800">
          <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <History className="w-5 h-5 text-blue-600 dark:text-blue-400" />
            Change history
          </h2>
          <span className="text-[11px] text-slate-400">Append-only • owner scoped</span>
        </div>

        {auditLoading ? (
          <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400 py-4">
            <span className="w-4 h-4 border-2 border-slate-300 border-t-blue-600 rounded-full animate-spin" />
            Loading audit history...
          </div>
        ) : auditError ? (
          <p className="text-xs text-rose-500 py-3">{auditError}</p>
        ) : audit.length === 0 ? (
          <p className="text-xs text-slate-400 dark:text-slate-500 py-3 italic">
            No recorded changes yet.
          </p>
        ) : (
          <ol className="mt-4 space-y-4">
            {audit.map((event) => (
              <li
                key={event._id}
                className="relative pl-5 border-l-2 border-slate-200 dark:border-dark-700"
              >
                <span className="absolute -left-[5px] top-1.5 w-2 h-2 rounded-full bg-blue-500" />
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                    {ACTION_LABELS[event.action] || event.action}
                  </p>
                  <span className="text-[11px] text-slate-400">
                    v{event.recordVersion} • {formatDateTime(event.createdAt)}
                  </span>
                  {event.freshAuthMethod && (
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 text-[10px] font-bold uppercase">
                      <Lock className="w-2.5 h-2.5" />
                      {event.freshAuthMethod}
                    </span>
                  )}
                </div>

                {event.changes?.length > 0 && (
                  <ul className="mt-2 space-y-1">
                    {event.changes.map((change, index) => (
                      <li key={index} className="text-xs text-slate-600 dark:text-slate-300">
                        <span className="font-semibold">{getFieldLabel(change.field)}</span>:{' '}
                        <span className="text-rose-600 dark:text-rose-400 break-words">
                          {String(change.previousValue ?? '—') || '—'}
                        </span>{' '}
                        →{' '}
                        <span className="text-emerald-700 dark:text-emerald-400 break-words">
                          {String(change.newValue ?? '—') || '—'}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}

                {event.reason && (
                  <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400 italic">
                    Reason: {event.reason}
                  </p>
                )}
              </li>
            ))}
          </ol>
        )}
      </div>

      <ConfirmModal
        isOpen={deleteModalOpen}
        onClose={() => setDeleteModalOpen(false)}
        onConfirm={handleDeleteConfirm}
        isLoading={isDeleting}
        title="Delete Warranty Product?"
        message={`Are you sure you want to delete "${productName}"? The record is archived and its original invoice evidence is retained in the audit history.`}
      />

      <SecureActionModal
        isOpen={Boolean(invoiceAction)}
        onClose={closeInvoiceAction}
        onConfirm={handleInvoiceActionConfirm}
        title={invoiceAction === 'replace' ? 'Replace invoice evidence' : 'Remove invoice evidence'}
        description={
          invoiceAction === 'replace'
            ? 'The new invoice replaces the active evidence. The previous version and its checksum are preserved, and the account owner is notified.'
            : 'The invoice is marked as removed. The original file and checksum are retained in version history, and the account owner is notified.'
        }
        changes={[]}
        confirmLabel={invoiceAction === 'replace' ? 'Replace invoice' : 'Remove invoice'}
        loading={invoiceActionLoading}
        error={invoiceActionError}
        authMethods={user?.authMethods || { google: false, password: false }}
        extraValid={invoiceAction === 'replace' ? Boolean(replacementFile) : true}
      >
        {invoiceAction === 'replace' && (
          <div>
            <p className="text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1.5">
              Replacement document <span className="text-rose-500">*</span>
            </p>
            <label className="flex items-center justify-center gap-2 p-4 border-2 border-dashed border-slate-300 dark:border-dark-700 rounded-xl cursor-pointer hover:border-blue-400 dark:hover:border-blue-500 hover:bg-slate-50 dark:hover:bg-dark-900 transition-colors">
              <Upload className="w-4 h-4 text-blue-600 dark:text-blue-400" />
              <span className="text-sm font-semibold text-slate-700 dark:text-slate-300">
                {replacementFile ? replacementFile.name : 'Choose PDF, JPG, PNG, or WEBP'}
              </span>
              <input
                type="file"
                accept="application/pdf,image/jpeg,image/png,image/webp"
                onChange={(e) => {
                  const file = e.target.files?.[0] || null;
                  if (file && file.size > 5 * 1024 * 1024) {
                    setInvoiceActionError('Replacement file must be less than 5MB.');
                    setReplacementFile(null);
                    return;
                  }
                  setInvoiceActionError('');
                  setReplacementFile(file);
                }}
                className="hidden"
              />
            </label>
            {replacementFile && (
              <p className="mt-1 text-[11px] text-slate-400">
                {formatBytes(replacementFile.size)} • {replacementFile.type || 'document'}
              </p>
            )}
          </div>
        )}
      </SecureActionModal>
    </div>
  );
};

export default WarrantyDetails;
