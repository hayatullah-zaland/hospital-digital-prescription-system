import PatientAllergy from '../models/PatientAllergy.js';
import Medicine from '../models/Medicine.js';
import Ingredient, { catalogSource } from '../models/Ingredient.js';

function isCurrentDemoSource(record) {
  if (!record) return false;
  return record.mode === catalogSource.mode && record.source === catalogSource.source && record.sourceVersion === catalogSource.sourceVersion;
}

export async function checkPatientAllergies(req, res) {
  try {
    // یوازې موجودې فعالې دواوې اخلو؛ client د دوا اجزا نه ټاکي.
    const medicines = await Medicine.find({ _id: { $in: req.allergyMedicineIds }, isActive: true }).sort({ _id: 1 }).lean();
    if (medicines.length !== req.allergyMedicineIds.length) {
      return res.status(404).json({ message: 'One or more active medicines were not found' });
    }
    const allergies = await PatientAllergy.find({ patient: req.params.patientId, verificationStatus: { $ne: 'refuted' } })
      .select('substance ingredient ingredientSnapshot kind reaction verificationStatus version')
      .sort({ _id: 1 }).limit(201).lean();
    const issues = [];
    if (allergies.length > 200) {
      issues.push({ code: 'allergy_limit_exceeded' });
      allergies.pop();
    }
    if (allergies.length === 0) issues.push({ code: 'no_active_allergy_reports' });

    // اجزا په یوه query کې لولو، بیا یې د ID له مخې پیدا کوو.
    const ingredientIds = new Set();
    for (const medicine of medicines) {
      if (!Array.isArray(medicine.ingredients)) continue;
      for (const id of medicine.ingredients) ingredientIds.add(id.toString());
    }
    for (const allergy of allergies) {
      if (allergy.ingredient) ingredientIds.add(allergy.ingredient.toString());
    }
    const ingredients = await Ingredient.find({ _id: { $in: Array.from(ingredientIds) } }).lean();
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
    res.json({
      check: {
        type: 'allergy_preview',
        mode: catalogSource.mode,
        status,
        patientId: req.params.patientId,
        appointmentId: req.allergyAppointment,
        checkedBy: req.user._id,
        checkedAt: new Date(),
        medicines: medicineVersions,
        allergyVersions,
        findings,
        coverage: { complete: issues.length === 0, medicineCount: medicines.length, allergyReportsChecked: allergies.length, issues },
      },
      catalog: catalogSource,
    });
  } catch (error) {
    res.status(500).json({ message: 'Unable to check patient allergies. Please try again' });
  }
}
