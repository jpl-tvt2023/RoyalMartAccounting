const request = require('supertest');
const app = require('../app');
const { signIn, bearer, uniqueUsername } = require('./helpers/auth');

let admin;
let viewer;
const log = (token, query = {}) => bearer(request(app).get('/api/audit-logs'), token).query(query);
const today = () => new Date().toISOString().slice(0, 10);

beforeAll(async () => {
  admin = await signIn('admin');
  viewer = await signIn('viewer');
});

describe('GET /api/audit-logs (the whole log)', () => {
  test('is for Admin and Owner only', async () => {
    expect((await log(admin.token)).status).toBe(200);
    expect((await log(viewer.token)).status).toBe(403);
    const accountant = await signIn('accountant');
    expect((await log(accountant.token)).status).toBe(403);
  });

  test('pages newest first in the house envelope, with who did it and the parsed changes', async () => {
    const username = uniqueUsername('aud');
    const made = await bearer(request(app).post('/api/users'), admin.token).send({ name: 'Audit Subject', username, password: 'First#Pass1', roles: ['Viewer'] });
    await bearer(request(app).put(`/api/users/${made.body.id}`), admin.token).send({ name: 'Audit Subject Renamed' });

    const res = await log(admin.token, { entity_type: 'user', page_size: 10 });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ page: 1, page_size: 10 });
    expect(res.body.total).toBeGreaterThanOrEqual(2);
    const [newest] = res.body.rows;
    expect(newest).toMatchObject({ action_type: 'USER_UPDATE', user_name: 'Test Admin', user_username: 'admin', entity_type: 'user' });
    expect(newest.changes).toEqual([{ field: 'name', old: 'Audit Subject', new: 'Audit Subject Renamed' }]);
  });

  test('filters by action, user, date range and text, and refuses a bad date', async () => {
    const byAction = await log(admin.token, { action_type: 'LOGIN' });
    expect(byAction.body.rows.length).toBeGreaterThan(0);
    expect(byAction.body.rows.every((r) => r.action_type === 'LOGIN')).toBe(true);

    const byUser = await log(admin.token, { user_id: viewer.user.id });
    expect(byUser.body.rows.every((r) => r.user_id === viewer.user.id)).toBe(true);

    expect((await log(admin.token, { date_from: today(), date_to: today() })).body.total).toBeGreaterThan(0);
    expect((await log(admin.token, { date_to: '2000-01-01' })).body.total).toBe(0);
    expect((await log(admin.token, { q: 'signed in' })).body.rows.every((r) => /signed in/.test(r.description))).toBe(true);
    expect((await log(admin.token, { date_from: '04-10-2026' })).status).toBe(400);
  });

  test('page_size is held to 10/25/50/100 and pages do not overlap', async () => {
    expect((await log(admin.token, { page_size: 7 })).body.page_size).toBe(25);
    const p1 = await log(admin.token, { page_size: 10, page: 1 });
    const p2 = await log(admin.token, { page_size: 10, page: 2 });
    const ids1 = new Set(p1.body.rows.map((r) => r.id));
    expect(p2.body.rows.some((r) => ids1.has(r.id))).toBe(false);
  });
});

describe('GET /api/audit-logs/facets', () => {
  test('offers the actions, entity types and users seen, for Admin/Owner', async () => {
    const res = await bearer(request(app).get('/api/audit-logs/facets'), admin.token);
    expect(res.status).toBe(200);
    expect(res.body.action_types).toEqual(expect.arrayContaining(['LOGIN']));
    expect(res.body.entity_types).toEqual(expect.arrayContaining(['user']));
    expect(res.body.users.map((u) => u.username)).toEqual(expect.arrayContaining(['admin', 'viewer']));
    expect((await bearer(request(app).get('/api/audit-logs/facets'), viewer.token)).status).toBe(403);
  });
});

describe('GET /api/audit-logs/entity (one record)', () => {
  test("any role may read a record's history, but a user account's only Admin/Owner", async () => {
    const own = await bearer(request(app).get('/api/audit-logs/entity'), admin.token).query({ entity_type: 'user', entity_id: viewer.user.id });
    expect(own.status).toBe(200);
    expect(own.body.map((r) => r.action_type)).toContain('LOGIN');

    expect((await bearer(request(app).get('/api/audit-logs/entity'), viewer.token).query({ entity_type: 'user', entity_id: viewer.user.id })).status).toBe(403);
    const other = await bearer(request(app).get('/api/audit-logs/entity'), viewer.token).query({ entity_type: 'invoice', entity_id: '607/RM/26-27' });
    expect(other.status).toBe(200);
    expect(other.body).toEqual([]);
    expect((await bearer(request(app).get('/api/audit-logs/entity'), viewer.token).query({ entity_type: 'invoice' })).status).toBe(400);
  });
});
