#!/usr/bin/env node
// RAMS Connector — command line. Reads Tally, never writes to it.
//   Phase 0: probe, record, profile, roms-refs, analyze
//   M3:      run (the service), sync (one sync now), status
const fs = require('fs');
const path = require('path');
const { createTallyClient } = require('./tally/client');
const { runProbe } = require('./probe');
const { listCompanies } = require('./tally/pull');
const { buildProfile } = require('./probe/profile');
const { readRomsRefs, resolveRomsConnection } = require('./roms/refs');
const { summarizeRefs, renderRefsSummary } = require('./roms/summary');
const { analyze, writeAnalysis } = require('./analyze');
const { loadConfig } = require('./connectorConfig');
const { createLogger } = require('./logger');
const { createApiClient } = require('./api/client');
const { createDryRunApi } = require('./api/dryRun');
const { createService } = require('./run');
const { syncCompany } = require('./sync');
const { ROMS_GO_LIVE } = require('./config');
const { previousFyStart, todayIso, readJson, writeJson, mdTable } = require('./util');
const { version } = require('../package.json');

const HELP = `RAMS Connector ${version} — reads TallyPrime, never writes to it.

  run                        The service: a heartbeat every minute, light syncs
                             hourly in office hours, the end-of-day check, and the
                             backfill after hours. Settings: connector.json.
  sync [options]             One sync now, then exit.
      --company X            only companies whose code, name or GUID contains X
      --kind K               light | heavy | backfill | resync (default: what is due)
      --dry-run [--out DIR]  backfill into files instead of RAMS (nothing is sent)
      --from YYYY-MM-DD      with --dry-run: first voucher date (default ${ROMS_GO_LIVE})
  status                     What RAMS knows next to what Tally says now.
      --config FILE          for run / sync / status (default: %ProgramData%\\RAMS\\connector.json,
                             else agent/connector.json; see connector.example.json)

  ping                       Is Tally reachable? Which companies are open?
  companies                  Open companies with their AltVchId/AltMstId counters.
  probe [options]            Pull masters + vouchers of every open company into a
                             probe folder and write profile.md (Phase 0).
      --from YYYY-MM-DD      first voucher date (default ${previousFyStart(todayIso())},
                             1 April of last financial year — use ROMS's go-live)
      --to YYYY-MM-DD        last voucher date (default today)
      --company NAME         only companies whose name contains NAME (repeatable)
      --chunk-days N         ask Tally for N days at a time instead of a month
      --keep-raw             also save every raw request/response (large)
      --out DIR              output folder (default out/rams-probe-<date-time>)
  record [options]           probe --keep-raw: recordings the mock Tally can replay.
  profile --probe DIR        Rebuild profile.md from an existing probe folder.
  roms-refs [options]        Read ROMS's PO / RTV references (SELECT only) to JSON.
      --roms-env FILE        ROMS backend/.env (uses TURSO_DATABASE_URL/TOKEN), or
      --roms-db URL [--roms-token T]
      --out FILE             default out/roms-refs-<date-time>.json
  analyze --probe DIR --refs FILE [--out DIR]
                             Compare ROMS with the probe; writes analysis.md.

  Tally connection (all commands that talk to Tally):
      --host H --port P      default 127.0.0.1:9000 (or RAMS_TALLY_HOST/PORT)
      --timeout SECONDS      per request, default 300
      --encoding utf16|utf8  request encoding, default utf16
`;

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { args._.push(a); continue; }
    const eq = a.indexOf('=');
    const key = a.slice(2, eq === -1 ? undefined : eq);
    let value = true;
    if (eq !== -1) value = a.slice(eq + 1);
    else if (argv[i + 1] !== undefined && !argv[i + 1].startsWith('--')) value = argv[++i];
    args[key] = args[key] === undefined ? value : [].concat(args[key], value);
  }
  return args;
}

const stamp = (d = new Date()) => {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
};
const one = (v) => (Array.isArray(v) ? v[v.length - 1] : v);
const many = (v) => (v === undefined || v === true ? [] : [].concat(v));
const need = (args, key) => {
  const v = one(args[key]);
  if (!v || v === true) throw new Error(`--${key} is required. See: rams-connector help`);
  return v;
};
const checkDate = (v, label) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new Error(`${label} must be YYYY-MM-DD, got "${v}"`);
  return v;
};

function tallyClient(args) {
  return createTallyClient({
    host: one(args.host) || process.env.RAMS_TALLY_HOST || '127.0.0.1',
    port: Number(one(args.port) || process.env.RAMS_TALLY_PORT || 9000),
    timeoutMs: Number(one(args.timeout) || 300) * 1000,
    encoding: one(args.encoding) === 'utf8' ? 'utf8' : 'utf16',
  });
}

const log = (s) => console.log(s);

