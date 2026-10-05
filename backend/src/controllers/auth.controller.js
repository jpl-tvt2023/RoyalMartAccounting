const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../config/db');
const { logAction } = require('../services/auditLog.service');
const { validatePassword } = require('../services/passwordPolicy');
const { permissionsOf } = require('../services/permissions');
const {
  JWT_ACCESS_SECRET, JWT_REFRESH_SECRET,
  JWT_ACCESS_EXPIRY, JWT_REFRESH_EXPIRY,
} = require('../config/env');

// Sessions, as in ROMS: a 15-minute access token (Bearer, held by the client)
// and a 7-day refresh token in an httpOnly cookie. Two RAMS differences:
//   - the refresh token carries the user's token_version, so bumping it (password
//     change, admin reset, role change, deactivation) ends their sessions
//   - the access token carries pwd_change while a first or reset password is
//     still in force, and middleware/auth.js holds the user to the change
// No MFA yet (deferred 2026-10-04).
const BCRYPT_COST = 12;
// Not ROMS's 'refreshToken', so the two apps' sessions can never be confused.
const REFRESH_COOKIE = 'rams_refresh';
const REFRESH_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const SESSION_ENDED = 'Your session has ended — please sign in again';

async function loadUserRoles(client, userId) {
  const { rows } = await client.execute({
    sql: 'SELECT role FROM user_roles WHERE user_id = ? ORDER BY role',
    args: [userId],
  });
  return rows.map((r) => r.role);
}

const signAccess = (user) => jwt.sign(
  {
    id: Number(user.id), username: user.username, name: user.name, roles: user.roles || [],
    pwd_change: Boolean(user.is_first_login),
  },
  JWT_ACCESS_SECRET,
  { expiresIn: JWT_ACCESS_EXPIRY },
);

const signRefresh = (user) => jwt.sign(
  { id: Number(user.id), v: Number(user.token_version) },
  JWT_REFRESH_SECRET,
  { expiresIn: JWT_REFRESH_EXPIRY },
);

function cookieOptions() {
  const isProd = process.env.NODE_ENV === 'production';
  return { httpOnly: true, sameSite: isProd ? 'none' : 'strict', secure: isProd };
}
const setRefreshCookie = (res, user) => res.cookie(REFRESH_COOKIE, signRefresh(user), { ...cookieOptions(), maxAge: REFRESH_MAX_AGE_MS });
const clearRefreshCookie = (res) => res.clearCookie(REFRESH_COOKIE, cookieOptions());

// What the app is told about the signed-in user. `permissions` is what their
// roles may do (Admin -> Roles & permissions); the UI hides what they can't,
// and the API refuses it regardless.
const publicUser = async (user) => ({
  id: Number(user.id), name: user.name, username: user.username, roles: user.roles || [],
  is_first_login: Boolean(user.is_first_login),
  permissions: await permissionsOf(db, user.roles || []),
});

// POST /api/auth/login { username, password }
async function login(req, res, next) {
  try {
    const password = req.body?.password;
    const username = String(req.body?.username || '').trim().toLowerCase();
    if (!username || !password) return res.status(400).json({ message: 'User ID and password are required' });

    const { rows } = await db.execute({ sql: 'SELECT * FROM users WHERE username = ?', args: [username] });
    const user = rows[0];
    if (!user) {
      await logAction({ actionType: 'LOGIN_FAILED', description: `Failed sign-in for unknown User ID ${username}`, entityType: 'user' });
      return res.status(401).json({ message: 'No account found with that user ID' });
    }
    if (!(await bcrypt.compare(String(password), user.password_hash))) {
      await logAction({ userId: user.id, actionType: 'LOGIN_FAILED', description: `Failed sign-in (wrong password) for ${user.username}`, entityType: 'user', entityId: user.id });
      return res.status(401).json({ message: 'Incorrect password' });
    }
    // Checked after the password, so the account's state is told only to
    // someone who knows it.
    if (!user.is_active) {
      await logAction({ userId: user.id, actionType: 'LOGIN_FAILED', description: `Refused sign-in for deactivated user ${user.username}`, entityType: 'user', entityId: user.id });
      return res.status(401).json({ message: 'This account has been deactivated' });
    }

    user.roles = await loadUserRoles(db, user.id);
    setRefreshCookie(res, user);
    await logAction({ userId: user.id, actionType: 'LOGIN', description: `${user.name} signed in`, entityType: 'user', entityId: user.id });
    res.json({ accessToken: signAccess(user), user: await publicUser(user) });
  } catch (err) { next(err); }
}

