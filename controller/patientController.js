import validator from 'validator';
import Patient from '../models/Patient.js';

export const createPatient = async (req, res) => {
  try {
    const { name, dateOfBirth, phone, gender = 'unspecified', address = '' } = req.body || {};

    if (typeof name !== 'string' || !validator.isLength(name.trim(), { min: 2, max: 100 })) {
      return res.status(400).json({ message: 'Name must have between 2 and 100 characters' });
    }
    if (typeof dateOfBirth !== 'string' || !validator.isDate(dateOfBirth, { format: 'YYYY-MM-DD', strictMode: true })) {
      return res.status(400).json({ message: 'Please enter a valid date of birth in YYYY-MM-DD format' });
    }

    if (validator.isAfter(dateOfBirth)) {
      return res.status(400).json({ message: 'Date of birth cannot be in the future' });
    }
    if (typeof phone !== 'string' || !validator.isLength(phone.trim(), { max: 25 }) || !validator.matches(phone.trim().replace(/[ ()-]/g, ''), /^\+?\d{7,15}$/)) {
      return res.status(400).json({ message: 'Phone must contain 7 to 15 digits, with an optional country code' });
    }
    if (typeof gender !== 'string' || !validator.isIn(gender, Patient.schema.path('gender').enumValues)) {
      return res.status(400).json({ message: 'Gender must be male, female, other or unspecified' });
    }
    if (typeof address !== 'string' || !validator.isLength(address.trim(), { max: 300 })) {
      return res.status(400).json({ message: 'Address must be text with at most 300 characters' });
    }

    // Pick the accepted fields explicitly; the client cannot choose createdBy.
    const patient = await Patient.create({
      name: name.trim(),
      dateOfBirth: new Date(dateOfBirth),
      gender,
      phone: phone.trim(),
      address: address.trim(),
      createdBy: req.user._id,
    });

    res.status(201).json({ message: 'Patient registered successfully', patient });
  } catch (error) {
    if (error.name === 'ValidationError') {
      return res.status(400).json({ message: 'Please check the patient details' });
    }
    res.status(500).json({ message: 'Unable to register the patient. Please try again' });
  }
};

export const getPatients = async (req, res) => {
  try {
    const { search = '', page = '1', limit = '10' } = req.query;
    if (typeof search !== 'string' || !validator.isLength(search.trim(), { max: 100 })) {
      return res.status(400).json({ message: 'Search must be text with at most 100 characters' });
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
    if (search.trim()) {
      // Treat search as plain text, so characters such as + and ( are safe to use.
      const searchText = search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filter.$or = [
        { name: { $regex: searchText, $options: 'i' } },
        { phone: { $regex: searchText, $options: 'i' } },
      ];
    }

    const [patients, total] = await Promise.all([
      Patient.find(filter).sort({ createdAt: -1, _id: -1 }).skip(skip).limit(pageSize),
      Patient.countDocuments(filter),
    ]);

    res.json({
      patients,
      pagination: { page: pageNumber, limit: pageSize, total, totalPages: Math.ceil(total / pageSize) },
    });
  } catch (error) {
    res.status(500).json({ message: 'Unable to load patients. Please try again' });
  }
};

export const getPatientById = async (req, res) => {
  try {
    if (!validator.isMongoId(req.params.id)) {
      return res.status(400).json({ message: 'Please enter a valid patient ID' });
    }

    const patient = await Patient.findById(req.params.id);
    if (!patient) {
      return res.status(404).json({ message: 'Patient not found' });
    }

    res.json({ patient });
  } catch (error) {
    res.status(500).json({ message: 'Unable to load the patient. Please try again' });
  }
};
