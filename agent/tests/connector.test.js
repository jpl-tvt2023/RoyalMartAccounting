// Unit tests for the M3 Connector pieces that need neither Tally nor RAMS.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { decide, isOfficeHours, lastHeavyMoment } = require('../src/sync/scheduler');
const { createApiClient } = require('../src/api/client');
const {
  changedVouchersRequest, voucherListRequest, sysInfoRequest, describeRequest,
} = require('../src/tally/requests');
const { parseXml } = require('../src/tally/parse');
const { voucherListFrom, sysInfoFrom, voucherFrom } = require('../src/tally/normalize');
const {
  loadConfig, defaultConfigFile, applySchedule, describeSchedule, DEFAULTS,
} = require('../src/connectorConfig');
const { createLogger, redact } = require('../src/logger');
const { dueKind } = require('../src/cli');
const { createMockTally } = require('../mock/server');
const { buildDataset } = require('../mock/dataset');
const { createTallyClient } = require('../src/tally/client');
const { syncCompany } = require('../src/sync');
const { createDryRunApi } = require('../src/api/dryRun');

const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'rams-connector-'));

describe('scheduler', () => {
  const cfg = { ...DEFAULTS }; // Mon-Sat 09:00-20:00, hourly, heavy after 19:30
  const monday = (hh, mm = 0) => new Date(2026, 9, 5, hh, mm); // 5 Oct 2026 is a Monday
  const done = {
    backfillDone: true, backfillThrough: '2027-03-31', needsResync: false, altVchId: 100, altMstId: 50,
    lastHeavyAt: null, lastLightAt: null,
  };
  // RAMS's UTC timestamp for a local Date.
  const ramsTime = (d) => d.toISOString().replace('T', ' ').slice(0, 19);
  const heavyDoneAt = (d) => ({ ...done, lastHeavyAt: ramsTime(d) });
  const live = { altVchId: 100, altMstId: 50 };

  test('office hours: Monday to Saturday, 09:00 up to 20:00, on this PC\'s clock', () => {
    expect(isOfficeHours(monday(9), cfg.officeHours)).toBe(true);
    expect(isOfficeHours(monday(19, 59), cfg.officeHours)).toBe(true);
    expect(isOfficeHours(monday(20), cfg.officeHours)).toBe(false);
    expect(isOfficeHours(monday(8, 59), cfg.officeHours)).toBe(false);
    expect(isOfficeHours(new Date(2026, 9, 4, 11), cfg.officeHours)).toBe(false); // Sunday
  });

  test('the end-of-day moment is today\'s once it has passed, else yesterday\'s', () => {
    expect(lastHeavyMoment(monday(20), '19:30')).toEqual(monday(19, 30));
    expect(lastHeavyMoment(monday(10), '19:30')).toEqual(new Date(2026, 9, 4, 19, 30));
  });

  test('a company not loaded in Tally is left alone', () => {
    expect(decide({ now: monday(10), cfg, sync: done, live: null })).toMatchObject({ kind: null, reason: 'not loaded in Tally' });
  });

  test('backfill, resync and a restored backup wait for the end of office hours', () => {
    const fresh = { ...done, backfillDone: false, backfillThrough: null };
    expect(decide({ now: monday(10), cfg, sync: fresh, live }).kind).toBeNull();
    expect(decide({ now: monday(21), cfg, sync: fresh, live }).kind).toBe('backfill');
    expect(decide({ now: monday(21), cfg, sync: { ...fresh, backfillThrough: '2026-07-31' }, live }).reason).toMatch(/resumes after 2026-07-31/);
    expect(decide({ now: monday(10), cfg: { ...cfg, backfillInOfficeHours: true }, sync: fresh, live }).kind).toBe('backfill');
    expect(decide({ now: monday(21), cfg, sync: { ...done, needsResync: true }, live }).kind).toBe('resync');
    const restored = { altVchId: 90, altMstId: 50 };
    expect(decide({ now: monday(10), cfg, sync: heavyDoneAt(monday(9)), live: restored }))
      .toMatchObject({ kind: null, reason: expect.stringMatching(/went backward.*waits/) });
    expect(decide({ now: monday(21), cfg, sync: heavyDoneAt(monday(9)), live: restored }).kind).toBe('resync');
  });

  test('the end-of-day check: after 19:30, or at the next start if the PC was off then', () => {
    const lastNight = heavyDoneAt(new Date(2026, 9, 4, 19, 45));
    expect(decide({ now: monday(19, 29), cfg, sync: lastNight, live, lastLightCheck: monday(19) }).kind).toBeNull();
    expect(decide({ now: monday(19, 31), cfg, sync: lastNight, live }).kind).toBe('heavy');
    expect(decide({ now: monday(19, 40), cfg, sync: heavyDoneAt(monday(19, 31)), live, lastLightCheck: monday(19, 31) }).kind).toBeNull();
    // Off on Saturday evening: Monday morning catches up.
    const saturday = heavyDoneAt(new Date(2026, 9, 3, 12));
    expect(decide({ now: monday(9, 5), cfg, sync: saturday, live }).kind).toBe('heavy');
  });

  test('light: hourly in office hours, and only when a counter moved', () => {
    const synced = heavyDoneAt(new Date(2026, 9, 4, 19, 45));
    expect(decide({ now: monday(10), cfg, sync: synced, live })).toMatchObject({ kind: null, checked: true });
    expect(decide({ now: monday(10), cfg, sync: synced, live: { altVchId: 103, altMstId: 50 } }).kind).toBe('light');
    expect(decide({ now: monday(10), cfg, sync: synced, live: { altVchId: 100, altMstId: 51 } }).kind).toBe('light');
    const recently = monday(9, 30);
    expect(decide({ now: monday(10), cfg, sync: synced, live: { altVchId: 103, altMstId: 50 }, lastLightCheck: recently }).reason).toBe('checked recently');
    expect(decide({ now: monday(10, 31), cfg, sync: synced, live: { altVchId: 103, altMstId: 50 }, lastLightCheck: recently }).kind).toBe('light');
    // A clock that went back does not freeze the hourly check.
    expect(decide({ now: monday(10), cfg, sync: synced, live: { altVchId: 103, altMstId: 50 }, lastLightCheck: monday(15) }).kind).toBe('light');
    expect(decide({ now: monday(21), cfg, sync: heavyDoneAt(monday(19, 45)), live: { altVchId: 103, altMstId: 50 } }).reason).toBe('outside office hours');
  });

  test("a one-off `sync` without --kind does what is due", () => {
    expect(dueKind({ ...done, needsResync: true }, live)).toBe('resync');
    expect(dueKind({ ...done, backfillDone: false }, live)).toBe('backfill');
    expect(dueKind(done, { altVchId: 99, altMstId: 50 })).toBe('resync');
    expect(dueKind(done, live)).toBe('light');
  });
});

