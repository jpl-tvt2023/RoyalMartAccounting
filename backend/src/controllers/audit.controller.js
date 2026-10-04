const db = require('../config/db');
const { isValidDateString } = require('../utils/dateValidation');
const { ADMIN_ROLES } = require('../middleware/rbac');

// The audit trail, read two ways:
//   list       -- the whole log, paged and filtered (Admin/Owner). New in RAMS:
//                 ROMS shows history only per record.
//   history    -- one record's history, newest first (as ROMS's history drawer).

const PAGE_SIZES = [10, 25, 50, 100];
const DEFAULT_PAGE_SIZE = 25;

const parseChanges = (row) => ({ ...row, changes: row.changes ? JSON.parse(row.changes) : [] });
const bad = (message) => Object.assign(new Error(message), { status: 400 });

function buildWhere(query) {
  const conditions = [];
  const args = [];
  if (query.user_id) { conditions.push('a.user_id = ?'); args.push(Number(query.user_id)); }
  if (query.action_type) { conditions.push('a.action_type = ?'); args.push(String(query.action_type)); }
  if (query.entity_type) { conditions.push('a.entity_type = ?'); args.push(String(query.entity_type)); }
  if (query.date_from) {
    if (!isValidDateString(query.date_from)) throw bad('date_from must be YYYY-MM-DD');
    conditions.push('a.timestamp >= ?'); args.push(String(query.date_from));
  }
  if (query.date_to) {
    if (!isValidDateString(query.date_to)) throw bad('date_to must be YYYY-MM-DD');
    // Inclusive of the whole day.
    conditions.push("a.timestamp < date(?, '+1 day')"); args.push(String(query.date_to));
  }
  if (query.q) { conditions.push('a.description LIKE ?'); args.push(`%${String(query.q)}%`); }
  return { where: conditions.length ? `WHERE ${conditions.join(' AND ')}` : '', args };
}

// GET /api/audit-logs?user_id=&action_type=&entity_type=&date_from=&date_to=&q=&page=&page_size=
async function list(req, res, next) {
  try {
    const { where, args } = buildWhere(req.query);
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const pageSize = PAGE_SIZES.includes(Number(req.query.page_size)) ? Number(req.query.page_size) : DEFAULT_PAGE_SIZE;
    const [{ rows: [{ total }] }, { rows }] = await Promise.all([
      db.execute({ sql: `SELECT COUNT(*) AS total FROM audit_logs a ${where}`, args }),
      db.execute({
        sql: `SELECT a.id, a.timestamp, a.action_type, a.description, a.entity_type, a.entity_id, a.entity_ref,
                     a.changes, a.user_id, u.name AS user_name, u.username AS user_username
                FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id
                ${where}
               ORDER BY a.timestamp DESC, a.id DESC
               LIMIT ? OFFSET ?`,
        args: [...args, pageSize, (page - 1) * pageSize],
      }),
    ]);
    res.json({ rows: rows.map(parseChanges), total: Number(total), page, page_size: pageSize });
  } catch (err) {
    if (err.status === 400) return res.status(400).json({ message: err.message });
    next(err);
  }
}

// GET /api/audit-logs/facets -- the values the Audit Log page's filters offer.
async function facets(req, res, next) {
  try {
    const [actions, entities, users] = await Promise.all([
      db.execute('SELECT DISTINCT action_type FROM audit_logs ORDER BY action_type'),
      db.execute('SELECT DISTINCT entity_type FROM audit_logs WHERE entity_type IS NOT NULL ORDER BY entity_type'),
      db.execute('SELECT id, name, username FROM users ORDER BY name COLLATE NOCASE'),
    ]);
    res.json({
      action_types: actions.rows.map((r) => r.action_type),
      entity_types: entities.rows.map((r) => r.entity_type),
      users: users.rows.map((r) => ({ id: Number(r.id), name: r.name, username: r.username })),
    });
  } catch (err) { next(err); }
}

// GET /api/audit-logs/entity?entity_type=&entity_id= -- one record's history.
// entity_id matches the numeric entity_id or the text entity_ref. A user
// account's history (sign-ins, resets) is for Admin/Owner only.
async function history(req, res, next) {
  try {
    const entityType = req.query.entity_type;
    const entityId = req.query.entity_id;
    if (!entityType || entityId == null || entityId === '') {
      return res.status(400).json({ message: 'entity_type and entity_id are required' });
    }
    if (entityType === 'user' && !(req.user.roles || []).some((r) => ADMIN_ROLES.includes(r))) {
      return res.status(403).json({ message: 'Access denied' });
    }
    const key = String(entityId);
    const { rows } = await db.execute({
      sql: `SELECT a.id, a.timestamp, a.action_type, a.description, a.entity_type, a.entity_id, a.entity_ref,
                   a.changes, a.user_id, u.name AS user_name
              FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id
             WHERE a.entity_type = ? AND (CAST(a.entity_id AS TEXT) = ? OR a.entity_ref = ?)
             ORDER BY a.timestamp DESC, a.id DESC`,
      args: [String(entityType), key, key],
    });
    res.json(rows.map(parseChanges));
  } catch (err) { next(err); }
}

module.exports = { list, facets, history };
