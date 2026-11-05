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
import User from '../models/User.js';
import AuthSession from '../models/AuthSession.js';
import Patient from '../models/Patient.js';
import Doctor from '../models/Doctor.js';
import Appointment from '../models/Appointment.js';
import MedicalRecord from '../models/MedicalRecord.js';
import authRoutes from '../routes/authRoutes.js';
import medicalRecordRoutes from '../routes/medicalRecordRoutes.js';

// Each suite uses its own temporary MongoDB. Application .env is never read.
const previousSecret = process.env.JWT_SECRET;
const users = {};
const tokens = {};
const patients = [];
const appointments = {};
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

function details(appointment = 'own') {
  return {
    appointmentId: appointments[appointment].id,
    symptoms: '  Fictional complaint  ',
    diagnosis: '  Fictional diagnosis  ',
    observations: '  Fictional examination notes  ',
    vitals: { temperatureC: 37, weightKg: 70 },
  };
}

async function createRecord(appointment = 'own', doctor = 'doctor') {
  const result = await request('POST', '/api/medical-records', doctor, details(appointment), 201);
  return result.medicalRecord;
}

async function createFinalized() {
  const record = await createRecord();
  const result = await request('POST', `/api/medical-records/${record._id}/finalize`, 'doctor', undefined, 200);
  return result.medicalRecord;
}

before(async () => {
  process.env.JWT_SECRET = 'medical-record-tests-only-secret';
  databaseDirectory = await mkdtemp(path.join(tmpdir(), 'prescription-medical-tests-'));
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
  await mongoose.connect(`mongodb://127.0.0.1:${mongoPort}/medical_record_tests`, { serverSelectionTimeoutMS: 15000 });
  await Promise.all([User.init(), AuthSession.init(), Doctor.init(), Appointment.init(), MedicalRecord.init()]);
  const app = express();
  app.use(express.json());
  app.use('/api/auth', authRoutes);
  app.use('/api/medical-records', medicalRecordRoutes);
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  const password = 'ExamplePassphrase123!';
  const passwordHash = await bcrypt.hash(password, 4);
  for (const key of [...User.schema.path('role').enumValues, 'otherDoctor', 'profilelessDoctor']) {
    users[key] = await User.create({ name: 'Fictional ' + key, email: key + '@example.test', password: passwordHash, role: key.endsWith('Doctor') ? 'doctor' : key });
    const result = await request('POST', '/api/auth/signin', null, { email: users[key].email, password }, 200);
    tokens[key] = result.token;
  }
  for (let index = 0; index < 2; index++) {
    patients.push(await Patient.create({ name: 'Fictional Patient ' + index, dateOfBirth: new Date('1995-06-15'), phone: '1234567', address: 'Private address', createdBy: users.receptionist._id }));
  }
}, { timeout: 30000 });

