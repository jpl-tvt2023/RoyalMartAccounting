// npm run bootstrap-admin -- creates the first RAMS Admin, once.
//
//   RAMS_ADMIN_USERNAME=keshav RAMS_ADMIN_PASSWORD='...' npm run bootstrap-admin
//   (or put both in backend/.env; RAMS_ADMIN_NAME is optional)
//
// Does nothing when an active Admin already exists, so it is safe to re-run and
// can never reset anyone's password. The account must change its password at
// first sign-in. Every later user is created from the Users page.
//
// ROMS seeds fixed, well-known passwords and resets them on every run. RAMS will
// hold the financial side, so its first password comes from the environment.
require('../config/env');
const bcrypt = require('bcryptjs');
const db = require('../config/db');
const { logAction } = require('../services/auditLog.service');
const { validatePassword } = require('../services/passwordPolicy');
const { normalizeUsername, validateUsername } = require('../services/username');

const BCRYPT_COST = 12;

// Returns { created: boolean, username, reason? }. Throws on invalid input.
async function bootstrapAdmin(client, { username: rawUsername, password, name }) {
  const { rows: admins } = await client.execute(
    `SELECT u.username FROM users u JOIN user_roles r ON r.user_id = u.id
      WHERE r.role = 'Admin' AND u.is_active = 1 LIMIT 1`,
  );
  if (admins.length) return { created: false, username: admins[0].username, reason: 'An active Admin already exists' };

  const username = normalizeUsername(rawUsername);
  const usernameError = validateUsername(username);
  if (usernameError) throw new Error(`RAMS_ADMIN_USERNAME: ${usernameError}`);
  const passwordError = await validatePassword(password);
  if (passwordError) throw new Error(`RAMS_ADMIN_PASSWORD: ${passwordError}`);

  const hash = await bcrypt.hash(password, BCRYPT_COST);
  const tx = await client.transaction('write');
  try {
    const { rows } = await tx.execute({
      sql: `INSERT INTO users (name, username, password_hash, is_first_login)
            VALUES (?, ?, ?, 1) RETURNING id`,
      args: [name || 'RAMS Admin', username, hash],
    });
    const userId = Number(rows[0].id);
    await tx.execute({ sql: "INSERT INTO user_roles (user_id, role) VALUES (?, 'Admin')", args: [userId] });
    await logAction({
      client: tx,
      actionType: 'USER_BOOTSTRAP',
      description: `First Admin ${username} created by bootstrap-admin`,
      entityType: 'user',
      entityId: userId,
    });
    await tx.commit();
  } catch (err) {
    await tx.rollback();
    if (err.message && err.message.includes('UNIQUE constraint failed')) {
      throw new Error(`User ID ${username} is already taken by a user who is not an active Admin`);
    }
    throw err;
  }
  return { created: true, username };
}

if (require.main === module) {
  bootstrapAdmin(db, {
    username: process.env.RAMS_ADMIN_USERNAME,
    password: process.env.RAMS_ADMIN_PASSWORD,
    name: process.env.RAMS_ADMIN_NAME,
  })
    .then((r) => {
      console.log(r.created
        ? `Created Admin "${r.username}". Sign in with RAMS_ADMIN_PASSWORD; you will be asked to change it.`
        : `${r.reason} ("${r.username}") — nothing to do.`);
    })
    .catch((err) => {
      console.error(`bootstrap-admin failed: ${err.message}`);
      process.exitCode = 1;
    })
    .finally(() => db.close());
}

module.exports = { bootstrapAdmin };
