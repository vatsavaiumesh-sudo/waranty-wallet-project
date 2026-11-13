import { Resend } from 'resend';
import { fieldLabel } from '../utils/controlledEditHelpers.js';

let resendClient = null;
let emailTransportOverride = null;

const DEFAULT_EMAIL_TIMEOUT_MS = 15000;

const getEmailTimeoutMs = () => {
  const configured = Number(process.env.EMAIL_SEND_TIMEOUT_MS);
  return Number.isFinite(configured) && configured > 0
    ? configured
    : DEFAULT_EMAIL_TIMEOUT_MS;
};

const withTimeout = (promise, timeoutMs) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      const error = new Error('Email provider timed out.');
      error.code = 'EMAIL_TIMEOUT';
      reject(error);
    }, timeoutMs);

    Promise.resolve(promise).then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });

/**
 * Test-only transport injection. Production always uses the configured Resend
 * client. No credential values are accepted or exposed here.
 */
export const setEmailTransportForTests = (transport) => {
  emailTransportOverride = transport;
};

export const resetEmailTransportForTests = () => {
  emailTransportOverride = null;
};

/**
 * Honest provider status for scripts and diagnostics. No secret values.
 */
export const getEmailProviderStatus = () => ({
  configured: Boolean(process.env.RESEND_API_KEY),
  fromConfigured: Boolean(process.env.EMAIL_FROM),
  testMode:
    process.env.NODE_ENV === 'test' || process.env.USE_TEST_DATABASE === 'true'
});

const isRetryableProviderError = (error) => {
  const status = Number(error?.statusCode || error?.status || error?.response?.status);
  if (!Number.isFinite(status)) return true;
  if (status === 408 || status === 429) return true;
  return status >= 500;
};

const providerErrorMessage = (error) => {
  if (!error) return 'Email provider rejected the message.';
  if (typeof error === 'string') return error;
  return error.message || 'Email provider rejected the message.';
};

const getResendClient = () => {
  if (resendClient) return resendClient;
  if (process.env.RESEND_API_KEY) {
    resendClient = new Resend(process.env.RESEND_API_KEY);
  }
  return resendClient;
};

const getFromEmail = () =>
  process.env.EMAIL_FROM || 'Warranty Wallet <notifications@warrantywallet.app>';

const getClientUrl = () => process.env.CLIENT_URL || 'http://localhost:5173';

/**
 * Escape untrusted values before interpolating them into HTML emails.
 * Invoice text and user-entered correction reasons are untrusted input.
 */
export const escapeHtml = (value) => {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
};

const formatDateTime = (value) => {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return 'Unknown time';
  return date.toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
    timeZoneName: 'short'
  });
};

const emailShell = ({ title, subtitle, badge, badgeColor, body, footer }) => `
  <!DOCTYPE html>
  <html>
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${escapeHtml(title)}</title>
    <style>
      body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; margin: 0; padding: 24px; color: #1e293b; }
      .container { max-width: 580px; margin: 0 auto; background-color: #ffffff; border-radius: 16px; border: 1px solid #e2e8f0; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05); }
      .header { background-color: #0f172a; padding: 32px 24px; text-align: center; color: #ffffff; }
      .header h1 { margin: 0; font-size: 22px; font-weight: 700; }
      .header p { margin: 6px 0 0; font-size: 13px; color: #94a3b8; }
      .content { padding: 32px 24px; }
      .badge { display: inline-block; padding: 6px 14px; border-radius: 20px; font-size: 13px; font-weight: 700; color: #ffffff; background-color: ${badgeColor}; margin-bottom: 16px; }
      .card { background-color: #f1f5f9; border-radius: 12px; padding: 20px; margin: 20px 0; border: 1px solid #e2e8f0; }
      .card-row { display: flex; justify-content: space-between; gap: 16px; margin-bottom: 8px; font-size: 14px; }
      .card-row:last-child { margin-bottom: 0; }
      .label { color: #64748b; font-weight: 500; }
      .value { color: #0f172a; font-weight: 600; text-align: right; word-break: break-word; }
      .btn-container { text-align: center; margin-top: 32px; }
      .btn { display: inline-block; background-color: #2563eb; color: #ffffff !important; padding: 12px 28px; border-radius: 10px; font-size: 14px; font-weight: 600; text-decoration: none; }
      .footer { background-color: #f8fafc; border-top: 1px solid #e2e8f0; padding: 20px; text-align: center; font-size: 12px; color: #94a3b8; }
      .warning { background-color: #fffbeb; border: 1px solid #fde68a; color: #92400e; border-radius: 10px; padding: 14px; font-size: 13px; line-height: 1.5; }
      .change-table { width: 100%; border-collapse: collapse; font-size: 13px; }
      .change-table th { text-align: left; color: #64748b; font-weight: 600; padding: 8px 6px; border-bottom: 1px solid #e2e8f0; }
      .change-table td { padding: 8px 6px; border-bottom: 1px solid #e2e8f0; vertical-align: top; }
      .old { color: #b91c1c; text-decoration: line-through; }
      .new { color: #047857; font-weight: 600; }
    </style>
  </head>
  <body>
    <div class="container">
      <div class="header">
        <h1>🛡 Warranty Wallet</h1>
        <p>${escapeHtml(subtitle)}</p>
      </div>
      <div class="content">
        ${badge ? `<div style="text-align:center;"><div class="badge">${escapeHtml(badge)}</div></div>` : ''}
        ${body}
      </div>
      <div class="footer">
        <p>© ${new Date().getFullYear()} Warranty Wallet • All rights reserved.</p>
        <p>${escapeHtml(footer || '')}</p>
      </div>
    </div>
  </body>
  </html>
`;

