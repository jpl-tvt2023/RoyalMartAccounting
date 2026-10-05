const { db } = require('./helpers/db');
const { agentToken, parseArgs } = require('../src/seeds/agentToken');
const { hashToken } = require('../src/middleware/agentAuth');
const { agentPost } = require('./helpers/agent');

describe('npm run agent-token', () => {
  test('creates a token that works, storing only its hash, and audits it', async () => {
    const r = await agentToken(db, { name: 'Token suite PC' });
    expect(r.token).toMatch(/^rams_[A-Za-z0-9_-]{43}$/);
    const { rows: [row] } = await db.execute({ sql: 'SELECT * FROM agents WHERE id = ?', args: [r.id] });
    expect(row.token_hash).toBe(hashToken(r.token));
    expect(JSON.stringify(row)).not.toContain(r.token);
    expect((await agentPost(r.token, '/heartbeat', {})).status).toBe(200);
    const { rows: [audit] } = await db.execute({ sql: "SELECT * FROM audit_logs WHERE action_type = 'AGENT_TOKEN_CREATE' AND entity_id = ?", args: [r.id] });
    expect(audit.description).toBe('Connector token "Token suite PC" created by agent-token');
  });

  test('--rotate retires every other token; --revoke-all retires them all and creates none', async () => {
    const a = await agentToken(db, { name: 'Old PC' });
    const b = await agentToken(db, { name: 'New PC', rotate: true });
    expect(b.revoked).toBeGreaterThanOrEqual(1);
    expect((await agentPost(a.token, '/heartbeat', {})).status).toBe(401);
    expect((await agentPost(b.token, '/heartbeat', {})).status).toBe(200);

    const c = await agentToken(db, { revokeAll: true });
    expect(c.token).toBeNull();
    expect((await agentPost(b.token, '/heartbeat', {})).status).toBe(401);
    const { rows: [{ n }] } = await db.execute('SELECT COUNT(*) AS n FROM agents WHERE is_active = 1');
    expect(Number(n)).toBe(0);
  });

  test('a name is required, and options are checked', async () => {
    await expect(agentToken(db, { name: ' ' })).rejects.toThrow(/--name is required/);
    expect(parseArgs(['--name', 'Office PC', '--rotate'])).toEqual({ name: 'Office PC', rotate: true, revokeAll: false });
    expect(parseArgs(['--name=Dev PC'])).toMatchObject({ name: 'Dev PC' });
    expect(() => parseArgs(['--force'])).toThrow('Unknown option --force');
  });
});
