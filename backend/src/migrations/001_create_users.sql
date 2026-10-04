-- RAMS users. Separate logins from ROMS (blueprint decision), on the same
-- shape as ROMS's users table at migration 094, minus what RAMS does not use.
--
-- username is the login ("User ID"): lowercase, 3-30 of a-z 0-9 . _ - (the rule
-- lives in services/username.js). There is no email column -- ROMS keeps one
-- only as a vestige of an old login scheme.
--
-- is_first_login forces a password change, and the API enforces it
-- (middleware/auth.js), not just the UI redirect ROMS relies on.
--
-- is_active: users are deactivated, never deleted, so the audit trail keeps the
-- name of whoever did each thing. An inactive user cannot sign in or refresh.
--
-- token_version is carried inside every refresh token. Bumping it -- password
-- change, admin reset, role change, deactivation -- ends every session that
-- user has open at its next refresh. ROMS has no way to revoke a refresh token.
--
-- No MFA columns yet (deferred 2026-10-04). Adding MFA later is one migration.
-- Migrations are split on semicolons, so none may appear inside a comment.

CREATE TABLE IF NOT EXISTS users (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  name           TEXT    NOT NULL,
  username       TEXT    NOT NULL UNIQUE,
  password_hash  TEXT    NOT NULL,
  is_first_login INTEGER NOT NULL DEFAULT 1,
  is_active      INTEGER NOT NULL DEFAULT 1,
  token_version  INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT,
  updated_by     INTEGER REFERENCES users(id)
)
