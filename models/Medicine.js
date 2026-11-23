import mongoose from 'mongoose';
import { catalogSource } from './Ingredient.js';

export const medicineForms = ['tablet', 'capsule', 'syrup', 'cream', 'injection', 'drops', 'other'];

const medicineSchema = new mongoose.Schema({
  code: { type: String, required: true, trim: true, uppercase: true, unique: true, immutable: true },
  name: { type: String, required: true, trim: true, minlength: 2, maxlength: 150 },
  strength: { type: String, required: true, trim: true, maxlength: 80 },
  form: { type: String, required: true, enum: medicineForms },
  ingredients: {
    type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Ingredient' }],
    validate: { validator: value => value.length >= 1 && value.length <= 10, message: 'Use 1 to 10 ingredients' },
  },
  notes: { type: String, trim: true, maxlength: 1000, default: '' },
  isActive: { type: Boolean, default: true },
  mode: { type: String, enum: ['simulated'], default: catalogSource.mode, immutable: true },
  source: { type: String, default: catalogSource.source, immutable: true },
  sourceVersion: { type: String, default: catalogSource.sourceVersion, immutable: true },
  notice: { type: String, default: catalogSource.notice, immutable: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, immutable: true },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
}, { timestamps: true, versionKey: 'version', optimisticConcurrency: true });

// version د دوو هممهاله سمونونو د ورکېدو مخه نیسي.
medicineSchema.index({ name: 1, _id: 1 });
medicineSchema.index({ ingredients: 1, isActive: 1 });
export default mongoose.model('Medicine', medicineSchema);
