-- Roles, any number per user, as in ROMS (a join table, not a column).
--
-- The four RAMS roles (blueprint):
--   Admin, Owner  -- everything, including Users and the Audit Log
--   Accountant    -- works the accounts: exceptions, applying Tally values
--   Viewer        -- reads only
--
-- MIRRORED in middleware/rbac.js and frontend/src/utils/roles.js. SQLite cannot
-- ALTER a CHECK, so adding a role later is a table rebuild plus those two files
-- (the ROMS pattern, see its 028 and 046).

CREATE TABLE IF NOT EXISTS user_roles (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role    TEXT    NOT NULL CHECK (role IN ('Admin','Owner','Accountant','Viewer')),
  PRIMARY KEY (user_id, role)
)
