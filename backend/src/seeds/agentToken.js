// npm run agent-token -- creates a Connector token and prints it ONCE.
//
//   npm run agent-token -- --name "Office PC"            a new token
//   npm run agent-token -- --name "Office PC" --rotate   retire every other token first
//   npm run agent-token -- --revoke-all                  retire them all, create none
//
// Only the token's sha256 is stored, so a lost token cannot be shown again:
// make a new one. Put it in the Connector's connector.json ("token") or its
// RAMS_API_TOKEN. Retired tokens stop working at once. Check which database
// backend/.env points at first, as for `npm run migrate`.
require('../config/env');
const crypto = require('crypto');
const db = require('../config/db');
const { logAction } = require('../services/auditLog.service');
const { hashToken } = require('../middleware/agentAuth');

const newToken = () => `rams_${crypto.randomBytes(32).toString('base64url')}`;

// Returns { token, id, name, revoked }. token is null when nothing was created.
async function agentToken(client, { name, rotate = false, revokeAll = false }) {
  const label = String(name || '').trim();
  if (!revokeAll && (!label || label.length > 60)) throw new Error('--name is required (up to 60 characters), e.g. --name "Office PC"');

  const tx = await client.transaction('write');
  try {
    let revoked = 0;
    if (rotate || revokeAll) {
      const { rows } = await tx.execute('SELECT id, name FROM agents WHERE is_active = 1');
      for (const r of rows) {
        await tx.execute({ sql: "UPDATE agents SET is_active = 0, revoked_at = datetime('now') WHERE id = ?", args: [r.id] });
        await logAction({
          client: tx, actionType: 'AGENT_TOKEN_REVOKE', description: `Connector token "${r.name}" retired by agent-token`,
          entityType: 'agent', entityId: Number(r.id),
        });
      }
      revoked = rows.length;
    }
    let token = null;
    let id = null;
    if (!revokeAll) {
      token = newToken();
      const { rows } = await tx.execute({
        sql: 'INSERT INTO agents (name, token_hash) VALUES (?, ?) RETURNING id',
        args: [label, hashToken(token)],
      });
      id = Number(rows[0].id);
      await logAction({
        client: tx, actionType: 'AGENT_TOKEN_CREATE', description: `Connector token "${label}" created by agent-token`,
        entityType: 'agent', entityId: id,
      });
    }
    await tx.commit();
    return { token, id, name: label, revoked };
  } catch (err) {
    await tx.rollback();
    throw err;
  }
}

function parseArgs(argv) {
  const out = { rotate: false, revokeAll: false, name: '' };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--rotate') out.rotate = true;
    else if (argv[i] === '--revoke-all') out.revokeAll = true;
    else if (argv[i] === '--name') out.name = argv[++i] || '';
    else if (argv[i].startsWith('--name=')) out.name = argv[i].slice(7);
    else throw new Error(`Unknown option ${argv[i]}`);
  }
  return out;
}

if (require.main === module) {
  Promise.resolve()
    .then(() => agentToken(db, parseArgs(process.argv.slice(2))))
    .then((r) => {
      console.log(`Database: ${String(process.env.TURSO_DATABASE_URL).replace(/[?#].*$/, '')}`);
      if (r.revoked) console.log(`Retired ${r.revoked} Connector token(s).`);
      if (r.token) {
        console.log(`\nConnector token for "${r.name}" (shown once, store it now):\n\n  ${r.token}\n`);
        console.log('Put it in the Connector\'s connector.json as "token", or in RAMS_API_TOKEN.');
      }
    })
    .catch((err) => {
      console.error(`agent-token failed: ${err.message}`);
      process.exitCode = 1;
    })
    .finally(() => db.close());
}

module.exports = { agentToken, parseArgs };
