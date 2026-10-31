import validator from 'validator';
import Patient from '../models/Patient.js';
import Prescription from '../models/Prescription.js';

export const createPrescription = async (req, res) => {
  try {
    const { patientId, diagnosis, medicines, notes = '' } = req.body || {};

    if (typeof patientId !== 'string' || !validator.isMongoId(patientId)) {
      return res.status(400).json({ message: 'Please enter a valid patient ID' });
    }
    if (typeof diagnosis !== 'string' || !validator.isLength(diagnosis.trim(), { min: 2, max: 500 })) {
      return res.status(400).json({ message: 'Diagnosis must have between 2 and 500 characters' });
    }
    if (!Array.isArray(medicines) || medicines.length < 1 || medicines.length > 20) {
      return res.status(400).json({ message: 'Please include between 1 and 20 medicines' });
    }
    if (typeof notes !== 'string' || !validator.isLength(notes.trim(), { max: 1000 })) {
      return res.status(400).json({ message: 'Notes must be text with at most 1000 characters' });
    }

    for (const medicine of medicines) {
      if (!medicine || typeof medicine !== 'object' || Array.isArray(medicine)) {
        return res.status(400).json({ message: 'Each medicine must be a JSON object' });
      }

      const { name, dosage, frequency, duration, instructions = '' } = medicine;
      if (typeof name !== 'string' || !validator.isLength(name.trim(), { min: 2, max: 100 })) {
        return res.status(400).json({ message: 'Each medicine name must have between 2 and 100 characters' });
      }
      if (typeof dosage !== 'string' || !validator.isLength(dosage.trim(), { min: 1, max: 100 })) {
        return res.status(400).json({ message: 'Each medicine dosage must have between 1 and 100 characters' });
      }
      if (typeof frequency !== 'string' || !validator.isLength(frequency.trim(), { min: 1, max: 100 })) {
        return res.status(400).json({ message: 'Each medicine frequency must have between 1 and 100 characters' });
      }
      if (typeof duration !== 'string' || !validator.isLength(duration.trim(), { min: 1, max: 100 })) {
        return res.status(400).json({ message: 'Each medicine duration must have between 1 and 100 characters' });
      }
      if (typeof instructions !== 'string' || !validator.isLength(instructions.trim(), { max: 300 })) {
        return res.status(400).json({ message: 'Medicine instructions must be text with at most 300 characters' });
      }
    }

    if (!(await Patient.exists({ _id: patientId }))) {
      return res.status(404).json({ message: 'Patient not found' });
    }

    // Use the signed-in doctor's ID, never a doctor ID supplied by the client.
    const prescription = await Prescription.create({
      patient: patientId,
      doctor: req.user._id,
      diagnosis: diagnosis.trim(),
      medicines: medicines.map(({ name, dosage, frequency, duration, instructions = '' }) => ({
        name: name.trim(),
        dosage: dosage.trim(),
        frequency: frequency.trim(),
        duration: duration.trim(),
        instructions: instructions.trim(),
      })),
      notes: notes.trim(),
    });

    res.status(201).json({ message: 'Prescription created successfully', prescription });
  } catch (error) {
    if (error.name === 'ValidationError') {
      return res.status(400).json({ message: 'Please check the prescription details' });
    }
    res.status(500).json({ message: 'Unable to create the prescription. Please try again' });
  }
};

export const getPrescriptions = async (req, res) => {
  try {
    const { patientId, page = '1', limit = '10' } = req.query;
    if (patientId !== undefined && (typeof patientId !== 'string' || !validator.isMongoId(patientId))) {
      return res.status(400).json({ message: 'Please enter a valid patient ID' });
    }
    if (typeof page !== 'string' || !validator.isInt(page, { min: 1, max: Number.MAX_SAFE_INTEGER, allow_leading_zeroes: false })) {
      return res.status(400).json({ message: 'Page must be a positive whole number within the safe integer range' });
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

    const filter = {};
    if (req.user.role === 'doctor') {
      filter.doctor = req.user._id;
    }
    if (patientId !== undefined) {
      filter.patient = patientId;
    }

    const [prescriptions, total] = await Promise.all([
      Prescription.find(filter)
        .populate('patient', 'name dateOfBirth gender')
        .populate('doctor', 'name')
        .sort({ createdAt: -1, _id: -1 })
        .skip(skip)
        .limit(pageSize),
      Prescription.countDocuments(filter),
    ]);

    res.json({
      prescriptions,
      pagination: { page: pageNumber, limit: pageSize, total, totalPages: Math.ceil(total / pageSize) },
    });
  } catch (error) {
    res.status(500).json({ message: 'Unable to load prescriptions. Please try again' });
  }
};

export const getPrescriptionById = async (req, res) => {
  try {
    if (!validator.isMongoId(req.params.id)) {
      return res.status(400).json({ message: 'Please enter a valid prescription ID' });
    }

    const filter = { _id: req.params.id };
    if (req.user.role === 'doctor') {
      filter.doctor = req.user._id;
    }

    const prescription = await Prescription.findOne(filter)
      .populate('patient', 'name dateOfBirth gender')
      .populate('doctor', 'name');
    if (!prescription) {
      return res.status(404).json({ message: 'Prescription not found' });
    }

    res.json({ prescription });
  } catch (error) {
    res.status(500).json({ message: 'Unable to load the prescription. Please try again' });
  }
};
