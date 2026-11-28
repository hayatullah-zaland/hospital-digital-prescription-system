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
import Ingredient, { catalogSource } from '../models/Ingredient.js';
import Medicine from '../models/Medicine.js';
import Prescription from '../models/Prescription.js';
import SafetyCheck from '../models/SafetyCheck.js';
import PatientAllergy from '../models/PatientAllergy.js';
import KnowledgeRule from '../models/KnowledgeRule.js';
import { hashSafetyValue, prescriptionSafetyContent } from './prescriptionSafetyData.js';
import authRoutes from '../routes/authRoutes.js';
import prescriptionRoutes from '../routes/prescriptionRoutes.js';
import { handleJsonErrors } from '../middleware/jsonErrorHandler.js';

// دا suite یوازې خپل موقتي MongoDB کاروي؛ .env او عادي DB نه لولي.
const previousSecret = process.env.JWT_SECRET;
const password = 'ExamplePassphrase123!';
const users = {};
const tokens = {};
const patients = [];
const visits = {};
let ingredients;
let medicines;
let databaseDirectory;
let mongoProcess;
let server;
let baseUrl;

async function request(method, route, account, body, expected) {
  const headers = {};
  if (account) headers.Authorization = 'Bearer ' + (tokens[account] || account);
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(baseUrl + route, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await response.json();
  assert.equal(response.headers.get('cache-control'), 'no-store');
  if (expected !== undefined) assert.equal(response.status, expected, `${method} ${route}: ${JSON.stringify(data)}`);
  return { httpStatus: response.status, ...data };
}

function line(index = 0) {
  return { medicineId: medicines[index].id, dosage: '  Fictional dosage  ', frequency: '  Fictional frequency  ', duration: '  Fictional duration  ', instructions: '  Fictional instructions  ' };
}

function details(visit = 'own') {
  return { appointmentId: visits[visit].id, diagnosis: '  Fictional diagnosis  ', medicines: [line()], notes: '  Fictional draft notes  ' };
}

async function createDraft(visit = 'own', account = 'doctor') {
  const result = await request('POST', '/api/prescriptions/drafts', account, details(visit), 201);
  return result.prescription;
}

before(async () => {
  process.env.JWT_SECRET = 'prescription-draft-tests-only-secret';
  databaseDirectory = await mkdtemp(path.join(tmpdir(), 'prescription-draft-tests-'));
  const probe = net.createServer();
  probe.listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const mongoPort = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  mongoProcess = spawn(process.env.MONGOD_BINARY || 'mongod', ['--dbpath', databaseDirectory, '--bind_ip', '127.0.0.1', '--port', String(mongoPort), '--quiet', '--logpath', path.join(databaseDirectory, 'mongod.log')], { windowsHide: true, stdio: 'ignore' });
  await once(mongoProcess, 'spawn');
  await mongoose.connect(`mongodb://127.0.0.1:${mongoPort}/prescription_draft_tests`, { serverSelectionTimeoutMS: 15000 });
  await Promise.all([User.init(), AuthSession.init(), Patient.init(), Doctor.init(), Appointment.init(), Ingredient.init(), Medicine.init(), Prescription.init(), SafetyCheck.init(), PatientAllergy.init(), KnowledgeRule.init()]);
  const app = express();
  app.use(express.json());
  app.use(handleJsonErrors);
  app.use('/api/auth', authRoutes);
  app.use('/api/prescriptions', prescriptionRoutes);
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  const hash = await bcrypt.hash(password, 4);
  for (const key of [...User.schema.path('role').enumValues, 'otherDoctor', 'profilelessDoctor']) {
    users[key] = await User.create({ name: 'Fictional ' + key, email: key + '@example.test', password: hash, role: key.endsWith('Doctor') ? 'doctor' : key });
    tokens[key] = (await request('POST', '/api/auth/signin', null, { email: users[key].email, password }, 200)).token;
  }
  for (let index = 0; index < 2; index++) {
    patients.push(await Patient.create({ name: 'Fictional Patient ' + index, dateOfBirth: new Date('1995-06-15'), phone: '1234567', address: 'Private address', createdBy: users.receptionist._id }));
  }
}, { timeout: 30000 });

beforeEach(async () => {
  await SafetyCheck.deleteMany({});
  await PatientAllergy.deleteMany({});
  await KnowledgeRule.deleteMany({});
  await Prescription.deleteMany({});
  await Medicine.deleteMany({});
  await Ingredient.deleteMany({});
  await Doctor.deleteMany({});
  await Appointment.deleteMany({});
  ingredients = await Ingredient.create([
    { code: 'DEMO-DRAFT-I-A', name: 'Fictional Draft Component A', createdBy: users.hospital_admin._id },
    { code: 'DEMO-DRAFT-I-B', name: 'Fictional Draft Component B', createdBy: users.hospital_admin._id },
  ]);
  medicines = [];
  for (let index = 0; index < 2; index++) {
    medicines.push(await Medicine.create({ code: 'DEMO-DRAFT-M-' + index, name: 'Fictional Draft Medicine ' + index, strength: '10 demo units', form: 'tablet', ingredients: [ingredients[index]._id], createdBy: users.hospital_admin._id, updatedBy: users.hospital_admin._id }));
  }
  for (const key of ['doctor', 'otherDoctor']) {
    await Doctor.create({ user: users[key]._id, specialization: 'Demo Medicine', department: 'Demo Clinic', registrationNumber: 'DEMO-' + key, createdBy: users.hospital_admin._id });
  }
  let day = 1;
  for (const [key, account, patientIndex, status] of [['own', 'doctor', 0, 'in_progress'], ['other', 'otherDoctor', 1, 'in_progress'], ['completed', 'doctor', 0, 'completed']]) {
    const startAt = new Date(Date.now() - day * 86400000);
    visits[key] = await Appointment.create({ doctor: users[account]._id, patient: patients[patientIndex]._id, startAt, endAt: new Date(startAt.getTime() + 1800000), status, isBooked: status === 'in_progress', createdBy: users.receptionist._id });
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
    assert.ok(path.basename(databaseDirectory).startsWith('prescription-draft-tests-'));
    await rm(databaseDirectory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
  if (previousSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = previousSecret;
});

test('a catalog draft derives patient and doctor from its visit and stores normalized medicine snapshots', async () => {
  const draft = await createDraft();
  assert.equal(draft.patient, patients[0].id);
  assert.equal(draft.doctor, users.doctor.id);
  assert.equal(draft.appointment, visits.own.id);
  assert.equal(draft.updatedBy, users.doctor.id);
  assert.equal(draft.format, 'catalog_v1');
  assert.equal(draft.status, 'draft');
  assert.equal(draft.revision, 1);
  assert.deepEqual(draft.catalog, catalogSource);
  assert.equal(draft.diagnosis, 'Fictional diagnosis');
  assert.equal(draft.notes, 'Fictional draft notes');
  const snapshot = draft.medicines[0];
  assert.equal(snapshot.medicine, medicines[0].id);
  assert.equal(snapshot.catalogVersion, 0);
  assert.equal(snapshot.name, medicines[0].name);
  assert.equal(snapshot.strength, '10 demo units');
  assert.equal(snapshot.form, 'tablet');
  assert.equal(snapshot.dosage, 'Fictional dosage');
  assert.equal(snapshot.frequency, 'Fictional frequency');
  assert.equal(snapshot.duration, 'Fictional duration');
  assert.deepEqual(snapshot.ingredients, [{ ingredient: ingredients[0].id, code: ingredients[0].code, name: ingredients[0].name }]);
  assert.equal(await Prescription.countDocuments(), 1);
});

test('optional text defaults to empty and catalog names up to 150 characters remain supported', async () => {
  await Medicine.updateOne({ _id: medicines[0]._id }, { $set: { name: 'F'.repeat(150) } });
  const body = details();
  delete body.notes;
  delete body.medicines[0].instructions;
  body.medicines[0].medicineId = medicines[0].id.toUpperCase();
  const { prescription } = await request('POST', '/api/prescriptions/drafts', 'doctor', body, 201);
  assert.equal(prescription.notes, '');
  assert.equal(prescription.medicines[0].instructions, '');
  assert.equal(prescription.medicines[0].name.length, 150);
});

test('draft mutations require a valid current signin session', async () => {
  const draft = await createDraft();
  const login = await request('POST', '/api/auth/signin', null, { email: users.doctor.email, password }, 200);
  const decoded = jwt.decode(login.token);
  const expired = jwt.sign({ id: users.doctor.id, sid: decoded.sid }, process.env.JWT_SECRET, { algorithm: 'HS256', expiresIn: -1 });
  await request('POST', '/api/auth/logout', login.token, undefined, 200);
  for (const account of [null, 'invalid-token', expired, login.token]) {
    await request('POST', '/api/prescriptions/drafts', account, details(), 401);
    await request('PATCH', '/api/prescriptions/' + draft._id, account, { revision: 1, notes: 'Demo change' }, 401);
  }
});

for (const role of ['hospital_admin', 'receptionist', 'hospital_pharmacist', 'external_pharmacist', 'patient']) {
  test(role + ' cannot create or update prescription drafts', async () => {
    const draft = await createDraft();
    await request('POST', '/api/prescriptions/drafts', role, details(), 403);
    await request('PATCH', '/api/prescriptions/' + draft._id, role, { revision: 1, notes: 'Demo change' }, 403);
  });
}

test('inactive and missing doctor profiles prevent all draft writes', async () => {
  const draft = await createDraft();
  await Doctor.updateOne({ user: users.doctor._id }, { $set: { isActive: false } });
  for (const account of ['doctor', 'profilelessDoctor']) {
    await request('POST', '/api/prescriptions/drafts', account, details(), 403);
    await request('PATCH', '/api/prescriptions/' + draft._id, account, { revision: 1, notes: 'Demo change' }, 403);
  }
});

test('only an own reached in-progress visit permits draft creation and later edits', async () => {
  const draft = await createDraft();
  await request('POST', '/api/prescriptions/drafts', 'doctor', details('other'), 403);
  await request('POST', '/api/prescriptions/drafts', 'doctor', details('completed'), 403);
  for (const status of ['scheduled', 'checked_in', 'completed', 'cancelled', 'no_show']) {
    await Appointment.updateOne({ _id: visits.own._id }, { $set: { status } });
    await request('POST', '/api/prescriptions/drafts', 'doctor', details(), 403);
    await request('PATCH', '/api/prescriptions/' + draft._id, 'doctor', { revision: 1, notes: 'Demo change' }, 403);
  }
  await Appointment.updateOne({ _id: visits.own._id }, { $set: { status: 'in_progress', startAt: new Date(Date.now() + 3600000) } });
  await request('POST', '/api/prescriptions/drafts', 'doctor', details(), 403);
  await request('PATCH', '/api/prescriptions/' + draft._id, 'doctor', { revision: 1, notes: 'Demo change' }, 403);
});

test('another doctor cannot modify a draft even with a new active visit for the same patient', async () => {
  const draft = await createDraft();
  await Appointment.updateOne({ _id: visits.other._id }, { $set: { patient: patients[0]._id, startAt: new Date(Date.now() - 3600000) } });
  await request('PATCH', '/api/prescriptions/' + draft._id, 'otherDoctor', { revision: 1, notes: 'Unauthorized change' }, 404);
  await request('GET', '/api/prescriptions/' + draft._id, 'otherDoctor', undefined, 404);
});

test('invalid bodies and forged ownership, lifecycle or catalog metadata are rejected', async () => {
  const body = details();
  for (const invalid of [undefined, null, [], {}, { ...body, appointmentId: 'bad' }, { ...body, diagnosis: '' }, { ...body, diagnosis: 'x'.repeat(501) }, { ...body, notes: null }, { ...body, notes: 'x'.repeat(1001) }]) {
    await request('POST', '/api/prescriptions/drafts', 'doctor', invalid, 400);
  }
  for (const field of ['patientId', 'patient', 'doctor', 'status', 'format', 'revision', 'catalog', 'updatedBy', 'signedAt', 'safetyCheck', 'history']) {
    await request('POST', '/api/prescriptions/drafts', 'doctor', { ...body, [field]: 'forged' }, 400);
  }
  await request('POST', '/api/prescriptions/drafts?patientId=forged', 'doctor', body, 400);
  assert.equal(await Prescription.countDocuments(), 0);
});

test('medicine lines require valid distinct IDs and bounded structured text', async () => {
  const body = details();
  const invalidLines = [[], Array(21).fill(line()), [null], [[]], ['text'], [{ ...line(), medicineId: 'bad' }], [{ ...line(), medicineId: null }], [line(), { ...line(), medicineId: medicines[0].id.toUpperCase() }]];
  for (const field of ['dosage', 'frequency', 'duration']) {
    for (const value of ['', ' ', null, 1, 'x'.repeat(101)]) invalidLines.push([{ ...line(), [field]: value }]);
  }
  for (const field of ['name', 'medicine', 'ingredients', 'catalogVersion', 'strength', 'mode', 'code']) invalidLines.push([{ ...line(), [field]: 'forged' }]);
  invalidLines.push([{ ...line(), instructions: null }], [{ ...line(), instructions: 'x'.repeat(301) }]);
  for (const lines of invalidLines) {
    await request('POST', '/api/prescriptions/drafts', 'doctor', { ...body, medicines: lines }, 400);
  }
  assert.equal(await Prescription.countDocuments(), 0);
});

test('missing or inactive medicines reject the entire draft before saving', async () => {
  const body = details();
  body.medicines.push({ ...line(1), medicineId: new mongoose.Types.ObjectId().toString() });
  await request('POST', '/api/prescriptions/drafts', 'doctor', body, 404);
  await Medicine.updateOne({ _id: medicines[0]._id }, { $set: { isActive: false } });
  await request('POST', '/api/prescriptions/drafts', 'doctor', details(), 404);
  assert.equal(await Prescription.countDocuments(), 0);
});

test('unsupported catalog provenance and missing ingredients cannot produce a draft', async () => {
  await Medicine.collection.updateOne({ _id: medicines[0]._id }, { $set: { sourceVersion: 'old' } });
  await request('POST', '/api/prescriptions/drafts', 'doctor', details(), 404);
  await Medicine.collection.updateOne({ _id: medicines[0]._id }, { $set: { sourceVersion: catalogSource.sourceVersion, ingredients: [] } });
  await request('POST', '/api/prescriptions/drafts', 'doctor', details(), 400);
  await Medicine.collection.updateOne({ _id: medicines[0]._id }, { $set: { ingredients: [ingredients[0]._id] } });
  await Ingredient.collection.updateOne({ _id: ingredients[0]._id }, { $set: { source: 'unsupported' } });
  await request('POST', '/api/prescriptions/drafts', 'doctor', details(), 404);
  await Ingredient.deleteOne({ _id: ingredients[0]._id });
  await request('POST', '/api/prescriptions/drafts', 'doctor', details(), 404);
  assert.equal(await Prescription.countDocuments(), 0);
});

test('partial updates preserve omitted content and advance the draft revision', async () => {
  const draft = await createDraft();
  const { prescription } = await request('PATCH', '/api/prescriptions/' + draft._id, 'doctor', { revision: 1, notes: '  Revised fictional note  ' }, 200);
  assert.equal(prescription.notes, 'Revised fictional note');
  assert.equal(prescription.revision, 2);
  assert.equal(prescription.createdAt, draft.createdAt);
  assert.equal(prescription.patient, draft.patient);
  assert.equal(prescription.appointment, draft.appointment);
  assert.equal(prescription.updatedBy, users.doctor.id);
  assert.deepEqual(prescription.medicines, draft.medicines);
  assert.equal(prescription.diagnosis, draft.diagnosis);
});

test('replacing medicine lines rebuilds all snapshots from current catalog data', async () => {
  const draft = await createDraft();
  await Medicine.updateOne({ _id: medicines[1]._id }, { $set: { name: 'Fictional renamed medicine', ingredients: [ingredients[0]._id, ingredients[1]._id] }, $inc: { version: 1 } });
  const { prescription } = await request('PATCH', '/api/prescriptions/' + draft._id, 'doctor', { revision: 1, diagnosis: '  Revised diagnosis  ', medicines: [line(1)] }, 200);
  assert.equal(prescription.revision, 2);
  assert.equal(prescription.medicines[0].medicine, medicines[1].id);
  assert.equal(prescription.medicines[0].name, 'Fictional renamed medicine');
  assert.equal(prescription.medicines[0].catalogVersion, 1);
  assert.equal(prescription.medicines[0].ingredients.length, 2);
  assert.equal(prescription.diagnosis, 'Revised diagnosis');
});

test('catalog edits do not silently rewrite stored draft snapshots and notes-only edits preserve them', async () => {
  const draft = await createDraft();
  await Medicine.updateOne({ _id: medicines[0]._id }, { $set: { name: 'Fictional new catalog name', isActive: false }, $inc: { version: 1 } });
  const { prescription } = await request('PATCH', '/api/prescriptions/' + draft._id, 'doctor', { revision: 1, notes: 'Changed note with earlier snapshot' }, 200);
  assert.deepEqual(prescription.medicines, draft.medicines);
  await request('PATCH', '/api/prescriptions/' + draft._id, 'doctor', { revision: 2, medicines: [line()] }, 404);
  assert.equal((await Prescription.findById(draft._id)).revision, 2);
});

test('updates reject absent, unsafe or stale revisions and unchanged text', async () => {
  const draft = await createDraft();
  for (const revision of [undefined, null, '1', 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    await request('PATCH', '/api/prescriptions/' + draft._id, 'doctor', { revision, notes: 'Demo change' }, 400);
  }
  await request('PATCH', '/api/prescriptions/' + draft._id, 'doctor', { revision: 1 }, 400);
  await request('PATCH', '/api/prescriptions/' + draft._id, 'doctor', { revision: 1, notes: draft.notes }, 400);
  await request('PATCH', '/api/prescriptions/' + draft._id, 'doctor', { revision: 1, notes: 'New note' }, 200);
  await request('PATCH', '/api/prescriptions/' + draft._id, 'doctor', { revision: 1, diagnosis: 'Stale change' }, 409);
  assert.equal((await Prescription.findById(draft._id)).diagnosis, draft.diagnosis);
});

test('two concurrent edits of one revision allow exactly one complete update', async () => {
  const draft = await createDraft();
  const results = await Promise.all([
    request('PATCH', '/api/prescriptions/' + draft._id, 'doctor', { revision: 1, diagnosis: 'Fictional first change', notes: 'First note' }),
    request('PATCH', '/api/prescriptions/' + draft._id, 'doctor', { revision: 1, diagnosis: 'Fictional second change', notes: 'Second note' }),
  ]);
  assert.deepEqual(results.map(result => result.httpStatus).sort(), [200, 409]);
  const saved = await Prescription.findById(draft._id);
  const winner = results.find(result => result.httpStatus === 200).prescription;
  assert.equal(saved.revision, 2);
  assert.equal(saved.diagnosis, winner.diagnosis);
  assert.equal(saved.notes, winner.notes);
});

test('a stale loaded document fails optimistic concurrency', async () => {
  const draft = await createDraft();
  const first = await Prescription.findById(draft._id);
  const second = await Prescription.findById(draft._id);
  first.notes = 'First stored note';
  first.revision++;
  await first.save();
  second.notes = 'Stale stored note';
  second.revision++;
  await assert.rejects(second.save(), { name: 'VersionError' });
  assert.equal((await Prescription.findById(draft._id)).notes, 'First stored note');
});

test('update allowlists protect patient, visit, author, snapshots and lifecycle state', async () => {
  const draft = await createDraft();
  for (const field of ['patientId', 'patient', 'doctor', 'appointmentId', 'appointment', 'status', 'format', 'catalog', 'updatedBy', 'signedAt', '__v', 'safetyCheck']) {
    await request('PATCH', '/api/prescriptions/' + draft._id, 'doctor', { revision: 1, notes: 'Demo change', [field]: 'forged' }, 400);
  }
  await request('PATCH', '/api/prescriptions/' + draft._id + '?revision=1', 'doctor', { revision: 1, notes: 'Demo change' }, 400);
  assert.equal((await Prescription.findById(draft._id)).revision, 1);
});

test('unknown and malformed draft IDs are controlled errors and non-draft records cannot be edited', async () => {
  await request('PATCH', '/api/prescriptions/bad', 'doctor', { revision: 1, notes: 'Demo change' }, 400);
  await request('PATCH', '/api/prescriptions/' + new mongoose.Types.ObjectId(), 'doctor', { revision: 1, notes: 'Demo change' }, 404);
  const draft = await createDraft();
  await Prescription.collection.updateOne({ _id: new mongoose.Types.ObjectId(draft._id) }, { $set: { status: 'signed' } });
  await request('PATCH', '/api/prescriptions/' + draft._id, 'doctor', { revision: 1, notes: 'Forbidden change' }, 409);
  assert.equal((await Prescription.findById(draft._id)).notes, draft.notes);
});

test('legacy prescription creation and reads remain available without automatic draft migration', async () => {
  const body = { patientId: patients[0].id, diagnosis: 'Fictional legacy diagnosis', medicines: [{ name: 'Fictional old medicine', dosage: 'Demo dose', frequency: 'Demo frequency', duration: 'Demo duration' }] };
  const { prescription } = await request('POST', '/api/prescriptions', 'doctor', body, 201);
  assert.equal(prescription.format, undefined);
  assert.equal(prescription.status, undefined);
  assert.equal(prescription.revision, undefined);
  assert.equal(prescription.catalog, undefined);
  await request('PATCH', '/api/prescriptions/' + prescription._id, 'doctor', { revision: 1, notes: 'Forbidden legacy update' }, 409);
  const beforeRead = await Prescription.collection.findOne({ _id: new mongoose.Types.ObjectId(prescription._id) });
  const result = await request('GET', '/api/prescriptions/' + prescription._id, 'doctor', undefined, 200);
  assert.equal(result.prescription.status, undefined);
  assert.deepEqual(await Prescription.collection.findOne({ _id: beforeRead._id }), beforeRead);
});

test('existing list and detail endpoints include drafts with doctor scope and limited populated identity', async () => {
  const own = await createDraft();
  await createDraft('other', 'otherDoctor');
  const result = await request('GET', '/api/prescriptions?patientId=' + patients[0].id, 'doctor', undefined, 200);
  assert.equal(result.pagination.total, 1);
  assert.equal(result.prescriptions[0]._id, own._id);
  assert.deepEqual(Object.keys(result.prescriptions[0].doctor).sort(), ['_id', 'name']);
  const admin = await request('GET', '/api/prescriptions', 'hospital_admin', undefined, 200);
  assert.equal(admin.pagination.total, 2);
  for (const account of ['receptionist', 'hospital_pharmacist', 'external_pharmacist', 'patient']) {
    await request('GET', '/api/prescriptions/' + own._id, account, undefined, 403);
  }
});

test('catalog failures during a replacement leave the entire draft unchanged', async () => {
  const draft = await createDraft();
  const beforeUpdate = await Prescription.findById(draft._id).lean();
  const body = { revision: 1, diagnosis: 'Unsaved diagnosis', notes: 'Unsaved note', medicines: [{ ...line(), medicineId: new mongoose.Types.ObjectId().toString() }] };
  await request('PATCH', '/api/prescriptions/' + draft._id, 'doctor', body, 404);
  assert.deepEqual(await Prescription.findById(draft._id).lean(), beforeUpdate);
});

test('database failures do not save drafts or expose internal error details', async context => {
  context.mock.method(Medicine, 'find', () => { throw new Error('private database detail'); });
  const result = await request('POST', '/api/prescriptions/drafts', 'doctor', details(), 500);
  assert.equal(result.prescription, undefined);
  assert.equal(JSON.stringify(result).includes('private database detail'), false);
  assert.equal(await Prescription.countDocuments(), 0);
});

test('draft creation bounds ingredient coverage and requires an existing visit patient', async () => {
  const ids = [];
  for (let index = 0; index < 41; index++) ids.push(new mongoose.Types.ObjectId());
  const lines = [];
  for (let index = 0; index < ids.length; index += 10) {
    const medicine = await Medicine.create({ code: 'DEMO-DRAFT-LIMIT-' + index, name: 'Fictional bounded medicine', strength: 'Demo units', form: 'tablet', ingredients: ids.slice(index, index + 10), createdBy: users.hospital_admin._id, updatedBy: users.hospital_admin._id });
    lines.push({ ...line(), medicineId: medicine.id });
  }
  await request('POST', '/api/prescriptions/drafts', 'doctor', { ...details(), medicines: lines }, 400);
  await Appointment.updateOne({ _id: visits.own._id }, { $set: { patient: new mongoose.Types.ObjectId() } });
  await request('POST', '/api/prescriptions/drafts', 'doctor', details(), 404);
  assert.equal(await Prescription.countDocuments(), 0);
});

test('malformed JSON is rejected without reflecting the submitted clinical text', async () => {
  const response = await fetch(baseUrl + '/api/prescriptions/drafts', { method: 'POST', headers: { Authorization: 'Bearer ' + tokens.doctor, 'Content-Type': 'application/json' }, body: '{"diagnosis":"private clinical text",' });
  assert.equal(response.status, 400);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(JSON.stringify(await response.json()).includes('private clinical text'), false);
});

function safetyRoute(draft) { return '/api/prescriptions/' + draft._id; }

async function checkDraft(draft, revision = draft.revision, expected = 201) {
  return request('POST', safetyRoute(draft) + '/check-safety', 'doctor', { revision }, expected);
}

async function addDemoAllergy(ingredient = ingredients[0], patient = patients[0]) {
  return PatientAllergy.create({
    patient: patient._id, substance: 'Fictional report ' + ingredient.code, substanceKey: ingredient.code,
    ingredient: ingredient._id, ingredientSnapshot: { code: ingredient.code, name: ingredient.name, ...catalogSource },
    kind: 'allergy', reaction: 'Fictional reaction', source: 'patient_reported', verificationStatus: 'unconfirmed',
    recordedBy: users.doctor._id, updatedBy: users.doctor._id,
  });
}

async function addDemoRule(outcome = 'no_demo_interaction') {
  const ids = [ingredients[0].id, ingredients[1].id].sort();
  return KnowledgeRule.create({ ingredients: ids, pairKey: ids.join(':'), outcome, createdBy: users.hospital_admin._id });
}

async function createTwoMedicineDraft() {
  return (await request('POST', '/api/prescriptions/drafts', 'doctor', { ...details(), medicines: [line(0), line(1)] }, 201)).prescription;
}

test('safety checks persist server evidence, hashes and simulated labels without changing the draft', async () => {
  const draft = await createDraft();
  const before = await Prescription.findById(draft._id).lean();
  await addDemoAllergy();
  const result = await checkDraft(draft);
  const check = result.safetyCheck;
  assert.equal(check.status, 'warning');
  assert.equal(check.mode, 'simulated');
  assert.equal(check.source, catalogSource.source);
  assert.match(check.notice, /unsuitable for actual patient care/);
  assert.equal(check.revision, 1);
  assert.equal(check.checkedBy, users.doctor.id);
  assert.equal(check.appointment, visits.own.id);
  assert.equal(check.contentHash, hashSafetyValue(prescriptionSafetyContent(before)));
  assert.equal(check.inputHash, hashSafetyValue(check.inputSnapshot));
  assert.equal(check.allergy.findings.length, 1);
  assert.equal(check.inputSnapshot.allergies[0].version, 0);
  assert.equal(result.freshness.state, 'incomplete');
  assert.equal(result.usableForSigning, false);
  assert.equal(await SafetyCheck.countDocuments(), 1);
  assert.deepEqual(await Prescription.findById(draft._id).lean(), before);
  const reordered = { medicines: before.medicines, notes: before.notes, ...before };
  assert.equal(hashSafetyValue(prescriptionSafetyContent(reordered)), check.contentHash);
});

test('a limited simulated clear requires complete allergy mapping and explicit pair coverage', async () => {
  const unrelated = await Ingredient.create({ code: 'DEMO-UNRELATED', name: 'Fictional unrelated component', createdBy: users.hospital_admin._id });
  await addDemoAllergy(unrelated);
  await addDemoRule();
  const draft = await createTwoMedicineDraft();
  const result = await checkDraft(draft);
  assert.equal(result.safetyCheck.status, 'clear');
  assert.equal(result.safetyCheck.coverageComplete, true);
  assert.equal(result.freshness.state, 'current');
  assert.equal(result.usableForSigning, false);
  const read = await request('GET', safetyRoute(draft) + '/safety-checks/latest', 'doctor', undefined, 200);
  assert.equal(read.freshness.state, 'current');
  assert.deepEqual(read.safetyCheck, result.safetyCheck);
});

test('missing allergy reports and uncovered interaction pairs stay unknown', async () => {
  const result = await checkDraft(await createTwoMedicineDraft());
  assert.equal(result.safetyCheck.status, 'unknown');
  assert.equal(result.safetyCheck.coverageComplete, false);
  assert.equal(result.safetyCheck.interaction.coverage.missingPairCount, 1);
  assert.equal(result.freshness.state, 'incomplete');
});

test('interaction warnings remain visible when allergy coverage is incomplete', async () => {
  await addDemoRule('warning');
  const result = await checkDraft(await createTwoMedicineDraft());
  assert.equal(result.safetyCheck.status, 'warning');
  assert.equal(result.safetyCheck.allergy.status, 'unknown');
  assert.equal(result.safetyCheck.interaction.findings.length, 1);
  assert.equal(result.safetyCheck.coverageComplete, false);
});

test('safety routes enforce sessions, roles, ownership and active doctor profiles', async () => {
  const draft = await createDraft();
  const routes = [['POST', '/check-safety', { revision: 1 }], ['GET', '/safety-checks/latest'], ['GET', '/safety-checks/' + new mongoose.Types.ObjectId()]];
  const login = await request('POST', '/api/auth/signin', null, { email: users.doctor.email, password }, 200);
  await request('POST', '/api/auth/logout', login.token, undefined, 200);
  const expired = jwt.sign({ id: users.doctor.id, sid: jwt.decode(tokens.doctor).sid }, process.env.JWT_SECRET, { expiresIn: -1 });
  for (const [method, suffix, body] of routes) {
    for (const account of [null, 'invalid-token', login.token, expired]) await request(method, safetyRoute(draft) + suffix, account, body, 401);
    for (const account of ['hospital_admin', 'receptionist', 'hospital_pharmacist', 'external_pharmacist', 'patient', 'profilelessDoctor']) await request(method, safetyRoute(draft) + suffix, account, body, 403);
    await request(method, safetyRoute(draft) + suffix, 'otherDoctor', body, 404);
  }
  await Doctor.updateOne({ user: users.doctor._id }, { $set: { isActive: false } });
  for (const [method, suffix, body] of routes) await request(method, safetyRoute(draft) + suffix, 'doctor', body, 403);
});

test('all safety routes require the original reached in-progress visit', async () => {
  const draft = await createDraft();
  await checkDraft(draft);
  for (const change of [{ status: 'completed' }, { status: 'scheduled' }, { status: 'in_progress', startAt: new Date(Date.now() + 3600000) }, { startAt: new Date(Date.now() - 3600000), doctor: users.otherDoctor._id }]) {
    await Appointment.updateOne({ _id: visits.own._id }, { $set: change });
    await checkDraft(draft, 1, 403);
    await request('GET', safetyRoute(draft) + '/safety-checks/latest', 'doctor', undefined, 403);
  }
});

test('safety validation rejects forged evidence, invalid revisions, ids and query parameters', async () => {
  const draft = await createDraft();
  for (const body of [{}, { revision: '1' }, { revision: 0 }, { revision: 1.1 }, { revision: 1, status: 'clear' }, { revision: 1, medicines: [] }, []]) {
    await request('POST', safetyRoute(draft) + '/check-safety', 'doctor', body, 400);
  }
  await request('POST', '/api/prescriptions/invalid/check-safety', 'doctor', { revision: 1 }, 400);
  await request('GET', safetyRoute(draft) + '/safety-checks/invalid', 'doctor', undefined, 400);
  await request('GET', safetyRoute(draft) + '/safety-checks/latest?status=clear', 'doctor', undefined, 400);
  await checkDraft(draft, 2, 409);
  assert.equal(await SafetyCheck.countDocuments(), 0);
});

test('catalog changes require explicit medicine snapshot refresh before another check', async () => {
  const draft = await createDraft();
  const first = await checkDraft(draft);
  await Medicine.updateOne({ _id: medicines[0]._id }, { $set: { strength: '20 demo units' }, $inc: { version: 1 } });
  await checkDraft(draft, 1, 409);
  const stale = await request('GET', safetyRoute(draft) + '/safety-checks/latest', 'doctor', undefined, 200);
  assert.equal(stale.freshness.state, 'stale');
  assert.ok(stale.freshness.reasons.includes('catalog_snapshots_outdated'));
  const { prescription } = await request('PATCH', safetyRoute(draft), 'doctor', { revision: 1, medicines: [line()] }, 200);
  const second = await checkDraft(prescription);
  assert.equal(second.safetyCheck.revision, 2);
  const old = await request('GET', safetyRoute(draft) + '/safety-checks/' + first.safetyCheck._id, 'doctor', undefined, 200);
  assert.equal(old.freshness.state, 'stale');
  assert.equal(old.safetyCheck.contentHash, first.safetyCheck.contentHash);
  assert.equal(await SafetyCheck.countDocuments(), 2);
});

test('inactive or missing medicine and changed ingredient source reject safety creation', async () => {
  const draft = await createDraft();
  await Medicine.updateOne({ _id: medicines[0]._id }, { $set: { isActive: false } });
  await checkDraft(draft, 1, 409);
  await Medicine.updateOne({ _id: medicines[0]._id }, { $set: { isActive: true } });
  await Ingredient.collection.updateOne({ _id: ingredients[0]._id }, { $set: { sourceVersion: 'unsupported' } });
  await checkDraft(draft, 1, 409);
  await Medicine.deleteOne({ _id: medicines[0]._id });
  await checkDraft(draft, 1, 409);
  assert.equal(await SafetyCheck.countDocuments(), 0);
});

test('text edits invalidate old checks and latest returns the most recent stored attempt', async () => {
  const draft = await createDraft();
  const first = await checkDraft(draft);
  const { prescription } = await request('PATCH', safetyRoute(draft), 'doctor', { revision: 1, notes: 'Changed fictional notes' }, 200);
  const stale = await request('GET', safetyRoute(draft) + '/safety-checks/latest', 'doctor', undefined, 200);
  assert.equal(stale.freshness.state, 'stale');
  assert.ok(stale.freshness.reasons.includes('revision_changed'));
  assert.ok(stale.freshness.reasons.includes('prescription_content_changed'));
  const second = await checkDraft(prescription);
  const latest = await request('GET', safetyRoute(draft) + '/safety-checks/latest', 'doctor', undefined, 200);
  assert.equal(latest.safetyCheck._id, second.safetyCheck._id);
  const old = await SafetyCheck.findById(first.safetyCheck._id).lean();
  assert.equal(old.revision, 1);
});

test('allergy addition, review and refutation invalidate stored input evidence', async () => {
  const draft = await createDraft();
  const first = await checkDraft(draft);
  const allergy = await addDemoAllergy();
  let read = await request('GET', safetyRoute(draft) + '/safety-checks/latest', 'doctor', undefined, 200);
  assert.ok(read.freshness.reasons.includes('safety_inputs_changed'));
  const second = await checkDraft(draft);
  await PatientAllergy.updateOne({ _id: allergy._id }, { $set: { verificationStatus: 'confirmed' }, $inc: { version: 1 } });
  read = await request('GET', safetyRoute(draft) + '/safety-checks/latest', 'doctor', undefined, 200);
  assert.equal(read.freshness.state, 'stale');
  await checkDraft(draft);
  await PatientAllergy.updateOne({ _id: allergy._id }, { $set: { verificationStatus: 'refuted' }, $inc: { version: 1 } });
  read = await request('GET', safetyRoute(draft) + '/safety-checks/latest', 'doctor', undefined, 200);
  assert.equal(read.freshness.state, 'stale');
  assert.equal((await SafetyCheck.findById(second.safetyCheck._id)).allergy.findings.length, 1);
  assert.equal((await SafetyCheck.findById(first.safetyCheck._id)).allergy.findings.length, 0);
});

test('new pair rules invalidate old checks while unrelated patient reports do not', async () => {
  const draft = await createTwoMedicineDraft();
  await checkDraft(draft);
  await addDemoAllergy(ingredients[0], patients[1]);
  let read = await request('GET', safetyRoute(draft) + '/safety-checks/latest', 'doctor', undefined, 200);
  assert.equal(read.freshness.state, 'incomplete');
  await addDemoRule('warning');
  read = await request('GET', safetyRoute(draft) + '/safety-checks/latest', 'doctor', undefined, 200);
  assert.equal(read.freshness.state, 'stale');
});

test('check details are scoped to their draft, missing results return 404 and reads do not write', async () => {
  const draft = await createDraft();
  await request('GET', safetyRoute(draft) + '/safety-checks/latest', 'doctor', undefined, 404);
  const result = await checkDraft(draft);
  const otherDraft = await createDraft();
  await request('GET', safetyRoute(otherDraft) + '/safety-checks/' + result.safetyCheck._id, 'doctor', undefined, 404);
  await request('GET', safetyRoute(draft) + '/safety-checks/' + new mongoose.Types.ObjectId(), 'doctor', undefined, 404);
  const before = await SafetyCheck.findById(result.safetyCheck._id).lean();
  await request('GET', safetyRoute(draft) + '/safety-checks/latest', 'doctor', undefined, 200);
  assert.deepEqual(await SafetyCheck.findById(result.safetyCheck._id).lean(), before);
  const response = await fetch(baseUrl + safetyRoute(draft) + '/safety-checks/' + result.safetyCheck._id, { method: 'DELETE', headers: { Authorization: 'Bearer ' + tokens.doctor } });
  assert.equal(response.status, 404);
  assert.equal(await SafetyCheck.countDocuments(), 1);
});

test('legacy and non-draft prescriptions cannot receive stored safety checks', async () => {
  const draft = await createDraft();
  await Prescription.collection.updateOne({ _id: new mongoose.Types.ObjectId(draft._id) }, { $unset: { format: '', status: '' } });
  await checkDraft(draft, 1, 409);
  await Prescription.collection.updateOne({ _id: new mongoose.Types.ObjectId(draft._id) }, { $set: { format: 'catalog_v1', status: 'signed' } });
  await checkDraft(draft, 1, 409);
});

test('more than 200 active reports never produce a complete or signable check', async () => {
  const template = (await addDemoAllergy()).toObject();
  const reports = [];
  for (let index = 0; index < 201; index++) {
    reports.push({ ...template, _id: new mongoose.Types.ObjectId(), substanceKey: 'DEMO-LIMIT-' + index });
  }
  await PatientAllergy.insertMany(reports);
  const draft = await createDraft();
  const result = await checkDraft(draft);
  assert.equal(result.safetyCheck.inputSnapshot.totalAllergies, 202);
  assert.equal(result.safetyCheck.inputSnapshot.allergies.length, 201);
  assert.equal(result.safetyCheck.allergy.coverage.allergyReportsChecked, 200);
  assert.equal(result.safetyCheck.coverageComplete, false);
  assert.equal(result.freshness.state, 'incomplete');
  assert.equal(result.usableForSigning, false);
  const read = await request('GET', safetyRoute(draft) + '/safety-checks/latest', 'doctor', undefined, 200);
  assert.equal(read.freshness.state, 'incomplete');
});

test('a draft change during safety evaluation rejects saving the old result', async context => {
  const draft = await createDraft();
  const original = Medicine.find.bind(Medicine);
  let changed = false;
  context.mock.method(Medicine, 'find', (...args) => {
    const query = original(...args);
    const lean = query.lean.bind(query);
    query.lean = async (...options) => {
      const result = await lean(...options);
      if (!changed) {
        changed = true;
        await Prescription.updateOne({ _id: draft._id }, { $set: { notes: 'Concurrent demo edit' }, $inc: { revision: 1 } });
      }
      return result;
    };
    return query;
  });
  await checkDraft(draft, 1, 409);
  assert.equal(await SafetyCheck.countDocuments(), 0);
});

test('input changes during safety evaluation also reject saving', async context => {
  const draft = await createDraft();
  const allergy = await addDemoAllergy();
  const original = KnowledgeRule.find.bind(KnowledgeRule);
  let changed = false;
  context.mock.method(KnowledgeRule, 'find', (...args) => {
    const query = original(...args);
    const lean = query.lean.bind(query);
    query.lean = async (...options) => {
      const result = await lean(...options);
      if (!changed) {
        changed = true;
        await PatientAllergy.updateOne({ _id: allergy._id }, { $set: { reaction: 'Changed demo reaction' }, $inc: { version: 1 } });
      }
      return result;
    };
    return query;
  });
  await checkDraft(draft, 1, 409);
  assert.equal(await SafetyCheck.countDocuments(), 0);
});

test('safety database failures fail closed without leaking details or saving results', async context => {
  const draft = await createDraft();
  await checkDraft(draft);
  context.mock.method(Medicine, 'find', () => { throw new Error('private safety database detail'); });
  const failed = await checkDraft(draft, 1, 500);
  const read = await request('GET', safetyRoute(draft) + '/safety-checks/latest', 'doctor', undefined, 500);
  assert.equal(failed.safetyCheck, undefined);
  assert.equal(read.freshness, undefined);
  assert.equal(JSON.stringify([failed, read]).includes('private safety database detail'), false);
  assert.equal(await SafetyCheck.countDocuments(), 1);
});