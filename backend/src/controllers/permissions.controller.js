const db = require('../config/db');
const { logAction } = require('../services/auditLog.service');
const {
  CATALOG, GRANTABLE_ROLES, loadMatrix, validateMatrix,
} = require('../services/permissions');

// Admin -> Roles & permissions: what Accountants and Viewers may do. Admin and
// Owner always hold every permission and are shown that way, not stored.

async function lastChange(client) {
  const { rows } = await client.execute(
    `SELECT p.updated_at, u.name AS updated_by_name FROM role_permissions p
       LEFT JOIN users u ON u.id = p.updated_by
      WHERE p.updated_by IS NOT NULL ORDER BY p.updated_at DESC LIMIT 1`,
  );
  return rows[0] || { updated_at: null, updated_by_name: null };
}

async function view(client) {
  const { updated_at, updated_by_name } = await lastChange(client);
  return {
    catalog: CATALOG,
    roles: GRANTABLE_ROLES,
    matrix: await loadMatrix(client),
    updated_at: updated_at ?? null,
    updated_by_name: updated_by_name ?? null,
  };
}

// GET /api/settings/permissions -- Admin/Owner.
async function get(req, res, next) {
  try {
    res.json(await view(db));
  } catch (err) { next(err); }
}

// PUT /api/settings/permissions { roles: { Accountant: [...], Viewer: [...] } }
// -- Admin/Owner. Each role listed gets exactly the keys given.
async function update(req, res, next) {
  try {
    const current = await loadMatrix(db);
    const { matrix, error } = validateMatrix(req.body, current);
    if (error) return res.status(400).json({ message: error });

    const changes = [];
    for (const role of GRANTABLE_ROLES) {
      const before = new Set(current[role]);
      const after = new Set(matrix[role]);
      for (const p of CATALOG) {
        if (before.has(p.key) !== after.has(p.key)) {
          changes.push({ field: `${role}: ${p.label}`, old: before.has(p.key) ? 'allowed' : 'not allowed', new: after.has(p.key) ? 'allowed' : 'not allowed' });
        }
      }
    }
    if (changes.length) {
      const tx = await db.transaction('write');
      try {
        for (const role of GRANTABLE_ROLES) {
          const before = new Set(current[role]);
          const after = new Set(matrix[role]);
          for (const key of before) {
            if (!after.has(key)) await tx.execute({ sql: 'DELETE FROM role_permissions WHERE role = ? AND permission = ?', args: [role, key] });
          }
          for (const key of after) {
            if (!before.has(key)) {
              await tx.execute({
                sql: `INSERT INTO role_permissions (role, permission, updated_at, updated_by) VALUES (?, ?, datetime('now'), ?)`,
                args: [role, key, req.user.id],
              });
            }
          }
        }
        // A removal leaves no row behind, so the last change is stamped on
        // every row of the roles that changed.
        const touched = GRANTABLE_ROLES.filter((r) => changes.some((c) => c.field.startsWith(`${r}:`)));
        await tx.execute({
          sql: `UPDATE role_permissions SET updated_at = datetime('now'), updated_by = ?
                 WHERE role IN (${touched.map(() => '?').join(',')})`,
          args: [req.user.id, ...touched],
        });
        await logAction({
          client: tx, userId: req.user.id, actionType: 'ROLE_PERMISSIONS_UPDATE',
          description: `Permissions changed for ${touched.join(' and ')}`,
          entityType: 'role_permissions', entityId: 1, changes,
        });
        await tx.commit();
      } catch (err) {
        await tx.rollback();
        throw err;
      }
    }
    res.json(await view(db));
  } catch (err) { next(err); }
}

module.exports = { get, update };
