// Runs once per jest invocation: wipe tests/.tmp, replay EVERY migration the way
// migrate.js does (split on ';'), then seed one user per role.
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env.test'), override: true });

module.exports = async () => {
  const tmpDir = path.resolve(__dirname, '../.tmp');
  if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
  fs.mkdirSync(tmpDir, { recursive: true });

  const { createClient } = require('@libsql/client');
  const bcrypt = require('bcryptjs');
  const { TEST_PASSWORD, TEST_USERS } = require('./users');
  const db = createClient({ url: process.env.TURSO_DATABASE_URL });

  await db.execute(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename   TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  const migrationsDir = path.resolve(__dirname, '../../src/migrations');
  for (const file of fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()) {
    const statements = fs.readFileSync(path.join(migrationsDir, file), 'utf8')
      .split(';').map((s) => s.trim()).filter(Boolean);
    for (const stmt of statements) await db.execute(stmt);
    await db.execute({ sql: 'INSERT INTO schema_migrations (filename) VALUES (?)', args: [file] });
  }

  const hash = await bcrypt.hash(TEST_PASSWORD, 4);
  for (const u of TEST_USERS) {
    const { rows } = await db.execute({
      sql: 'INSERT INTO users (name, username, password_hash, is_first_login) VALUES (?, ?, ?, 0) RETURNING id',
      args: [u.name, u.username, hash],
    });
    await db.execute({ sql: 'INSERT INTO user_roles (user_id, role) VALUES (?, ?)', args: [rows[0].id, u.role] });
  }

  db.close();
};
