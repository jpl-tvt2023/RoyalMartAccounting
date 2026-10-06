const request = require('supertest');
const app = require('../app');
const { db } = require('./helpers/db');
const { signIn, bearer } = require('./helpers/auth');
const {
  newAgent, agentPost, tallyCompany, voucher, enabledCompanies, startRun,
} = require('./helpers/agent');
const { startFakeRoms, emptyRefs, po } = require('./helpers/roms');
const { groupChains, receivables } = require('../src/books/book');

// The Reports end to end: a company's Tally books pushed by a Connector, one
// PO matched from a fake ROMS, then the figures RAMS works out from them.
// Numbers carry RP so other suites' vouchers never mix in, and every request
// filters on this suite's company.
const get = (token, path) => bearer(request(app).get(`/api/reports${path}`), token);

let admin; let accountant; let viewer; let agent; let roms; let company; let q;

const party = 'RP BLINK COMMERCE (PUNE)';
const lines = (amount, extra = []) => [
  { ledger: party, amount: -amount, isParty: true, debit: true, bills: [] },
  ...extra,
];
const sale = (key, number, amount, { orders = [], date = '2026-07-01', partyName = party } = {}) => voucher(`rp-${key}`, 10, {
  number,
  date,
  party: partyName,
  total: amount,
  orders: orders.map((no) => ({ no, date })),
  ledgerLines: [
    { ledger: partyName, amount: -amount, isParty: true, debit: true, bills: [{ name: number, type: 'New Ref', amount: -amount }] },
    { ledger: 'RP SALE 18%', amount: amount * 0.8, isParty: false, debit: false, bills: [] },
    { ledger: 'RP IGST OUTPUT', amount: amount * 0.2, isParty: false, debit: false, bills: [] },
  ],
});
const settle = (key, type, number, against, amount, extra = []) => voucher(`rp-${key}`, 10, {
  number,
  type,
  baseType: type,
  date: '2026-07-20',
  party,
  total: amount,
  orders: [],
  inventoryLines: [],
  ledgerLines: [
    { ledger: party, amount, isParty: true, debit: false, bills: against ? [{ name: against, type: 'Agst Ref', amount }] : [{ name: '', type: 'On Account', amount }] },
    ...extra,
  ],
});