/**
 * Generate formatted HTML template for warranty expiry notification.
 */
export const generateExpiryEmailHtml = ({
  userName,
  productName,
  brand,
  expiryDate,
  daysRemaining,
  dashboardUrl
}) => {
  const countdownText =
    daysRemaining === 0
      ? 'Expires Today'
      : daysRemaining === 1
        ? 'Expires in 1 Day'
        : `Expires in ${daysRemaining} Days`;

  const body = `
    <p>Hi ${escapeHtml(userName || 'there')},</p>
    <p>This is a reminder that the warranty for one of your registered products is ending soon:</p>

    <div class="card">
      <div class="card-row">
        <span class="label">Product:</span>
        <span class="value">${escapeHtml(productName)}</span>
      </div>
      ${brand ? `
      <div class="card-row">
        <span class="label">Brand:</span>
        <span class="value">${escapeHtml(brand)}</span>
      </div>` : ''}
      <div class="card-row">
        <span class="label">Expiry Date:</span>
        <span class="value">${escapeHtml(expiryDate)}</span>
      </div>
      <div class="card-row">
        <span class="label">Remaining:</span>
        <span class="value">${escapeHtml(countdownText)}</span>
      </div>
    </div>

    <p style="font-size: 13px; color: #64748b;">
      If you need to make a claim, please locate your receipts and contact the manufacturer before coverage ends.
    </p>

    <div class="btn-container">
      <a href="${escapeHtml(dashboardUrl)}" class="btn">View Product in Warranty Wallet</a>
    </div>
  `;

  return emailShell({
    title: 'Warranty Expiry Reminder',
    subtitle: 'Product Expiry Notification',
    badge: countdownText,
    badgeColor: daysRemaining <= 7 ? '#e11d48' : '#d97706',
    body,
    footer: 'You received this because email reminders are enabled in your account settings.'
  });
};

/**
 * Generate the mandatory security email sent after a sensitive correction.
 * The original invoice is deliberately not attached or included.
 */
export const generateSecurityEmailHtml = ({
  userName,
  productName,
  changes = [],
  reason,
  correctionAt,
  warrantyUrl
}) => {
  const rows = changes
    .map(
      (change) => `
      <tr>
        <td style="font-weight:600;color:#0f172a;">${escapeHtml(fieldLabel(change.field))}</td>
        <td class="old">${escapeHtml(change.previousValue) || '—'}</td>
        <td class="new">${escapeHtml(change.newValue) || '—'}</td>
      </tr>`
    )
    .join('');

  const body = `
    <p>Hi ${escapeHtml(userName || 'there')},</p>
    <p>Important information was changed on your Warranty Wallet record for:</p>

    <div class="card">
      <div class="card-row">
        <span class="label">Product:</span>
        <span class="value">${escapeHtml(productName)}</span>
      </div>
      <div class="card-row">
        <span class="label">Correction time:</span>
        <span class="value">${escapeHtml(formatDateTime(correctionAt))}</span>
      </div>
    </div>

    <table class="change-table">
      <thead>
        <tr>
          <th>Field</th>
          <th>Previous value</th>
          <th>New value</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>

    <div class="card">
      <div class="card-row">
        <span class="label">Reason provided:</span>
        <span class="value">${escapeHtml(reason) || '—'}</span>
      </div>
    </div>

    <div class="warning" style="margin-top:20px;">
      <strong>Your original invoice has not been modified.</strong><br>
      Warranty Wallet preserves the uploaded invoice evidence and records this
      correction in the warranty audit history. If you did not authorize this
      change, review the audit history and secure your account immediately.
    </div>

    <div class="btn-container">
      <a href="${escapeHtml(warrantyUrl)}" class="btn">Review Warranty &amp; Audit History</a>
    </div>
  `;

  return emailShell({
    title: 'Important warranty record change',
    subtitle: 'Security Notification',
    badge: 'Important record changed',
    badgeColor: '#e11d48',
    body,
    footer: 'You received this security notification because sensitive warranty details were corrected.'
  });
};

