import mongoose from 'mongoose';

export const daysOfWeek = ['saturday', 'sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday'];
// د ۲۴ ساعته وخت بڼه: له 00:00 څخه تر 23:59 پورې.
const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;

// په اوونۍ کې د یوې ورځې یو کاري وخت.
const availabilitySchema = new mongoose.Schema({
  day: {
    type: String,
    required: true,
    enum: daysOfWeek,
  },
  startTime: {
    type: String,
    required: true,
    match: timePattern,
  },
  endTime: {
    type: String,
    required: true,
    match: timePattern,
  },
}, { _id: false });

const doctorSchema = new mongoose.Schema({
  // هر doctor حساب یوازې یو مسلکي پروفایل لري.
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true,
  },
  specialization: {
    type: String,
    required: true,
    trim: true,
    minlength: 2,
    maxlength: 100,
  },
  department: {
    type: String,
    required: true,
    trim: true,
    minlength: 2,
    maxlength: 100,
  },
  registrationNumber: {
    type: String,
    required: true,
    trim: true,
    uppercase: true,
    minlength: 3,
    maxlength: 50,
    unique: true,
  },
  availability: {
    type: [availabilitySchema],
    default: [],
    validate: {
      validator: function (periods) {
        return Array.isArray(periods) && periods.length <= 28;
      },
      message: 'Availability must contain at most 28 time periods',
    },
  },
  isActive: {
    type: Boolean,
    default: true,
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
}, {
  timestamps: true,
  // که بل کس معلومات بدل کړي، زوړ هممهاله save یې نه شي له منځه وړلای.
  optimisticConcurrency: true,
});

export default mongoose.model('Doctor', doctorSchema);
