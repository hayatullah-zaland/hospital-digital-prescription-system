import mongoose from 'mongoose';

// اختیاري اندازه شوي معلومات؛ واحدونه د field په نوم کې ښکاري.
const vitalsSchema = new mongoose.Schema({
  temperatureC: { type: Number },
  weightKg: { type: Number, min: 0 },
}, { _id: false });

const medicalRecordSchema = new mongoose.Schema({
  patient: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Patient',
    required: true,
    immutable: true,
  },
  doctor: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    immutable: true,
  },
  appointment: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Appointment',
    required: true,
    immutable: true,
  },
  symptoms: {
    type: String,
    required: true,
    trim: true,
    minlength: 2,
    maxlength: 1000,
  },
  diagnosis: {
    type: String,
    required: true,
    trim: true,
    minlength: 2,
    maxlength: 500,
  },
  observations: {
    type: String,
    trim: true,
    maxlength: 2000,
    default: '',
  },
  vitals: { type: vitalsSchema, default: {} },
  status: {
    type: String,
    enum: ['draft', 'finalized'],
    default: 'draft',
  },
  finalizedAt: { type: Date, default: null },
  finalizedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  // اصلي ریکارډ null لري؛ اصلاح د خپل پخواني ریکارډ ID ساتي.
  correctionOf: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'MedicalRecord',
    default: null,
    immutable: true,
  },
  correctionReason: {
    type: String,
    trim: true,
    maxlength: 500,
    default: '',
    immutable: true,
  },
}, {
  timestamps: true,
  // هممهاله edit او finalize د یو بل معلومات نه شي له منځه وړلای.
  optimisticConcurrency: true,
});

// یو اصلي ریکارډ په هر ملاقات، او یوه مستقیمه اصلاح په هر پخواني ریکارډ.
medicalRecordSchema.index({ appointment: 1, correctionOf: 1 }, { unique: true });
medicalRecordSchema.index({ doctor: 1, patient: 1, createdAt: -1 });

export default mongoose.model('MedicalRecord', medicalRecordSchema);
