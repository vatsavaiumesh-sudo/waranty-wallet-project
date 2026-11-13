import Warranty from '../models/Warranty.js';
import InvoiceUpload from '../models/InvoiceUpload.js';
import AuditEvent from '../models/AuditEvent.js';
import {
  processAndStoreInvoice,
  verifyInvoiceIntegrity
} from '../services/invoiceEvidenceService.js';
import { recordAuditEvent, getAuditHistory } from '../services/auditService.js';
import { verifyFreshAuthentication } from '../services/freshAuthService.js';
import { createSecurityCorrectionNotification } from '../services/notificationService.js';
import { validateCorrectionReason } from '../utils/controlledEditHelpers.js';
import { decorateWarranty } from '../utils/warrantyHelpers.js';

const findOwnedWarranty = (id, userId, includeArchived = false) =>
  Warranty.findOne({
    _id: id,
    user: userId,
    ...(includeArchived ? {} : { deletedAt: null })
  });

const invoiceSummary = (invoice) => ({
  originalName: invoice.originalName,
  mimeType: invoice.mimeType,
  size: invoice.size,
  checksum: invoice.checksum,
  uploadedAt: invoice.uploadedAt,
  isCloud: invoice.isCloud
});

/**
 * @desc    Upload an invoice for extraction and review before warranty creation
 * @route   POST /api/warranties/invoice/extract
 * @access  Private
 */
