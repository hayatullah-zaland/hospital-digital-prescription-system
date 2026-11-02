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
import Doctor from '../models/Doctor.js';
import User from '../models/User.js';
import Patient from '../models/Patient.js';
import Prescription from '../models/Prescription.js';
import authRoutes from '../routes/authRoutes.js';
import doctorRoutes from '../routes/doctorRoutes.js';
import prescriptionRoutes from '../routes/prescriptionRoutes.js';

// Tests start their own local MongoDB and never read the application's .env.
const previousSecret = process.env.JWT_SECRET;
const users = {};
const tokens = {};
const availability = [{ day: 'saturday', startTime: '08:00', endTime: '12:00' }];
let databaseDirectory;
let mongoProcess;
let server;
let baseUrl;
let validCreate;
let patient;

async function request(method, route, account, body, expectedStatus) {
  const response = await fetch(`${baseUrl}${route}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(account ? { Authorization: `Bearer ${tokens[account] || account}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = await response.json();
  assert.equal(response.status, expectedStatus, `${method} ${route}: ${JSON.stringify(data)}`);
  if (route.startsWith('/api/doctors')) assert.equal(response.headers.get('cache-control'), 'no-store');
  return data;
}

before(async () => {
  process.env.JWT_SECRET = 'doctor-module-tests-only-secret';
  databaseDirectory = await mkdtemp(path.join(tmpdir(), 'prescription-doctor-tests-'));
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
  await mongoose.connect(`mongodb://127.0.0.1:${mongoPort}/doctor_module_tests`, { serverSelectionTimeoutMS: 15000 });
  await Promise.all([User.init(), Doctor.init()]);

  const app = express();
  app.use(express.json());
  app.use('/api/auth', authRoutes);
  app.use('/api/doctors', doctorRoutes);
  app.use('/api/prescriptions', prescriptionRoutes);
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  const password = 'ExamplePassphrase123!';
  const passwordHash = await bcrypt.hash(password, 4);
  const accounts = [
    ...User.schema.path('role').enumValues.map(role => [role, role]),
    ['otherDoctor', 'doctor'], ['legacyDoctor', 'doctor'],
  ];
  for (const [key, role] of accounts) {
    users[key] = await User.create({
      name: key === 'doctor' ? 'Fictional A+ (Test)' : `Fictional ${key}`,
      email: `${key}@example.test`, password: passwordHash, role,
    });
    const signedIn = await request('POST', '/api/auth/signin', null, { email: users[key].email, password }, 200);
    tokens[key] = signedIn.token;
  }
  validCreate = { userId: users.legacyDoctor.id, specialization: 'General Medicine', department: 'Outpatient', registrationNumber: 'DEMO-C001', availability };
  patient = await Patient.create({ name: 'Fictional Patient', dateOfBirth: new Date('1995-06-15'), phone: '1234567', createdBy: users.hospital_admin._id });
}, { timeout: 30000 });

beforeEach(async () => {
  await Promise.all([Doctor.deleteMany({}), Prescription.deleteMany({})]);
  await Doctor.create([
    { user: users.doctor._id, specialization: 'General Medicine', department: 'Outpatient', registrationNumber: 'DEMO-A001', availability, createdBy: users.hospital_admin._id },
    { user: users.otherDoctor._id, specialization: 'Demo Specialty', department: 'Demo Department', registrationNumber: 'DEMO-B001', availability: [], createdBy: users.hospital_admin._id },
  ]);
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
    assert.ok(path.basename(databaseDirectory).startsWith('prescription-doctor-tests-'));
    await rm(databaseDirectory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
  if (previousSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = previousSecret;
});

test('administrator creates a linked profile and normalizes text', async () => {
  const { doctor } = await request('POST', '/api/doctors', 'hospital_admin', { ...validCreate, specialization: '  General Medicine  ', registrationNumber: '  demo-c001  ' }, 201);
  assert.equal(doctor.user._id, users.legacyDoctor.id);
  assert.deepEqual(Object.keys(doctor.user).sort(), ['_id', 'name']);
  assert.equal(doctor.specialization, 'General Medicine');
  assert.equal(doctor.registrationNumber, 'DEMO-C001');
  assert.equal(doctor.createdBy, users.hospital_admin.id);
  assert.equal((await Doctor.findOne({ user: users.legacyDoctor._id })).registrationNumber, 'DEMO-C001');
});

test('profile creation defaults to active with no availability', async () => {
  const { availability: omitted, ...body } = validCreate;
  const { doctor } = await request('POST', '/api/doctors', 'hospital_admin', body, 201);
  assert.deepEqual(doctor.availability, []);
  assert.equal(doctor.isActive, true);
});

test('unknown users return 404 and non-doctor users cannot get profiles', async () => {
  await request('POST', '/api/doctors', 'hospital_admin', { ...validCreate, userId: new mongoose.Types.ObjectId().toString() }, 404);
  for (const role of ['hospital_admin', 'receptionist', 'hospital_pharmacist', 'external_pharmacist', 'patient']) {
    await request('POST', '/api/doctors', 'hospital_admin', { ...validCreate, userId: users[role].id }, 400);
  }
  assert.equal(await Doctor.countDocuments(), 2);
});

test('duplicate account and case-normalized registration numbers return 409', async () => {
  await request('POST', '/api/doctors', 'hospital_admin', { ...validCreate, userId: users.doctor.id }, 409);
  await request('POST', '/api/doctors', 'hospital_admin', { ...validCreate, registrationNumber: ' demo-a001 ' }, 409);
  assert.equal(await Doctor.countDocuments(), 2);
});

for (const account of ['receptionist', 'doctor', 'hospital_pharmacist', 'external_pharmacist', 'patient']) {
  test(`${account} cannot create a doctor profile`, async () => {
    await request('POST', '/api/doctors', account, validCreate, 403);
  });
}

test('all doctor endpoints require authentication', async () => {
  const route = `/api/doctors/${users.doctor.id}`;
  for (const [method, url, body] of [
    ['POST', '/api/doctors', validCreate], ['GET', '/api/doctors'], ['GET', route],
    ['PATCH', route, { specialization: 'Updated Specialty' }], ['PATCH', `${route}/availability`, { availability: [] }],
  ]) await request(method, url, null, body, 401);
  await request('GET', '/api/doctors', 'invalid-token', undefined, 401);
  const expired = jwt.sign({ id: users.doctor.id }, process.env.JWT_SECRET, { expiresIn: -1 });
  await request('GET', '/api/doctors', expired, undefined, 401);
});

for (const account of ['hospital_pharmacist', 'external_pharmacist', 'patient']) {
  test(`${account} cannot read or edit doctor profiles`, async () => {
    await request('GET', '/api/doctors', account, undefined, 403);
    await request('GET', `/api/doctors/${users.doctor.id}`, account, undefined, 403);
    await request('PATCH', `/api/doctors/${users.doctor.id}`, account, { specialization: 'Updated Specialty' }, 403);
  });
}

test('list supports literal name, department and specialization searches', async () => {
  for (const search of ['a+ (test)', 'outpatient', 'general medicine']) {
    const result = await request('GET', `/api/doctors?search=${encodeURIComponent(search)}`, 'receptionist', undefined, 200);
    assert.equal(result.doctors.length, 1);
    assert.equal(result.doctors[0].user._id, users.doctor.id);
    assert.equal(result.pagination.total, 1);
  }
  for (const search of ['.*', '[']) {
    const result = await request('GET', `/api/doctors?search=${encodeURIComponent(search)}`, 'doctor', undefined, 200);
    assert.equal(result.doctors.length, 0);
  }
});

test('pagination is bounded and ordered newest first', async () => {
  const first = await request('GET', '/api/doctors?page=1&limit=1', 'hospital_admin', undefined, 200);
  const second = await request('GET', '/api/doctors?page=2&limit=1', 'hospital_admin', undefined, 200);
  const empty = await request('GET', '/api/doctors?page=3&limit=1', 'hospital_admin', undefined, 200);
  assert.equal(first.doctors[0].user._id, users.otherDoctor.id);
  assert.equal(second.doctors[0].user._id, users.doctor.id);
  assert.deepEqual(first.pagination, { page: 1, limit: 1, total: 2, totalPages: 2 });
  assert.equal(empty.doctors.length, 0);
});

test('staff directory hides registration and account credentials', async () => {
  const { doctors } = await request('GET', '/api/doctors', 'receptionist', undefined, 200);
  assert.equal(doctors[0].registrationNumber, undefined);
  assert.equal(doctors[0].createdBy, undefined);
  assert.deepEqual(Object.keys(doctors[0].user).sort(), ['_id', 'name']);
  const own = await request('GET', `/api/doctors/${users.doctor.id.toUpperCase()}`, 'doctor', undefined, 200);
  assert.equal(own.doctor.registrationNumber, 'DEMO-A001');
});

test('inactive profiles are visible only to administrators and the owner', async () => {
  await request('PATCH', `/api/doctors/${users.otherDoctor.id}`, 'hospital_admin', { isActive: false }, 200);
  const adminList = await request('GET', '/api/doctors?isActive=false', 'hospital_admin', undefined, 200);
  assert.equal(adminList.doctors.length, 1);
  for (const account of ['doctor', 'receptionist']) {
    const active = await request('GET', '/api/doctors', account, undefined, 200);
    assert.equal(active.pagination.total, 1);
    await request('GET', '/api/doctors?isActive=false', account, undefined, 403);
    await request('GET', `/api/doctors/${users.otherDoctor.id}`, account, undefined, 404);
  }
  await request('GET', `/api/doctors/${users.otherDoctor.id}`, 'otherDoctor', undefined, 200);
  await request('GET', `/api/doctors/${users.otherDoctor.id}`, 'hospital_admin', undefined, 200);
});

test('administrator partial updates preserve account and creator', async () => {
  const previous = await Doctor.findOne({ user: users.doctor._id });
  const { doctor } = await request('PATCH', `/api/doctors/${users.doctor.id}`, 'hospital_admin', { department: '  Demo New Department  ' }, 200);
  assert.equal(doctor.department, 'Demo New Department');
  assert.equal(doctor.specialization, previous.specialization);
  assert.equal(doctor.user._id, users.doctor.id);
  assert.equal(doctor.createdBy, previous.createdBy.toString());
  assert.equal(doctor.createdAt, previous.createdAt.toISOString());
  assert.deepEqual(doctor.availability, availability);
});

test('doctors edit their own specialization and availability but not administrative fields', async () => {
  const route = `/api/doctors/${users.doctor.id.toUpperCase()}`;
  await request('PATCH', route, 'doctor', { specialization: 'Updated Specialty' }, 200);
  const shifts = [{ day: 'monday', startTime: '09:00', endTime: '11:00' }];
  const { doctor } = await request('PATCH', `${route}/availability`, 'doctor', { availability: shifts }, 200);
  assert.deepEqual(doctor.availability, shifts);
  for (const body of [{ department: 'Other' }, { registrationNumber: 'OTHER-001' }, { isActive: false }]) {
    await request('PATCH', route, 'doctor', body, 403);
  }
  await request('PATCH', `/api/doctors/${users.otherDoctor.id}`, 'doctor', { specialization: 'Not Allowed' }, 404);
  await request('PATCH', `/api/doctors/${users.otherDoctor.id}/availability`, 'doctor', { availability: [] }, 404);
});

test('availability accepts adjacent periods, different days and clearing the schedule', async () => {
  const shifts = [
    { day: 'saturday', startTime: '08:00', endTime: '10:00' },
    { day: 'saturday', startTime: '10:00', endTime: '12:00' },
    { day: 'sunday', startTime: '08:00', endTime: '12:00' },
  ];
  const route = `/api/doctors/${users.doctor.id}/availability`;
  await request('PATCH', route, 'doctor', { availability: shifts }, 200);
  const cleared = await request('PATCH', route, 'doctor', { availability: [] }, 200);
  assert.deepEqual(cleared.doctor.availability, []);
  await request('PATCH', route, 'doctor', { availability: [], isActive: true }, 400);
  await request('PATCH', route, 'doctor', {}, 400);
});

test('profiles use doctor user IDs rather than profile IDs', async () => {
  const profile = await Doctor.findOne({ user: users.doctor._id });
  await request('GET', `/api/doctors/${profile.id}`, 'hospital_admin', undefined, 404);
  await request('GET', `/api/doctors/${users.legacyDoctor.id}`, 'hospital_admin', undefined, 404);
  await request('GET', '/api/doctors/bad-id', 'hospital_admin', undefined, 400);
  await request('PATCH', '/api/doctors/bad-id', 'hospital_admin', { department: 'Demo' }, 400);
});

const invalidDetails = [
  { specialization: 'a' }, { specialization: null }, { specialization: 'a'.repeat(101) },
  { department: {} }, { department: ' ' }, { department: 'a'.repeat(101) },
  { registrationNumber: 'aa' }, { registrationNumber: null }, { registrationNumber: 'a'.repeat(51) },
  { isActive: 'false' }, { isActive: 1 }, { isActive: null },
  { availability: {} }, { availability: null }, { availability: Array(29).fill({ day: 'monday', startTime: '08:00', endTime: '09:00' }) },
  { availability: [null] }, { availability: [[]] },
  ...[
    {}, { day: 'Monday', startTime: '08:00', endTime: '09:00' },
    { day: 'monday', startTime: '8:00', endTime: '09:00' },
    { day: 'monday', startTime: '24:00', endTime: '09:00' },
    { day: 'monday', startTime: '08:60', endTime: '09:00' },
    { day: 'monday', startTime: null, endTime: '09:00' },
    { day: 'monday', startTime: '09:00', endTime: '08:00' },
    { day: 'monday', startTime: '09:00', endTime: '09:00' },
    { day: 'monday', startTime: '08:00', endTime: '09:00', extra: true },
  ].map(slot => ({ availability: [slot] })),
  { availability: [{ day: 'monday', startTime: '08:00', endTime: '10:00' }, { day: 'monday', startTime: '09:00', endTime: '11:00' }] },
];

for (const [index, details] of invalidDetails.entries()) {
  test(`invalid doctor details ${index + 1} are rejected on create and update`, async () => {
    const previous = JSON.stringify(await Doctor.findOne({ user: users.doctor._id }).lean());
    await request('POST', '/api/doctors', 'hospital_admin', { ...validCreate, ...details }, 400);
    await request('PATCH', `/api/doctors/${users.doctor.id}`, 'hospital_admin', details, 400);
    assert.equal(JSON.stringify(await Doctor.findOne({ user: users.doctor._id }).lean()), previous);
    assert.equal(await Doctor.countDocuments(), 2);
  });
}

test('invalid and unknown fields cannot change identity or ownership', async () => {
  for (const userId of [null, 'bad-id', {}, []]) await request('POST', '/api/doctors', 'hospital_admin', { ...validCreate, userId }, 400);
  for (const body of [{}, [], undefined, { user: users.otherDoctor.id }, { userId: users.otherDoctor.id }, { createdBy: users.otherDoctor.id }, { _id: users.otherDoctor.id }, { $set: { isActive: true } }]) {
    await request('PATCH', `/api/doctors/${users.doctor.id}`, 'hospital_admin', body, 400);
  }
  await request('POST', '/api/doctors', 'hospital_admin', { ...validCreate, createdBy: users.patient.id }, 400);
});

test('invalid list query values return 400', async () => {
  for (const query of ['page=0', 'page=-1', 'page=1.5', 'page=01', 'page=9007199254740992', 'page=9007199254740991&limit=50', 'limit=0', 'limit=51', 'page=1&page=2', 'search=x&search=y', 'isActive=yes', 'isActive=true&isActive=false', `search=${'a'.repeat(101)}`]) {
    await request('GET', `/api/doctors?${query}`, 'hospital_admin', undefined, 400);
  }
});

test('duplicate registration updates fail without applying other changes', async () => {
  const previous = JSON.stringify(await Doctor.findOne({ user: users.doctor._id }).lean());
  await request('PATCH', `/api/doctors/${users.doctor.id}`, 'hospital_admin', { department: 'Should Not Change', registrationNumber: 'demo-b001' }, 409);
  assert.equal(JSON.stringify(await Doctor.findOne({ user: users.doctor._id }).lean()), previous);
});

test('stale profile saves are rejected instead of overwriting newer edits', async () => {
  const first = await Doctor.findOne({ user: users.doctor._id });
  const stale = await Doctor.findOne({ user: users.doctor._id });
  first.specialization = 'First Change';
  await first.save();
  stale.specialization = 'Stale Change';
  await assert.rejects(stale.save(), { name: 'VersionError' });
  assert.equal((await Doctor.findOne({ user: users.doctor._id })).specialization, 'First Change');
});

test('inactive profiles block new prescriptions while preserving history and legacy doctors', async () => {
  const body = { patientId: patient.id, diagnosis: 'Fictional diagnosis', medicines: [{ name: 'Demo medicine', dosage: 'Demo dosage', frequency: 'Demo frequency', duration: 'Demo duration' }] };
  const first = await request('POST', '/api/prescriptions', 'doctor', body, 201);
  await request('PATCH', `/api/doctors/${users.doctor.id}`, 'hospital_admin', { isActive: false }, 200);
  await request('POST', '/api/prescriptions', 'doctor', body, 403);
  await request('GET', `/api/prescriptions/${first.prescription._id}`, 'doctor', undefined, 200);
  await request('PATCH', `/api/doctors/${users.doctor.id}`, 'doctor', { isActive: true }, 403);
  await request('POST', '/api/prescriptions', 'legacyDoctor', body, 201);
  await request('PATCH', `/api/doctors/${users.doctor.id}`, 'hospital_admin', { isActive: true }, 200);
  await request('POST', '/api/prescriptions', 'doctor', body, 201);
});
