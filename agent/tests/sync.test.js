// The sync engine end to end: mock Tally -> syncCompany -> the real RAMS API
// and database (helpers/rams.js).
const { buildDataset } = require('../mock/dataset');
const { editBooks } = require('../mock/books');
const { createTallyClient } = require('../src/tally/client');
const { listCompanies } = require('../src/tally/pull');
const { createApiClient } = require('../src/api/client');
const { syncCompany, syncWindow } = require('../src/sync');
const { startRams, startMockTally, hasBackend } = require('./helpers/rams');

const describeIf = hasBackend ? describe : describe.skip;
if (!hasBackend) console.warn('backend/node_modules is missing: run `npm install` in backend/ to run the sync suites');
jest.setTimeout(120000); // a real SQLite database, written to disk

const TODAY = '2026-10-05';
let rams;
let mock;
let tally;
let api;
let books;

// Reports what Tally has loaded and returns RAMS's view of the synced ones.
async function heartbeat() {
  const live = await listCompanies(tally);
  return { live, reply: await api.heartbeat({ version: 'test', companies: live }) };
}

// One sync of `code` (MH / HR / WB) as the run loop would start it.
async function sync(code, kind) {
  const guid = `company-${code.toLowerCase()}`;
  const { live, reply } = await heartbeat();
  const company = reply.companies.find((c) => c.guid === guid);
  return syncCompany({
    tally, api, company, live: live.find((c) => c.guid === guid), kind,
    syncFrom: reply.settings.syncFrom, today: TODAY, batchSize: 5,
  });
}

const companyId = async (code) => Number((await rams.one('SELECT id FROM tally_companies WHERE guid = ?', [`company-${code.toLowerCase()}`])).id);
const stateOf = async (code) => rams.one('SELECT * FROM tally_sync_state WHERE company_id = ?', [await companyId(code)]);
const stored = async (code, guid) => rams.one('SELECT * FROM tally_vouchers WHERE company_id = ? AND guid = ?', [await companyId(code), guid]);
const inWindow = (c) => c.vouchers.filter((v) => v.date >= '2026-04-01');

