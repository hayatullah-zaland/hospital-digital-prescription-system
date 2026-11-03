import validator from 'validator';

export function isAppointmentDate(date) {
  return typeof date === 'string' && date.length === 10 &&
    validator.isDate(date, { format: 'YYYY-MM-DD', strictMode: true });
}

// دا قاعده د نوي ملاقات او د وخت بدلولو دواړو لپاره ده.
function validateTime(date, startTime) {
  if (!isAppointmentDate(date)) {
    return 'Please enter a valid date in YYYY-MM-DD format';
  }
  if (typeof startTime !== 'string' || startTime.length !== 5 || !validator.isTime(startTime)) {
    return 'Start time must use 24-hour HH:mm format';
  }
  if (!startTime.endsWith(':00') && !startTime.endsWith(':30')) {
    return 'Appointments must start on the hour or half hour';
  }
  const startAt = new Date(date + 'T' + startTime + ':00+04:30');
  if (startAt <= new Date()) {
    return 'Please choose a future appointment time';
  }
  return null;
}

export const validateAppointmentInput = (req, res, next) => {
  const body = req.body;
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return res.status(400).json({ message: 'Please send appointment details as a JSON object' });
  }
  const allowedFields = ['patientId', 'doctorUserId', 'date', 'startTime'];
  for (const field of Object.keys(body)) {
    if (!allowedFields.includes(field)) {
      return res.status(400).json({ message: 'Only patientId, doctorUserId, date and startTime are accepted' });
    }
  }
  if (typeof body.patientId !== 'string' || !validator.isMongoId(body.patientId)) {
    return res.status(400).json({ message: 'Please enter a valid patient ID' });
  }
  if (typeof body.doctorUserId !== 'string' || !validator.isMongoId(body.doctorUserId)) {
    return res.status(400).json({ message: 'Please enter a valid doctor user ID' });
  }
  const message = validateTime(body.date, body.startTime);
  if (message) {
    return res.status(400).json({ message });
  }
  next();
};

export const validateStatusInput = (req, res, next) => {
  const body = req.body;
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return res.status(400).json({ message: 'Please send status details as a JSON object' });
  }
  for (const field of Object.keys(body)) {
    if (field !== 'status' && field !== 'reason') {
      return res.status(400).json({ message: 'Only status and reason are accepted' });
    }
  }
  const statuses = ['checked_in', 'in_progress', 'completed', 'cancelled', 'no_show'];
  if (typeof body.status !== 'string' || !validator.isIn(body.status, statuses)) {
    return res.status(400).json({ message: 'Please select a valid appointment status' });
  }
  if (body.reason !== undefined && (typeof body.reason !== 'string' || !validator.isLength(body.reason.trim(), { max: 300 }))) {
    return res.status(400).json({ message: 'Reason must be text with at most 300 characters' });
  }
  if (body.status === 'cancelled' || body.status === 'no_show') {
    if (typeof body.reason !== 'string' || !validator.isLength(body.reason.trim(), { min: 3, max: 300 })) {
      return res.status(400).json({ message: 'Please give a reason with 3 to 300 characters' });
    }
  }
  next();
};

export const validateRescheduleInput = (req, res, next) => {
  const body = req.body;
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return res.status(400).json({ message: 'Please send reschedule details as a JSON object' });
  }
  for (const field of Object.keys(body)) {
    if (!['date', 'startTime', 'reason'].includes(field)) {
      return res.status(400).json({ message: 'Only date, startTime and reason are accepted' });
    }
  }
  const message = validateTime(body.date, body.startTime);
  if (message) {
    return res.status(400).json({ message });
  }
  if (typeof body.reason !== 'string' || !validator.isLength(body.reason.trim(), { min: 3, max: 300 })) {
    return res.status(400).json({ message: 'Please give a reason with 3 to 300 characters' });
  }
  next();
};
