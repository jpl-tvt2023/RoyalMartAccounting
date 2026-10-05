const request = require('supertest');
const app = require('../app');
const { db } = require('./helpers/db');
const { signIn, bearer } = require('./helpers/auth');
const {
  newAgent, agentPost, tallyCompany, voucher, enabledCompanies, startRun, backfilled,
} = require('./helpers/agent');

let admin;
let agent;

beforeAll(async () => {
  admin = await signIn('admin');
  agent = await newAgent('Agent suite PC');
});

const one = async (sql, args = []) => (await db.execute({ sql, args })).rows[0];
const all = async (sql, args = []) => (await db.execute({ sql, args })).rows;
const syncOf = (companyId) => one('SELECT * FROM tally_sync_state WHERE company_id = ?', [companyId]);

describe('Connector access', () => {
  test('no token, a wrong token or a retired token is refused', async () => {
    expect((await request(app).post('/api/agent/heartbeat').send({})).status).toBe(401);
    expect((await agentPost('rams_not-a-real-token', '/heartbeat')).status).toBe(401);
    const retired = await newAgent('Retired PC');
    await db.execute({ sql: 'UPDATE agents SET is_active = 0 WHERE id = ?', args: [retired.id] });
    const res = await agentPost(retired.token, '/heartbeat');
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ message: 'Connector token rejected' });
  });

  test("a user's sign-in cannot call the Connector API, and a Connector token cannot call anything else", async () => {
    expect((await agentPost(admin.token, '/heartbeat')).status).toBe(401);
    expect((await bearer(request(app).get('/api/users'), agent.token)).status).toBe(401);
    expect((await bearer(request(app).get('/api/companies'), agent.token)).status).toBe(401);
  });
});

describe('POST /api/agent/heartbeat', () => {
  test('lists every company it reports with sync off, and returns only the companies turned on', async () => {
    const on = tallyCompany({ state: 'Haryana' });
    const off = tallyCompany({ name: 'Test Company', state: 'Maharashtra' });
    const [enabled] = await enabledCompanies(agent, admin, [on]);

    const res = await agentPost(agent.token, '/heartbeat', {
      version: '0.2.0', tally: { reachable: true, educational: true }, companies: [on, off],
    });
    expect(res.status).toBe(200);
    expect(res.body.settings).toEqual({ syncFrom: '2026-06-08' });
    expect(res.body.commands).toEqual([]);
    const mine = res.body.companies.filter((c) => [on.guid, off.guid].includes(c.guid));
    expect(mine).toEqual([expect.objectContaining({ id: enabled.id, guid: on.guid, code: 'HR' })]);
    expect(mine[0].sync).toMatchObject({ backfillDone: false, altVchId: null });

    const row = await one('SELECT * FROM tally_companies WHERE guid = ?', [off.guid]);
    expect(row).toMatchObject({ name: 'Test Company', state_name: 'Maharashtra', code: 'MH', sync_enabled: 0 });
    const seen = await one("SELECT * FROM audit_logs WHERE action_type = 'TALLY_COMPANY_SEEN' AND entity_id = ?", [row.id]);
    expect(seen.description).toMatch(/found Tally company Test Company\. Its sync is off/);

    const agentRow = await one('SELECT version, status, last_seen_at FROM agents WHERE id = ?', [agent.id]);
    expect(agentRow.version).toBe('0.2.0');
    expect(agentRow.last_seen_at).toBeTruthy();
    expect(JSON.parse(agentRow.status).tally).toEqual({ reachable: true, educational: true });
  });

  test('a company re-created in Tally (new GUID) is a new row, sync off; the old row keeps its setting', async () => {
    const [old] = await enabledCompanies(agent, admin, [tallyCompany({ name: 'Roymax Recreated' })]);
    const recreated = tallyCompany({ name: 'Roymax Recreated' });
    await agentPost(agent.token, '/heartbeat', { companies: [recreated] });
    const rows = await all("SELECT guid, sync_enabled FROM tally_companies WHERE name = 'Roymax Recreated' ORDER BY id");
    expect(rows.map((r) => [r.guid, r.sync_enabled])).toEqual([[old.guid, 1], [recreated.guid, 0]]);
  });

  test('marks a company current when Tally\'s counters equal its watermarks', async () => {
    const [c] = await enabledCompanies(agent, admin, [tallyCompany()]);
    await backfilled(agent, c.id, { altVchId: 300, altMstId: 40 });
    await agentPost(agent.token, '/heartbeat', { companies: [{ ...c, altVchId: 301, altMstId: 40 }] });
    expect((await syncOf(c.id)).last_checked_at).toBeNull();
    await agentPost(agent.token, '/heartbeat', { companies: [{ ...c, altVchId: 300, altMstId: 40 }] });
    expect((await syncOf(c.id)).last_checked_at).toBeTruthy();
  });
});

