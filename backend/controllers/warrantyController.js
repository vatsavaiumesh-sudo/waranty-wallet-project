import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import Warranty from '../models/Warranty.js';
import InvoiceUpload from '../models/InvoiceUpload.js';
import AuditEvent from '../models/AuditEvent.js';
import {
  calculateExpiryDate,
  decorateWarranty,
  isInvoiceBacked
} from '../utils/warrantyHelpers.js';
import {
  deleteStoredFile,
  getSignedFileUrl
} from '../services/storageService.js';
import {
  persistProductImage,
  planProductImageChange
} from '../services/productImageService.js';
import {
  processAndStoreInvoice,
  buildInvoiceFromDraft
} from '../services/invoiceEvidenceService.js';
import { recordAuditEvent } from '../services/auditService.js';
import {
  findProtectedBodyFields,
  computeSensitiveChanges,
  validateCorrectionReason
} from '../utils/controlledEditHelpers.js';
import { verifyFreshAuthentication } from '../services/freshAuthService.js';
import { createSecurityCorrectionNotification } from '../services/notificationService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uploadsDir = path.join(__dirname, '../uploads');

const activeWarrantyQuery = (id, userId) => ({
  _id: id,
  user: userId,
  deletedAt: null
});

const cleanString = (value) => (value === undefined || value === null ? '' : String(value).trim());

