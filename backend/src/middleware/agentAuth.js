const crypto = require('crypto');
const db = require('../config/db');

// The Connector's door: /api/agent/* only. Bearer <Connector token>, looked up
// by its sha256 among the active rows of `agents`. Sets req.agent = { id, name }.
//
// The two kinds of credential never cross: a user's access token is not a
// Connector token (its hash matches no row), and a Connector token is not a
// JWT, so middleware/auth.js refuses it everywhere else.
const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

async function agentAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'No Connector token provided' });
  }
  const token = header.slice(7).trim();
  if (!token || token.length > 200) return res.status(401).json({ message: 'Connector token rejected' });
  try {
    const { rows } = await db.execute({
      sql: 'SELECT id, name FROM agents WHERE token_hash = ? AND is_active = 1',
      args: [hashToken(token)],
    });
    if (!rows.length) return res.status(401).json({ message: 'Connector token rejected' });
    req.agent = { id: Number(rows[0].id), name: rows[0].name };
    next();
  } catch (err) { next(err); }
}

module.exports = agentAuth;
module.exports.hashToken = hashToken;