describe('RAMS API client', () => {
  const reply = (status, body) => ({ ok: status < 300, status, text: async () => JSON.stringify(body) });
  const make = (responses, opts = {}) => {
    const calls = [];
    const fetchImpl = async (url, init) => {
      calls.push({ url, init });
      const next = responses.shift();
      if (next instanceof Error) throw next;
      return next;
    };
    return { calls, api: createApiClient({ apiUrl: 'https://rams.example/', token: 'rams_secret', fetchImpl, sleep: async () => {}, ...opts }) };
  };

  test('posts JSON with the Connector token to /api/agent/*', async () => {
    const { calls, api } = make([reply(201, { run_id: 7 })]);
    expect(await api.startRun({ company_id: 1, kind: 'light' })).toEqual({ run_id: 7 });
    expect(calls[0].url).toBe('https://rams.example/api/agent/runs');
    expect(calls[0].init.headers.Authorization).toBe('Bearer rams_secret');
    expect(JSON.parse(calls[0].init.body)).toEqual({ company_id: 1, kind: 'light' });
  });

  test('sends again after a network error or a 5xx, then gives up clearly', async () => {
    const { calls, api } = make([new TypeError('fetch failed'), reply(503, {}), reply(200, { upserted: 3 })]);
    expect(await api.vouchers(4, [{ guid: 'g' }])).toEqual({ upserted: 3 });
    expect(calls).toHaveLength(3);

    const down = make([new TypeError('fetch failed'), new TypeError('fetch failed')], { retries: 1 });
    await expect(down.api.heartbeat({})).rejects.toMatchObject({ code: 'UNREACHABLE', message: expect.stringMatching(/RAMS did not answer/) });
  });

  test('a rejected token and a refusal are not retried', async () => {
    const { calls, api } = make([reply(401, { message: 'Connector token rejected' })]);
    await expect(api.heartbeat({})).rejects.toMatchObject({ code: 'TOKEN_REJECTED', status: 401 });
    expect(calls).toHaveLength(1);
    const refused = make([reply(409, { message: 'Sync is turned off for MH' })]);
    await expect(refused.api.startRun({})).rejects.toMatchObject({ status: 409, message: 'Sync is turned off for MH' });
  });

  test('a finish RAMS already recorded (its answer was lost) counts as done', async () => {
    const { api } = make([reply(409, { message: 'This run is already ok' })]);
    expect(await api.finish(3, { ok: true })).toEqual({ sync: null });
  });

  test('a match RAMS is already running counts as started, not as an error', async () => {
    const { calls, api } = make([reply(200, { run_id: 4, counts: { po: { linked: 2 } } }), reply(409, { message: 'Matching is already running' })]);
    expect(await api.match()).toMatchObject({ run_id: 4 });
    expect(calls[0].url).toBe('https://rams.example/api/agent/match');
    expect(await api.match()).toEqual({ skipped: true, message: 'Matching is already running' });
  });

  test('needs an address and a token', () => {
    expect(() => createApiClient({ apiUrl: '', token: 'x' })).toThrow(/No RAMS address/);
    expect(() => createApiClient({ apiUrl: 'https://x', token: '' })).toThrow(/No Connector token/);
  });
});

