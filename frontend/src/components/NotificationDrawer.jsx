import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  X,
  Bell,
  CheckCheck,
  Trash2,
  Clock,
  ExternalLink,
  Settings,
  Mail,
  AlertTriangle,
  Sparkles,
  RefreshCw,
  Sliders,
  ShieldAlert,
  ShieldCheck,
  Globe,
  MailWarning
} from 'lucide-react';
import {
  fetchNotifications,
  markNotificationAsRead,
  markAllNotificationsAsRead,
  deleteNotification,
  clearAllNotifications
} from '../services/api';
import { useAuth } from '../context/AuthContext';
import { getFieldLabel } from '../utils/fieldLabels';

const TIMEZONE_OPTIONS = [
  'UTC',
  'Asia/Kolkata',
  'Asia/Dubai',
  'Asia/Singapore',
  'Asia/Tokyo',
  'Australia/Sydney',
  'Europe/London',
  'Europe/Berlin',
  'Europe/Paris',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles'
];

const DELIVERY_META = {
  sent: {
    label: 'Email sent',
    className:
      'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-900/50',
    Icon: ShieldCheck
  },
  failed: {
    label: 'Email failed — retrying',
    className:
      'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-900/50',
    Icon: MailWarning
  },
  pending: {
    label: 'Email pending',
    className:
      'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900/50',
    Icon: Mail
  },
  not_required: {
    label: 'Email disabled',
    className:
      'bg-slate-100 text-slate-600 border-slate-200 dark:bg-dark-800 dark:text-slate-300 dark:border-dark-700',
    Icon: Mail
  }
};

