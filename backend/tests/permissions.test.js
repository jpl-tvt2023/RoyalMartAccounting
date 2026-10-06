const fs = require('fs');
const path = require('path');
const request = require('supertest');
const app = require('../app');
const { db } = require('./helpers/db');
const { signIn, bearer } = require('./helpers/auth');
const { CATALOG, KEYS } = require('../src/services/permissions');

const get = (token) => bearer(request(app).get('/api/settings/permissions'), token);
const put = (token, roles) => bearer(request(app).put('/api/settings/permissions'), token).send({ roles });
const DEFAULTS = {
  Accountant: ['matching.view', 'matching.run', 'matching.review', 'matching.rules', 'matching.parties', 'autofill.view', 'autofill.approve',
    'reports.view', 'reports.settings', 'sync.run'],
  Viewer: ['matching.view', 'autofill.view', 'reports.view'],
};

let admin;
beforeAll(async () => { admin = await signIn('admin'); });
// Suites share one database: leave the defaults behind.
afterAll(async () => { await put(admin.token, DEFAULTS); });

describe('roles & permissions', () => {
  test('start as agreed: Accountants do the matching work, Viewers only look; Admin/Owner hold everything', async () => {
    const res = await get(admin.token);
    expect(res.status).toBe(200);
    expect(res.body.matrix).toEqual(DEFAULTS);
    expect(res.body.roles).toEqual(['Accountant', 'Viewer']);
    expect(res.body.catalog.map((p) => p.key)).toEqual(CATALOG.map((p) => p.key));

    for (const [who, expected] of [
      ['admin', CATALOG.map((p) => p.key)],
      ['owner', CATALOG.map((p) => p.key)],
      ['accountant', DEFAULTS.Accountant],
      ['viewer', DEFAULTS.Viewer],
    ]) {
      const { user, token } = await signIn(who);
      expect(user.permissions).toEqual(expected);
      const me = await bearer(request(app).get('/api/auth/me'), token);
      expect(me.body.user.permissions).toEqual(expected);
    }
  });

  test('only Admin and Owner see or change the page — it is never grantable', async () => {
    for (const who of ['accountant', 'viewer']) {
      const { token } = await signIn(who);
      expect((await get(token)).status).toBe(403);
      expect((await put(token, { Accountant: [...KEYS] })).status).toBe(403);
    }
    const owner = await signIn('owner');
    expect((await get(owner.token)).status).toBe(200);
    expect(KEYS.has('users.manage')).toBe(false);
    expect([...KEYS].some((k) => /^(users|audit|permissions)/.test(k))).toBe(false);
  });

  test('a grant opens a route at once, a removal closes it, and both are audited', async () => {
    const accountant = await signIn('accountant');
    const schedule = (token) => bearer(request(app).put('/api/settings/sync'), token).send({ light_every_minutes: 60 });
    expect((await schedule(accountant.token)).status).toBe(403);

    const res = await put(admin.token, { Accountant: [...DEFAULTS.Accountant, 'sync.schedule'] });
    expect(res.status).toBe(200);
    expect(res.body.matrix.Accountant).toContain('sync.schedule');
    expect(res.body.updated_by_name).toBe('Test Admin');
    // The same access token, no new sign-in.
    expect((await schedule(accountant.token)).status).toBe(200);

    const { rows: [audit] } = await db.execute("SELECT * FROM audit_logs WHERE action_type = 'ROLE_PERMISSIONS_UPDATE' ORDER BY id DESC LIMIT 1");
    expect(audit.description).toBe('Permissions changed for Accountant');
    expect(JSON.parse(audit.changes)).toEqual([
      { field: 'Accountant: Change the sync schedule', old: 'not allowed', new: 'allowed' },
    ]);

    await put(admin.token, { Accountant: DEFAULTS.Accountant.filter((k) => k !== 'matching.rules') });
    expect((await schedule(accountant.token)).status).toBe(403);
    const { rows: [removal] } = await db.execute("SELECT * FROM audit_logs WHERE action_type = 'ROLE_PERMISSIONS_UPDATE' ORDER BY id DESC LIMIT 1");
    expect(JSON.parse(removal.changes)).toEqual([
      { field: 'Accountant: Change matching rules', old: 'allowed', new: 'not allowed' },
      { field: 'Accountant: Change the sync schedule', old: 'allowed', new: 'not allowed' },
    ]);
    await put(admin.token, DEFAULTS);
  });

  test('companies keep their old rule by default: Admin/Owner only, until a role is granted it', async () => {
    const viewer = await signIn('viewer');
    const patch = (token) => bearer(request(app).patch('/api/companies/999999'), token).send({ code: 'XX' });
    expect((await patch(viewer.token)).status).toBe(403);
    await put(admin.token, { Viewer: ['matching.view', 'sync.companies'] });
    expect((await patch(viewer.token)).status).toBe(404);
    await put(admin.token, DEFAULTS);
  });

  test('nonsense is refused with a reason', async () => {
    const res1 = await bearer(request(app).put('/api/settings/permissions'), admin.token).send({});
    expect(res1.status).toBe(400);
    const res2 = await put(admin.token, { Admin: [] });
    expect(res2.status).toBe(400);
    expect(res2.body.message).toMatch(/Admin and Owner always have every permission/);
    const res3 = await put(admin.token, { Viewer: ['users.manage'] });
    expect(res3.status).toBe(400);
    expect(res3.body.message).toMatch(/Unknown permission/);
  });

  test('every permission a route asks for is in the catalog, and every catalog key is used', () => {
    const routesDir = path.resolve(__dirname, '../src/routes');
    const used = new Set();
    for (const f of fs.readdirSync(routesDir)) {
      const src = fs.readFileSync(path.join(routesDir, f), 'utf8');
      for (const m of src.matchAll(/requirePermission\('([^']+)'\)/g)) used.add(m[1]);
    }
    for (const k of used) expect(KEYS.has(k)).toBe(true);
    for (const k of KEYS) expect(used.has(k)).toBe(true);
  });

  test("migration 010's CHECK lists exactly the grantable roles", () => {
    const sql = fs.readFileSync(path.resolve(__dirname, '../src/migrations/010_create_role_permissions.sql'), 'utf8');
    const inList = /CHECK \(role IN \(([^)]*)\)\)/.exec(sql)[1];
    expect(inList.split(',').map((s) => s.trim().replace(/'/g, ''))).toEqual(['Accountant', 'Viewer']);
  });
});