describe('the M3 Tally requests', () => {
  test('changed vouchers: the voucher collection filtered on AlterID, read back by the mock', () => {
    const xml = changedVouchersRequest({ company: 'Roymax MH', from: '2026-06-01', to: '2027-03-31', afterAlterId: 56800 });
    expect(xml).toContain('<FILTER>RAMSAlteredAfter</FILTER>');
    expect(xml).toContain('<SYSTEM TYPE="Formulae" NAME="RAMSAlteredAfter">$AlterID &gt; 56800</SYSTEM>');
    expect(xml).toContain('<NATIVEMETHOD>*</NATIVEMETHOD>');
    expect(describeRequest(xml)).toMatchObject({ id: 'RAMS Changed Vouchers', company: 'Roymax MH', afterAlterId: 56800, from: '2026-06-01' });
    expect(() => changedVouchersRequest({ company: 'x', from: '2026-06-01', to: '2026-06-30', afterAlterId: 'abc' })).toThrow(/Bad AlterID/);
  });

  test('the voucher list asks for GUID, AlterID and date only', () => {
    const xml = voucherListRequest({ company: 'Roymax MH', from: '2026-07-01', to: '2026-07-31' });
    expect(xml).toContain('<FETCH>GUID, AlterID, Date</FETCH>');
    expect(xml).not.toContain('NATIVEMETHOD');
    const tree = parseXml('<ENVELOPE><VOUCHER REMOTEID="r1"><GUID>g1</GUID><ALTERID> 46447</ALTERID><DATE>20260701</DATE></VOUCHER>'
      + '<VOUCHER REMOTEID="r2"><ALTERID>5</ALTERID><DATE>20260702</DATE></VOUCHER></ENVELOPE>');
    expect(voucherListFrom(tree)).toEqual([
      { guid: 'g1', alterId: 46447, date: '2026-07-01' },
      { guid: 'r2', alterId: 5, date: '2026-07-02' },
    ]);
  });

  test("the licence check: Tally's flags, or the swapped 15th when they are blank", () => {
    const xml = sysInfoRequest({ today: '2026-10-05' });
    expect(xml).toContain('<SVFROMDATE TYPE="Date">20261015</SVFROMDATE>');
    expect(xml).toContain('$$LicenseInfo:IsEducationalMode');
    const row = (edu, lic, echo) => parseXml(`<RAMSSYSINFO><ROW><NAME>MH</NAME><EDUCATIONAL>${edu}</EDUCATIONAL><LICENSED>${lic}</LICENSED><FROMDATE>${echo}</FROMDATE></ROW></RAMSSYSINFO>`);
    expect(sysInfoFrom(row('Yes', 'No', '1-Oct-26'))).toEqual({ educational: true, licensed: false });
    expect(sysInfoFrom(row('No', 'Yes', '15-Oct-26'))).toEqual({ educational: false, licensed: true });
    expect(sysInfoFrom(row('', '', '1-Oct-26'))).toEqual({ educational: true, licensed: null });
    expect(sysInfoFrom(row('', '', '15-Oct-26'))).toEqual({ educational: false, licensed: null });
    expect(sysInfoFrom(parseXml('<ENVELOPE></ENVELOPE>'))).toEqual({ educational: null, licensed: null });
  });

  test('vouchers sent to RAMS leave out the Phase 0 discovery index', () => {
    const tree = parseXml('<VOUCHER><GUID>g</GUID><ALTERID>3</ALTERID><DATE>20260701</DATE><VOUCHERNUMBER>607/RM/26-27</VOUCHERNUMBER></VOUCHER>');
    const obj = tree.VOUCHER;
    expect(voucherFrom(obj)).toHaveProperty('docFields');
    expect(voucherFrom(obj, { docFields: false })).not.toHaveProperty('docFields');
  });
});