const parseOptionalDate = (value) => {
  if (value === undefined || value === null || value === '') return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const assignEditableFields = (warranty, body, { allowSensitive }) => {
  if (allowSensitive) {
    if (body.productName !== undefined) warranty.productName = cleanString(body.productName);
    if (body.brand !== undefined) warranty.brand = cleanString(body.brand);
    if (body.modelNumber !== undefined) warranty.modelNumber = cleanString(body.modelNumber);
    if (body.store !== undefined) warranty.store = cleanString(body.store);
    if (body.serialNumber !== undefined) warranty.serialNumber = cleanString(body.serialNumber);
    if (body.invoiceNumber !== undefined) warranty.invoiceNumber = cleanString(body.invoiceNumber);
    if (body.currency !== undefined) warranty.currency = cleanString(body.currency).toUpperCase();
    if (body.purchaseDate !== undefined) {
      const next = parseOptionalDate(body.purchaseDate);
      if (next) warranty.purchaseDate = next;
    }
    if (body.warrantyStartDate !== undefined) {
      warranty.warrantyStartDate = parseOptionalDate(body.warrantyStartDate);
    }
    if (body.warrantyDuration !== undefined) warranty.warrantyDuration = Number(body.warrantyDuration);
    if (body.warrantyUnit !== undefined) warranty.warrantyUnit = body.warrantyUnit;
    if (body.price !== undefined) {
      warranty.price =
        body.price === '' || body.price === null ? null : Number(body.price);
    }
  }

  if (body.category !== undefined) warranty.category = body.category;
  if (body.notes !== undefined) warranty.notes = cleanString(body.notes);
};

/**
 * @desc    Get all warranties with search, filter, and sort options (Scoped to User)
 * @route   GET /api/warranties
 * @access  Private
 */
export const getWarranties = async (req, res, next) => {
  try {
    const { search, category, status, sort } = req.query;

    // Strict user ownership filter and exclusion of archived records.
    let query = { user: req.user._id, deletedAt: null };

    // Search by product name, brand, store, model, invoice, or serial number
    if (search && search.trim() !== '') {
      const searchRegex = new RegExp(search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      query.$and = [
        {
          $or: [
            { productName: searchRegex },
            { brand: searchRegex },
            { store: searchRegex },
            { modelNumber: searchRegex },
            { invoiceNumber: searchRegex },
            { serialNumber: searchRegex }
          ]
        }
      ];
    }

    if (category && category !== 'All') {
      query.category = category;
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const thirtyDaysFromNow = new Date(today);
    thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);
    thirtyDaysFromNow.setHours(23, 59, 59, 999);

    if (status && status !== 'All') {
      if (status === 'ACTIVE') {
        query.warrantyExpiryDate = { $gt: thirtyDaysFromNow };
      } else if (status === 'EXPIRING_SOON') {
        query.warrantyExpiryDate = { $gte: today, $lte: thirtyDaysFromNow };
      } else if (status === 'EXPIRED') {
        query.warrantyExpiryDate = { $lt: today };
      }
    }

    let sortOptions = { createdAt: -1 };
    if (sort === 'oldest') {
      sortOptions = { createdAt: 1 };
    } else if (sort === 'ending_soon') {
      sortOptions = { warrantyExpiryDate: 1 };
    } else if (sort === 'name') {
      sortOptions = { productName: 1 };
    }

    const warranties = await Warranty.find(query).sort(sortOptions);
    const decoratedWarranties = warranties.map(decorateWarranty);

    res.status(200).json({
      success: true,
      count: decoratedWarranties.length,
      data: decoratedWarranties
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get dashboard statistics (Scoped to User)
 * @route   GET /api/warranties/stats
 * @access  Private
 */
export const getWarrantyStats = async (req, res, next) => {
  try {
    const userId = req.user._id;
    const base = { user: userId, deletedAt: null };

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const thirtyDaysFromNow = new Date(today);
    thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);
    thirtyDaysFromNow.setHours(23, 59, 59, 999);

    const total = await Warranty.countDocuments(base);
    const active = await Warranty.countDocuments({
      ...base,
      warrantyExpiryDate: { $gt: thirtyDaysFromNow }
    });
    const expiringSoon = await Warranty.countDocuments({
      ...base,
      warrantyExpiryDate: { $gte: today, $lte: thirtyDaysFromNow }
    });
    const expired = await Warranty.countDocuments({
      ...base,
      warrantyExpiryDate: { $lt: today }
    });
    const legacyUnverified = await Warranty.countDocuments({
      ...base,
      evidenceStatus: 'legacy_unverified'
    });

    const expiringSoonItems = await Warranty.find({
      ...base,
      warrantyExpiryDate: { $gte: today, $lte: thirtyDaysFromNow }
    })
      .sort({ warrantyExpiryDate: 1 })
      .limit(6);

    const recentItems = await Warranty.find(base)
      .sort({ createdAt: -1 })
      .limit(4);

    res.status(200).json({
      success: true,
      data: {
        total,
        active,
        expiringSoon,
        expired,
        legacyUnverified,
        expiringSoonItems: expiringSoonItems.map(decorateWarranty),
        recentItems: recentItems.map(decorateWarranty)
      }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get single warranty by ID (Scoped to User)
 * @route   GET /api/warranties/:id
 * @access  Private
 */
export const getWarrantyById = async (req, res, next) => {
  try {
    const warranty = await Warranty.findOne(activeWarrantyQuery(req.params.id, req.user._id));

    if (!warranty) {
      return res.status(404).json({
        success: false,
        message: 'Warranty not found'
      });
    }

    res.status(200).json({
      success: true,
      data: decorateWarranty(warranty)
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Create new warranty product (Scoped to User)
 * @route   POST /api/warranties
 * @access  Private
 */
export const createWarranty = async (req, res, next) => {
  try {
    const {
      productName,
      brand,
      modelNumber,
      category,
      purchaseDate,
      warrantyStartDate,
      warrantyDuration,
      warrantyUnit,
      store,
      price,
      currency,
      invoiceNumber,
      serialNumber,
      notes,
      onlineProductImage,
      invoiceUploadId
    } = req.body;

    if (!productName || !category || !purchaseDate || !warrantyDuration || !warrantyUnit) {
      return res.status(400).json({
        success: false,
        message:
          'Please provide all required fields: productName, category, purchaseDate, warrantyDuration, warrantyUnit.'
      });
    }

    const parsedStartDate = parseOptionalDate(warrantyStartDate);
    const expiryBaseDate = parsedStartDate || purchaseDate;
    const warrantyExpiryDate = calculateExpiryDate(
      expiryBaseDate,
      warrantyDuration,
      warrantyUnit
    );

    let productImage = '';
    let productImageMeta = null;
    let imageWarning = '';
    let evidence = null;

    const uploadedProductImage = req.files?.productImage?.[0];

    if (uploadedProductImage) {
      const persisted = await persistProductImage({
        file: uploadedProductImage,
        userId: req.user._id
      });
      if (persisted.ok) {
        productImage = persisted.url;
        productImageMeta = persisted.meta;
      } else {
        imageWarning = `The uploaded product image could not be stored: ${persisted.error}`;
      }
    }

    if (!productImage && onlineProductImage) {
      const persisted = await persistProductImage({
        remoteUrl: onlineProductImage,
        userId: req.user._id
      });
      if (persisted.ok) {
        productImage = persisted.url;
        productImageMeta = persisted.meta;
      } else {
        imageWarning = `The selected online product image could not be stored: ${persisted.error}`;
      }
    }

    // Prefer the reviewed draft created by the extraction step. If the client
    // uploaded the invoice directly, process it here as a fallback.
    if (req.files?.invoiceFile?.[0]) {
      evidence = await processAndStoreInvoice(req.files.invoiceFile[0], req.user._id);
      evidence.status = 'confirmed';
    } else if (invoiceUploadId) {
      const draft = await InvoiceUpload.findOne({
        _id: invoiceUploadId,
        user: req.user._id,
        status: 'ready'
      });

      if (!draft) {
        return res.status(400).json({
          success: false,
          message:
            'The uploaded invoice review has expired or does not belong to this account. Please upload the invoice again.'
        });
      }

      evidence = buildInvoiceFromDraft(draft);
    }

    const warranty = await Warranty.create({
      user: req.user._id,
      productName: cleanString(productName),
      brand: cleanString(brand),
      modelNumber: cleanString(modelNumber),
      category,
      purchaseDate,
      warrantyStartDate: parsedStartDate,
      warrantyDuration: Number(warrantyDuration),
      warrantyUnit,
      warrantyExpiryDate,
      store: cleanString(store),
      price: price !== '' && price !== undefined && price !== null ? Number(price) : null,
      currency: cleanString(currency).toUpperCase(),
      invoiceNumber: cleanString(invoiceNumber),
      serialNumber: cleanString(serialNumber),
      notes: cleanString(notes),
      productImage,
      productImageMeta: productImageMeta || undefined,
      invoiceFile: evidence?.storageUrl || '',
      invoice: evidence || undefined,
      evidenceStatus: 'confirmed',
      recordVersion: 1
    });

    if (invoiceUploadId) {
      await InvoiceUpload.updateOne(
        { _id: invoiceUploadId, user: req.user._id, status: 'ready' },
        { $set: { status: 'consumed', consumedByWarranty: warranty._id } }
      );
    }

    await recordAuditEvent({
      user: req.user._id,
      warranty: warranty._id,
      actor: req.user._id,
      actorEmail: req.user.email,
      action: 'WARRANTY_CREATED',
      changes: [],
      recordVersion: warranty.recordVersion,
      req
    });

    if (evidence) {
      await recordAuditEvent({
        user: req.user._id,
        warranty: warranty._id,
        actor: req.user._id,
        actorEmail: req.user.email,
        action: 'INVOICE_UPLOADED',
        changes: [],
        recordVersion: warranty.recordVersion,
        invoiceId: warranty.invoice?._id || null,
        req
      });
    }

    res.status(201).json({
      success: true,
      message: 'Warranty product added successfully',
      imageWarning: imageWarning || undefined,
      data: decorateWarranty(warranty)
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Update warranty with controlled correction workflow
 * @route   PUT /api/warranties/:id
 * @access  Private
 */
export const updateWarranty = async (req, res, next) => {
  try {
    const warranty = await Warranty.findOne(
      activeWarrantyQuery(req.params.id, req.user._id)
    );

    if (!warranty) {
      return res.status(404).json({
        success: false,
        message: 'Warranty not found'
      });
    }

    // Invoice metadata and server-managed fields can never be written through
    // the ordinary update endpoint.
    const protectedFields = findProtectedBodyFields(req.body);
    if (protectedFields.length > 0) {
      return res.status(400).json({
        success: false,
        code: 'PROTECTED_FIELDS',
        message: `These fields cannot be changed through the warranty update endpoint: ${protectedFields.join(', ')}.`
      });
    }

    if (req.files?.invoiceFile?.[0] || req.body.removeInvoiceFile === 'true') {
      return res.status(400).json({
        success: false,
        code: 'INVOICE_PROTECTED',
        message:
          'Invoice evidence cannot be replaced or removed through ordinary editing. Use the dedicated invoice replacement or removal action.'
      });
    }

    const sensitiveChanges = computeSensitiveChanges(warranty, req.body);
    const invoiceBacked = isInvoiceBacked(warranty);
    const requestId = cleanString(req.body.requestId) || null;
    let freshAuthMethod = '';
    let correctionReason = '';

    // Idempotency: a retried request with the same ID returns the existing
    // result instead of creating duplicate audit history or emails. Check this
    // before requiring fresh authentication again.
    if (requestId) {
      const existing = await AuditEvent.findOne({ user: req.user._id, requestId });
      if (existing) {
        return res.status(200).json({
          success: true,
          message: 'This correction was already applied.',
          idempotent: true,
          data: decorateWarranty(warranty)
        });
      }
    }

    if (invoiceBacked && sensitiveChanges.length > 0) {
      const reasonResult = validateCorrectionReason(req.body.correctionReason);
      if (!reasonResult.valid) {
        return res.status(400).json({
          success: false,
          code: 'CORRECTION_REASON_REQUIRED',
          message: reasonResult.message,
          protectedFields: sensitiveChanges.map((change) => change.field)
        });
      }
      correctionReason = reasonResult.reason;

      const authResult = await verifyFreshAuthentication({
        user: req.user,
        googleCredential: req.body.freshGoogleCredential,
        password: req.body.freshPassword
      });

      if (!authResult.ok) {
        return res.status(authResult.status || 401).json({
          success: false,
          code: authResult.code,
          message: authResult.message,
          protectedFields: sensitiveChanges.map((change) => change.field)
        });
      }
      freshAuthMethod = authResult.method;
    }

    const nextRecordVersion =
      sensitiveChanges.length > 0 ? (warranty.recordVersion || 1) + 1 : warranty.recordVersion || 1;

    const previousValues = {
      category: warranty.category,
      notes: warranty.notes,
      productImage: warranty.productImage
    };

    // Sensitive fields are only assigned after the correction workflow passes.
    assignEditableFields(warranty, req.body, {
      allowSensitive: !invoiceBacked || sensitiveChanges.length > 0
    });

    if (!Number.isFinite(warranty.warrantyDuration) || warranty.warrantyDuration < 1) {
      return res.status(400).json({
        success: false,
        message: 'Warranty duration must be at least 1.'
      });
    }

    if (
      warranty.price !== null &&
      (!Number.isFinite(warranty.price) || warranty.price < 0)
    ) {
      return res.status(400).json({
        success: false,
        message: 'Purchase amount must be a non-negative number.'
      });
    }

    // Recalculate expiry from the confirmed purchase/start date and duration.
    warranty.warrantyExpiryDate = calculateExpiryDate(
      warranty.warrantyStartDate || warranty.purchaseDate,
      warranty.warrantyDuration,
      warranty.warrantyUnit
    );

    const previousProductImage = warranty.productImage;
    let productImage = previousProductImage;
    let productImageMeta = warranty.productImageMeta;
    let imageWarning = '';
    let imageToDelete = '';

    const imagePlan = planProductImageChange({
      existingUrl: previousProductImage,
      hasUpload: Boolean(req.files?.productImage?.[0]),
      onlineUrl: req.body.onlineProductImage,
      removeRequested: req.body.removeProductImage === 'true'
    });

    if (imagePlan.action === 'remove') {
      imageToDelete = previousProductImage;
      productImage = '';
      productImageMeta = undefined;
    } else if (imagePlan.action === 'replace') {
      // Upload first, then remove the previous image only after the new image
      // has been stored successfully and the record has been saved. A failed
      // upload or save must never leave the warranty pointing at a deleted file.
      const persisted = await persistProductImage({
        file: req.files?.productImage?.[0] || null,
        remoteUrl:
          imagePlan.reason === 'online_selection' ? req.body.onlineProductImage : '',
        userId: req.user._id
      });

      if (persisted.ok) {
        productImage = persisted.url;
        productImageMeta = persisted.meta;
        if (previousProductImage && previousProductImage !== productImage) {
          imageToDelete = previousProductImage;
        }
      } else {
        imageWarning =
          'The product image could not be stored; the existing image was preserved. ' +
          persisted.error;
      }
    }

    warranty.productImage = productImage;
    if (productImageMeta) {
      warranty.productImageMeta = productImageMeta;
    } else if (!productImage) {
      warranty.productImageMeta = undefined;
    }

    if (sensitiveChanges.length > 0) {
      warranty.recordVersion = nextRecordVersion;
      warranty.lastCorrectionAt = new Date();
      warranty.lastCorrectionBy = req.user._id;
    }

    const saved = await warranty.save();

    // Delete the superseded image only after the database write succeeds.
    if (imageToDelete && imageToDelete !== saved.productImage) {
      await deleteStoredFile(imageToDelete);
    }

    const nonSensitiveChanges = ['category', 'notes']
      .filter(
        (field) =>
          req.body[field] !== undefined &&
          cleanString(req.body[field]) !== cleanString(previousValues[field])
      )
      .map((field) => ({
        field,
        previousValue: cleanString(previousValues[field]),
        newValue: cleanString(req.body[field])
      }));

    const productImageChanged = productImage !== previousValues.productImage;

    if (sensitiveChanges.length > 0) {
      await recordAuditEvent({
        user: req.user._id,
        warranty: saved._id,
        actor: req.user._id,
        actorEmail: req.user.email,
        action: 'SENSITIVE_CORRECTION',
        changes: sensitiveChanges,
        reason: correctionReason,
        recordVersion: saved.recordVersion,
        requestId,
        freshAuthMethod,
        req
      });
    } else if (nonSensitiveChanges.length > 0 || productImageChanged) {
      await recordAuditEvent({
        user: req.user._id,
        warranty: saved._id,
        actor: req.user._id,
        actorEmail: req.user.email,
        action: 'WARRANTY_UPDATED',
        changes: nonSensitiveChanges,
        recordVersion: saved.recordVersion,
        requestId,
        req
      });
    }

    let notificationStatus = null;
    let emailStatus = null;

    if (sensitiveChanges.length > 0) {
      try {
        const { notification, emailResult } = await createSecurityCorrectionNotification({
          user: req.user,
          warranty: saved,
          changes: sensitiveChanges,
          reason: correctionReason,
          requestId
        });
        notificationStatus = notification.emailStatus;
        emailStatus = emailResult.success ? 'sent' : notification.emailStatus;
      } catch (notifyError) {
        // The correction is already committed. Do not roll it back when the
        // notification provider or database write fails; report the failure.
        console.error('Security notification failed:', notifyError.message);
        notificationStatus = 'failed';
        emailStatus = 'failed';
      }
    }

    res.status(200).json({
      success: true,
      message:
        sensitiveChanges.length > 0
          ? 'Sensitive warranty details corrected and the account owner was notified.'
          : 'Warranty updated successfully',
      protectedFieldsChanged: sensitiveChanges.map((change) => change.field),
      notificationStatus,
      emailStatus,
      imageWarning: imageWarning || undefined,
      data: decorateWarranty(saved)
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Archive a warranty (soft delete) while preserving invoice evidence
 * @route   DELETE /api/warranties/:id
 * @access  Private
 */
export const deleteWarranty = async (req, res, next) => {
  try {
    const warranty = await Warranty.findOne(
      activeWarrantyQuery(req.params.id, req.user._id)
    );

    if (!warranty) {
      return res.status(404).json({
        success: false,
        message: 'Warranty not found'
      });
    }

    warranty.deletedAt = new Date();
    await warranty.save();

    await recordAuditEvent({
      user: req.user._id,
      warranty: warranty._id,
      actor: req.user._id,
      actorEmail: req.user.email,
      action: 'WARRANTY_DELETED',
      changes: [],
      recordVersion: warranty.recordVersion,
      req
    });

    // Original invoice evidence is intentionally retained. Physical retention
    // and purge policy are an operational decision, not an ordinary edit.
    res.status(200).json({
      success: true,
      message: 'Warranty deleted successfully'
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get authorized invoice access (Signed cloud URL or secure stream)
 * @route   GET /api/warranties/:id/invoice
 * @access  Private
 */
export const getInvoiceFile = async (req, res, next) => {
  try {
    const warranty = await Warranty.findOne(
      activeWarrantyQuery(req.params.id, req.user._id)
    );

    if (!warranty) {
      return res.status(404).json({
        success: false,
        message: 'Warranty not found'
      });
    }

    if (warranty.invoice?.status === 'removed') {
      return res.status(404).json({
        success: false,
        message: 'The invoice for this warranty was marked as removed.'
      });
    }

    const invoiceRef = warranty.invoice?.storageUrl || warranty.invoiceFile;

    if (!invoiceRef) {
      return res.status(404).json({
        success: false,
        message: 'No invoice document attached to this warranty'
      });
    }

    if (invoiceRef.startsWith('cloud://') || !invoiceRef.startsWith('/uploads/')) {
      const signedUrl = await getSignedFileUrl(invoiceRef, 900);
      return res.redirect(signedUrl);
    }

    const filename = path.basename(invoiceRef);
    const fullPath = path.join(uploadsDir, filename);

    if (!fs.existsSync(fullPath)) {
      return res.status(404).json({
        success: false,
        message: 'Invoice file not found on disk'
      });
    }

    res.sendFile(fullPath);
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get authorized temporary URL for invoice viewing/download
 * @route   GET /api/warranties/:id/invoice-url
 * @access  Private
 */
export const getInvoiceUrl = async (req, res, next) => {
  try {
    const warranty = await Warranty.findOne(
      activeWarrantyQuery(req.params.id, req.user._id)
    );

    if (!warranty) {
      return res.status(404).json({
        success: false,
        message: 'Warranty not found'
      });
    }

    if (warranty.invoice?.status === 'removed') {
      return res.status(404).json({
        success: false,
        message: 'The invoice for this warranty was marked as removed.'
      });
    }

    const invoiceRef = warranty.invoice?.storageUrl || warranty.invoiceFile;

    if (!invoiceRef) {
      return res.status(404).json({
        success: false,
        message: 'No invoice document attached to this warranty'
      });
    }

    if (invoiceRef.startsWith('cloud://') || !invoiceRef.startsWith('/uploads/')) {
      const signedUrl = await getSignedFileUrl(invoiceRef, 900);
      return res.status(200).json({
        success: true,
        url: signedUrl,
        isCloud: true
      });
    }

    return res.status(200).json({
      success: true,
      url: `/api/warranties/${warranty._id}/invoice`,
      isCloud: false
    });
  } catch (error) {
    next(error);
  }
};
