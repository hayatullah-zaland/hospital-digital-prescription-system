import KnowledgeRule, { interactionSource } from '../models/KnowledgeRule.js';
import Ingredient, { catalogSource } from '../models/Ingredient.js';
import Medicine from '../models/Medicine.js';

function isCurrentDemoSource(record) {
  if (!record) return false;
  return record.mode === catalogSource.mode && record.source === catalogSource.source && record.sourceVersion === catalogSource.sourceVersion;
}

function isUsablePairRule(rule, ids) {
  if (!isCurrentDemoSource(rule) || rule.kind !== 'drug_interaction') return false;
  if (!Array.isArray(rule.ingredients) || rule.ingredients.length !== 2) return false;
  if (String(rule.ingredients[0]) !== ids[0] || String(rule.ingredients[1]) !== ids[1]) return false;
  return ['warning', 'no_demo_interaction'].includes(rule.outcome);
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
    const issues = [];
    const ingredientIds = new Set();
    const medicineVersions = [];
    for (const medicine of medicines) {
      medicineVersions.push({ medicineId: medicine._id, name: medicine.name, version: medicine.version });
      if (!isCurrentDemoSource(medicine)) {
        issues.push({ code: 'unsupported_medicine_source', medicineId: medicine._id });
        continue;
      }
      if (!Array.isArray(medicine.ingredients) || medicine.ingredients.length === 0) {
        issues.push({ code: 'missing_medicine_ingredients', medicineId: medicine._id });
        continue;
      }
      for (const id of medicine.ingredients) ingredientIds.add(id.toString());
    }
    // تر ۴۰ بېلابېلو اجزاوو محدودیت تر ۷۸۰ زیاتې جوړې نه پرېږدي.
    if (ingredientIds.size > 40) return res.status(400).json({ message: 'Check at most 40 distinct ingredients at a time' });
    const ids = Array.from(ingredientIds).sort();
    const ingredients = await Ingredient.find({ _id: { $in: ids } }).lean();
    const ingredientsById = new Map();
    for (const ingredient of ingredients) ingredientsById.set(ingredient._id.toString(), ingredient);
    for (const id of ids) {
      if (!isCurrentDemoSource(ingredientsById.get(id))) issues.push({ code: 'unavailable_ingredient', ingredientId: id });
    }

    // د بېلابېلو دواوو او د یوې مرکبې دوا د اجزاوو ټولې جوړې ګورو.
    const pairs = [];
    const pairKeys = [];
    for (let first = 0; first < ids.length; first++) {
      for (let second = first + 1; second < ids.length; second++) {
        const key = ids[first] + ':' + ids[second];
        pairs.push({ key, ids: [ids[first], ids[second]] });
        pairKeys.push(key);
      }
    }
    const rules = await KnowledgeRule.find({ pairKey: { $in: pairKeys } }).lean();
    const rulesByPair = new Map();
    for (const rule of rules) rulesByPair.set(rule.pairKey, rule);
    const findings = [];
    const rulesUsed = [];
    let missingPairCount = 0;
    for (const pair of pairs) {
      const rule = rulesByPair.get(pair.key);
      const first = ingredientsById.get(pair.ids[0]);
      const second = ingredientsById.get(pair.ids[1]);
      if (!isCurrentDemoSource(first) || !isCurrentDemoSource(second)) {
        missingPairCount++;
        continue;
      }
      if (!isUsablePairRule(rule, pair.ids)) {
        missingPairCount++;
        continue;
      }
      rulesUsed.push({ ruleId: rule._id, ingredientIds: pair.ids, outcome: rule.outcome });
      if (rule.outcome !== 'warning') continue;
      const medicineIds = [];
      for (const medicine of medicines) {
        if (!isCurrentDemoSource(medicine) || !Array.isArray(medicine.ingredients)) continue;
        for (const id of medicine.ingredients) {
          if (pair.ids.includes(id.toString())) {
            medicineIds.push(medicine._id);
            break;
          }
        }
      }
      findings.push({ ruleId: rule._id, ingredientIds: pair.ids, ingredientNames: [first.name, second.name], medicineIds, message: 'Simulated interaction warning; unsuitable for actual patient care' });
    }
    if (missingPairCount > 0) issues.push({ code: 'uncovered_ingredient_pairs', count: missingPairCount });
    if (pairs.length === 0) issues.push({ code: 'no_distinct_ingredient_pair' });
    let status = 'clear';
    if (issues.length > 0) status = 'unknown';
    if (findings.length > 0) status = 'warning';
    // preview نسخه نه بدلوي؛ نسخه به وروسته له خپل ثابت check سره ونښلوو.
    res.json({
      check: {
        type: 'interaction_preview', mode: interactionSource.mode, status,
        patientId: req.params.patientId, appointmentId: req.allergyAppointment,
        checkedBy: req.user._id, checkedAt: new Date(), medicines: medicineVersions,
        findings, rulesUsed,
        coverage: { complete: issues.length === 0, ingredientCount: ids.length, pairCount: pairs.length, coveredPairCount: rulesUsed.length, missingPairCount, issues },
      },
      knowledge: interactionSource,
    });
  } catch (error) {
    res.status(500).json({ message: 'Unable to check drug interactions. Please try again' });
  }
}
