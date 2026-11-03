import validator from 'validator';
import Appointment, { appointmentStatuses } from '../models/Appointment.js';
import Doctor from '../models/Doctor.js';
import Patient from '../models/Patient.js';
import { isAppointmentDate } from '../middleware/appointmentValidation.js';
import { getDayBounds, getWorkingSlots } from './appointmentTime.js';

// ناروغ او فعال ډاکټر پیدا کوو، کاري وخت ګورو، بیا ملاقات ثبتوو.
export const createAppointment = async (req, res) => {
  try {
    const { patientId, doctorUserId, date, startTime } = req.body;
    const patient = await Patient.findById(patientId).select('_id');
    if (!patient) {
      return res.status(404).json({ message: 'Patient record not found' });
    }
    const doctor = await Doctor.findOne({ user: doctorUserId, isActive: true }).populate('user', 'role');
    if (!doctor || !doctor.user || doctor.user.role !== 'doctor') {
      return res.status(404).json({ message: 'Active doctor profile not found' });
    }

    const workingSlots = getWorkingSlots(doctor, date);
    let selectedSlot;
    for (const slot of workingSlots) {
      if (slot.startTime === startTime) {
        selectedSlot = slot;
        break;
      }
    }
    if (!selectedSlot || selectedSlot.startAt <= new Date()) {
      return res.status(400).json({ message: 'Please choose a future time within the doctor availability' });
    }

    await Appointment.init();
    const appointment = await Appointment.create({
      patient: patientId,
      doctor: doctorUserId,
      startAt: selectedSlot.startAt,
      endAt: selectedSlot.endAt,
      createdBy: req.user._id,
      history: [{
        action: 'created',
        status: 'scheduled',
        startAt: selectedSlot.startAt,
        endAt: selectedSlot.endAt,
        actor: req.user._id,
      }],
    });
    await appointment.populate('patient', 'name phone');
    await appointment.populate('doctor', 'name');
    res.status(201).json({ message: 'Appointment created successfully', appointment });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({ message: 'The doctor or patient already has an appointment at this time' });
    }
    if (error.name === 'ValidationError') {
      return res.status(400).json({ message: 'Please check the appointment details' });
    }
    res.status(500).json({ message: 'Unable to create the appointment. Please try again' });
  }
};

// اډمین او receptionist لېست ګوري؛ ډاکټر یوازې خپل ملاقاتونه ګوري.
export const getAppointments = async (req, res) => {
  try {
    const { page = '1', limit = '10', doctorUserId, patientId, date, status } = req.query;
    const allowedFields = ['page', 'limit', 'doctorUserId', 'patientId', 'date', 'status'];
    for (const field of Object.keys(req.query)) {
      if (!allowedFields.includes(field)) {
        return res.status(400).json({ message: 'Please send only accepted appointment filters' });
      }
    }
    if (typeof page !== 'string' || !validator.isInt(page, { min: 1, max: Number.MAX_SAFE_INTEGER, allow_leading_zeroes: false })) {
      return res.status(400).json({ message: 'Page must be a positive whole number' });
    }
    if (typeof limit !== 'string' || !validator.isInt(limit, { min: 1, max: 50, allow_leading_zeroes: false })) {
      return res.status(400).json({ message: 'Limit must be a whole number between 1 and 50' });
    }
    if (doctorUserId !== undefined && (typeof doctorUserId !== 'string' || !validator.isMongoId(doctorUserId))) {
      return res.status(400).json({ message: 'Please enter a valid doctor user ID' });
    }
    if (patientId !== undefined && (typeof patientId !== 'string' || !validator.isMongoId(patientId))) {
      return res.status(400).json({ message: 'Please enter a valid patient ID' });
    }
    if (date !== undefined && !isAppointmentDate(date)) {
      return res.status(400).json({ message: 'Please enter a valid date in YYYY-MM-DD format' });
    }
    if (status !== undefined && (typeof status !== 'string' || !validator.isIn(status, appointmentStatuses))) {
      return res.status(400).json({ message: 'Please select a valid appointment status' });
    }
    const pageNumber = Number(page);
    const pageSize = Number(limit);
    const skip = (pageNumber - 1) * pageSize;
    if (!Number.isSafeInteger(skip)) {
      return res.status(400).json({ message: 'Page is too large' });
    }

    const filter = {};
    if (req.user.role === 'doctor') {
      if (doctorUserId && doctorUserId.toLowerCase() !== req.user.id) {
        return res.status(403).json({ message: 'Doctors can view only their own appointments' });
      }
      filter.doctor = req.user._id;
    } else if (doctorUserId) {
      filter.doctor = doctorUserId;
    }
    if (patientId) {
      filter.patient = patientId;
    }
    if (status) {
      filter.status = status;
    }
    if (date) {
      const { start, end } = getDayBounds(date);
      filter.startAt = { $gte: start, $lt: end };
    }

    const appointments = await Appointment.find(filter)
      .select('patient doctor startAt endAt status createdAt updatedAt')
      .populate('patient', 'name phone')
      .populate('doctor', 'name')
      .sort({ startAt: 1, _id: 1 })
      .skip(skip)
      .limit(pageSize);
    const total = await Appointment.countDocuments(filter);
    res.json({
      appointments,
      pagination: { page: pageNumber, limit: pageSize, total, totalPages: Math.ceil(total / pageSize) },
    });
  } catch (error) {
    res.status(500).json({ message: 'Unable to load appointments. Please try again' });
  }
};

