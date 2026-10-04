const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../app');
const { db } = require('./helpers/db');
const { TEST_PASSWORD } = require('./helpers/users');
const { signIn, bearer, refreshWith, uniqueUsername } = require('./helpers/auth');

let admin;
const NEW_PASSWORD = 'Fresh#Pass2';

// An account an Admin just created: still on its first password.
async function newUser(roles = ['Viewer'], password = 'First#Pass1') {
  const username = uniqueUsername('auth');
  const res = await bearer(request(app).post('/api/users'), admin.token)
    .send({ name: `Auth ${username}`, username, password, roles });
  expect(res.status).toBe(201);
  return { id: res.body.id, username, password };
}

const lastAudit = async (actionType, userId) => (await db.execute({
  sql: 'SELECT * FROM audit_logs WHERE action_type = ? AND (? IS NULL OR entity_id = ?) ORDER BY id DESC LIMIT 1',
  args: [actionType, userId ?? null, userId ?? null],
})).rows[0];

beforeAll(async () => {
  admin = await signIn('admin');
});

describe('POST /api/auth/login', () => {
  test('signs in: an access token with roles, the user, an httpOnly refresh cookie, and an audit row', async () => {
    const { res, token, user } = await signIn('accountant');
    expect(user).toMatchObject({ username: 'accountant', roles: ['Accountant'], is_first_login: false });
    expect(jwt.decode(token)).toMatchObject({ username: 'accountant', roles: ['Accountant'], pwd_change: false });
    const cookie = res.headers['set-cookie'].find((c) => c.startsWith('rams_refresh='));
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Strict/);
    expect((await lastAudit('LOGIN', user.id)).description).toBe('Test Accountant signed in');
  });

  test('the User ID is not case-sensitive', async () => {
    expect((await request(app).post('/api/auth/login').send({ username: '  Viewer ', password: TEST_PASSWORD })).status).toBe(200);
  });

  test('refuses a wrong password, an unknown User ID and a missing field — and logs the failures', async () => {
    const wrong = await request(app).post('/api/auth/login').send({ username: 'viewer', password: 'Nope#1234' });
    expect(wrong.status).toBe(401);
    expect(wrong.body.message).toBe('Incorrect password');
    expect((await lastAudit('LOGIN_FAILED')).description).toMatch(/wrong password\) for viewer$/);

    const unknown = await request(app).post('/api/auth/login').send({ username: 'nobody', password: TEST_PASSWORD });
    expect(unknown.status).toBe(401);
    expect(unknown.body.message).toBe('No account found with that user ID');

    expect((await request(app).post('/api/auth/login').send({ username: 'viewer' })).status).toBe(400);
  });

  test('refuses a deactivated user, even with the right password', async () => {
    const u = await newUser();
    await bearer(request(app).post(`/api/users/${u.id}/deactivate`), admin.token);
    const res = await request(app).post('/api/auth/login').send({ username: u.username, password: u.password });
    expect(res.status).toBe(401);
    expect(res.body.message).toBe('This account has been deactivated');
  });
});

describe('POST /api/auth/refresh', () => {
  test('a valid refresh cookie gets a new access token and the current user', async () => {
    const { cookie } = await signIn('viewer');
    const res = await refreshWith(cookie);
    expect(res.status).toBe(200);
    expect(jwt.decode(res.body.accessToken)).toMatchObject({ username: 'viewer' });
    expect(res.body.user).toMatchObject({ username: 'viewer', roles: ['Viewer'] });
  });

  test('no cookie, or a forged one, is refused', async () => {
    expect((await request(app).post('/api/auth/refresh')).status).toBe(401);
    expect((await refreshWith('rams_refresh=forged.token.here')).status).toBe(401);
  });
});

