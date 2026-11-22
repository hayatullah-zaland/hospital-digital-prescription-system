import validator from 'validator';
import PatientAllergy, { allergyKinds, allergyVerificationStatuses } from '../models/PatientAllergy.js';

// ثبت او سمون دواړه د خپل وخت بشپړه کاپي په تاریخچه کې زیاتوي.
function appendAllergyHistory(allergy, action, req, reason) {
  allergy.history.push({
    action: action,
    actor: req.user._id,
    appointment: req.allergyAppointment,
    reason: reason,
    at: new Date(),
    snapshot: {
      substance: allergy.substance,
      kind: allergy.kind,
      reaction: allergy.reaction,
      source: allergy.source,
      verificationStatus: allergy.verificationStatus,
      notes: allergy.notes,
      reviewedBy: allergy.reviewedBy,
      reviewedAt: allergy.reviewedAt,
    },
  });
}

export const createPatientAllergy = async (req, res) => {
  try {
    const { substance, kind, reaction, source, notes = '' } = req.body;
    const normalizedSubstance = substance.trim().replace(/\s+/g, ' ');
    await PatientAllergy.init();
    const allergy = new PatientAllergy({
      patient: req.params.patientId,
      substance: normalizedSubstance,
      substanceKey: normalizedSubstance.toLowerCase(),
      kind: kind,
      reaction: reaction.trim(),
      source: source,
      notes: notes.trim(),
      verificationStatus: 'unconfirmed',
      recordedBy: req.user._id,
      updatedBy: req.user._id,
    });
    appendAllergyHistory(allergy, 'created', req, 'Initial allergy report');
    // معلومات او تاریخچه په یوه سند او یوه save کې ثبتېږي.
    await allergy.save();
    const allergyData = allergy.toObject();
    delete allergyData.substanceKey;
    res.status(201).json({ message: 'Patient allergy recorded successfully', allergy: allergyData });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({ message: 'This substance and kind already have a record for this patient; update the existing record' });
    }
    if (error.name === 'ValidationError') {
      return res.status(400).json({ message: 'Please check the allergy details' });
    }
    res.status(500).json({ message: 'Unable to record the allergy. Please try again' });
  }
};

export const getPatientAllergies = async (req, res) => {
  try {
    const { kind, verificationStatus, page = '1', limit = '10' } = req.query;
    const allowedFields = ['kind', 'verificationStatus', 'page', 'limit'];
    for (const field of Object.keys(req.query)) {
      if (!allowedFields.includes(field)) {
        return res.status(400).json({ message: 'Please send only accepted allergy filters' });
      }
    }
    if (kind !== undefined && (typeof kind !== 'string' || !validator.isIn(kind, allergyKinds))) {
      return res.status(400).json({ message: 'Kind must be allergy or sensitivity' });
    }
    if (verificationStatus !== undefined && (typeof verificationStatus !== 'string' || !validator.isIn(verificationStatus, allergyVerificationStatuses))) {
      return res.status(400).json({ message: 'Please enter a valid verification status' });
    }
    if (typeof page !== 'string' || !validator.isInt(page, { min: 1, max: Number.MAX_SAFE_INTEGER, allow_leading_zeroes: false })) {
      return res.status(400).json({ message: 'Page must be a positive whole number' });
    }
    if (typeof limit !== 'string' || !validator.isInt(limit, { min: 1, max: 50, allow_leading_zeroes: false })) {
      return res.status(400).json({ message: 'Limit must be between 1 and 50' });
    }
    const pageNumber = Number(page);
    const pageSize = Number(limit);
    const skip = (pageNumber - 1) * pageSize;
    if (!Number.isSafeInteger(skip)) {
      return res.status(400).json({ message: 'Page is too large' });
    }
    // patient د URL او اجازې له چک څخه راځي؛ query یې نه شي بدلولای.
    const filter = { patient: req.params.patientId };
    if (kind) {
      filter.kind = kind;
    }
    if (verificationStatus) {
      filter.verificationStatus = verificationStatus;
    }
    const allergies = await PatientAllergy.find(filter)
      .select('-history')
      .sort({ createdAt: -1, _id: -1 })
      .skip(skip)
      .limit(pageSize);
    const total = await PatientAllergy.countDocuments(filter);
    res.json({
      allergies,
      pagination: { page: pageNumber, limit: pageSize, total, totalPages: Math.ceil(total / pageSize) },
    });
  } catch (error) {
    res.status(500).json({ message: 'Unable to load patient allergies. Please try again' });
  }
};

export const getPatientAllergyById = async (req, res) => {
  try {
    const allergy = await PatientAllergy.findOne({ _id: req.params.allergyId, patient: req.params.patientId });
    if (!allergy) {
      return res.status(404).json({ message: 'Patient allergy not found' });
    }
    res.json({ allergy });
  } catch (error) {
    res.status(500).json({ message: 'Unable to load the allergy. Please try again' });
  }
};

export const updatePatientAllergy = async (req, res) => {
  try {
    const allergy = await PatientAllergy.findOne({ _id: req.params.allergyId, patient: req.params.patientId });
    if (!allergy) {
      return res.status(404).json({ message: 'Patient allergy not found' });
    }
    if (req.body.version !== allergy.version) {
      return res.status(409).json({ message: 'The allergy changed. Load it again and use its current version' });
    }
    const { substance, kind, reaction, source, verificationStatus, notes, reason } = req.body;
    if (substance !== undefined) {
      allergy.substance = substance.trim().replace(/\s+/g, ' ');
      if (allergy.isModified('substance')) {
        allergy.substanceKey = allergy.substance.toLowerCase();
      }
    }
    if (kind !== undefined) {
      allergy.kind = kind;
    }
    if (reaction !== undefined) {
      allergy.reaction = reaction.trim();
    }
    if (source !== undefined) {
      allergy.source = source;
    }
    if (notes !== undefined) {
      allergy.notes = notes.trim();
    }
    if (verificationStatus !== undefined) {
      allergy.verificationStatus = verificationStatus;
    } else if (allergy.isModified('substance') || allergy.isModified('kind') || allergy.isModified('reaction') || allergy.isModified('source')) {
      // بدل شوي clinical معلومات بیا د ډاکټر جلا ارزونه غواړي.
      allergy.verificationStatus = 'unconfirmed';
    }
    if (!allergy.isModified()) {
      return res.status(400).json({ message: 'Please change at least one allergy field' });
    }
    if (verificationStatus !== undefined || allergy.isModified('verificationStatus')) {
      if (allergy.verificationStatus === 'unconfirmed') {
        allergy.reviewedBy = null;
        allergy.reviewedAt = null;
      } else {
        allergy.reviewedBy = req.user._id;
        allergy.reviewedAt = new Date();
      }
    }
    allergy.updatedBy = req.user._id;
    appendAllergyHistory(allergy, 'updated', req, reason.trim());
    await allergy.save();
    const allergyData = allergy.toObject();
    delete allergyData.substanceKey;
    res.json({ message: 'Patient allergy updated successfully', allergy: allergyData });
  } catch (error) {
    if (error.name === 'VersionError') {
      return res.status(409).json({ message: 'The allergy changed. Load it again before editing' });
    }
    if (error.code === 11000) {
      return res.status(409).json({ message: 'This substance and kind already have a record for this patient' });
    }
    if (error.name === 'ValidationError') {
      return res.status(400).json({ message: 'Please check the allergy details' });
    }
    res.status(500).json({ message: 'Unable to update the allergy. Please try again' });
  }
};