describe('POST /api/agent/runs', () => {
  test('refuses a company whose sync is off, an unknown company and a bad request', async () => {
    const off = tallyCompany();
    await agentPost(agent.token, '/heartbeat', { companies: [off] });
    const { id } = await one('SELECT id FROM tally_companies WHERE guid = ?', [off.guid]);
    const res = await agentPost(agent.token, '/runs', { company_id: id, kind: 'backfill', altVchId: 1, altMstId: 1 });
    expect(res.status).toBe(409);
    expect(res.body.message).toBe(`Sync is turned off for ${off.name}`);
    expect((await agentPost(agent.token, '/runs', { company_id: 999999, kind: 'light', altVchId: 1, altMstId: 1 })).status).toBe(404);
    expect((await agentPost(agent.token, '/runs', { company_id: id, kind: 'everything', altVchId: 1, altMstId: 1 })).status).toBe(400);
    expect((await agentPost(agent.token, '/runs', { company_id: id, kind: 'light' })).status).toBe(400);
  });

  test('light and heavy wait for the backfill; a finished backfill cannot be started again', async () => {
    const [c] = await enabledCompanies(agent, admin, [tallyCompany()]);
    const light = await agentPost(agent.token, '/runs', { company_id: c.id, kind: 'light', altVchId: 1, altMstId: 1 });
    expect(light.status).toBe(409);
    expect(light.body.message).toBe('The backfill has not finished yet');
    await backfilled(agent, c.id);
    const again = await agentPost(agent.token, '/runs', { company_id: c.id, kind: 'backfill', altVchId: 1, altMstId: 1 });
    expect(again.status).toBe(409);
    expect(again.body.message).toMatch(/already complete/);
  });

  test('a run left open by a crashed Connector is closed as failed when the next one starts', async () => {
    const [c] = await enabledCompanies(agent, admin, [tallyCompany()]);
    const first = await startRun(agent, c.id, 'backfill');
    const second = await startRun(agent, c.id, 'backfill');
    const old = await one('SELECT status, errors FROM tally_sync_runs WHERE id = ?', [first]);
    expect(old.status).toBe('failed');
    expect(JSON.parse(old.errors)[0]).toMatch(/Abandoned/);
    expect((await agentPost(agent.token, `/runs/${first}/vouchers`, { vouchers: [voucher('x', 1)] })).status).toBe(409);
    expect((await one('SELECT status FROM tally_sync_runs WHERE id = ?', [second])).status).toBe('running');
  });

  test("a run belongs to its Connector, and stops when the company's sync is turned off", async () => {
    const [c] = await enabledCompanies(agent, admin, [tallyCompany()]);
    const run = await startRun(agent, c.id, 'backfill');
    const other = await newAgent('Another PC');
    expect((await agentPost(other.token, `/runs/${run}/finish`, { ok: true })).status).toBe(403);
    await bearer(request(app).patch(`/api/companies/${c.id}`), admin.token).send({ sync_enabled: false });
    const res = await agentPost(agent.token, `/runs/${run}/vouchers`, { vouchers: [voucher(`${c.guid}-v`, 1)] });
    expect(res.status).toBe(409);
    expect(res.body.message).toBe(`Sync was turned off for ${c.name}`);
  });
});

