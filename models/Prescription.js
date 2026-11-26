import mongoose from 'mongoose';

// د دوا او جزء کاپي د فهرست له راتلونکو بدلونونو سره نه بدلېږي.
const ingredientSnapshotSchema = new mongoose.Schema({
  ingredient: { type: mongoose.Schema.Types.ObjectId, ref: 'Ingredient', required: true },
  code: { type: String, required: true },
  name: { type: String, required: true },
}, { _id: false });

const catalogSnapshotSchema = new mongoose.Schema({
  mode: { type: String, enum: ['simulated'], required: true },
  source: { type: String, required: true },
  sourceVersion: { type: String, required: true },
  notice: { type: String, required: true },
}, { _id: false });

const medicineSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, minlength: 2, maxlength: 150 },
  medicine: { type: mongoose.Schema.Types.ObjectId, ref: 'Medicine' },
  catalogVersion: { type: Number, min: 0 },
  code: { type: String },
  strength: { type: String },
  form: { type: String },
  ingredients: { type: [ingredientSnapshotSchema], default: undefined },
  dosage: { type: String, required: true, trim: true, maxlength: 100 },
  frequency: { type: String, required: true, trim: true, maxlength: 100 },
  duration: { type: String, required: true, trim: true, maxlength: 100 },
  instructions: { type: String, trim: true, maxlength: 300, default: '' },
}, { _id: false });

const prescriptionSchema = new mongoose.Schema({
  patient: { type: mongoose.Schema.Types.ObjectId, ref: 'Patient', required: true, index: true, immutable: true },
  doctor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true, immutable: true },
  // بې format پخوانۍ نسخې په خپله draft یا signed نه ګرځوو.
  format: { type: String, enum: ['catalog_v1'], immutable: true },
  status: { type: String, enum: ['draft'] },
  appointment: { type: mongoose.Schema.Types.ObjectId, ref: 'Appointment', immutable: true },
  revision: { type: Number, min: 1 },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  catalog: { type: catalogSnapshotSchema },
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
}, { timestamps: true, optimisticConcurrency: true });

export default mongoose.model('Prescription', prescriptionSchema);
