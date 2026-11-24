import mongoose from 'mongoose';

export const allergyKinds = ['allergy', 'sensitivity'];
export const allergySources = ['patient_reported', 'medical_record', 'clinician_observed'];
export const allergyVerificationStatuses = ['unconfirmed', 'confirmed', 'refuted'];

// د ټاکل شوي جزء نوم او سرچینه د هماغه وخت په بڼه ساتو.
const ingredientSnapshotSchema = new mongoose.Schema({
  code: { type: String, required: true },
  name: { type: String, required: true },
  mode: { type: String, enum: ['simulated'], required: true },
  source: { type: String, required: true },
  sourceVersion: { type: String, required: true },
  notice: { type: String, required: true },
}, { _id: false });

// د هر بدلون پر وخت د هماغه وخت ټول معلومات په تاریخچه کې ساتو.
const snapshotSchema = new mongoose.Schema({
  substance: { type: String, required: true },
  ingredient: { type: mongoose.Schema.Types.ObjectId, ref: 'Ingredient', default: null },
  ingredientSnapshot: { type: ingredientSnapshotSchema, default: null },
  kind: { type: String, enum: allergyKinds, required: true },
  reaction: { type: String, required: true },
  source: { type: String, enum: allergySources, required: true },
  verificationStatus: { type: String, enum: allergyVerificationStatuses, required: true },
  notes: { type: String, default: '' },
  reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  reviewedAt: { type: Date, default: null },
}, { _id: false });

const historySchema = new mongoose.Schema({
  action: { type: String, enum: ['created', 'updated'], required: true },
  actor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  appointment: { type: mongoose.Schema.Types.ObjectId, ref: 'Appointment', required: true },
  reason: { type: String, required: true, trim: true, maxlength: 500 },
  at: { type: Date, default: Date.now },
  snapshot: { type: snapshotSchema, required: true },
}, { _id: false });

const patientAllergySchema = new mongoose.Schema({
  patient: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Patient',
    required: true,
    immutable: true,
  },
  substance: { type: String, required: true, trim: true, minlength: 2, maxlength: 150 },
  // دا یوازې د تکراري نوم د مخنیوي کلۍ ده؛ د دوا ingredient mapping نه دی.
  substanceKey: { type: String, required: true, select: false },
  // پخواني او بې‌mapping راپورونه null پاتې کېږي؛ نوم په خپله نه نښلوو.
  ingredient: { type: mongoose.Schema.Types.ObjectId, ref: 'Ingredient', default: null },
  ingredientSnapshot: { type: ingredientSnapshotSchema, default: null },
  kind: { type: String, enum: allergyKinds, required: true },
  reaction: { type: String, required: true, trim: true, minlength: 2, maxlength: 500 },
  source: { type: String, enum: allergySources, required: true },
  verificationStatus: {
    type: String,
    enum: allergyVerificationStatuses,
    default: 'unconfirmed',
  },
  notes: { type: String, trim: true, maxlength: 1000, default: '' },
  recordedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    immutable: true,
  },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  reviewedAt: { type: Date, default: null },
  history: { type: [historySchema], default: [] },
}, {
  timestamps: true,
  versionKey: 'version',
  // هممهاله سمونونه د یو بل معلومات او تاریخچه نه شي له منځه وړلای.
  optimisticConcurrency: true,
});

patientAllergySchema.index({ patient: 1, substanceKey: 1, kind: 1 }, { unique: true });
patientAllergySchema.index({ patient: 1, createdAt: -1, _id: -1 });

export default mongoose.model('PatientAllergy', patientAllergySchema);