beforeAll(async () => {
  [admin, accountant, viewer] = await Promise.all([signIn('admin'), signIn('accountant'), signIn('viewer')]);
  agent = await newAgent('Reports suite PC');
  [company] = await enabledCompanies(agent, admin, [tallyCompany({ state: 'Karnataka' })]);
  q = `company_id=${company.id}`;
  const run = await startRun(agent, company.id, 'backfill');
  await agentPost(agent.token, `/runs/${run}/masters`, {
    groups: [
      { guid: 'RPG1', name: 'Sundry Debtors', parent: '', reserved: 'Sundry Debtors', alterId: 1 },
      { guid: 'RPG2', name: 'RP Blinkit Debtors', parent: 'Sundry Debtors', reserved: '', alterId: 1 },
      { guid: 'RPG3', name: 'Duties & Taxes', parent: 'Current Liabilities', reserved: 'Duties & Taxes', alterId: 1 },
      { guid: 'RPG4', name: 'Output Igst', parent: 'Duties & Taxes', reserved: '', alterId: 1 },
      { guid: 'RPG5', name: 'Sales Accounts', parent: '', reserved: 'Sales Accounts', alterId: 1 },
    ],
    ledgers: [
      { guid: 'RPL1', name: party, parent: 'RP Blinkit Debtors', gstins: ['27AAICB1234C1Z5'], billWise: true, alterId: 1 },
      { guid: 'RPL2', name: 'RP SALE 18%', parent: 'Sales Accounts', gstins: [], alterId: 1 },
      { guid: 'RPL3', name: 'RP IGST OUTPUT', parent: 'Output Igst', gstins: [], alterId: 1 },
      { guid: 'RPL4', name: 'RP ROYMAX (HARYANA)', parent: 'Sundry Debtors', gstins: [], alterId: 1 },
    ],
    stockItems: [],
    voucherTypes: [],
  });
  const vouchers = [
    sale('901', '901/RP/26-27', 10000, { orders: ['RPPO-1'] }), // matched to PO RP1
    sale('902', '902/RP/26-27', 5000, { date: '2026-06-10' }), // no PO, old
    sale('903', '903/RP/26-27', 2000), // settled in full
    sale('904', '904/RP/26-27', 3000, { partyName: 'RP ROYMAX (HARYANA)' }), // a stock transfer
    settle('r1', 'Receipt', 'R1', '901/RP/26-27', 4000),
    settle('cn1', 'Credit Note', '1501', '901/RP/26-27', 1000),
    settle('j1', 'Journal', 'J1', '901/RP/26-27', 100, [{ ledger: 'TDS Receivable (FY 2026-27)', amount: -100, isParty: false, debit: true, bills: [] }]),
    settle('r2', 'Receipt', 'R2', '903/RP/26-27', 2000),
    settle('r3', 'Receipt', 'R3', null, 700), // on account
  ];
  await agentPost(agent.token, `/runs/${run}/vouchers`, { vouchers });
  await agentPost(agent.token, `/runs/${run}/reconcile`, { from: '2026-06-01', to: '2026-07-31', vouchers: vouchers.map((v) => ({ guid: v.guid, alterId: v.alterId })) });
  await agentPost(agent.token, `/runs/${run}/finish`, { ok: true, backfillDone: true });

  // RP ROYMAX is our own registration; the Blinkit ledger maps to Blinkit.
  await db.execute({ sql: "INSERT OR REPLACE INTO party_ledgers (company_id, ledger_guid, kind, source) VALUES (?, 'RPL4', 'internal', 'person')", args: [company.id] });

  const data = emptyRefs();
  data.vendors = [{ name: 'Blinkit', is_active: 1 }];
  data.products = [{ id: 1, sku_code: 'WB003', description: 'Bottle', category: 'Home' }];
  data['vendor-codes'] = [{ id: 1, vendor: 'Blinkit', vendor_item_code: '10192283', product_id: 1, sku_code: 'WB003' }];
  data.pos = [po('RP1', { vendor_po_id: 'RPPO-1' })];
  data.lines = [{ po_id: 'RP1', line_no: 1, item_code: '10192283', qty: 10, sku_code: 'WB003' }];
  roms = await startFakeRoms(data);
  process.env.ROMS_API_URL = roms.url;
  process.env.ROMS_INTEGRATION_TOKEN = roms.token;
  await db.execute("UPDATE match_runs SET status = 'failed' WHERE status = 'running'");
  const res = await bearer(request(app).post('/api/matching/run'), accountant.token);
  if (res.status !== 200) throw new Error(`match ${res.status} ${res.body.message}`);
});

afterAll(async () => {
  delete process.env.ROMS_API_URL;
  delete process.env.ROMS_INTEGRATION_TOKEN;
  await roms.close();
  await db.execute('DELETE FROM sync_requests WHERE done_at IS NULL');
  await db.execute("UPDATE report_settings SET default_credit_days = 30, exception_days = 15 WHERE id = 1");
});