const DeliveryBadge = ({ status }) => {
  const meta = DELIVERY_META[status];
  if (!meta) return null;
  const Icon = meta.Icon;
  return (
    <span
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] font-bold ${meta.className}`}
    >
      <Icon className="w-2.5 h-2.5" />
      {meta.label}
    </span>
  );
};

const SecurityDetails = ({ details }) => {
  if (!details) return null;
  const changes = details.changes || [];

  return (
    <div className="mt-2 space-y-2">
      {changes.length > 0 && (
        <div className="rounded-lg border border-rose-200/70 dark:border-rose-900/50 overflow-hidden">
          <table className="w-full text-[11px]">
            <thead className="bg-rose-50 dark:bg-rose-950/30 text-rose-700 dark:text-rose-300">
              <tr>
                <th className="text-left font-semibold px-2 py-1">Field</th>
                <th className="text-left font-semibold px-2 py-1">Previous</th>
                <th className="text-left font-semibold px-2 py-1">New</th>
              </tr>
            </thead>
            <tbody>
              {changes.map((change, index) => (
                <tr
                  key={`${change.field}-${index}`}
                  className="border-t border-rose-100 dark:border-rose-900/30"
                >
                  <td className="px-2 py-1 font-semibold text-slate-700 dark:text-slate-200">
                    {getFieldLabel(change.field)}
                  </td>
                  <td className="px-2 py-1 text-rose-600 dark:text-rose-400 break-words">
                    {String(change.previousValue ?? '—') || '—'}
                  </td>
                  <td className="px-2 py-1 text-emerald-700 dark:text-emerald-400 break-words">
                    {String(change.newValue ?? '—') || '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {details.reason && (
        <p className="text-[11px] text-slate-500 dark:text-slate-400 italic">
          Reason: {details.reason}
        </p>
      )}
    </div>
  );
};

const NotificationDrawer = ({ isOpen, onClose, onUnreadChange }) => {
  const { user, updatePreferences } = useAuth();

  const [activeTab, setActiveTab] = useState('notifications'); // 'notifications' | 'settings'
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Reminder settings form state
  const [settingsForm, setSettingsForm] = useState({
    emailReminders: true,
    inAppReminders: true,
    securityEmails: true,
    reminderDays: [30, 7, 1],
    timezone: 'UTC'
  });
  const [savingSettings, setSavingSettings] = useState(false);
  const [settingsSuccess, setSettingsSuccess] = useState('');
  const [settingsError, setSettingsError] = useState('');

  // Sync settings when user is loaded
  useEffect(() => {
    if (user?.reminderPreferences || user?.timezone) {
      setSettingsForm({
        emailReminders: user.reminderPreferences?.emailReminders ?? true,
        inAppReminders: user.reminderPreferences?.inAppReminders ?? true,
        securityEmails: user.reminderPreferences?.securityEmails ?? true,
        reminderDays: user.reminderPreferences?.reminderDays || [30, 7, 1],
        timezone: user.timezone || 'UTC'
      });
    }
  }, [user]);

  const loadNotifications = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetchNotifications();
      if (res.success) {
        setNotifications(res.data);
        setUnreadCount(res.unreadCount);
        if (onUnreadChange) onUnreadChange(res.unreadCount);
      }
    } catch (err) {
      console.error('Error fetching notifications:', err);
      setError('Failed to load notifications.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      loadNotifications();
    }
  }, [isOpen]);

  const handleMarkAsRead = async (id, e) => {
    e.stopPropagation();
    try {
      const res = await markNotificationAsRead(id);
      if (res.success) {
        setNotifications((prev) =>
          prev.map((n) => (n._id === id ? { ...n, isRead: true } : n))
        );
        const newUnread = Math.max(0, unreadCount - 1);
        setUnreadCount(newUnread);
        if (onUnreadChange) onUnreadChange(newUnread);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleMarkAllRead = async () => {
    try {
      const res = await markAllNotificationsAsRead();
      if (res.success) {
        setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
        setUnreadCount(0);
        if (onUnreadChange) onUnreadChange(0);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleDelete = async (id, e) => {
    e.stopPropagation();
    try {
      const res = await deleteNotification(id);
      if (res.success) {
        const target = notifications.find((n) => n._id === id);
        setNotifications((prev) => prev.filter((n) => n._id !== id));
        if (target && !target.isRead) {
          const newUnread = Math.max(0, unreadCount - 1);
          setUnreadCount(newUnread);
          if (onUnreadChange) onUnreadChange(newUnread);
        }
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleClearAll = async () => {
    if (!window.confirm('Clear all notifications?')) return;
    try {
      const res = await clearAllNotifications();
      if (res.success) {
        setNotifications([]);
        setUnreadCount(0);
        if (onUnreadChange) onUnreadChange(0);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleSaveSettings = async (e) => {
    e.preventDefault();
    try {
      setSavingSettings(true);
      setSettingsSuccess('');
      setSettingsError('');
      const res = await updatePreferences(settingsForm);
      if (res.success) {
        setSettingsSuccess('Preferences saved successfully!');
        setTimeout(() => setSettingsSuccess(''), 3000);
      } else {
        setSettingsError(res.message || 'Failed to save preferences.');
      }
    } catch (err) {
      console.error(err);
      setSettingsError(
        err.response?.data?.message || 'Failed to save preferences. Please try again.'
      );
    } finally {
      setSavingSettings(false);
    }
  };

  const toggleDayInterval = (day) => {
    setSettingsForm((prev) => {
      const exists = prev.reminderDays.includes(day);
      const updated = exists
        ? prev.reminderDays.filter((d) => d !== day)
        : [...prev.reminderDays, day].sort((a, b) => b - a);
      return { ...prev, reminderDays: updated };
    });
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-hidden">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs transition-opacity duration-300"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Drawer Container */}
      <div className="fixed inset-y-0 right-0 max-w-full flex pl-10">
        <div className="w-screen max-w-md bg-white dark:bg-dark-900 shadow-2xl flex flex-col border-l border-slate-200 dark:border-dark-750 transition-colors">

          {/* Header */}
          <div className="p-4 sm:p-5 border-b border-slate-200 dark:border-dark-800 flex items-center justify-between">
            <div className="flex items-center space-x-2.5">
              <div className="w-9 h-9 rounded-xl bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 flex items-center justify-center">
                <Bell className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-base font-bold text-slate-900 dark:text-white">
                  Notification Center
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {unreadCount > 0 ? `${unreadCount} unread reminder${unreadCount > 1 ? 's' : ''}` : 'All caught up'}
                </p>
              </div>
            </div>

            <button
              onClick={onClose}
              className="p-2 rounded-xl text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-dark-800 transition-colors"
              aria-label="Close notification center"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Navigation Tabs */}
          <div className="flex border-b border-slate-200 dark:border-dark-800 bg-slate-50/50 dark:bg-dark-850">
            <button
              onClick={() => setActiveTab('notifications')}
              className={`flex-1 py-3 text-xs font-semibold text-center border-b-2 transition-all flex items-center justify-center space-x-2 ${
                activeTab === 'notifications'
                  ? 'border-blue-600 text-blue-600 dark:text-blue-400 bg-white dark:bg-dark-900'
                  : 'border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <Bell className="w-4 h-4" />
              <span>Reminders</span>
              {unreadCount > 0 && (
                <span className="px-1.5 py-0.2 text-[10px] font-bold rounded-full bg-rose-500 text-white">
                  {unreadCount}
                </span>
              )}
            </button>

            <button
              onClick={() => setActiveTab('settings')}
              className={`flex-1 py-3 text-xs font-semibold text-center border-b-2 transition-all flex items-center justify-center space-x-2 ${
                activeTab === 'settings'
                  ? 'border-blue-600 text-blue-600 dark:text-blue-400 bg-white dark:bg-dark-900'
                  : 'border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <Sliders className="w-4 h-4" />
              <span>Preferences</span>
            </button>
          </div>

          {/* Tab Content */}
          <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4">
            {activeTab === 'notifications' ? (
              <>
                {/* Actions Toolbar */}
                {notifications.length > 0 && (
                  <div className="flex items-center justify-between pb-2 border-b border-slate-100 dark:border-dark-800 text-xs">
                    <button
                      onClick={handleMarkAllRead}
                      disabled={unreadCount === 0}
                      className="inline-flex items-center space-x-1.5 text-blue-600 dark:text-blue-400 hover:underline disabled:opacity-50 disabled:no-underline font-medium"
                    >
                      <CheckCheck className="w-3.5 h-3.5" />
                      <span>Mark all as read</span>
                    </button>
                    <button
                      onClick={handleClearAll}
                      className="text-slate-500 hover:text-rose-600 dark:hover:text-rose-400 transition-colors"
                    >
                      Clear all
                    </button>
                  </div>
                )}

                {/* Notifications List */}
                {loading ? (
                  <div className="py-12 text-center text-slate-500 dark:text-slate-400 text-sm flex flex-col items-center justify-center space-y-3">
                    <RefreshCw className="w-6 h-6 animate-spin text-blue-600" />
                    <span>Loading reminders...</span>
                  </div>
                ) : error ? (
                  <div className="p-4 bg-rose-50 dark:bg-rose-950/40 rounded-xl text-rose-700 dark:text-rose-300 text-xs text-center">
                    {error}
                  </div>
                ) : notifications.length === 0 ? (
                  <div className="py-16 text-center flex flex-col items-center justify-center space-y-3">
                    <div className="w-12 h-12 rounded-2xl bg-slate-100 dark:bg-dark-800 text-slate-400 dark:text-slate-500 flex items-center justify-center">
                      <Sparkles className="w-6 h-6" />
                    </div>
                    <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">
                      No notifications yet
                    </p>
                    <p className="text-xs text-slate-500 dark:text-slate-400 max-w-xs">
                      When your products are nearing expiry (e.g. 30, 7, or 1 day), you will receive reminders here.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {notifications.map((n) => {
                      const isSecurity = n.type === 'SECURITY_CORRECTION';
                      const isToday = !isSecurity && n.daysRemaining === 0;

                      if (isSecurity) {
                        return (
                          <div
                            key={n._id}
                            className={`p-3.5 rounded-2xl border transition-all relative ${
                              n.isRead
                                ? 'bg-slate-50/60 dark:bg-dark-850/60 border-slate-200/80 dark:border-dark-800 text-slate-600 dark:text-slate-400'
                                : 'bg-rose-50/70 dark:bg-rose-950/20 border-rose-200 dark:border-rose-900/60 shadow-xs text-slate-900 dark:text-white'
                            }`}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="flex flex-wrap items-center gap-1.5">
                                {!n.isRead && (
                                  <span className="w-2 h-2 rounded-full bg-rose-600 shrink-0" />
                                )}
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold bg-rose-100 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300">
                                  <ShieldAlert className="w-3 h-3" />
                                  Security alert
                                </span>
                                <DeliveryBadge status={n.emailStatus} />
                              </div>

                              <div className="flex items-center space-x-1 shrink-0">
                                {!n.isRead && (
                                  <button
                                    onClick={(e) => handleMarkAsRead(n._id, e)}
                                    className="p-1 text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 rounded-lg hover:bg-slate-100 dark:hover:bg-dark-700 transition-colors"
                                    title="Mark as read"
                                  >
                                    <CheckCheck className="w-3.5 h-3.5" />
                                  </button>
                                )}
                                <button
                                  onClick={(e) => handleDelete(n._id, e)}
                                  className="p-1 text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 rounded-lg hover:bg-slate-100 dark:hover:bg-dark-700 transition-colors"
                                  title="Delete notification"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </div>

                            <h3 className="text-xs font-bold mt-2">{n.title}</h3>
                            <p className="text-xs text-slate-600 dark:text-slate-300 mt-1 leading-relaxed">
                              {n.message}
                            </p>

                            <SecurityDetails details={n.details} />

                            {n.warranty && (
                              <div className="mt-3 pt-2 border-t border-rose-100 dark:border-rose-900/30 flex items-center justify-between text-xs">
                                <span className="text-[11px] text-slate-400 truncate max-w-[180px]">
                                  {n.warranty.productName}
                                </span>
                                <Link
                                  to={`/warranties/${n.warranty._id || n.warranty}`}
                                  onClick={onClose}
                                  className="inline-flex items-center space-x-1 font-semibold text-rose-600 dark:text-rose-400 hover:underline"
                                >
                                  <span>Review record</span>
                                  <ExternalLink className="w-3 h-3" />
                                </Link>
                              </div>
                            )}
                          </div>
                        );
                      }

                      return (
                        <div
                          key={n._id}
                          className={`p-3.5 rounded-2xl border transition-all relative ${
                            n.isRead
                              ? 'bg-slate-50/60 dark:bg-dark-850/60 border-slate-200/80 dark:border-dark-800 text-slate-600 dark:text-slate-400'
                              : 'bg-white dark:bg-dark-800 border-blue-200 dark:border-blue-900/60 shadow-xs text-slate-900 dark:text-white ring-1 ring-blue-500/10'
                          }`}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex flex-wrap items-center gap-1.5">
                              {!n.isRead && (
                                <span className="w-2 h-2 rounded-full bg-blue-600 shrink-0" />
                              )}
                              <span
                                className={`px-2 py-0.5 rounded-md text-[10px] font-bold ${
                                  isToday
                                    ? 'bg-rose-100 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300'
                                    : 'bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300'
                                }`}
                              >
                                {isToday ? 'Expires Today' : `${n.daysRemaining} days left`}
                              </span>
                              <DeliveryBadge status={n.emailStatus} />
                            </div>

                            <div className="flex items-center space-x-1 shrink-0">
                              {!n.isRead && (
                                <button
                                  onClick={(e) => handleMarkAsRead(n._id, e)}
                                  className="p-1 text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 rounded-lg hover:bg-slate-100 dark:hover:bg-dark-700 transition-colors"
                                  title="Mark as read"
                                >
                                  <CheckCheck className="w-3.5 h-3.5" />
                                </button>
                              )}
                              <button
                                onClick={(e) => handleDelete(n._id, e)}
                                className="p-1 text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 rounded-lg hover:bg-slate-100 dark:hover:bg-dark-700 transition-colors"
                                title="Delete notification"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>

                          <h3 className="text-xs font-bold mt-2">
                            {n.title}
                          </h3>

                          <p className="text-xs text-slate-600 dark:text-slate-300 mt-1 leading-relaxed">
                            {n.message}
                          </p>

                          {n.warranty && (
                            <div className="mt-3 pt-2 border-t border-slate-100 dark:border-dark-750 flex items-center justify-between text-xs">
                              <span className="text-[11px] text-slate-400 truncate max-w-[180px]">
                                {n.warranty.productName}
                              </span>
                              <Link
                                to={`/warranties/${n.warranty._id || n.warranty}`}
                                onClick={onClose}
                                className="inline-flex items-center space-x-1 font-semibold text-blue-600 dark:text-blue-400 hover:underline"
                              >
                                <span>View Product</span>
                                <ExternalLink className="w-3 h-3" />
                              </Link>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </>
            ) : (
              /* Settings Tab */
              <form onSubmit={handleSaveSettings} className="space-y-6">
                <div>
                  <h3 className="text-xs font-bold text-slate-900 dark:text-white uppercase tracking-wider mb-1">
                    Notification Channels
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">
                    Choose how and when you would like to be notified before product warranties expire.
                  </p>

                  <div className="space-y-3">
                    {/* In-app Notifications Toggle */}
                    <label className="flex items-center justify-between p-3.5 rounded-xl border border-slate-200 dark:border-dark-750 bg-slate-50/50 dark:bg-dark-850 cursor-pointer">
                      <div className="flex items-center space-x-3">
                        <Bell className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                        <div>
                          <p className="text-xs font-semibold text-slate-800 dark:text-slate-200">In-App Notifications</p>
                          <p className="text-[11px] text-slate-500 dark:text-slate-400">Receive alerts in this notification center</p>
                        </div>
                      </div>
                      <input
                        type="checkbox"
                        checked={settingsForm.inAppReminders}
                        onChange={(e) => setSettingsForm({ ...settingsForm, inAppReminders: e.target.checked })}
                        className="w-4 h-4 rounded text-blue-600 focus:ring-blue-500"
                      />
                    </label>

                    {/* Email Reminders Toggle */}
                    <label className="flex items-center justify-between p-3.5 rounded-xl border border-slate-200 dark:border-dark-750 bg-slate-50/50 dark:bg-dark-850 cursor-pointer">
                      <div className="flex items-center space-x-3">
                        <Mail className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                        <div>
                          <p className="text-xs font-semibold text-slate-800 dark:text-slate-200">Email Reminders</p>
                          <p className="text-[11px] text-slate-500 dark:text-slate-400">Dispatched to your registered email address</p>
                        </div>
                      </div>
                      <input
                        type="checkbox"
                        checked={settingsForm.emailReminders}
                        onChange={(e) => setSettingsForm({ ...settingsForm, emailReminders: e.target.checked })}
                        className="w-4 h-4 rounded text-blue-600 focus:ring-blue-500"
                      />
                    </label>

                    {/* Security Alert Emails Toggle */}
                    <label className="flex items-center justify-between p-3.5 rounded-xl border border-slate-200 dark:border-dark-750 bg-slate-50/50 dark:bg-dark-850 cursor-pointer">
                      <div className="flex items-center space-x-3">
                        <ShieldAlert className="w-5 h-5 text-rose-600 dark:text-rose-400" />
                        <div>
                          <p className="text-xs font-semibold text-slate-800 dark:text-slate-200">Security Alert Emails</p>
                          <p className="text-[11px] text-slate-500 dark:text-slate-400">
                            Mandatory owner notices when invoice-backed details change
                          </p>
                        </div>
                      </div>
                      <input
                        type="checkbox"
                        checked={settingsForm.securityEmails}
                        onChange={(e) => setSettingsForm({ ...settingsForm, securityEmails: e.target.checked })}
                        className="w-4 h-4 rounded text-blue-600 focus:ring-blue-500"
                      />
                    </label>

                    {!settingsForm.securityEmails && (
                      <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/50 text-amber-800 dark:text-amber-300 text-[11px] flex items-start gap-2">
                        <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                        <span>
                          Security alert emails are strongly recommended. If you disable them, security
                          corrections still appear in-app and in the audit history, but you will not receive
                          an email warning.
                        </span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Timezone */}
                <div>
                  <h3 className="text-xs font-bold text-slate-900 dark:text-white uppercase tracking-wider mb-1">
                    <span className="inline-flex items-center gap-1.5">
                      <Globe className="w-3.5 h-3.5" />
                      Timezone
                    </span>
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">
                    Reminder days are calculated against your local calendar date.
                  </p>
                  <select
                    value={
                      TIMEZONE_OPTIONS.includes(settingsForm.timezone)
                        ? settingsForm.timezone
                        : settingsForm.timezone || 'UTC'
                    }
                    onChange={(e) => setSettingsForm({ ...settingsForm, timezone: e.target.value })}
                    className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-dark-900 border border-slate-200 dark:border-dark-700 rounded-xl text-sm font-medium text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    {!TIMEZONE_OPTIONS.includes(settingsForm.timezone) && settingsForm.timezone && (
                      <option value={settingsForm.timezone}>{settingsForm.timezone}</option>
                    )}
                    {TIMEZONE_OPTIONS.map((zone) => (
                      <option key={zone} value={zone}>
                        {zone}
                      </option>
                    ))}
                  </select>
                  <p className="mt-1 text-[11px] text-slate-400">
                    The server validates the timezone name using the IANA database.
                  </p>
                </div>

                {/* Reminder Timing Intervals */}
                <div>
                  <h3 className="text-xs font-bold text-slate-900 dark:text-white uppercase tracking-wider mb-1">
                    Reminder Schedule
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">
                    Send reminders when warranty has:
                  </p>

                  <div className="grid grid-cols-3 gap-2">
                    {[30, 14, 7, 3, 1].map((day) => {
                      const isSelected = settingsForm.reminderDays.includes(day);
                      return (
                        <button
                          key={day}
                          type="button"
                          onClick={() => toggleDayInterval(day)}
                          className={`py-2 px-3 rounded-xl text-xs font-semibold border transition-all ${
                            isSelected
                              ? 'bg-blue-600 text-white border-blue-600 shadow-xs'
                              : 'bg-white dark:bg-dark-850 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-dark-750 hover:bg-slate-50'
                          }`}
                        >
                          {day} {day === 1 ? 'day' : 'days'}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {settingsError && (
                  <div className="p-3 bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 text-xs font-semibold rounded-xl text-center">
                    {settingsError}
                  </div>
                )}

                {settingsSuccess && (
                  <div className="p-3 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 text-xs font-semibold rounded-xl text-center">
                    {settingsSuccess}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={savingSettings}
                  className="w-full py-2.5 px-4 bg-blue-600 hover:bg-blue-700 dark:bg-blue-600 dark:hover:bg-blue-500 text-white font-semibold text-xs rounded-xl shadow-xs transition-colors disabled:opacity-50"
                >
                  {savingSettings ? 'Saving...' : 'Save Preferences'}
                </button>
              </form>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default NotificationDrawer;
