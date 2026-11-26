import mongoose from 'mongoose';
import { catalogSource } from './Ingredient.js';

export const interactionSource = {
  mode: catalogSource.mode,
  source: catalogSource.source,
  sourceVersion: catalogSource.sourceVersion,
  notice: 'Simulated interaction rules; unsuitable for actual patient care.',
};

// دا ثابت قواعد یوازې د خیالي تعلیمي مثالونو لپاره دي.
const knowledgeRuleSchema = new mongoose.Schema({
  kind: { type: String, enum: ['drug_interaction'], default: 'drug_interaction', immutable: true },
  ingredients: {
    type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Ingredient' }],
    required: true,
    immutable: true,
    validate: { validator: value => value.length === 2 && String(value[0]) !== String(value[1]), message: 'Use two distinct ingredients' },
  },
  pairKey: { type: String, required: true, unique: true, immutable: true },
  outcome: { type: String, enum: ['warning', 'no_demo_interaction'], required: true, immutable: true },
  mode: { type: String, enum: ['simulated'], default: interactionSource.mode, immutable: true },
  source: { type: String, default: interactionSource.source, immutable: true },
  sourceVersion: { type: String, default: interactionSource.sourceVersion, immutable: true },
  notice: { type: String, default: interactionSource.notice, immutable: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, immutable: true },
}, { timestamps: true });

export default mongoose.model('KnowledgeRule', knowledgeRuleSchema);