describeIf('sync: mock Tally -> RAMS', () => {
  beforeAll(async () => {
    rams = await startRams({ name: 'sync' });
    books = editBooks(buildDataset());
    mock = await startMockTally(books.dataset);
    tally = createTallyClient({ port: mock.port, timeoutMs: 10000 });
    api = createApiClient({ apiUrl: rams.url, token: rams.token, retries: 0 });
    await heartbeat();
    for (const c of books.dataset.companies) await rams.enable(c.guid);
  });

  afterAll(async () => {
    await mock?.close();
    await rams?.close();
  });

  test('the sync window runs from the sync start to the end of the financial year', () => {
    expect(syncWindow('2026-06-08', '2026-10-05')).toEqual({ from: '2026-06-08', to: '2027-03-31' });
    expect(syncWindow('2026-06-08', '2027-02-10')).toEqual({ from: '2026-06-08', to: '2027-03-31' });
    expect(syncWindow('2026-06-08', '2027-04-01')).toEqual({ from: '2026-06-08', to: '2028-03-31' });
  });

  test('a backfill stores the masters and every voucher in the window, then sets the watermarks', async () => {
    const mh = books.company('MH');
    const result = await sync('MH', 'backfill');
    expect(result.ok).toBe(true);
    expect(result.counts).toMatchObject({ vouchers: inWindow(mh).length, deleted: 0, months: 12 });

    const { n } = await rams.one('SELECT COUNT(*) AS n FROM tally_vouchers WHERE company_id = ? AND deleted_at IS NULL', [await companyId('MH')]);
    expect(Number(n)).toBe(inWindow(mh).length); // Z/001 of March 2026 is before the window
    expect(await stateOf('MH')).toMatchObject({
      backfill_done: 1, backfill_through: '2027-03-31', alt_vch_id: mh.altVchId, alt_mst_id: mh.altMstId, needs_resync: 0,
    });
    const { ledgers } = await rams.one('SELECT COUNT(*) AS ledgers FROM tally_ledgers WHERE company_id = ?', [await companyId('MH')]);
    expect(Number(ledgers)).toBe(mh.ledgers.length);
    expect((await rams.one('SELECT gstin FROM tally_companies WHERE guid = ?', [mh.guid])).gstin).toBe('27ABGFR0562B1ZI');

    // A custom type resolves through the voucher-type masters; amounts are paise.
    const zepto = mh.vouchers.find((v) => v.type === 'Sales-Zepto');
    expect(await stored('MH', zepto.guid)).toMatchObject({ voucher_type: 'Sales-Zepto', base_type: 'Sales', total_paise: 231000 });
    const cancelled = mh.vouchers.find((v) => v.cancelled);
    expect((await stored('MH', cancelled.guid)).is_cancelled).toBe(1);

    expect((await sync('HR', 'backfill')).ok).toBe(true);
  });

  test('a light sync with nothing changed in Tally asks it for no vouchers at all', async () => {
    const before = mock.requests.length;
    const result = await sync('MH', 'light');
    expect(result.counts.vouchers).toBe(0);
    const asked = mock.requests.slice(before).map((r) => r.id);
    expect(asked.filter((id) => /vouchers|voucher list|list of accounts/i.test(id))).toEqual([]);
  });

  test('an altered voucher arrives in the next light sync, and only that voucher', async () => {
    const mh = books.company('MH');
    const watermark = (await stateOf('MH')).alt_vch_id;
    const target = inWindow(mh)[2];
    books.alter('MH', target.guid, { narration: 'edited in Tally' });
    const before = mock.requests.length;

    const result = await sync('MH', 'light');
    expect(result.counts.vouchers).toBe(1);
    expect(await stored('MH', target.guid)).toMatchObject({ narration: 'edited in Tally', alter_id: target.alterId });
    const changed = mock.requests.slice(before).filter((r) => /changed/i.test(r.id));
    expect(changed).toHaveLength(1);
    expect(changed[0].afterAlterId).toBe(Number(watermark));
    expect((await stateOf('MH')).alt_vch_id).toBe(mh.altVchId);
  });

  test('a voucher deleted in Tally is marked deleted by the end-of-day check, not by a light sync', async () => {
    const victim = inWindow(books.company('MH'))[3];
    books.remove('MH', victim.guid);
    await sync('MH', 'light');
    expect((await stored('MH', victim.guid)).deleted_at).toBeNull();

    const heavy = await sync('MH', 'heavy');
    expect(heavy.ok).toBe(true);
    expect(heavy.counts.deleted).toBe(1);
    expect((await stored('MH', victim.guid)).deleted_at).toBeTruthy();
    expect((await stateOf('MH')).last_heavy_at).toBeTruthy();
  });

  test('the end-of-day check pulls again a month where RAMS holds an older copy', async () => {
    const target = inWindow(books.company('MH'))[0];
    await rams.db.execute({
      sql: "UPDATE tally_vouchers SET alter_id = alter_id - 50, narration = 'stale' WHERE guid = ?", args: [target.guid],
    });
    const heavy = await sync('MH', 'heavy');
    expect(heavy.counts.repulled).toBeGreaterThanOrEqual(1);
    expect(await stored('MH', target.guid)).toMatchObject({ alter_id: target.alterId });
    expect((await stored('MH', target.guid)).narration).not.toBe('stale');
  });

  test('a renamed ledger marks the company for a resync, which re-pulls the vouchers under the new name', async () => {
    const zepto = 'Kiranakart Technologies Pvt Ltd (Zepto)';
    books.renameLedger('MH', zepto, 'Zepto Marketplace');
    const light = await sync('MH', 'light');
    expect(light.ok).toBe(true);
    expect((await stateOf('MH')).needs_resync).toBe(1);

    const resync = await sync('MH', 'resync');
    expect(resync.ok).toBe(true);
    const parties = await rams.all(
      'SELECT DISTINCT party FROM tally_vouchers WHERE company_id = ? AND deleted_at IS NULL AND party LIKE ?',
      [await companyId('MH'), '%Zepto%'],
    );
    expect(parties.map((r) => r.party)).toEqual(['Zepto Marketplace']);
    expect(await stateOf('MH')).toMatchObject({ needs_resync: 0, backfill_done: 1, alt_vch_id: books.company('MH').altVchId });
  });

  test("a restored backup (Tally's counters went back) cannot light-sync, and a resync rebuilds the company", async () => {
    const hr = books.company('HR');
    const newest = [...hr.vouchers].sort((a, b) => b.alterId - a.alterId)[0];
    books.restoreOlderBackup('HR');
    await expect(sync('HR', 'light')).rejects.toThrow(/counters went backward/);
    expect((await stateOf('HR')).alt_vch_id).not.toBe(hr.altVchId); // unchanged by the failed run

    expect((await sync('HR', 'resync')).ok).toBe(true);
    expect((await stored('HR', newest.guid)).deleted_at).toBeTruthy();
    expect(await stateOf('HR')).toMatchObject({ alt_vch_id: hr.altVchId, backfill_done: 1 });
  });

  test('an interrupted backfill resumes after the last month it finished', async () => {
    const wb = books.company('WB');
    books.dataset.failWhen = (d) => d.company === wb.name && /rams vouchers/i.test(d.id) && d.from >= '2026-07-01';
    await expect(sync('WB', 'backfill')).rejects.toThrow(/Mock Tally was told to fail/);
    expect(await stateOf('WB')).toMatchObject({ backfill_through: '2026-06-30', backfill_done: 0, alt_vch_id: null });
    const run = await rams.one('SELECT status FROM tally_sync_runs WHERE company_id = ? ORDER BY id DESC', [await companyId('WB')]);
    expect(run.status).toBe('failed');

    books.dataset.failWhen = null;
    const before = mock.requests.length;
    expect((await sync('WB', 'backfill')).ok).toBe(true);
    const months = mock.requests.slice(before).filter((r) => r.company === wb.name && /^rams vouchers$/i.test(r.id));
    expect(months[0].from).toBe('2026-07-01');
    expect(await stateOf('WB')).toMatchObject({ backfill_done: 1, alt_vch_id: wb.altVchId });
  });

  test('Tally refusing a request fails the run, and the watermark stays where it was', async () => {
    const mh = books.company('MH');
    const watermark = (await stateOf('MH')).alt_vch_id;
    books.add('MH', { ...inWindow(mh)[1], guid: undefined, narration: 'new one' });
    books.dataset.failWhen = (d) => /changed/i.test(d.id);
    try {
      await expect(sync('MH', 'light')).rejects.toThrow(/Mock Tally was told to fail/);
    } finally {
      books.dataset.failWhen = null;
    }
    expect((await stateOf('MH')).alt_vch_id).toBe(watermark);
    expect((await sync('MH', 'light')).counts.vouchers).toBe(1);
  });

  test('when RAMS cannot be reached, nothing is pulled and nothing moves', async () => {
    const offline = createApiClient({ apiUrl: 'http://127.0.0.1:9', token: rams.token, retries: 0, timeoutMs: 2000 });
    const { live, reply } = await heartbeat();
    const company = reply.companies.find((c) => c.guid === 'company-mh');
    const before = mock.requests.length;
    await expect(syncCompany({
      tally, api: offline, company, live: live.find((c) => c.guid === 'company-mh'), kind: 'light',
      syncFrom: reply.settings.syncFrom, today: TODAY,
    })).rejects.toThrow(/RAMS did not answer/);
    expect(mock.requests.length).toBe(before);
  });
});
