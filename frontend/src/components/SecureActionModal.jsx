import React, { useEffect, useState } from 'react';
import { GoogleLogin } from '@react-oauth/google';
import { AlertTriangle, Lock, ShieldCheck, X } from 'lucide-react';
import { getFieldLabel } from '../utils/fieldLabels';

/**
 * Reusable confirmation modal for sensitive actions.
 *
 * The backend verifies the reason and the fresh authentication proof. This
 * component only collects them; it never decides whether the action is
 * authorized.
 */
const SecureActionModal = ({
  isOpen,
  onClose,
  onConfirm,
  title = 'Confirm sensitive change',
  description = 'This action changes invoice-backed warranty information.',
  changes = [],
  children,
  confirmLabel = 'Confirm change',
  loading = false,
  error = '',
  authMethods = { google: false, password: false },
  requireReason = true,
  extraValid = true,
  danger = true
}) => {
  const [reason, setReason] = useState('');
  const [password, setPassword] = useState('');
  const [googleCredential, setGoogleCredential] = useState('');
  const [localError, setLocalError] = useState('');

  useEffect(() => {
    if (isOpen) {
      setReason('');
      setPassword('');
      setGoogleCredential('');
      setLocalError('');
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const hasAuthMethod = authMethods.google || authMethods.password;

  const handleSubmit = () => {
    setLocalError('');

    if (requireReason && reason.trim().length < 10) {
      setLocalError('Please provide a meaningful reason of at least 10 characters.');
      return;
    }
    if (!hasAuthMethod) {
      setLocalError(
        'This account has no supported re-authentication method. Sign in with Google or reset a password first.'
      );
      return;
    }
    if (!password && !googleCredential) {
      setLocalError('Please confirm your identity with your password or Google account.');
      return;
    }
    if (!extraValid) {
      setLocalError('Please complete the required fields above.');
      return;
    }

    onConfirm({
      reason: reason.trim(),
      freshPassword: password || undefined,
      freshGoogleCredential: googleCredential || undefined
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 dark:bg-black/75 backdrop-blur-xs animate-fadeIn">
      <div className="relative w-full max-w-xl max-h-[92vh] overflow-y-auto bg-white dark:bg-dark-850 rounded-2xl shadow-xl border border-slate-200 dark:border-dark-750">
        <div className="p-5 border-b border-slate-100 dark:border-dark-800 flex items-start justify-between gap-4">
          <div className="flex items-start space-x-3">
            <div
              className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                danger
                  ? 'bg-rose-100 dark:bg-rose-950/50 text-rose-600 dark:text-rose-400'
                  : 'bg-blue-100 dark:bg-blue-950/50 text-blue-600 dark:text-blue-400'
              }`}
            >
              <Lock className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900 dark:text-white">{title}</h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">
                {description}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-dark-800 transition-colors disabled:opacity-50"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-5">
          <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/50 text-amber-800 dark:text-amber-300 text-xs flex items-start gap-2">
            <ShieldCheck className="w-4 h-4 shrink-0 mt-0.5" />
            <span>
              The original invoice is never modified by this action. This change is recorded in the
              warranty audit history and the account owner is notified.
            </span>
          </div>

          {changes.length > 0 && (
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-2">
                Requested changes
              </p>
              <div className="rounded-xl border border-slate-200 dark:border-dark-750 overflow-hidden">
                <table className="w-full text-xs">
                  <thead className="bg-slate-50 dark:bg-dark-900 text-slate-500 dark:text-slate-400">
                    <tr>
                      <th className="text-left font-semibold px-3 py-2">Field</th>
                      <th className="text-left font-semibold px-3 py-2">Previous</th>
                      <th className="text-left font-semibold px-3 py-2">New</th>
                    </tr>
                  </thead>
                  <tbody>
                    {changes.map((change) => (
                      <tr
                        key={change.field}
                        className="border-t border-slate-100 dark:border-dark-800"
                      >
                        <td className="px-3 py-2 font-semibold text-slate-700 dark:text-slate-200">
                          {getFieldLabel(change.field)}
                        </td>
                        <td className="px-3 py-2 text-rose-600 dark:text-rose-400 break-words">
                          {String(change.previousValue ?? '—') || '—'}
                        </td>
                        <td className="px-3 py-2 text-emerald-700 dark:text-emerald-400 font-semibold break-words">
                          {String(change.newValue ?? '—') || '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {children}

          {requireReason && (
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1.5">
                Reason for this change <span className="text-rose-500">*</span>
              </label>
              <textarea
                rows="3"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Explain why the invoice-backed details are being corrected."
                className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-dark-900 border border-slate-200 dark:border-dark-700 rounded-xl text-sm text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <p className="mt-1 text-[11px] text-slate-400">
                Minimum 10 characters. This reason appears in the audit history and security email.
              </p>
            </div>
          )}

          <div>
            <p className="text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-2">
              Confirm your identity <span className="text-rose-500">*</span>
            </p>

            {!hasAuthMethod && (
              <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900/50 text-rose-700 dark:text-rose-300 text-xs flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>
                  This account has no password and no linked Google account, so a fresh
                  authentication proof cannot be created. Please sign in with Google or set a
                  password first.
                </span>
              </div>
            )}

            {authMethods.password && (
              <div className="mt-2">
                <label className="block text-[11px] font-semibold text-slate-500 dark:text-slate-400 mb-1">
                  Account password
                </label>
                <input
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    if (e.target.value) setGoogleCredential('');
                  }}
                  placeholder="Enter your current password"
                  className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-dark-900 border border-slate-200 dark:border-dark-700 rounded-xl text-sm text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            )}

            {authMethods.google && (
              <div className={authMethods.password ? 'mt-3' : 'mt-2'}>
                {authMethods.password && (
                  <p className="text-[11px] text-slate-400 mb-2 text-center">or verify with Google</p>
                )}
                {googleCredential ? (
                  <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900/50 text-emerald-700 dark:text-emerald-300 text-xs flex items-center justify-between gap-2">
                    <span>Google identity confirmed.</span>
                    <button
                      type="button"
                      onClick={() => setGoogleCredential('')}
                      className="font-semibold underline"
                    >
                      Reset
                    </button>
                  </div>
                ) : (
                  <div className="flex justify-center">
                    <GoogleLogin
                      onSuccess={(response) => {
                        if (response?.credential) {
                          setGoogleCredential(response.credential);
                          setPassword('');
                          setLocalError('');
                        } else {
                          setLocalError('Google did not return a credential.');
                        }
                      }}
                      onError={() => setLocalError('Google verification was cancelled.')}
                      text="continue_with"
                      theme="outline"
                      size="large"
                    />
                  </div>
                )}
              </div>
            )}
          </div>

          {(localError || error) && (
            <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900/50 text-rose-700 dark:text-rose-300 text-xs flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{localError || error}</span>
            </div>
          )}
        </div>

        <div className="px-5 py-4 bg-slate-50 dark:bg-dark-900 border-t border-slate-100 dark:border-dark-800 flex items-center justify-end space-x-3">
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="px-4 py-2 text-sm font-semibold text-slate-700 dark:text-slate-300 bg-white dark:bg-dark-800 border border-slate-300 dark:border-dark-700 rounded-xl hover:bg-slate-100 dark:hover:bg-dark-700 transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={loading}
            className={`inline-flex items-center justify-center space-x-2 px-4 py-2 text-sm font-semibold text-white rounded-xl shadow-sm transition-colors disabled:opacity-50 ${
              danger
                ? 'bg-rose-600 hover:bg-rose-700 dark:hover:bg-rose-500'
                : 'bg-blue-600 hover:bg-blue-700 dark:hover:bg-blue-500'
            }`}
          >
            {loading ? (
              <>
                <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                <span>Working...</span>
              </>
            ) : (
              <span>{confirmLabel}</span>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default SecureActionModal;
