const db = require('../config/db');
const { SYNC_FROM } = require('../config/env');
const { syncShape } = require('../services/tallyCompany');
const { latestConnector } = require('../services/connectorStatus');

// GET /api/sync/status -- all roles. The Dashboard's "Tally sync" card: is the
// Connector online, does Tally answer, and where each company with sync on
// stands. (The full Sync Health screen comes in M7.)
async function status(req, res, next) {
  try {
    const [connector, { rows: companies }, { rows: lastRuns }] = await Promise.all([
      latestConnector(),
      db.execute(
        `SELECT c.id, c.guid, c.name, c.code, c.state_name, c.gstin, s.*,
                (SELECT COUNT(*) FROM tally_vouchers v WHERE v.company_id = c.id AND v.deleted_at IS NULL) AS vouchers
           FROM tally_companies c LEFT JOIN tally_sync_state s ON s.company_id = c.id
          WHERE c.sync_enabled = 1
          ORDER BY c.code, c.name`,
      ),
      db.execute(
        `SELECT * FROM tally_sync_runs
          WHERE id IN (SELECT MAX(id) FROM tally_sync_runs GROUP BY company_id)`,
      ),
    ]);
    const runOf = new Map(lastRuns.map((r) => [Number(r.company_id), r]));

    res.json({
      sync_from: SYNC_FROM,
      connector: connector && {
        name: connector.name,
        version: connector.version,
        last_seen_at: connector.last_seen_at,
        online: connector.online,
        tally: connector.tally,
        activity: connector.activity,
        last_error: connector.last_error,
      },
      companies: companies.map((c) => {
        const id = Number(c.id);
        const sync = syncShape(c);
        const loaded = connector && connector.loaded.get(c.guid);
        const run = runOf.get(id);
        return {
          id,
          name: c.name,
          code: c.code ?? null,
          state_name: c.state_name ?? null,
          gstin: c.gstin ?? null,
          vouchers: Number(c.vouchers || 0),
          loaded_in_tally: Boolean(loaded),
          // Tally has changes RAMS has not fetched yet.
          pending: Boolean(loaded && sync.backfillDone
            && (loaded.altVchId !== sync.altVchId || loaded.altMstId !== sync.altMstId)),
          sync,
          last_run: run ? {
            kind: run.kind,
            status: run.status,
            started_at: run.started_at,
            finished_at: run.finished_at ?? null,
            vouchers_upserted: Number(run.vouchers_upserted),
            vouchers_deleted: Number(run.vouchers_deleted),
            errors: run.errors ? JSON.parse(run.errors) : [],
          } : null,
        };
      }),
    });
  } catch (err) { next(err); }
}

module.exports = { status };
