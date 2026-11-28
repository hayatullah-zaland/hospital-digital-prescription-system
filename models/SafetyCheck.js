import mongoose from 'mongoose';
import { catalogSource } from './Ingredient.js';

export const safetyAlgorithmVersion = 'academic_safety_v1';
export const safetyNotice = 'Simulated safety check; unsuitable for actual patient care.';

// دا د یوې کتنې ثابت ثبوت دی؛ د سمون او ړنګولو API نه لري.
const safetyCheckSchema = new mongoose.Schema({
  prescription: { type: mongoose.Schema.Types.ObjectId, ref: 'Prescription', required: true, immutable: true },
  patient: { type: mongoose.Schema.Types.ObjectId, ref: 'Patient', required: true, immutable: true },
  doctor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, immutable: true },
  appointment: { type: mongoose.Schema.Types.ObjectId, ref: 'Appointment', required: true, immutable: true },
  revision: { type: Number, required: true, min: 1, immutable: true },
  contentHash: { type: String, required: true, match: /^[a-f0-9]{64}$/, immutable: true },
  inputHash: { type: String, required: true, match: /^[a-f0-9]{64}$/, immutable: true },
  algorithmVersion: { type: String, default: safetyAlgorithmVersion, immutable: true },
  status: { type: String, enum: ['clear', 'warning', 'unknown'], required: true, immutable: true },
  coverageComplete: { type: Boolean, required: true, immutable: true },
  mode: { type: String, enum: ['simulated'], default: catalogSource.mode, immutable: true },
  source: { type: String, default: catalogSource.source, immutable: true },
  sourceVersion: { type: String, default: catalogSource.sourceVersion, immutable: true },
  notice: { type: String, default: safetyNotice, immutable: true },
  // دا JSON کاپۍ یوازې سرور جوړوي؛ د client body دلته نه ساتو.
  contentSnapshot: { type: mongoose.Schema.Types.Mixed, required: true, immutable: true },
  inputSnapshot: { type: mongoose.Schema.Types.Mixed, required: true, immutable: true },
  allergy: { type: mongoose.Schema.Types.Mixed, required: true, immutable: true },
  interaction: { type: mongoose.Schema.Types.Mixed, required: true, immutable: true },
  checkedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, immutable: true },
  checkedAt: { type: Date, default: Date.now, immutable: true },
}, { timestamps: { createdAt: true, updatedAt: false } });

safetyCheckSchema.index({ prescription: 1, createdAt: -1, _id: -1 });
export default mongoose.model('SafetyCheck', safetyCheckSchema);
