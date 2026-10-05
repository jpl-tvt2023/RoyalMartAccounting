const db = require('../config/db');
const { hasPermission, KEYS } = require('../services/permissions');

// Applied at route-definition time, always after `auth`. Admin and Owner always
// pass; other roles need the permission granted on Admin -> Roles & permissions.
// Looked up on every request, so a change applies at once -- not at the user's
// next sign-in.
const requirePermission = (key) => {
  if (!KEYS.has(key)) throw new Error(`requirePermission: unknown permission ${key}`);
  return async (req, res, next) => {
    try {
      if (await hasPermission(db, req.user?.roles, key)) return next();
      return res.status(403).json({ message: 'Access denied' });
    } catch (err) { next(err); }
  };
};

module.exports = { requirePermission };
