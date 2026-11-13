import AuditEvent from '../models/AuditEvent.js';

/**
 * Append an audit event. The audit log is only written through this service;
 * there is no update or delete endpoint.
 *
 * @param {Object} options
 * @returns {Promise<Object>}
 */
export const recordAuditEvent = async ({
  user,
  warranty,
  actor,
  actorEmail = '',
  action,
  changes = [],
  reason = '',
  recordVersion = 1,
  invoiceId = null,
  requestId = null,
  freshAuthMethod = '',
  req = null
}) => {
  if (!user || !warranty || !actor || !action) {
    throw new Error('Audit event requires user, warranty, actor, and action');
  }

  try {
    return await AuditEvent.create({
      user,
      warranty,
      actor,
      actorEmail,
      action,
      changes,
      reason,
      recordVersion,
      invoiceId,
      requestId: requestId || null,
      metadata: {
        freshAuthMethod,
        ipAddress: req?.ip || '',
        userAgent: (req?.headers?.['user-agent'] || '').slice(0, 300)
      }
    });
  } catch (error) {
    if (error.code === 11000 && requestId) {
      // The same request was retried; return the original event instead of
      // creating duplicate history or duplicate notification emails.
      return AuditEvent.findOne({ user, requestId });
    }
    throw error;
  }
};

/**
 * Find an existing audit event for an idempotent retried request.
 */
export const findAuditEventByRequestId = async (user, requestId) => {
  if (!requestId) return null;
  return AuditEvent.findOne({ user, requestId });
};

/**
 * Owner-scoped audit history, newest first.
 */
export const getAuditHistory = async (warrantyId, userId, limit = 100) => {
  return AuditEvent.find({ warranty: warrantyId, user: userId })
    .sort({ createdAt: -1 })
    .limit(Math.min(Math.max(limit, 1), 200));
};
