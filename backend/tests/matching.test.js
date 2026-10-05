const request = require('supertest');
const app = require('../app');
const { db } = require('./helpers/db');
const { signIn, bearer } = require('./helpers/auth');
const {
  newAgent, agentPost, tallyCompany, voucher, enabledCompanies, startRun,
} = require('./helpers/agent');
const { startFakeRoms, emptyRefs, po, line, rtv } = require('./helpers/roms');

// The Matching API end to end: Tally data pushed by a Connector, ROMS read
// from a fake ROMS, matched, then reviewed and tuned by people. Numbers carry
// an MT prefix so other suites' vouchers in the shared database never match.
const get = (token, path) => bearer(request(app).get(`/api/matching${path}`), token);
const post = (token, path, body = {}) => bearer(request(app).post(`/api/matching${path}`), token).send(body);
const put = (token, path, body = {}) => bearer(request(app).put(`/api/matching${path}`), token).send(body);

let admin; let accountant; let viewer; let agent; let roms; let company;
const inv = {};

const sale = (key, number, orders, overrides = {}) => {
  const v = voucher(`mt-${key}`, 10, {
    number,
    party: 'MT BLINK COMMERCE',
    orders: orders.map((no) => ({ no, date: '2026-07-01' })),
    inventoryLines: [{ item: 'MT BOTTLE ITEM CODE-10192283', qty: 10, unit: 'Pcs', rate: 100, amount: 1000, direction: '', godowns: [], orderNos: [] }],
    ledgerLines: [{ ledger: 'MT BLINK COMMERCE', amount: -1180, isParty: true, debit: true, bills: [{ name: number, type: 'New Ref', amount: -1180 }] }],
    ...overrides,
  });
  inv[key] = v;
  return v;
};
const creditNote = (key, number, against) => {
  const v = voucher(`mt-${key}`, 10, {
    number, type: 'Credit Note', baseType: 'Credit Note', date: '2026-07-20', party: 'MT BLINK COMMERCE', orders: [], inventoryLines: [],
    ledgerLines: [{ ledger: 'MT BLINK COMMERCE', amount: 500, isParty: true, debit: false, bills: [{ name: against, type: 'Agst Ref', amount: 500 }] }],
  });
  inv[key] = v;
  return v;
};

function romsData() {
  const data = emptyRefs();
  data.vendors = [{ name: 'Blinkit', is_active: 1 }, { name: 'Zepto', is_active: 1 }, { name: 'Flipkart', is_active: 1 }];
  data.products = [{ id: 1, sku_code: 'WB003', description: 'Bottle', category: 'Home' }];
  data['vendor-codes'] = [{ id: 1, vendor: 'Blinkit', vendor_item_code: '10192283', product_id: 1, sku_code: 'WB003' }];
  data.pos = [
    po('MT1', { vendor_po_id: 'MTP-1', bill_no: '601' }), // linked, typed serial
    po('MT2', { vendor_po_id: 'MTP-2' }), // linked, blank Bill No
    po('MT3', { vendor_po_id: 'MTP-3', bill_no: '1819', grn_status: 'Returned to Vendor' }), // Bill No differs
    po('MT4', { vendor_po_id: 'MTP-4' }), // not invoiced yet
    po('MT5', { vendor: 'Flipkart', vendor_po_id: 'MTP-5' }), // stock transfer
    po('MT6', { vendor_po_id: 'MTP-6', grn_status: 'Returned to Vendor' }), // with a credit note
  ];
  data.lines = data.pos.map((p) => line(p.po_id, 1, { item_code: '10192283', sku_code: 'WB003' }));
  data.rtv = [rtv('MT6', { id: 9001, rtv_no: 'MT-RTV-1' })];
  return data;
}

const resultOf = async (token, kind, id) => (await get(token, `/results/${kind}/${id}`)).body;

