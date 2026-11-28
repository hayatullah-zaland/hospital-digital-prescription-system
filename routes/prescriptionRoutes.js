import express from 'express';
import { createPrescription, getPrescriptions, getPrescriptionById } from '../controller/prescriptionController.js';
import { protect, allowRoles } from '../middleware/authMiddleware.js';
import { requireActiveMedicalDoctor } from '../middleware/medicalRecordAccess.js';
import { validatePrescriptionDraft, validatePrescriptionDraftId } from '../middleware/prescriptionDraftValidation.js';
import { createPrescriptionDraft, updatePrescriptionDraft } from '../controller/prescriptionDraftController.js';
import { validatePrescriptionSafety } from '../middleware/prescriptionSafetyValidation.js';
import { createPrescriptionSafetyCheck, getPrescriptionSafetyCheck } from '../controller/prescriptionSafetyController.js';

const router = express.Router();

router.use((req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});
router.use(protect);

router.post('/', allowRoles('doctor'), createPrescription);
router.post('/drafts', allowRoles('doctor'), requireActiveMedicalDoctor, validatePrescriptionDraft, createPrescriptionDraft);
router.post('/:id/check-safety', allowRoles('doctor'), requireActiveMedicalDoctor, validatePrescriptionSafety, createPrescriptionSafetyCheck);
router.get('/:id/safety-checks/latest', allowRoles('doctor'), requireActiveMedicalDoctor, validatePrescriptionSafety, getPrescriptionSafetyCheck);
router.get('/:id/safety-checks/:checkId', allowRoles('doctor'), requireActiveMedicalDoctor, validatePrescriptionSafety, getPrescriptionSafetyCheck);
router.patch('/:id', allowRoles('doctor'), requireActiveMedicalDoctor, validatePrescriptionDraftId, validatePrescriptionDraft, updatePrescriptionDraft);
router.get('/', allowRoles('hospital_admin', 'doctor'), getPrescriptions);
router.get('/:id', allowRoles('hospital_admin', 'doctor'), getPrescriptionById);

export default router;