beforeEach(async () => {
  await MedicalRecord.deleteMany({});
  await Appointment.deleteMany({});
  await Doctor.deleteMany({});
  for (const key of ['doctor', 'otherDoctor']) {
    await Doctor.create({ user: users[key]._id, specialization: 'Demo Medicine', department: 'Demo Clinic', registrationNumber: 'DEMO-' + key, createdBy: users.hospital_admin._id });
  }
  const seeds = [
    ['own', 'doctor', 'in_progress', 0], ['completed', 'doctor', 'completed', 0],
    ['other', 'otherDoctor', 'in_progress', 0], ['anotherPatient', 'doctor', 'completed', 1],
    ['scheduled', 'doctor', 'scheduled', 0], ['checked_in', 'doctor', 'checked_in', 0],
    ['cancelled', 'doctor', 'cancelled', 0], ['no_show', 'doctor', 'no_show', 0],
  ];
  let day = 1;
  for (const [key, doctor, status, patientIndex] of seeds) {
    const startAt = new Date(Date.now() - day * 86400000);
    appointments[key] = await Appointment.create({
      doctor: users[doctor]._id, patient: patients[patientIndex]._id,
      startAt, endAt: new Date(startAt.getTime() + 1800000), status,
      isBooked: ['scheduled', 'checked_in', 'in_progress'].includes(status),
      createdBy: users.receptionist._id,
    });
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
    assert.ok(path.basename(databaseDirectory).startsWith('prescription-medical-tests-'));
    await rm(databaseDirectory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
  if (previousSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = previousSecret;
});

test('a started visit creates a normalized draft with server-derived identity and limited populated fields', async () => {
  const record = await createRecord();
  assert.equal(record.patient._id, patients[0].id);
  assert.deepEqual(Object.keys(record.patient).sort(), ['_id', 'dateOfBirth', 'gender', 'name']);
  assert.deepEqual(Object.keys(record.doctor).sort(), ['_id', 'name']);
  assert.deepEqual(Object.keys(record.appointment).sort(), ['_id', 'endAt', 'startAt', 'status']);
  assert.equal(record.doctor._id, users.doctor.id);
  assert.equal(record.appointment._id, appointments.own.id);
  assert.equal(record.symptoms, 'Fictional complaint');
  assert.equal(record.diagnosis, 'Fictional diagnosis');
  assert.equal(record.observations, 'Fictional examination notes');
  assert.deepEqual(record.vitals, { temperatureC: 37, weightKg: 70 });
  assert.equal(record.status, 'draft');
  assert.equal(record.finalizedAt, null);
  assert.equal(record.finalizedBy, null);
  assert.equal(record.correctionOf, null);
  assert.equal(await MedicalRecord.countDocuments(), 1);
});

test('completed visits can be documented and optional fields may be omitted', async () => {
  const body = { appointmentId: appointments.completed.id, symptoms: 'Demo symptoms', diagnosis: 'Demo diagnosis' };
  const { medicalRecord } = await request('POST', '/api/medical-records', 'doctor', body, 201);
  assert.equal(medicalRecord.observations, '');
  assert.equal(medicalRecord.vitals?.weightKg, undefined);
  assert.equal(medicalRecord.status, 'draft');
});

test('every medical record endpoint requires an active signin session', async () => {
  const id = new mongoose.Types.ObjectId().toString();
  for (const [method, route, body] of [
    ['POST', '/api/medical-records', details()], ['GET', '/api/medical-records'], ['GET', '/api/medical-records/' + id],
    ['PATCH', '/api/medical-records/' + id, { diagnosis: 'Demo change' }],
    ['POST', `/api/medical-records/${id}/finalize`], ['POST', `/api/medical-records/${id}/corrections`, { reason: 'Demo correction' }],
  ]) await request(method, route, null, body, 401);
  await request('GET', '/api/medical-records', 'bad-token', undefined, 401);
});

for (const role of ['hospital_admin', 'receptionist', 'hospital_pharmacist', 'external_pharmacist', 'patient']) {
  test(`${role} has no clinical record access in this first version`, async () => {
    const record = await createRecord();
    await request('POST', '/api/medical-records', role, details('completed'), 403);
    await request('GET', '/api/medical-records', role, undefined, 403);
    await request('GET', '/api/medical-records/' + record._id, role, undefined, 403);
    await request('PATCH', '/api/medical-records/' + record._id, role, { diagnosis: 'Demo change' }, 403);
    await request('POST', `/api/medical-records/${record._id}/finalize`, role, undefined, 403);
    await request('POST', `/api/medical-records/${record._id}/corrections`, role, { reason: 'Demo correction' }, 403);
  });
}

test('appointment ownership restricts creation and record ownership restricts every operation', async () => {
  const own = await createRecord();
  const other = await createRecord('other', 'otherDoctor');
  await request('POST', '/api/medical-records', 'doctor', details('other'), 404);
  await request('GET', '/api/medical-records/' + other._id, 'doctor', undefined, 404);
  await request('PATCH', '/api/medical-records/' + other._id, 'doctor', { diagnosis: 'Demo change' }, 404);
  await request('POST', `/api/medical-records/${other._id}/finalize`, 'doctor', undefined, 404);
  await request('POST', `/api/medical-records/${other._id}/corrections`, 'doctor', { reason: 'Demo correction' }, 404);
  const list = await request('GET', '/api/medical-records', 'doctor', undefined, 200);
  assert.deepEqual(list.medicalRecords.map(record => record._id), [own._id]);
  const bySamePatient = await request('GET', `/api/medical-records?patientId=${patients[0].id}`, 'doctor', undefined, 200);
  assert.equal(bySamePatient.pagination.total, 1);
  const otherVisit = await request('GET', `/api/medical-records?appointmentId=${appointments.other.id}`, 'doctor', undefined, 200);
  assert.equal(otherVisit.pagination.total, 0);
});

test('unstarted, cancelled, missed and future visits cannot have records', async () => {
  for (const key of ['scheduled', 'checked_in', 'cancelled', 'no_show']) {
    await request('POST', '/api/medical-records', 'doctor', details(key), 409);
  }
  await Appointment.updateOne({ _id: appointments.own._id }, { startAt: new Date(Date.now() + 86400000) });
  await request('POST', '/api/medical-records', 'doctor', details(), 409);
  assert.equal(await MedicalRecord.countDocuments(), 0);
});

test('missing appointment or patient references return 404', async () => {
  await request('POST', '/api/medical-records', 'doctor', { ...details(), appointmentId: new mongoose.Types.ObjectId().toString() }, 404);
  await Appointment.updateOne({ _id: appointments.own._id }, { patient: new mongoose.Types.ObjectId() });
  await request('POST', '/api/medical-records', 'doctor', details(), 404);
});

test('inactive and missing doctor profiles deny all writes while preserving owner reads', async () => {
  const record = await createFinalized();
  await Doctor.updateOne({ user: users.doctor._id }, { isActive: false });
  await request('POST', '/api/medical-records', 'doctor', details('completed'), 403);
  await request('PATCH', '/api/medical-records/' + record._id, 'doctor', { diagnosis: 'Demo change' }, 403);
  await request('POST', `/api/medical-records/${record._id}/finalize`, 'doctor', undefined, 403);
  await request('POST', `/api/medical-records/${record._id}/corrections`, 'doctor', { reason: 'Demo correction' }, 403);
  await request('GET', '/api/medical-records/' + record._id, 'doctor', undefined, 200);
  await request('GET', '/api/medical-records', 'doctor', undefined, 200);
  await request('POST', '/api/medical-records', 'profilelessDoctor', details(), 403);
});

test('an appointment has only one original record, including simultaneous requests', async () => {
  const results = await Promise.all([
    request('POST', '/api/medical-records', 'doctor', details()),
    request('POST', '/api/medical-records', 'doctor', details()),
  ]);
  assert.deepEqual(results.map(result => result.httpStatus).sort(), [201, 409]);
  await request('POST', '/api/medical-records', 'doctor', details(), 409);
  assert.equal(await MedicalRecord.countDocuments(), 1);
});

test('partial edits preserve omitted content, links and creation time', async () => {
  const record = await createRecord();
  const result = await request('PATCH', '/api/medical-records/' + record._id, 'doctor', { diagnosis: '  Updated demo diagnosis  ' }, 200);
  assert.equal(result.medicalRecord.diagnosis, 'Updated demo diagnosis');
  assert.equal(result.medicalRecord.symptoms, record.symptoms);
  assert.equal(result.medicalRecord.observations, record.observations);
  assert.deepEqual(result.medicalRecord.vitals, record.vitals);
  assert.equal(result.medicalRecord.patient._id, record.patient._id);
  assert.equal(result.medicalRecord.doctor._id, record.doctor._id);
  assert.equal(result.medicalRecord.appointment._id, record.appointment._id);
  assert.equal(result.medicalRecord.createdAt, record.createdAt);
});

test('vitals are explicitly replaced and may be cleared while the record is a draft', async () => {
  const record = await createRecord();
  const route = '/api/medical-records/' + record._id;
  const replaced = await request('PATCH', route, 'doctor', { vitals: { weightKg: 71 } }, 200);
  assert.deepEqual(replaced.medicalRecord.vitals, { weightKg: 71 });
  const cleared = await request('PATCH', route, 'doctor', { vitals: {}, observations: '' }, 200);
  assert.equal(cleared.medicalRecord.vitals?.weightKg, undefined);
  assert.equal(cleared.medicalRecord.vitals?.temperatureC, undefined);
  assert.equal(cleared.medicalRecord.observations, '');
});

test('finalization records its actor and time and prevents subsequent edits or finalization', async () => {
  const record = await createFinalized();
  assert.equal(record.status, 'finalized');
  assert.equal(record.finalizedBy, users.doctor.id);
  assert.ok(new Date(record.finalizedAt) <= new Date());
  const previous = JSON.stringify(await MedicalRecord.findById(record._id).lean());
  await request('PATCH', '/api/medical-records/' + record._id, 'doctor', { diagnosis: 'Should not change' }, 409);
  await request('POST', `/api/medical-records/${record._id}/finalize`, 'doctor', undefined, 409);
  assert.equal(JSON.stringify(await MedicalRecord.findById(record._id).lean()), previous);
});

test('correction creates a linked draft and preserves the finalized source byte-for-byte', async () => {
  const original = await createFinalized();
  const previous = JSON.stringify(await MedicalRecord.findById(original._id).lean());
  const result = await request('POST', `/api/medical-records/${original._id}/corrections`, 'doctor', { reason: '  Correct a fictional entry  ' }, 201);
  const correction = result.medicalRecord;
  assert.notEqual(correction._id, original._id);
  assert.equal(correction.correctionOf, original._id);
  assert.equal(correction.correctionReason, 'Correct a fictional entry');
  assert.equal(correction.status, 'draft');
  assert.equal(correction.finalizedAt, null);
  assert.equal(correction.finalizedBy, null);
  assert.equal(correction.patient._id, original.patient._id);
  assert.equal(correction.doctor._id, original.doctor._id);
  assert.equal(correction.appointment._id, original.appointment._id);
  assert.equal(correction.diagnosis, original.diagnosis);
  assert.equal(correction.symptoms, original.symptoms);
  assert.equal(correction.observations, original.observations);
  assert.deepEqual(correction.vitals, original.vitals);
  await request('PATCH', '/api/medical-records/' + correction._id, 'doctor', { diagnosis: 'Corrected demo diagnosis' }, 200);
  const finalized = await request('POST', `/api/medical-records/${correction._id}/finalize`, 'doctor', {}, 200);
  assert.equal(finalized.medicalRecord.diagnosis, 'Corrected demo diagnosis');
  assert.equal(JSON.stringify(await MedicalRecord.findById(original._id).lean()), previous);
  const next = await request('POST', `/api/medical-records/${correction._id}/corrections`, 'doctor', { reason: 'Another fictional correction' }, 201);
  assert.equal(next.medicalRecord.correctionOf, correction._id);
  assert.equal(await MedicalRecord.countDocuments({ appointment: appointments.own._id }), 3);
});

test('a draft cannot have corrections and each finalized parent has only one child', async () => {
  const draft = await createRecord();
  await request('POST', `/api/medical-records/${draft._id}/corrections`, 'doctor', { reason: 'Demo correction' }, 409);
  await request('POST', `/api/medical-records/${draft._id}/finalize`, 'doctor', undefined, 200);
  const results = await Promise.all([
    request('POST', `/api/medical-records/${draft._id}/corrections`, 'doctor', { reason: 'First correction' }),
    request('POST', `/api/medical-records/${draft._id}/corrections`, 'doctor', { reason: 'Other correction' }),
  ]);
  assert.deepEqual(results.map(result => result.httpStatus).sort(), [201, 409]);
  await request('POST', `/api/medical-records/${draft._id}/corrections`, 'doctor', { reason: 'Another correction' }, 409);
  assert.equal(await MedicalRecord.countDocuments(), 2);
});

test('correction copies a record without optional vitals', async () => {
  const body = { appointmentId: appointments.own.id, symptoms: 'Demo symptoms', diagnosis: 'Demo diagnosis' };
  const created = await request('POST', '/api/medical-records', 'doctor', body, 201);
  await request('POST', `/api/medical-records/${created.medicalRecord._id}/finalize`, 'doctor', undefined, 200);
  const result = await request('POST', `/api/medical-records/${created.medicalRecord._id}/corrections`, 'doctor', { reason: 'Demo correction' }, 201);
  assert.equal(result.medicalRecord.vitals?.temperatureC, undefined);
});

test('filters and bounded pagination show original and corrective records only in the owner scope', async () => {
  const first = await createFinalized();
  const second = await createRecord('completed');
  await createRecord('other', 'otherDoctor');
  const third = await createRecord('anotherPatient');
  const correction = await request('POST', `/api/medical-records/${first._id}/corrections`, 'doctor', { reason: 'Demo correction' }, 201);
  const page = await request('GET', '/api/medical-records?page=1&limit=1', 'doctor', undefined, 200);
  assert.equal(page.medicalRecords[0]._id, correction.medicalRecord._id);
  assert.deepEqual(page.pagination, { page: 1, limit: 1, total: 4, totalPages: 4 });
  assert.equal(page.medicalRecords[0].symptoms, undefined);
  assert.equal(page.medicalRecords[0].vitals, undefined);
  const last = await request('GET', '/api/medical-records?page=4&limit=1', 'doctor', undefined, 200);
  assert.equal(last.medicalRecords[0]._id, first._id);
  const empty = await request('GET', '/api/medical-records?page=5&limit=1', 'doctor', undefined, 200);
  assert.deepEqual(empty.medicalRecords, []);
  for (const [query, expected] of [[`patientId=${patients[0].id}`, 3], [`appointmentId=${appointments.own.id}`, 2], ['status=finalized', 1], ['status=draft', 3], [`patientId=${patients[1].id}`, 1]]) {
    const result = await request('GET', '/api/medical-records?' + query, 'doctor', undefined, 200);
    assert.equal(result.pagination.total, expected);
  }
  assert.ok(second._id && third._id);
});

test('malformed and missing record IDs return controlled errors for every item endpoint', async () => {
  for (const [id, expected] of [['bad-id', 400], [new mongoose.Types.ObjectId().toString(), 404]]) {
    await request('GET', '/api/medical-records/' + id, 'doctor', undefined, expected);
    await request('PATCH', '/api/medical-records/' + id, 'doctor', { diagnosis: 'Demo change' }, expected);
    await request('POST', `/api/medical-records/${id}/finalize`, 'doctor', undefined, expected);
    await request('POST', `/api/medical-records/${id}/corrections`, 'doctor', { reason: 'Demo correction' }, expected);
  }
});

const invalidClinicalDetails = [
  { symptoms: '' }, { symptoms: null }, { symptoms: 'x'.repeat(1001) },
  { diagnosis: 'x' }, { diagnosis: {} }, { diagnosis: 'x'.repeat(501) },
  { observations: null }, { observations: [] }, { observations: 'x'.repeat(2001) },
  { vitals: null }, { vitals: [] }, { vitals: { unknown: 1 } },
  { vitals: { temperatureC: '37' } }, { vitals: { temperatureC: null } },
  { vitals: { weightKg: '70' } }, { vitals: { weightKg: 0 } }, { vitals: { weightKg: -1 } },
];

test('invalid clinical input is rejected on create and edit without changing saved data', async () => {
  const record = await createRecord();
  const previous = JSON.stringify(await MedicalRecord.findById(record._id).lean());
  for (const invalid of invalidClinicalDetails) {
    await request('POST', '/api/medical-records', 'doctor', { ...details('completed'), ...invalid }, 400);
    await request('PATCH', '/api/medical-records/' + record._id, 'doctor', invalid, 400);
  }
  assert.equal(JSON.stringify(await MedicalRecord.findById(record._id).lean()), previous);
  assert.equal(await MedicalRecord.countDocuments(), 1);
});

test('invalid body and forged identity, finalization and correction fields are rejected', async () => {
  const record = await createRecord();
  for (const body of [undefined, {}, [], { ...details(), appointmentId: 'bad-id' }, { ...details(), appointmentId: null }, { ...details(), patient: patients[1].id }, { ...details(), doctor: users.otherDoctor.id }, { ...details(), status: 'finalized' }, { ...details(), finalizedAt: new Date().toISOString() }, { ...details(), correctionOf: record._id }, { ...details(), correctionReason: 'Not allowed' }, { ...details(), $set: { status: 'finalized' } }]) {
    await request('POST', '/api/medical-records', 'doctor', body, 400);
  }
  for (const body of [undefined, {}, [], { appointmentId: appointments.completed.id }, { patient: patients[1].id }, { doctor: users.otherDoctor.id }, { status: 'finalized' }, { finalizedBy: users.doctor.id }, { correctionOf: record._id }, { correctionReason: 'Other reason' }, { $set: { diagnosis: 'Demo change' } }]) {
    await request('PATCH', '/api/medical-records/' + record._id, 'doctor', body, 400);
  }
});

test('finalize and correction accept only their exact intended input', async () => {
  const record = await createRecord();
  for (const body of [[], { status: 'finalized' }, { finalizedBy: users.doctor.id }, { diagnosis: 'Not allowed' }]) {
    await request('POST', `/api/medical-records/${record._id}/finalize`, 'doctor', body, 400);
  }
  await request('POST', `/api/medical-records/${record._id}/finalize`, 'doctor', undefined, 200);
  for (const body of [undefined, {}, [], { reason: '' }, { reason: 'x' }, { reason: null }, { reason: 'x'.repeat(501) }, { reason: 'Demo correction', diagnosis: 'Not allowed' }, { reason: 'Demo correction', appointmentId: appointments.completed.id }]) {
    await request('POST', `/api/medical-records/${record._id}/corrections`, 'doctor', body, 400);
  }
  assert.equal(await MedicalRecord.countDocuments(), 1);
});

test('invalid list queries cannot change ownership or bypass pagination bounds', async () => {
  for (const query of ['page=0', 'page=01', 'page=1.5', 'page=1&page=2', 'page=9007199254740992', 'page=9007199254740991&limit=50', 'limit=0', 'limit=51', 'patientId=bad', 'patientId=x&patientId=y', 'appointmentId=bad', 'status=unknown', 'status=x&status=y', 'doctorId=' + users.otherDoctor.id, 'doctor=' + users.otherDoctor.id, '$where=true']) {
    await request('GET', '/api/medical-records?' + query, 'doctor', undefined, 400);
  }
});

test('concurrent edit and finalize preserve the finalized snapshot or reject the stale save', async () => {
  const record = await createRecord();
  const results = await Promise.all([
    request('PATCH', '/api/medical-records/' + record._id, 'doctor', { diagnosis: 'Concurrent demo change' }),
    request('POST', `/api/medical-records/${record._id}/finalize`, 'doctor'),
  ]);
  for (const result of results) assert.ok([200, 409].includes(result.httpStatus));
  assert.ok(results.some(result => result.httpStatus === 200));
  const finalResult = results.find(result => result.medicalRecord?.status === 'finalized');
  const current = await MedicalRecord.findById(record._id);
  if (finalResult) {
    assert.equal(current.status, 'finalized');
    assert.equal(current.diagnosis, finalResult.medicalRecord.diagnosis);
  }
  const stale = await MedicalRecord.findById(record._id);
  if (current.status === 'draft') {
    await request('POST', `/api/medical-records/${record._id}/finalize`, 'doctor', undefined, 200);
    stale.diagnosis = 'Stale change';
    await assert.rejects(stale.save(), { name: 'VersionError' });
  }
});

test('a previously loaded draft cannot overwrite a finalized medical record', async () => {
  const record = await createRecord();
  const stale = await MedicalRecord.findById(record._id);
  const finalized = await request('POST', `/api/medical-records/${record._id}/finalize`, 'doctor', undefined, 200);
  stale.diagnosis = 'Stale change';
  await assert.rejects(stale.save(), { name: 'VersionError' });
  const current = await MedicalRecord.findById(record._id);
  assert.equal(current.status, 'finalized');
  assert.equal(current.diagnosis, finalized.medicalRecord.diagnosis);
});
