const request = require('supertest');
const app = require('../app');
const { db } = require('./helpers/db');
const { signIn, bearer } = require('./helpers/auth');
const {
  newAgent, agentPost, tallyCompany, voucher, enabledCompanies, startRun,
} = require('./helpers/agent');
const { startFakeRoms, emptyRefs, po, line, rtv } = require('./helpers/roms');
const {
  sendAutofill, wanted, actionOf,
} = require('../src/matching/autofill');
const { DEFAULTS } = require('../src/services/autofillSettings');

// Auto-fill end to end: Tally data pushed by a Connector, ROMS read from and
// written to a fake ROMS that keeps ROMS's rules (tests/helpers/roms.js), the
// modes moved from Off through Preview and Ask first to Automatic, and the
// cases a person decides. Numbers carry AF so other suites' vouchers in the
// shared database never match.
const api = (method, token, path, body) => bearer(request(app)[method](`/api/autofill${path}`), token).send(body);
const matching = (method, token, path, body) => bearer(request(app)[method](`/api/matching${path}`), token).send(body);

let admin; let accountant; let viewer; let agent; let roms; let company;
const inv = {};

const sale = (key, number, orders) => {
  const v = voucher(`af-${key}`, 10, {
    number,
    party: 'AF BLINK COMMERCE',
    orders: orders.map((no) => ({ no, date: '2026-07-01' })),
    ledgerLines: [{ ledger: 'AF BLINK COMMERCE', amount: -1180, isParty: true, debit: true, bills: [{ name: number, type: 'New Ref', amount: -1180 }] }],
  });
  inv[key] = v;
  return v;
};

function romsData() {
  const data = emptyRefs();
  data.vendors = [{ name: 'Blinkit', is_active: 1 }];
  data.products = [{ id: 1, sku_code: 'WB003', description: 'Bottle', category: 'Home' }];
  data['vendor-codes'] = [{ id: 1, vendor: 'Blinkit', vendor_item_code: '10192283', product_id: 1, sku_code: 'WB003' }];
  data.pos = [
    po('AF1', { vendor_po_id: 'AFP-1', bill_no: '701' }), // a typed serial: rewritten
    po('AF2', { vendor_po_id: 'AFP-2' }), // blank: filled
    po('AF3', { vendor_po_id: 'AFP-3', bill_no: '703/AF/26-27', bill_date: '2026-07-05' }), // only the date differs
    po('AF4', { vendor_po_id: 'AFP-4', bill_no: '1829' }), // not a form of the invoice: a person's
    po('AF5', { vendor_po_id: 'AFP-5' }), // ROMS refuses at first
    po('AF6', { vendor_po_id: 'AFP-6', bill_no: '706/AF/26-27', bill_date: '2026-07-01', grn_status: 'Returned to Vendor' }),
  ];
  data.lines = data.pos.map((p) => line(p.po_id, 1, { item_code: '10192283', sku_code: 'WB003' }));
  data.rtv = [rtv('AF6', { id: 9101, rtv_no: 'AF-RTV-1' })];
  return data;
}

