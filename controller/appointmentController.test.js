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
import Patient from '../models/Patient.js';
import Doctor, { daysOfWeek } from '../models/Doctor.js';
import Appointment from '../models/Appointment.js';
import doctorRoutes from '../routes/doctorRoutes.js';
import appointmentRoutes from '../routes/appointmentRoutes.js';

// Only this temporary database is used. The application .env is never loaded.
const previousSecret = process.env.JWT_SECRET;
const users = {};
const tokens = {};
const patients = [];
const date = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
const futureDay = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'long' })
  .format(new Date(date + 'T12:00:00Z')).toLowerCase();
let databaseDirectory;
let mongoProcess;
let server;
let baseUrl;

async function request(method, route, account, body, expectedStatus) {
  const headers = {};
  if (account) headers.Authorization = `Bearer ${tokens[account] || account}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(baseUrl + route, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await response.json();
  assert.equal(response.headers.get('cache-control'), 'no-store');
  if (expectedStatus !== undefined) assert.equal(response.status, expectedStatus, `${method} ${route}: ${JSON.stringify(data)}`);
  return { status: response.status, ...data };
}

function booking(patientIndex = 0, doctor = 'doctor', startTime = '09:00') {
  return { patientId: patients[patientIndex].id, doctorUserId: users[doctor].id, date, startTime };
}

async function createBooking(patientIndex = 0, doctor = 'doctor', startTime = '09:00') {
  const result = await request('POST', '/api/appointments', 'receptionist', booking(patientIndex, doctor, startTime), 201);
  return result.appointment;
}

async function seedPastVisit(status = 'scheduled') {
  const startAt = new Date(Date.now() - 3600000);
  const endAt = new Date(startAt.getTime() + 1800000);
  return Appointment.create({
    patient: patients[0]._id, doctor: users.doctor._id, startAt, endAt, status,
    createdBy: users.receptionist._id,
    history: [{ action: 'created', status, startAt, endAt, actor: users.receptionist._id }],
  });
}

before(async () => {
  process.env.JWT_SECRET = 'appointment-module-tests-only-secret';
  databaseDirectory = await mkdtemp(path.join(tmpdir(), 'prescription-appointment-tests-'));
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
  await mongoose.connect(`mongodb://127.0.0.1:${mongoPort}/appointment_module_tests`, { serverSelectionTimeoutMS: 15000 });
  await Promise.all([User.init(), Doctor.init(), Appointment.init()]);

  const app = express();
  app.use(express.json());
  app.use('/api/doctors', doctorRoutes);
  app.use('/api/appointments', appointmentRoutes);
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  const password = await bcrypt.hash('ExamplePassphrase123!', 4);
  for (const role of [...User.schema.path('role').enumValues, 'otherDoctor', 'noProfileDoctor']) {
    users[role] = await User.create({ name: 'Fictional ' + role, email: role + '@example.test', password, role: role.endsWith('Doctor') ? 'doctor' : role });
    tokens[role] = jwt.sign({ id: users[role].id }, process.env.JWT_SECRET, { algorithm: 'HS256', expiresIn: '1h' });
  }
  for (let index = 0; index < 4; index++) {
    patients.push(await Patient.create({ name: 'Fictional Patient ' + index, dateOfBirth: new Date('1995-06-15'), phone: '1234567', address: 'Private address', createdBy: users.receptionist._id }));
  }
}, { timeout: 30000 });

