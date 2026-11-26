import express from 'express';
import { allowRoles } from '../middleware/authMiddleware.js';
import { requireAllergyVisit } from '../middleware/patientAllergyAccess.js';
import { validateAllergyPatientId, validateAllergyCheckInput } from '../middleware/patientAllergyValidation.js';
import { checkPatientInteractions } from '../controller/interactionController.js';

// د حساسیتونو موجوده د روان ملاقات اجازه او medicineIds validation بیا کاروو.
const router = express.Router({ mergeParams: true });
router.use(allowRoles('doctor'), validateAllergyPatientId, requireAllergyVisit);
router.post('/check', validateAllergyCheckInput, checkPatientInteractions);
export default router;
