const request = require('supertest');
const app = require('../app');
const { db } = require('./helpers/db');
const { signIn, bearer } = require('./helpers/auth');
const { newAgent, agentPost, tallyCompany } = require('./helpers/agent');

let admin;
let owner;
let agent;
const list = (token) => bearer(request(app).get('/api/companies'), token);
const patch = (token, id, body) => bearer(request(app).patch(`/api/companies/${id}`), token).send(body);

async function seen(overrides) {
  const c = tallyCompany(overrides);
  await agentPost(agent.token, '/heartbeat', { companies: [c] });
  const { rows: [row] } = await db.execute({ sql: 'SELECT id FROM tally_companies WHERE guid = ?', args: [c.guid] });
  return { ...c, id: Number(row.id) };
}

beforeAll(async () => {
  admin = await signIn('admin');
  owner = await signIn('owner');
  agent = await newAgent('Companies suite PC');
});

describe('GET /api/companies', () => {
  test('every role sees every company the Connector has reported, with sync off until turned on', async () => {
    const c = await seen({ name: 'Roymax Products LLP ( West Bengal )', state: 'West Bengal' });
    for (const who of ['admin', 'owner', 'accountant', 'viewer']) {
      const { token } = await signIn(who);
      const res = await list(token);
      expect(res.status).toBe(200);
      expect(res.body.find((r) => r.id === c.id)).toMatchObject({
        guid: c.guid, name: c.name, code: 'WB', state_name: 'West Bengal', books_from: '2025-04-01',
        sync_enabled: false, loaded_in_tally: true, vouchers: 0, gstin: null,
      });
    }
  });
});

describe('PATCH /api/companies/:id', () => {
  test('Admin and Owner turn sync on and off, audited; Accountant and Viewer may not', async () => {
    const c = await seen();
    const on = await patch(admin.token, c.id, { sync_enabled: true });
    expect(on.status).toBe(200);
    expect(on.body).toMatchObject({ sync_enabled: true, updated_by_name: 'Test Admin' });
    const { rows: [state] } = await db.execute({ sql: 'SELECT * FROM tally_sync_state WHERE company_id = ?', args: [c.id] });
    expect(state).toBeTruthy();

    const off = await patch(owner.token, c.id, { sync_enabled: false });
    expect(off.body.sync_enabled).toBe(false);

    const { rows: audits } = await db.execute({
      sql: "SELECT action_type, description, changes, user_id FROM audit_logs WHERE entity_type = 'tally_company' AND entity_id = ? ORDER BY id",
      args: [c.id],
    });
    expect(audits.map((a) => a.action_type)).toEqual(['TALLY_COMPANY_SEEN', 'TALLY_COMPANY_SYNC_ON', 'TALLY_COMPANY_SYNC_OFF']);
    expect(audits[1].description).toBe(`${c.name}: sync turned on`);
    expect(JSON.parse(audits[1].changes)).toEqual([{ field: 'sync_enabled', old: 0, new: 1 }]);
    expect(Number(audits[2].user_id)).toBe(owner.user.id);

    for (const who of ['accountant', 'viewer']) {
      const { token } = await signIn(who);
      expect((await patch(token, c.id, { sync_enabled: true })).status).toBe(403);
    }
  });

  test('the short code can be changed, and is validated', async () => {
    const c = await seen({ state: 'Karnataka' });
    expect((await patch(admin.token, c.id, { code: ' ka-2 ' })).body.code).toBe('KA-2');
    for (const code of ['', 'TOO-LONG-CODE', 'M H']) {
      const res = await patch(admin.token, c.id, { code });
      expect(res.status).toBe(400);
      expect(res.body.message).toBe('Code must be 1-10 letters, digits or -');
    }
    expect((await patch(admin.token, c.id, { sync_enabled: 'yes' })).status).toBe(400);
    expect((await patch(admin.token, c.id, {})).body.message).toBe('Nothing to change');
    expect((await patch(admin.token, 999999, { sync_enabled: true })).status).toBe(404);
  });

  test('the history drawer shows the trail to every role', async () => {
    const c = await seen();
    await patch(admin.token, c.id, { sync_enabled: true });
    const { token } = await signIn('viewer');
    const res = await bearer(request(app).get(`/api/audit-logs/entity?entity_type=tally_company&entity_id=${c.id}`), token);
    expect(res.status).toBe(200);
    expect(res.body.map((r) => r.action_type)).toEqual(['TALLY_COMPANY_SYNC_ON', 'TALLY_COMPANY_SEEN']);
  });
});
