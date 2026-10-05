const db = require('../config/db');
const { logAction, diffFields } = require('../services/auditLog.service');
const { CODE_RE } = require('../services/tallyCompany');
const { latestConnector } = require('../services/connectorStatus');

// The Tally companies RAMS knows about (Admin -> Tally companies). Which ones
// sync is data, not code: the Connector lists every company it sees, and an
// Admin or Owner turns each one's sync on or off here. Turning a company off
// stops its sync and keeps what is already mirrored.

const shape = (row, connector) => {
  const loaded = connector && connector.loaded.get(row.guid);
  return {
    id: Number(row.id),
    guid: row.guid,
    name: row.name,
    code: row.code ?? null,
    state_name: row.state_name ?? null,
    gstin: row.gstin ?? null,
    books_from: row.books_from ?? null,
    sync_enabled: Boolean(row.sync_enabled),
    loaded_in_tally: Boolean(loaded),
    vouchers: Number(row.vouchers || 0),
    first_seen_at: row.first_seen_at,
    last_seen_at: row.last_seen_at ?? null,
    updated_at: row.updated_at ?? null,
    updated_by_name: row.updated_by_name ?? null,
  };
};

const SELECT = `SELECT c.*, u.name AS updated_by_name,
                       (SELECT COUNT(*) FROM tally_vouchers v WHERE v.company_id = c.id AND v.deleted_at IS NULL) AS vouchers
                  FROM tally_companies c LEFT JOIN users u ON u.id = c.updated_by`;

// GET /api/companies
async function list(req, res, next) {
  try {
    const [{ rows }, connector] = await Promise.all([
      db.execute(`${SELECT} ORDER BY c.sync_enabled DESC, c.code, c.name COLLATE NOCASE`),
      latestConnector(),
    ]);
    res.json(rows.map((r) => shape(r, connector)));
  } catch (err) { next(err); }
}

// PATCH /api/companies/:id { sync_enabled?, code? } -- Admin/Owner.
async function update(req, res, next) {
  try {
    const id = Number.parseInt(req.params.id, 10);
    const body = req.body || {};
    const after = {};
    if (body.sync_enabled !== undefined) {
      if (typeof body.sync_enabled !== 'boolean') return res.status(400).json({ message: 'sync_enabled must be true or false' });
      after.sync_enabled = body.sync_enabled ? 1 : 0;
    }
    if (body.code !== undefined) {
      const code = String(body.code ?? '').trim().toUpperCase();
      if (!CODE_RE.test(code)) return res.status(400).json({ message: 'Code must be 1-10 letters, digits or -' });
      after.code = code;
    }
    if (!Object.keys(after).length) return res.status(400).json({ message: 'Nothing to change' });

    const { rows: [before] } = await db.execute({ sql: 'SELECT * FROM tally_companies WHERE id = ?', args: [id] });
    if (!before) return res.status(404).json({ message: 'Company not found' });
    const changes = diffFields(before, after, ['sync_enabled', 'code']);
    if (changes.length) {
      const syncChange = changes.find((c) => c.field === 'sync_enabled');
      let action = 'TALLY_COMPANY_UPDATE';
      let description = `${before.name}: code ${before.code ?? '—'} → ${after.code}`;
      if (syncChange) {
        action = after.sync_enabled ? 'TALLY_COMPANY_SYNC_ON' : 'TALLY_COMPANY_SYNC_OFF';
        description = `${before.name}: sync turned ${after.sync_enabled ? 'on' : 'off'}`;
      }
      const sets = Object.keys(after).map((k) => `${k} = ?`);
      const tx = await db.transaction('write');
      try {
        await tx.execute({
          sql: `UPDATE tally_companies SET ${sets.join(', ')}, updated_at = datetime('now'), updated_by = ? WHERE id = ?`,
          args: [...Object.values(after), req.user.id, id],
        });
        if (after.sync_enabled) {
          await tx.execute({ sql: 'INSERT OR IGNORE INTO tally_sync_state (company_id) VALUES (?)', args: [id] });
        }
        await logAction({
          client: tx, userId: req.user.id, actionType: action, description,
          entityType: 'tally_company', entityId: id, changes,
        });
        await tx.commit();
      } catch (err) {
        await tx.rollback();
        throw err;
      }
    }
    const [{ rows: [row] }, connector] = await Promise.all([
      db.execute({ sql: `${SELECT} WHERE c.id = ?`, args: [id] }),
      latestConnector(),
    ]);
    res.json(shape(row, connector));
  } catch (err) { next(err); }
}

module.exports = { list, update };
