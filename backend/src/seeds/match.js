// npm run match -- one matching run from the command line, as "Match now" on
// the Match review page: read ROMS again (ROMS_API_URL / ROMS_INTEGRATION_TOKEN
// in .env), match, store what changed, and print the counts.
//
//   npm run match                read ROMS, then match
//
// Writes to whatever database backend/.env points at, as `npm run migrate`
// does -- check it first.
require('../config/env');
const db = require('../config/db');
const { runMatching } = require('../matching/run');

const line = (label, c) => `${label.padEnd(14)} linked ${c.linked}, needs review ${c.review}, waiting for Tally ${c.waiting}, not matched ${c.not_matched}`;

async function main() {
  const out = await runMatching(db, { trigger: 'cli' });
  console.log(out.roms.ok ? 'ROMS read.' : `ROMS not read (${out.roms.error}) — matched on RAMS's last copy.`);
  if (out.counts.po) console.log(line('POs', out.counts.po));
  if (out.counts.rtv) console.log(line('RTV rows', out.counts.rtv));
  console.log(`Stored: ${out.counts.results_changed} results changed, ${out.counts.results_removed} removed, ${out.counts.links_added} links added, ${out.counts.links_removed} removed. ${(out.ms / 1000).toFixed(1)} s.`);
}

if (require.main === module) {
  main().catch((e) => { console.error(e.message); process.exitCode = 1; }).finally(() => db.close());
}
