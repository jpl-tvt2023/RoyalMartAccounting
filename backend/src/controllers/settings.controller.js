const db = require('../config/db');
const { logAction, diffFields } = require('../services/auditLog.service');
const { loadSettings, shape, validate } = require('../services/syncSettings');

// The sync schedule: when the Connector syncs (office hours, the light sync
// interval, the end-of-day check). Set here by an Admin or Owner rather than
// in a file on the office PC; the Connector picks it up from its next
// heartbeat, within a minute.

// GET /api/settings/sync -- all roles.
async function getSync(req, res, next) {
  try {
    res.json(shape(await loadSettings(db)));
  } catch (err) { next(err); }
}

// PUT /api/settings/sync -- Admin/Owner. Any subset of the fields.
async function updateSync(req, res, next) {
  try {
    const current = await loadSettings(db);
    const { values, error } = validate(req.body || {}, current);
    if (error) return res.status(400).json({ message: error });
    const changes = diffFields(current, values, Object.keys(values));
    if (changes.length) {
      const tx = await db.transaction('write');
      try {
        await tx.execute({
          sql: `UPDATE sync_settings SET ${Object.keys(values).map((k) => `${k} = ?`).join(', ')},
                  updated_at = datetime('now'), updated_by = ? WHERE id = 1`,
          args: [...Object.values(values), req.user.id],
        });
        await logAction({
          client: tx, userId: req.user.id, actionType: 'SYNC_SETTINGS_UPDATE',
          description: 'Sync schedule changed', entityType: 'sync_settings', entityId: 1, changes,
        });
        await tx.commit();
      } catch (err) {
        await tx.rollback();
        throw err;
      }
    }
    res.json(shape(await loadSettings(db)));
  } catch (err) { next(err); }
}

module.exports = { getSync, updateSync };