beforeAll(async () => {
  [admin, accountant, viewer] = await Promise.all([signIn('admin'), signIn('accountant'), signIn('viewer')]);
  agent = await newAgent('Matching suite PC');
  [company] = await enabledCompanies(agent, admin, [tallyCompany({ state: 'Haryana' })]);
  const run = await startRun(agent, company.id, 'backfill');
  await agentPost(agent.token, `/runs/${run}/masters`, {
    ledgers: [
      { guid: 'MTL1', name: 'MT BLINK COMMERCE', parent: 'Sundry Debtors', gstins: ['06AAICB1234C1Z5'], state: 'Haryana', billWise: true, alterId: 1 },
      { guid: 'MTL2', name: 'MT ROYMAX (MUMBAI)', parent: 'Sundry Debtors', gstins: ['27ABGFR0562B1ZI'], state: 'Maharashtra', billWise: true, alterId: 1 },
    ],
    groups: [],
    stockItems: [{ guid: 'MTS1', name: 'MT BOTTLE ITEM CODE-10192283', baseUnits: 'Pcs', alterId: 1 }],
    voucherTypes: [],
  });
  const vouchers = [
    sale('601', '601/MT/26-27', ['MTP-1']),
    sale('602', 'MT602/RM/26-27', ['MTP-2']),
    sale('1219', 'MT1219/RM/26-27', ['MTP-3']),
    sale('1819', 'MT1819/RM/26-27', []),
    sale('606', 'MT606/RM/26-27', ['MTP-6']),
    creditNote('cn835', 'MT835', 'MT606/RM/26-27'),
  ];
  await agentPost(agent.token, `/runs/${run}/vouchers`, { vouchers });
  await agentPost(agent.token, `/runs/${run}/reconcile`, { from: '2026-07-01', to: '2026-07-31', vouchers: vouchers.map((v) => ({ guid: v.guid, alterId: v.alterId })) });
  await agentPost(agent.token, `/runs/${run}/finish`, { ok: true, backfillDone: true });

  roms = await startFakeRoms(romsData());
  process.env.ROMS_API_URL = roms.url;
  process.env.ROMS_INTEGRATION_TOKEN = roms.token;
});

afterAll(async () => {
  delete process.env.ROMS_API_URL;
  delete process.env.ROMS_INTEGRATION_TOKEN;
  await roms.close();
  await db.execute("UPDATE match_runs SET status = 'failed' WHERE status = 'running'");
});

