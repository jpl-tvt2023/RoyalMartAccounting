// The `run` service: heartbeat, scheduler and syncs together, on a fake clock,
// against the mock Tally and the real RAMS API (helpers/rams.js).
const { buildDataset } = require('../mock/dataset');
const { editBooks } = require('../mock/books');
const { createTallyClient } = require('../src/tally/client');
const { createApiClient } = require('../src/api/client');
const { createService } = require('../src/run');
const { DEFAULTS } = require('../src/connectorConfig');
const { startRams, startMockTally, hasBackend } = require('./helpers/rams');

const describeIf = hasBackend ? describe : describe.skip;
jest.setTimeout(180000);

// Today on this PC's clock at hh:mm. RAMS stamps runs with the real time, so
// the fake clock stays on today's date.
const at = (hh, mm = 0) => { const d = new Date(); d.setHours(hh, mm, 0, 0); return d; };
// connector.json's schedule (Mon-Sat, end-of-day after 19:30) is only a
// fallback: the schedule in force comes from RAMS -- here every day,
// 09:00-20:00, and the end-of-day check after 23:59 so it never falls due by
// accident.
const cfg = { ...DEFAULTS, batchSize: 50 };
const setSchedule = (sql) => rams.db.execute(`UPDATE sync_settings SET ${sql} WHERE id = 1`);

let rams;
let mock;
let books;
let service;
let clock;
const runsCount = async () => Number((await rams.one('SELECT COUNT(*) AS n FROM tally_sync_runs')).n);

describeIf('rams-connector run', () => {
  beforeAll(async () => {
    rams = await startRams({ name: 'run' });
    await setSchedule("office_days = '0,1,2,3,4,5,6', heavy_after = '23:59'");
    books = editBooks(buildDataset());
    mock = await startMockTally(books.dataset);
    clock = at(5);
    service = createService({
      cfg,
      tally: createTallyClient({ port: mock.port, timeoutMs: 10000 }),
      api: createApiClient({ apiUrl: rams.url, token: rams.token, retries: 0 }),
      now: () => clock,
    });
  });

  afterAll(async () => {
    await mock?.close();
    await rams?.close();
  });

  test('first contact: RAMS lists every company with sync off, and nothing is read from their books', async () => {
    const results = await service.cycle();
    expect(results).toEqual([]);
    const rows = await rams.all('SELECT guid, sync_enabled FROM tally_companies ORDER BY guid');
    expect(rows.map((r) => [r.guid, r.sync_enabled])).toEqual([['company-hr', 0], ['company-mh', 0], ['company-wb', 0]]);
    expect(mock.requests.filter((r) => /vouchers|list of accounts/i.test(r.id))).toEqual([]);
    const agent = await rams.one('SELECT status, version FROM agents WHERE last_seen_at IS NOT NULL');
    expect(JSON.parse(agent.status).tally).toMatchObject({ reachable: true, educational: false, licensed: true });
    // The schedule in force is RAMS's, not connector.json's.
    expect(service.state.cfg).toMatchObject({ heavyAfter: '23:59', officeHours: { days: [0, 1, 2, 3, 4, 5, 6] } });
    expect(cfg.heavyAfter).toBe('19:30');
  });

  test('after an Admin turns companies on, the backfill runs outside office hours, not during them', async () => {
    await rams.enable('company-mh');
    await rams.enable('company-wb');
    clock = at(10);
    expect(await service.cycle()).toEqual([]);
    expect(await runsCount()).toBe(0);

    clock = at(21);
    const results = await service.cycle();
    expect(results.map((r) => [r.kind, r.ok])).toEqual([['backfill', true], ['backfill', true]]);
    const states = await rams.all('SELECT backfill_done FROM tally_sync_state');
    expect(states.every((s) => s.backfill_done === 1)).toBe(true);
    expect(await rams.one("SELECT COUNT(*) AS n FROM tally_sync_state s JOIN tally_companies c ON c.id = s.company_id WHERE c.guid = 'company-hr'")).toMatchObject({ n: 0 });
  });

  test('in office hours: a check finds nothing to do, and a change is synced at the next hourly check', async () => {
    clock = at(10);
    const before = await runsCount();
    expect(await service.cycle()).toEqual([]);
    expect(await runsCount()).toBe(before);
    const lastChecked = await rams.one("SELECT s.last_checked_at FROM tally_sync_state s JOIN tally_companies c ON c.id = s.company_id WHERE c.guid = 'company-mh'");
    expect(lastChecked.last_checked_at).toBeTruthy();

    const target = books.company('MH').vouchers.find((v) => v.date >= '2026-04-01');
    books.alter('MH', target.guid, { narration: 'changed at 10:10' });
    clock = at(10, 30);
    expect(await service.cycle()).toEqual([]); // checked under an hour ago

    clock = at(11, 5);
    const results = await service.cycle();
    expect(results.map((r) => [r.kind, r.ok, r.counts.vouchers])).toEqual([['light', true, 1]]);
    const row = await rams.one('SELECT narration FROM tally_vouchers WHERE guid = ?', [target.guid]);
    expect(row.narration).toBe('changed at 10:10');
  });

  test('the end-of-day check runs once its time has passed, and once only', async () => {
    // On the real clock here, because RAMS stamps the check with the real time.
    // An Admin moves the end-of-day time in RAMS; the next heartbeat brings it.
    const real = new Date();
    const due = new Date(real.getTime() - 2 * 60000);
    await setSchedule(`heavy_after = '${String(due.getHours()).padStart(2, '0')}:${String(due.getMinutes()).padStart(2, '0')}'`);
    await rams.db.execute("UPDATE tally_sync_state SET last_heavy_at = datetime('now', '-2 days')");
    clock = real;
    const results = await service.cycle();
    expect(results.map((r) => r.kind)).toEqual(['heavy', 'heavy']);
    expect(await service.cycle()).toEqual([]);
  });

  test('when Tally stops answering, the heartbeat says so and nothing is synced', async () => {
    await mock.close();
    mock = null;
    clock = new Date(clock.getTime() + 10 * 60000);
    expect(await service.cycle()).toEqual([]);
    expect(service.state.tally.reachable).toBe(false);
    expect(service.state.lastError).toMatch(/^Tally: (Nothing is listening|Tally dropped the connection)/);
    const agent = await rams.one('SELECT status FROM agents WHERE last_seen_at IS NOT NULL');
    const status = JSON.parse(agent.status);
    expect(status.tally.reachable).toBe(false);
    expect(status.companies).toEqual([]);
    expect(status.lastError).toBe(service.state.lastError);
  });
});
