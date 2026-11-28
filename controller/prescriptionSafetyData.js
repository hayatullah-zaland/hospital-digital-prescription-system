import { createHash } from 'node:crypto';
import Medicine from '../models/Medicine.js';
import Ingredient, { catalogSource } from '../models/Ingredient.js';
import PatientAllergy from '../models/PatientAllergy.js';
import KnowledgeRule, { interactionSource } from '../models/KnowledgeRule.js';
import { safetyAlgorithmVersion } from '../models/SafetyCheck.js';

export function hashSafetyValue(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

// ثابت field ترتیب د JSON د keys له ترتیب سره د hash بدلېدل بندوي.
export function prescriptionSafetyContent(prescription) {
  const medicines = [];
  for (const line of prescription.medicines) {
    const ingredients = [];
    for (const ingredient of line.ingredients || []) {
      ingredients.push({ ingredient: String(ingredient.ingredient), code: ingredient.code, name: ingredient.name });
    }
    medicines.push({
      medicine: String(line.medicine), catalogVersion: line.catalogVersion,
      code: line.code, name: line.name, strength: line.strength, form: line.form, ingredients,
      dosage: line.dosage, frequency: line.frequency, duration: line.duration, instructions: line.instructions,
    });
  }
  const source = prescription.catalog || {};
  return {
    patient: String(prescription.patient), doctor: String(prescription.doctor), appointment: String(prescription.appointment),
    format: prescription.format, status: prescription.status, revision: prescription.revision,
    diagnosis: prescription.diagnosis, notes: prescription.notes, medicines,
    catalog: { mode: source.mode, source: source.source, sourceVersion: source.sourceVersion, notice: source.notice },
  };
}

export async function loadPrescriptionSafetyData(prescription) {
  const medicineIds = [];
  for (const line of prescription.medicines) medicineIds.push(line.medicine);
  const medicines = await Medicine.find({ _id: { $in: medicineIds } })
    .select('code name strength form ingredients isActive version mode source sourceVersion').sort({ _id: 1 }).lean();
  const allergyFilter = { patient: prescription.patient, verificationStatus: { $ne: 'refuted' } };
  const allergies = await PatientAllergy.find(allergyFilter)
    .select('substance ingredient ingredientSnapshot kind reaction verificationStatus version').sort({ _id: 1 }).limit(201).lean();
  const totalAllergies = await PatientAllergy.countDocuments(allergyFilter);
  const medicineIngredients = new Set();
  for (const medicine of medicines) {
    if (!Array.isArray(medicine.ingredients)) continue;
    for (const id of medicine.ingredients) medicineIngredients.add(String(id));
  }
  const ingredientIds = new Set(medicineIngredients);
  for (const allergy of allergies) {
    if (allergy.ingredient) ingredientIds.add(String(allergy.ingredient));
  }
  const ingredients = await Ingredient.find({ _id: { $in: Array.from(ingredientIds) } })
    .select('code name mode source sourceVersion').sort({ _id: 1 }).lean();
  const ids = Array.from(medicineIngredients).sort();
  const pairKeys = [];
  // له حد اوښتو کې نورې جوړې نه جوړوو؛ snapshot به stale وګڼل شي.
  if (ids.length <= 40) {
    for (let first = 0; first < ids.length; first++) {
      for (let second = first + 1; second < ids.length; second++) pairKeys.push(ids[first] + ':' + ids[second]);
    }
  }
  const rules = await KnowledgeRule.find({ pairKey: { $in: pairKeys } })
    .select('kind ingredients pairKey outcome mode source sourceVersion').sort({ _id: 1 }).lean();
  return { algorithmVersion: safetyAlgorithmVersion, catalog: catalogSource, knowledge: interactionSource, medicines, ingredients, allergies, totalAllergies, rules };
}

function isCurrentSource(record) {
  if (!record) return false;
  return record.mode === catalogSource.mode && record.source === catalogSource.source && record.sourceVersion === catalogSource.sourceVersion;
}

// د زړې کاپۍ پر ځای بله نوې دوا په پټه نه چک کوو؛ doctor دې refresh وکړي.
export function hasCurrentMedicineSnapshots(prescription, data) {
  if (!isCurrentSource(prescription.catalog)) return false;
  if (prescription.medicines.length < 1 || prescription.medicines.length > 20) return false;
  const medicinesById = new Map();
  for (const medicine of data.medicines) medicinesById.set(String(medicine._id), medicine);
  const ingredientsById = new Map();
  for (const ingredient of data.ingredients) ingredientsById.set(String(ingredient._id), ingredient);
  const seenMedicines = new Set();
  const allIngredients = new Set();
  for (const line of prescription.medicines) {
    const id = String(line.medicine);
    if (seenMedicines.has(id)) return false;
    seenMedicines.add(id);
    const medicine = medicinesById.get(id);
    if (!isCurrentSource(medicine) || !medicine.isActive) return false;
    if (!Number.isSafeInteger(line.catalogVersion) || line.catalogVersion !== medicine.version) return false;
    if (line.name !== medicine.name || line.code !== medicine.code || line.strength !== medicine.strength || line.form !== medicine.form) return false;
    if (!Array.isArray(medicine.ingredients) || medicine.ingredients.length < 1 || medicine.ingredients.length > 10 || !Array.isArray(line.ingredients)) return false;
    const ids = new Set();
    for (const ingredientId of medicine.ingredients) ids.add(String(ingredientId));
    if (ids.size !== line.ingredients.length) return false;
    const snapshotIds = new Set();
    for (const snapshot of line.ingredients) {
      const ingredientId = String(snapshot.ingredient);
      if (!ids.has(ingredientId) || snapshotIds.has(ingredientId)) return false;
      snapshotIds.add(ingredientId);
      allIngredients.add(ingredientId);
      const ingredient = ingredientsById.get(ingredientId);
      if (!isCurrentSource(ingredient) || ingredient.code !== snapshot.code || ingredient.name !== snapshot.name) return false;
    }
  }
  return allIngredients.size <= 40;
}