describe('connector.json', () => {
  test('defaults, then the file, then environment variables', () => {
    const dir = tmpDir();
    const file = path.join(dir, 'connector.json');
    fs.writeFileSync(file, `﻿${JSON.stringify({ apiUrl: 'https://file', token: 'from-file', officeHours: { end: '18:00' }, tally: { port: 9999 } })}`);
    const { config, found } = loadConfig({ file, env: { RAMS_API_TOKEN: 'from-env', RAMS_TALLY_HOST: '10.0.0.5' } });
    expect(found).toBe(true);
    expect(config).toMatchObject({
      apiUrl: 'https://file', token: 'from-env', lightEveryMinutes: 60, heavyAfter: '19:30',
      officeHours: { days: [1, 2, 3, 4, 5, 6], start: '09:00', end: '18:00' },
      tally: { host: '10.0.0.5', port: 9999, timeoutSeconds: 300 },
    });
  });

  test('a bad setting is named', () => {
    const dir = tmpDir();
    const file = path.join(dir, 'connector.json');
    fs.writeFileSync(file, JSON.stringify({ heavyAfter: '7pm', batchSize: 500, officeHours: { days: [7] } }));
    expect(() => loadConfig({ file, env: {} })).toThrow(/officeHours.days.*heavyAfter must be HH:MM.*batchSize can be at most 250/);
    fs.writeFileSync(file, '{ not json');
    expect(() => loadConfig({ file, env: {} })).toThrow(/is not valid JSON/);
    expect(() => loadConfig({ file: path.join(dir, 'missing.json'), env: {} })).toThrow(/No such config file/);
  });

  test('the office PC install in %ProgramData%\\RAMS wins over the dev copy, and keeps its logs beside it', () => {
    const programData = tmpDir();
    fs.mkdirSync(path.join(programData, 'RAMS'));
    const installed = path.join(programData, 'RAMS', 'connector.json');
    fs.writeFileSync(installed, '{}');
    expect(defaultConfigFile({ env: { ProgramData: programData }, platform: 'win32' })).toBe(installed);
    expect(defaultConfigFile({ env: { ProgramData: programData }, platform: 'linux' })).toBe(path.resolve(__dirname, '..', 'connector.json'));
    const { config } = loadConfig({ env: { ProgramData: programData }, platform: 'win32' });
    expect(config.logDir).toBe(path.join(programData, 'RAMS', 'logs'));
  });
});

