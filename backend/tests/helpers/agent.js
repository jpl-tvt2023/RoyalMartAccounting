const request = require('supertest');
const app = require('../../app');
const { db } = require('./db');
const { agentToken } = require('../../src/seeds/agentToken');
const { bearer } = require('./auth');

// A Connector of its own for a suite: { token, id }.
async function newAgent(name = 'Test PC') {
  const { token, id } = await agentToken(db, { name });
  return { token, id };
}

// POST /api/agent/<path> as that Connector.
const agentPost = (token, path, body = {}) => bearer(request(app).post(`/api/agent${path}`), token).send(body);

// A Tally company as the Connector reports it. GUIDs are unique per call, so
// suites sharing the test database never collide.
let n = 0;
function tallyCompany(overrides = {}) {
  n += 1;
  return {
    guid: `cmp-${Date.now().toString(36)}-${n}`,
    name: `Roymax Products LLP ( Test ${n} )`,
    state: 'Maharashtra',
    booksFrom: '2025-04-01',
    altVchId: 100,
    altMstId: 50,
    ...overrides,
  };
}

// A sales invoice as the Connector's voucherFrom gives it.
function voucher(guid, alterId, overrides = {}) {
  return {
    guid,
    masterId: alterId,
    alterId,
    date: '2026-07-01',
    type: 'Sales',
    baseType: 'Sales',
    number: '607/RM/26-27',
    reference: '',
    referenceDate: '',
    party: 'Blinkit Commerce',
    partyGstin: '06AAICB1234C1Z5',
    cmpGstin: '27ABGFR0562B1ZI',
    narration: 'PO P4588464',
    cancelled: false,
    optional: false,
    invoice: true,
    total: 1180.5,
    orders: [{ no: 'P4588464', date: '2026-06-28' }],
    ledgerLines: [
      { ledger: 'Blinkit Commerce', amount: -1180.5, isParty: true, debit: true,
        bills: [{ name: '607/RM/26-27', type: 'New Ref', amount: -1180.5 }] },
      { ledger: 'Sales GST 18%', amount: 1000.43, isParty: false, debit: false, bills: [] },
      { ledger: 'IGST', amount: 180.07, isParty: false, debit: false, bills: [] },
    ],
    inventoryLines: [
      { item: 'RMWB003001 ITEM CODE-10192283 PID-611318', qty: 10, unit: 'Pcs', rate: 100.043, amount: 1000.43,
        direction: '', godowns: ['Main Location'], orderNos: ['P4588464'] },
    ],
    ...overrides,
  };
}

// Reports `companies` in a heartbeat, then has an Admin turn each one's sync
// on. Returns the companies with their RAMS ids.
async function enabledCompanies(agent, admin, companies) {
  const hb = await agentPost(agent.token, '/heartbeat', { version: 'test', companies });
  if (hb.status !== 200) throw new Error(`heartbeat ${hb.status} ${hb.body.message}`);
  const out = [];
  for (const c of companies) {
    const { rows: [row] } = await db.execute({ sql: 'SELECT id FROM tally_companies WHERE guid = ?', args: [c.guid] });
    const res = await bearer(request(app).patch(`/api/companies/${row.id}`), admin.token).send({ sync_enabled: true });
    if (res.status !== 200) throw new Error(`enable ${res.status} ${res.body.message}`);
    out.push({ ...c, id: Number(row.id) });
  }
  return out;
}

// Starts a run and returns its id.
async function startRun(agent, companyId, kind, altVchId = 100, altMstId = 50) {
  const res = await agentPost(agent.token, '/runs', { company_id: companyId, kind, altVchId, altMstId });
  if (res.status !== 201) throw new Error(`start ${kind} ${res.status} ${res.body.message}`);
  return res.body.run_id;
}

// Takes a company through a complete backfill of one month, so light and
// heavy runs are allowed. Returns the sync state.
async function backfilled(agent, companyId, { altVchId = 100, altMstId = 50, vouchers = [] } = {}) {
  const run = await startRun(agent, companyId, 'backfill', altVchId, altMstId);
  if (vouchers.length) await agentPost(agent.token, `/runs/${run}/vouchers`, { vouchers });
  await agentPost(agent.token, `/runs/${run}/reconcile`, {
    from: '2026-07-01', to: '2026-07-31', vouchers: vouchers.map((v) => ({ guid: v.guid, alterId: v.alterId })),
  });
  const res = await agentPost(agent.token, `/runs/${run}/finish`, { ok: true, backfillDone: true });
  return res.body.sync;
}

module.exports = { newAgent, agentPost, tallyCompany, voucher, enabledCompanies, startRun, backfilled };
