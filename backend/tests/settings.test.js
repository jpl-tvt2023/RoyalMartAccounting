const request = require('supertest');
const app = require('../app');
const { db } = require('./helpers/db');
const { signIn, bearer } = require('./helpers/auth');
const { newAgent, agentPost } = require('./helpers/agent');

let admin;
const get = (token) => bearer(request(app).get('/api/settings/sync'), token);
const put = (token, body) => bearer(request(app).put('/api/settings/sync'), token).send(body);

beforeAll(async () => {
  admin = await signIn('admin');
});

describe('the sync schedule', () => {
  test('starts as agreed: Mon-Sat 09:00-20:00, hourly, end-of-day after 19:30, backfill after hours; every role can read it', async () => {
    for (const who of ['admin', 'viewer']) {
      const { token } = await signIn(who);
      const res = await get(token);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        office_days: [1, 2, 3, 4, 5, 6], office_start: '09:00', office_end: '20:00',
        light_every_minutes: 60, heavy_after: '19:30', backfill_in_office_hours: false,
      });
    }
  });

  test('an Admin or Owner changes it, audited, and the Connector gets it in its next heartbeat', async () => {
    const res = await put(admin.token, { office_days: [6, 1, 2, 3, 4, 5, 0], office_end: '21:00', light_every_minutes: 30 });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      office_days: [0, 1, 2, 3, 4, 5, 6], office_start: '09:00', office_end: '21:00', light_every_minutes: 30,
      heavy_after: '19:30', updated_by_name: 'Test Admin',
    });
    const { rows: [audit] } = await db.execute("SELECT * FROM audit_logs WHERE action_type = 'SYNC_SETTINGS_UPDATE' ORDER BY id DESC LIMIT 1");
    expect(JSON.parse(audit.changes)).toEqual([
      { field: 'office_days', old: '1,2,3,4,5,6', new: '0,1,2,3,4,5,6' },
      { field: 'office_end', old: '20:00', new: '21:00' },
      { field: 'light_every_minutes', old: 60, new: 30 },
    ]);

    const agent = await newAgent('Settings suite PC');
    const hb = await agentPost(agent.token, '/heartbeat', {});
    expect(hb.body.settings.schedule).toEqual({
      officeHours: { days: [0, 1, 2, 3, 4, 5, 6], start: '09:00', end: '21:00' },
      lightEveryMinutes: 30, heavyAfter: '19:30', backfillInOfficeHours: false,
    });

    const owner = await signIn('owner');
    expect((await put(owner.token, { office_days: [1, 2, 3, 4, 5, 6], office_end: '20:00', light_every_minutes: 60 })).status).toBe(200);
  });

  test('Accountant and Viewer cannot change it', async () => {
    for (const who of ['accountant', 'viewer']) {
      const { token } = await signIn(who);
      expect((await put(token, { light_every_minutes: 30 })).status).toBe(403);
    }
  });

  test('nonsense is refused with a reason', async () => {
    const cases = [
      [{ office_days: [] }, /at least one office day/],
      [{ office_days: [7] }, /at least one office day/],
      [{ office_days: [1, 1] }, /at least one office day/],
      [{ office_start: '9am' }, /must be HH:MM/],
      [{ office_start: '20:00', office_end: '09:00' }, /end after they start/],
      [{ light_every_minutes: 5 }, /15-720 minutes/],
      [{ heavy_after: '25:00' }, /end-of-day check time/],
      [{ backfill_in_office_hours: 'yes' }, /true or false/],
    ];
    for (const [body, message] of cases) {
      const res = await put(admin.token, body);
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(message);
    }
  });
});