describe("the sync schedule from RAMS", () => {
  const fromRams = {
    officeHours: { days: [1, 2, 3, 4, 5], start: '10:00', end: '18:30' },
    lightEveryMinutes: 30, heavyAfter: '18:45', backfillInOfficeHours: false,
  };

  test("RAMS's schedule replaces connector.json's; without one, the file's stands", () => {
    const cfg = { ...DEFAULTS, token: 'kept', batchSize: 80 };
    expect(applySchedule(cfg, fromRams)).toMatchObject({ ...fromRams, token: 'kept', batchSize: 80 });
    expect(applySchedule(cfg, null)).toBe(cfg);
    expect(describeSchedule(DEFAULTS)).toBe('Mon–Sat 09:00–20:00, light sync every 60 min, end-of-day check after 19:30');
    // Only the days sent: the times stay as they were.
    expect(describeSchedule(applySchedule(cfg, { ...fromRams, officeHours: { days: [1, 3, 5] } })))
      .toBe('Mon, Wed, Fri 09:00–20:00, light sync every 30 min, end-of-day check after 18:45');
  });

  test('a schedule this Connector cannot use is refused, naming the problem', () => {
    expect(() => applySchedule(DEFAULTS, { ...fromRams, heavyAfter: 'late' }))
      .toThrow(/RAMS sent a sync schedule this Connector cannot use \(heavyAfter must be HH:MM\)/);
  });
});

describe('the log', () => {
  test('one file a day, old ones removed, and never a Connector token', () => {
    const dir = tmpDir();
    fs.writeFileSync(path.join(dir, 'rams-connector-2026-09-01.log'), 'old\n');
    fs.writeFileSync(path.join(dir, 'rams-connector-2026-10-01.log'), 'recent\n');
    const log = createLogger({ dir, keepDays: 14, echo: false, now: () => new Date(2026, 9, 5, 10) });
    log('using token rams_AbCdEfGhIjKlMnOpQrStUvWxYz0123456789');
    log.error('Tally: down');
    expect(fs.readdirSync(dir).sort()).toEqual(['rams-connector-2026-10-01.log', 'rams-connector-2026-10-05.log']);
    const text = fs.readFileSync(path.join(dir, 'rams-connector-2026-10-05.log'), 'utf8');
    expect(text).toContain('INFO  using token rams_***');
    expect(text).toContain('ERROR Tally: down');
    expect(redact('Bearer rams_short')).toBe('Bearer rams_short');
  });
});

describe('sync --dry-run', () => {
  test('a backfill written to files, nothing sent', async () => {
    const dataset = buildDataset();
    const server = createMockTally({ dataset });
    await new Promise((resolve) => { server.listen(0, '127.0.0.1', resolve); });
    try {
      const tally = createTallyClient({ port: server.address().port, timeoutMs: 10000 });
      const outDir = tmpDir();
      const api = createDryRunApi({ outDir, names: new Map([[1, 'MH']]) });
      const mh = dataset.companies[0];
      const live = { name: mh.name, guid: mh.guid, altVchId: mh.altVchId, altMstId: mh.altMstId };
      const result = await syncCompany({
        tally, api, company: { id: 1, guid: mh.guid, name: mh.name, code: 'MH', sync: {} }, live,
        kind: 'backfill', syncFrom: '2026-04-01', today: '2026-10-05',
      });
      expect(result.ok).toBe(true);
      expect(fs.readdirSync(outDir).sort()).toEqual(['mh-masters.json', 'mh-reconcile.json', 'mh-start.json', 'mh-vouchers.jsonl']);
      const vouchers = fs.readFileSync(path.join(outDir, 'mh-vouchers.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
      expect(vouchers).toHaveLength(mh.vouchers.filter((v) => v.date >= '2026-04-01').length);
      expect(vouchers[0]).not.toHaveProperty('docFields');
      expect(JSON.parse(fs.readFileSync(path.join(outDir, 'mh-reconcile.json'), 'utf8'))).toHaveLength(12);
    } finally {
      server.close();
      server.closeAllConnections();
    }
  });
});
