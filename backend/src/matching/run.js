// One matching run: read ROMS again, load, match, store what changed, and plan
// what auto-fill writes (autofill.js). Also the preview (the same match with
// draft rules, nothing written) and the rule for when the Connector should ask
// for a run.
const { matchAll, countOutcomes } = require('./engine');
const { loadInputs, todayIst } = require('./load');
const { writeResults } = require('./write');
const { planAutofill } = require('./autofill');
const { refreshRoms } = require('../services/romsRefs');
const { loadSettings } = require('../services/matchSettings');
const { loadSettings: loadSyncSettings } = require('../services/syncSettings');

// A run still marked running after this long died (a Vercel timeout, a crash).
const STALE_MINUTES = 10;

const fail = (status, message) => Object.assign(new Error(message), { status });

async function runMatching(client, { trigger, userId = null, roms, romsSettings, today } = {}) {
  await client.execute({
    sql: `UPDATE match_runs SET status = 'failed', error = 'Abandoned: it never finished', finished_at = datetime('now')
           WHERE status = 'running' AND started_at <= datetime('now', ?)`,
    args: [`-${STALE_MINUTES} minutes`],
  });
  // One run at a time: the insert only happens when none is running.
  // sync_mark: the last sync run finished by now -- what this match covers.
  const { rows } = await client.execute({
    sql: `INSERT INTO match_runs (trigger, user_id, sync_mark)
          SELECT ?, ?, (SELECT COALESCE(MAX(id), 0) FROM tally_sync_runs WHERE status <> 'running')
           WHERE NOT EXISTS (SELECT 1 FROM match_runs WHERE status = 'running')
          RETURNING id`,
    args: [trigger, userId],
  });
  if (!rows.length) throw fail(409, 'Matching is already running — the results will update when it finishes');
  const runId = Number(rows[0].id);
  const started = Date.now();
  try {
    const refresh = await refreshRoms(client, { roms, settings: romsSettings });
    const input = await loadInputs(client, { today });
    const out = matchAll(input);
    const written = await writeResults(client, out, runId);
    const autofill = await planAutofill(client);
    const counts = { ...countOutcomes(out.results), ...written, autofill };
    await client.execute({
      sql: `UPDATE match_runs SET status = 'ok', roms_ok = ?, roms_error = ?, counts = ?, ms = ?, finished_at = datetime('now') WHERE id = ?`,
      args: [refresh.ok ? 1 : 0, refresh.ok ? null : refresh.error, JSON.stringify(counts), Date.now() - started, runId],
    });
    return { run_id: runId, counts, roms: { ok: refresh.ok, connected: refresh.connected, error: refresh.ok ? null : refresh.error }, ms: Date.now() - started };
  } catch (e) {
    await client.execute({
      sql: "UPDATE match_runs SET status = 'failed', error = ?, ms = ?, finished_at = datetime('now') WHERE id = ?",
      args: [String(e.message).slice(0, 500), Date.now() - started, runId],
    });
    throw e;
  }
}

// Re-match on what RAMS already holds, without reading ROMS: after a person's
// decision or a rule change, so the page shows the effect at once.
async function rematch(client, { today } = {}) {
  const input = await loadInputs(client, { today });
  const out = matchAll(input);
  const written = await writeResults(client, out, null);
  const autofill = await planAutofill(client);
  return { ...countOutcomes(out.results), ...written, autofill };
}

// What draft rules would change, against the stored results. Reads ROMS from
// RAMS's copy and writes nothing.
async function previewMatching(client, settings, { today, examples = 10 } = {}) {
  const input = await loadInputs(client, { settings, today });
  const out = matchAll(input);
  const { rows } = await client.execute('SELECT target_kind, target_id, po_id, vendor, outcome, reason FROM match_results');
  const now = new Map(rows.map((r) => [`${r.target_kind}|${r.target_id}`, r]));
  const changes = [];
  for (const r of out.results) {
    const old = now.get(`${r.target_kind}|${r.target_id}`);
    if (old && old.outcome === r.outcome && (old.reason || null) === (r.reason || null)) continue;
    changes.push({
      target_kind: r.target_kind, target_id: r.target_id, po_id: r.po_id, vendor: r.vendor,
      from: old ? { outcome: old.outcome, reason: old.reason } : null,
      to: { outcome: r.outcome, reason: r.reason, voucher_number: r.voucher_number },
    });
  }
  const before = countOutcomes(rows);
  const after = countOutcomes(out.results);
  return { before, after, changed: changes.length, examples: changes.slice(0, examples) };
}

// The office's clock, which is what the sync schedule means.
function officeNow(now = Date.now()) {
  const ist = new Date(now + 330 * 60000);
  return { day: ist.getUTCDay(), hhmm: ist.toISOString().slice(11, 16) };
}

// Should the Connector ask for a match now? When none ran yet; when Tally data
// changed since the last one (a sync stored something); or, in office hours,
// every run_every_minutes so ROMS edits get matched too.
async function matchDue(client, now = Date.now()) {
  const { rows: [last] } = await client.execute(
    "SELECT status, started_at, sync_mark, (julianday('now') - julianday(started_at)) * 1440 AS minutes FROM match_runs ORDER BY id DESC LIMIT 1",
  );
  if (!last) return { due: true, why: 'Matching has never run' };
  if (last.status === 'running' && Number(last.minutes) < STALE_MINUTES) return { due: false };
  // Sync runs after the last match's mark (one the Connector ran after it
  // started); a run from before marks existed is compared by time.
  const { rows: [changed] } = await client.execute({
    sql: `SELECT COUNT(*) AS n FROM tally_sync_runs WHERE status = 'ok'
            AND (CASE WHEN ? IS NULL THEN finished_at > ? ELSE id > ? END)
            AND (vouchers_upserted + vouchers_deleted + masters_upserted + masters_deleted) > 0`,
    args: [last.sync_mark, last.started_at, last.sync_mark],
  });
  if (Number(changed.n) > 0) return { due: true, why: 'Tally changed since the last match' };
  const [settings, sync] = await Promise.all([loadSettings(client), loadSyncSettings(client)]);
  const { day, hhmm } = officeNow(now);
  const days = String(sync.office_days).split(',').map(Number);
  const inOffice = days.includes(day) && hhmm >= sync.office_start && hhmm < sync.office_end;
  if (inOffice && Number(last.minutes) >= settings.run_every_minutes) return { due: true, why: `Every ${settings.run_every_minutes} minutes in office hours` };
  return { due: false };
}

// The last run, as the Connector's `status` shows it.
async function lastMatch(client) {
  const { rows: [r] } = await client.execute('SELECT status, started_at, finished_at, counts, error FROM match_runs ORDER BY id DESC LIMIT 1');
  if (!r) return null;
  const counts = r.counts ? JSON.parse(r.counts) : {};
  return { status: r.status, startedAt: r.started_at, finishedAt: r.finished_at, error: r.error || null, po: counts.po || null, rtv: counts.rtv || null };
}

module.exports = { runMatching, rematch, previewMatching, matchDue, lastMatch, todayIst, STALE_MINUTES };
