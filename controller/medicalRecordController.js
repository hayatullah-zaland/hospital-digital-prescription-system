import validator from 'validator';
import MedicalRecord from '../models/MedicalRecord.js';
import Appointment from '../models/Appointment.js';
import Patient from '../models/Patient.js';

// خپل ملاقات پیدا کوو؛ د ناروغ او ډاکټر IDs سرور ټاکي.
export const createMedicalRecord = async (req, res) => {
  try {
    const { appointmentId, symptoms, diagnosis, observations = '', vitals = {} } = req.body;
    const appointment = await Appointment.findOne({ _id: appointmentId, doctor: req.user._id });
    if (!appointment) {
      return res.status(404).json({ message: 'Appointment not found' });
    }
    if (!['in_progress', 'completed'].includes(appointment.status) || appointment.startAt > new Date()) {
      return res.status(409).json({ message: 'Medical records require a started or completed visit' });
    }
    const patient = await Patient.findById(appointment.patient).select('_id');
    if (!patient) {
      return res.status(404).json({ message: 'Patient record not found' });
    }

    await MedicalRecord.init();
    const medicalRecord = await MedicalRecord.create({
      patient: appointment.patient,
      doctor: req.user._id,
      appointment: appointment._id,
      symptoms: symptoms.trim(),
      diagnosis: diagnosis.trim(),
      observations: observations.trim(),
      vitals: vitals,
    });
    await medicalRecord.populate('patient', 'name dateOfBirth gender');
    await medicalRecord.populate('doctor', 'name');
    await medicalRecord.populate('appointment', 'startAt endAt status');
    res.status(201).json({ message: 'Medical record created successfully', medicalRecord });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({ message: 'This appointment already has an original medical record' });
    }
    if (error.name === 'ValidationError') {
      return res.status(400).json({ message: 'Please check the medical record details' });
    }
    res.status(500).json({ message: 'Unable to create the medical record. Please try again' });
  }
};

// د doctor شرط تل شته؛ query یې د بل ډاکټر پر ID نه شي بدلولای.
export const getMedicalRecords = async (req, res) => {
  try {
    const { patientId, appointmentId, status, page = '1', limit = '10' } = req.query;
    const allowedFields = ['patientId', 'appointmentId', 'status', 'page', 'limit'];
    for (const field of Object.keys(req.query)) {
      if (!allowedFields.includes(field)) {
        return res.status(400).json({ message: 'Please send only accepted medical record filters' });
      }
    }
    if (patientId !== undefined && (typeof patientId !== 'string' || !validator.isMongoId(patientId))) {
      return res.status(400).json({ message: 'Please enter a valid patient ID' });
    }
    if (appointmentId !== undefined && (typeof appointmentId !== 'string' || !validator.isMongoId(appointmentId))) {
      return res.status(400).json({ message: 'Please enter a valid appointment ID' });
    }
    if (status !== undefined && (typeof status !== 'string' || !validator.isIn(status, ['draft', 'finalized']))) {
      return res.status(400).json({ message: 'Status must be draft or finalized' });
    }
    if (typeof page !== 'string' || !validator.isInt(page, { min: 1, max: Number.MAX_SAFE_INTEGER, allow_leading_zeroes: false })) {
      return res.status(400).json({ message: 'Page must be a positive whole number' });
    }
    if (typeof limit !== 'string' || !validator.isInt(limit, { min: 1, max: 50, allow_leading_zeroes: false })) {
      return res.status(400).json({ message: 'Limit must be a whole number between 1 and 50' });
    }
    const pageNumber = Number(page);
    const pageSize = Number(limit);
    const skip = (pageNumber - 1) * pageSize;
    if (!Number.isSafeInteger(skip)) {
      return res.status(400).json({ message: 'Page is too large' });
    }

    const filter = { doctor: req.user._id };
    if (patientId) {
      filter.patient = patientId;
    }
    if (appointmentId) {
      filter.appointment = appointmentId;
    }
    if (status) {
      filter.status = status;
    }
    const medicalRecords = await MedicalRecord.find(filter)
      .select('patient doctor appointment diagnosis status correctionOf finalizedAt createdAt updatedAt')
      .populate('patient', 'name dateOfBirth gender')
      .populate('doctor', 'name')
      .populate('appointment', 'startAt endAt status')
      .sort({ createdAt: -1, _id: -1 })
      .skip(skip)
      .limit(pageSize);
    const total = await MedicalRecord.countDocuments(filter);
    res.json({
      medicalRecords,
      pagination: { page: pageNumber, limit: pageSize, total, totalPages: Math.ceil(total / pageSize) },
    });
  } catch (error) {
    res.status(500).json({ message: 'Unable to load medical records. Please try again' });
  }
};

