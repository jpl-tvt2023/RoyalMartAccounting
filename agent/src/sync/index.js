// One sync of one company: Tally -> RAMS. Read-only on the Tally side.
//
//   light     hourly in office hours: the masters if AltMstId moved, and only
//             the vouchers altered since the watermark (AlterID FILTER)
//   heavy     end of day: a light sync, the full master lists, then each
//             month's GUID list so RAMS can mark deleted vouchers. A month
//             where RAMS lacks a voucher, or holds an older copy, is pulled
//             again whole
//   backfill  first run: the masters, then month by month from the sync
//             start: pull, push, reconcile. RAMS records each reconciled
//             month, so an interrupted backfill resumes after it
//   resync    the same from the start, after a restore or a rename
//
// RAMS moves the watermarks only when the run finishes ok, to the counters
// Tally had when it started (backend controllers/agent.controller.js).
const { periods, parseIso } = require('../util');
const { baseTypeResolver } = require('../tally/normalize');
const { pullMasters, pullPeriod, pullVoucherList } = require('../tally/pull');

// An AlterID gap above this is fetched month by month: one big filtered
// request was ~2x slower on TallyPrime 7.1 (2,307 vouchers: 141 s vs 77 s).
const BIG_DELTA = 1000;
const KINDS = ['light', 'heavy', 'backfill', 'resync'];

// The sync window: from the sync start to 31 March of today's financial
// year, so a voucher dated later in the year is not missed.
function syncWindow(syncFrom, today) {
  const [y, m] = today.split('-').map(Number);
  return { from: syncFrom, to: `${m >= 4 ? y + 1 : y}-03-31` };
}

const nextDay = (iso) => new Date(parseIso(iso).getTime() + 86400000).toISOString().slice(0, 10);
const chunk = (list, size) => {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
};

/**
 * company   from the heartbeat: { id, guid, name, code, sync }
 * live      the same company as Tally lists it now: { name, guid, altVchId, altMstId }
 * typesCache  Map guid -> voucher types, kept by the run loop between syncs
 * Returns { ok, runId, kind, counts, errors, sync }. Throws (after closing the
 * run as failed) when Tally or RAMS stops answering.
 */
async function syncCompany({
  tally, api, company, live, kind, syncFrom, today, batchSize = 100, typesCache = new Map(), log = () => {},
}) {
  if (!KINDS.includes(kind)) throw new Error(`Unknown sync kind ${kind}`);
  const window = syncWindow(syncFrom, today);
  const label = company.code || company.name;
  const counts = { vouchers: 0, skipped: 0, deleted: 0, masters: 0, months: 0, repulled: 0 };
  const errors = [];

  const started = await api.startRun({ company_id: company.id, kind, altVchId: live.altVchId, altMstId: live.altMstId });
  const runId = started.run_id;
  const { sync } = started;
  log(`${label}: ${kind} sync started (run ${runId})`);

  let baseTypeOf = null;
  const resolver = async () => {
    if (!baseTypeOf) {
      let types = typesCache.get(live.guid);
      if (!types) {
        const got = await pullMasters(tally, live, { only: ['Voucher Types'] });
        types = got.masters.voucherTypes || [];
        if (got.masters.voucherTypes) typesCache.set(live.guid, types);
        errors.push(...got.errors);
      }
      baseTypeOf = baseTypeResolver(types);
    }
    return baseTypeOf;
  };

  const masters = async () => {
    const got = await pullMasters(tally, live);
    errors.push(...got.errors);
    const res = await api.masters(runId, got.masters);
    counts.masters += res.upserted || 0;
    if (got.masters.voucherTypes) {
      typesCache.set(live.guid, got.masters.voucherTypes);
      baseTypeOf = baseTypeResolver(got.masters.voucherTypes);
    }
    log(`${label}: masters ${res.upserted} stored, ${res.deleted} deleted${res.renamed ? `, ${res.renamed} renamed` : ''}`);
  };

  const push = async (vouchers) => {
    const usable = vouchers.filter((v) => v.guid && v.alterId != null && v.date);
    if (usable.length < vouchers.length) errors.push(`${vouchers.length - usable.length} voucher(s) without a GUID, AlterID or date were not sent`);
    for (const part of chunk(usable, batchSize)) {
      const res = await api.vouchers(runId, part);
      counts.vouchers += res.upserted || 0;
      counts.skipped += res.skippedOlder || 0;
    }
  };

  const pull = async (p, afterAlterId = null) => {
    const got = await pullPeriod(tally, live, p, { baseTypeOf: await resolver(), docFields: false, afterAlterId });
    if (got.stray.length) {
      throw new Error(`Tally ignored the period ${got.ask.from}…${got.ask.to} for ${live.name} (${got.stray.length} vouchers outside it)`);
    }
    return got.vouchers;
  };

  const reconcileMonth = async (p) => {
    const list = await pullVoucherList(tally, live, p);
    const res = await api.reconcile(runId, { from: p.from, to: p.to, vouchers: list.map(({ guid, alterId }) => ({ guid, alterId })) });
    counts.deleted += res.deleted || 0;
    if (res.missing || res.stale) {
      counts.repulled += 1;
      await push(await pull(p));
    }
    counts.months += 1;
  };

  try {
    if (kind === 'light' || kind === 'heavy') {
      if (live.altVchId < sync.altVchId || live.altMstId < sync.altMstId) {
        throw new Error(`Tally's counters went backward (was a backup restored?). ${label} needs a full resync.`);
      }
      if (kind === 'heavy' || live.altMstId !== sync.altMstId) await masters();
      if (live.altVchId !== sync.altVchId) {
        const gap = live.altVchId - sync.altVchId;
        for (const p of gap > BIG_DELTA ? periods(window.from, window.to) : [window]) {
          await push(await pull(p, sync.altVchId));
        }
      }
      if (kind === 'heavy') {
        for (const p of periods(window.from, window.to)) await reconcileMonth(p);
      }
    } else {
      await masters();
      const start = sync.backfillThrough ? nextDay(sync.backfillThrough) : window.from;
      for (const p of start <= window.to ? periods(start, window.to) : []) {
        await push(await pull(p));
        await reconcileMonth(p);
        log(`${label}: ${p.from} … ${p.to} done`);
      }
    }

    const ok = errors.length === 0;
    const backfillDone = ok && (kind === 'backfill' || kind === 'resync');
    const fin = await api.finish(runId, { ok, errors, backfillDone });
    log(`${label}: ${kind} sync ${ok ? 'finished' : 'FAILED'} — ${counts.vouchers} vouchers stored, `
      + `${counts.deleted} deleted, ${counts.masters} masters${errors.length ? `; ${errors.join('; ')}` : ''}`);
    return { ok, runId, kind, counts, errors, sync: fin.sync };
  } catch (e) {
    errors.push(e.message);
    try {
      await api.finish(runId, { ok: false, errors });
    } catch { /* RAMS closes an abandoned run when the next one starts */ }
    log(`${label}: ${kind} sync FAILED — ${e.message}`);
    e.counts = counts;
    e.runId = runId;
    throw e;
  }
}

module.exports = { syncCompany, syncWindow, BIG_DELTA };
