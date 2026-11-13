import React from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  FileSearch,
  Info,
  ScanLine,
  ShieldCheck,
  X
} from 'lucide-react';
import { getFieldLabel } from '../utils/fieldLabels';

const confidenceBadge = (confidence) => {
  if (confidence === 'high') {
    return 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-400 dark:border-emerald-900/50';
  }
  if (confidence === 'low') {
    return 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-400 dark:border-rose-900/50';
  }
  return 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-900/50';
};

const formatBytes = (bytes) => {
  const value = Number(bytes) || 0;
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(2)} MB`;
};

/**
 * Review panel shown after an invoice has been read. Extracted values are
 * suggestions only: the user must review them and confirm by saving.
 */
const InvoiceReviewPanel = ({ invoice, extraction, onClear }) => {
  if (!invoice && !extraction) return null;

  const fields = extraction?.fields || {};
  const fieldEntries = Object.entries(fields).filter(([, value]) => value && value.value !== '');
  const missingFields = extraction?.missingFields || [];
  const warnings = extraction?.warnings || [];
  const unavailable =
    extraction?.status === 'provider_unavailable' || extraction?.status === 'failed';

  return (
    <div className="rounded-2xl border border-blue-200/80 dark:border-blue-900/50 bg-blue-50/50 dark:bg-blue-950/20 p-4 sm:p-5 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start space-x-3">
          <div className="w-10 h-10 rounded-xl bg-blue-100 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 flex items-center justify-center shrink-0">
            <ScanLine className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">
              Invoice reading result
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              {unavailable
                ? 'Automatic reading is unavailable. Your invoice is still stored — enter the details manually.'
                : 'Values below were read from the invoice. They are suggestions and must be reviewed by you.'}
            </p>
          </div>
        </div>
        {onClear && (
          <button
            type="button"
            onClick={onClear}
            className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-white/60 dark:hover:bg-dark-800 transition-colors"
            title="Remove invoice from this form"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
        <div className="p-3 rounded-xl bg-white/70 dark:bg-dark-900/60 border border-slate-200/70 dark:border-dark-750">
          <p className="text-slate-500 dark:text-slate-400">Stored invoice</p>
          <p className="font-semibold text-slate-800 dark:text-slate-200 truncate">
            {invoice?.originalName || 'Invoice document'}
          </p>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
            {formatBytes(invoice?.size)} • {invoice?.mimeType || 'unknown type'}
          </p>
          {invoice?.checksum && (
            <p className="text-[10px] font-mono text-slate-400 mt-1 break-all">
              SHA-256 {invoice.checksum.slice(0, 24)}…
            </p>
          )}
        </div>
        <div className="p-3 rounded-xl bg-white/70 dark:bg-dark-900/60 border border-slate-200/70 dark:border-dark-750">
          <p className="text-slate-500 dark:text-slate-400">Extraction method</p>
          <p className="font-semibold text-slate-800 dark:text-slate-200">
            {extraction?.provider === 'local-pdf-text'
              ? 'Local PDF text extraction'
              : extraction?.provider === 'google-cloud-vision'
                ? 'Google Cloud Vision OCR'
                : 'No automatic reading'}
          </p>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
            {fieldEntries.length} field(s) found • status: {extraction?.status || 'unknown'}
          </p>
        </div>
      </div>

      {fieldEntries.length > 0 && (
        <div>
          <p className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-2">
            Extracted values — needs review
          </p>
          <div className="rounded-xl border border-slate-200 dark:border-dark-750 overflow-hidden bg-white dark:bg-dark-900">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 dark:bg-dark-850 text-slate-500 dark:text-slate-400">
                <tr>
                  <th className="text-left font-semibold px-3 py-2">Field</th>
                  <th className="text-left font-semibold px-3 py-2">Extracted value</th>
                  <th className="text-left font-semibold px-3 py-2">Confidence</th>
                </tr>
              </thead>
              <tbody>
                {fieldEntries.map(([name, field]) => (
                  <tr key={name} className="border-t border-slate-100 dark:border-dark-800">
                    <td className="px-3 py-2 font-semibold text-slate-700 dark:text-slate-200">
                      {getFieldLabel(name)}
                    </td>
                    <td className="px-3 py-2 text-slate-800 dark:text-slate-200 break-words">
                      {String(field.value)}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={`inline-flex px-2 py-0.5 rounded-md border text-[10px] font-bold uppercase ${confidenceBadge(
                          field.confidence
                        )}`}
                      >
                        {field.confidence || 'medium'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-[11px] text-slate-500 dark:text-slate-400 flex items-start gap-1.5">
            <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            Confidence is not proof of correctness. Check every value against the original invoice.
          </p>
        </div>
      )}

      {missingFields.length > 0 && (
        <div>
          <p className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-2">
            Not found — enter manually
          </p>
          <div className="flex flex-wrap gap-1.5">
            {missingFields.map((name) => (
              <span
                key={name}
                className="px-2 py-1 rounded-md bg-slate-100 dark:bg-dark-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-dark-700 text-[11px] font-semibold"
              >
                {getFieldLabel(name)}
              </span>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-slate-500 dark:text-slate-400">
            Missing values are never guessed from the product category or model.
          </p>
        </div>
      )}

      {warnings.length > 0 && (
        <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/50 text-amber-800 dark:text-amber-300 text-xs space-y-1">
          {warnings.map((warning, index) => (
            <p key={index} className="flex items-start gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span>{warning}</span>
            </p>
          ))}
        </div>
      )}

      {!unavailable && fieldEntries.length === 0 && missingFields.length > 0 && (
        <div className="p-3 rounded-xl bg-white/70 dark:bg-dark-900/60 border border-slate-200/70 dark:border-dark-750 text-xs text-slate-600 dark:text-slate-300 flex items-start gap-2">
          <FileSearch className="w-4 h-4 shrink-0 mt-0.5" />
          <span>No fields could be read automatically. The invoice is attached and you can fill the form manually.</span>
        </div>
      )}

      <div className="flex items-start gap-2 text-[11px] text-slate-500 dark:text-slate-400 border-t border-blue-200/60 dark:border-blue-900/40 pt-3">
        <ShieldCheck className="w-4 h-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
        <span>
          The original invoice bytes and checksum are preserved independently of the warranty fields you
          confirm.
        </span>
      </div>

      {!unavailable && fieldEntries.length > 0 && (
        <div className="flex items-center gap-1.5 text-[11px] font-semibold text-emerald-700 dark:text-emerald-400">
          <CheckCircle2 className="w-3.5 h-3.5" />
          <span>Review complete? Saving the warranty confirms these values.</span>
        </div>
      )}
    </div>
  );
};

export default InvoiceReviewPanel;
