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
import authRoutes from '../routes/authRoutes.js';
import patientRoutes from '../routes/patientRoutes.js';
import doctorRoutes from '../routes/doctorRoutes.js';
import prescriptionRoutes from '../routes/prescriptionRoutes.js';
import appointmentRoutes from '../routes/appointmentRoutes.js';
import medicalRecordRoutes from '../routes/medicalRecordRoutes.js';

// Tests use their own local MongoDB and never load the application .env.
const previousSecret = process.env.JWT_SECRET;
const users = {};
const password = 'ExamplePassphrase123!';
let passwordHash;
let databaseDirectory;
let mongoProcess;
let server;
let baseUrl;

async function request(method, route, token, body, expectedStatus) {
  const headers = {};
  if (token) headers.Authorization = 'Bearer ' + token;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(baseUrl + route, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json();
  assert.equal(response.status, expectedStatus, `${method} ${route}: ${JSON.stringify(data)}`);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  return data;
}

async function signin(role = 'patient') {
  return request('POST', '/api/auth/signin', null, { email: users[role].email, password }, 200);
}

before(async () => {
  process.env.JWT_SECRET = 'auth-session-tests-only-secret';
  databaseDirectory = await mkdtemp(path.join(tmpdir(), 'prescription-auth-tests-'));
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
  await mongoose.connect(`mongodb://127.0.0.1:${mongoPort}/auth_session_tests`, { serverSelectionTimeoutMS: 15000 });
  await Promise.all([User.init(), AuthSession.init()]);

  const app = express();
  app.use(express.json());
  app.use('/api/auth', authRoutes);
  app.use('/api/patients', patientRoutes);
  app.use('/api/doctors', doctorRoutes);
  app.use('/api/prescriptions', prescriptionRoutes);
  app.use('/api/appointments', appointmentRoutes);
  app.use('/api/medical-records', medicalRecordRoutes);
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  passwordHash = await bcrypt.hash(password, 4);
  for (const role of User.schema.path('role').enumValues) {
    users[role] = await User.create({ name: 'Fictional ' + role, email: role + '@example.test', password: passwordHash, role });
  }
}, { timeout: 30000 });

beforeEach(async () => {
  await AuthSession.deleteMany({});
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
    assert.ok(path.basename(databaseDirectory).startsWith('prescription-auth-tests-'));
    await rm(databaseDirectory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
  if (previousSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = previousSecret;
});

test('signin keeps the response contract and creates a matching one-hour session without storing a token', async () => {
  const result = await signin();
  assert.equal(result.message, 'Signin successful');
  assert.equal(typeof result.token, 'string');
  assert.deepEqual(Object.keys(result.user).sort(), ['email', 'id', 'name', 'role']);
  const decoded = jwt.verify(result.token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
  assert.equal(decoded.id, users.patient.id);
  assert.equal(decoded.exp - decoded.iat, 3600);
  const session = await AuthSession.findById(decoded.sid).lean();
  assert.equal(session.user.toString(), users.patient.id);
  assert.equal(session.revokedAt, null);
  assert.ok(Math.abs(session.expiresAt.getTime() - decoded.exp * 1000) < 2000);
  assert.equal(session.token, undefined);
  assert.equal(session.password, undefined);
  assert.equal(await AuthSession.countDocuments(), 1);
  const me = await request('GET', '/api/auth/me', result.token, undefined, 200);
  assert.equal(me.user.id, users.patient.id);
  assert.equal(me.user.password, undefined);
  assert.equal(me.user.session, undefined);
});

test('wrong passwords and unknown accounts create no sessions and disclose the same error', async () => {
  const wrong = await request('POST', '/api/auth/signin', null, { email: users.patient.email, password: 'IncorrectPassphrase123!' }, 401);
  const missing = await request('POST', '/api/auth/signin', null, { email: 'missing@example.test', password }, 401);
  assert.deepEqual(wrong, missing);
  assert.equal(await AuthSession.countDocuments(), 0);
});

test('invalid signin input creates no sessions', async () => {
  for (const body of [undefined, {}, { email: null, password }, { email: 'not-email', password }, { email: users.patient.email, password: '' }, { email: users.patient.email, password: {} }, { email: users.patient.email, password: 'x'.repeat(73) }]) {
    await request('POST', '/api/auth/signin', null, body, 400);
  }
  assert.equal(await AuthSession.countDocuments(), 0);
});

test('two signins for one account create distinct tokens and independently valid sessions', async () => {
  const first = await signin();
  const second = await signin();
  assert.notEqual(first.token, second.token);
  assert.notEqual(jwt.decode(first.token).sid, jwt.decode(second.token).sid);
  assert.equal(await AuthSession.countDocuments({ user: users.patient._id }), 2);
  await request('GET', '/api/auth/me', first.token, undefined, 200);
  await request('GET', '/api/auth/me', second.token, undefined, 200);
});

for (const role of ['hospital_admin', 'receptionist', 'doctor', 'hospital_pharmacist', 'external_pharmacist', 'patient']) {
  test(`${role} can logout its own session and must signin again afterwards`, async () => {
    const { token } = await signin(role);
    const decoded = jwt.decode(token);
    const result = await request('POST', '/api/auth/logout', token, undefined, 200);
    assert.equal(result.message, 'Logout successful');
    const session = await AuthSession.findById(decoded.sid);
    assert.ok(session.revokedAt instanceof Date);
    assert.ok(session.revokedAt <= new Date());
    await request('GET', '/api/auth/me', token, undefined, 401);
    await request('POST', '/api/auth/logout', token, undefined, 401);
    const renewed = await signin(role);
    assert.notEqual(renewed.token, token);
    await request('GET', '/api/auth/me', renewed.token, undefined, 200);
  });
}

test('logout leaves the same account other session and another user session active', async () => {
  const first = await signin();
  const second = await signin();
  const doctor = await signin('doctor');
  await request('POST', '/api/auth/logout', first.token, undefined, 200);
  await request('GET', '/api/auth/me', first.token, undefined, 401);
  await request('GET', '/api/auth/me', second.token, undefined, 200);
  await request('GET', '/api/auth/me', doctor.token, undefined, 200);
  assert.equal(await AuthSession.countDocuments({ revokedAt: { $ne: null } }), 1);
});

test('logout body cannot choose a different user or session', async () => {
  const first = await signin();
  const other = await signin('doctor');
  const otherSid = jwt.decode(other.token).sid;
  await request('POST', '/api/auth/logout', first.token, { userId: users.doctor.id, sid: otherSid, sessionId: otherSid }, 200);
  assert.equal((await AuthSession.findById(otherSid)).revokedAt, null);
  await request('GET', '/api/auth/me', other.token, undefined, 200);
  await request('GET', '/api/auth/me', first.token, undefined, 401);
});

test('a revoked database session rejects an otherwise valid JWT', async () => {
  const { token } = await signin();
  await AuthSession.updateOne({ _id: jwt.decode(token).sid }, { revokedAt: new Date() });
  await request('GET', '/api/auth/me', token, undefined, 401);
});

test('database expiry is checked without waiting for MongoDB background cleanup', async () => {
  const { token } = await signin();
  assert.ok(jwt.decode(token).exp * 1000 > Date.now());
  await AuthSession.updateOne({ _id: jwt.decode(token).sid }, { expiresAt: new Date(Date.now() - 1000) });
  await request('GET', '/api/auth/me', token, undefined, 401);
  await request('POST', '/api/auth/logout', token, undefined, 401);
});

test('a deleted database session cannot be used', async () => {
  const { token } = await signin();
  await AuthSession.deleteOne({ _id: jwt.decode(token).sid });
  await request('GET', '/api/auth/me', token, undefined, 401);
});

test('a session must belong to the user named by the JWT', async () => {
  const { token } = await signin('doctor');
  const mismatched = jwt.sign({ id: users.patient.id, sid: jwt.decode(token).sid }, process.env.JWT_SECRET, { expiresIn: '1h' });
  await request('GET', '/api/auth/me', mismatched, undefined, 401);
});

test('legacy tokens require a fresh signin instead of bypassing session checks', async () => {
  const legacy = jwt.sign({ id: users.patient.id }, process.env.JWT_SECRET, { expiresIn: '1h' });
  await request('GET', '/api/auth/me', legacy, undefined, 401);
  const fresh = await signin();
  await request('GET', '/api/auth/me', fresh.token, undefined, 200);
});

for (const [label, sid] of [['missing', undefined], ['null', null], ['number', 12], ['object', {}], ['array', []], ['malformed', 'bad-id']]) {
  test(`${label} session ID is rejected without a server error`, async () => {
    const token = jwt.sign({ id: users.patient.id, sid }, process.env.JWT_SECRET, { expiresIn: '1h' });
    await request('GET', '/api/auth/me', token, undefined, 401);
  });
}

test('valid-looking but nonexistent session IDs are rejected', async () => {
  const token = jwt.sign({ id: users.patient.id, sid: new mongoose.Types.ObjectId().toString() }, process.env.JWT_SECRET, { expiresIn: '1h' });
  await request('GET', '/api/auth/me', token, undefined, 401);
});

test('expired, non-expiring, tampered and wrong-algorithm JWTs are rejected even with a live session', async () => {
  const { token } = await signin();
  const claims = { id: users.patient.id, sid: jwt.decode(token).sid };
  const invalid = [
    jwt.sign(claims, process.env.JWT_SECRET, { expiresIn: -1 }),
    jwt.sign(claims, process.env.JWT_SECRET),
    jwt.sign(claims, process.env.JWT_SECRET, { algorithm: 'HS384', expiresIn: '1h' }),
    jwt.sign(claims, 'different-test-signing-secret', { expiresIn: '1h' }),
  ];
  for (const value of invalid) await request('GET', '/api/auth/me', value, undefined, 401);
  await request('GET', '/api/auth/me', token, undefined, 200);
});

test('missing and malformed authentication cannot logout any session', async () => {
  const { token } = await signin();
  await request('POST', '/api/auth/logout', null, undefined, 401);
  await request('POST', '/api/auth/logout', 'bad-token', undefined, 401);
  const response = await fetch(baseUrl + '/api/auth/logout', { method: 'POST', headers: { Authorization: 'Basic example' } });
  assert.equal(response.status, 401);
  assert.equal(await AuthSession.countDocuments({ revokedAt: { $ne: null } }), 0);
  await request('GET', '/api/auth/me', token, undefined, 200);
});

test('deleted users cannot use surviving sessions', async () => {
  const user = await User.create({ name: 'Fictional Removed User', email: 'removed@example.test', password: passwordHash, role: 'patient' });
  const { token } = await request('POST', '/api/auth/signin', null, { email: user.email, password }, 200);
  await User.deleteOne({ _id: user._id });
  await request('GET', '/api/auth/me', token, undefined, 401);
});

test('revoked tokens are denied by every mounted protected API group', async () => {
  const { token } = await signin('hospital_admin');
  await request('POST', '/api/auth/logout', token, undefined, 200);
  const id = new mongoose.Types.ObjectId().toString();
  for (const [method, route, body] of [
    ['GET', '/api/auth/me'], ['GET', '/api/auth/admin'], ['POST', '/api/auth/users', {}],
    ['GET', '/api/patients'], ['POST', '/api/patients', {}], ['PATCH', '/api/patients/' + id, {}],
    ['GET', '/api/doctors'], ['POST', '/api/doctors', {}], ['PATCH', '/api/doctors/' + id, {}],
    ['GET', `/api/doctors/${id}/slots?date=2030-01-01`], ['GET', '/api/prescriptions'], ['POST', '/api/prescriptions', {}],
    ['GET', '/api/appointments'], ['POST', '/api/appointments', {}],
    ['PATCH', `/api/appointments/${id}/status`, {}], ['POST', `/api/appointments/${id}/reschedule`, {}],
    ['GET', '/api/medical-records'], ['POST', '/api/medical-records', {}],
    ['PATCH', '/api/medical-records/' + id, {}], ['POST', `/api/medical-records/${id}/finalize`],
    ['POST', `/api/medical-records/${id}/corrections`, {}],
  ]) await request(method, route, token, body, 401);
});

test('two simultaneous logout requests cannot both revoke the same active session', async () => {
  const { token } = await signin();
  const send = () => fetch(baseUrl + '/api/auth/logout', { method: 'POST', headers: { Authorization: 'Bearer ' + token } });
  const responses = await Promise.all([send(), send()]);
  assert.deepEqual(responses.map(response => response.status).sort(), [200, 401]);
  await request('GET', '/api/auth/me', token, undefined, 401);
});

test('a signing configuration error does not create an orphan session', async () => {
  const secret = process.env.JWT_SECRET;
  delete process.env.JWT_SECRET;
  try {
    const result = await request('POST', '/api/auth/signin', null, { email: users.patient.email, password }, 500);
    assert.equal(result.token, undefined);
    assert.equal(await AuthSession.countDocuments(), 0);
  } finally {
    process.env.JWT_SECRET = secret;
  }
});

test('signin does not return a token when the session cannot be saved', async t => {
  t.mock.method(AuthSession.prototype, 'save', async () => { throw new Error('Simulated session persistence failure'); });
  const result = await request('POST', '/api/auth/signin', null, { email: users.patient.email, password }, 500);
  assert.equal(result.token, undefined);
  assert.equal(await AuthSession.countDocuments(), 0);
});

test('a session lookup failure denies access without exposing database details', async t => {
  const { token } = await signin();
  const lookup = t.mock.method(AuthSession, 'findOne', async () => { throw new Error('Simulated private database error'); });
  const result = await request('GET', '/api/auth/me', token, undefined, 500);
  assert.deepEqual(result, { message: 'Unable to check your account. Please try again' });
  lookup.mock.restore();
  await request('GET', '/api/auth/me', token, undefined, 200);
});

test('a failed logout write reports failure and keeps the session available for retry', async t => {
  const { token } = await signin();
  const update = t.mock.method(AuthSession, 'updateOne', async () => { throw new Error('Simulated logout persistence failure'); });
  const result = await request('POST', '/api/auth/logout', token, undefined, 500);
  assert.equal(result.message, 'Unable to logout. Please try again');
  assert.equal((await AuthSession.findById(jwt.decode(token).sid)).revokedAt, null);
  update.mock.restore();
  await request('POST', '/api/auth/logout', token, undefined, 200);
});
