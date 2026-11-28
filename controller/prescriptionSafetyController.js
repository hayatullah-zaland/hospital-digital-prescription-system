import Prescription from '../models/Prescription.js';
import Appointment from '../models/Appointment.js';
import Patient from '../models/Patient.js';
import SafetyCheck, { safetyAlgorithmVersion } from '../models/SafetyCheck.js';
import { evaluateAllergies, evaluateInteractions } from './medicationSafety.js';
import { hashSafetyValue, prescriptionSafetyContent, loadPrescriptionSafetyData, hasCurrentMedicineSnapshots } from './prescriptionSafetyData.js';

// یوازې لیکونکی ډاکټر د هماغه روان ملاقات نسخه کتلای شي.
async function findOwnDraft(id, doctor) {
  const prescription = await Prescription.findOne({ _id: id, doctor }).lean();
  if (!prescription) return { status: 404, message: 'Prescription not found' };
  if (prescription.format !== 'catalog_v1' || prescription.status !== 'draft') {
    return { status: 409, message: 'A catalog prescription draft is required' };
  }
  const appointment = await Appointment.exists({ _id: prescription.appointment, doctor, patient: prescription.patient, status: 'in_progress', startAt: { $lte: new Date() } });
  if (!appointment) return { status: 403, message: 'Your own reached in-progress appointment is required' };
  if (!(await Patient.exists({ _id: prescription.patient }))) return { status: 404, message: 'Patient record not found' };
  return { prescription };
}

function checkFreshness(check, prescription, data) {
  const reasons = [];
  if (check.revision !== prescription.revision) reasons.push('revision_changed');
  if (check.contentHash !== hashSafetyValue(prescriptionSafetyContent(prescription))) reasons.push('prescription_content_changed');
  if (check.inputHash !== hashSafetyValue(data)) reasons.push('safety_inputs_changed');
  if (!hasCurrentMedicineSnapshots(prescription, data)) reasons.push('catalog_snapshots_outdated');
  if (check.algorithmVersion !== safetyAlgorithmVersion) reasons.push('algorithm_changed');
  if (reasons.length > 0) return { state: 'stale', reasons };
  if (!check.coverageComplete) return { state: 'incomplete', reasons: ['incomplete_coverage'] };
  return { state: 'current', reasons };
}

export async function createPrescriptionSafetyCheck(req, res) {
  try {
    const result = await findOwnDraft(req.params.id, req.user._id);
    if (result.message) return res.status(result.status).json({ message: result.message });
    const prescription = result.prescription;
    if (prescription.revision !== req.body.revision) return res.status(409).json({ message: 'Reload the current prescription revision' });
    const data = await loadPrescriptionSafetyData(prescription);
    if (!hasCurrentMedicineSnapshots(prescription, data)) return res.status(409).json({ message: 'Refresh draft medicine snapshots before checking safety' });
    const contentSnapshot = prescriptionSafetyContent(prescription);
    const contentHash = hashSafetyValue(contentSnapshot);
    const inputHash = hashSafetyValue(data);
    const allergy = evaluateAllergies(data.medicines, data.allergies, data.ingredients);
    const interaction = evaluateInteractions(data.medicines, data.ingredients, data.rules);
    const coverageComplete = allergy.coverage.complete && interaction.coverage.complete;
    let status = 'unknown';
    if (allergy.status === 'warning' || interaction.status === 'warning') status = 'warning';
    else if (allergy.status === 'clear' && interaction.status === 'clear' && coverageComplete) status = 'clear';

    // د محاسبې پر مهال بدلون شوی وي، پخوانۍ پایله نه ساتو.
    const latest = await findOwnDraft(req.params.id, req.user._id);
    if (latest.message) return res.status(latest.status).json({ message: latest.message });
    const latestData = await loadPrescriptionSafetyData(latest.prescription);
    if (hashSafetyValue(prescriptionSafetyContent(latest.prescription)) !== contentHash || hashSafetyValue(latestData) !== inputHash) {
      return res.status(409).json({ message: 'Safety inputs changed. Reload and check again' });
    }
    const safetyCheck = await SafetyCheck.create({
      prescription: prescription._id, patient: prescription.patient, doctor: prescription.doctor,
      appointment: prescription.appointment, revision: prescription.revision,
      contentHash, inputHash, status, coverageComplete, contentSnapshot, inputSnapshot: data,
      allergy, interaction, checkedBy: req.user._id,
    });
    res.status(201).json({ safetyCheck, freshness: checkFreshness(safetyCheck, latest.prescription, latestData), usableForSigning: false });
  } catch (error) {
    res.status(500).json({ message: 'Unable to check prescription safety. Please try again' });
  }
}

export async function getPrescriptionSafetyCheck(req, res) {
  try {
    const result = await findOwnDraft(req.params.id, req.user._id);
    if (result.message) return res.status(result.status).json({ message: result.message });
    const filter = { prescription: result.prescription._id, doctor: req.user._id };
    if (req.params.checkId) filter._id = req.params.checkId;
    const safetyCheck = await SafetyCheck.findOne(filter).sort({ createdAt: -1, _id: -1 }).lean();
    if (!safetyCheck) return res.status(404).json({ message: 'Safety check not found' });
    const data = await loadPrescriptionSafetyData(result.prescription);
    res.json({ safetyCheck, freshness: checkFreshness(safetyCheck, result.prescription, data), usableForSigning: false });
  } catch (error) {
    res.status(500).json({ message: 'Unable to read prescription safety. Please try again' });
  }
}
