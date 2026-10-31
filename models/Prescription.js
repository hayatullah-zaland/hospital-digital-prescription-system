import mongoose from 'mongoose';

const medicineSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, minlength: 2, maxlength: 100 },
  dosage: { type: String, required: true, trim: true, maxlength: 100 },
  frequency: { type: String, required: true, trim: true, maxlength: 100 },
  duration: { type: String, required: true, trim: true, maxlength: 100 },
  instructions: { type: String, trim: true, maxlength: 300, default: '' },
}, { _id: false });

const prescriptionSchema = new mongoose.Schema({
  patient: { type: mongoose.Schema.Types.ObjectId, ref: 'Patient', required: true, index: true },
  doctor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  diagnosis: { type: String, required: true, trim: true, minlength: 2, maxlength: 500 },
  medicines: {
    type: [medicineSchema],
    required: true,
    validate: {
      validator: medicines => medicines.length >= 1 && medicines.length <= 20,
      message: 'A prescription must contain between 1 and 20 medicines',
    },
  },
  notes: { type: String, trim: true, maxlength: 1000, default: '' },
}, { timestamps: true });

export default mongoose.model('Prescription', prescriptionSchema);
