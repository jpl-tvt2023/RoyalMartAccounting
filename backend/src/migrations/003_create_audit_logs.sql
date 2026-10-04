-- The audit trail. Every mutating controller writes a row through
-- services/auditLog.service.js, inside the same transaction as the change.
--
-- The end state of ROMS's audit_logs (its 007 + 029 + 035): who, what action,
-- a readable description, the record it touched -- entity_id for numeric keys,
-- entity_ref for text ones -- and `changes`, a JSON list of
-- { field, old, new } for a field-level diff.
--
-- user_id is NULL for actions no signed-in user took (a failed login for an
-- unknown User ID, the first-Admin bootstrap). Users are deactivated rather
-- than deleted, so ON DELETE SET NULL is only a safety net.
--
-- RAMS keeps the whole trail: there is no retention purge (ROMS purges user
-- history after 31 days).

CREATE TABLE IF NOT EXISTS audit_logs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action_type TEXT    NOT NULL,
  description TEXT,
  entity_type TEXT,
  entity_id   INTEGER,
  entity_ref  TEXT,
  changes     TEXT,
  timestamp   TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_audit_entity     ON audit_logs(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_entity_ref ON audit_logs(entity_type, entity_ref);
CREATE INDEX IF NOT EXISTS idx_audit_user       ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_timestamp  ON audit_logs(timestamp)
