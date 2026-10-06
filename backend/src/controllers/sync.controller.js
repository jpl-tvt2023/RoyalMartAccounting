const db = require('../config/db');
const { SYNC_FROM } = require('../config/env');
const { syncShape } = require('../services/tallyCompany');
const { latestConnector } = require('../services/connectorStatus');
const { logAction } = require('../services/auditLog.service');

// GET /api/sync/status -- all roles. The Dashboard's "Tally sync" card: is the
// Connector online, does Tally answer, and where each company with sync on
// stands. Sync health shows the same, with the runs below.
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

// GET /api/sync/runs?company_id&page&page_size -- the sync runs, newest first,
// with what each stored and any errors.
async function runs(req, res, next) {
  try {
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const pageSize = Math.min(100, Math.max(1, Number.parseInt(req.query.page_size, 10) || 25));
    const where = req.query.company_id ? 'WHERE r.company_id = ?' : '';
    const args = req.query.company_id ? [Number(req.query.company_id)] : [];
    const [{ rows }, { rows: [{ total }] }, { rows: open }] = await Promise.all([
      db.execute({
        sql: `SELECT r.*, c.code, c.name AS company_name FROM tally_sync_runs r JOIN tally_companies c ON c.id = r.company_id
              ${where} ORDER BY r.id DESC LIMIT ? OFFSET ?`,
        args: [...args, pageSize, (page - 1) * pageSize],
      }),
      db.execute({ sql: `SELECT COUNT(*) AS total FROM tally_sync_runs r ${where}`, args }),
      db.execute(`SELECT r.company_id, r.requested_at, u.name AS requested_by FROM sync_requests r LEFT JOIN users u ON u.id = r.requested_by
                   WHERE r.done_at IS NULL AND r.requested_at > datetime('now', '-60 minutes')`),
    ]);
    res.json({
      rows: rows.map((r) => ({
        id: Number(r.id),
        company_id: Number(r.company_id),
        company: r.code || r.company_name,
        kind: r.kind,
        status: r.status,
        started_at: r.started_at,
        finished_at: r.finished_at ?? null,
        vouchers_upserted: Number(r.vouchers_upserted),
        vouchers_deleted: Number(r.vouchers_deleted),
        masters_upserted: Number(r.masters_upserted),
        masters_deleted: Number(r.masters_deleted),
        errors: r.errors ? JSON.parse(r.errors) : [],
      })),
      total: Number(total),
      page,
      page_size: pageSize,
      waiting: open.map((o) => ({ company_id: Number(o.company_id), requested_at: o.requested_at, requested_by: o.requested_by || null })),
    });
  } catch (err) { next(err); }
}

// POST /api/sync/now { company_id? } -- "Sync now": the Connector runs a light
// sync of that company (or every company with sync on) at its next check-in.
async function now(req, res, next) {
  try {
    const companyId = (req.body || {}).company_id;
    const { rows: companies } = await db.execute({
      sql: `SELECT c.id, c.code, c.name FROM tally_companies c JOIN tally_sync_state s ON s.company_id = c.id
             WHERE c.sync_enabled = 1 AND s.backfill_done = 1 ${companyId ? 'AND c.id = ?' : ''}`,
      args: companyId ? [Number(companyId)] : [],
    });
    if (!companies.length) {
      return res.status(400).json({ message: companyId ? 'That company has sync off, or its first backfill has not finished' : 'No company is ready to sync' });
    }
    for (const c of companies) {
      await db.execute({
        sql: `INSERT INTO sync_requests (company_id, requested_by)
              SELECT ?, ? WHERE NOT EXISTS (SELECT 1 FROM sync_requests WHERE company_id = ? AND done_at IS NULL AND requested_at > datetime('now', '-60 minutes'))`,
        args: [Number(c.id), req.user.id, Number(c.id)],
      });
    }
    const names = companies.map((c) => c.code || c.name).join(', ');
    await logAction({
      userId: req.user.id, actionType: 'SYNC_NOW', description: `Asked for a sync now: ${names}`, entityType: 'tally_company', entityRef: companyId ? String(companyId) : 'all',
    });
    res.status(202).json({ requested: companies.map((c) => Number(c.id)), message: `The Connector syncs ${names} at its next check-in (within a minute or two)` });
  } catch (err) { next(err); }
}

module.exports = { status, runs, now };
