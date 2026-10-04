const fs = require('fs');
const path = require('path');
const request = require('supertest');
const app = require('../app');
const { ALL_ROLES, ADMIN_ROLES } = require('../src/middleware/rbac');

// The role set lives in three places that must agree: rbac.js, migration 002's
// CHECK, and the frontend's utils/roles.js (whose own test asserts these same
// values).
describe('the RAMS role set', () => {
  test('is Admin, Owner, Accountant and Viewer, with Admin and Owner as the admins', () => {
    expect(ALL_ROLES).toEqual(['Admin', 'Owner', 'Accountant', 'Viewer']);
    expect(ADMIN_ROLES).toEqual(['Admin', 'Owner']);
  });

  test("matches migration 002's CHECK constraint", () => {
    const sql = fs.readFileSync(path.resolve(__dirname, '../src/migrations/002_create_user_roles.sql'), 'utf8');
    const inList = /CHECK \(role IN \(([^)]*)\)\)/.exec(sql)[1];
    expect(inList.split(',').map((s) => s.trim().replace(/'/g, ''))).toEqual(ALL_ROLES);
  });
});

describe('GET /api/health', () => {
  test('answers ok without a login', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });
});
