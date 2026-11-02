import validator from 'validator';
import { daysOfWeek } from '../models/Doctor.js';

// POST کې اړین معلومات، او PATCH کې یوازې لېږل شوي معلومات چک کوو.
export const validateDoctorInput = (req, res, next) => {
  const body = req.body;
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return res.status(400).json({ message: 'Please send doctor details as a JSON object' });
  }

  const isCreating = req.method === 'POST';
  const fields = Object.keys(body);
  const allowedFields = ['specialization', 'department', 'registrationNumber', 'availability', 'isActive'];
  if (isCreating) {
    allowedFields.push('userId');
  }
  if (fields.length === 0) {
    return res.status(400).json({ message: 'Please send doctor profile fields' });
  }
  for (const field of fields) {
    if (!allowedFields.includes(field)) {
      return res.status(400).json({ message: 'Please send only the accepted doctor profile fields' });
    }
  }

  if (isCreating && (typeof body.userId !== 'string' || !validator.isMongoId(body.userId))) {
    return res.status(400).json({ message: 'Please enter a valid doctor user ID' });
  }

  // ډاکټر د خپل پروفایل یوازې دا دوه معلومات بدلولای شي.
  if (!isCreating && req.user.role === 'doctor') {
    for (const field of fields) {
      if (field !== 'specialization' && field !== 'availability') {
        return res.status(403).json({ message: 'Doctors can update only their own specialization and availability' });
      }
    }
  }

  if (isCreating || body.specialization !== undefined) {
    if (typeof body.specialization !== 'string' || !validator.isLength(body.specialization.trim(), { min: 2, max: 100 })) {
      return res.status(400).json({ message: 'Specialization must have between 2 and 100 characters' });
    }
  }
  if (isCreating || body.department !== undefined) {
    if (typeof body.department !== 'string' || !validator.isLength(body.department.trim(), { min: 2, max: 100 })) {
      return res.status(400).json({ message: 'Department must have between 2 and 100 characters' });
    }
  }
  if (isCreating || body.registrationNumber !== undefined) {
    if (typeof body.registrationNumber !== 'string' || !validator.isLength(body.registrationNumber.trim(), { min: 3, max: 50 })) {
      return res.status(400).json({ message: 'Registration number must have between 3 and 50 characters' });
    }
  }
  if (body.isActive !== undefined && typeof body.isActive !== 'boolean') {
    return res.status(400).json({ message: 'isActive must be true or false' });
  }

  if (body.availability !== undefined) {
    const availability = body.availability;
    if (!Array.isArray(availability) || availability.length > 28) {
      return res.status(400).json({ message: 'Availability must be an array with at most 28 time periods' });
    }

    const checkedPeriods = [];
    for (const period of availability) {
      if (!period || typeof period !== 'object' || Array.isArray(period)) {
        return res.status(400).json({ message: 'Each time period must be a JSON object' });
      }
      for (const field of Object.keys(period)) {
        if (!['day', 'startTime', 'endTime'].includes(field)) {
          return res.status(400).json({ message: 'Time periods accept only day, startTime and endTime' });
        }
      }

      const { day, startTime, endTime } = period;
      if (typeof day !== 'string' || !validator.isIn(day, daysOfWeek)) {
        return res.status(400).json({ message: 'Please select a valid lowercase day of the week' });
      }
      // وخت باید د 08:00 په څېر پنځه توري او په ۲۴ ساعته بڼه وي.
      if (typeof startTime !== 'string' || startTime.length !== 5 || !validator.isTime(startTime)) {
        return res.status(400).json({ message: 'Start time must use 24-hour HH:mm format' });
      }
      if (typeof endTime !== 'string' || endTime.length !== 5 || !validator.isTime(endTime)) {
        return res.status(400).json({ message: 'End time must use 24-hour HH:mm format' });
      }
      if (startTime >= endTime) {
        return res.status(400).json({ message: 'Each time period must end after it starts on the same day' });
      }

      // د همدې ورځې پخواني وختونه ګورو، څو دوه وختونه سره ګډ نه شي.
      for (const previous of checkedPeriods) {
        if (previous.day === day && startTime < previous.endTime && endTime > previous.startTime) {
          return res.status(400).json({ message: 'Time periods on the same day must not overlap' });
        }
      }
      checkedPeriods.push(period);
    }
  }

  next();
};

// د availability ځانګړې لاره یوازې همدا یو field مني.
export const validateAvailabilityInput = (req, res, next) => {
  const body = req.body;
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return res.status(400).json({ message: 'Please send only the availability field' });
  }
  if (Object.keys(body).length !== 1 || body.availability === undefined) {
    return res.status(400).json({ message: 'Please send only the availability field' });
  }
  next();
};
