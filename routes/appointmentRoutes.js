import express from 'express';
import { protect, allowRoles } from '../middleware/authMiddleware.js';
import {
  validateAppointmentInput,
  validateStatusInput,
  validateRescheduleInput,
} from '../middleware/appointmentValidation.js';
import {
  createAppointment,
  getAppointments,
  getAppointmentById,
  updateAppointmentStatus,
} from '../controller/appointmentController.js';
import { rescheduleAppointment } from '../controller/appointmentScheduleController.js';

const router = express.Router();

router.use((req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});
router.use(protect);

router.post('/', allowRoles('hospital_admin', 'receptionist'), validateAppointmentInput, createAppointment);
router.get('/', allowRoles('hospital_admin', 'receptionist', 'doctor'), getAppointments);
router.get('/:id', allowRoles('hospital_admin', 'receptionist', 'doctor'), getAppointmentById);
router.patch('/:id/status', allowRoles('hospital_admin', 'receptionist', 'doctor'), validateStatusInput, updateAppointmentStatus);
router.post('/:id/reschedule', allowRoles('hospital_admin', 'receptionist'), validateRescheduleInput, rescheduleAppointment);

export default router;