export const extractInvoiceForReview = async (req, res, next) => {
  try {
    const file = req.files?.invoiceFile?.[0];
    if (!file) {
      return res.status(400).json({
        success: false,
        message: 'Please upload an invoice PDF or image to extract information.'
      });
    }

    const evidence = await processAndStoreInvoice(file, req.user._id);

    const draft = await InvoiceUpload.create({
      user: req.user._id,
      originalName: evidence.originalName,
      mimeType: evidence.mimeType,
      size: evidence.size,
      checksum: evidence.checksum,
      storageUrl: evidence.storageUrl,
      storageKey: evidence.storageKey,
      isCloud: evidence.isCloud,
      extraction: evidence.extraction,
      status: 'ready'
    });

    res.status(200).json({
      success: true,
      message:
        evidence.extraction.status === 'provider_unavailable'
          ? 'Invoice stored. Automatic reading is unavailable, so please enter the details manually.'
          : 'Invoice processed. Review the extracted values before saving.',
      data: {
        uploadId: draft._id,
        invoice: invoiceSummary(evidence),
        extraction: evidence.extraction
      }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Verify that the stored invoice still matches its upload checksum
 * @route   GET /api/warranties/:id/invoice/verify
 * @access  Private
 */
export const verifyInvoice = async (req, res, next) => {
  try {
    const warranty = await findOwnedWarranty(req.params.id, req.user._id, true);
    if (!warranty) {
      return res.status(404).json({ success: false, message: 'Warranty not found' });
    }

    const result = await verifyInvoiceIntegrity(warranty);
    res.status(200).json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Replace invoice evidence with fresh authentication and a reason
 * @route   POST /api/warranties/:id/invoice/replace
 * @access  Private
 */
export const replaceInvoice = async (req, res, next) => {
  try {
    const warranty = await findOwnedWarranty(req.params.id, req.user._id);
    if (!warranty) {
      return res.status(404).json({ success: false, message: 'Warranty not found' });
    }

    const requestId = String(req.body.requestId || '').trim() || null;
    if (requestId) {
      const existing = await AuditEvent.findOne({ user: req.user._id, requestId });
      if (existing) {
        return res.status(200).json({
          success: true,
          message: 'This invoice replacement was already applied.',
          idempotent: true,
          data: decorateWarranty(warranty)
        });
      }
    }

    const file = req.files?.invoiceFile?.[0];
    if (!file) {
      return res.status(400).json({
        success: false,
        message: 'Please upload the replacement invoice document.'
      });
    }

    const reasonResult = validateCorrectionReason(req.body.reason);
    if (!reasonResult.valid) {
      return res.status(400).json({
        success: false,
        code: 'CORRECTION_REASON_REQUIRED',
        message: reasonResult.message
      });
    }

    const authResult = await verifyFreshAuthentication({
      user: req.user,
      googleCredential: req.body.freshGoogleCredential,
      password: req.body.freshPassword
    });

    if (!authResult.ok) {
      return res.status(authResult.status || 401).json({
        success: false,
        code: authResult.code,
        message: authResult.message
      });
    }

    const nextEvidence = await processAndStoreInvoice(file, req.user._id);
    const now = new Date();
    const previousInvoice = warranty.invoice;
    const versions = previousInvoice?.versions ? [...previousInvoice.versions] : [];

    // Preserve the previous evidence version. The old storage object is never
    // deleted by this endpoint.
    if (previousInvoice?.checksum || previousInvoice?.storageUrl) {
      versions.push({
        originalName: previousInvoice.originalName || '',
        mimeType: previousInvoice.mimeType || '',
        size: previousInvoice.size || 0,
        checksum: previousInvoice.checksum || '',
        storageUrl: previousInvoice.storageUrl || '',
        storageKey: previousInvoice.storageKey || '',
        isCloud: Boolean(previousInvoice.isCloud),
        uploadedAt: previousInvoice.uploadedAt || null,
        uploadedBy: previousInvoice.uploadedBy || null,
        replacedAt: now,
        replacedBy: req.user._id,
        reason: reasonResult.reason
      });
    }

    warranty.invoice = {
      ...nextEvidence,
      status: 'confirmed',
      versions
    };
    warranty.invoiceFile = nextEvidence.storageUrl;
    warranty.recordVersion = (warranty.recordVersion || 1) + 1;
    warranty.lastCorrectionAt = now;
    warranty.lastCorrectionBy = req.user._id;
    warranty.evidenceStatus = 'confirmed';
    await warranty.save();

    const changes = [
      {
        field: 'invoice',
        previousValue: previousInvoice?.originalName
          ? `${previousInvoice.originalName} (${previousInvoice.checksum?.slice(0, 12) || 'no checksum'})`
          : 'No previous invoice',
        newValue: `${nextEvidence.originalName} (${nextEvidence.checksum.slice(0, 12)})`
      }
    ];

    await recordAuditEvent({
      user: req.user._id,
      warranty: warranty._id,
      actor: req.user._id,
      actorEmail: req.user.email,
      action: 'INVOICE_REPLACED',
      changes,
      reason: reasonResult.reason,
      recordVersion: warranty.recordVersion,
      requestId,
      freshAuthMethod: authResult.method,
      req
    });

    let emailStatus = 'failed';
    try {
      const { notification, emailResult } = await createSecurityCorrectionNotification({
        user: req.user,
        warranty,
        changes,
        reason: reasonResult.reason,
        requestId
      });
      emailStatus = emailResult.success ? 'sent' : notification.emailStatus;
    } catch (notifyError) {
      console.error('Invoice replacement notification failed:', notifyError.message);
    }

    res.status(200).json({
      success: true,
      message: 'Invoice replaced. The previous version was preserved.',
      emailStatus,
      data: decorateWarranty(warranty)
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Mark invoice evidence as removed without deleting the stored file
 * @route   DELETE /api/warranties/:id/invoice
 * @access  Private
 */
export const removeInvoice = async (req, res, next) => {
  try {
    const warranty = await findOwnedWarranty(req.params.id, req.user._id);
    if (!warranty) {
      return res.status(404).json({ success: false, message: 'Warranty not found' });
    }

    if (!warranty.invoice?.checksum && !warranty.invoiceFile) {
      return res.status(404).json({
        success: false,
        message: 'No invoice document is attached to this warranty.'
      });
    }

    if (warranty.invoice?.status === 'removed') {
      return res.status(400).json({
        success: false,
        message: 'The invoice is already marked as removed.'
      });
    }

    const reasonResult = validateCorrectionReason(req.body.reason);
    if (!reasonResult.valid) {
      return res.status(400).json({
        success: false,
        code: 'CORRECTION_REASON_REQUIRED',
        message: reasonResult.message
      });
    }

    const authResult = await verifyFreshAuthentication({
      user: req.user,
      googleCredential: req.body.freshGoogleCredential,
      password: req.body.freshPassword
    });

    if (!authResult.ok) {
      return res.status(authResult.status || 401).json({
        success: false,
        code: authResult.code,
        message: authResult.message
      });
    }

    const now = new Date();
    const previousInvoice = warranty.invoice;

    if (previousInvoice) {
      previousInvoice.versions = [
        ...(previousInvoice.versions || []),
        {
          originalName: previousInvoice.originalName || '',
          mimeType: previousInvoice.mimeType || '',
          size: previousInvoice.size || 0,
          checksum: previousInvoice.checksum || '',
          storageUrl: previousInvoice.storageUrl || '',
          storageKey: previousInvoice.storageKey || '',
          isCloud: Boolean(previousInvoice.isCloud),
          uploadedAt: previousInvoice.uploadedAt || null,
          uploadedBy: previousInvoice.uploadedBy || null,
          replacedAt: now,
          replacedBy: req.user._id,
          reason: reasonResult.reason
        }
      ];
      previousInvoice.status = 'removed';
      previousInvoice.removedAt = now;
      previousInvoice.removalReason = reasonResult.reason;
      previousInvoice.storageUrl = '';
      previousInvoice.storageKey = '';
    }

    warranty.invoiceFile = '';
    warranty.recordVersion = (warranty.recordVersion || 1) + 1;
    warranty.lastCorrectionAt = now;
    warranty.lastCorrectionBy = req.user._id;
    await warranty.save();

    const changes = [
      {
        field: 'invoice',
        previousValue: previousInvoice?.originalName || 'Attached invoice',
        newValue: 'Invoice marked as removed (original evidence retained)'
      }
    ];

    await recordAuditEvent({
      user: req.user._id,
      warranty: warranty._id,
      actor: req.user._id,
      actorEmail: req.user.email,
      action: 'INVOICE_REMOVED',
      changes,
      reason: reasonResult.reason,
      recordVersion: warranty.recordVersion,
      freshAuthMethod: authResult.method,
      req
    });

    let emailStatus = 'failed';
    try {
      const { notification, emailResult } = await createSecurityCorrectionNotification({
        user: req.user,
        warranty,
        changes,
        reason: reasonResult.reason
      });
      emailStatus = emailResult.success ? 'sent' : notification.emailStatus;
    } catch (notifyError) {
      console.error('Invoice removal notification failed:', notifyError.message);
    }

    res.status(200).json({
      success: true,
      message:
        'Invoice marked as removed. The original evidence file was retained and the action was recorded.',
      emailStatus,
      data: decorateWarranty(warranty)
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get owner-scoped audit history for a warranty
 * @route   GET /api/warranties/:id/audit
 * @access  Private
 */
export const getWarrantyAudit = async (req, res, next) => {
  try {
    const warranty = await findOwnedWarranty(req.params.id, req.user._id, true);
    if (!warranty) {
      return res.status(404).json({ success: false, message: 'Warranty not found' });
    }

    const events = await getAuditHistory(warranty._id, req.user._id, req.query.limit);

    res.status(200).json({
      success: true,
      count: events.length,
      data: events.map((event) => ({
        _id: event._id,
        action: event.action,
        changes: event.changes,
        reason: event.reason,
        recordVersion: event.recordVersion,
        actorEmail: event.actorEmail,
        freshAuthMethod: event.metadata?.freshAuthMethod || '',
        createdAt: event.createdAt
      }))
    });
  } catch (error) {
    next(error);
  }
};
