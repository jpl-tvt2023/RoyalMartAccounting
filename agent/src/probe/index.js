// Phase 0 probe: pull masters and vouchers from every loaded Tally company,
// read-only, and write them to a probe folder (layout in store.js).
//
// Order of work per company: the four master lists, then the vouchers one
// month at a time (or --chunk-days), so no single request is big enough to
// freeze the accountant's Tally for long. A failed month is recorded and
// skipped; only losing Tally altogether stops the run.
const fs = require('fs');
const path = require('path');
const { findAll } = require('../tally/parse');
const { describeRequest } = require('../tally/requests');
const { baseTypeResolver } = require('../tally/normalize');
const { listCompanies, pullMasters, pullPeriod } = require('../tally/pull');
const { periods, slugify, writeJson } = require('../util');
const store = require('./store');
const { buildProfile } = require('./profile');
const { version } = require('../../package.json');

async function runProbe({
  client, outDir, from, to, only = [], chunkDays = null, keepRaw = false, log = () => {},
}) {
  fs.mkdirSync(outDir, { recursive: true });
  const raw = keepRaw ? store.makeRawSaver(outDir) : null;
  const run = {
    tool: 'rams-connector', version, mode: 'probe', tally: client.where,
    startedAt: new Date().toISOString(), finishedAt: null,
    from, to, chunkDays, only, companies: [], skippedCompanies: [], errors: [],
  };
  const saveRun = () => writeJson(path.join(outDir, 'probe.json'), run);

  const ping = await client.ping();
  run.ping = ping;
  if (!ping.ok) throw new Error(`Something answered on ${client.where} but it is not TallyPrime: "${ping.message.slice(0, 120)}"`);
  log(`Tally is running at ${client.where} (${ping.message}).`);

  const loaded = await listCompanies(client, raw);
  if (!loaded.length) throw new Error('Tally answered, but no company is open. Open all three Roymax companies (Alt+F3 → Select Company), then run again.');
  const wanted = only.map((o) => o.toLowerCase());
  const selected = wanted.length ? loaded.filter((c) => wanted.some((w) => c.name.toLowerCase().includes(w))) : loaded;
  run.skippedCompanies = loaded.filter((c) => !selected.includes(c)).map((c) => c.name);
  for (const w of wanted) {
    if (!loaded.some((c) => c.name.toLowerCase().includes(w))) run.errors.push(`No open company matches "${w}". Open: ${loaded.map((c) => c.name).join(', ')}`);
  }
  log(`Open companies: ${loaded.map((c) => c.name).join(' · ')}`);

  const usedSlugs = new Set();
  for (const company of selected) {
    let slug = slugify(company.name);
    for (let i = 2; usedSlugs.has(slug); i++) slug = `${slugify(company.name)}-${i}`;
    usedSlugs.add(slug);
    const entry = { ...company, slug, masters: {}, periods: [], vouchers: 0, errors: [] };
    run.companies.push(entry);
    saveRun();
    log(`\n${company.name}`);

    let pulled;
    try {
      pulled = await pullMasters(client, company, {
        onResponse: ({ accountType, tag, request, res, list }) => {
          if (raw) raw.save(`${slug}/masters-${slugify(accountType)}.xml`, request, res.text, describeRequest);
          entry.masters[accountType] = list.length;
          store.writeSample(outDir, slug, `master-${slugify(accountType)}`, findAll(res.tree, tag).slice(0, 3));
          log(`  ${accountType}: ${list.length}`);
        },
      });
    } catch (e) {
      run.errors.push(e.message);
      saveRun();
      throw e;
    }
    for (const err of pulled.errors) {
      entry.errors.push(err);
      log(`  ${err.replace(/^([^:]+): /, '$1: FAILED — ')}`);
    }
    const masters = { groups: [], ledgers: [], stockItems: [], voucherTypes: [], ...pulled.masters };
    store.writeMasters(outDir, slug, masters);

    const baseTypeOf = baseTypeResolver(masters.voucherTypes);
    const writer = store.openVoucherWriter(outDir, slug);
    const seen = new Set();
    const samples = new Map(); // voucher type → first raw objects
    const start = /^\d{4}-\d{2}-\d{2}$/.test(company.booksFrom) && company.booksFrom > from ? company.booksFrom : from;
    for (const p of start <= to ? periods(start, to, chunkDays) : []) {
      try {
        const got = await pullPeriod(client, company, p, {
          baseTypeOf,
          onResponse: ({ request, res }) => {
            if (raw) raw.save(`${slug}/vouchers-${p.from}_${p.to}.xml`, request, res.text, describeRequest);
          },
        });
        const { stray, ask } = got;
        const fresh = [];
        got.vouchers.forEach((v, i) => {
          const key = v.guid || `${v.type}|${v.number}|${v.date}`;
          if (seen.has(key)) return;
          seen.add(key);
          fresh.push(v);
          const list = samples.get(v.type) || [];
          if (list.length < 2) samples.set(v.type, [...list, got.objects[i]]);
        });
        writer.write(fresh);
        entry.vouchers += fresh.length;
        entry.periods.push({ ...p, vouchers: fresh.length, ms: got.ms, ...(stray.length ? { stray: stray.length } : {}) });
        if (stray.length) {
          const dates = [...new Set(stray)].sort();
          entry.errors.push(`Vouchers ${p.from}…${p.to}: Tally sent ${stray.length} dated outside ${ask.from}…${ask.to} `
            + `(${dates[0]} … ${dates[dates.length - 1]}) — it ignored the period asked for`);
        }
        log(`  ${p.from} … ${p.to}: ${fresh.length} vouchers (${(got.ms / 1000).toFixed(1)}s)`
          + (stray.length ? ` — ${stray.length} outside the period DROPPED` : ''));
      } catch (e) {
        if (e.code === 'UNREACHABLE') { run.errors.push(e.message); saveRun(); throw e; }
        entry.periods.push({ ...p, error: e.message });
        entry.errors.push(`Vouchers ${p.from}…${p.to}: ${e.message}`);
        log(`  ${p.from} … ${p.to}: FAILED — ${e.message}`);
      }
      saveRun();
    }
    for (const [type, objs] of samples) store.writeSample(outDir, slug, `voucher-${type}`, objs);
  }

  run.finishedAt = new Date().toISOString();
  saveRun();
  if (raw) raw.finish();
  const profile = buildProfile(outDir);
  return { outDir, run, profile };
}

module.exports = { runProbe, listCompanies };
