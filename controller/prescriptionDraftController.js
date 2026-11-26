import Prescription from '../models/Prescription.js';
import Appointment from '../models/Appointment.js';
import Patient from '../models/Patient.js';
import Medicine from '../models/Medicine.js';
import Ingredient, { catalogSource } from '../models/Ingredient.js';

function isCurrentDemoSource(record) {
  if (!record) return false;
  return record.mode === catalogSource.mode && record.source === catalogSource.source && record.sourceVersion === catalogSource.sourceVersion;
}

async function findDraftVisit(appointmentId, doctorId) {
  return Appointment.findOne({ _id: appointmentId, doctor: doctorId, status: 'in_progress', startAt: { $lte: new Date() } }).lean();
}

// دواوې او اجزا په دوو queries کې لولو؛ نومونه client نه ټاکي.
async function buildDraftMedicines(lines) {
  const medicineIds = [];
  for (const line of lines) medicineIds.push(line.medicineId.toLowerCase());
  const medicines = await Medicine.find({ _id: { $in: medicineIds }, isActive: true }).lean();
  if (medicines.length !== medicineIds.length) return { status: 404, message: 'One or more active catalog medicines were not found' };
  const medicinesById = new Map();
  const ingredientIds = new Set();
  for (const medicine of medicines) {
    if (!isCurrentDemoSource(medicine) || !Number.isSafeInteger(medicine.version) || medicine.version < 0) {
      return { status: 404, message: 'A current simulated medicine version is required' };
    }
    if (!Array.isArray(medicine.ingredients) || medicine.ingredients.length < 1 || medicine.ingredients.length > 10) {
      return { status: 400, message: 'Each catalog medicine must have 1 to 10 ingredients' };
    }
    medicinesById.set(medicine._id.toString(), medicine);
    for (const id of medicine.ingredients) ingredientIds.add(id.toString());
  }
  if (ingredientIds.size > 40) return { status: 400, message: 'Use at most 40 distinct ingredients in a draft' };
  const ingredients = await Ingredient.find({ _id: { $in: Array.from(ingredientIds) } }).lean();
  if (ingredients.length !== ingredientIds.size) return { status: 404, message: 'One or more catalog ingredients were not found' };
  const ingredientsById = new Map();
  for (const ingredient of ingredients) {
    if (!isCurrentDemoSource(ingredient)) return { status: 404, message: 'Current simulated ingredients are required' };
    ingredientsById.set(ingredient._id.toString(), ingredient);
  }

  const result = [];
  for (const line of lines) {
    const medicine = medicinesById.get(line.medicineId.toLowerCase());
    const snapshots = [];
    const seen = new Set();
    for (const id of medicine.ingredients) {
      if (seen.has(id.toString())) continue;
      seen.add(id.toString());
      const ingredient = ingredientsById.get(id.toString());
      snapshots.push({ ingredient: ingredient._id, code: ingredient.code, name: ingredient.name });
    }
    result.push({
      medicine: medicine._id, catalogVersion: medicine.version,
      name: medicine.name, code: medicine.code, strength: medicine.strength, form: medicine.form,
      ingredients: snapshots,
      dosage: line.dosage.trim(), frequency: line.frequency.trim(), duration: line.duration.trim(),
      instructions: line.instructions === undefined ? '' : line.instructions.trim(),
    });
  }
  return { medicines: result };
}

export async function createPrescriptionDraft(req, res) {
  try {
    const appointment = await findDraftVisit(req.body.appointmentId, req.user._id);
    if (!appointment) return res.status(403).json({ message: 'Your own reached in-progress appointment is required' });
    if (!(await Patient.exists({ _id: appointment.patient }))) return res.status(404).json({ message: 'Patient record not found' });
    const result = await buildDraftMedicines(req.body.medicines);
    if (result.message) return res.status(result.status).json({ message: result.message });
    // هویت، حالت، revision او د سرچینې کاپي سرور ټاکي.
    const prescription = await Prescription.create({
      patient: appointment.patient, doctor: req.user._id, appointment: appointment._id,
      format: 'catalog_v1', status: 'draft', revision: 1, updatedBy: req.user._id,
      diagnosis: req.body.diagnosis.trim(), medicines: result.medicines,
      notes: req.body.notes === undefined ? '' : req.body.notes.trim(), catalog: catalogSource,
    });
    res.status(201).json({ message: 'Prescription draft created successfully', prescription });
  } catch (error) {
    res.status(500).json({ message: 'Unable to create prescription draft. Please try again' });
  }
}

export async function updatePrescriptionDraft(req, res) {
  try {
    const prescription = await Prescription.findOne({ _id: req.params.id, doctor: req.user._id });
    if (!prescription) return res.status(404).json({ message: 'Prescription not found' });
    if (prescription.format !== 'catalog_v1' || prescription.status !== 'draft') {
      return res.status(409).json({ message: 'Only a catalog prescription draft can be edited' });
    }
    if (prescription.revision !== req.body.revision) return res.status(409).json({ message: 'The draft changed. Reload its current revision' });
    const appointment = await findDraftVisit(prescription.appointment, req.user._id);
    if (!appointment || !appointment.patient.equals(prescription.patient)) {
      return res.status(403).json({ message: 'The original appointment must still be your in-progress visit' });
    }
    if (!(await Patient.exists({ _id: prescription.patient }))) return res.status(404).json({ message: 'Patient record not found' });

    let changed = false;
    if (req.body.diagnosis !== undefined && req.body.diagnosis.trim() !== prescription.diagnosis) {
      prescription.diagnosis = req.body.diagnosis.trim();
      changed = true;
    }
    if (req.body.notes !== undefined && req.body.notes.trim() !== prescription.notes) {
      prescription.notes = req.body.notes.trim();
      changed = true;
    }
    if (req.body.medicines !== undefined) {
      const result = await buildDraftMedicines(req.body.medicines);
      if (result.message) return res.status(result.status).json({ message: result.message });
      prescription.medicines = result.medicines;
      prescription.catalog = catalogSource;
      changed = true;
    }
    if (!changed) return res.status(400).json({ message: 'No draft changes were supplied' });
    prescription.revision += 1;
    prescription.updatedBy = req.user._id;
    // optimisticConcurrency د دوو هممهاله saves له ډلې یوازې یو مني.
    await prescription.save();
    res.json({ message: 'Prescription draft updated successfully', prescription });
  } catch (error) {
    if (error.name === 'VersionError') return res.status(409).json({ message: 'The draft changed. Reload its current revision' });
    res.status(500).json({ message: 'Unable to update prescription draft. Please try again' });
  }
}