beforeEach(async () => {
  await Appointment.deleteMany({});
  await Doctor.deleteMany({});
  const availability = [];
  for (const day of daysOfWeek) availability.push({ day, startTime: '08:00', endTime: '12:00' });
  for (const doctor of ['doctor', 'otherDoctor']) {
    await Doctor.create({ user: users[doctor]._id, specialization: 'Demo Medicine', department: 'Demo Clinic', registrationNumber: 'DEMO-' + doctor.toUpperCase(), availability, createdBy: users.hospital_admin._id });
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
    assert.ok(path.basename(databaseDirectory).startsWith('prescription-appointment-tests-'));
    await rm(databaseDirectory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
  if (previousSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = previousSecret;
});

test('booking links the correct records, derives Kabul times and records the creator', async () => {
  const { appointment } = await request('POST', '/api/appointments', 'hospital_admin', booking(), 201);
  assert.equal(appointment.patient._id, patients[0].id);
  assert.deepEqual(Object.keys(appointment.patient).sort(), ['_id', 'name', 'phone']);
  assert.deepEqual(Object.keys(appointment.doctor).sort(), ['_id', 'name']);
  assert.equal(appointment.doctor._id, users.doctor.id);
  assert.equal(appointment.startAt, date + 'T04:30:00.000Z');
  assert.equal(appointment.endAt, date + 'T05:00:00.000Z');
  assert.equal(appointment.status, 'scheduled');
  assert.equal(appointment.createdBy, users.hospital_admin.id);
  assert.equal(appointment.history.length, 1);
  assert.equal(appointment.history[0].actor, users.hospital_admin.id);
  assert.equal(appointment.history[0].action, 'created');
  assert.equal(await Appointment.countDocuments(), 1);
});

test('every appointment endpoint and slots require a valid token', async () => {
  const id = new mongoose.Types.ObjectId().toString();
  for (const [method, route, body] of [
    ['POST', '/api/appointments', booking()], ['GET', '/api/appointments'], ['GET', '/api/appointments/' + id],
    ['PATCH', `/api/appointments/${id}/status`, { status: 'checked_in' }],
    ['POST', `/api/appointments/${id}/reschedule`, { date, startTime: '10:00', reason: 'Demo change' }],
    ['GET', `/api/doctors/${users.doctor.id}/slots?date=${date}`],
  ]) await request(method, route, null, body, 401);
  await request('GET', '/api/appointments', 'invalid-token', undefined, 401);
  const expired = jwt.sign({ id: users.doctor.id }, process.env.JWT_SECRET, { expiresIn: -1 });
  await request('GET', '/api/appointments', expired, undefined, 401);
});

for (const role of ['patient', 'hospital_pharmacist', 'external_pharmacist']) {
  test(`${role} cannot read or change appointments or read slots`, async () => {
    const appointment = await createBooking();
    await request('GET', '/api/appointments', role, undefined, 403);
    await request('GET', '/api/appointments/' + appointment._id, role, undefined, 403);
    await request('POST', '/api/appointments', role, booking(1), 403);
    await request('PATCH', `/api/appointments/${appointment._id}/status`, role, { status: 'checked_in' }, 403);
    await request('POST', `/api/appointments/${appointment._id}/reschedule`, role, { date, startTime: '10:00', reason: 'Demo change' }, 403);
    await request('GET', `/api/doctors/${users.doctor.id}/slots?date=${date}`, role, undefined, 403);
  });
}

test('doctors cannot book or reschedule and can read only their assigned appointments', async () => {
  const own = await createBooking();
  const other = await createBooking(1, 'otherDoctor');
  await request('POST', '/api/appointments', 'doctor', booking(2), 403);
  await request('POST', `/api/appointments/${own._id}/reschedule`, 'doctor', { date, startTime: '10:00', reason: 'Demo change' }, 403);
  const result = await request('GET', '/api/appointments', 'doctor', undefined, 200);
  assert.equal(result.appointments.length, 1);
  assert.equal(result.appointments[0]._id, own._id);
  assert.equal(result.appointments[0].history, undefined);
  await request('GET', '/api/appointments/' + own._id.toUpperCase(), 'doctor', undefined, 200);
  await request('GET', '/api/appointments/' + other._id, 'doctor', undefined, 404);
  await request('GET', `/api/appointments?doctorUserId=${users.otherDoctor.id}`, 'doctor', undefined, 403);
  await request('PATCH', `/api/appointments/${other._id}/status`, 'doctor', { status: 'in_progress' }, 404);
});

test('slots follow the weekly schedule, align to half hours and hide occupied times', async () => {
  await Doctor.updateOne({ user: users.doctor._id }, { availability: [{ day: futureDay, startTime: '08:10', endTime: '10:10' }] });
  const route = `/api/doctors/${users.doctor.id}/slots?date=${date}`;
  const beforeBooking = await request('GET', route, 'receptionist', undefined, 200);
  assert.deepEqual(beforeBooking.slots.map(slot => slot.startTime), ['08:30', '09:00', '09:30']);
  assert.equal(beforeBooking.timeZone, 'Asia/Kabul');
  assert.equal(beforeBooking.slotMinutes, 30);
  const appointment = await createBooking();
  const booked = await request('GET', route, 'doctor', undefined, 200);
  assert.deepEqual(booked.slots.map(slot => slot.startTime), ['08:30', '09:30']);
  assert.deepEqual(Object.keys(booked.slots[0]).sort(), ['endAt', 'startAt', 'startTime']);
  await request('PATCH', `/api/appointments/${appointment._id}/status`, 'hospital_admin', { status: 'cancelled', reason: 'Patient requested cancellation' }, 200);
  const reopened = await request('GET', route, 'receptionist', undefined, 200);
  assert.equal(reopened.slots.length, 3);
});

test('empty availability returns no slots and does not allow booking', async () => {
  await Doctor.updateOne({ user: users.doctor._id }, { availability: [] });
  const result = await request('GET', `/api/doctors/${users.doctor.id}/slots?date=${date}`, 'receptionist', undefined, 200);
  assert.deepEqual(result.slots, []);
  await request('POST', '/api/appointments', 'receptionist', booking(), 400);
});

test('today slots omit elapsed times and elapsed Kabul appointments cannot be booked', async () => {
  const now = new Date();
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kabul' }).format(now);
  const day = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Kabul', weekday: 'long' }).format(now).toLowerCase();
  await Doctor.updateOne({ user: users.doctor._id }, { availability: [{ day, startTime: '00:00', endTime: '23:59' }] });
  const result = await request('GET', `/api/doctors/${users.doctor.id}/slots?date=${today}`, 'receptionist', undefined, 200);
  for (const slot of result.slots) {
    assert.ok(new Date(slot.startAt) > now);
  }
  const hour = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kabul', hour: '2-digit', hourCycle: 'h23' }).format(now);
  await request('POST', '/api/appointments', 'receptionist', { ...booking(), date: today, startTime: hour + ':00' }, 400);
});

test('Kabul midnight is stored on the preceding UTC day and local-date filtering remains correct', async () => {
  await Doctor.updateOne({ user: users.doctor._id }, { availability: [{ day: futureDay, startTime: '00:00', endTime: '01:00' }] });
  const appointment = await createBooking(0, 'doctor', '00:00');
  assert.equal(appointment.startAt, new Date(date + 'T00:00:00+04:30').toISOString());
  const localDay = await request('GET', `/api/appointments?date=${date}`, 'hospital_admin', undefined, 200);
  assert.equal(localDay.pagination.total, 1);
  const previousDay = new Date(new Date(date + 'T00:00:00Z').getTime() - 86400000).toISOString().slice(0, 10);
  const previous = await request('GET', `/api/appointments?date=${previousDay}`, 'hospital_admin', undefined, 200);
  assert.equal(previous.pagination.total, 0);
});

test('listing supports bounded pagination and patient, doctor, date and status filters', async () => {
  const first = await createBooking();
  await createBooking(1, 'otherDoctor', '09:30');
  const page = await request('GET', '/api/appointments?page=1&limit=1', 'hospital_admin', undefined, 200);
  assert.equal(page.appointments[0]._id, first._id);
  assert.deepEqual(page.pagination, { page: 1, limit: 1, total: 2, totalPages: 2 });
  const empty = await request('GET', '/api/appointments?page=3&limit=1', 'receptionist', undefined, 200);
  assert.deepEqual(empty.appointments, []);
  for (const filter of [`patientId=${patients[0].id}`, `doctorUserId=${users.doctor.id}`, `date=${date}&doctorUserId=${users.doctor.id}`, 'status=scheduled&limit=1']) {
    const result = await request('GET', '/api/appointments?' + filter, 'receptionist', undefined, 200);
    assert.equal(result.appointments[0]._id, first._id);
  }
});

test('missing, inactive and non-doctor profiles cannot be booked', async () => {
  const missing = new mongoose.Types.ObjectId().toString();
  await request('POST', '/api/appointments', 'receptionist', { ...booking(), patientId: missing }, 404);
  for (const doctorUserId of [missing, users.patient.id, users.noProfileDoctor.id]) {
    await request('POST', '/api/appointments', 'receptionist', { ...booking(), doctorUserId }, 404);
  }
  const existing = await createBooking();
  await Doctor.updateOne({ user: users.doctor._id }, { isActive: false });
  await request('POST', '/api/appointments', 'receptionist', booking(1, 'doctor', '10:00'), 404);
  await request('GET', `/api/doctors/${users.doctor.id}/slots?date=${date}`, 'receptionist', undefined, 404);
  await request('POST', `/api/appointments/${existing._id}/reschedule`, 'receptionist', { date, startTime: '10:00', reason: 'Demo change' }, 404);
  await request('GET', '/api/appointments/' + existing._id, 'doctor', undefined, 200);
});

test('concurrent requests cannot double-book a doctor', async () => {
  const results = await Promise.all([
    request('POST', '/api/appointments', 'receptionist', booking(0)),
    request('POST', '/api/appointments', 'hospital_admin', booking(1)),
  ]);
  assert.deepEqual(results.map(result => result.status).sort(), [201, 409]);
  assert.equal(await Appointment.countDocuments(), 1);
});

test('concurrent requests cannot book a patient with two doctors at the same time', async () => {
  const results = await Promise.all([
    request('POST', '/api/appointments', 'receptionist', booking(0)),
    request('POST', '/api/appointments', 'hospital_admin', booking(0, 'otherDoctor')),
  ]);
  assert.deepEqual(results.map(result => result.status).sort(), [201, 409]);
  assert.equal(await Appointment.countDocuments(), 1);
});

test('adjacent slots can be booked and cancellation frees the slot with a retained history', async () => {
  const first = await createBooking();
  await createBooking(0, 'doctor', '09:30');
  const result = await request('PATCH', `/api/appointments/${first._id}/status`, 'receptionist', { status: 'cancelled', reason: '  Patient requested cancellation  ' }, 200);
  assert.equal(result.appointment.history.length, 2);
  assert.equal(result.appointment.history[1].reason, 'Patient requested cancellation');
  assert.equal(result.appointment.history[1].actor, users.receptionist.id);
  assert.equal(result.appointment.history[1].status, 'cancelled');
  await createBooking(1);
  assert.equal((await Appointment.findById(first._id)).status, 'cancelled');
});

test('receptionist checks in and the assigned active doctor starts and completes a visit', async () => {
  const visit = await seedPastVisit();
  const route = `/api/appointments/${visit.id}/status`;
  await request('PATCH', route, 'doctor', { status: 'in_progress' }, 409);
  await request('PATCH', route, 'receptionist', { status: 'checked_in' }, 200);
  await request('PATCH', route, 'hospital_admin', { status: 'in_progress' }, 403);
  await request('PATCH', route, 'doctor', { status: 'completed' }, 409);
  await Doctor.updateOne({ user: users.doctor._id }, { isActive: false });
  await request('PATCH', route, 'doctor', { status: 'in_progress' }, 403);
  await Doctor.updateOne({ user: users.doctor._id }, { isActive: true });
  await request('PATCH', route, 'doctor', { status: 'in_progress' }, 200);
  await request('PATCH', route, 'receptionist', { status: 'cancelled', reason: 'Not permitted now' }, 409);
  const result = await request('PATCH', route, 'doctor', { status: 'completed' }, 200);
  assert.deepEqual(result.appointment.history.map(event => event.status), ['scheduled', 'checked_in', 'in_progress', 'completed']);
  assert.equal((await Appointment.findById(visit.id).select('+isBooked')).isBooked, false);
  await request('PATCH', route, 'receptionist', { status: 'checked_in' }, 409);
  await request('POST', `/api/appointments/${visit.id}/reschedule`, 'receptionist', { date, startTime: '10:00', reason: 'Demo change' }, 409);
});

test('future visits cannot start or be marked no-show early', async () => {
  const visit = await createBooking();
  const route = `/api/appointments/${visit._id}/status`;
  await request('PATCH', route, 'receptionist', { status: 'no_show', reason: 'Patient did not arrive' }, 400);
  await request('PATCH', route, 'doctor', { status: 'cancelled', reason: 'Not allowed' }, 403);
  await request('PATCH', route, 'receptionist', { status: 'checked_in' }, 200);
  await request('PATCH', route, 'doctor', { status: 'in_progress' }, 400);
});

test('no-show is recorded only after the scheduled time ends and is terminal', async () => {
  const visit = await seedPastVisit();
  const route = `/api/appointments/${visit.id}/status`;
  const result = await request('PATCH', route, 'receptionist', { status: 'no_show', reason: 'Patient did not arrive' }, 200);
  assert.equal(result.appointment.status, 'no_show');
  await request('PATCH', route, 'receptionist', { status: 'checked_in' }, 409);
});

test('rescheduling retains the appointment ID and original history and frees the previous slot', async () => {
  const visit = await createBooking();
  const result = await request('POST', `/api/appointments/${visit._id}/reschedule`, 'hospital_admin', { date, startTime: '10:00', reason: '  Patient requested another time  ' }, 200);
  assert.equal(result.appointment._id, visit._id);
  assert.equal(result.appointment.createdBy, users.receptionist.id);
  assert.equal(result.appointment.createdAt, visit.createdAt);
  assert.equal(result.appointment.history.length, 2);
  assert.equal(result.appointment.history[0].startAt, visit.startAt);
  assert.equal(result.appointment.history[1].action, 'rescheduled');
  assert.equal(result.appointment.history[1].startAt, result.appointment.startAt);
  assert.equal(result.appointment.history[1].reason, 'Patient requested another time');
  assert.equal(result.appointment.history[1].actor, users.hospital_admin.id);
  assert.equal(result.appointment.status, 'scheduled');
  await createBooking(1);
});

test('failed reschedules preserve time and history, including patient and doctor conflicts', async () => {
  const visit = await createBooking();
  await createBooking(1, 'doctor', '10:00');
  await createBooking(0, 'otherDoctor', '10:30');
  const previous = JSON.stringify(await Appointment.findById(visit._id).lean());
  const route = `/api/appointments/${visit._id}/reschedule`;
  for (const [startTime, status] of [['09:00', 400], ['07:30', 400], ['10:00', 409], ['10:30', 409]]) {
    await request('POST', route, 'receptionist', { date, startTime, reason: 'Demo change' }, status);
    assert.equal(JSON.stringify(await Appointment.findById(visit._id).lean()), previous);
  }
});

test('concurrent reschedules cannot claim the same slot', async () => {
  const first = await createBooking();
  const second = await createBooking(1, 'doctor', '09:30');
  const results = await Promise.all([
    request('POST', `/api/appointments/${first._id}/reschedule`, 'receptionist', { date, startTime: '10:00', reason: 'Demo change' }),
    request('POST', `/api/appointments/${second._id}/reschedule`, 'receptionist', { date, startTime: '10:00', reason: 'Demo change' }),
  ]);
  assert.deepEqual(results.map(result => result.status).sort(), [200, 409]);
  const unchanged = await Appointment.findById(results[0].status === 409 ? first._id : second._id);
  assert.equal(unchanged.history.length, 1);
});

test('stale saves cannot overwrite a newer status or its history', async () => {
  const visit = await seedPastVisit();
  const stale = await Appointment.findById(visit.id);
  await request('PATCH', `/api/appointments/${visit.id}/status`, 'receptionist', { status: 'checked_in' }, 200);
  stale.status = 'cancelled';
  stale.isBooked = false;
  await assert.rejects(stale.save(), { name: 'VersionError' });
  const current = await Appointment.findById(visit.id);
  assert.equal(current.status, 'checked_in');
  assert.equal(current.history.length, 2);
});

test('invalid IDs and missing appointment records have controlled errors', async () => {
  for (const [id, expected] of [['bad-id', 400], [new mongoose.Types.ObjectId().toString(), 404]]) {
    await request('GET', '/api/appointments/' + id, 'receptionist', undefined, expected);
    await request('PATCH', `/api/appointments/${id}/status`, 'receptionist', { status: 'checked_in' }, expected);
    await request('POST', `/api/appointments/${id}/reschedule`, 'receptionist', { date, startTime: '10:00', reason: 'Demo change' }, expected);
  }
});

test('invalid booking details cannot create records or assign protected fields', async () => {
  const invalid = [
    {}, [], undefined, { ...booking(), patientId: null }, { ...booking(), doctorUserId: {} },
    { ...booking(), date: '2027-02-30' }, { ...booking(), date: '2027-2-03' }, { ...booking(), date: null },
    { ...booking(), date: '2020-01-01' }, { ...booking(), startTime: '9:00' }, { ...booking(), startTime: '09:15' },
    { ...booking(), startTime: '24:00' }, { ...booking(), startTime: '09:60' }, { ...booking(), startTime: 900 },
    { ...booking(), startTime: '07:30' }, { ...booking(), startTime: '12:00' },
    { ...booking(), status: 'completed' }, { ...booking(), createdBy: users.doctor.id },
    { ...booking(), isBooked: false }, { ...booking(), endAt: '2099-01-01' },
    { ...booking(), history: [] }, { ...booking(), $set: { status: 'completed' } },
  ];
  for (const body of invalid) await request('POST', '/api/appointments', 'receptionist', body, 400);
  assert.equal(await Appointment.countDocuments(), 0);
});

test('invalid status and reschedule input cannot alter the record', async () => {
  const visit = await createBooking();
  const previous = JSON.stringify(await Appointment.findById(visit._id).lean());
  for (const body of [{}, [], undefined, { status: 'scheduled' }, { status: 'cancelled' }, { status: 'cancelled', reason: 'a' }, { status: 'checked_in', reason: null }, { status: 'checked_in', reason: 'a'.repeat(301) }, { status: 'checked_in', isBooked: false }, { status: ['checked_in'] }]) {
    await request('PATCH', `/api/appointments/${visit._id}/status`, 'receptionist', body, 400);
  }
  for (const body of [{}, [], undefined, { date, startTime: '10:00' }, { date, startTime: '10:00', reason: 'x' }, { date, startTime: '10:00', reason: 'a'.repeat(301) }, { date, startTime: '10:15', reason: 'Demo change' }, { date, startTime: '10:00', reason: 'Demo change', doctorUserId: users.otherDoctor.id }]) {
    await request('POST', `/api/appointments/${visit._id}/reschedule`, 'receptionist', body, 400);
  }
  assert.equal(JSON.stringify(await Appointment.findById(visit._id).lean()), previous);
});

test('malformed list filters and slot dates return validation errors', async () => {
  for (const query of ['page=0', 'page=01', 'page=1.5', 'page=1&page=2', 'page=9007199254740992', 'page=9007199254740991&limit=50', 'limit=0', 'limit=51', 'limit=x', 'doctorUserId=bad', 'doctorUserId=x&doctorUserId=y', 'patientId=bad', 'date=2027-02-30', 'date=x&date=y', 'status=unknown', 'status=x&status=y', 'extra=x']) {
    await request('GET', '/api/appointments?' + query, 'receptionist', undefined, 400);
  }
  for (const query of ['', '?date=2027-02-30', '?date=2020-01-01', `?date=${date}&extra=x`, `?date=${date}&date=${date}`]) {
    await request('GET', `/api/doctors/${users.doctor.id}/slots${query}`, 'receptionist', undefined, 400);
  }
  await request('GET', `/api/doctors/bad-id/slots?date=${date}`, 'receptionist', undefined, 400);
});
