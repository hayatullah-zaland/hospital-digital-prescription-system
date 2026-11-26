import validator from 'validator';

export function validatePrescriptionDraftId(req, res, next) {
  if (!validator.isMongoId(req.params.id)) return res.status(400).json({ message: 'Invalid prescription ID' });
  next();
}

export function validatePrescriptionDraft(req, res, next) {
  const body = req.body;
  if (Object.keys(req.query).length > 0 || !body || typeof body !== 'object' || Array.isArray(body)) {
    return res.status(400).json({ message: 'Send a JSON object without query parameters' });
  }
  const creating = req.method === 'POST';
  const allowed = ['diagnosis', 'medicines', 'notes'];
  if (creating) allowed.push('appointmentId');
  else allowed.push('revision');
  for (const field of Object.keys(body)) {
    if (!allowed.includes(field)) return res.status(400).json({ message: 'Send only accepted draft fields' });
  }
  if (creating && (typeof body.appointmentId !== 'string' || !validator.isMongoId(body.appointmentId))) {
    return res.status(400).json({ message: 'Send a valid appointment ID' });
  }
  if (!creating && (!Number.isSafeInteger(body.revision) || body.revision < 1)) {
    return res.status(400).json({ message: 'Send the current numeric draft revision' });
  }
  if (!creating && body.diagnosis === undefined && body.medicines === undefined && body.notes === undefined) {
    return res.status(400).json({ message: 'Send at least one draft field to update' });
  }
  if (creating || body.diagnosis !== undefined) {
    if (typeof body.diagnosis !== 'string' || !validator.isLength(body.diagnosis.trim(), { min: 2, max: 500 })) {
      return res.status(400).json({ message: 'Diagnosis must have 2 to 500 characters' });
    }
  }
  if (body.notes !== undefined && (typeof body.notes !== 'string' || !validator.isLength(body.notes.trim(), { max: 1000 }))) {
    return res.status(400).json({ message: 'Notes must have at most 1000 characters' });
  }
  if (creating || body.medicines !== undefined) {
    if (!Array.isArray(body.medicines) || body.medicines.length < 1 || body.medicines.length > 20) {
      return res.status(400).json({ message: 'Send 1 to 20 medicine lines' });
    }
    const seen = new Set();
    for (const line of body.medicines) {
      if (!line || typeof line !== 'object' || Array.isArray(line)) return res.status(400).json({ message: 'Each medicine line must be an object' });
      for (const field of Object.keys(line)) {
        if (!['medicineId', 'dosage', 'frequency', 'duration', 'instructions'].includes(field)) {
          return res.status(400).json({ message: 'Send only accepted medicine line fields' });
        }
      }
      if (typeof line.medicineId !== 'string' || !validator.isMongoId(line.medicineId) || seen.has(line.medicineId.toLowerCase())) {
        return res.status(400).json({ message: 'Medicine IDs must be valid and distinct' });
      }
      seen.add(line.medicineId.toLowerCase());
      for (const field of ['dosage', 'frequency', 'duration']) {
        if (typeof line[field] !== 'string' || !validator.isLength(line[field].trim(), { min: 1, max: 100 })) {
          return res.status(400).json({ message: 'Dosage, frequency and duration must each have 1 to 100 characters' });
        }
      }
      if (line.instructions !== undefined && (typeof line.instructions !== 'string' || !validator.isLength(line.instructions.trim(), { max: 300 }))) {
        return res.status(400).json({ message: 'Instructions must have at most 300 characters' });
      }
    }
  }
  next();
}
