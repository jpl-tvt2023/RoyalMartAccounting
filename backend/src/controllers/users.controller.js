const bcrypt = require('bcryptjs');
const db = require('../config/db');
const { logAction, diffFields } = require('../services/auditLog.service');
const { validatePassword } = require('../services/passwordPolicy');
const { normalizeUsername, validateUsername } = require('../services/username');
const { ALL_ROLES, ADMIN_ROLES } = require('../middleware/rbac');

// RAMS user accounts -- Admin/Owner only (routes/users.routes.js). Adapted from
// ROMS users.controller.js with three changes:
//   - users are DEACTIVATED, never deleted, so the audit trail keeps their name
//   - a role change, deactivation or password reset bumps token_version, which
//     ends the user's sessions at their next refresh
//   - at least one active Admin or Owner must always remain, so RAMS can never
//     lock itself out of user management
const BCRYPT_COST = 12;
const LAST_ADMIN = 'At least one active Admin or Owner must remain';

function validateRoles(input) {
  if (!Array.isArray(input) || input.length === 0) return 'At least one role is required';
  const bad = input.find((r) => !ALL_ROLES.includes(r));
  if (bad) return `Invalid role: ${bad}`;
  return null;
}

const isAdminLevel = (roles) => roles.some((r) => ADMIN_ROLES.includes(r));

async function rolesOf(client, userIds) {
  const map = new Map(userIds.map((id) => [Number(id), []]));
  if (!userIds.length) return map;
  const { rows } = await client.execute({
    sql: `SELECT user_id, role FROM user_roles WHERE user_id IN (${userIds.map(() => '?').join(',')}) ORDER BY role`,
    args: userIds,
  });
  for (const r of rows) map.get(Number(r.user_id)).push(r.role);
  return map;
}

// Active users other than `exceptId` holding Admin or Owner.
async function otherActiveAdmins(client, exceptId) {
  const { rows } = await client.execute({
    sql: `SELECT COUNT(DISTINCT u.id) AS n FROM users u JOIN user_roles r ON r.user_id = u.id
           WHERE u.is_active = 1 AND u.id <> ? AND r.role IN (${ADMIN_ROLES.map(() => '?').join(',')})`,
    args: [exceptId, ...ADMIN_ROLES],
  });
  return Number(rows[0].n);
}

const shape = (row, roles) => ({
  id: Number(row.id),
  name: row.name,
  username: row.username,
  roles,
  is_first_login: Boolean(row.is_first_login),
  is_active: Boolean(row.is_active),
  created_at: row.created_at,
  updated_at: row.updated_at ?? null,
  updated_by_name: row.updated_by_name ?? null,
});

async function loadOne(id) {
  const { rows } = await db.execute({
    sql: `SELECT u.*, eu.name AS updated_by_name FROM users u LEFT JOIN users eu ON eu.id = u.updated_by WHERE u.id = ?`,
    args: [id],
  });
  if (!rows.length) return null;
  return shape(rows[0], (await rolesOf(db, [rows[0].id])).get(Number(rows[0].id)));
}

async function writeRoles(tx, userId, roles) {
  await tx.execute({ sql: 'DELETE FROM user_roles WHERE user_id = ?', args: [userId] });
  for (const role of [...new Set(roles)]) {
    await tx.execute({ sql: 'INSERT INTO user_roles (user_id, role) VALUES (?, ?)', args: [userId, role] });
  }
}

// GET /api/users
async function list(req, res, next) {
  try {
    const { rows } = await db.execute(
      `SELECT u.*, eu.name AS updated_by_name FROM users u
         LEFT JOIN users eu ON eu.id = u.updated_by
        ORDER BY u.is_active DESC, u.name COLLATE NOCASE`,
    );
    const roles = await rolesOf(db, rows.map((r) => Number(r.id)));
    res.json(rows.map((r) => shape(r, roles.get(Number(r.id)))));
  } catch (err) { next(err); }
}

// POST /api/users { name, username, password, roles }
async function create(req, res, next) {
  try {
    const { password, roles } = req.body || {};
    const name = String(req.body?.name || '').trim();
    const username = normalizeUsername(req.body?.username);
    if (!name || !username || !password) return res.status(400).json({ message: 'name, user ID, and password are required' });
    const usernameErr = validateUsername(username);
    if (usernameErr) return res.status(400).json({ message: usernameErr });
    const rolesErr = validateRoles(roles);
    if (rolesErr) return res.status(400).json({ message: rolesErr });
    const policyError = await validatePassword(password);
    if (policyError) return res.status(400).json({ message: policyError });

    const hash = await bcrypt.hash(password, BCRYPT_COST);
    const tx = await db.transaction('write');
    let userId;
    try {
      const { rows } = await tx.execute({
        sql: `INSERT INTO users (name, username, password_hash, is_first_login, updated_by, updated_at)
              VALUES (?, ?, ?, 1, ?, datetime('now')) RETURNING id`,
        args: [name, username, hash, req.user.id],
      });
      userId = Number(rows[0].id);
      await writeRoles(tx, userId, roles);
      await logAction({ client: tx, userId: req.user.id, actionType: 'USER_CREATE', description: `Created user ${username} (${[...new Set(roles)].join(', ')})`, entityType: 'user', entityId: userId });
      await tx.commit();
    } catch (e) {
      await tx.rollback();
      if (e.message && e.message.includes('UNIQUE constraint failed')) return res.status(409).json({ message: 'User ID already exists' });
      throw e;
    }
    res.status(201).json(await loadOne(userId));
  } catch (err) { next(err); }
}