describe('POST /api/agent/runs/:id/vouchers', () => {
  test('stores a voucher with all its lines, money in paise', async () => {
    const [c] = await enabledCompanies(agent, admin, [tallyCompany()]);
    const run = await startRun(agent, c.id, 'backfill');
    const v = voucher(`${c.guid}-607`, 10);
    const res = await agentPost(agent.token, `/runs/${run}/vouchers`, { vouchers: [v] });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ upserted: 1, skippedOlder: 0 });

    const row = await one('SELECT * FROM tally_vouchers WHERE company_id = ? AND guid = ?', [c.id, v.guid]);
    expect(row).toMatchObject({
      alter_id: 10, date: '2026-07-01', voucher_type: 'Sales', base_type: 'Sales', number: '607/RM/26-27',
      party: 'Blinkit Commerce', is_invoice: 1, total_paise: 118050, deleted_at: null, last_run_id: run,
    });
    const lines = await all('SELECT line_no, ledger, amount_paise, is_party, is_debit FROM tally_vch_ledger_lines WHERE voucher_id = ? ORDER BY line_no', [row.id]);
    expect(lines.map((l) => [l.ledger, l.amount_paise, l.is_party, l.is_debit])).toEqual([
      ['Blinkit Commerce', -118050, 1, 1], ['Sales GST 18%', 100043, 0, 0], ['IGST', 18007, 0, 0],
    ]);
    const [bill] = await all('SELECT * FROM tally_vch_bill_allocations WHERE voucher_id = ?', [row.id]);
    expect(bill).toMatchObject({ line_no: 0, ledger: 'Blinkit Commerce', name: '607/RM/26-27', bill_type: 'New Ref', amount_paise: -118050 });
    const [item] = await all('SELECT * FROM tally_vch_inventory_lines WHERE voucher_id = ?', [row.id]);
    expect(item).toMatchObject({ item: v.inventoryLines[0].item, qty: 10, unit: 'Pcs', rate: 100.043, amount_paise: 100043 });
    expect(JSON.parse(item.order_nos)).toEqual(['P4588464']);
    const [order] = await all('SELECT * FROM tally_vch_orders WHERE voucher_id = ?', [row.id]);
    expect(order).toMatchObject({ order_no: 'P4588464', order_date: '2026-06-28' });
    expect((await one('SELECT vouchers_upserted FROM tally_sync_runs WHERE id = ?', [run])).vouchers_upserted).toBe(1);
  });

  test('sending the same batch again duplicates nothing, and a newer copy replaces every line', async () => {
    const [c] = await enabledCompanies(agent, admin, [tallyCompany()]);
    const run = await startRun(agent, c.id, 'backfill');
    const v = voucher(`${c.guid}-608`, 10);
    await agentPost(agent.token, `/runs/${run}/vouchers`, { vouchers: [v] });
    await agentPost(agent.token, `/runs/${run}/vouchers`, { vouchers: [v] });
    const edited = voucher(v.guid, 11, {
      narration: 'edited',
      orders: [],
      ledgerLines: [{ ledger: 'Blinkit Commerce', amount: -500, isParty: true, debit: true, bills: [] },
        { ledger: 'Sales GST 18%', amount: 500, debit: false, bills: [] }],
      inventoryLines: [],
    });
    await agentPost(agent.token, `/runs/${run}/vouchers`, { vouchers: [edited] });

    const rows = await all('SELECT id, alter_id, narration FROM tally_vouchers WHERE company_id = ? AND guid = ?', [c.id, v.guid]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ alter_id: 11, narration: 'edited' });
    const count = async (table) => Number((await one(`SELECT COUNT(*) AS n FROM ${table} WHERE voucher_id = ?`, [rows[0].id])).n);
    expect(await count('tally_vch_ledger_lines')).toBe(2);
    expect(await count('tally_vch_bill_allocations')).toBe(0);
    expect(await count('tally_vch_inventory_lines')).toBe(0);
    expect(await count('tally_vch_orders')).toBe(0);
  });

  test('a copy older than the stored one (lower AlterID) is skipped', async () => {
    const [c] = await enabledCompanies(agent, admin, [tallyCompany()]);
    const run = await startRun(agent, c.id, 'backfill');
    await agentPost(agent.token, `/runs/${run}/vouchers`, { vouchers: [voucher(`${c.guid}-1`, 20, { narration: 'new' })] });
    const res = await agentPost(agent.token, `/runs/${run}/vouchers`, { vouchers: [voucher(`${c.guid}-1`, 19, { narration: 'old' })] });
    expect(res.body).toEqual({ upserted: 0, skippedOlder: 1 });
    expect((await one('SELECT narration FROM tally_vouchers WHERE guid = ?', [`${c.guid}-1`])).narration).toBe('new');
  });

  test('refuses an empty or oversized batch and a voucher without its keys', async () => {
    const [c] = await enabledCompanies(agent, admin, [tallyCompany()]);
    const run = await startRun(agent, c.id, 'backfill');
    const post = (vouchers) => agentPost(agent.token, `/runs/${run}/vouchers`, { vouchers });
    expect((await post([])).status).toBe(400);
    const many = Array.from({ length: 251 }, (_, i) => voucher(`${c.guid}-${i}`, 1));
    expect((await post(many)).body.message).toBe('At most 250 vouchers at a time');
    expect((await post([voucher('', 1)])).body.message).toBe('vouchers[0] has no GUID');
    expect((await post([voucher('g1', null)])).body.message).toMatch(/has no AlterID/);
    expect((await post([voucher('g1', 1, { date: '01-07-2026' })])).body.message).toMatch(/has no date/);
  });

  test("learns the company's GSTIN from its vouchers, and refuses another company's", async () => {
    const [c] = await enabledCompanies(agent, admin, [tallyCompany()]);
    const run = await startRun(agent, c.id, 'backfill');
    await agentPost(agent.token, `/runs/${run}/vouchers`, { vouchers: [voucher(`${c.guid}-a`, 1, { cmpGstin: '' })] });
    expect((await one('SELECT gstin FROM tally_companies WHERE id = ?', [c.id])).gstin).toBeNull();
    await agentPost(agent.token, `/runs/${run}/vouchers`, { vouchers: [voucher(`${c.guid}-b`, 2)] });
    expect((await one('SELECT gstin FROM tally_companies WHERE id = ?', [c.id])).gstin).toBe('27ABGFR0562B1ZI');
    expect(await one("SELECT * FROM audit_logs WHERE action_type = 'TALLY_COMPANY_GSTIN' AND entity_id = ?", [c.id])).toBeTruthy();

    const wrong = await agentPost(agent.token, `/runs/${run}/vouchers`, { vouchers: [voucher(`${c.guid}-c`, 3, { cmpGstin: '06ABGFR0562B1ZM' })] });
    expect(wrong.status).toBe(400);
    expect(wrong.body.message).toMatch(/carry company GSTIN 06ABGFR0562B1ZM, but .* is 27ABGFR0562B1ZI/);
    const mixed = await agentPost(agent.token, `/runs/${run}/vouchers`, {
      vouchers: [voucher(`${c.guid}-d`, 4), voucher(`${c.guid}-e`, 5, { cmpGstin: '19ABGFR0562B1ZF' })],
    });
    expect(mixed.status).toBe(400);
    expect(await one('SELECT id FROM tally_vouchers WHERE guid = ?', [`${c.guid}-d`])).toBeUndefined();
  });
});

