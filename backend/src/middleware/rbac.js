// The RAMS role set. MIRRORED in frontend/src/utils/roles.js (ROLES, ALL_ROLES,
// ADMIN_ONLY) and in migration 002's CHECK -- change all three together; the
// parity tests in tests/roles.test.js and frontend utils/__tests__/roles.test.js
// pin them.
//   Admin / Owner -- everything, including Users and the Audit Log.
//   Accountant    -- works the accounts (exceptions, applying Tally values).
//   Viewer        -- reads only.
const ALL_ROLES = ['Admin', 'Owner', 'Accountant', 'Viewer'];
const ADMIN_ROLES = ['Admin', 'Owner'];

// Applied at route-definition time, always after `auth`.
const allowRoles = (...allowed) => (req, res, next) => {
  const userRoles = req.user?.roles || [];
  if (!userRoles.some((r) => allowed.includes(r))) {
    return res.status(403).json({ message: 'Access denied' });
  }
  next();
};

module.exports = { allowRoles, ALL_ROLES, ADMIN_ROLES };
