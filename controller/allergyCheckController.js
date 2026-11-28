import { evaluateAllergies } from './medicationSafety.js';
import PatientAllergy from '../models/PatientAllergy.js';
import Medicine from '../models/Medicine.js';
import Ingredient, { catalogSource } from '../models/Ingredient.js';

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
    const ingredientIds = new Set();
    for (const medicine of medicines) {
      if (!Array.isArray(medicine.ingredients)) continue;
      for (const id of medicine.ingredients) ingredientIds.add(id.toString());
    }
    for (const allergy of allergies) {
      if (allergy.ingredient) ingredientIds.add(allergy.ingredient.toString());
    }
    const ingredients = await Ingredient.find({ _id: { $in: Array.from(ingredientIds) } }).lean();
    const result = evaluateAllergies(medicines, allergies, ingredients);
    const { status, allergyVersions, findings, coverage } = result;
    const medicineVersions = result.medicines;
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
        coverage,
      },
      catalog: catalogSource,
    });
  } catch (error) {
    res.status(500).json({ message: 'Unable to check patient allergies. Please try again' });
  }
}
