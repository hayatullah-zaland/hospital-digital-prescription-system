import Doctor from '../models/Doctor.js';
import Patient from '../models/Patient.js';
import Appointment from '../models/Appointment.js';

// تر CareAssignment پورې د روانې معاینې اړیکه د حساسیتونو اجازه ټاکي.
export const requireAllergyVisit = async (req, res, next) => {
  try {
    const doctor = await Doctor.exists({ user: req.user._id, isActive: true });
    if (!doctor) {
      return res.status(403).json({ message: 'An active doctor profile is required' });
    }
    const patient = await Patient.exists({ _id: req.params.patientId });
    if (!patient) {
      return res.status(404).json({ message: 'Patient record not found' });
    }
    const appointment = await Appointment.findOne({
      patient: req.params.patientId,
      doctor: req.user._id,
      status: 'in_progress',
      startAt: { $lte: new Date() },
    }).sort({ startAt: -1, _id: -1 }).select('_id');
    if (!appointment) {
      return res.status(403).json({ message: 'Your own in-progress appointment with this patient is required' });
    }
    req.allergyAppointment = appointment._id;
    next();
  } catch (error) {
    res.status(500).json({ message: 'Unable to check allergy access. Please try again' });
  }
};
