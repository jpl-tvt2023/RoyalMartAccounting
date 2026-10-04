// npm run migrate -- applies pending NNN_*.sql files to $TURSO_DATABASE_URL.
// (Copied from ROMS.) Check which database backend/.env points at FIRST: the
// same command will happily migrate production.
//
// Rules for migration files:
//   - append-only: schema_migrations is keyed on filename, so editing an
//     applied file is silently ignored -- add a new one
//   - the splitter is sql.split(';'), so no semicolon may appear except as a
//     statement separator (none in comments or string literals). The same
//     splitting is repeated in tests/helpers/globalSetup.js
//   - each file runs in one transaction together with its schema_migrations row
require('../config/env');
const fs = require('fs');
const path = require('path');
const { createClient } = require('@libsql/client');

const db = createClient({
  url: process.env.TURSO_DATABASE_URL || 'file:./local.db',
  authToken: process.env.TURSO_AUTH_TOKEN || undefined,
});

const splitSQL = (sql) => sql.split(';').map((s) => s.trim()).filter(Boolean);

async function migrate() {
  try {
    // Enforce FKs during migrations (a no-op inside a transaction, so set it first).
    await db.execute('PRAGMA foreign_keys = ON');
    await db.execute(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename   TEXT PRIMARY KEY,
        applied_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);

    const { rows: applied } = await db.execute('SELECT filename FROM schema_migrations');
    const appliedSet = new Set(applied.map((r) => String(r.filename)));
    const files = fs.readdirSync(__dirname).filter((f) => f.endsWith('.sql')).sort();

    console.log(`Migrating ${String(process.env.TURSO_DATABASE_URL).replace(/[?#].*$/, '')}`);
    for (const file of files) {
      if (appliedSet.has(file)) {
        console.log(`  skip: ${file}`);
        continue;
      }
      const statements = splitSQL(fs.readFileSync(path.join(__dirname, file), 'utf8'));
      const tx = await db.transaction('write');
      try {
        for (const stmt of statements) await tx.execute(stmt);
        await tx.execute({ sql: 'INSERT INTO schema_migrations (filename) VALUES (?)', args: [file] });
        await tx.commit();
      } catch (err) {
        await tx.rollback();
        throw err;
      }
      console.log(`  applied: ${file}`);
    }
    console.log('Migrations complete.');
  } catch (err) {
    console.error('Migration failed:', err.message);
    process.exitCode = 1;
  } finally {
    db.close();
  }
}

migrate();
