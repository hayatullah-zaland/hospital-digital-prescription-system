import validator from 'validator';

export const validateMedicalRecordId = (req, res, next) => {
  if (!validator.isMongoId(req.params.id)) {
    return res.status(400).json({ message: 'Please enter a valid medical record ID' });
  }
  next();
};

// POST کې اړین fields، او PATCH کې یوازې لېږل شوي fields چک کوو.
export const validateMedicalRecordInput = (req, res, next) => {
  const body = req.body;
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return res.status(400).json({ message: 'Please send medical record details as a JSON object' });
  }
  const isCreating = req.method === 'POST';
  const fields = Object.keys(body);
  const allowedFields = ['symptoms', 'diagnosis', 'observations', 'vitals'];
  if (isCreating) {
    allowedFields.push('appointmentId');
  }
  if (fields.length === 0) {
    return res.status(400).json({ message: 'Please send at least one accepted medical record field' });
  }
  for (const field of fields) {
    if (!allowedFields.includes(field)) {
      return res.status(400).json({ message: 'Please send only the accepted medical record fields' });
    }
  }
  if (isCreating && (typeof body.appointmentId !== 'string' || !validator.isMongoId(body.appointmentId))) {
    return res.status(400).json({ message: 'Please enter a valid appointment ID' });
  }
  if (isCreating || body.symptoms !== undefined) {
    if (typeof body.symptoms !== 'string' || !validator.isLength(body.symptoms.trim(), { min: 2, max: 1000 })) {
      return res.status(400).json({ message: 'Symptoms must have between 2 and 1000 characters' });
    }
  }
  if (isCreating || body.diagnosis !== undefined) {
    if (typeof body.diagnosis !== 'string' || !validator.isLength(body.diagnosis.trim(), { min: 2, max: 500 })) {
      return res.status(400).json({ message: 'Diagnosis must have between 2 and 500 characters' });
    }
  }
  if (body.observations !== undefined && (typeof body.observations !== 'string' || !validator.isLength(body.observations.trim(), { max: 2000 }))) {
    return res.status(400).json({ message: 'Observations must be text with at most 2000 characters' });
  }
  if (body.vitals !== undefined) {
    const vitals = body.vitals;
    if (!vitals || typeof vitals !== 'object' || Array.isArray(vitals)) {
      return res.status(400).json({ message: 'Vitals must be a JSON object' });
    }
    for (const field of Object.keys(vitals)) {
      if (field !== 'temperatureC' && field !== 'weightKg') {
        return res.status(400).json({ message: 'Vitals accept only temperatureC and weightKg' });
      }
    }
    if (vitals.temperatureC !== undefined && (typeof vitals.temperatureC !== 'number' || !Number.isFinite(vitals.temperatureC))) {
      return res.status(400).json({ message: 'Temperature must be a finite number in Celsius' });
    }
    if (vitals.weightKg !== undefined && (typeof vitals.weightKg !== 'number' || !Number.isFinite(vitals.weightKg) || vitals.weightKg <= 0)) {
      return res.status(400).json({ message: 'Weight must be a finite number greater than zero in kilograms' });
    }
  }
  next();
};

export const validateCorrectionInput = (req, res, next) => {
  const body = req.body;
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return res.status(400).json({ message: 'Please send a correction reason as a JSON object' });
  }
  if (Object.keys(body).length !== 1 || typeof body.reason !== 'string' || !validator.isLength(body.reason.trim(), { min: 3, max: 500 })) {
    return res.status(400).json({ message: 'Please send only a reason with 3 to 500 characters' });
  }
  next();
};

export const validateFinalizeInput = (req, res, next) => {
  if (req.body !== undefined) {
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body) || Object.keys(req.body).length !== 0) {
      return res.status(400).json({ message: 'Finalizing a medical record does not accept body fields' });
    }
  }
  next();
};
