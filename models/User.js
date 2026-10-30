import mongoose from 'mongoose';

const userSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, minlength: 2, maxlength: 100 },
  email: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    lowercase: true,
  },
  password: {
    type: String,
    required: true,
    minlength: 12,
    select: false,
  },
  role: {
    type: String,
    enum: ['hospital_admin', 'receptionist', 'doctor', 'hospital_pharmacist', 'external_pharmacist', 'patient'],
    default: 'patient',
  },
}, { timestamps: true });

export default mongoose.model('User', userSchema);