describe('Invoices', () => {
  test('each invoice with what settled it: receipts, credit notes, TDS, and what is still owed', async () => {
    const res = await get(viewer.token, `/invoices?${q}&page_size=100`);
    expect(res.status).toBe(200);
    const by = Object.fromEntries(res.body.rows.map((r) => [r.number, r]));
    expect(by['901/RP/26-27']).toMatchObject({
      vendor: 'Blinkit', vendor_from: 'po', pos: ['RP1'], total_paise: 1000000, taxable_paise: 800000, gst_paise: 200000,
      received_paise: 400000, credit_notes_paise: 100000, tds_paise: 10000, adjustments_paise: 0, outstanding_paise: 490000,
    });
    expect(by['901/RP/26-27'].settled_by.map((s) => s.as).sort()).toEqual(['credit_notes', 'received', 'tds']);
    expect(by['903/RP/26-27']).toMatchObject({ outstanding_paise: 0, status: 'settled' });
    expect(by['902/RP/26-27']).toMatchObject({ pos: [], vendor: 'Blinkit', vendor_from: 'suggested', outstanding_paise: 500000 });
    expect(by['904/RP/26-27']).toBeUndefined(); // a stock transfer
    expect(res.body.totals).toMatchObject({ invoices: 3, outstanding_paise: 990000 });
  });

  test('filters: no PO, settled, search', async () => {
    expect((await get(viewer.token, `/invoices?${q}&status=no_po`)).body.rows.map((r) => r.number).sort()).toEqual(['902/RP/26-27', '903/RP/26-27']);
    expect((await get(viewer.token, `/invoices?${q}&status=settled`)).body.rows.map((r) => r.number)).toEqual(['903/RP/26-27']);
    expect((await get(viewer.token, `/invoices?${q}&q=RP1`)).body.rows.map((r) => r.number)).toEqual(['901/RP/26-27']);
    expect((await get(viewer.token, `/invoices?${q}&status=paid`)).status).toBe(400);
  });

  test('an invoice is overdue after its marketplace\'s credit days', async () => {
    await bearer(request(app).put('/api/reports/terms/Blinkit'), accountant.token).send({ credit_days: 10 });
    const inv = (await get(viewer.token, `/invoices?${q}&q=901`)).body.rows[0];
    expect(inv).toMatchObject({ credit_days: 10, due_date: '2026-07-11', status: 'overdue' });
    expect(inv.overdue_days).toBeGreaterThan(0);
    await bearer(request(app).put('/api/reports/terms/Blinkit'), accountant.token).send({ credit_days: null });
    expect((await get(viewer.token, `/invoices?${q}&q=901`)).body.rows[0].credit_days).toBe(30);
  });
});

describe('Receivables, notes, transfers and exceptions', () => {
  test('receivables add up per marketplace, without stock transfers, with money received on account apart', async () => {
    const res = await get(viewer.token, `/receivables?${q}`);
    // 902 and 903 have no PO, but their party ledger is suggested as Blinkit
    // from 901's link, so all three count as Blinkit's.
    expect(res.body.rows).toEqual([expect.objectContaining({
      vendor: 'Blinkit', invoices: 3, open_invoices: 2, invoiced_paise: 1700000, received_paise: 600000, credit_notes_paise: 100000,
      tds_paise: 10000, outstanding_paise: 990000, unallocated_paise: 70000, net_outstanding_paise: 920000,
    })]);
    expect(res.body.totals).toMatchObject({ invoices: 3, invoiced_paise: 1700000, outstanding_paise: 990000 });
    expect(res.body.buckets.map((b) => b.key)).toEqual(['d0_30', 'd31_60', 'd61_90', 'd90_plus']);
  });

  test('a credit note shows the invoice it settles and that invoice\'s PO', async () => {
    const res = await get(viewer.token, `/notes?${q}&type=cn`);
    expect(res.body.rows).toEqual([expect.objectContaining({
      number: '1501', type: 'cn', against: ['901/RP/26-27'], invoices: ['901/RP/26-27'], pos: ['RP1'], vendor: 'Blinkit', amount_paise: 100000,
    })]);
  });

  test('sales to our own registrations are stock transfers', async () => {
    const res = await get(viewer.token, `/transfers?${q}`);
    expect(res.body.rows.map((r) => r.number)).toEqual(['904/RP/26-27']);
  });

  test('exceptions: a Tally invoice with no PO after the exception days', async () => {
    const res = await get(viewer.token, `/exceptions?${q}`);
    const noPo = res.body.categories.find((c) => c.code === 'invoice_no_po');
    expect(noPo.rows.map((r) => r.number)).toEqual(expect.arrayContaining(['902/RP/26-27']));
    expect(res.body.categories.map((c) => c.code)).toEqual(['bill_not_in_tally', 'invoice_no_po', 'conflict', 'ambiguous', 'rtv_no_cn', 'autofill_refused']);
  });
});