const romsPo = (id) => roms.state.data.pos.find((p) => p.po_id === id);
const itemsOf = async (token, query = '') => (await api('get', token, `/items?kind=po&page_size=200${query}`)).body.rows;
const itemOf = async (id, kind = 'po') => {
  const res = await api('get', admin.token, `/items?kind=${kind}&page_size=200`);
  if (res.status !== 200) throw new Error(`items ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.rows.find((r) => r.id === String(id)) || null;
};
const setModes = (body) => api('put', admin.token, '/settings', body);
const connectorFill = () => agentPost(agent.token, '/autofill');
const lastAudit = async (type) => (await db.execute({ sql: 'SELECT * FROM audit_logs WHERE action_type = ? ORDER BY id DESC LIMIT 1', args: [type] })).rows[0];

beforeAll(async () => {
  [admin, accountant, viewer] = await Promise.all([signIn('admin'), signIn('accountant'), signIn('viewer')]);
  await db.execute('DELETE FROM autofill_items');
  agent = await newAgent('Auto-fill suite PC');
  [company] = await enabledCompanies(agent, admin, [tallyCompany({ state: 'Haryana' })]);
  const run = await startRun(agent, company.id, 'backfill');
  const vouchers = [
    sale('701', '701/AF/26-27', ['AFP-1']),
    sale('702', '702/AF/26-27', ['AFP-2']),
    sale('703', '703/AF/26-27', ['AFP-3']),
    sale('1219', '1219/AF/26-27', ['AFP-4']),
    sale('705', '705/AF/26-27', ['AFP-5']),
    sale('706', '706/AF/26-27', ['AFP-6']),
    voucher('af-cn835', 10, {
      number: 'AF835', type: 'Credit Note', baseType: 'Credit Note', date: '2026-07-20', party: 'AF BLINK COMMERCE', orders: [], inventoryLines: [],
      ledgerLines: [{ ledger: 'AF BLINK COMMERCE', amount: 500, isParty: true, debit: false, bills: [{ name: '706/AF/26-27', type: 'Agst Ref', amount: 500 }] }],
    }),
  ];
  await agentPost(agent.token, `/runs/${run}/vouchers`, { vouchers });
  await agentPost(agent.token, `/runs/${run}/reconcile`, { from: '2026-07-01', to: '2026-07-31', vouchers: vouchers.map((v) => ({ guid: v.guid, alterId: v.alterId })) });
  await agentPost(agent.token, `/runs/${run}/finish`, { ok: true, backfillDone: true });

  roms = await startFakeRoms(romsData());
  process.env.ROMS_API_URL = roms.url;
  process.env.ROMS_INTEGRATION_TOKEN = roms.token;
  await db.execute("UPDATE match_runs SET status = 'failed' WHERE status = 'running'");
  const res = await matching('post', accountant.token, '/run');
  if (res.status !== 200) throw new Error(`match ${res.status} ${res.body.message}`);
});

afterAll(async () => {
  // Suites share one database: leave auto-fill Off and nothing open behind.
  await db.execute({ sql: "UPDATE autofill_settings SET bill_mode = 'off', cn_mode = 'off', replace_typed = 1, bill_date_rule = 'tally' WHERE id = 1" });
  await db.execute('DELETE FROM autofill_items');
  await db.execute("UPDATE autofill_runs SET status = 'failed' WHERE status = 'running'");
  delete process.env.ROMS_API_URL;
  delete process.env.ROMS_INTEGRATION_TOKEN;
  await roms.close();
});

describe('Off — the starting point', () => {
  test('a match plans what would be written, and nothing is sent to ROMS', async () => {
    const summary = (await api('get', viewer.token, '/summary')).body;
    expect(summary.settings).toMatchObject(DEFAULTS);
    expect(summary.fields.po).toMatchObject({ mode: 'off', states: { to_check: 4, differs: 0 }, due: { write: 0, check: 0 } });
    expect(summary.fields.rtv).toMatchObject({ mode: 'off', states: { to_check: 1 } });

    const items = await itemsOf(viewer.token);
    const by = Object.fromEntries(items.map((i) => [i.id, i]));
    expect(by.AF1).toMatchObject({ write_kind: 'replace', expected: '701', value: '701/AF/26-27', date: '2026-07-01', state: 'to_check' });
    expect(by.AF2).toMatchObject({ write_kind: 'fill', expected: null, value: '702/AF/26-27' });
    expect(by.AF3).toMatchObject({ write_kind: 'date', expected: '703/AF/26-27', expected_date: '2026-07-05', date: '2026-07-01' });
    expect(by.AF4).toBeUndefined(); // needs review, not linked
    expect(by.AF6).toBeUndefined(); // already as in Tally

    const hb = await agentPost(agent.token, '/heartbeat', { version: 'test', companies: [] });
    expect(hb.body.commands.map((c) => c.type)).not.toContain('autofill');
    const res = await api('post', accountant.token, '/run');
    expect(res.status).toBe(200);
    expect(res.body.counts).toEqual({ written: 0, already: 0, refused: 0, checked: 0 });
    expect(roms.autofills).toEqual([]);
  });
});

describe('Preview, then Ask first, then Automatic', () => {
  test('Preview asks ROMS what would happen and writes nothing; a refusal shows with ROMS\'s reason', async () => {
    roms.state.refuse.AF5 = 'Bill no "705/AF/26-27" is already used on PO Z9';
    const set = await setModes({ bill_mode: 'preview' });
    expect(set.status).toBe(200);
    expect((await lastAudit('AUTOFILL_SETTINGS_UPDATE')).description).toBe('Bill No auto-fill: Off → Preview');

    const hb = await agentPost(agent.token, '/heartbeat', { version: 'test', companies: [] });
    expect(hb.body.commands).toContainEqual({ type: 'autofill', why: '4 to check with ROMS' });

    const res = await connectorFill();
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, counts: { checked: 3, refused: 1, written: 0 }, more: false });
    expect(roms.autofills.at(-1).dry_run).toBe(true);
    expect(romsPo('AF1').bill_no).toBe('701');
    expect(await itemOf('AF5')).toMatchObject({ state: 'refused', dry: true, reason: 'Bill no "705/AF/26-27" is already used on PO Z9' });
    expect(await itemOf('AF1')).toMatchObject({ state: 'checked', dry: true });

    // A refusal is not sent again until something changes.
    const again = await connectorFill();
    expect(again.body.counts).toEqual({ written: 0, already: 0, refused: 0, checked: 0 });
  });

  test('Ask first: an approved row is written on Write now, with a note ROMS keeps; the rest wait', async () => {
    await setModes({ bill_mode: 'approve' });
    const approve = await api('post', accountant.token, '/approve', { kind: 'po', ids: ['AF1'] });
    expect(approve.status).toBe(200);
    expect(approve.body.approved).toBe(1);
    expect((await lastAudit('AUTOFILL_APPROVE')).description).toBe('Approved 1 Bill No write into ROMS: AF1');

    const res = await api('post', accountant.token, '/run');
    expect(res.status).toBe(200);
    expect(res.body.counts).toMatchObject({ written: 1 });
    expect(romsPo('AF1')).toMatchObject({ bill_no: '701/AF/26-27', bill_date: '2026-07-01' });
    const sent = roms.autofills.at(-1);
    expect(sent.dry_run).toBe(false);
    expect(sent.items).toEqual([expect.objectContaining({ target: 'bill', po_id: 'AF1', expected: '701', value: '701/AF/26-27' })]);
    expect(sent.items[0].note).toMatch(/approved by Test Accountant/);

    expect(await itemOf('AF1')).toBeNull();
    expect(await itemOf('AF2')).toMatchObject({ state: 'checked' });
    const result = (await matching('get', viewer.token, '/results/po/AF1')).body;
    expect(result.fill).toMatchObject({ kind: 'same', current: '701/AF/26-27' });
    expect(result.autofill.written_at).toBeTruthy();
    const { rows: [mirror] } = await db.execute("SELECT bill_no FROM roms_pos WHERE po_id = 'AF1'");
    expect(mirror.bill_no).toBe('701/AF/26-27');

    const events = (await api('get', viewer.token, '/events?kind=po')).body.rows;
    expect(events[0]).toMatchObject({ po_id: 'AF1', result: 'applied', old_value: '701', new_value: '701/AF/26-27', by: 'Test Accountant' });
    expect((await api('get', viewer.token, '/summary')).body.fields.po).toMatchObject({ written: 1, written_today: 1 });
  });

  test('Automatic writes the rest after each match; a value staff changed meanwhile is left for them, then re-planned', async () => {
    romsPo('AF2').bill_no = '702'; // typed in ROMS after RAMS read it
    await setModes({ bill_mode: 'auto', cn_mode: 'auto' });
    const res = await connectorFill();
    expect(res.body).toMatchObject({ ok: true, counts: { written: 2, refused: 1 }, more: false });
    expect(romsPo('AF3')).toMatchObject({ bill_no: '703/AF/26-27', bill_date: '2026-07-01' });
    expect(roms.state.data.rtv[0]).toMatchObject({ cn_number: 'AF835', cn_date: '2026-07-20' });
    expect(await itemOf('AF2')).toMatchObject({ state: 'refused', dry: false, reason: expect.stringMatching(/is now "702", not blank as RAMS read it/) });
    expect(romsPo('AF2').bill_no).toBe('702');

    // The next match reads ROMS again: 702 is a form of the invoice, so a new plan.
    await matching('post', accountant.token, '/run');
    expect(await itemOf('AF2')).toMatchObject({ state: 'to_check', write_kind: 'replace', expected: '702' });
    const match = await agentPost(agent.token, '/match');
    expect(match.body.autofill_due).toBe(true);
    expect((await connectorFill()).body.counts).toMatchObject({ written: 1 });
    expect(romsPo('AF2').bill_no).toBe('702/AF/26-27');
  });

  test('Try again re-sends a refusal once ROMS would take it', async () => {
    delete roms.state.refuse.AF5;
    const res = await api('post', accountant.token, '/items/po/AF5/retry');
    expect(res.status).toBe(200);
    expect(res.body.state).toBe('to_check');
    expect((await lastAudit('AUTOFILL_RETRY')).description).toBe('Asked to write 705/AF/26-27 into PO AF5 again');
    expect((await connectorFill()).body.counts).toMatchObject({ written: 1 });
    expect(romsPo('AF5').bill_no).toBe('705/AF/26-27');
    expect((await api('post', accountant.token, '/items/po/AF5/retry')).status).toBe(404);
  });
});

describe('a value that is not a form of Tally\'s number', () => {
  test('is never written automatically; a person with "Replace a different value" writes it', async () => {
    const pick = await matching('post', accountant.token, '/results/po/AF4/pick', { company_id: company.id, voucher_guid: inv['1219'].guid });
    expect(pick.status).toBe(200);
    expect(await itemOf('AF4')).toMatchObject({ state: 'differs', write_kind: 'differs', expected: '1829', value: '1219/AF/26-27' });

    const before = roms.autofills.length;
    await connectorFill();
    expect(roms.autofills.slice(before).flatMap((b) => b.items).map((i) => i.po_id)).not.toContain('AF4');
    expect(romsPo('AF4').bill_no).toBe('1829');

    expect((await api('post', accountant.token, '/items/po/AF4/overwrite')).status).toBe(403);
    const res = await api('post', admin.token, '/items/po/AF4/overwrite');
    expect(res.status).toBe(200);
    expect(res.body.result).toBe('written');
    expect(romsPo('AF4').bill_no).toBe('1219/AF/26-27');
    expect(roms.autofills.at(-1).items[0].note).toMatch(/approved by Test Admin — replaces "1829"/);
    const audit = await lastAudit('AUTOFILL_OVERWRITE');
    expect(audit.description).toBe('Wrote Tally\'s 1219/AF/26-27 over "1829" on PO AF4 in ROMS');
    expect(JSON.parse(audit.changes)).toEqual([{ field: 'bill_no', old: '1829', new: '1219/AF/26-27' }]);
    const events = (await api('get', viewer.token, '/events?kind=po&q=AF4')).body.rows;
    expect(events[0]).toMatchObject({ result: 'applied', write_kind: 'differs', by: 'Test Admin' });
  });
});

describe('who may do what, and what goes wrong', () => {
  test('Viewers see, Accountants approve, only Admin/Owner change the modes by default', async () => {
    expect((await api('get', viewer.token, '/summary')).status).toBe(200);
    expect((await api('get', viewer.token, '/events?kind=rtv')).status).toBe(200);
    for (const [method, path, body] of [['post', '/approve', { kind: 'po' }], ['post', '/run'], ['put', '/settings', { bill_mode: 'off' }]]) {
      expect((await api(method, viewer.token, path, body)).status).toBe(403);
    }
    expect((await api('put', accountant.token, '/settings', { bill_mode: 'off' })).status).toBe(403);
  });

  test('settings are checked', async () => {
    expect((await setModes({ bill_mode: 'sometimes' })).body.message).toBe('A mode is off, preview, approve (ask first) or auto');
    expect((await setModes({ colour: 'blue' })).status).toBe(400);
    expect((await api('post', admin.token, '/approve', { kind: 'grn' })).status).toBe(400);
  });

  test('one round at a time, and ROMS being down stops the round with ROMS\'s words', async () => {
    await db.execute("INSERT INTO autofill_runs (trigger) VALUES ('cli')");
    await db.execute({
      sql: "INSERT INTO autofill_items (target_kind, target_id, po_id, field, kind, value, date, state) VALUES ('po', 'AFX', 'AFX', 'bill_no', 'fill', '799/AF/26-27', '2026-07-01', 'to_check')",
    });
    expect((await api('post', accountant.token, '/run')).status).toBe(409);
    await db.execute("UPDATE autofill_runs SET status = 'failed' WHERE status = 'running'");

    roms.state.status = 503;
    const res = await connectorFill();
    expect(res.body).toMatchObject({ ok: false, error: expect.stringMatching(/integration is switched off/) });
    expect(res.body.error).not.toContain(roms.token);
    // The Connector isn't asked again every minute while ROMS is down.
    const hb = await agentPost(agent.token, '/heartbeat', { version: 'test', companies: [] });
    expect(hb.body.commands.map((c) => c.type)).not.toContain('autofill');
    roms.state.status = null;
    expect(await itemOf('AFX')).toMatchObject({ state: 'to_check' });
    await db.execute("DELETE FROM autofill_items WHERE target_id = 'AFX'");
  });

  test('a round stops starting batches at its time limit and says there is more', async () => {
    for (const id of ['T1', 'T2', 'T3', 'T4']) {
      await db.execute({
        sql: "INSERT INTO autofill_items (target_kind, target_id, po_id, field, kind, value, date, state) VALUES ('po', ?, ?, 'bill_no', 'fill', ?, '2026-07-01', 'to_check')",
        args: [id, id, `${id}/AF/26-27`],
      });
    }
    let clock = 0;
    const calls = [];
    const fake = {
      async autofill(items, { dryRun }) {
        calls.push({ n: items.length, dryRun });
        clock += 12000; // each batch takes 12 s
        return { results: items.map(() => ({ result: 'applied' })) };
      },
    };
    const out = await sendAutofill(db, { roms: fake, batch: 1, deadlineMs: 30000, now: () => clock });
    expect(out).toMatchObject({ ok: true, counts: { written: 2 }, remaining: 2, more: true });
    expect(calls).toEqual([{ n: 1, dryRun: false }, { n: 1, dryRun: false }]);
    await db.execute("DELETE FROM autofill_items WHERE target_id IN ('T1','T2','T3','T4')");
    await db.execute("DELETE FROM autofill_events WHERE target_id IN ('T1','T2','T3','T4')");
  });
});

describe('the rules, as plain functions', () => {
  const s = { ...DEFAULTS };
  const fill = (over) => ({
    field: 'bill_no', current: '607', current_date: '2026-07-13', value: '607/RM/26-27', date: '2026-07-11', kind: 'replace', ...over,
  });

  test('what is planned for each kind of fill, and the Bill Date rule', () => {
    expect(wanted('po', fill(), s)).toEqual({ kind: 'replace', expected: '607', expected_date: '2026-07-13', value: '607/RM/26-27', date: '2026-07-11' });
    expect(wanted('po', fill(), { ...s, replace_typed: false })).toBeNull();
    expect(wanted('po', fill(), { ...s, bill_date_rule: 'keep' }).date).toBe('2026-07-13');
    expect(wanted('po', fill({ current_date: null }), { ...s, bill_date_rule: 'keep' }).date).toBe('2026-07-11');
    expect(wanted('po', fill({ kind: 'same', current: '607/RM/26-27' }), s)).toMatchObject({ kind: 'date' });
    expect(wanted('po', fill({ kind: 'same', current: '607/RM/26-27' }), { ...s, bill_date_rule: 'keep' })).toBeNull();
    expect(wanted('po', fill({ kind: 'same', current: '607/RM/26-27', current_date: '2026-07-11' }), s)).toBeNull();
    expect(wanted('po', fill({ kind: 'differs', current: '1819' }), s)).toMatchObject({ kind: 'differs' });
    // The CN Date always follows Tally.
    expect(wanted('rtv', fill({ field: 'cn_number', kind: 'same', current: '835', value: '835' }), { ...s, bill_date_rule: 'keep' })).toMatchObject({ kind: 'date', date: '2026-07-11' });
  });

  test('what each mode sends', () => {
    const item = (state) => ({ target_kind: 'po', state });
    const modes = (bill) => ({ ...s, bill_mode: bill });
    expect(['to_check', 'checked', 'to_write', 'refused', 'differs'].map((st) => actionOf(item(st), modes('off')))).toEqual([null, null, null, null, null]);
    expect(['to_check', 'checked', 'to_write', 'refused', 'differs'].map((st) => actionOf(item(st), modes('preview')))).toEqual(['check', null, null, null, null]);
    expect(['to_check', 'checked', 'to_write', 'refused', 'differs'].map((st) => actionOf(item(st), modes('approve')))).toEqual(['check', null, 'write', null, null]);
    expect(['to_check', 'checked', 'to_write', 'refused', 'differs'].map((st) => actionOf(item(st), modes('auto')))).toEqual(['write', 'write', 'write', null, null]);
  });
});
