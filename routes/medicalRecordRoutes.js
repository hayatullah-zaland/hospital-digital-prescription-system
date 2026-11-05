import express from 'express';
import { protect, allowRoles } from '../middleware/authMiddleware.js';
import { requireActiveMedicalDoctor } from '../middleware/medicalRecordAccess.js';
import {
  validateMedicalRecordId,
  validateMedicalRecordInput,
  validateCorrectionInput,
  validateFinalizeInput,
} from '../middleware/medicalRecordValidation.js';
import {
  createMedicalRecord,
  getMedicalRecords,
  getMedicalRecordById,
  updateMedicalRecord,
  finalizeMedicalRecord,
  createMedicalRecordCorrection,
} from '../controller/medicalRecordController.js';

const router = express.Router();

router.use((req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});
router.use(protect);
// په دې لومړۍ برخه کې هر ډاکټر یوازې خپل ریکارډونه اداره کوي.
router.use(allowRoles('doctor'));

router.post('/', requireActiveMedicalDoctor, validateMedicalRecordInput, createMedicalRecord);
router.get('/', getMedicalRecords);
router.get('/:id', validateMedicalRecordId, getMedicalRecordById);
router.patch('/:id', validateMedicalRecordId, requireActiveMedicalDoctor, validateMedicalRecordInput, updateMedicalRecord);
router.post('/:id/finalize', validateMedicalRecordId, requireActiveMedicalDoctor, validateFinalizeInput, finalizeMedicalRecord);
router.post('/:id/corrections', validateMedicalRecordId, requireActiveMedicalDoctor, validateCorrectionInput, createMedicalRecordCorrection);

export default router;