describe('settings, permissions and Sync now', () => {
  test('Accountants change credit terms; Viewers only read; changes are audited', async () => {
    expect((await bearer(request(app).put('/api/reports/settings'), viewer.token).send({ exception_days: 5 })).status).toBe(403);
    const res = await bearer(request(app).put('/api/reports/settings'), accountant.token).send({ exception_days: 5 });
    expect(res.status).toBe(200);
    expect(res.body.settings).toMatchObject({ exception_days: 5, default_credit_days: 30 });
    expect(res.body.terms).toEqual(expect.arrayContaining([{ vendor: 'Scootsy', credit_days: 5, updated_at: null, updated_by_name: null }]));
    const { rows: [audit] } = await db.execute("SELECT * FROM audit_logs WHERE action_type = 'REPORT_SETTINGS_UPDATE' ORDER BY id DESC LIMIT 1");
    expect(JSON.parse(audit.changes)).toEqual([{ field: 'exception_days', old: 15, new: 5 }]);
    expect((await bearer(request(app).put('/api/reports/settings'), accountant.token).send({ exception_days: 0 })).status).toBe(400);
    expect((await bearer(request(app).put('/api/reports/terms/Nobody'), accountant.token).send({ credit_days: 3 })).status).toBe(404);
  });

  test('Sync now reaches the Connector at its next heartbeat, and the next run of that company answers it', async () => {
    expect((await bearer(request(app).post('/api/sync/now'), viewer.token).send({ company_id: company.id })).status).toBe(403);
    const res = await bearer(request(app).post('/api/sync/now'), accountant.token).send({ company_id: company.id });
    expect(res.status).toBe(202);
    const hb = await agentPost(agent.token, '/heartbeat', { version: 'test', companies: [] });
    expect(hb.body.commands).toContainEqual({ type: 'sync', company_id: company.id, kind: 'light', why: 'Sync now, asked in RAMS' });
    expect((await bearer(request(app).get('/api/sync/runs'), viewer.token)).body.waiting).toContainEqual(expect.objectContaining({ company_id: company.id, requested_by: 'Test Accountant' }));

    const run = await startRun(agent, company.id, 'light', 120, 50);
    const after = await agentPost(agent.token, '/heartbeat', { version: 'test', companies: [] });
    expect(after.body.commands.filter((c) => c.type === 'sync' && c.company_id === company.id)).toEqual([]);
    await agentPost(agent.token, `/runs/${run}/finish`, { ok: true });
    const runs = await bearer(request(app).get(`/api/sync/runs?company_id=${company.id}`), viewer.token);
    expect(runs.body.rows[0]).toMatchObject({ id: run, kind: 'light', status: 'ok' });
  });
});

describe('the book, as plain functions', () => {
  test('a ledger\'s group chain reaches the reserved group', () => {
    const chainOf = groupChains([
      { company_id: 1, name: 'Sundry Debtors', parent: 'Current Assets', reserved_name: 'Sundry Debtors' },
      { company_id: 1, name: 'BLINKIT -UP', parent: 'Sundry Debtors', reserved_name: '' },
    ]);
    expect(chainOf(1, 'BLINKIT -UP')).toEqual(['BLINKIT -UP', 'Sundry Debtors']);
    expect(chainOf(2, 'Sales Accounts')).toEqual(['Sales Accounts']);
  });

  test('receivables buckets by age, and overdue only past the credit days', () => {
    const inv = (over) => ({
      internal: false, company_id: 1, company: 'MH', vendor: 'Zepto', total_paise: 100, received_paise: 0, credit_notes_paise: 0, tds_paise: 0, adjustments_paise: 0, ...over,
    });
    const out = receivables({
      invoices: [
        inv({ outstanding_paise: 100, bucket: 'd0_30', status: 'open' }),
        inv({ outstanding_paise: 50, bucket: 'd90_plus', status: 'overdue' }),
        inv({ outstanding_paise: 0, bucket: 'd31_60', status: 'settled', received_paise: 100 }),
        inv({ internal: true, outstanding_paise: 999, bucket: 'd0_30', status: 'open' }),
      ],
      unallocated: [],
    });
    expect(out.rows).toEqual([expect.objectContaining({
      vendor: 'Zepto', invoices: 3, open_invoices: 2, outstanding_paise: 150, overdue_paise: 50, d0_30_paise: 100, d90_plus_paise: 50, received_paise: 100,
    })]);
  });
});
