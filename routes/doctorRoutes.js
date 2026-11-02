import express from 'express';
import {
  createDoctor,
  getDoctors,
  getDoctorByUserId,
  updateDoctor,
} from '../controller/doctorController.js';
import { protect, allowRoles } from '../middleware/authMiddleware.js';
import { validateDoctorInput, validateAvailabilityInput } from '../middleware/doctorValidation.js';

const router = express.Router();

router.use((req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});
router.use(protect);

// لومړی اجازه، بیا validation، او په پای کې controller چلېږي.
router.post('/', allowRoles('hospital_admin'), validateDoctorInput, createDoctor);
router.get('/', allowRoles('hospital_admin', 'receptionist', 'doctor'), getDoctors);
router.get('/:doctorUserId', allowRoles('hospital_admin', 'receptionist', 'doctor'), getDoctorByUserId);
router.patch('/:doctorUserId', allowRoles('hospital_admin', 'doctor'), validateDoctorInput, updateDoctor);
router.patch(
  '/:doctorUserId/availability',
  allowRoles('hospital_admin', 'doctor'),
  validateAvailabilityInput,
  validateDoctorInput,
  updateDoctor,
);

export default router;
