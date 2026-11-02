import validator from 'validator';
import Doctor from '../models/Doctor.js';
import User from '../models/User.js';

// ۱. د doctor حساب پیدا کوو، ۲. پروفایل جوړوو، ۳. ځواب لېږو.
export const createDoctor = async (req, res) => {
  try {
    const {
      userId,
      specialization,
      department,
      registrationNumber,
      availability = [],
      isActive = true,
    } = req.body;

    const user = await User.findById(userId).select('role');
    if (!user) {
      return res.status(404).json({ message: 'Doctor user account not found' });
    }
    if (user.role !== 'doctor') {
      return res.status(400).json({ message: 'The selected user account must have the doctor role' });
    }

    // ډاډ اخلو چې د تکراري حساب او ثبت شمېرې مخنیوی فعال شوی دی.
    await Doctor.init();
    const doctor = await Doctor.create({
      user: userId,
      specialization: specialization.trim(),
      department: department.trim(),
      registrationNumber: registrationNumber.trim().toUpperCase(),
      availability: availability,
      isActive: isActive,
      createdBy: req.user._id,
    });

    // له User څخه یوازې نوم راوړو؛ password او email نه لېږو.
    await doctor.populate('user', 'name');
    res.status(201).json({ message: 'Doctor profile created successfully', doctor });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({ message: 'This doctor account or registration number already has a profile' });
    }
    if (error.name === 'ValidationError') {
      return res.status(400).json({ message: 'Please check the doctor details' });
    }
    res.status(500).json({ message: 'Unable to create the doctor profile. Please try again' });
  }
};

// د ډاکټرانو لېست، لټون او پاڼې.
export const getDoctors = async (req, res) => {
  try {
    const { search = '', page = '1', limit = '10', isActive } = req.query;
    if (typeof search !== 'string' || !validator.isLength(search.trim(), { max: 100 })) {
      return res.status(400).json({ message: 'Search must be text with at most 100 characters' });
    }
    if (typeof page !== 'string' || !validator.isInt(page, { min: 1, max: Number.MAX_SAFE_INTEGER, allow_leading_zeroes: false })) {
      return res.status(400).json({ message: 'Page must be a positive whole number within the safe integer range' });
    }
    if (typeof limit !== 'string' || !validator.isInt(limit, { min: 1, max: 50, allow_leading_zeroes: false })) {
      return res.status(400).json({ message: 'Limit must be a whole number between 1 and 50' });
    }
    if (isActive !== undefined && (typeof isActive !== 'string' || !validator.isIn(isActive, ['true', 'false']))) {
      return res.status(400).json({ message: 'isActive must be true or false' });
    }
    if (req.user.role !== 'hospital_admin' && isActive === 'false') {
      return res.status(403).json({ message: 'Only administrators can list inactive doctor profiles' });
    }

    const pageNumber = Number(page);
    const pageSize = Number(limit);
    const skip = (pageNumber - 1) * pageSize;
    if (!Number.isSafeInteger(skip)) {
      return res.status(400).json({ message: 'Page is too large' });
    }

    const filter = {};
    if (req.user.role !== 'hospital_admin') {
      filter.isActive = true;
    } else if (isActive !== undefined) {
      filter.isActive = isActive === 'true';
    }
    if (search.trim()) {
      // ځانګړي توري لکه + او ( د عادي متن په توګه لټوو.
      const searchText = search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const matchingUsers = await User.find({ role: 'doctor', name: { $regex: searchText, $options: 'i' } }).select('_id');
      const matchingUserIds = [];
      for (const user of matchingUsers) {
        matchingUserIds.push(user._id);
      }

      // $or: له نوم، تخصص یا څانګې څخه یوه برابره شي، پایله ښکاره کېږي.
      filter.$or = [
        { specialization: { $regex: searchText, $options: 'i' } },
        { department: { $regex: searchText, $options: 'i' } },
        { user: { $in: matchingUserIds } },
      ];
    }

    // اډمین بشپړ پروفایل ویني؛ نور کارکوونکي یوازې د لېست اړین معلومات ویني.
    let selectedFields = 'user specialization department registrationNumber availability isActive createdBy createdAt updatedAt __v';
    if (req.user.role !== 'hospital_admin') {
      selectedFields = 'user specialization department availability isActive';
    }
    const doctors = await Doctor.find(filter)
      .select(selectedFields)
      .populate('user', 'name')
      .sort({ createdAt: -1, _id: -1 })
      .skip(skip)
      .limit(pageSize);
    const total = await Doctor.countDocuments(filter);

    res.json({
      doctors,
      pagination: {
        page: pageNumber,
        limit: pageSize,
        total: total,
        totalPages: Math.ceil(total / pageSize),
      },
    });
  } catch (error) {
    res.status(500).json({ message: 'Unable to load doctor profiles. Please try again' });
  }
};

// دلته د User حساب ID کاروو، د Doctor پروفایل ID نه کاروو.
export const getDoctorByUserId = async (req, res) => {
  try {
    const { doctorUserId } = req.params;
    if (!validator.isMongoId(doctorUserId)) {
      return res.status(400).json({ message: 'Please enter a valid doctor user ID' });
    }

    const isAdmin = req.user.role === 'hospital_admin';
    const isOwner = req.user.role === 'doctor' && req.user.id === doctorUserId.toLowerCase();
    const filter = { user: doctorUserId };
    let selectedFields = 'user specialization department registrationNumber availability isActive createdBy createdAt updatedAt __v';
    if (!isAdmin && !isOwner) {
      filter.isActive = true;
      selectedFields = 'user specialization department availability isActive';
    }

    const doctor = await Doctor.findOne(filter).select(selectedFields).populate('user', 'name');
    if (!doctor || !doctor.user) {
      return res.status(404).json({ message: 'Doctor profile not found' });
    }
    res.json({ doctor });
  } catch (error) {
    res.status(500).json({ message: 'Unable to load the doctor profile. Please try again' });
  }
};

// هر لېږل شوی field جلا بدلوو؛ پاتې معلومات خپل پخوانی حالت ساتي.
export const updateDoctor = async (req, res) => {
  try {
    const { doctorUserId } = req.params;
    if (!validator.isMongoId(doctorUserId)) {
      return res.status(400).json({ message: 'Please enter a valid doctor user ID' });
    }
    if (req.user.role === 'doctor' && req.user.id !== doctorUserId.toLowerCase()) {
      return res.status(404).json({ message: 'Doctor profile not found' });
    }
    const doctor = await Doctor.findOne({ user: doctorUserId });
    if (!doctor) {
      return res.status(404).json({ message: 'Doctor profile not found' });
    }
    const { specialization, department, registrationNumber, availability, isActive } = req.body;
    if (specialization !== undefined) {
      doctor.specialization = specialization.trim();
    }
    if (department !== undefined) {
      doctor.department = department.trim();
    }
    if (registrationNumber !== undefined) {
      doctor.registrationNumber = registrationNumber.trim().toUpperCase();
    }
    if (availability !== undefined) {
      doctor.availability = availability;
    }
    if (isActive !== undefined) {
      doctor.isActive = isActive;
    }

    await doctor.save();
    await doctor.populate('user', 'name');
    res.json({ message: 'Doctor profile updated successfully', doctor });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({ message: 'This doctor account or registration number already has a profile' });
    }
    if (error.name === 'ValidationError') {
      return res.status(400).json({ message: 'Please check the doctor details' });
    }
    if (error.name === 'VersionError') {
      return res.status(409).json({ message: 'The doctor profile changed. Load it again before editing' });
    }
    res.status(500).json({ message: 'Unable to update the doctor profile. Please try again' });
  }
};