describe('running a match', () => {
  test('Match now reads ROMS and links each PO, with the reason in a code the page words', async () => {
    const res = await post(accountant.token, '/run');
    expect(res.status).toBe(200);
    expect(res.body.roms).toMatchObject({ ok: true, connected: true });
    expect(res.body.summary.last_run).toMatchObject({ status: 'ok', trigger: 'manual', by: 'Test Accountant', roms_ok: true });

    expect(await resultOf(viewer.token, 'po', 'MT1')).toMatchObject({
      outcome: 'linked', method: 'order_no', voucher_number: '601/MT/26-27',
      fill: { field: 'bill_no', current: '601', value: '601/MT/26-27', kind: 'replace' },
    });
    expect(await resultOf(viewer.token, 'po', 'MT2')).toMatchObject({
      outcome: 'linked', method: 'order_no', voucher_number: 'MT602/RM/26-27', company: 'HR',
      fill: { field: 'bill_no', current: null, value: 'MT602/RM/26-27', kind: 'fill' },
    });
    expect(await resultOf(viewer.token, 'po', 'MT3')).toMatchObject({ outcome: 'review', reason: 'bill_differs', params: { typed: '1819', number: 'MT1219/RM/26-27' } });
    expect(await resultOf(viewer.token, 'po', 'MT4')).toMatchObject({ outcome: 'waiting', reason: 'not_invoiced' });
    expect(await resultOf(viewer.token, 'po', 'MT5')).toMatchObject({ outcome: 'not_matched', reason: 'vendor_transfer' });
    expect(await resultOf(viewer.token, 'rtv', 9001)).toMatchObject({
      outcome: 'linked', method: 'agst_ref', voucher_number: 'MT835', po_id: 'MT6',
      fill: { field: 'cn_number', value: 'MT835', kind: 'fill' }, rtv: { rtv_no: 'MT-RTV-1' },
    });

    const detail = await resultOf(viewer.token, 'po', 'MT3');
    expect(detail.candidates.map((c) => c.number)).toEqual(['MT1219/RM/26-27']);
    expect(detail.lines).toEqual([expect.objectContaining({ item_code: '10192283', sku_code: 'WB003' })]);
    expect(detail.rtv_rows).toEqual([expect.objectContaining({ rtv_no: expect.any(String) })].slice(0, detail.rtv_rows.length));
  });

  test('lists filter by status, reason, vendor and a search', async () => {
    const review = await get(viewer.token, '/results?kind=po&outcome=review&q=MT');
    expect(review.body.rows.map((r) => r.id)).toEqual(['MT3']);
    const search = await get(viewer.token, '/results?kind=po&q=MT602');
    expect(search.body.rows.map((r) => r.id)).toEqual(['MT2']);
    const byVendor = await get(viewer.token, '/results?kind=po&vendor=Flipkart&q=MT');
    expect(byVendor.body.rows.map((r) => r.id)).toEqual(['MT5']);
    const summary = await get(viewer.token, '/summary');
    expect(summary.body.counts.po.linked).toBeGreaterThanOrEqual(3);
    expect(summary.body.reasons.po.bill_differs).toBeGreaterThanOrEqual(1);
    expect(summary.body.roms.last_ok_at).toBeTruthy();
  });

  test('one run at a time; a run that never finished is closed after 10 minutes', async () => {
    await db.execute("INSERT INTO match_runs (trigger, status) VALUES ('cli', 'running')");
    const busy = await post(admin.token, '/run');
    expect(busy.status).toBe(409);
    expect(busy.body.message).toMatch(/already running/);
    await db.execute("UPDATE match_runs SET started_at = datetime('now', '-11 minutes') WHERE status = 'running'");
    expect((await post(admin.token, '/run')).status).toBe(200);
    const { rows: [old] } = await db.execute("SELECT status, error FROM match_runs WHERE trigger = 'cli' ORDER BY id DESC LIMIT 1");
    expect(old).toMatchObject({ status: 'failed', error: 'Abandoned: it never finished' });
  });

  test('the heartbeat asks the Connector for a match after Tally changes, and /agent/match runs it', async () => {
    const quiet = await agentPost(agent.token, '/heartbeat', {});
    expect(quiet.body.commands.filter((c) => c.why === 'Tally changed since the last match')).toEqual([]);

    const run = await startRun(agent, company.id, 'light', 120, 50);
    await agentPost(agent.token, `/runs/${run}/vouchers`, { vouchers: [sale('604', 'MT604/RM/26-27', ['MTP-4'])] });
    await agentPost(agent.token, `/runs/${run}/finish`, { ok: true });
    const hb = await agentPost(agent.token, '/heartbeat', {});
    expect(hb.body.commands).toContainEqual({ type: 'match', why: 'Tally changed since the last match' });

    const matched = await agentPost(agent.token, '/match', {});
    expect(matched.status).toBe(200);
    expect(await resultOf(viewer.token, 'po', 'MT4')).toMatchObject({ outcome: 'linked', voucher_number: 'MT604/RM/26-27' });
    const after = await agentPost(agent.token, '/heartbeat', {});
    expect(after.body.commands.filter((c) => c.why === 'Tally changed since the last match')).toEqual([]);
  });
});

