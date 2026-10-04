#!/usr/bin/env node
// RAMS Connector — command line. Phase 0: read-only probe and analysis.
const fs = require('fs');
const path = require('path');
const { createTallyClient } = require('./tally/client');
const { listCompanies, runProbe } = require('./probe');
const { buildProfile } = require('./probe/profile');
const { readRomsRefs, resolveRomsConnection } = require('./roms/refs');
const { summarizeRefs, renderRefsSummary } = require('./roms/summary');
const { analyze, writeAnalysis } = require('./analyze');
const { previousFyStart, todayIso, readJson, writeJson, mdTable } = require('./util');
const { version } = require('../package.json');

const HELP = `RAMS Connector ${version} — reads TallyPrime, never writes to it.

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

const commands = {
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

module.exports = { main, parseArgs };
