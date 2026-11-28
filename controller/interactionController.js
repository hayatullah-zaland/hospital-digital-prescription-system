import { evaluateInteractions } from './medicationSafety.js';
import KnowledgeRule, { interactionSource } from '../models/KnowledgeRule.js';
import Ingredient, { catalogSource } from '../models/Ingredient.js';
import Medicine from '../models/Medicine.js';

function isCurrentDemoSource(record) {
  if (!record) return false;
  return record.mode === catalogSource.mode && record.source === catalogSource.source && record.sourceVersion === catalogSource.sourceVersion;
}

export async function createInteractionRule(req, res) {
  try {
    const ids = req.interactionIngredientIds;
    const ingredients = await Ingredient.find({ _id: { $in: ids } }).lean();
    if (ingredients.length !== 2) return res.status(404).json({ message: 'Two current simulated ingredients are required' });
    for (const ingredient of ingredients) {
      if (!isCurrentDemoSource(ingredient)) return res.status(404).json({ message: 'Two current simulated ingredients are required' });
    }
    const rule = await KnowledgeRule.create({ ingredients: ids, pairKey: ids.join(':'), outcome: req.body.outcome, createdBy: req.user._id });
    res.status(201).json({ rule, knowledge: interactionSource });
  } catch (error) {
    if (error.code === 11000) return res.status(409).json({ message: 'A rule for this ingredient pair already exists' });
    res.status(500).json({ message: 'Unable to create interaction rule. Please try again' });
  }
}

export async function getInteractionRules(req, res) {
  try {
    const { page, limit, skip, ingredientId } = req.interactionList;
    const filter = { kind: 'drug_interaction', mode: interactionSource.mode, source: interactionSource.source, sourceVersion: interactionSource.sourceVersion };
    if (ingredientId) filter.ingredients = ingredientId;
    const total = await KnowledgeRule.countDocuments(filter);
    const rules = await KnowledgeRule.find(filter).sort({ _id: 1 }).skip(skip).limit(limit).lean();
    res.json({ rules, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }, knowledge: interactionSource });
  } catch (error) {
    res.status(500).json({ message: 'Unable to list interaction rules. Please try again' });
  }
}

export async function getInteractionRuleById(req, res) {
  try {
    const rule = await KnowledgeRule.findById(req.params.id).lean();
    if (!isCurrentDemoSource(rule) || rule.kind !== 'drug_interaction') return res.status(404).json({ message: 'Interaction rule not found' });
    res.json({ rule, knowledge: interactionSource });
  } catch (error) {
    res.status(500).json({ message: 'Unable to read interaction rule. Please try again' });
  }
}

export async function checkPatientInteractions(req, res) {
  try {
    const medicines = await Medicine.find({ _id: { $in: req.allergyMedicineIds }, isActive: true }).sort({ _id: 1 }).lean();
    if (medicines.length !== req.allergyMedicineIds.length) {
      return res.status(404).json({ message: 'One or more active medicines were not found' });
    }
    const ids = new Set();
    for (const medicine of medicines) {
      if (!isCurrentDemoSource(medicine) || !Array.isArray(medicine.ingredients)) continue;
      for (const id of medicine.ingredients) ids.add(id.toString());
    }
    if (ids.size > 40) return res.status(400).json({ message: 'Check at most 40 distinct ingredients at a time' });
    const sorted = Array.from(ids).sort();
    const pairKeys = [];
    for (let first = 0; first < sorted.length; first++) {
      for (let second = first + 1; second < sorted.length; second++) pairKeys.push(sorted[first] + ':' + sorted[second]);
    }
    const ingredients = await Ingredient.find({ _id: { $in: sorted } }).lean();
    const rules = await KnowledgeRule.find({ pairKey: { $in: pairKeys } }).lean();
    const result = evaluateInteractions(medicines, ingredients, rules);
    const { status, findings, rulesUsed, coverage } = result;
    const medicineVersions = result.medicines;
    // preview نسخه نه بدلوي؛ د Draft ساتل شوې کتنه جلا API لري.
    res.json({
      check: {
        type: 'interaction_preview', mode: interactionSource.mode, status,
        patientId: req.params.patientId, appointmentId: req.allergyAppointment,
        checkedBy: req.user._id, checkedAt: new Date(), medicines: medicineVersions,
        findings, rulesUsed,
        coverage,
      },
      knowledge: interactionSource,
    });
  } catch (error) {
    res.status(500).json({ message: 'Unable to check drug interactions. Please try again' });
  }
}