// PUT /api/users/:id { name?, roles? }
async function update(req, res, next) {
  try {
    const id = Number(req.params.id);
    const { roles } = req.body || {};
    const name = req.body?.name == null ? null : String(req.body.name).trim();
    if (!name && roles === undefined) return res.status(400).json({ message: 'Nothing to update' });
    if (roles !== undefined) {
      const rolesErr = validateRoles(roles);
      if (rolesErr) return res.status(400).json({ message: rolesErr });
    }
    const before = await loadOne(id);
    if (!before) return res.status(404).json({ message: 'User not found' });

    const nextRoles = roles === undefined ? before.roles : [...new Set(roles)].sort();
    const rolesChanged = nextRoles.join(',') !== [...before.roles].sort().join(',');
    if (rolesChanged && before.is_active && isAdminLevel(before.roles) && !isAdminLevel(nextRoles)
      && (await otherActiveAdmins(db, id)) === 0) {
      return res.status(409).json({ message: LAST_ADMIN });
    }

    const tx = await db.transaction('write');
    try {
      await tx.execute({
        sql: `UPDATE users SET name = COALESCE(?, name), updated_by = ?, updated_at = datetime('now')
                         ${rolesChanged ? ', token_version = token_version + 1' : ''}
               WHERE id = ?`,
        args: [name || null, req.user.id, id],
      });
      if (rolesChanged) await writeRoles(tx, id, nextRoles);
      const changes = diffFields(
        { name: before.name, roles: [...before.roles].sort().join(', ') },
        { name: name || before.name, roles: nextRoles.join(', ') },
        ['name', 'roles'],
      );
      await logAction({
        client: tx, userId: req.user.id, actionType: 'USER_UPDATE',
        description: `Updated user ${before.username}${rolesChanged ? ' — roles changed, their sessions were ended' : ''}`,
        entityType: 'user', entityId: id, changes,
      });
      await tx.commit();
    } catch (e) { await tx.rollback(); throw e; }
    res.json(await loadOne(id));
  } catch (err) { next(err); }
}

// POST /api/users/:id/deactivate -- instead of delete. Ends the user's sessions.
async function deactivate(req, res, next) {
  try {
    const id = Number(req.params.id);
    if (id === Number(req.user.id)) return res.status(400).json({ message: 'You cannot deactivate your own account' });
    const user = await loadOne(id);
    if (!user) return res.status(404).json({ message: 'User not found' });
    if (!user.is_active) return res.json(user);
    if (isAdminLevel(user.roles) && (await otherActiveAdmins(db, id)) === 0) return res.status(409).json({ message: LAST_ADMIN });

    const tx = await db.transaction('write');
    try {
      await tx.execute({
        sql: `UPDATE users SET is_active = 0, token_version = token_version + 1, updated_by = ?, updated_at = datetime('now') WHERE id = ?`,
        args: [req.user.id, id],
      });
      await logAction({ client: tx, userId: req.user.id, actionType: 'USER_DEACTIVATE', description: `Deactivated user ${user.username}`, entityType: 'user', entityId: id, changes: [{ field: 'is_active', old: 1, new: 0 }] });
      await tx.commit();
    } catch (e) { await tx.rollback(); throw e; }
    res.json(await loadOne(id));
  } catch (err) { next(err); }
}

// POST /api/users/:id/reactivate
async function reactivate(req, res, next) {
  try {
    const id = Number(req.params.id);
    const user = await loadOne(id);
    if (!user) return res.status(404).json({ message: 'User not found' });
    if (user.is_active) return res.json(user);

    const tx = await db.transaction('write');
    try {
      await tx.execute({
        sql: `UPDATE users SET is_active = 1, updated_by = ?, updated_at = datetime('now') WHERE id = ?`,
        args: [req.user.id, id],
      });
      await logAction({ client: tx, userId: req.user.id, actionType: 'USER_REACTIVATE', description: `Reactivated user ${user.username}`, entityType: 'user', entityId: id, changes: [{ field: 'is_active', old: 0, new: 1 }] });
      await tx.commit();
    } catch (e) { await tx.rollback(); throw e; }
    res.json(await loadOne(id));
  } catch (err) { next(err); }
}

// POST /api/users/:id/reset-password { newPassword } -- the user must change it
// at their next sign-in, and their current sessions end.
async function adminResetPassword(req, res, next) {
  try {
    const id = Number(req.params.id);
    const policyError = await validatePassword(req.body?.newPassword);
    if (policyError) return res.status(400).json({ message: policyError });
    const user = await loadOne(id);
    if (!user) return res.status(404).json({ message: 'User not found' });

    const hash = await bcrypt.hash(req.body.newPassword, BCRYPT_COST);
    const tx = await db.transaction('write');
    try {
      await tx.execute({
        sql: `UPDATE users SET password_hash = ?, is_first_login = 1, token_version = token_version + 1,
                               updated_by = ?, updated_at = datetime('now')
               WHERE id = ?`,
        args: [hash, req.user.id, id],
      });
      await logAction({ client: tx, userId: req.user.id, actionType: 'PASSWORD_RESET', description: `Reset the password for ${user.username}`, entityType: 'user', entityId: id });
      await tx.commit();
    } catch (e) { await tx.rollback(); throw e; }
    res.json({ message: 'Password reset. The user must change it at their next sign-in.' });
  } catch (err) { next(err); }
}

module.exports = { list, create, update, deactivate, reactivate, adminResetPassword, validateRoles };