export const getMedicalRecordById = async (req, res) => {
  try {
    const medicalRecord = await MedicalRecord.findOne({ _id: req.params.id, doctor: req.user._id })
      .populate('patient', 'name dateOfBirth gender')
      .populate('doctor', 'name')
      .populate('appointment', 'startAt endAt status');
    if (!medicalRecord) {
      return res.status(404).json({ message: 'Medical record not found' });
    }
    res.json({ medicalRecord });
  } catch (error) {
    res.status(500).json({ message: 'Unable to load the medical record. Please try again' });
  }
};

// یوازې خپله draft بدلوو؛ هر لېږل شوی field جلا ټاکو.
export const updateMedicalRecord = async (req, res) => {
  try {
    const medicalRecord = await MedicalRecord.findOne({ _id: req.params.id, doctor: req.user._id });
    if (!medicalRecord) {
      return res.status(404).json({ message: 'Medical record not found' });
    }
    if (medicalRecord.status !== 'draft') {
      return res.status(409).json({ message: 'Finalized medical records require a correction' });
    }
    const { symptoms, diagnosis, observations, vitals } = req.body;
    if (symptoms !== undefined) {
      medicalRecord.symptoms = symptoms.trim();
    }
    if (diagnosis !== undefined) {
      medicalRecord.diagnosis = diagnosis.trim();
    }
    if (observations !== undefined) {
      medicalRecord.observations = observations.trim();
    }
    // د vitals ټول مطلوب معلومات ولېږئ؛ {} یې په draft کې پاکوي.
    if (vitals !== undefined) {
      medicalRecord.vitals = vitals;
    }
    await medicalRecord.save();
    await medicalRecord.populate('patient', 'name dateOfBirth gender');
    await medicalRecord.populate('doctor', 'name');
    await medicalRecord.populate('appointment', 'startAt endAt status');
    res.json({ message: 'Medical record updated successfully', medicalRecord });
  } catch (error) {
    if (error.name === 'VersionError') {
      return res.status(409).json({ message: 'The medical record changed. Load it again before editing' });
    }
    if (error.name === 'ValidationError') {
      return res.status(400).json({ message: 'Please check the medical record details' });
    }
    res.status(500).json({ message: 'Unable to update the medical record. Please try again' });
  }
};

export const finalizeMedicalRecord = async (req, res) => {
  try {
    const medicalRecord = await MedicalRecord.findOne({ _id: req.params.id, doctor: req.user._id });
    if (!medicalRecord) {
      return res.status(404).json({ message: 'Medical record not found' });
    }
    if (medicalRecord.status !== 'draft') {
      return res.status(409).json({ message: 'This medical record is already finalized' });
    }
    medicalRecord.status = 'finalized';
    medicalRecord.finalizedAt = new Date();
    medicalRecord.finalizedBy = req.user._id;
    await medicalRecord.save();
    await medicalRecord.populate('patient', 'name dateOfBirth gender');
    await medicalRecord.populate('doctor', 'name');
    await medicalRecord.populate('appointment', 'startAt endAt status');
    res.json({ message: 'Medical record finalized successfully', medicalRecord });
  } catch (error) {
    if (error.name === 'VersionError') {
      return res.status(409).json({ message: 'The medical record changed. Load it again before finalizing' });
    }
    if (error.name === 'ValidationError') {
      return res.status(400).json({ message: 'Please check the medical record details' });
    }
    res.status(500).json({ message: 'Unable to finalize the medical record. Please try again' });
  }
};

// وروستی ریکارډ په خپل ځای ساتو؛ د اصلاح لپاره نوې draft کاپي جوړوو.
export const createMedicalRecordCorrection = async (req, res) => {
  try {
    const original = await MedicalRecord.findOne({ _id: req.params.id, doctor: req.user._id });
    if (!original) {
      return res.status(404).json({ message: 'Medical record not found' });
    }
    if (original.status !== 'finalized') {
      return res.status(409).json({ message: 'Only finalized medical records can have corrections' });
    }
    await MedicalRecord.init();
    const medicalRecord = await MedicalRecord.create({
      patient: original.patient,
      doctor: req.user._id,
      appointment: original.appointment,
      symptoms: original.symptoms,
      diagnosis: original.diagnosis,
      observations: original.observations,
      vitals: {
        temperatureC: original.vitals?.temperatureC,
        weightKg: original.vitals?.weightKg,
      },
      correctionOf: original._id,
      correctionReason: req.body.reason.trim(),
    });
    await medicalRecord.populate('patient', 'name dateOfBirth gender');
    await medicalRecord.populate('doctor', 'name');
    await medicalRecord.populate('appointment', 'startAt endAt status');
    res.status(201).json({ message: 'Correction draft created successfully', medicalRecord });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({ message: 'This medical record already has a correction; use the existing correction' });
    }
    if (error.name === 'ValidationError') {
      return res.status(400).json({ message: 'Please check the medical record details' });
    }
    res.status(500).json({ message: 'Unable to create the correction. Please try again' });
  }
};
