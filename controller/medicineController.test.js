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
import Ingredient, { catalogSource } from '../models/Ingredient.js';
import Medicine from '../models/Medicine.js';
import authRoutes from '../routes/authRoutes.js';
import ingredientRoutes from '../routes/ingredientRoutes.js';
import medicineRoutes from '../routes/medicineRoutes.js';
import { handleJsonErrors } from '../middleware/jsonErrorHandler.js';

// ټولې ازموینې خپل موقتي DB لري؛ .env او عادي DB نه کاروي.
const previousSecret = process.env.JWT_SECRET;
const password = 'ExamplePassphrase123!';
const users = {};
const tokens = {};
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

function details(code = 'DEMO-MED-A') {
  return { code, name: 'Fictional Medicine A', strength: '10 demo units', form: 'tablet', ingredientIds: [ingredients[0].id] };
}

async function createMedicine(body = details(), account = 'hospital_admin') {
  const result = await request('POST', '/api/medicines', account, body, 201);
  assert.deepEqual(result.catalog, catalogSource);
  return result.medicine;
}

async function checkEndpoints(account, expected) {
  const id = new mongoose.Types.ObjectId().toString();
  await request('POST', '/api/ingredients', account, { code: 'NEW-I', name: 'Fictional Component' }, expected);
  await request('GET', '/api/ingredients', account, undefined, expected);
  await request('GET', '/api/ingredients/' + id, account, undefined, expected);
  await request('POST', '/api/medicines', account, details(), expected);
  await request('GET', '/api/medicines', account, undefined, expected);
  await request('GET', '/api/medicines/' + id, account, undefined, expected);
  await request('PATCH', '/api/medicines/' + id, account, { version: 0, notes: 'Fictional change' }, expected);
}

before(async () => {
  process.env.JWT_SECRET = 'medicine-catalog-tests-only-secret';
  databaseDirectory = await mkdtemp(path.join(tmpdir(), 'prescription-catalog-tests-'));
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
  await mongoose.connect(`mongodb://127.0.0.1:${mongoPort}/medicine_catalog_tests`, { serverSelectionTimeoutMS: 15000 });
  await Promise.all([User.init(), AuthSession.init(), Ingredient.init(), Medicine.init()]);
  const app = express();
  app.use(express.json());
  app.use(handleJsonErrors);
  app.use('/api/auth', authRoutes);
  app.use('/api/ingredients', ingredientRoutes);
  app.use('/api/medicines', medicineRoutes);
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  const passwordHash = await bcrypt.hash(password, 4);
  for (const role of User.schema.path('role').enumValues) {
    users[role] = await User.create({ name: 'Fictional ' + role, email: role + '@example.test', password: passwordHash, role });
    const login = await request('POST', '/api/auth/signin', null, { email: users[role].email, password }, 200);
    tokens[role] = login.token;
  }
}, { timeout: 30000 });

