const jwt = require('jsonwebtoken');
const { JWT_ACCESS_SECRET } = require('../config/env');

// Bearer access token only -- never the cookie. Sets
// req.user = { id, username, name, roles, pwd_change }.
//
// A user who still has to change a first or admin-reset password carries
// `pwd_change` in the token and may reach only the routes that let them do it.
// ROMS enforces this in the UI alone; RAMS enforces it here, so the API cannot
// be used around the forced change.
const PASSWORD_CHANGE_ROUTES = ['/api/auth/change-password', '/api/auth/logout', '/api/auth/me'];

module.exports = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'No token provided' });
  }
  try {
    req.user = jwt.verify(authHeader.slice(7), JWT_ACCESS_SECRET);
  } catch {
    return res.status(401).json({ message: 'Invalid or expired token' });
  }
  if (req.user.pwd_change && !PASSWORD_CHANGE_ROUTES.includes(req.baseUrl + req.path)) {
    return res.status(403).json({ code: 'PASSWORD_CHANGE_REQUIRED', message: 'Change your password to continue' });
  }
  next();
};

module.exports.PASSWORD_CHANGE_ROUTES = PASSWORD_CHANGE_ROUTES;
