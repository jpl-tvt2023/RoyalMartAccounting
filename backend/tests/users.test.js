const request = require('supertest');
const app = require('../app');
const { db } = require('./helpers/db');
const { signIn, bearer, refreshWith, uniqueUsername } = require('./helpers/auth');

let admin;
let owner;
const users = (token) => bearer(request(app).get('/api/users'), token);
const create = (token, body) => bearer(request(app).post('/api/users'), token).send(body);
const update = (token, id, body) => bearer(request(app).put(`/api/users/${id}`), token).send(body);
const post = (token, path, body = {}) => bearer(request(app).post(path), token).send(body);

async function made(roles = ['Viewer']) {
  const username = uniqueUsername('usr');
  const res = await create(admin.token, { name: `User ${username}`, username, password: 'First#Pass1', roles });
  expect(res.status).toBe(201);
  return res.body;
}

beforeAll(async () => {
  admin = await signIn('admin');
  owner = await signIn('owner');
});

describe('who may manage users', () => {
  test('Admin and Owner may; Accountant and Viewer may not', async () => {
    expect((await users(admin.token)).status).toBe(200);
    expect((await users(owner.token)).status).toBe(200);
    for (const who of ['accountant', 'viewer']) {
      const { token } = await signIn(who);
      expect((await users(token)).status).toBe(403);
      expect((await create(token, { name: 'X', username: uniqueUsername(), password: 'First#Pass1', roles: ['Viewer'] })).status).toBe(403);
    }
  });

  test('the list shows each user with roles and status, never a password hash', async () => {
    const res = await users(admin.token);
    const row = res.body.find((u) => u.username === 'accountant');
    expect(row).toMatchObject({ name: 'Test Accountant', roles: ['Accountant'], is_active: true, is_first_login: false });
    expect(row).not.toHaveProperty('password_hash');
    expect(row).not.toHaveProperty('token_version');
  });
});

describe('POST /api/users', () => {
  test('creates a user who must change the password at first sign-in, and audits it', async () => {
    const username = uniqueUsername('new');
    const res = await create(admin.token, { name: 'New Person', username: username.toUpperCase(), password: 'First#Pass1', roles: ['Accountant', 'Viewer'] });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ username, roles: ['Accountant', 'Viewer'], is_first_login: true, is_active: true, updated_by_name: 'Test Admin' });
    const { rows: [audit] } = await db.execute({ sql: "SELECT * FROM audit_logs WHERE action_type = 'USER_CREATE' AND entity_id = ?", args: [res.body.id] });
    expect(audit.description).toBe(`Created user ${username} (Accountant, Viewer)`);
    expect(Number(audit.user_id)).toBe(admin.user.id);
  });

  test('validates the User ID, roles and password, and refuses a duplicate', async () => {
    const ok = { name: 'Valid', username: uniqueUsername('val'), password: 'First#Pass1', roles: ['Viewer'] };
    const cases = [
      [{ ...ok, username: 'ab' }, /User ID must be 3-30 characters/],
      [{ ...ok, username: 'has space' }, /User ID must be 3-30 characters/],
      [{ ...ok, roles: [] }, /At least one role is required/],
      [{ ...ok, roles: ['Employee'] }, /Invalid role: Employee/],
      [{ ...ok, password: 'weakpass' }, /Password must include/],
      [{ ...ok, name: '' }, /required/],
    ];
    for (const [body, message] of cases) {
      const res = await create(admin.token, body);
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(message);
    }
    expect((await create(admin.token, { ...ok, username: 'viewer' })).status).toBe(409);
  });
});

