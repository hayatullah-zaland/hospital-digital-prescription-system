import mongoose from 'mongoose';

const patientSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, minlength: 2, maxlength: 100 },
  dateOfBirth: {
    type: Date,
    required: true,
    max: [() => new Date(), 'Date of birth cannot be in the future'],
  },
  gender: {
    type: String,
    enum: ['male', 'female', 'other', 'unspecified'],
    default: 'unspecified',
  },
  phone: { type: String, required: true, trim: true, maxlength: 25 },
  address: { type: String, trim: true, maxlength: 300, default: '' },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
}, { timestamps: true });

export default mongoose.model('Patient', patientSchema);