// POST /api/auth/refresh (cookie) -- a new access token, with the user's
// current roles. Refused once the user is deactivated or the session was ended.
async function refresh(req, res, next) {
  try {
    const token = req.cookies?.[REFRESH_COOKIE];
    if (!token) return res.status(401).json({ message: 'No refresh token' });
    let payload;
    try { payload = jwt.verify(token, JWT_REFRESH_SECRET); } catch {
      clearRefreshCookie(res);
      return res.status(401).json({ message: SESSION_ENDED });
    }
    const { rows } = await db.execute({ sql: 'SELECT * FROM users WHERE id = ?', args: [payload.id] });
    const user = rows[0];
    if (!user || !user.is_active || Number(user.token_version) !== Number(payload.v)) {
      clearRefreshCookie(res);
      return res.status(401).json({ message: SESSION_ENDED });
    }
    user.roles = await loadUserRoles(db, user.id);
    res.json({ accessToken: signAccess(user), user: await publicUser(user) });
  } catch (err) { next(err); }
}

// GET /api/auth/me -- who the access token belongs to, read fresh.
async function me(req, res, next) {
  try {
    const { rows } = await db.execute({
      sql: 'SELECT id, name, username, is_first_login, is_active FROM users WHERE id = ?',
      args: [req.user.id],
    });
    if (!rows.length || !rows[0].is_active) return res.status(401).json({ message: SESSION_ENDED });
    const user = { ...rows[0], roles: await loadUserRoles(db, req.user.id) };
    res.json({ user: await publicUser(user) });
  } catch (err) { next(err); }
}

// POST /api/auth/change-password { oldPassword?, newPassword }
// oldPassword is not asked for while a first or admin-reset password is in
// force (as in ROMS). The change ends every other session the user has; this one
// carries on with a fresh token pair.
async function changePassword(req, res, next) {
  try {
    const { oldPassword, newPassword } = req.body || {};
    const policyError = await validatePassword(newPassword);
    if (policyError) return res.status(400).json({ message: policyError });

    const { rows } = await db.execute({ sql: 'SELECT * FROM users WHERE id = ?', args: [req.user.id] });
    const user = rows[0];
    if (!user || !user.is_active) return res.status(401).json({ message: SESSION_ENDED });
    if (!user.is_first_login) {
      if (!oldPassword) return res.status(400).json({ message: 'Old password required' });
      if (!(await bcrypt.compare(String(oldPassword), user.password_hash))) {
        return res.status(401).json({ message: 'Old password incorrect' });
      }
    }
    if (await bcrypt.compare(newPassword, user.password_hash)) {
      return res.status(400).json({ message: 'The new password must be different from the current one' });
    }

    const hash = await bcrypt.hash(newPassword, BCRYPT_COST);
    const tx = await db.transaction('write');
    let updated;
    try {
      ({ rows: [updated] } = await tx.execute({
        sql: `UPDATE users SET password_hash = ?, is_first_login = 0, token_version = token_version + 1,
                               updated_by = ?, updated_at = datetime('now')
               WHERE id = ? RETURNING *`,
        args: [hash, user.id, user.id],
      }));
      await logAction({ client: tx, userId: user.id, actionType: 'PASSWORD_CHANGE', description: `${user.name} changed their password`, entityType: 'user', entityId: user.id });
      await tx.commit();
    } catch (e) { await tx.rollback(); throw e; }

    updated.roles = await loadUserRoles(db, user.id);
    setRefreshCookie(res, updated);
    res.json({ message: 'Password updated', accessToken: signAccess(updated), user: await publicUser(updated) });
  } catch (err) { next(err); }
}

// POST /api/auth/logout -- clears the refresh cookie. An access token already
// issued stays valid until it expires (at most 15 minutes), as in ROMS.
async function logout(req, res) {
  clearRefreshCookie(res);
  res.json({ message: 'Logged out' });
}

module.exports = { login, refresh, me, changePassword, logout, REFRESH_COOKIE, loadUserRoles };
