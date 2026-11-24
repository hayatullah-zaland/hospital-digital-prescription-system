import validator from 'validator';
import { allergyKinds, allergySources, allergyVerificationStatuses } from '../models/PatientAllergy.js';

export const validateAllergyPatientId = (req, res, next) => {
  if (!validator.isMongoId(req.params.patientId)) {
    return res.status(400).json({ message: 'Please enter a valid patient ID' });
  }
  next();
};

export const validateAllergyId = (req, res, next) => {
  if (!validator.isMongoId(req.params.allergyId)) {
    return res.status(400).json({ message: 'Please enter a valid allergy ID' });
  }
  next();
};

// POST کې اړین معلومات، او PATCH کې یوازې لېږل شوي معلومات چک کوو.
export const validateAllergyInput = (req, res, next) => {
  const body = req.body;
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return res.status(400).json({ message: 'Please send allergy details as a JSON object' });
  }
  const isCreating = req.method === 'POST';
  const clinicalFields = ['substance', 'ingredientId', 'kind', 'reaction', 'source', 'verificationStatus', 'notes'];
  const allowedFields = ['substance', 'ingredientId', 'kind', 'reaction', 'source', 'verificationStatus', 'notes'];
  if (!isCreating) {
    allowedFields.push('reason', 'version');
  }
  let hasClinicalField = false;
  for (const field of Object.keys(body)) {
    if (!allowedFields.includes(field)) {
      return res.status(400).json({ message: 'Please send only accepted allergy fields' });
    }
    if (clinicalFields.includes(field)) {
      hasClinicalField = true;
    }
  }
  if (!hasClinicalField) {
    return res.status(400).json({ message: 'Please send at least one allergy field' });
  }
  if (isCreating || body.substance !== undefined) {
    if (typeof body.substance !== 'string' || !validator.isLength(body.substance.trim(), { min: 2, max: 150 })) {
      return res.status(400).json({ message: 'Substance must have between 2 and 150 characters' });
    }
  }
  if (isCreating || body.kind !== undefined) {
    if (typeof body.kind !== 'string' || !validator.isIn(body.kind, allergyKinds)) {
      return res.status(400).json({ message: 'Kind must be allergy or sensitivity' });
    }
  }
  if (body.ingredientId !== undefined && body.ingredientId !== null) {
    if (typeof body.ingredientId !== 'string' || !validator.isMongoId(body.ingredientId)) {
      return res.status(400).json({ message: 'Ingredient ID must be a valid ID or null' });
    }
  }
  if (isCreating || body.reaction !== undefined) {
    if (typeof body.reaction !== 'string' || !validator.isLength(body.reaction.trim(), { min: 2, max: 500 })) {
      return res.status(400).json({ message: 'Reaction must have between 2 and 500 characters' });
    }
  }
  if (isCreating || body.source !== undefined) {
    if (typeof body.source !== 'string' || !validator.isIn(body.source, allergySources)) {
      return res.status(400).json({ message: 'Source must be patient_reported, medical_record or clinician_observed' });
    }
  }
  if (body.notes !== undefined && (typeof body.notes !== 'string' || !validator.isLength(body.notes.trim(), { max: 1000 }))) {
    return res.status(400).json({ message: 'Notes must be text with at most 1000 characters' });
  }
  if (body.verificationStatus !== undefined) {
    if (typeof body.verificationStatus !== 'string' || !validator.isIn(body.verificationStatus, allergyVerificationStatuses)) {
      return res.status(400).json({ message: 'Verification status must be unconfirmed, confirmed or refuted' });
    }
    if (isCreating && body.verificationStatus !== 'unconfirmed') {
      return res.status(400).json({ message: 'New reports start unconfirmed; review them with PATCH and a reason' });
    }
  }
  if (!isCreating) {
    if (typeof body.reason !== 'string' || !validator.isLength(body.reason.trim(), { min: 3, max: 500 })) {
      return res.status(400).json({ message: 'Every allergy update needs a reason with 3 to 500 characters' });
    }
    if (typeof body.version !== 'number' || !Number.isSafeInteger(body.version) || body.version < 0) {
      return res.status(400).json({ message: 'Please send the current numeric allergy version' });
    }
  }
  next();
};
