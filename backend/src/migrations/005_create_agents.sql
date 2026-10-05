-- RAMS Connectors: the on-premises agents that read Tally and push to RAMS.
--
-- A Connector signs every request with a bearer token. Only the token's sha256
-- is stored (middleware/agentAuth.js). The token is random and long, so a fast
-- hash is enough. It is shown once, by `npm run agent-token`, and is retired by
-- setting is_active = 0 rather than deleting the row, so sync runs keep it.
--
-- status is the latest heartbeat as JSON: whether Tally answered, its licence
-- mode, which companies are loaded, what the Connector is doing, its last error.

CREATE TABLE IF NOT EXISTS agents (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT    NOT NULL,
  token_hash   TEXT    NOT NULL UNIQUE,
  is_active    INTEGER NOT NULL DEFAULT 1,
  version      TEXT,
  status       TEXT,
  last_seen_at TEXT,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  revoked_at   TEXT
)