describe('people decide', () => {
  test('pick the right invoice for a PO that needs review; undo goes back to automatic', async () => {
    const picked = await post(accountant.token, '/results/po/MT3/pick', { company_id: company.id, voucher_guid: inv['1819'].guid });
    expect(picked.status).toBe(200);
    expect(picked.body).toMatchObject({ outcome: 'linked', method: 'person', voucher_number: 'MT1819/RM/26-27', person: { by: 'Test Accountant' } });
    const { rows: [audit] } = await db.execute("SELECT * FROM audit_logs WHERE action_type = 'MATCH_PICK' ORDER BY id DESC LIMIT 1");
    expect(audit).toMatchObject({ entity_type: 'po', entity_ref: 'MT3' });
    expect(audit.description).toMatch(/^Picked invoice MT1819\/RM\/26-27 \(HR, 2026-07-01\) for PO MT3$/);

    const undone = await post(accountant.token, '/results/po/MT3/undo');
    expect(undone.body).toMatchObject({ outcome: 'review', reason: 'bill_differs' });
  });

  test('reject a link and it is never proposed again; confirm keeps it whatever the rules', async () => {
    const rejected = await post(accountant.token, '/results/po/MT2/reject');
    expect(rejected.body).toMatchObject({ outcome: 'review', reason: 'rejected_all' });
    await post(accountant.token, '/results/po/MT2/undo');

    const confirmed = await post(accountant.token, '/results/po/MT2/confirm');
    expect(confirmed.body).toMatchObject({ outcome: 'linked', method: 'person' });
    try {
      await put(admin.token, '/settings', { use_order_no: false });
      expect(await resultOf(viewer.token, 'po', 'MT2')).toMatchObject({ outcome: 'linked', method: 'person' });
      // Without the order, a typed serial still finds MT1's invoice; MT6 has no Bill No.
      expect(await resultOf(viewer.token, 'po', 'MT1')).toMatchObject({ outcome: 'linked', method: 'bill_serial' });
      expect(await resultOf(viewer.token, 'po', 'MT6')).toMatchObject({ outcome: 'waiting', reason: 'not_invoiced' });
    } finally {
      await post(admin.token, '/settings/reset');
      await post(accountant.token, '/results/po/MT2/undo');
    }
  });

  test('only a live voucher of the right kind can be picked', async () => {
    const res = await post(accountant.token, '/results/po/MT3/pick', { company_id: company.id, voucher_guid: inv.cn835.guid });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/sales invoice was not found/);
    expect((await post(accountant.token, '/results/po/NOPE/confirm')).status).toBe(404);
  });

  test('vouchers can be searched to pick one that is not a candidate', async () => {
    const res = await get(viewer.token, '/vouchers?kind=po&q=MT1819');
    expect(res.body.rows).toEqual([expect.objectContaining({ number: 'MT1819/RM/26-27', company: 'HR' })]);
  });
});

describe('the rules', () => {
  test('a preview shows what would change and writes nothing; saving re-matches and is audited', async () => {
    const before = await get(viewer.token, '/summary');
    const prev = await post(accountant.token, '/preview', { use_order_no: false });
    expect(prev.status).toBe(200);
    expect(prev.body.changed).toBeGreaterThan(0);
    expect(prev.body.examples.find((e) => e.target_id === 'MT2')).toMatchObject({ from: { outcome: 'linked' }, to: { outcome: 'waiting' } });
    expect((await get(viewer.token, '/summary')).body.counts).toEqual(before.body.counts);

    const saved = await put(accountant.token, '/settings', { check_qty: 'review', grace_days: 3 });
    expect(saved.status).toBe(200);
    expect(saved.body.settings).toMatchObject({ check_qty: 'review', grace_days: 3, updated_by_name: 'Test Accountant' });
    const { rows: [audit] } = await db.execute("SELECT * FROM audit_logs WHERE action_type = 'MATCH_SETTINGS_UPDATE' ORDER BY id DESC LIMIT 1");
    expect(JSON.parse(audit.changes)).toEqual([
      { field: 'check_qty', old: 'note', new: 'review' },
      { field: 'grace_days', old: 7, new: 3 },
    ]);
    const reset = await post(accountant.token, '/settings/reset');
    expect(reset.body.settings).toMatchObject({ check_qty: 'note', grace_days: 7 });
  });

  test('nonsense is refused with a reason', async () => {
    for (const [body, message] of [
      [{ use_order_no: false, use_bill_no: false }, /at least one way/],
      [{ check_sku: 'maybe' }, /off, note or review/],
      [{ grace_days: 500 }, /0-90 days/],
      [{ excluded_voucher_types: 'Sales' }, /list of names/],
      [{ colour: 'red' }, /Unknown rule/],
    ]) {
      const res = await put(admin.token, '/settings', body);
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(message);
    }
  });

  test('a vendor set to stock transfer is not matched, and back', async () => {
    expect((await put(accountant.token, '/vendors/Blinkit', { mode: 'transfer' })).status).toBe(200);
    expect(await resultOf(viewer.token, 'po', 'MT2')).toMatchObject({ outcome: 'not_matched', reason: 'vendor_transfer' });
    await put(accountant.token, '/vendors/Blinkit', { mode: 'match' });
    expect(await resultOf(viewer.token, 'po', 'MT2')).toMatchObject({ outcome: 'linked' });
    const vendors = await get(viewer.token, '/vendors');
    expect(vendors.body.rows).toContainEqual(expect.objectContaining({ vendor: 'Flipkart', mode: 'transfer' }));
    expect((await put(accountant.token, '/vendors/Blinkit', { mode: 'sometimes' })).status).toBe(400);
  });

  test('voucher types can be left out', async () => {
    const res = await get(viewer.token, '/voucher-types');
    expect(res.body.rows).toContainEqual(expect.objectContaining({ voucher_type: 'Credit Note', base_type: 'Credit Note', excluded: false }));
  });
});

