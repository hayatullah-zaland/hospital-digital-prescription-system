import validator from 'validator';
import Appointment from '../models/Appointment.js';
import Doctor from '../models/Doctor.js';
import { isAppointmentDate } from '../middleware/appointmentValidation.js';
import { getDayBounds, getWorkingSlots, slotMinutes } from './appointmentTime.js';

// تش وختونه ښیو؛ د نورو ناروغانو نومونه یا معلومات نه ورسره لېږو.
export const getDoctorSlots = async (req, res) => {
  try {
    const { doctorUserId } = req.params;
    const { date } = req.query;
    if (!validator.isMongoId(doctorUserId)) {
      return res.status(400).json({ message: 'Please enter a valid doctor user ID' });
    }
    if (Object.keys(req.query).length !== 1 || !isAppointmentDate(date)) {
      return res.status(400).json({ message: 'Please send only a valid date in YYYY-MM-DD format' });
    }
    const { start, end } = getDayBounds(date);
    if (end <= new Date()) {
      return res.status(400).json({ message: 'Please choose today or a future date' });
    }
    const doctor = await Doctor.findOne({ user: doctorUserId, isActive: true }).populate('user', 'role');
    if (!doctor || !doctor.user || doctor.user.role !== 'doctor') {
      return res.status(404).json({ message: 'Active doctor profile not found' });
    }
    const booked = await Appointment.find({
      doctor: doctorUserId, startAt: { $gte: start, $lt: end }, isBooked: true,
    }).select('startAt');

    const slots = [];
    const workingSlots = getWorkingSlots(doctor, date);
    const now = new Date();
    for (const slot of workingSlots) {
      if (slot.startAt <= now) {
        continue;
      }
      let isTaken = false;
      for (const appointment of booked) {
        if (appointment.startAt.getTime() === slot.startAt.getTime()) {
          isTaken = true;
          break;
        }
      }
      if (!isTaken) {
        slots.push(slot);
      }
    }
    res.json({ doctorUserId, date, timeZone: 'Asia/Kabul', slotMinutes, slots });
  } catch (error) {
    res.status(500).json({ message: 'Unable to load available times. Please try again' });
  }
};

// وخت او تاریخچه په یوه save کې بدلوو؛ د DB unique index د ټکر مخه نیسي.
export const rescheduleAppointment = async (req, res) => {
  try {
    if (!validator.isMongoId(req.params.id)) {
      return res.status(400).json({ message: 'Please enter a valid appointment ID' });
    }
    const appointment = await Appointment.findById(req.params.id);
    if (!appointment) {
      return res.status(404).json({ message: 'Appointment not found' });
    }
    if (appointment.status !== 'scheduled') {
      return res.status(409).json({ message: 'Only scheduled appointments can be rescheduled' });
    }
    const doctor = await Doctor.findOne({ user: appointment.doctor, isActive: true }).populate('user', 'role');
    if (!doctor || !doctor.user || doctor.user.role !== 'doctor') {
      return res.status(404).json({ message: 'Active doctor profile not found' });
    }
    const { date, startTime, reason } = req.body;
    let selectedSlot;
    for (const slot of getWorkingSlots(doctor, date)) {
      if (slot.startTime === startTime) {
        selectedSlot = slot;
        break;
      }
    }
    if (!selectedSlot || selectedSlot.startAt <= new Date()) {
      return res.status(400).json({ message: 'Please choose a future time within the doctor availability' });
    }
    if (selectedSlot.startAt.getTime() === appointment.startAt.getTime()) {
      return res.status(400).json({ message: 'Please choose a different appointment time' });
    }

    appointment.startAt = selectedSlot.startAt;
    appointment.endAt = selectedSlot.endAt;
    appointment.history.push({
      action: 'rescheduled', status: appointment.status,
      startAt: appointment.startAt, endAt: appointment.endAt,
      actor: req.user._id, reason: reason.trim(),
    });
    await appointment.save();
    await appointment.populate('patient', 'name phone');
    await appointment.populate('doctor', 'name');
    res.json({ message: 'Appointment rescheduled successfully', appointment });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({ message: 'The doctor or patient already has an appointment at this time' });
    }
    if (error.name === 'VersionError') {
      return res.status(409).json({ message: 'The appointment changed. Load it again before editing' });
    }
    if (error.name === 'ValidationError') {
      return res.status(400).json({ message: 'Please check the appointment details' });
    }
    res.status(500).json({ message: 'Unable to reschedule the appointment. Please try again' });
  }
};
