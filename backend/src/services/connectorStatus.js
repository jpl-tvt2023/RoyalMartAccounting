const db = require('../config/db');

// What the most recently seen Connector last said, for the people-facing
// screens. A Connector is online when its last heartbeat (sent every minute)
// is under three minutes old.
const ONLINE_SECONDS = 180;

async function latestConnector(client = db) {
  const { rows } = await client.execute(
    `SELECT id, name, version, status, last_seen_at,
            CAST(strftime('%s', 'now') AS INTEGER) - CAST(strftime('%s', last_seen_at) AS INTEGER) AS age_seconds
       FROM agents
      WHERE is_active = 1 AND last_seen_at IS NOT NULL
      ORDER BY last_seen_at DESC, id DESC
      LIMIT 1`,
  );
  if (!rows.length) return null;
  const r = rows[0];
  let status = {};
  try { status = JSON.parse(r.status || '{}') || {}; } catch { status = {}; }
  return {
    name: r.name,
    version: r.version ?? null,
    last_seen_at: r.last_seen_at,
    online: Number(r.age_seconds) <= ONLINE_SECONDS,
    tally: status.tally ?? null,
    activity: status.activity ?? null,
    last_error: status.lastError ?? null,
    // Tally company GUID -> counters, for the companies loaded at the last check.
    loaded: new Map((status.companies || []).map((c) => [c.guid, c])),
  };
}

module.exports = { latestConnector, ONLINE_SECONDS };