describe('PUT /api/users/:id', () => {
  test('renames and changes roles, with a field-level diff in the audit', async () => {
    const u = await made(['Viewer']);
    const res = await update(admin.token, u.id, { name: 'Renamed Person', roles: ['Accountant'] });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ name: 'Renamed Person', roles: ['Accountant'] });
    const { rows: [audit] } = await db.execute({ sql: "SELECT * FROM audit_logs WHERE action_type = 'USER_UPDATE' AND entity_id = ? ORDER BY id DESC", args: [u.id] });
    expect(JSON.parse(audit.changes)).toEqual([
      { field: 'name', old: u.name, new: 'Renamed Person' },
      { field: 'roles', old: 'Viewer', new: 'Accountant' },
    ]);
  });

  test("a role change ends the user's sessions; a rename does not", async () => {
    const u = await made(['Viewer']);
    const first = await signIn(u.username, 'First#Pass1');
    await update(admin.token, u.id, { name: 'Just A Rename' });
    expect((await refreshWith(first.cookie)).status).toBe(200);
    await update(admin.token, u.id, { roles: ['Accountant'] });
    expect((await refreshWith(first.cookie)).status).toBe(401);
  });

  test('refuses nothing-to-update, bad roles and an unknown user', async () => {
    const u = await made();
    expect((await update(admin.token, u.id, {})).status).toBe(400);
    expect((await update(admin.token, u.id, { roles: ['Nope'] })).status).toBe(400);
    expect((await update(admin.token, 999999, { name: 'Ghost' })).status).toBe(404);
  });
});

describe('deactivate / reactivate (users are never deleted)', () => {
  test('deactivating ends sessions and blocks sign-in; reactivating lets them back in', async () => {
    const u = await made();
    const first = await signIn(u.username, 'First#Pass1');
    const off = await post(admin.token, `/api/users/${u.id}/deactivate`);
    expect(off.status).toBe(200);
    expect(off.body.is_active).toBe(false);
    expect((await refreshWith(first.cookie)).status).toBe(401);
    expect((await request(app).post('/api/auth/login').send({ username: u.username, password: 'First#Pass1' })).status).toBe(401);

    const on = await post(admin.token, `/api/users/${u.id}/reactivate`);
    expect(on.body.is_active).toBe(true);
    expect((await request(app).post('/api/auth/login').send({ username: u.username, password: 'First#Pass1' })).status).toBe(200);

    const actions = (await db.execute({ sql: 'SELECT action_type FROM audit_logs WHERE entity_type = ? AND entity_id = ? ORDER BY id', args: ['user', u.id] })).rows.map((r) => r.action_type);
    expect(actions).toEqual(expect.arrayContaining(['USER_CREATE', 'USER_DEACTIVATE', 'USER_REACTIVATE']));
  });

  test('nobody can deactivate themselves', async () => {
    const res = await post(admin.token, `/api/users/${admin.user.id}/deactivate`);
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('You cannot deactivate your own account');
  });

  test('the last active Admin or Owner cannot lose that role', async () => {
    // Leave 'admin' as the only active Admin/Owner for the length of this test.
    const { rows } = await db.execute(`SELECT DISTINCT u.id FROM users u JOIN user_roles r ON r.user_id = u.id
      WHERE u.is_active = 1 AND r.role IN ('Admin','Owner') AND u.username <> 'admin'`);
    const others = rows.map((r) => Number(r.id));
    await db.execute(`UPDATE users SET is_active = 0 WHERE id IN (${others.join(',') || 'NULL'})`);
    try {
      const res = await update(admin.token, admin.user.id, { roles: ['Accountant'] });
      expect(res.status).toBe(409);
      expect(res.body.message).toBe('At least one active Admin or Owner must remain');
    } finally {
      await db.execute(`UPDATE users SET is_active = 1 WHERE id IN (${others.join(',') || 'NULL'})`);
    }
  });
});

describe('POST /api/users/:id/reset-password', () => {
  test('sets a password the user must change, and checks the policy', async () => {
    const u = await made();
    expect((await post(admin.token, `/api/users/${u.id}/reset-password`, { newPassword: 'weak' })).status).toBe(400);
    expect((await post(admin.token, `/api/users/${u.id}/reset-password`, { newPassword: 'Reset#Pass5' })).status).toBe(200);
    expect((await signIn(u.username, 'Reset#Pass5')).user.is_first_login).toBe(true);
    expect((await post(admin.token, '/api/users/999999/reset-password', { newPassword: 'Reset#Pass5' })).status).toBe(404);
  });
});
