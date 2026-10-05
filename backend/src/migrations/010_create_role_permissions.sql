-- Who may do what, beyond reading: set by an Admin or Owner on Admin -> Roles
-- & permissions (audited), not in code. A row grants one permission to one
-- role. The permissions themselves (what each key lets a role do) are listed
-- in src/services/permissions.js, because each one guards code.
--
-- Only Accountant and Viewer appear here. Admin and Owner always hold every
-- permission, so nobody can lock out the people who set this. Users, the Audit
-- Log and this page stay Admin/Owner only and are never granted, so a role
-- cannot give itself admin rights.
--
-- Seeded with the defaults agreed on 2026-10-05 -- Accountants do all of the
-- matching work, Viewers only look.

CREATE TABLE IF NOT EXISTS role_permissions (
  role       TEXT    NOT NULL CHECK (role IN ('Accountant','Viewer')),
  permission TEXT    NOT NULL,
  updated_at TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_by INTEGER REFERENCES users(id),
  PRIMARY KEY (role, permission)
);

INSERT OR IGNORE INTO role_permissions (role, permission) VALUES
  ('Accountant', 'matching.view'),
  ('Accountant', 'matching.run'),
  ('Accountant', 'matching.review'),
  ('Accountant', 'matching.rules'),
  ('Accountant', 'matching.parties'),
  ('Viewer', 'matching.view')
