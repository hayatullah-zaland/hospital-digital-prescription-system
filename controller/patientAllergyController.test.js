import assert from 'node:assert/strict';
import { before, beforeEach, after, test } from 'node:test';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { once } from 'node:events';
import express from 'express';
import mongoose from 'mongoose';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import AuthSession from '../models/AuthSession.js';
import Patient from '../models/Patient.js';
import Doctor from '../models/Doctor.js';
import Appointment from '../models/Appointment.js';
import PatientAllergy from '../models/PatientAllergy.js';
import Ingredient, { catalogSource } from '../models/Ingredient.js';
import Medicine from '../models/Medicine.js';
import authRoutes from '../routes/authRoutes.js';
import patientRoutes from '../routes/patientRoutes.js';
import appointmentRoutes from '../routes/appointmentRoutes.js';
import { handleJsonErrors } from '../middleware/jsonErrorHandler.js';

// دا ازموینې خپل موقتي MongoDB لري؛ د پروژې .env او عادي DB نه کاروي.
const previousSecret = process.env.JWT_SECRET;
const password = 'ExamplePassphrase123!';
const users = {};
const tokens = {};
const patients = [];
const appointments = {};
let ingredients;
let databaseDirectory;
let mongoProcess;
let server;
let baseUrl;

async function request(method, route, account, body, expectedStatus) {
  const headers = {};
  if (account) headers.Authorization = 'Bearer ' + (tokens[account] || account);
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(baseUrl + route, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await response.json();
  assert.equal(response.headers.get('cache-control'), 'no-store');
  if (expectedStatus !== undefined) assert.equal(response.status, expectedStatus, `${method} ${route}: ${JSON.stringify(data)}`);
  return { httpStatus: response.status, ...data };
}

function route(patientIndex = 0, id) {
  let result = `/api/patients/${patients[patientIndex].id}/allergies`;
  if (id) result += '/' + id;
  return result;
}

function details() {
  return { substance: '  Fictional   Substance A  ', kind: 'allergy', reaction: '  Fictional itching  ', source: 'patient_reported', notes: '  Fictional test report  ' };
}

function change(allergy, fields) {
  return { version: allergy.version, reason: 'Fictional correction reason', ...fields };
}

async function createAllergy(body = details(), patientIndex = 0, account = 'doctor') {
  const result = await request('POST', route(patientIndex), account, body, 201);
  return result.allergy;
}

async function checkAllEndpoints(account, expected, patientIndex = 0) {
  const id = new mongoose.Types.ObjectId().toString();
  await request('POST', route(patientIndex), account, details(), expected);
  await request('GET', route(patientIndex), account, undefined, expected);
  await request('GET', route(patientIndex, id), account, undefined, expected);
  await request('PATCH', route(patientIndex, id), account, change({ version: 0 }, { notes: 'Fictional update' }), expected);
  await request('POST', route(patientIndex) + '/check', account, { medicineIds: [id] }, expected);
}

async function createCheckMedicine(ingredientIds = [ingredients[0]._id], code = 'DEMO-CHECK-A') {
  return Medicine.create({ code, name: 'Fictional ' + code, strength: '10 demo units', form: 'tablet', ingredients: ingredientIds, createdBy: users.hospital_admin._id, updatedBy: users.hospital_admin._id });
}

async function checkAllergies(medicineIds, patientIndex = 0) {
  const result = await request('POST', route(patientIndex) + '/check', 'doctor', { medicineIds }, 200);
  assert.deepEqual(result.catalog, catalogSource);
  assert.equal(result.check.mode, 'simulated');
  return result.check;
}

before(async () => {
  process.env.JWT_SECRET = 'patient-allergy-tests-only-secret';
  databaseDirectory = await mkdtemp(path.join(tmpdir(), 'prescription-allergy-tests-'));
  const probe = net.createServer();
  probe.listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const mongoPort = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  mongoProcess = spawn(process.env.MONGOD_BINARY || 'mongod', [
    '--dbpath', databaseDirectory, '--bind_ip', '127.0.0.1', '--port', String(mongoPort),
    '--quiet', '--logpath', path.join(databaseDirectory, 'mongod.log'),
  ], { windowsHide: true, stdio: 'ignore' });
  await once(mongoProcess, 'spawn');
  await mongoose.connect(`mongodb://127.0.0.1:${mongoPort}/patient_allergy_tests`, { serverSelectionTimeoutMS: 15000 });
  await Promise.all([User.init(), AuthSession.init(), Doctor.init(), Appointment.init(), PatientAllergy.init(), Ingredient.init(), Medicine.init()]);
  const app = express();
  app.use(express.json());
  app.use(handleJsonErrors);
  app.use('/api/auth', authRoutes);
  app.use('/api/patients', patientRoutes);
  app.use('/api/appointments', appointmentRoutes);
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  const passwordHash = await bcrypt.hash(password, 4);
  for (const key of [...User.schema.path('role').enumValues, 'otherDoctor', 'profilelessDoctor']) {
    users[key] = await User.create({ name: 'Fictional ' + key, email: key + '@example.test', password: passwordHash, role: key.endsWith('Doctor') ? 'doctor' : key });
    const signedIn = await request('POST', '/api/auth/signin', null, { email: users[key].email, password }, 200);
    tokens[key] = signedIn.token;
  }
  for (let index = 0; index < 3; index++) {
    patients.push(await Patient.create({ name: 'Fictional Patient ' + index, dateOfBirth: new Date('1995-06-15'), phone: '1234567', address: 'Private address', createdBy: users.receptionist._id }));
  }
}, { timeout: 30000 });

beforeEach(async () => {
  await PatientAllergy.deleteMany({});
  await Medicine.deleteMany({});
  await Ingredient.deleteMany({});
  ingredients = await Ingredient.create([
    { code: 'DEMO-I-A', name: 'Fictional Component A', createdBy: users.hospital_admin._id },
    { code: 'DEMO-I-B', name: 'Fictional Component B', createdBy: users.hospital_admin._id },
  ]);
  await Appointment.deleteMany({});
  await Doctor.deleteMany({});
  for (const key of ['doctor', 'otherDoctor']) {
    await Doctor.create({ user: users[key]._id, specialization: 'Demo Medicine', department: 'Demo Clinic', registrationNumber: 'DEMO-' + key, createdBy: users.hospital_admin._id });
  }
  let day = 1;
  for (const [key, account, patientIndex] of [['own', 'doctor', 0], ['other', 'otherDoctor', 1], ['anotherPatient', 'doctor', 2]]) {
    const startAt = new Date(Date.now() - day * 86400000);
    appointments[key] = await Appointment.create({ doctor: users[account]._id, patient: patients[patientIndex]._id, startAt, endAt: new Date(startAt.getTime() + 1800000), status: 'in_progress', createdBy: users.receptionist._id });
    day++;
  }
});

after(async () => {
  if (server) {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
  await mongoose.disconnect();
  if (mongoProcess?.pid && mongoProcess.exitCode === null) {
    const stopped = once(mongoProcess, 'exit');
    mongoProcess.kill();
    await stopped;
  }
  if (databaseDirectory) {
    assert.equal(path.dirname(path.resolve(databaseDirectory)), path.resolve(tmpdir()));
    assert.ok(path.basename(databaseDirectory).startsWith('prescription-allergy-tests-'));
    await rm(databaseDirectory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
  if (previousSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = previousSecret;
});

test('creation stores a trimmed unconfirmed report with server-owned identity and its initial snapshot', async () => {
  const allergy = await createAllergy();
  assert.equal(allergy.patient, patients[0].id);
  assert.equal(allergy.substance, 'Fictional Substance A');
  assert.equal(allergy.reaction, 'Fictional itching');
  assert.equal(allergy.notes, 'Fictional test report');
  assert.equal(allergy.verificationStatus, 'unconfirmed');
  assert.equal(allergy.recordedBy, users.doctor.id);
  assert.equal(allergy.updatedBy, users.doctor.id);
  assert.equal(allergy.reviewedBy, null);
  assert.equal(allergy.reviewedAt, null);
  assert.equal(allergy.version, 0);
  assert.equal(allergy.substanceKey, undefined);
  assert.ok(allergy.createdAt && allergy.updatedAt);
  assert.equal(allergy.history.length, 1);
  assert.equal(allergy.history[0].action, 'created');
  assert.equal(allergy.history[0].actor, users.doctor.id);
  assert.equal(allergy.history[0].appointment, appointments.own.id);
  assert.equal(allergy.history[0].snapshot.substance, allergy.substance);
  assert.equal(allergy.history[0].snapshot.verificationStatus, 'unconfirmed');
  const saved = await PatientAllergy.findById(allergy._id).select('+substanceKey');
  assert.equal(saved.substanceKey, 'fictional substance a');
});

test('all report sources start unconfirmed and notes are optional', async () => {
  for (const source of ['patient_reported', 'medical_record', 'clinician_observed']) {
    const body = { substance: 'Fictional ' + source, kind: 'sensitivity', reaction: 'Fictional reaction', source, verificationStatus: 'unconfirmed' };
    const allergy = await createAllergy(body);
    assert.equal(allergy.notes, '');
    assert.equal(allergy.verificationStatus, 'unconfirmed');
    assert.equal(allergy.reviewedBy, null);
  }
});

test('list omits history and the duplicate key while detail includes the trace', async () => {
  const allergy = await createAllergy();
  const result = await request('GET', route(), 'doctor', undefined, 200);
  assert.deepEqual(result.pagination, { page: 1, limit: 10, total: 1, totalPages: 1 });
  assert.equal(result.allergies[0]._id, allergy._id);
  assert.equal(result.allergies[0].history, undefined);
  assert.equal(result.allergies[0].substanceKey, undefined);
  assert.equal(result.allergies[0].version, 0);
  const detail = await request('GET', route(0, allergy._id), 'doctor', undefined, 200);
  assert.equal(detail.allergy.history.length, 1);
  assert.equal(detail.allergy.substanceKey, undefined);
});

test('every allergy endpoint requires a signin session', async () => {
  await checkAllEndpoints(null, 401);
  await checkAllEndpoints('invalid-token', 401);
});

test('expired and logged-out sessions cannot reach any allergy endpoint', async () => {
  const signedIn = await request('POST', '/api/auth/signin', null, { email: users.doctor.email, password }, 200);
  const decoded = jwt.decode(signedIn.token);
  const expiredToken = jwt.sign({ id: users.doctor.id, sid: decoded.sid }, process.env.JWT_SECRET, { algorithm: 'HS256', expiresIn: -1 });
  await checkAllEndpoints(expiredToken, 401);
  await AuthSession.updateOne({ _id: decoded.sid }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
  await checkAllEndpoints(signedIn.token, 401);
  const another = await request('POST', '/api/auth/signin', null, { email: users.doctor.email, password }, 200);
  await request('POST', '/api/auth/logout', another.token, undefined, 200);
  await checkAllEndpoints(another.token, 401);
});

for (const role of ['hospital_admin', 'receptionist', 'hospital_pharmacist', 'external_pharmacist', 'patient']) {
  test(role + ' cannot access the clinical allergy endpoints', async () => {
    await checkAllEndpoints(role, 403);
  });
}

test('an unrelated doctor has no access even if they know an existing allergy ID', async () => {
  const allergy = await createAllergy();
  await checkAllEndpoints('otherDoctor', 403);
  await request('GET', route(0, allergy._id), 'otherDoctor', undefined, 403);
  await request('PATCH', route(0, allergy._id), 'otherDoctor', change(allergy, { notes: 'Unauthorized update' }), 403);
});

test('only an own in-progress visit at a reached start time grants access', async () => {
  for (const status of ['scheduled', 'checked_in', 'completed', 'cancelled', 'no_show']) {
    await Appointment.updateOne({ _id: appointments.own._id }, { $set: { status } });
    await checkAllEndpoints('doctor', 403);
  }
  await Appointment.updateOne({ _id: appointments.own._id }, { $set: { status: 'in_progress', startAt: new Date(Date.now() + 3600000) } });
  await checkAllEndpoints('doctor', 403);
  await Appointment.deleteOne({ _id: appointments.own._id });
  await checkAllEndpoints('doctor', 403);
});

test('inactive and missing doctor profiles deny reads and writes', async () => {
  await Doctor.updateOne({ user: users.doctor._id }, { $set: { isActive: false } });
  await checkAllEndpoints('doctor', 403);
  await checkAllEndpoints('profilelessDoctor', 403);
});

test('completing a visit through its API immediately removes access on subsequent requests', async () => {
  const allergy = await createAllergy();
  await request('PATCH', `/api/appointments/${appointments.own.id}/status`, 'doctor', { status: 'completed' }, 200);
  await checkAllEndpoints('doctor', 403);
  assert.equal(await PatientAllergy.countDocuments({ _id: allergy._id }), 1);
});

test('another doctor treating the patient in a new visit can review earlier reports with their own actor and visit trace', async () => {
  const allergy = await createAllergy();
  await request('PATCH', `/api/appointments/${appointments.own.id}/status`, 'doctor', { status: 'completed' }, 200);
  const startAt = new Date(Date.now() - 3600000);
  const visit = await Appointment.create({ patient: patients[0]._id, doctor: users.otherDoctor._id, startAt, endAt: new Date(startAt.getTime() + 1800000), status: 'in_progress', createdBy: users.receptionist._id });
  const list = await request('GET', route(), 'otherDoctor', undefined, 200);
  assert.equal(list.allergies[0]._id, allergy._id);
  const result = await request('PATCH', route(0, allergy._id), 'otherDoctor', change(allergy, { verificationStatus: 'confirmed' }), 200);
  assert.equal(result.allergy.recordedBy, users.doctor.id);
  assert.equal(result.allergy.updatedBy, users.otherDoctor.id);
  assert.equal(result.allergy.reviewedBy, users.otherDoctor.id);
  assert.equal(result.allergy.history[1].appointment, visit.id);
  assert.equal(result.allergy.history[1].actor, users.otherDoctor.id);
  assert.deepEqual(result.allergy.history[0], allergy.history[0]);
});

test('invalid and nonexistent patient IDs produce controlled errors', async () => {
  for (const [id, expected] of [['bad-id', 400], [new mongoose.Types.ObjectId().toString(), 404]]) {
    const base = `/api/patients/${id}/allergies`;
    await request('GET', base, 'doctor', undefined, expected);
    await request('POST', base, 'doctor', details(), expected);
    await request('GET', base + '/' + new mongoose.Types.ObjectId(), 'doctor', undefined, expected);
    await request('PATCH', base + '/' + new mongoose.Types.ObjectId(), 'doctor', change({ version: 0 }, { notes: 'Demo' }), expected);
  }
});

test('an allergy ID cannot escape the patient in the URL even when both patients are treated by this doctor', async () => {
  const allergy = await createAllergy();
  await request('GET', route(2, allergy._id), 'doctor', undefined, 404);
  await request('PATCH', route(2, allergy._id), 'doctor', change(allergy, { notes: 'Wrong patient' }), 404);
  for (const [id, expected] of [['bad-id', 400], [new mongoose.Types.ObjectId().toString(), 404]]) {
    await request('GET', route(0, id), 'doctor', undefined, expected);
    await request('PATCH', route(0, id), 'doctor', change(allergy, { notes: 'Demo' }), expected);
  }
});

test('duplicate matching ignores letter case and repeated whitespace', async () => {
  await createAllergy();
  await request('POST', route(), 'doctor', { ...details(), substance: 'fictional\tSUBSTANCE   a' }, 409);
  assert.equal(await PatientAllergy.countDocuments(), 1);
});

test('simultaneous duplicate reports create one record and one initial history entry', async () => {
  const results = await Promise.all([request('POST', route(), 'doctor', details()), request('POST', route(), 'doctor', details())]);
  assert.deepEqual(results.map(result => result.httpStatus).sort(), [201, 409]);
  const saved = await PatientAllergy.findOne();
  assert.equal(saved.history.length, 1);
  assert.equal(await PatientAllergy.countDocuments(), 1);
});

test('the same text can be recorded for another patient or a different kind', async () => {
  await createAllergy();
  await createAllergy({ ...details(), kind: 'sensitivity' });
  await createAllergy(details(), 2);
  assert.equal(await PatientAllergy.countDocuments(), 3);
});

test('partial updates preserve omitted fields, creator and creation time and append an immutable earlier snapshot', async () => {
  const allergy = await createAllergy();
  const result = await request('PATCH', route(0, allergy._id), 'doctor', change(allergy, { reaction: '  Fictional changed reaction  ', notes: '' }), 200);
  const updated = result.allergy;
  assert.equal(updated.reaction, 'Fictional changed reaction');
  assert.equal(updated.notes, '');
  assert.equal(updated.substance, allergy.substance);
  assert.equal(updated.source, allergy.source);
  assert.equal(updated.kind, allergy.kind);
  assert.equal(updated.patient, allergy.patient);
  assert.equal(updated.recordedBy, allergy.recordedBy);
  assert.equal(updated.createdAt, allergy.createdAt);
  assert.equal(updated.version, 1);
  assert.equal(updated.history.length, 2);
  assert.deepEqual(updated.history[0], allergy.history[0]);
  assert.equal(updated.history[1].reason, 'Fictional correction reason');
  assert.equal(updated.history[1].snapshot.reaction, updated.reaction);
  assert.equal(updated.substanceKey, undefined);
});

test('confirmation records the reviewer and time without rewriting the source of the report', async () => {
  const allergy = await createAllergy();
  const result = await request('PATCH', route(0, allergy._id), 'doctor', change(allergy, { verificationStatus: 'confirmed' }), 200);
  assert.equal(result.allergy.verificationStatus, 'confirmed');
  assert.equal(result.allergy.source, 'patient_reported');
  assert.equal(result.allergy.reviewedBy, users.doctor.id);
  assert.ok(result.allergy.reviewedAt);
  assert.equal(result.allergy.history[1].snapshot.reviewedBy, users.doctor.id);
  assert.equal(result.allergy.history[1].snapshot.reviewedAt, result.allergy.reviewedAt);
});

test('refuted reports stay visible and can be reviewed again through a traced update', async () => {
  const allergy = await createAllergy();
  const refuted = await request('PATCH', route(0, allergy._id), 'doctor', change(allergy, { verificationStatus: 'refuted' }), 200);
  const list = await request('GET', route(), 'doctor', undefined, 200);
  assert.equal(list.allergies[0].verificationStatus, 'refuted');
  await request('POST', route(), 'doctor', details(), 409);
  const reopened = await request('PATCH', route(0, allergy._id), 'doctor', change(refuted.allergy, { verificationStatus: 'unconfirmed' }), 200);
  assert.equal(reopened.allergy.reviewedBy, null);
  assert.equal(reopened.allergy.reviewedAt, null);
  assert.equal(reopened.allergy.history.length, 3);
  assert.equal(reopened.allergy.history[1].snapshot.verificationStatus, 'refuted');
});

test('changing clinical details resets an earlier review unless the doctor explicitly reviews the new content', async () => {
  for (const fields of [{ substance: 'Fictional different substance' }, { kind: 'sensitivity' }, { reaction: 'Fictional different reaction' }, { source: 'medical_record' }]) {
    await PatientAllergy.deleteMany({});
    const allergy = await createAllergy();
    const confirmed = await request('PATCH', route(0, allergy._id), 'doctor', change(allergy, { verificationStatus: 'confirmed' }), 200);
    const changed = await request('PATCH', route(0, allergy._id), 'doctor', change(confirmed.allergy, fields), 200);
    assert.equal(changed.allergy.verificationStatus, 'unconfirmed');
    assert.equal(changed.allergy.reviewedBy, null);
    assert.equal(changed.allergy.reviewedAt, null);
    assert.equal(changed.allergy.history[1].snapshot.verificationStatus, 'confirmed');
    const reviewed = await request('PATCH', route(0, allergy._id), 'doctor', change(changed.allergy, { reaction: 'Fictional reviewed change', verificationStatus: 'confirmed' }), 200);
    assert.equal(reviewed.allergy.verificationStatus, 'confirmed');
    assert.equal(reviewed.allergy.reviewedBy, users.doctor.id);
  }
});

test('notes alone preserve the review while no-op requests add no history', async () => {
  const allergy = await createAllergy();
  const confirmed = await request('PATCH', route(0, allergy._id), 'doctor', change(allergy, { verificationStatus: 'confirmed' }), 200);
  const updated = await request('PATCH', route(0, allergy._id), 'doctor', change(confirmed.allergy, { notes: 'Fictional extra note' }), 200);
  assert.equal(updated.allergy.verificationStatus, 'confirmed');
  assert.equal(updated.allergy.reviewedAt, confirmed.allergy.reviewedAt);
  for (const fields of [{ notes: updated.allergy.notes }, { substance: updated.allergy.substance }, { verificationStatus: 'confirmed' }]) {
    await request('PATCH', route(0, allergy._id), 'doctor', change(updated.allergy, fields), 400);
  }
  const saved = await PatientAllergy.findById(allergy._id);
  assert.equal(saved.history.length, 3);
  assert.equal(saved.version, 2);
});

test('renaming to an existing substance rejects the update without changing content or history', async () => {
  await createAllergy();
  const other = await createAllergy({ ...details(), substance: 'Fictional Substance B' });
  const previous = JSON.stringify(await PatientAllergy.findById(other._id).select('+substanceKey').lean());
  await request('PATCH', route(0, other._id), 'doctor', change(other, { substance: 'fictional substance a' }), 409);
  assert.equal(JSON.stringify(await PatientAllergy.findById(other._id).select('+substanceKey').lean()), previous);
});

const invalidClinicalInput = [
  { substance: '' }, { substance: 'x' }, { substance: null }, { substance: {} }, { substance: 'x'.repeat(151) },
  { kind: '' }, { kind: null }, { kind: 'other' },
  { reaction: '' }, { reaction: 'x' }, { reaction: null }, { reaction: [] }, { reaction: 'x'.repeat(501) },
  { source: '' }, { source: null }, { source: 'other' },
  { notes: null }, { notes: [] }, { notes: 'x'.repeat(1001) },
  { verificationStatus: null }, { verificationStatus: [] }, { verificationStatus: 'other' },
];

test('invalid clinical fields are rejected on create and update without modifying stored data', async () => {
  const allergy = await createAllergy();
  const previous = JSON.stringify(await PatientAllergy.findById(allergy._id).lean());
  for (const fields of invalidClinicalInput) {
    await request('POST', route(), 'doctor', { ...details(), ...fields }, 400);
    await request('PATCH', route(0, allergy._id), 'doctor', change(allergy, fields), 400);
  }
  for (const field of ['substance', 'kind', 'reaction', 'source']) {
    const body = details();
    delete body[field];
    await request('POST', route(), 'doctor', body, 400);
  }
  assert.equal(JSON.stringify(await PatientAllergy.findById(allergy._id).lean()), previous);
  assert.equal(await PatientAllergy.countDocuments(), 1);
});

test('new reports cannot forge reviewed status or server-owned fields', async () => {
  for (const fields of [{ verificationStatus: 'confirmed' }, { verificationStatus: 'refuted' }, { patient: patients[1].id }, { recordedBy: users.otherDoctor.id }, { updatedBy: users.otherDoctor.id }, { reviewedBy: users.otherDoctor.id }, { reviewedAt: new Date().toISOString() }, { history: [] }, { substanceKey: 'fake' }, { version: 100 }, { appointmentId: appointments.other.id }, { $set: { verificationStatus: 'confirmed' } }]) {
    await request('POST', route(), 'doctor', { ...details(), ...fields }, 400);
  }
  assert.equal(await PatientAllergy.countDocuments(), 0);
});

test('updates require a reason and version and reject attempts to overwrite identity or history', async () => {
  const allergy = await createAllergy();
  for (const body of [undefined, {}, [], { notes: 'Demo' }, { version: 0, notes: 'Demo' }, { reason: 'Demo reason', notes: 'Demo' }, change(allergy, { notes: 'Demo', reason: '' }), change(allergy, { notes: 'Demo', reason: 'x' }), change(allergy, { notes: 'Demo', reason: null }), change(allergy, { notes: 'Demo', reason: 'x'.repeat(501) }), change(allergy, { notes: 'Demo', version: '0' }), change(allergy, { notes: 'Demo', version: -1 }), change(allergy, { notes: 'Demo', version: 0.5 }), change(allergy, { notes: 'Demo', version: 9007199254740992 }), { version: 0, reason: 'No clinical fields' }]) {
    await request('PATCH', route(0, allergy._id), 'doctor', body, 400);
  }
  for (const fields of [{ patient: patients[1].id }, { recordedBy: users.otherDoctor.id }, { updatedBy: users.otherDoctor.id }, { reviewedBy: users.otherDoctor.id }, { reviewedAt: new Date().toISOString() }, { history: [] }, { createdAt: new Date().toISOString() }, { substanceKey: 'fake' }, { appointmentId: appointments.other.id }, { $set: { verificationStatus: 'confirmed' } }]) {
    await request('PATCH', route(0, allergy._id), 'doctor', change(allergy, { notes: 'Demo', ...fields }), 400);
  }
  assert.equal((await PatientAllergy.findById(allergy._id)).history.length, 1);
});

test('empty and non-object create bodies are rejected', async () => {
  for (const body of [undefined, {}, [], 'text', null]) {
    await request('POST', route(), 'doctor', body, 400);
  }
});

test('malformed JSON receives a safe JSON error without reflecting request contents or a stack trace', async () => {
  const response = await fetch(baseUrl + route(), {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + tokens.doctor, 'Content-Type': 'application/json' },
    body: '{"substance":"Private fictional report",',
  });
  assert.equal(response.status, 400);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await response.json(), { message: 'Please send valid JSON' });
  assert.equal(await PatientAllergy.countDocuments(), 0);
});

test('filters and pagination include refuted reports by default and stay within the URL patient', async () => {
  const first = await createAllergy();
  const second = await createAllergy({ ...details(), substance: 'Fictional Substance B', kind: 'sensitivity' });
  const third = await createAllergy({ ...details(), substance: 'Fictional Substance C' });
  await createAllergy(details(), 2);
  await request('PATCH', route(0, first._id), 'doctor', change(first, { verificationStatus: 'confirmed' }), 200);
  await request('PATCH', route(0, second._id), 'doctor', change(second, { verificationStatus: 'refuted' }), 200);
  const page = await request('GET', route() + '?page=1&limit=1', 'doctor', undefined, 200);
  assert.equal(page.allergies[0]._id, third._id);
  assert.deepEqual(page.pagination, { page: 1, limit: 1, total: 3, totalPages: 3 });
  for (const [query, total] of [['kind=allergy', 2], ['kind=sensitivity', 1], ['verificationStatus=confirmed', 1], ['verificationStatus=refuted', 1], ['verificationStatus=unconfirmed', 1], ['kind=sensitivity&verificationStatus=confirmed', 0], ['page=10&limit=1', 3]]) {
    const result = await request('GET', route() + '?' + query, 'doctor', undefined, 200);
    assert.equal(result.pagination.total, total);
    if (query.startsWith('page=10')) assert.deepEqual(result.allergies, []);
  }
});

test('invalid query input cannot bypass patient scope or pagination limits', async () => {
  for (const query of ['page=0', 'page=01', 'page=1.5', 'page=x', 'page=1&page=2', 'page=9007199254740992', 'page=9007199254740991&limit=50', 'limit=0', 'limit=51', 'limit=1&limit=2', 'kind=other', 'kind=allergy&kind=sensitivity', 'verificationStatus=other', 'verificationStatus=confirmed&verificationStatus=refuted', 'patientId=' + patients[1].id, 'patient=' + patients[1].id, 'doctorId=' + users.otherDoctor.id, '$where=true']) {
    await request('GET', route() + '?' + query, 'doctor', undefined, 400);
  }
});

test('a stale client version cannot overwrite a newer review or append history', async () => {
  const allergy = await createAllergy();
  const updated = await request('PATCH', route(0, allergy._id), 'doctor', change(allergy, { verificationStatus: 'confirmed' }), 200);
  await request('PATCH', route(0, allergy._id), 'doctor', change(allergy, { reaction: 'Stale fictional edit' }), 409);
  const current = await request('GET', route(0, allergy._id), 'doctor', undefined, 200);
  assert.deepEqual(current.allergy, updated.allergy);
});

test('simultaneous updates from the same version preserve exactly one complete review and its snapshot', async () => {
  const allergy = await createAllergy();
  const results = await Promise.all([
    request('PATCH', route(0, allergy._id), 'doctor', change(allergy, { verificationStatus: 'confirmed' })),
    request('PATCH', route(0, allergy._id), 'doctor', change(allergy, { reaction: 'Concurrent fictional change' })),
  ]);
  assert.deepEqual(results.map(result => result.httpStatus).sort(), [200, 409]);
  const winner = results.find(result => result.httpStatus === 200).allergy;
  const current = await request('GET', route(0, allergy._id), 'doctor', undefined, 200);
  assert.deepEqual(current.allergy, winner);
  assert.equal(winner.history.length, 2);
  assert.equal(winner.version, 1);
  assert.equal(winner.history[1].snapshot.verificationStatus, winner.verificationStatus);
  assert.equal(winner.history[1].snapshot.reaction, winner.reaction);
});

test('a stale loaded document fails optimistic concurrency without losing the saved history', async () => {
  const allergy = await createAllergy();
  const stale = await PatientAllergy.findById(allergy._id);
  await request('PATCH', route(0, allergy._id), 'doctor', change(allergy, { notes: 'Fictional current note' }), 200);
  stale.notes = 'Stale fictional note';
  await assert.rejects(stale.save(), { name: 'VersionError' });
  const current = await PatientAllergy.findById(allergy._id);
  assert.equal(current.notes, 'Fictional current note');
  assert.equal(current.history.length, 2);
});

test('unmapped reports accept omitted or null ingredient IDs and never infer a link from the name', async () => {
  const named = await createAllergy({ ...details(), substance: ingredients[0].name });
  const explicit = await createAllergy({ ...details(), ingredientId: null });
  for (const allergy of [named, explicit]) {
    assert.equal(allergy.ingredient, null);
    assert.equal(allergy.ingredientSnapshot, null);
    assert.equal(allergy.history[0].snapshot.ingredient, null);
    assert.equal(allergy.history[0].snapshot.ingredientSnapshot, null);
  }
});

test('creation persists the ingredient ID and server-owned simulated snapshot in the record and history', async () => {
  const allergy = await createAllergy({ ...details(), ingredientId: ingredients[0].id });
  assert.equal(allergy.ingredient, ingredients[0].id);
  assert.deepEqual(allergy.ingredientSnapshot, { code: ingredients[0].code, name: ingredients[0].name, ...catalogSource });
  assert.equal(allergy.verificationStatus, 'unconfirmed');
  assert.equal(allergy.history[0].snapshot.ingredient, allergy.ingredient);
  assert.deepEqual(allergy.history[0].snapshot.ingredientSnapshot, allergy.ingredientSnapshot);
  const saved = await PatientAllergy.findById(allergy._id);
  assert.equal(saved.ingredient.toString(), ingredients[0].id);
  assert.deepEqual(saved.ingredientSnapshot.toObject(), allergy.ingredientSnapshot);
  const list = await request('GET', route(), 'doctor', undefined, 200);
  assert.equal(list.allergies[0].ingredient, allergy.ingredient);
  assert.deepEqual(list.allergies[0].ingredientSnapshot, allergy.ingredientSnapshot);
  const detail = await request('GET', route(0, allergy._id), 'doctor', undefined, 200);
  assert.deepEqual(detail.allergy, allergy);
});

test('adding a mapping requires reason and version and resets an earlier review', async () => {
  const allergy = await createAllergy();
  const confirmed = await request('PATCH', route(0, allergy._id), 'doctor', change(allergy, { verificationStatus: 'confirmed' }), 200);
  await request('PATCH', route(0, allergy._id), 'doctor', { ingredientId: ingredients[0].id, version: 1 }, 400);
  await request('PATCH', route(0, allergy._id), 'doctor', { ingredientId: ingredients[0].id, reason: 'Fictional mapping' }, 400);
  const result = await request('PATCH', route(0, allergy._id), 'doctor', change(confirmed.allergy, { ingredientId: ingredients[0].id }), 200);
  assert.equal(result.allergy.ingredient, ingredients[0].id);
  assert.equal(result.allergy.version, 2);
  assert.equal(result.allergy.verificationStatus, 'unconfirmed');
  assert.equal(result.allergy.reviewedBy, null);
  assert.equal(result.allergy.reviewedAt, null);
  assert.deepEqual(result.allergy.history.slice(0, 2), confirmed.allergy.history);
  assert.equal(result.allergy.history[2].reason, 'Fictional correction reason');
  assert.equal(result.allergy.history[2].actor, users.doctor.id);
  assert.equal(result.allergy.history[2].appointment, appointments.own.id);
});

test('replacing an ingredient preserves earlier snapshots and resets a refuted review', async () => {
  const allergy = await createAllergy({ ...details(), ingredientId: ingredients[0].id });
  const refuted = await request('PATCH', route(0, allergy._id), 'doctor', change(allergy, { verificationStatus: 'refuted' }), 200);
  const result = await request('PATCH', route(0, allergy._id), 'doctor', change(refuted.allergy, { ingredientId: ingredients[1].id }), 200);
  assert.equal(result.allergy.ingredient, ingredients[1].id);
  assert.equal(result.allergy.ingredientSnapshot.code, ingredients[1].code);
  assert.equal(result.allergy.verificationStatus, 'unconfirmed');
  assert.equal(result.allergy.reviewedBy, null);
  assert.deepEqual(result.allergy.history.slice(0, 2), refuted.allergy.history);
  assert.equal(result.allergy.history[0].snapshot.ingredient, ingredients[0].id);
  assert.equal(result.allergy.history[2].snapshot.ingredient, ingredients[1].id);
  assert.deepEqual(result.allergy.history[2].snapshot.ingredientSnapshot, result.allergy.ingredientSnapshot);
});

test('a doctor may explicitly review a new mapping in the same traced update', async () => {
  const allergy = await createAllergy();
  const result = await request('PATCH', route(0, allergy._id), 'doctor', change(allergy, { ingredientId: ingredients[0].id, verificationStatus: 'confirmed' }), 200);
  assert.equal(result.allergy.verificationStatus, 'confirmed');
  assert.equal(result.allergy.reviewedBy, users.doctor.id);
  assert.ok(result.allergy.reviewedAt);
  assert.equal(result.allergy.history[1].snapshot.ingredient, ingredients[0].id);
  assert.equal(result.allergy.history[1].snapshot.reviewedAt, result.allergy.reviewedAt);
  assert.equal(result.allergy.ingredientSnapshot.mode, 'simulated');
});

test('clearing a mapping removes its current snapshot but preserves its earlier history', async () => {
  const allergy = await createAllergy({ ...details(), ingredientId: ingredients[0].id });
  const confirmed = await request('PATCH', route(0, allergy._id), 'doctor', change(allergy, { verificationStatus: 'confirmed' }), 200);
  const result = await request('PATCH', route(0, allergy._id), 'doctor', change(confirmed.allergy, { ingredientId: null }), 200);
  assert.equal(result.allergy.ingredient, null);
  assert.equal(result.allergy.ingredientSnapshot, null);
  assert.equal(result.allergy.verificationStatus, 'unconfirmed');
  assert.equal(result.allergy.reviewedBy, null);
  assert.equal(result.allergy.reviewedAt, null);
  assert.deepEqual(result.allergy.history.slice(0, 2), confirmed.allergy.history);
  assert.equal(result.allergy.history[2].snapshot.ingredient, null);
});

test('omitted mapping and equivalent normalized names preserve the mapping and review', async () => {
  const allergy = await createAllergy({ ...details(), ingredientId: ingredients[0].id });
  const confirmed = await request('PATCH', route(0, allergy._id), 'doctor', change(allergy, { verificationStatus: 'confirmed' }), 200);
  const result = await request('PATCH', route(0, allergy._id), 'doctor', change(confirmed.allergy, { notes: 'Fictional note', substance: '  Fictional   Substance A  ' }), 200);
  assert.equal(result.allergy.ingredient, ingredients[0].id);
  assert.deepEqual(result.allergy.ingredientSnapshot, allergy.ingredientSnapshot);
  assert.equal(result.allergy.verificationStatus, 'confirmed');
  assert.equal(result.allergy.reviewedAt, confirmed.allergy.reviewedAt);
});

test('renaming a substance clears an omitted mapping and accepts an explicitly chosen replacement', async () => {
  const allergy = await createAllergy({ ...details(), ingredientId: ingredients[0].id });
  const renamed = await request('PATCH', route(0, allergy._id), 'doctor', change(allergy, { substance: 'Fictional renamed substance' }), 200);
  assert.equal(renamed.allergy.ingredient, null);
  assert.equal(renamed.allergy.ingredientSnapshot, null);
  assert.equal(renamed.allergy.history[0].snapshot.ingredient, ingredients[0].id);
  const remapped = await request('PATCH', route(0, allergy._id), 'doctor', change(renamed.allergy, { substance: 'Fictional newly mapped substance', ingredientId: ingredients[1].id }), 200);
  assert.equal(remapped.allergy.ingredient, ingredients[1].id);
  const retained = await request('PATCH', route(0, allergy._id), 'doctor', change(remapped.allergy, { substance: 'Fictional final substance', ingredientId: ingredients[1].id }), 200);
  assert.equal(retained.allergy.ingredient, ingredients[1].id);
  assert.equal(retained.allergy.history[2].snapshot.ingredient, ingredients[1].id);
});

test('invalid ingredient ID types are rejected before any create or update is saved', async () => {
  const allergy = await createAllergy();
  for (const ingredientId of ['', 'bad', ' ' + ingredients[0].id, 1, true, [], {}, { $ne: null }]) {
    await request('POST', route(), 'doctor', { ...details(), ingredientId }, 400);
    await request('PATCH', route(0, allergy._id), 'doctor', change(allergy, { ingredientId }), 400);
  }
  assert.equal(await PatientAllergy.countDocuments(), 1);
  assert.equal((await PatientAllergy.findById(allergy._id)).history.length, 1);
});

test('missing or unsupported-source ingredients return 404 without changing any allergy fields', async () => {
  const allergy = await createAllergy({ ...details(), ingredientId: ingredients[0].id });
  const previous = JSON.stringify(await PatientAllergy.findById(allergy._id).lean());
  const missing = new mongoose.Types.ObjectId().toString();
  // یوازې په جلا test DB کې نامجاز سرچینه تمثیلوو.
  await Ingredient.collection.updateOne({ _id: ingredients[1]._id }, { $set: { mode: 'unverified', source: 'unapproved' } });
  for (const ingredientId of [missing, ingredients[1].id]) {
    await request('POST', route(), 'doctor', { ...details(), substance: 'Fictional new report', ingredientId }, 404);
    await request('PATCH', route(0, allergy._id), 'doctor', change(allergy, { ingredientId, reaction: 'Uncommitted change' }), 404);
  }
  assert.equal(JSON.stringify(await PatientAllergy.findById(allergy._id).lean()), previous);
  assert.equal(await PatientAllergy.countDocuments(), 1);
});

test('clients cannot forge the ingredient reference, snapshot or source metadata', async () => {
  const allergy = await createAllergy();
  for (const field of ['ingredient', 'ingredientSnapshot', 'mode', 'sourceVersion', 'notice', 'catalog', 'mappingStatus', 'mappedBy']) {
    const forged = { [field]: 'forged' };
    await request('POST', route(), 'doctor', { ...details(), ingredientId: ingredients[0].id, ...forged }, 400);
    await request('PATCH', route(0, allergy._id), 'doctor', change(allergy, { ingredientId: ingredients[0].id, ...forged }), 400);
  }
  assert.equal((await PatientAllergy.findById(allergy._id)).ingredient, null);
});

test('equivalent ingredient IDs and clearing an already unmapped report are no-op updates', async () => {
  const mapped = await createAllergy({ ...details(), ingredientId: ingredients[0].id });
  const unmapped = await createAllergy({ ...details(), substance: 'Fictional unmapped report' });
  await request('PATCH', route(0, mapped._id), 'doctor', change(mapped, { ingredientId: ingredients[0].id.toUpperCase() }), 400);
  await request('PATCH', route(0, unmapped._id), 'doctor', change(unmapped, { ingredientId: null }), 400);
  assert.equal((await PatientAllergy.findById(mapped._id)).version, 0);
  assert.equal((await PatientAllergy.findById(unmapped._id)).history.length, 1);
});

test('mapping cannot bypass doctor role, active profile, visit or patient scope', async () => {
  const allergy = await createAllergy();
  for (const account of ['hospital_admin', 'hospital_pharmacist', 'external_pharmacist', 'receptionist', 'patient', 'otherDoctor', 'profilelessDoctor']) {
    await request('POST', route(), account, { ...details(), ingredientId: ingredients[0].id }, 403);
    await request('PATCH', route(0, allergy._id), account, change(allergy, { ingredientId: ingredients[0].id }), 403);
  }
  await request('PATCH', route(2, allergy._id), 'doctor', change(allergy, { ingredientId: ingredients[0].id }), 404);
  await Doctor.updateOne({ user: users.doctor._id }, { $set: { isActive: false } });
  await request('PATCH', route(0, allergy._id), 'doctor', change(allergy, { ingredientId: ingredients[0].id }), 403);
  assert.equal((await PatientAllergy.findById(allergy._id)).ingredient, null);
});

test('stale mapping and concurrent remapping preserve exactly one complete update and snapshot', async () => {
  const allergy = await createAllergy();
  const results = await Promise.all([
    request('PATCH', route(0, allergy._id), 'doctor', change(allergy, { ingredientId: ingredients[0].id, notes: 'Fictional A' })),
    request('PATCH', route(0, allergy._id), 'doctor', change(allergy, { ingredientId: ingredients[1].id, notes: 'Fictional B' })),
  ]);
  assert.deepEqual(results.map(result => result.httpStatus).sort(), [200, 409]);
  const winner = results.find(result => result.httpStatus === 200).allergy;
  await request('PATCH', route(0, allergy._id), 'doctor', change(allergy, { ingredientId: null }), 409);
  const current = await request('GET', route(0, allergy._id), 'doctor', undefined, 200);
  assert.deepEqual(current.allergy, winner);
  assert.equal(winner.version, 1);
  assert.equal(winner.history.length, 2);
  assert.equal(winner.history[1].snapshot.ingredient, winner.ingredient);
  assert.deepEqual(winner.history[1].snapshot.ingredientSnapshot, winner.ingredientSnapshot);
});

test('legacy records read as unmapped without a database rewrite and retain old stored history after mapping', async () => {
  const allergy = await createAllergy({ ...details(), substance: ingredients[0].name });
  const filter = { _id: new mongoose.Types.ObjectId(allergy._id) };
  await PatientAllergy.collection.updateOne(filter, { $unset: { ingredient: '', ingredientSnapshot: '', 'history.0.snapshot.ingredient': '', 'history.0.snapshot.ingredientSnapshot': '' } });
  const legacy = await PatientAllergy.collection.findOne(filter);
  const detail = await request('GET', route(0, allergy._id), 'doctor', undefined, 200);
  assert.equal(detail.allergy.ingredient, null);
  assert.equal(detail.allergy.ingredientSnapshot, null);
  const listed = await request('GET', route(), 'doctor', undefined, 200);
  assert.equal(listed.allergies[0].ingredient, null);
  assert.deepEqual(await PatientAllergy.collection.findOne(filter), legacy);
  const mapped = await request('PATCH', route(0, allergy._id), 'doctor', change(detail.allergy, { ingredientId: ingredients[0].id }), 200);
  assert.equal(mapped.allergy.ingredient, ingredients[0].id);
  const saved = await PatientAllergy.collection.findOne(filter);
  assert.deepEqual(saved.history[0], legacy.history[0]);
  assert.equal(saved.history[1].snapshot.ingredient.toString(), ingredients[0].id);
});

test('allergy preview warns on an exact unconfirmed ingredient match and includes server evidence', async () => {
  const medicine = await createCheckMedicine();
  const allergy = await createAllergy({ ...details(), ingredientId: ingredients[0].id });
  const check = await checkAllergies([medicine.id]);
  assert.equal(check.type, 'allergy_preview');
  assert.equal(check.status, 'warning');
  assert.equal(check.patientId, patients[0].id);
  assert.equal(check.appointmentId, appointments.own.id);
  assert.equal(check.checkedBy, users.doctor.id);
  assert.ok(check.checkedAt);
  assert.deepEqual(check.medicines, [{ medicineId: medicine.id, name: medicine.name, version: 0 }]);
  assert.deepEqual(check.allergyVersions, [{ allergyId: allergy._id, version: 0 }]);
  assert.deepEqual(check.coverage, { complete: true, medicineCount: 1, allergyReportsChecked: 1, issues: [] });
  assert.equal(check.findings.length, 1);
  assert.equal(check.findings[0].medicineId, medicine.id);
  assert.equal(check.findings[0].allergyId, allergy._id);
  assert.equal(check.findings[0].ingredientId, ingredients[0].id);
  assert.equal(check.findings[0].ingredientName, ingredients[0].name);
  assert.equal(check.findings[0].verificationStatus, 'unconfirmed');
  assert.equal(check.findings[0].reaction, allergy.reaction);
});

test('confirmed allergy and sensitivity reports both produce preview findings', async () => {
  const medicine = await createCheckMedicine();
  for (const kind of ['allergy', 'sensitivity']) {
    const allergy = await createAllergy({ ...details(), kind, ingredientId: ingredients[0].id });
    await request('PATCH', route(0, allergy._id), 'doctor', change(allergy, { verificationStatus: 'confirmed' }), 200);
  }
  const check = await checkAllergies([medicine.id]);
  assert.equal(check.findings.length, 2);
  assert.deepEqual(check.findings.map(finding => finding.kind).sort(), ['allergy', 'sensitivity']);
  for (const finding of check.findings) assert.equal(finding.verificationStatus, 'confirmed');
});

test('complete simulated comparison without an exact match returns limited clear status', async () => {
  const medicine = await createCheckMedicine();
  await createAllergy({ ...details(), ingredientId: ingredients[1].id });
  const check = await checkAllergies([medicine.id]);
  assert.equal(check.status, 'clear');
  assert.equal(check.coverage.complete, true);
  assert.deepEqual(check.findings, []);
});

test('no recorded allergy history remains unknown rather than assuming no allergies', async () => {
  const medicine = await createCheckMedicine();
  const check = await checkAllergies([medicine.id]);
  assert.equal(check.status, 'unknown');
  assert.deepEqual(check.coverage.issues, [{ code: 'no_active_allergy_reports' }]);
  assert.equal(check.coverage.complete, false);
});

test('unmapped reports never match by name and prevent a clear result', async () => {
  const medicine = await createCheckMedicine();
  const allergy = await createAllergy({ ...details(), substance: ingredients[0].name });
  const check = await checkAllergies([medicine.id]);
  assert.equal(check.status, 'unknown');
  assert.deepEqual(check.findings, []);
  assert.deepEqual(check.coverage.issues, [{ code: 'unmapped_allergy', allergyId: allergy._id }]);
});

test('a known warning remains visible when another allergy has incomplete mapping', async () => {
  const medicine = await createCheckMedicine();
  const mapped = await createAllergy({ ...details(), ingredientId: ingredients[0].id });
  await createAllergy({ ...details(), substance: 'Fictional unmapped report' });
  const check = await checkAllergies([medicine.id]);
  assert.equal(check.status, 'warning');
  assert.equal(check.coverage.complete, false);
  assert.equal(check.findings[0].allergyId, mapped._id);
  assert.equal(check.coverage.issues[0].code, 'unmapped_allergy');
});

test('refuted reports are excluded but refuted-only history does not prove absence of allergies', async () => {
  const medicine = await createCheckMedicine();
  const allergy = await createAllergy({ ...details(), ingredientId: ingredients[0].id });
  await request('PATCH', route(0, allergy._id), 'doctor', change(allergy, { verificationStatus: 'refuted' }), 200);
  let check = await checkAllergies([medicine.id]);
  assert.equal(check.status, 'unknown');
  assert.equal(check.coverage.issues[0].code, 'no_active_allergy_reports');
  await createAllergy({ ...details(), substance: 'Fictional unrelated report', ingredientId: ingredients[1].id });
  check = await checkAllergies([medicine.id]);
  assert.equal(check.status, 'clear');
  assert.equal(check.allergyVersions.length, 1);
  assert.equal(check.findings.length, 0);
  assert.equal(await PatientAllergy.countDocuments(), 2);
});

test('allergy preview ignores reports belonging to another patient', async () => {
  const medicine = await createCheckMedicine();
  await createAllergy({ ...details(), ingredientId: ingredients[1].id });
  const other = await createAllergy({ ...details(), ingredientId: ingredients[0].id }, 2);
  const check = await checkAllergies([medicine.id]);
  assert.equal(check.status, 'clear');
  assert.equal(check.allergyVersions.length, 1);
  assert.equal(check.allergyVersions.some(entry => entry.allergyId === other._id), false);
});

test('multiple and combination medicines report each matching report without duplicate ingredient findings', async () => {
  const combination = await createCheckMedicine([ingredients[0]._id, ingredients[1]._id]);
  const second = await createCheckMedicine([ingredients[1]._id], 'DEMO-CHECK-B');
  await createAllergy({ ...details(), ingredientId: ingredients[0].id });
  await createAllergy({ ...details(), substance: 'Fictional second report', ingredientId: ingredients[1].id });
  const check = await checkAllergies([combination.id, second.id]);
  assert.equal(check.findings.length, 3);
  assert.equal(check.coverage.medicineCount, 2);
  await Medicine.updateOne({ _id: second._id }, { $set: { ingredients: [ingredients[1]._id, ingredients[1]._id] } });
  const repeated = await checkAllergies([second.id]);
  assert.equal(repeated.findings.length, 1);
});

test('preview uses reports beyond the ordinary list page', async () => {
  const medicine = await createCheckMedicine();
  for (let index = 0; index < 11; index++) {
    await createAllergy({ ...details(), substance: 'Fictional report ' + index, ingredientId: ingredients[1].id });
  }
  await createAllergy({ ...details(), substance: 'Fictional final match', ingredientId: ingredients[0].id });
  const check = await checkAllergies([medicine.id]);
  assert.equal(check.status, 'warning');
  assert.equal(check.coverage.allergyReportsChecked, 12);
  assert.equal(check.findings.length, 1);
});

test('preview is read only and never appends allergy history or changes medicine versions', async () => {
  const medicine = await createCheckMedicine();
  const allergy = await createAllergy({ ...details(), ingredientId: ingredients[0].id });
  const previousAllergy = await PatientAllergy.collection.findOne({ _id: new mongoose.Types.ObjectId(allergy._id) });
  const previousMedicine = await Medicine.collection.findOne({ _id: medicine._id });
  await checkAllergies([medicine.id]);
  assert.deepEqual(await PatientAllergy.collection.findOne({ _id: previousAllergy._id }), previousAllergy);
  assert.deepEqual(await Medicine.collection.findOne({ _id: medicine._id }), previousMedicine);
});

test('a later preview reads current medicine and allergy versions after edits', async () => {
  const medicine = await createCheckMedicine();
  const allergy = await createAllergy({ ...details(), ingredientId: ingredients[0].id });
  assert.equal((await checkAllergies([medicine.id])).status, 'warning');
  medicine.ingredients = [ingredients[1]._id];
  await medicine.save();
  let check = await checkAllergies([medicine.id]);
  assert.equal(check.status, 'clear');
  assert.equal(check.medicines[0].version, 1);
  await request('PATCH', route(0, allergy._id), 'doctor', change(allergy, { ingredientId: ingredients[1].id }), 200);
  check = await checkAllergies([medicine.id]);
  assert.equal(check.status, 'warning');
  assert.equal(check.allergyVersions[0].version, 1);
});

test('missing or inactive medicines reject the entire preview without partial findings', async () => {
  const medicine = await createCheckMedicine();
  const missing = new mongoose.Types.ObjectId().toString();
  for (const medicineIds of [[missing], [medicine.id, missing]]) {
    const result = await request('POST', route() + '/check', 'doctor', { medicineIds }, 404);
    assert.equal(result.check, undefined);
  }
  await Medicine.updateOne({ _id: medicine._id }, { $set: { isActive: false } });
  await request('POST', route() + '/check', 'doctor', { medicineIds: [medicine.id] }, 404);
});

test('preview validates medicine arrays, duplicate IDs, unknown fields and query overrides', async () => {
  const medicine = await createCheckMedicine();
  for (const body of [undefined, null, [], {}, { medicineIds: [] }, { medicineIds: 'bad' }, { medicineIds: ['bad'] }, { medicineIds: [null] }, { medicineIds: [1] }, { medicineIds: [medicine.id, medicine.id.toUpperCase()] }, { medicineIds: Array(21).fill(medicine.id) }]) {
    await request('POST', route() + '/check', 'doctor', body, 400);
  }
  for (const field of ['patientId', 'allergyIds', 'ingredients', 'isActive', 'mode', 'source', 'sourceVersion', 'status', 'checkedBy', 'findings']) {
    await request('POST', route() + '/check', 'doctor', { medicineIds: [medicine.id], [field]: 'forged' }, 400);
  }
  await request('POST', route() + '/check?patientId=' + patients[2].id, 'doctor', { medicineIds: [medicine.id] }, 400);
  assert.equal(await PatientAllergy.countDocuments(), 0);
});

test('uppercase medicine IDs are normalized before database comparison', async () => {
  const medicine = await createCheckMedicine();
  await createAllergy({ ...details(), ingredientId: ingredients[0].id });
  const check = await checkAllergies([medicine.id.toUpperCase()]);
  assert.equal(check.status, 'warning');
  assert.equal(check.medicines[0].medicineId, medicine.id);
});

test('a missing ingredient makes both medicine and allergy coverage incomplete', async () => {
  const medicine = await createCheckMedicine();
  await createAllergy({ ...details(), ingredientId: ingredients[0].id });
  await Ingredient.deleteOne({ _id: ingredients[0]._id });
  const check = await checkAllergies([medicine.id]);
  assert.equal(check.status, 'unknown');
  assert.equal(check.coverage.complete, false);
  assert.deepEqual(check.coverage.issues.map(issue => issue.code).sort(), ['unavailable_allergy_mapping', 'unavailable_medicine_ingredient']);
});

test('empty or absent medicine ingredient lists cannot yield a clear result', async () => {
  const medicine = await createCheckMedicine();
  await createAllergy({ ...details(), ingredientId: ingredients[0].id });
  for (const update of [{ $set: { ingredients: [] } }, { $unset: { ingredients: '' } }]) {
    await Medicine.collection.updateOne({ _id: medicine._id }, update);
    const check = await checkAllergies([medicine.id]);
    assert.equal(check.status, 'unknown');
    assert.equal(check.coverage.issues[0].code, 'missing_medicine_ingredients');
  }
});

test('unsupported medicine provenance or source versions remain unknown', async () => {
  const medicine = await createCheckMedicine();
  await createAllergy({ ...details(), ingredientId: ingredients[0].id });
  for (const fields of [{ mode: 'validated' }, { source: 'unsupported' }, { sourceVersion: 'old-version' }]) {
    await Medicine.collection.updateOne({ _id: medicine._id }, { $set: { mode: catalogSource.mode, source: catalogSource.source, sourceVersion: catalogSource.sourceVersion, ...fields } });
    const check = await checkAllergies([medicine.id]);
    assert.equal(check.status, 'unknown');
    assert.equal(check.coverage.issues[0].code, 'unsupported_medicine_source');
    assert.equal(check.findings.length, 0);
  }
});

test('stale mapping snapshots and changed ingredient identities cannot produce false clear results', async () => {
  const medicine = await createCheckMedicine();
  const allergy = await createAllergy({ ...details(), ingredientId: ingredients[0].id });
  await PatientAllergy.collection.updateOne({ _id: new mongoose.Types.ObjectId(allergy._id) }, { $set: { 'ingredientSnapshot.sourceVersion': 'old-version' } });
  let check = await checkAllergies([medicine.id]);
  assert.equal(check.status, 'unknown');
  assert.equal(check.coverage.issues[0].code, 'unavailable_allergy_mapping');
  await PatientAllergy.collection.updateOne({ _id: new mongoose.Types.ObjectId(allergy._id) }, { $set: { 'ingredientSnapshot.sourceVersion': catalogSource.sourceVersion } });
  await Ingredient.collection.updateOne({ _id: ingredients[0]._id }, { $set: { name: 'Fictional changed catalog identity' } });
  check = await checkAllergies([medicine.id]);
  assert.equal(check.status, 'unknown');
  assert.equal(check.coverage.issues[0].code, 'unavailable_allergy_mapping');
});

test('bounded allergy preview marks truncated coverage and preserves visible warnings', async () => {
  const medicine = await createCheckMedicine();
  const allergy = await createAllergy({ ...details(), ingredientId: ingredients[0].id });
  const template = await PatientAllergy.findById(allergy._id).lean();
  const reports = [];
  for (let index = 0; index < 200; index++) {
    reports.push({ ...template, _id: new mongoose.Types.ObjectId(), substance: 'Fictional bounded report ' + index, substanceKey: 'fictional bounded report ' + index, history: [] });
  }
  await PatientAllergy.insertMany(reports);
  const check = await checkAllergies([medicine.id]);
  assert.equal(check.status, 'warning');
  assert.equal(check.coverage.complete, false);
  assert.equal(check.coverage.allergyReportsChecked, 200);
  assert.equal(check.coverage.issues[0].code, 'allergy_limit_exceeded');
  assert.equal(check.findings.length, 200);
});

test('allergy preview validates patient IDs before looking up medicines', async () => {
  const medicine = await createCheckMedicine();
  for (const [patientId, expected] of [['bad', 400], [new mongoose.Types.ObjectId().toString(), 404]]) {
    await request('POST', `/api/patients/${patientId}/allergies/check`, 'doctor', { medicineIds: [medicine.id] }, expected);
  }
});