// run / sync / status: settings from connector.json, Tally overridable on the
// command line as for every other command.
function connector(args) {
  const { config, file, found } = loadConfig({ file: one(args.config) });
  if (args.host) config.tally.host = one(args.host);
  if (args.port) config.tally.port = Number(one(args.port));
  const tally = createTallyClient({
    host: config.tally.host,
    port: config.tally.port,
    timeoutMs: config.tally.timeoutSeconds * 1000,
    encoding: config.tally.encoding === 'utf8' ? 'utf8' : 'utf16',
  });
  return { config, file, found, tally };
}

// What a one-off `sync` does when --kind is not given.
function dueKind(sync, live) {
  if (sync.needsResync) return 'resync';
  if (!sync.backfillDone) return 'backfill';
  if (live.altVchId < sync.altVchId || live.altMstId < sync.altMstId) return 'resync';
  return 'light';
}

const KINDS = ['light', 'heavy', 'backfill', 'resync'];
const matches = (wanted, ...values) => !wanted.length
  || wanted.some((w) => values.some((v) => v && String(v).toLowerCase().includes(w)));

const commands = {
  async run(args) {
    const { config, file, found, tally } = connector(args);
    const logger = createLogger({ dir: config.logDir, keepDays: config.keepLogDays });
    logger(`Settings: ${found ? file : 'defaults (no connector.json found)'}`);
    const api = createApiClient({ apiUrl: config.apiUrl, token: config.token });
    const service = createService({ cfg: config, tally, api, log: logger });
    let stopping = false;
    const stop = () => {
      if (!stopping) logger('Stopping after the current step…');
      stopping = true;
    };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
    await service.runForever({ stop: () => stopping });
  },

  async sync(args) {
    const { config, tally } = connector(args);
    const kind = one(args.kind);
    if (kind && !KINDS.includes(kind)) throw new Error(`--kind must be one of ${KINDS.join(', ')}`);
    const wanted = many(args.company).map((w) => String(w).toLowerCase());
    const logger = createLogger({ dir: config.logDir, keepDays: config.keepLogDays });

    if (args['dry-run']) {
      const syncFrom = checkDate(one(args.from) || ROMS_GO_LIVE, '--from');
      const outDir = path.resolve(one(args.out) || path.join('out', `rams-dry-run-${stamp()}`));
      const loaded = (await listCompanies(tally)).filter((c) => matches(wanted, c.name, c.guid));
      if (!loaded.length) throw new Error('No open company matches. Check `ping`.');
      const api = createDryRunApi({ outDir, names: new Map(loaded.map((c, i) => [i + 1, c.name])) });
      for (const [i, live] of loaded.entries()) {
        await syncCompany({
          tally, api, company: { id: i + 1, guid: live.guid, name: live.name, code: live.name, sync: {} }, live,
          kind: 'backfill', syncFrom, today: todayIso(), batchSize: config.batchSize, log: logger,
        });
      }
      logger(`Dry run: nothing was sent. What a backfill from ${syncFrom} would send is in ${outDir}`);
      return;
    }

    const api = createApiClient({ apiUrl: config.apiUrl, token: config.token });
    const service = createService({ cfg: config, tally, api, log: logger });
    await service.checkTally({ force: true });
    if (!service.state.tally.reachable) throw new Error(service.state.tally.message);
    const server = await service.heartbeat();
    if (!server) throw new Error(service.state.lastError);
    const companies = server.companies.filter((c) => matches(wanted, c.code, c.name, c.guid));
    if (!companies.length) {
      throw new Error(server.companies.length
        ? `No company with sync on matches ${wanted.join(', ')}. Sync is on for: ${server.companies.map((c) => c.code || c.name).join(', ')}`
        : 'No company has sync turned on yet. An Admin or Owner turns companies on in RAMS: Admin → Tally companies.');
    }
    let failed = 0;
    for (const company of companies) {
      const label = company.code || company.name;
      const live = service.state.live.find((c) => c.guid === company.guid);
      if (!live) { logger.warn(`${label}: not loaded in Tally — skipped`); failed++; continue; }
      try {
        const result = await syncCompany({
          tally, api, company, live, kind: kind || dueKind(company.sync, live),
          syncFrom: server.settings.syncFrom, today: todayIso(), batchSize: config.batchSize, log: logger,
        });
        if (!result.ok) failed++;
      } catch {
        failed++;
      }
    }
    await service.heartbeat();
    if (failed) throw new Error(`${failed} of ${companies.length} companies did not sync. The log is in ${config.logDir}`);
  },

  async status(args) {
    const { config, tally } = connector(args);
    const api = createApiClient({ apiUrl: config.apiUrl, token: config.token });
    const service = createService({ cfg: config, tally, api, log: () => {} });
    const t = await service.checkTally({ force: true });
    log(t.reachable
      ? `Tally ${tally.where}: answering${t.educational ? ' — EDUCATIONAL MODE (no active licence)' : ''}`
      : `Tally ${tally.where}: NOT answering — ${t.message}`);
    const server = await service.heartbeat();
    if (!server) throw new Error(service.state.lastError);
    log(`RAMS ${api.where}: answering. Sync starts ${server.settings.syncFrom}.\n`);
    const on = new Map(server.companies.map((c) => [c.guid, c]));
    const rows = server.companies.map((c) => {
      const live = service.state.live.find((l) => l.guid === c.guid);
      const s = c.sync;
      return [
        c.code || '—', c.name, 'on',
        live ? `${live.altVchId} / ${live.altMstId}` : 'not loaded',
        s.altVchId == null ? '—' : `${s.altVchId} / ${s.altMstId}`,
        s.backfillDone ? 'done' : (s.backfillThrough ? `through ${s.backfillThrough}` : 'not started'),
        s.lastLightAt || '—', s.lastHeavyAt || '—',
      ];
    });
    for (const live of service.state.live.filter((l) => !on.has(l.guid))) {
      rows.push(['', live.name, 'off', `${live.altVchId} / ${live.altMstId}`, '', '', '', '']);
    }
    log(mdTable(['Code', 'Company', 'Sync', 'Tally AltVchId / AltMstId', 'RAMS watermarks', 'Backfill', 'Last light (UTC)', 'Last end-of-day (UTC)'], rows));
  },

  async ping(args) {
    const client = tallyClient(args);
    const p = await client.ping();
    log(`${client.where}: ${p.message} (${p.ms} ms)`);
    if (!p.ok) throw new Error('That is not TallyPrime answering.');
    const companies = await listCompanies(client);
    log(companies.length ? `Open companies: ${companies.map((c) => c.name).join(' · ')}` : 'No company is open in Tally.');
  },

  async companies(args) {
    const client = tallyClient(args);
    const companies = await listCompanies(client);
    log(mdTable(['Company', 'Books from', 'State', 'AltVchId', 'AltMstId', 'GUID'],
      companies.map((c) => [c.name, c.booksFrom, c.state, c.altVchId ?? '—', c.altMstId ?? '—', c.guid])));
  },

  async probe(args, { keepRaw = false } = {}) {
    const to = checkDate(one(args.to) || todayIso(), '--to');
    const from = checkDate(one(args.from) || previousFyStart(to), '--from');
    if (from > to) throw new Error(`--from ${from} is after --to ${to}`);
    const outDir = path.resolve(one(args.out) || path.join('out', `rams-probe-${stamp()}`));
    const chunkDays = args['chunk-days'] ? Number(one(args['chunk-days'])) : null;
    log(`RAMS Connector ${version} — Phase 0 probe (read-only)\nPeriod ${from} … ${to}\nOutput ${outDir}`);
    const { run } = await runProbe({
      client: tallyClient(args), outDir, from, to, only: many(args.company), chunkDays,
      keepRaw: keepRaw || Boolean(args['keep-raw']), log,
    });
    const errors = run.errors.length + run.companies.reduce((n, c) => n + c.errors.length, 0);
    log(`\nDone: ${run.companies.reduce((n, c) => n + c.vouchers, 0)} vouchers from ${run.companies.length} companies, ${errors} errors.`);
    log(`Report: ${path.join(outDir, 'profile.md')}`);
  },

  record(args) {
    return commands.probe(args, { keepRaw: true });
  },

  profile(args) {
    const dir = path.resolve(need(args, 'probe'));
    buildProfile(dir);
    log(`Report: ${path.join(dir, 'profile.md')}`);
  },

  async 'roms-refs'(args) {
    const connection = resolveRomsConnection({
      romsDb: one(args['roms-db']), romsToken: one(args['roms-token']), romsEnv: one(args['roms-env']),
    });
    const refs = await readRomsRefs(connection);
    const out = path.resolve(one(args.out) || path.join('out', `roms-refs-${stamp()}.json`));
    writeJson(out, refs);
    const summary = renderRefsSummary(summarizeRefs(refs));
    fs.writeFileSync(out.replace(/\.json$/i, '') + '.md', `# ROMS references\n\n${summary}\n`);
    log(`${summary}\n\nSaved ${out} (+ .md)`);
  },

  analyze(args) {
    const probeDir = path.resolve(need(args, 'probe'));
    const refsFile = path.resolve(need(args, 'refs'));
    if (!fs.existsSync(refsFile)) throw new Error(`No such file: ${refsFile}`);
    const outDir = path.resolve(one(args.out) || probeDir);
    const analysis = analyze({ probeDir, refs: readJson(refsFile) });
    writeAnalysis(analysis, outDir);
    for (const w of analysis.warnings) log(`⚠ ${w}`);
    log(`Report: ${path.join(outDir, 'analysis.md')}`);
  },
};

async function main(argv) {
  const args = parseArgs(argv);
  const name = args._[0];
  if (!name || name === 'help' || args.help) { log(HELP); return 0; }
  const command = commands[name];
  if (!command) { console.error(`Unknown command "${name}".\n\n${HELP}`); return 2; }
  try {
    await command(args);
    return 0;
  } catch (e) {
    console.error(`\n✖ ${e.message}`);
    if (process.env.RAMS_DEBUG) console.error(e.stack);
    return 1;
  }
}

if (require.main === module) main(process.argv.slice(2)).then((code) => { process.exitCode = code; });

module.exports = { main, parseArgs, dueKind };