describe('POST /api/agent/runs/:id/masters', () => {
  const ledger = (guid, name, alterId = 1) => ({ guid, name, parent: 'Sundry Debtors', gstins: ['06AAICB1234C1Z5'], state: 'Haryana', billWise: true, alterId });

  test('stores complete lists, marks what a later list lacks as deleted, and restores it when it returns', async () => {
    const [c] = await enabledCompanies(agent, admin, [tallyCompany()]);
    let run = await startRun(agent, c.id, 'backfill');
    const first = await agentPost(agent.token, `/runs/${run}/masters`, {
      ledgers: [ledger('L1', 'Blinkit'), ledger('L2', 'Zepto')],
      groups: [{ guid: 'G1', name: 'Sundry Debtors', parent: 'Current Assets', alterId: 1 }],
      stockItems: [{ guid: 'S1', name: 'RMWB003001', baseUnits: 'Pcs', hsn: '6505', alterId: 1 }],
      voucherTypes: [{ guid: 'T1', name: 'Sales', parent: 'Sales', reserved: 'Sales', active: true, alterId: 1 }],
    });
    expect(first.body).toEqual({ upserted: 5, unchanged: 0, deleted: 0, renamed: 0 });
    expect(await one('SELECT gstin, gstins, is_bill_wise FROM tally_ledgers WHERE company_id = ? AND guid = ?', [c.id, 'L1']))
      .toMatchObject({ gstin: '06AAICB1234C1Z5', gstins: '["06AAICB1234C1Z5"]', is_bill_wise: 1 });

    // Only ledgers this time: the other kinds are left alone.
    const second = await agentPost(agent.token, `/runs/${run}/masters`, { ledgers: [ledger('L1', 'Blinkit')] });
    expect(second.body).toEqual({ upserted: 0, unchanged: 1, deleted: 1, renamed: 0 });
    expect((await one('SELECT deleted_at FROM tally_ledgers WHERE guid = ? AND company_id = ?', ['L2', c.id])).deleted_at).toBeTruthy();
    expect((await one('SELECT deleted_at FROM tally_groups WHERE guid = ? AND company_id = ?', ['G1', c.id])).deleted_at).toBeNull();

    await agentPost(agent.token, `/runs/${run}/finish`, { ok: true });
    run = await startRun(agent, c.id, 'backfill');
    await agentPost(agent.token, `/runs/${run}/masters`, { ledgers: [ledger('L1', 'Blinkit'), ledger('L2', 'Zepto')] });
    expect((await one('SELECT deleted_at FROM tally_ledgers WHERE guid = ? AND company_id = ?', ['L2', c.id])).deleted_at).toBeNull();
  });

  test('a renamed ledger after the backfill marks the company for a resync, but not during a fresh backfill', async () => {
    const [c] = await enabledCompanies(agent, admin, [tallyCompany()]);
    let run = await startRun(agent, c.id, 'backfill');
    await agentPost(agent.token, `/runs/${run}/masters`, { ledgers: [ledger('L1', 'Blinkit')] });
    await agentPost(agent.token, `/runs/${run}/masters`, { ledgers: [ledger('L1', 'Blinkit Commerce', 2)] });
    expect((await syncOf(c.id)).needs_resync).toBe(0);
    await agentPost(agent.token, `/runs/${run}/reconcile`, { from: '2026-07-01', to: '2026-07-31', vouchers: [] });
    await agentPost(agent.token, `/runs/${run}/finish`, { ok: true, backfillDone: true });

    run = await startRun(agent, c.id, 'light');
    const res = await agentPost(agent.token, `/runs/${run}/masters`, { ledgers: [ledger('L1', 'Blinkit India', 3)] });
    expect(res.body.renamed).toBe(1);
    expect((await syncOf(c.id)).needs_resync).toBe(1);
  });

  test('refuses a list with a record that has no GUID', async () => {
    const [c] = await enabledCompanies(agent, admin, [tallyCompany()]);
    const run = await startRun(agent, c.id, 'backfill');
    const res = await agentPost(agent.token, `/runs/${run}/masters`, { ledgers: [ledger('', 'No GUID')] });
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('ledgers: 1 record(s) without a GUID or name');
  });
});

