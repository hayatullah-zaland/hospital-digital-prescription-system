import mongoose from 'mongoose';

// دا سرچینه یوازې د زده کړې خیالي معلومات دي.
export const catalogSource = {
  mode: 'simulated',
  source: 'academic_demo_manual',
  sourceVersion: '1',
  notice: 'Simulated catalog data; unsuitable for actual patient care.',
};

const ingredientSchema = new mongoose.Schema({
  code: { type: String, required: true, trim: true, uppercase: true, unique: true, immutable: true },
  name: { type: String, required: true, trim: true, minlength: 2, maxlength: 150, immutable: true },
  mode: { type: String, enum: ['simulated'], default: catalogSource.mode, immutable: true },
  source: { type: String, default: catalogSource.source, immutable: true },
  sourceVersion: { type: String, default: catalogSource.sourceVersion, immutable: true },
  notice: { type: String, default: catalogSource.notice, immutable: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, immutable: true },
}, { timestamps: true });

// د جزء هویت ثابت ساتو؛ دلته د سمون یا ړنګولو API نشته.
ingredientSchema.index({ name: 1, _id: 1 });
export default mongoose.model('Ingredient', ingredientSchema);
