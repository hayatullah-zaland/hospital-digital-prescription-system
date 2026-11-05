import Doctor from '../models/Doctor.js';

// د لیکلو لپاره فعال پروفایل غواړي؛ د خپل پخواني ریکارډ کتنه جلا ده.
export const requireActiveMedicalDoctor = async (req, res, next) => {
  try {
    const doctor = await Doctor.exists({ user: req.user._id, isActive: true });
    if (!doctor) {
      return res.status(403).json({ message: 'An active doctor profile is required' });
    }
    next();
  } catch (error) {
    res.status(500).json({ message: 'Unable to check the doctor profile. Please try again' });
  }
};
