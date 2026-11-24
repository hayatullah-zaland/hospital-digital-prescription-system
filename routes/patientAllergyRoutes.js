import express from 'express';
import { allowRoles } from '../middleware/authMiddleware.js';
import { requireAllergyVisit } from '../middleware/patientAllergyAccess.js';
import { validateAllergyPatientId, validateAllergyId, validateAllergyInput, validateAllergyCheckInput } from '../middleware/patientAllergyValidation.js';
import { checkPatientAllergies } from '../controller/allergyCheckController.js';
import {
  createPatientAllergy,
  getPatientAllergies,
  getPatientAllergyById,
  updatePatientAllergy,
} from '../controller/patientAllergyController.js';

// patientId له اصلي patient router څخه اخلو؛ protect هلته چلېږي.
const router = express.Router({ mergeParams: true });
router.use(allowRoles('doctor'));
router.use(validateAllergyPatientId);
router.use(requireAllergyVisit);

router.post('/', validateAllergyInput, createPatientAllergy);
router.post('/check', validateAllergyCheckInput, checkPatientAllergies);
router.get('/', getPatientAllergies);
router.get('/:allergyId', validateAllergyId, getPatientAllergyById);
router.patch('/:allergyId', validateAllergyId, validateAllergyInput, updatePatientAllergy);

export default router;
