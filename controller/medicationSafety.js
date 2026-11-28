import { catalogSource } from '../models/Ingredient.js';

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

export function evaluateAllergies(medicines, allergies, ingredients) {
  const issues = [];
  if (allergies.length > 200) {
    issues.push({ code: 'allergy_limit_exceeded' });
    allergies = allergies.slice(0, 200);
  }
  if (allergies.length === 0) issues.push({ code: 'no_active_allergy_reports' });

  // لوستل شوي اجزا د ID له مخې پیدا کوو.
  const ingredientsById = new Map();
  for (const ingredient of ingredients) ingredientsById.set(ingredient._id.toString(), ingredient);

  const mappedAllergies = [];
  const allergyVersions = [];
  for (const allergy of allergies) {
    allergyVersions.push({ allergyId: allergy._id, version: allergy.version });
    if (!allergy.ingredient) {
      issues.push({ code: 'unmapped_allergy', allergyId: allergy._id });
      continue;
    }
    const ingredient = ingredientsById.get(allergy.ingredient.toString());
    const snapshot = allergy.ingredientSnapshot;
    if (!isCurrentDemoSource(ingredient) || !isCurrentDemoSource(snapshot) || snapshot.code !== ingredient.code || snapshot.name !== ingredient.name) {
      issues.push({ code: 'unavailable_allergy_mapping', allergyId: allergy._id });
      continue;
    }
    if (!['confirmed', 'unconfirmed'].includes(allergy.verificationStatus) || !['allergy', 'sensitivity'].includes(allergy.kind)) {
      issues.push({ code: 'unsupported_allergy_report', allergyId: allergy._id });
      continue;
    }
    mappedAllergies.push(allergy);
  }

  const findings = [];
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
    const seenIngredients = new Set();
    for (const id of medicine.ingredients) {
      const ingredientId = id.toString();
      if (seenIngredients.has(ingredientId)) continue;
      seenIngredients.add(ingredientId);
      const ingredient = ingredientsById.get(ingredientId);
      if (!isCurrentDemoSource(ingredient)) {
        issues.push({ code: 'unavailable_medicine_ingredient', medicineId: medicine._id, ingredientId });
        continue;
      }
      for (const allergy of mappedAllergies) {
        if (allergy.ingredient.toString() !== ingredientId) continue;
        findings.push({
          medicineId: medicine._id,
          medicineName: medicine.name,
          allergyId: allergy._id,
          ingredientId: ingredient._id,
          ingredientName: ingredient.name,
          substance: allergy.substance,
          kind: allergy.kind,
          verificationStatus: allergy.verificationStatus,
          reaction: allergy.reaction,
          message: 'Potential allergy or sensitivity match in simulated data',
        });
      }
    }
  }

  let status = 'clear';
  if (issues.length > 0) status = 'unknown';
  // برابر ID د نورو نیمګړو معلوماتو له امله نه پټوو.
  if (findings.length > 0) status = 'warning';
  return { status, medicines: medicineVersions, allergyVersions, findings, coverage: { complete: issues.length === 0, medicineCount: medicines.length, allergyReportsChecked: allergies.length, issues } };
}

export function evaluateInteractions(medicines, ingredients, rules) {
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
  if (ingredientIds.size > 40) return { message: 'Check at most 40 distinct ingredients at a time' };
  const ids = Array.from(ingredientIds).sort();
  const ingredientsById = new Map();
  for (const ingredient of ingredients) ingredientsById.set(ingredient._id.toString(), ingredient);
  for (const id of ids) {
    if (!isCurrentDemoSource(ingredientsById.get(id))) issues.push({ code: 'unavailable_ingredient', ingredientId: id });
  }

  // د بېلابېلو دواوو او د یوې مرکبې دوا د اجزاوو ټولې جوړې ګورو.
  const pairs = [];
  for (let first = 0; first < ids.length; first++) {
    for (let second = first + 1; second < ids.length; second++) {
      const key = ids[first] + ':' + ids[second];
      pairs.push({ key, ids: [ids[first], ids[second]] });
    }
  }
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
  return { status, medicines: medicineVersions, findings, rulesUsed, coverage: { complete: issues.length === 0, ingredientCount: ids.length, pairCount: pairs.length, coveredPairCount: rulesUsed.length, missingPairCount, issues } };
}