export const getAppointmentById = async (req, res) => {
  try {
    if (!validator.isMongoId(req.params.id)) {
      return res.status(400).json({ message: 'Please enter a valid appointment ID' });
    }
    const filter = { _id: req.params.id };
    if (req.user.role === 'doctor') {
      filter.doctor = req.user._id;
    }
    const appointment = await Appointment.findOne(filter)
      .populate('patient', 'name phone')
      .populate('doctor', 'name');
    if (!appointment) {
      return res.status(404).json({ message: 'Appointment not found' });
    }
    res.json({ appointment });
  } catch (error) {
    res.status(500).json({ message: 'Unable to load the appointment. Please try again' });
  }
};

// حالت په ترتیب بدلېږي: scheduled → checked_in → in_progress → completed.
export const updateAppointmentStatus = async (req, res) => {
  try {
    if (!validator.isMongoId(req.params.id)) {
      return res.status(400).json({ message: 'Please enter a valid appointment ID' });
    }
    const { status, reason = '' } = req.body;
    const filter = { _id: req.params.id };
    if (req.user.role === 'doctor') {
      filter.doctor = req.user._id;
    }
    const appointment = await Appointment.findOne(filter);
    if (!appointment) {
      return res.status(404).json({ message: 'Appointment not found' });
    }

    let allowed = false;
    if (req.user.role === 'doctor') {
      if (status !== 'in_progress' && status !== 'completed') {
        return res.status(403).json({ message: 'Doctors can only start or complete their own visits' });
      }
      const activeDoctor = await Doctor.exists({ user: req.user._id, isActive: true });
      if (!activeDoctor) {
        return res.status(403).json({ message: 'An active doctor profile is required' });
      }
      if (appointment.status === 'checked_in' && status === 'in_progress') {
        allowed = true;
      }
      if (appointment.status === 'in_progress' && status === 'completed') {
        allowed = true;
      }
    } else {
      if (status === 'in_progress' || status === 'completed') {
        return res.status(403).json({ message: 'Only the assigned doctor can start or complete a visit' });
      }
      if (appointment.status === 'scheduled' && ['checked_in', 'cancelled', 'no_show'].includes(status)) {
        allowed = true;
      }
      if (appointment.status === 'checked_in' && status === 'cancelled') {
        allowed = true;
      }
    }
    if (!allowed) {
      return res.status(409).json({ message: 'This status change is not allowed from the current appointment status' });
    }
    if (status === 'in_progress' && appointment.startAt > new Date()) {
      return res.status(400).json({ message: 'The visit cannot start before the appointment time' });
    }
    if (status === 'no_show' && appointment.endAt > new Date()) {
      return res.status(400).json({ message: 'Please wait until the appointment time has ended before marking no-show' });
    }

    appointment.status = status;
    if (status === 'completed' || status === 'cancelled' || status === 'no_show') {
      appointment.isBooked = false;
    }
    appointment.history.push({
      action: 'status_changed', status: status,
      startAt: appointment.startAt, endAt: appointment.endAt,
      actor: req.user._id, reason: reason.trim(),
    });
    await appointment.save();
    await appointment.populate('patient', 'name phone');
    await appointment.populate('doctor', 'name');
    res.json({ message: 'Appointment status updated successfully', appointment });
  } catch (error) {
    if (error.name === 'VersionError') {
      return res.status(409).json({ message: 'The appointment changed. Load it again before editing' });
    }
    if (error.name === 'ValidationError') {
      return res.status(400).json({ message: 'Please check the appointment details' });
    }
    res.status(500).json({ message: 'Unable to update the appointment. Please try again' });
  }
};