/**
 * Low-level email dispatch. Returns a structured result and never throws for
 * provider failures so callers can retain a retryable delivery state.
 */
export const sendEmail = async ({ toEmail, subject, html }) => {
  const recipient = String(toEmail || '').trim();

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) {
    return {
      success: false,
      error: 'A valid recipient email address is required.',
      code: 'INVALID_RECIPIENT',
      retryable: false
    };
  }

  // Never deliver real email from the isolated test database mode, even when a
  // provider key is configured. Checked before the Resend client is created.
  if (process.env.NODE_ENV === 'test' || process.env.USE_TEST_DATABASE === 'true') {
    console.log(`[SIMULATED EMAIL] To: ${recipient} | Subject: ${subject}`);
    return {
      success: true,
      simulated: true,
      id: `sim-${Date.now()}`
    };
  }

  const transport = emailTransportOverride || getResendClient();

  if (!transport) {
    return {
      success: false,
      error:
        'Email provider is not configured. Set RESEND_API_KEY and EMAIL_FROM on the backend.',
      code: 'PROVIDER_NOT_CONFIGURED',
      retryable: true
    };
  }

  try {
    const send = transport.emails?.send
      ? transport.emails.send.bind(transport.emails)
      : transport.send?.bind(transport);

    if (typeof send !== 'function') {
      return {
        success: false,
        error: 'Email transport does not provide a send function.',
        code: 'INVALID_TRANSPORT',
        retryable: false
      };
    }

    const result = await withTimeout(
      send({
        from: getFromEmail(),
        to: [recipient],
        subject,
        html
      }),
      getEmailTimeoutMs()
    );

    if (result?.error) {
      return {
        success: false,
        error: providerErrorMessage(result.error),
        code: 'PROVIDER_REJECTED',
        retryable: isRetryableProviderError(result.error)
      };
    }

    return {
      success: true,
      data: result?.data || result,
      id: result?.data?.id || null
    };
  } catch (error) {
    const timedOut = error?.code === 'EMAIL_TIMEOUT';
    console.error(
      `Failed to send email to ${recipient}: ${providerErrorMessage(error)}`
    );
    return {
      success: false,
      error: timedOut ? 'Email provider timed out.' : providerErrorMessage(error),
      code: timedOut ? 'PROVIDER_TIMEOUT' : 'PROVIDER_ERROR',
      retryable: isRetryableProviderError(error)
    };
  }
};

/**
 * Dispatch an expiry reminder email.
 */
export const sendExpiryReminderEmail = async ({
  toEmail,
  userName,
  productName,
  brand,
  expiryDate,
  daysRemaining,
  warrantyId
}) => {
  const dashboardUrl = `${getClientUrl().replace(/\/$/, '')}/warranties/${warrantyId}`;

  const subject =
    daysRemaining === 0
      ? `⚠️ Action Required: Warranty for ${productName} expires today!`
      : `Reminder: Warranty for ${productName} expires in ${daysRemaining} day${daysRemaining > 1 ? 's' : ''}`;

  const html = generateExpiryEmailHtml({
    userName,
    productName,
    brand,
    expiryDate,
    daysRemaining,
    dashboardUrl
  });

  return sendEmail({ toEmail, subject, html });
};

/**
 * Dispatch the mandatory security email for a sensitive correction.
 */
export const sendSecurityCorrectionEmail = async ({
  toEmail,
  userName,
  productName,
  changes,
  reason,
  correctionAt,
  warrantyId
}) => {
  const warrantyUrl = `${getClientUrl().replace(/\/$/, '')}/warranties/${warrantyId}`;

  const html = generateSecurityEmailHtml({
    userName,
    productName,
    changes,
    reason,
    correctionAt,
    warrantyUrl
  });

  return sendEmail({
    toEmail,
    subject: 'Security Alert: Important changes were made to your Warranty Wallet record',
    html
  });
};
