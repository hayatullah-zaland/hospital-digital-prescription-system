import express from 'express';
import { createPatient, getPatients, getPatientById, updatePatient } from '../controller/patientController.js';
import { protect, allowRoles } from '../middleware/authMiddleware.js';

const router = express.Router();

router.use((req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});
router.use(protect);

router.post('/', allowRoles('hospital_admin', 'receptionist'), createPatient);
router.get('/', allowRoles('hospital_admin', 'receptionist', 'doctor'), getPatients);
router.get('/:id', allowRoles('hospital_admin', 'receptionist', 'doctor'), getPatientById);
router.patch('/:id', allowRoles('hospital_admin', 'receptionist'), updatePatient);

export default router;