describe('party ledgers', () => {
  test('suggestions come from the links; accepting them maps the ledger; our own GSTIN is found', async () => {
    const list = await get(viewer.token, `/party-ledgers?company_id=${company.id}`);
    const blink = list.body.rows.find((r) => r.guid === 'MTL1');
    expect(blink).toMatchObject({ kind: null, suggested_vendor: 'Blinkit', company: 'HR' });
    expect(blink.suggested_votes).toBeGreaterThanOrEqual(3);

    const accepted = await post(accountant.token, '/party-ledgers/accept-suggestions', { company_id: company.id });
    expect(accepted.body.accepted).toBe(1);
    const after = await get(viewer.token, `/party-ledgers?company_id=${company.id}&status=set`);
    expect(after.body.rows.find((r) => r.guid === 'MTL1')).toMatchObject({ kind: 'vendor', vendor: 'Blinkit', source: 'person', updated_by_name: 'Test Accountant' });
    // MT ROYMAX (MUMBAI) carries our own PAN: an internal party, found without anyone setting it.
    const { rows: [own] } = await db.execute({ sql: "SELECT kind, source FROM party_ledgers WHERE company_id = ? AND ledger_guid = 'MTL2'", args: [company.id] });
    expect(own).toMatchObject({ kind: 'internal', source: 'gstin' });
  });

  test('a ledger mapped to another marketplace holds its POs for review', async () => {
    const res = await put(accountant.token, `/party-ledgers/${company.id}/MTL1`, { kind: 'vendor', vendor: 'Zepto' });
    expect(res.status).toBe(200);
    expect(await resultOf(viewer.token, 'po', 'MT2')).toMatchObject({ outcome: 'review', reason: 'check_party', params: { vendor: 'Zepto', po_vendor: 'Blinkit' } });
    await put(accountant.token, `/party-ledgers/${company.id}/MTL1`, { kind: 'vendor', vendor: 'Blinkit' });
    expect(await resultOf(viewer.token, 'po', 'MT2')).toMatchObject({ outcome: 'linked' });
    expect((await put(accountant.token, `/party-ledgers/${company.id}/MTL1`, { kind: 'vendor', vendor: 'Nobody' })).status).toBe(400);
  });
});

describe('who can do what', () => {
  test('a Viewer reads but cannot run, decide or change anything; without matching.view nothing at all', async () => {
    expect((await get(viewer.token, '/summary')).status).toBe(200);
    expect((await post(viewer.token, '/run')).status).toBe(403);
    expect((await post(viewer.token, '/results/po/MT3/undo')).status).toBe(403);
    expect((await put(viewer.token, '/settings', { grace_days: 3 })).status).toBe(403);
    expect((await post(viewer.token, '/preview', {})).status).toBe(403);
    expect((await post(viewer.token, '/party-ledgers/accept-suggestions')).status).toBe(403);

    const perms = (roles) => bearer(request(app).put('/api/settings/permissions'), admin.token).send({ roles });
    await perms({ Viewer: [] });
    expect((await get(viewer.token, '/summary')).status).toBe(403);
    await perms({ Viewer: ['matching.view', 'matching.review'] });
    expect((await post(viewer.token, '/results/po/MT3/undo')).status).toBe(200);
    await perms({ Viewer: ['matching.view'] });
  });
});
