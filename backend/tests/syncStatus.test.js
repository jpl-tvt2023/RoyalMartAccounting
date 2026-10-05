const request = require('supertest');
const app = require('../app');
const { db } = require('./helpers/db');
const { signIn, bearer } = require('./helpers/auth');
const {
  newAgent, agentPost, tallyCompany, voucher, enabledCompanies, backfilled,
} = require('./helpers/agent');

const status = (token) => bearer(request(app).get('/api/sync/status'), token);

let admin;

beforeAll(async () => {
  admin = await signIn('admin');
});

describe('GET /api/sync/status', () => {
  test('the Connector, Tally, and each company with sync on, for every role', async () => {
    const agent = await newAgent('Status suite PC');
    const [c] = await enabledCompanies(agent, admin, [tallyCompany({ state: 'Haryana' })]);
    const off = tallyCompany({ name: 'Not synced' });
    await backfilled(agent, c.id, { altVchId: 100, altMstId: 50, vouchers: [voucher(`${c.guid}-1`, 5)] });
    await agentPost(agent.token, '/heartbeat', {
      version: '0.2.0',
      tally: { reachable: true, educational: true, checkedAt: '2026-10-05T10:00:00Z' },
      companies: [{ ...c, altVchId: 104, altMstId: 50 }, off],
      activity: { state: 'idle' },
      lastError: null,
    });

    for (const who of ['admin', 'viewer']) {
      const { token } = await signIn(who);
      const res = await status(token);
      expect(res.status).toBe(200);
      expect(res.body.sync_from).toBe('2026-06-08');
      expect(res.body.connector).toMatchObject({
        name: 'Status suite PC', version: '0.2.0', online: true,
        tally: { reachable: true, educational: true }, activity: { state: 'idle' }, last_error: null,
      });
      expect(res.body.companies.find((x) => x.name === 'Not synced')).toBeUndefined();
      const mine = res.body.companies.find((x) => x.id === c.id);
      expect(mine).toMatchObject({
        code: 'HR', vouchers: 1, loaded_in_tally: true, pending: true, gstin: '27ABGFR0562B1ZI',
        sync: { backfillDone: true, altVchId: 100 },
        last_run: { kind: 'backfill', status: 'ok', vouchers_upserted: 1, errors: [] },
      });
    }
  });

  test('a Connector silent for more than three minutes is offline', async () => {
    await db.execute("UPDATE agents SET last_seen_at = datetime('now', '-10 minutes') WHERE last_seen_at IS NOT NULL");
    const res = await status(admin.token);
    expect(res.body.connector.online).toBe(false);
    for (const c of res.body.companies) expect(typeof c.pending).toBe('boolean');
  });

  test('needs a sign-in', async () => {
    expect((await request(app).get('/api/sync/status')).status).toBe(401);
  });
});
