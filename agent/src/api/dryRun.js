// `sync --dry-run`: the RAMS API, replaced by files. Everything a backfill
// would send is written to a folder instead, and nothing leaves the PC:
//
//   <code>-start.json     the run as it would start (counters)
//   <code>-masters.json   the master lists
//   <code>-vouchers.jsonl one voucher per line
//   <code>-reconcile.json each month's GUID list
const fs = require('fs');
const path = require('path');
const { writeJson, slugify } = require('../util');

// names: company id -> the label its files are named after.
function createDryRunApi({ outDir, names = new Map() }) {
  fs.mkdirSync(outDir, { recursive: true });
  const runs = new Map(); // run id -> file prefix
  const counts = new Map();
  const file = (runId, suffix) => path.join(outDir, `${runs.get(runId)}-${suffix}`);

  return {
    where: `dry run -> ${outDir}`,
    outDir,
    counts,
    async heartbeat() { return { companies: [], settings: {}, commands: [] }; },
    async startRun(body) {
      const runId = runs.size + 1;
      runs.set(runId, slugify(names.get(body.company_id) || `company-${body.company_id}`));
      counts.set(runId, { vouchers: 0, months: 0 });
      writeJson(file(runId, 'start.json'), body);
      fs.writeFileSync(file(runId, 'vouchers.jsonl'), '');
      writeJson(file(runId, 'reconcile.json'), []);
      return { run_id: runId, sync: { altVchId: null, altMstId: null, backfillThrough: null, backfillDone: false } };
    },
    async masters(runId, body) {
      writeJson(file(runId, 'masters.json'), body);
      const n = Object.values(body).reduce((sum, list) => sum + list.length, 0);
      return { upserted: n, unchanged: 0, deleted: 0, renamed: 0 };
    },
    async vouchers(runId, list) {
      fs.appendFileSync(file(runId, 'vouchers.jsonl'), list.map((v) => JSON.stringify(v)).join('\n') + '\n');
      counts.get(runId).vouchers += list.length;
      return { upserted: list.length, skippedOlder: 0 };
    },
    async reconcile(runId, body) {
      const all = JSON.parse(fs.readFileSync(file(runId, 'reconcile.json'), 'utf8'));
      all.push({ from: body.from, to: body.to, vouchers: body.vouchers.length });
      writeJson(file(runId, 'reconcile.json'), all);
      counts.get(runId).months += 1;
      return { deleted: 0, missing: 0, stale: 0 };
    },
    async finish() { return { sync: null }; },
  };
}

module.exports = { createDryRunApi };
