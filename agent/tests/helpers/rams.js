// The real RAMS backend (../../backend), started in-process on a throwaway
// SQLite file, so the Connector's tests run against the API it will really
// talk to rather than a fake of it.
//
// It needs backend/node_modules (CI's agent job installs it). Without it the
// suites that use it are skipped, saying so.
const fs = require('fs');
const path = require('path');

const BACKEND = path.resolve(__dirname, '../../../backend');
const hasBackend = fs.existsSync(path.join(BACKEND, 'node_modules', 'express'));

async function migrate(db) {
  await db.execute(`CREATE TABLE IF NOT EXISTS schema_migrations (
    filename TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (datetime('now')))`);
  const dir = path.join(BACKEND, 'src', 'migrations');
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    const statements = fs.readFileSync(path.join(dir, file), 'utf8').split(';').map((s) => s.trim()).filter(Boolean);
    for (const stmt of statements) await db.execute(stmt);
    await db.execute({ sql: 'INSERT INTO schema_migrations (filename) VALUES (?)', args: [file] });
  }
}

// One RAMS per test file: { url, db, token, enable(guid), one(sql, args), all(sql, args), close() }.
async function startRams({ name, syncFrom = '2026-04-01' }) {
  const tmp = path.resolve(__dirname, '..', '.tmp');
  fs.mkdirSync(tmp, { recursive: true });
  const file = path.join(tmp, `${name}.db`);
  for (const f of [file, `${file}-journal`, `${file}-wal`, `${file}-shm`]) fs.rmSync(f, { force: true });

  // Before the backend is loaded: its config reads these once.
  Object.assign(process.env, {
    NODE_ENV: 'test',
    TURSO_DATABASE_URL: `file:${path.relative(process.cwd(), file).split(path.sep).join('/')}`,
    TURSO_AUTH_TOKEN: '',
    JWT_ACCESS_SECRET: 'agent-tests-access',
    JWT_REFRESH_SECRET: 'agent-tests-refresh',
    RAMS_SYNC_FROM: syncFrom,
    DOTENV_CONFIG_QUIET: 'true',
  });
  const app = require(path.join(BACKEND, 'app'));
  const db = require(path.join(BACKEND, 'src', 'config', 'db'));
  const { agentToken } = require(path.join(BACKEND, 'src', 'seeds', 'agentToken'));
  await migrate(db);
  const { token } = await agentToken(db, { name: `Agent tests (${name})` });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });

  const one = async (sql, args = []) => (await db.execute({ sql, args })).rows[0];
  const all = async (sql, args = []) => (await db.execute({ sql, args })).rows;
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    db,
    token,
    one,
    all,
    // What an Admin does on the Tally companies page.
    async enable(guid) {
      const row = await one('SELECT id FROM tally_companies WHERE guid = ?', [guid]);
      if (!row) throw new Error(`RAMS has not seen company ${guid} yet`);
      await db.execute({ sql: 'UPDATE tally_companies SET sync_enabled = 1 WHERE id = ?', args: [row.id] });
      await db.execute({ sql: 'INSERT OR IGNORE INTO tally_sync_state (company_id) VALUES (?)', args: [row.id] });
      return Number(row.id);
    },
    close: () => new Promise((resolve) => { server.close(() => resolve()); }),
  };
}

// The mock Tally on a free port: { server, port, requests, close }. Every
// request it answers is described (requests.js describeRequest) in `requests`.
async function startMockTally(dataset) {
  const { createMockTally } = require('../../mock/server');
  const { describeRequest } = require('../../src/tally/requests');
  const requests = [];
  const server = createMockTally({ dataset, onRequest: (body) => requests.push(describeRequest(body)) });
  await new Promise((resolve) => { server.listen(0, '127.0.0.1', resolve); });
  return {
    server,
    port: server.address().port,
    requests,
    close: () => new Promise((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections(); // kept-alive sockets would hold close() open
    }),
  };
}

module.exports = { startRams, startMockTally, hasBackend, BACKEND };