describe('POST /api/agent/runs/:id/reconcile', () => {
  test("marks deleted only this company's vouchers in that period that Tally no longer has, and reports what RAMS lacks", async () => {
    const [c, other] = await enabledCompanies(agent, admin, [tallyCompany(), tallyCompany()]);
    const run = await startRun(agent, c.id, 'backfill');
    await agentPost(agent.token, `/runs/${run}/vouchers`, {
      vouchers: [
        voucher(`${c.guid}-keep`, 5), voucher(`${c.guid}-gone`, 6), voucher(`${c.guid}-old`, 7),
        voucher(`${c.guid}-aug`, 8, { date: '2026-08-01' }),
      ],
    });
    const otherRun = await startRun(agent, other.id, 'backfill');
    await agentPost(agent.token, `/runs/${otherRun}/vouchers`, { vouchers: [voucher(`${other.guid}-x`, 1)] });

    const res = await agentPost(agent.token, `/runs/${run}/reconcile`, {
      from: '2026-07-01', to: '2026-07-31',
      vouchers: [{ guid: `${c.guid}-keep`, alterId: 5 }, { guid: `${c.guid}-old`, alterId: 9 }, { guid: `${c.guid}-new`, alterId: 10 }],
    });
    expect(res.body).toEqual({ deleted: 1, missing: 1, stale: 1 });
    const live = await all('SELECT guid FROM tally_vouchers WHERE company_id = ? AND deleted_at IS NULL ORDER BY guid', [c.id]);
    expect(live.map((r) => r.guid)).toEqual([`${c.guid}-aug`, `${c.guid}-keep`, `${c.guid}-old`]);
    expect((await one('SELECT deleted_at FROM tally_vouchers WHERE guid = ?', [`${other.guid}-x`])).deleted_at).toBeNull();
    expect((await syncOf(c.id)).backfill_through).toBe('2026-07-31');

    // A deleted voucher that comes back in a pull is restored.
    await agentPost(agent.token, `/runs/${run}/vouchers`, { vouchers: [voucher(`${c.guid}-gone`, 6)] });
    expect((await one('SELECT deleted_at FROM tally_vouchers WHERE guid = ?', [`${c.guid}-gone`])).deleted_at).toBeNull();
  });

  test('refuses a bad period', async () => {
    const [c] = await enabledCompanies(agent, admin, [tallyCompany()]);
    const run = await startRun(agent, c.id, 'backfill');
    const res = await agentPost(agent.token, `/runs/${run}/reconcile`, { from: '2026-07-31', to: '2026-07-01', vouchers: [] });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/agent/runs/:id/finish', () => {
  test('the watermarks move only when a run ends ok, to the counters it started with', async () => {
    const [c] = await enabledCompanies(agent, admin, [tallyCompany()]);
    await backfilled(agent, c.id, { altVchId: 100, altMstId: 50 });
    expect(await syncOf(c.id)).toMatchObject({ alt_vch_id: 100, alt_mst_id: 50, backfill_done: 1 });

    let run = await startRun(agent, c.id, 'light', 120, 55);
    const failed = await agentPost(agent.token, `/runs/${run}/finish`, { ok: false, errors: ['Tally stopped answering'] });
    expect(failed.body.sync).toMatchObject({ altVchId: 100, altMstId: 50 });
    expect(await one('SELECT status, errors FROM tally_sync_runs WHERE id = ?', [run]))
      .toMatchObject({ status: 'failed', errors: '["Tally stopped answering"]' });

    run = await startRun(agent, c.id, 'light', 120, 55);
    const ok = await agentPost(agent.token, `/runs/${run}/finish`, { ok: true });
    expect(ok.body.sync).toMatchObject({ altVchId: 120, altMstId: 55 });
    expect(ok.body.sync.lastLightAt).toBeTruthy();

    run = await startRun(agent, c.id, 'heavy', 130, 55);
    const heavy = await agentPost(agent.token, `/runs/${run}/finish`, { ok: true });
    expect(heavy.body.sync).toMatchObject({ altVchId: 130 });
    expect(heavy.body.sync.lastHeavyAt).toBeTruthy();
    expect((await agentPost(agent.token, `/runs/${run}/finish`, { ok: true })).status).toBe(409);
  });

  test('a backfill resumes after its last reconciled month and ends on the counters from when it began', async () => {
    const [c] = await enabledCompanies(agent, admin, [tallyCompany()]);
    let run = await startRun(agent, c.id, 'backfill', 200, 60);
    await agentPost(agent.token, `/runs/${run}/reconcile`, { from: '2026-06-08', to: '2026-06-30', vouchers: [] });
    await agentPost(agent.token, `/runs/${run}/finish`, { ok: false, errors: ['interrupted'] });
    expect(await syncOf(c.id)).toMatchObject({ backfill_through: '2026-06-30', backfill_done: 0, alt_vch_id: null });

    const resumed = await agentPost(agent.token, '/runs', { company_id: c.id, kind: 'backfill', altVchId: 230, altMstId: 61 });
    expect(resumed.body.sync).toMatchObject({ backfillThrough: '2026-06-30' });
    run = resumed.body.run_id;
    await agentPost(agent.token, `/runs/${run}/reconcile`, { from: '2026-07-01', to: '2026-07-31', vouchers: [] });
    const done = await agentPost(agent.token, `/runs/${run}/finish`, { ok: true, backfillDone: true });
    expect(done.body.sync).toMatchObject({ backfillDone: true, backfillThrough: '2026-07-31', altVchId: 200, altMstId: 60 });
  });

  test('a resync forgets the watermarks and the progress, then ends like a backfill', async () => {
    const [c] = await enabledCompanies(agent, admin, [tallyCompany()]);
    await backfilled(agent, c.id, { altVchId: 500, altMstId: 90 });
    await db.execute({ sql: 'UPDATE tally_sync_state SET needs_resync = 1 WHERE company_id = ?', args: [c.id] });

    const started = await agentPost(agent.token, '/runs', { company_id: c.id, kind: 'resync', altVchId: 20, altMstId: 10 });
    expect(started.body.sync).toMatchObject({ altVchId: null, backfillThrough: null, backfillDone: false, needsResync: false });
    const run = started.body.run_id;
    await agentPost(agent.token, `/runs/${run}/reconcile`, { from: '2026-07-01', to: '2026-07-31', vouchers: [] });
    const done = await agentPost(agent.token, `/runs/${run}/finish`, { ok: true, backfillDone: true });
    expect(done.body.sync).toMatchObject({ backfillDone: true, altVchId: 20, altMstId: 10 });
  });
});