describe('a first (or admin-reset) password must be changed — enforced by the API', () => {
  test('until it is changed, only /me, change-password and logout answer', async () => {
    const u = await newUser(['Accountant']);
    const first = await signIn(u.username, u.password);
    expect(first.user.is_first_login).toBe(true);
    expect(jwt.decode(first.token).pwd_change).toBe(true);

    const blocked = await bearer(request(app).get('/api/audit-logs/entity').query({ entity_type: 'invoice', entity_id: '1' }), first.token);
    expect(blocked.status).toBe(403);
    expect(blocked.body).toEqual({ code: 'PASSWORD_CHANGE_REQUIRED', message: 'Change your password to continue' });
    expect((await bearer(request(app).get('/api/auth/me'), first.token)).status).toBe(200);
  });

  test('changing it needs no old password, ends the old session, and carries on with a fresh pair', async () => {
    const u = await newUser(['Accountant']);
    const first = await signIn(u.username, u.password);

    const changed = await bearer(request(app).post('/api/auth/change-password'), first.token).send({ newPassword: NEW_PASSWORD });
    expect(changed.status).toBe(200);
    expect(changed.body.user.is_first_login).toBe(false);
    expect(jwt.decode(changed.body.accessToken).pwd_change).toBe(false);

    // The cookie from the first sign-in is dead; the one change-password set works.
    expect((await refreshWith(first.cookie)).status).toBe(401);
    const newCookie = changed.headers['set-cookie'].find((c) => c.startsWith('rams_refresh=')).split(';')[0];
    expect((await refreshWith(newCookie)).status).toBe(200);
    // And the API is open again.
    const open = await bearer(request(app).get('/api/audit-logs/entity').query({ entity_type: 'invoice', entity_id: '1' }), changed.body.accessToken);
    expect(open.status).toBe(200);
    expect(await lastAudit('PASSWORD_CHANGE', u.id)).toBeDefined();
  });

  test('the new password must meet the policy and differ from the current one', async () => {
    const u = await newUser();
    const first = await signIn(u.username, u.password);
    const weak = await bearer(request(app).post('/api/auth/change-password'), first.token).send({ newPassword: 'short' });
    expect(weak.status).toBe(400);
    const same = await bearer(request(app).post('/api/auth/change-password'), first.token).send({ newPassword: u.password });
    expect(same.status).toBe(400);
    expect(same.body.message).toBe('The new password must be different from the current one');
  });

  test('once past the first sign-in, the old password is required and checked', async () => {
    const u = await newUser();
    const first = await signIn(u.username, u.password);
    const changed = await bearer(request(app).post('/api/auth/change-password'), first.token).send({ newPassword: NEW_PASSWORD });
    const token = changed.body.accessToken;
    expect((await bearer(request(app).post('/api/auth/change-password'), token).send({ newPassword: 'Third#Pass3' })).status).toBe(400);
    expect((await bearer(request(app).post('/api/auth/change-password'), token).send({ oldPassword: 'Wrong#Pass9', newPassword: 'Third#Pass3' })).status).toBe(401);
    expect((await bearer(request(app).post('/api/auth/change-password'), token).send({ oldPassword: NEW_PASSWORD, newPassword: 'Third#Pass3' })).status).toBe(200);
  });
});

describe('sessions end when they should', () => {
  test('an admin password reset ends the user\'s session and forces a change at next sign-in', async () => {
    const u = await newUser();
    const first = await signIn(u.username, u.password);
    await bearer(request(app).post('/api/auth/change-password'), first.token).send({ newPassword: NEW_PASSWORD });
    const session = await signIn(u.username, NEW_PASSWORD);

    const reset = await bearer(request(app).post(`/api/users/${u.id}/reset-password`), admin.token).send({ newPassword: 'Reset#Pass4' });
    expect(reset.status).toBe(200);
    expect((await refreshWith(session.cookie)).status).toBe(401);
    expect((await signIn(u.username, 'Reset#Pass4')).user.is_first_login).toBe(true);
  });

  test('logout clears the refresh cookie', async () => {
    const { token } = await signIn('viewer');
    const res = await bearer(request(app).post('/api/auth/logout'), token);
    expect(res.status).toBe(200);
    expect(res.headers['set-cookie'].find((c) => c.startsWith('rams_refresh='))).toMatch(/Expires=Thu, 01 Jan 1970/);
  });

  test('/me answers from the database, and refuses once the user is deactivated', async () => {
    const u = await newUser();
    const { token } = await signIn(u.username, u.password);
    expect((await bearer(request(app).get('/api/auth/me'), token)).body.user).toMatchObject({ username: u.username, roles: ['Viewer'] });
    await bearer(request(app).post(`/api/users/${u.id}/deactivate`), admin.token);
    expect((await bearer(request(app).get('/api/auth/me'), token)).status).toBe(401);
  });
});
