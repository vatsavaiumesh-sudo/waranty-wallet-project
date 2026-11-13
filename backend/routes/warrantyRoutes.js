import express from 'express';
import {
  getWarranties,
  getWarrantyStats,
  getWarrantyById,
  createWarranty,
  updateWarranty,
  deleteWarranty,
  getInvoiceFile,
  getInvoiceUrl
} from '../controllers/warrantyController.js';
import {
  extractInvoiceForReview,
  verifyInvoice,
  replaceInvoice,
  removeInvoice,
  getWarrantyAudit
} from '../controllers/warrantyEvidenceController.js';
import {
  warrantyUpload,
  validateUploadedFileSignatures
} from '../middleware/uploadMiddleware.js';
import { protect } from '../middleware/authMiddleware.js';

const router = express.Router();

// Require authentication for all warranty endpoints
router.use(protect);

router.get('/stats', getWarrantyStats);

// Invoice review happens before a warranty record exists.
router.post(
  '/invoice/extract',
  warrantyUpload,
  validateUploadedFileSignatures,
  extractInvoiceForReview
);

// Secure invoice viewing, verification, replacement, removal, and audit history.
router.get('/:id/audit', getWarrantyAudit);
router.get('/:id/invoice/verify', verifyInvoice);
router.get('/:id/invoice', getInvoiceFile);
router.get('/:id/invoice-url', getInvoiceUrl);
router.post(
  '/:id/invoice/replace',
  warrantyUpload,
  validateUploadedFileSignatures,
  replaceInvoice
);
router.delete('/:id/invoice', removeInvoice);

router.route('/')
  .get(getWarranties)
  .post(warrantyUpload, validateUploadedFileSignatures, createWarranty);

router.route('/:id')
  .get(getWarrantyById)
  .put(warrantyUpload, validateUploadedFileSignatures, updateWarranty)
  .delete(deleteWarranty);

export default router;