beforeEach(async () => {
  await Medicine.deleteMany({});
  await Ingredient.deleteMany({});
  ingredients = await Ingredient.create([
    { code: 'DEMO-I-A', name: 'Fictional Component A', createdBy: users.hospital_admin._id },
    { code: 'DEMO-I-B', name: 'Fictional Component B', createdBy: users.hospital_admin._id },
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
    assert.ok(path.basename(databaseDirectory).startsWith('prescription-catalog-tests-'));
    await rm(databaseDirectory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
  if (previousSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = previousSecret;
});

test('all seven endpoints reject missing and invalid tokens', async () => {
  await checkEndpoints(null, 401);
  await checkEndpoints('invalid-token', 401);
});

test('all endpoints reject expired tokens and revoked sessions', async () => {
  const decoded = jwt.decode(tokens.hospital_admin);
  const expired = jwt.sign({ id: decoded.id, sid: decoded.sid }, process.env.JWT_SECRET, { expiresIn: -10 });
  await checkEndpoints(expired, 401);
  const login = await request('POST', '/api/auth/signin', null, { email: users.hospital_admin.email, password }, 200);
  await request('POST', '/api/auth/logout', login.token, {}, 200);
  await checkEndpoints(login.token, 401);
});

test('patients, receptionists and external pharmacists cannot use catalog endpoints', async () => {
  for (const role of ['patient', 'receptionist', 'external_pharmacist']) await checkEndpoints(role, 403);
});

test('both catalog managers create ingredients with normalized codes and server provenance', async () => {
  for (const role of ['hospital_admin', 'hospital_pharmacist']) {
    const result = await request('POST', '/api/ingredients', role, { code: '  demo-' + role + '  ', name: '  Fictional Component  ' }, 201);
    assert.equal(result.ingredient.code, 'DEMO-' + role.toUpperCase());
    assert.equal(result.ingredient.name, 'Fictional Component');
    assert.equal(result.ingredient.createdBy, users[role].id);
    assert.deepEqual(result.catalog, catalogSource);
    for (const field of Object.keys(catalogSource)) assert.equal(result.ingredient[field], catalogSource[field]);
    const saved = await Ingredient.findById(result.ingredient._id);
    assert.equal(saved.source, catalogSource.source);
  }
});

test('doctor reads ingredients and active medicines but cannot create or update', async () => {
  const medicine = await createMedicine();
  await request('GET', '/api/ingredients', 'doctor', undefined, 200);
  await request('GET', '/api/ingredients/' + ingredients[0].id, 'doctor', undefined, 200);
  await request('GET', '/api/medicines', 'doctor', undefined, 200);
  await request('GET', '/api/medicines/' + medicine._id, 'doctor', undefined, 200);
  await request('POST', '/api/ingredients', 'doctor', { code: 'NEW-I', name: 'Fictional Component' }, 403);
  await request('POST', '/api/medicines', 'doctor', details('NEW-M'), 403);
  await request('PATCH', '/api/medicines/' + medicine._id, 'doctor', { version: 0, notes: 'Change' }, 403);
});

test('ingredient search uses name or code, literal text and stable pagination', async () => {
  let result = await request('GET', '/api/ingredients?search=demo-i-b', 'doctor', undefined, 200);
  assert.equal(result.ingredients[0]._id, ingredients[1].id);
  result = await request('GET', '/api/ingredients?search=component&page=2&limit=1', 'doctor', undefined, 200);
  assert.equal(result.ingredients[0]._id, ingredients[1].id);
  assert.deepEqual(result.pagination, { page: 2, limit: 1, total: 2, totalPages: 2 });
  result = await request('GET', '/api/ingredients?search=' + encodeURIComponent('.*'), 'doctor', undefined, 200);
  assert.equal(result.ingredients.length, 0);
});

test('empty catalog lists retain simulation metadata', async () => {
  await Ingredient.deleteMany({});
  for (const route of ['/api/ingredients', '/api/medicines']) {
    const result = await request('GET', route, 'hospital_admin', undefined, 200);
    assert.deepEqual(result.catalog, catalogSource);
    assert.deepEqual(result.pagination, { page: 1, limit: 10, total: 0, totalPages: 0 });
  }
});

test('catalog IDs and missing records produce 400 or 404', async () => {
  const missing = new mongoose.Types.ObjectId().toString();
  for (const route of ['/api/ingredients/', '/api/medicines/']) {
    await request('GET', route + 'invalid', 'hospital_admin', undefined, 400);
    await request('GET', route + missing, 'hospital_admin', undefined, 404);
  }
  await request('PATCH', '/api/medicines/invalid', 'hospital_admin', { version: 0, notes: 'Change' }, 400);
  await request('PATCH', '/api/medicines/' + missing, 'hospital_admin', { version: 0, notes: 'Change' }, 404);
});

test('ingredient creation validates required values, types, bounds and unknown fields', async () => {
  const invalid = [undefined, [], {}, { code: 'AA' }, { code: 2, name: 'Name' }, { code: 'A', name: 'Name' }, { code: 'A A', name: 'Name' }, { code: 'A'.repeat(41), name: 'Name' }, { code: 'AA', name: ' ' }, { code: 'AA', name: 'N'.repeat(151) }, { code: 'AA', name: {} }, { code: 'AA', name: 'Name', extra: true }];
  for (const body of invalid) await request('POST', '/api/ingredients', 'hospital_admin', body, 400);
});

test('client cannot forge catalog provenance, identities or timestamps', async () => {
  for (const field of ['mode', 'source', 'sourceVersion', 'notice', 'createdBy', 'updatedBy', 'createdAt', 'updatedAt', '_id', '__v', 'version']) {
    await request('POST', '/api/ingredients', 'hospital_admin', { code: 'NEW-I', name: 'Fictional', [field]: 'forged' }, 400);
    await request('POST', '/api/medicines', 'hospital_admin', { ...details(), [field]: 'forged' }, 400);
  }
  assert.equal(await Medicine.countDocuments(), 0);
  assert.equal(await Ingredient.countDocuments(), 2);
});

test('duplicate ingredient codes are case insensitive including concurrent creates', async () => {
  await request('POST', '/api/ingredients', 'hospital_admin', { code: ' demo-i-a ', name: 'Fictional duplicate' }, 409);
  const body = { code: 'RACE-I', name: 'Fictional concurrent component' };
  const results = await Promise.all([request('POST', '/api/ingredients', 'hospital_admin', body), request('POST', '/api/ingredients', 'hospital_pharmacist', body)]);
  assert.deepEqual(results.map(result => result.httpStatus).sort(), [201, 409]);
  assert.equal(await Ingredient.countDocuments({ code: 'RACE-I' }), 1);
});

test('medicine creation links multiple ingredients and persists simulation labels', async () => {
  const body = { ...details('  demo-combination  '), name: '  Fictional Combination  ', strength: '  20 demo units  ', ingredientIds: [ingredients[0].id, ingredients[1].id], notes: '  Fictional description  ' };
  const medicine = await createMedicine(body, 'hospital_pharmacist');
  assert.equal(medicine.code, 'DEMO-COMBINATION');
  assert.equal(medicine.name, 'Fictional Combination');
  assert.equal(medicine.strength, '20 demo units');
  assert.equal(medicine.notes, 'Fictional description');
  assert.equal(medicine.isActive, true);
  assert.equal(medicine.version, 0);
  assert.equal(medicine.createdBy, users.hospital_pharmacist.id);
  assert.equal(medicine.updatedBy, users.hospital_pharmacist.id);
  assert.deepEqual(medicine.ingredients.map(item => item._id), body.ingredientIds);
  assert.equal(medicine.ingredients[0].name, ingredients[0].name);
  for (const field of Object.keys(catalogSource)) assert.equal(medicine[field], catalogSource[field]);
  const saved = await Medicine.findById(medicine._id);
  assert.equal(saved.mode, 'simulated');
  assert.equal(saved.source, 'academic_demo_manual');
});

test('medicine creation supports optional notes, inactivity and every allowed form', async () => {
  for (const form of ['tablet', 'capsule', 'syrup', 'cream', 'injection', 'drops', 'other']) {
    const medicine = await createMedicine({ ...details('FORM-' + form), form, isActive: false });
    assert.equal(medicine.form, form);
    assert.equal(medicine.isActive, false);
    assert.equal(medicine.notes, '');
  }
});

test('medicine validation rejects missing fields, invalid types and oversized values', async () => {
  for (const field of ['code', 'name', 'strength', 'form', 'ingredientIds']) {
    const body = details();
    delete body[field];
    await request('POST', '/api/medicines', 'hospital_admin', body, 400);
  }
  for (const change of [{ strength: '' }, { strength: 'S'.repeat(81) }, { strength: 1 }, { form: 'unknown' }, { form: {} }, { notes: null }, { notes: 'N'.repeat(1001) }, { isActive: 'true' }, { isActive: 1 }]) {
    await request('POST', '/api/medicines', 'hospital_admin', { ...details(), ...change }, 400);
  }
  assert.equal(await Medicine.countDocuments(), 0);
});

test('ingredient references must be a bounded list of distinct valid IDs', async () => {
  for (const ids of [[], 'invalid', null, ['bad'], [1], [ingredients[0].id, ingredients[0].id.toUpperCase()], Array(11).fill(ingredients[0].id)]) {
    await request('POST', '/api/medicines', 'hospital_admin', { ...details(), ingredientIds: ids }, 400);
  }
  await request('POST', '/api/medicines', 'hospital_admin', { ...details(), ingredientIds: [ingredients[0].id, new mongoose.Types.ObjectId().toString()] }, 404);
  assert.equal(await Medicine.countDocuments(), 0);
});

test('duplicate medicine codes are case insensitive including concurrent creates', async () => {
  await createMedicine();
  await request('POST', '/api/medicines', 'hospital_admin', details(' demo-med-a '), 409);
  const results = await Promise.all([request('POST', '/api/medicines', 'hospital_admin', details('RACE-M')), request('POST', '/api/medicines', 'hospital_pharmacist', details('race-m'))]);
  assert.deepEqual(results.map(result => result.httpStatus).sort(), [201, 409]);
  assert.equal(await Medicine.countDocuments({ code: 'RACE-M' }), 1);
});

test('doctor cannot discover inactive medicines through list, search or detail', async () => {
  const active = await createMedicine();
  const inactive = await createMedicine({ ...details('INACTIVE'), name: 'Fictional Hidden', isActive: false });
  const result = await request('GET', '/api/medicines', 'doctor', undefined, 200);
  assert.deepEqual(result.medicines.map(item => item._id), [active._id]);
  assert.equal(result.pagination.total, 1);
  const hidden = await request('GET', '/api/medicines?search=hidden', 'doctor', undefined, 200);
  assert.equal(hidden.pagination.total, 0);
  await request('GET', '/api/medicines/' + inactive._id, 'doctor', undefined, 404);
  await request('GET', '/api/medicines?isActive=false', 'doctor', undefined, 403);
  await request('GET', '/api/medicines?isActive=true', 'doctor', undefined, 200);
});

test('managers see and filter both active and inactive medicines', async () => {
  await createMedicine();
  const inactive = await createMedicine({ ...details('INACTIVE'), isActive: false });
  for (const role of ['hospital_admin', 'hospital_pharmacist']) {
    const all = await request('GET', '/api/medicines', role, undefined, 200);
    assert.equal(all.pagination.total, 2);
    const filtered = await request('GET', '/api/medicines?isActive=false', role, undefined, 200);
    assert.deepEqual(filtered.medicines.map(item => item._id), [inactive._id]);
    await request('GET', '/api/medicines/' + inactive._id, role, undefined, 200);
  }
});

test('medicine search, ingredient and form filters combine with sorted pagination', async () => {
  await createMedicine({ ...details('CODE-ALPHA'), name: 'Fictional Alpha [trial].' });
  const beta = await createMedicine({ ...details('CODE-BETA'), name: 'Fictional Beta', form: 'cream', ingredientIds: [ingredients[1].id] });
  let result = await request('GET', '/api/medicines?search=code-beta', 'doctor', undefined, 200);
  assert.equal(result.medicines[0]._id, beta._id);
  result = await request('GET', '/api/medicines?search=' + encodeURIComponent('[trial].'), 'doctor', undefined, 200);
  assert.equal(result.pagination.total, 1);
  result = await request('GET', `/api/medicines?search=fictional&form=cream&ingredientId=${ingredients[1].id}&limit=1`, 'doctor', undefined, 200);
  assert.equal(result.medicines[0]._id, beta._id);
  assert.equal(result.medicines[0].ingredients[0].code, 'DEMO-I-B');
  result = await request('GET', '/api/medicines?page=2&limit=1', 'doctor', undefined, 200);
  assert.equal(result.medicines[0]._id, beta._id);
  assert.deepEqual(result.pagination, { page: 2, limit: 1, total: 2, totalPages: 2 });
});

test('catalog queries reject operators, repeated values and unsafe pagination', async () => {
  for (const query of ['page=0', 'page=-1', 'page=1.5', 'page=01', 'page=9007199254740992', 'page=9007199254740991&limit=50', 'limit=0', 'limit=51', 'limit=one', 'page=1&page=2', 'search=a&search=b', 'search=' + 'x'.repeat(101), 'search[$ne]=x', 'unknown=x']) {
    for (const route of ['/api/ingredients', '/api/medicines']) await request('GET', route + '?' + query, 'hospital_admin', undefined, 400);
  }
  for (const query of ['isActive=1', 'isActive=false&isActive=true', 'ingredientId=bad', 'form=invalid']) {
    await request('GET', '/api/medicines?' + query, 'hospital_admin', undefined, 400);
  }
  await request('GET', '/api/ingredients?isActive=true', 'hospital_admin', undefined, 400);
});

test('partial medicine updates preserve identity and omitted fields', async () => {
  const original = await createMedicine();
  const result = await request('PATCH', '/api/medicines/' + original._id, 'hospital_pharmacist', { version: 0, notes: '  Fictional corrected description  ' }, 200);
  const medicine = result.medicine;
  assert.equal(medicine.notes, 'Fictional corrected description');
  assert.equal(medicine.version, 1);
  assert.equal(medicine.updatedBy, users.hospital_pharmacist.id);
  for (const field of ['code', 'name', 'strength', 'form', 'createdBy', 'createdAt', 'mode', 'source', 'sourceVersion', 'notice']) assert.equal(medicine[field], original[field]);
  assert.deepEqual(medicine.ingredients, original.ingredients);
  assert.deepEqual(result.catalog, catalogSource);
});

test('managers can edit all mutable fields, deactivate and reactivate', async () => {
  const original = await createMedicine();
  let result = await request('PATCH', '/api/medicines/' + original._id, 'hospital_admin', { version: 0, name: '  Fictional Edited  ', strength: '5 demo units', form: 'capsule', ingredientIds: [ingredients[1].id], notes: 'Changed', isActive: false }, 200);
  assert.equal(result.medicine.name, 'Fictional Edited');
  assert.equal(result.medicine.strength, '5 demo units');
  assert.equal(result.medicine.form, 'capsule');
  assert.equal(result.medicine.ingredients[0]._id, ingredients[1].id);
  assert.equal(result.medicine.isActive, false);
  await request('GET', '/api/medicines/' + original._id, 'doctor', undefined, 404);
  result = await request('PATCH', '/api/medicines/' + original._id, 'hospital_pharmacist', { version: 1, notes: '', isActive: true }, 200);
  assert.equal(result.medicine.version, 2);
  assert.equal(result.medicine.notes, '');
  await request('GET', '/api/medicines/' + original._id, 'doctor', undefined, 200);
});

test('medicine updates reject immutable fields and invalid or missing versions', async () => {
  const medicine = await createMedicine();
  const route = '/api/medicines/' + medicine._id;
  for (const body of [{}, [], { version: 0 }, { notes: 'Change' }, { version: '0', notes: 'Change' }, { version: -1, notes: 'Change' }, { version: 0.5, notes: 'Change' }, { version: Number.MAX_SAFE_INTEGER + 1, notes: 'Change' }, { version: 0, strength: '' }, { version: 0, ingredientIds: [] }]) {
    await request('PATCH', route, 'hospital_admin', body, 400);
  }
  for (const field of ['code', 'mode', 'source', 'sourceVersion', 'notice', 'createdBy', 'updatedBy', 'createdAt', '_id', 'ingredients']) {
    await request('PATCH', route, 'hospital_admin', { version: 0, [field]: 'forged' }, 400);
  }
  assert.equal((await Medicine.findById(medicine._id)).version, 0);
});

test('nonexistent update ingredients leave the medicine unchanged', async () => {
  const medicine = await createMedicine();
  await request('PATCH', '/api/medicines/' + medicine._id, 'hospital_admin', { version: 0, name: 'Uncommitted', ingredientIds: [new mongoose.Types.ObjectId().toString()] }, 404);
  const saved = await Medicine.findById(medicine._id);
  assert.equal(saved.name, medicine.name);
  assert.equal(saved.version, 0);
});

test('stale medicine version cannot overwrite a completed edit', async () => {
  const medicine = await createMedicine();
  const route = '/api/medicines/' + medicine._id;
  await request('PATCH', route, 'hospital_admin', { version: 0, notes: 'First edit' }, 200);
  await request('PATCH', route, 'hospital_pharmacist', { version: 0, notes: 'Stale edit' }, 409);
  const saved = await Medicine.findById(medicine._id);
  assert.equal(saved.notes, 'First edit');
  assert.equal(saved.version, 1);
});

test('concurrent updates allow one winner and preserve its complete values', async () => {
  const medicine = await createMedicine();
  const route = '/api/medicines/' + medicine._id;
  const results = await Promise.all([
    request('PATCH', route, 'hospital_admin', { version: 0, name: 'Fictional Winner A', notes: 'A' }),
    request('PATCH', route, 'hospital_pharmacist', { version: 0, name: 'Fictional Winner B', notes: 'B' }),
  ]);
  assert.deepEqual(results.map(result => result.httpStatus).sort(), [200, 409]);
  const winner = results.find(result => result.httpStatus === 200).medicine;
  const saved = await Medicine.findById(medicine._id);
  assert.equal(saved.name, winner.name);
  assert.equal(saved.notes, winner.notes);
  assert.equal(saved.updatedBy.toString(), winner.updatedBy);
  assert.equal(saved.version, 1);
});

test('malformed JSON returns a bounded JSON error without saving anything', async () => {
  const response = await fetch(baseUrl + '/api/medicines', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tokens.hospital_admin }, body: '{"name":"private unfinished body"' });
  assert.equal(response.status, 400);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const body = await response.json();
  assert.equal(typeof body.message, 'string');
  assert.equal(JSON.stringify(body).includes('private unfinished body'), false);
  assert.equal(body.stack, undefined);
  assert.equal(await Medicine.countDocuments(), 0);
});
