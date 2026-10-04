const request = require('supertest');
const app = require('../../app');
const { TEST_PASSWORD } = require('./users');

// The refresh cookie from a response, as "rams_refresh=..." ready to send back.
const refreshCookieOf = (res) => (res.headers['set-cookie'] || [])
  .find((c) => c.startsWith('rams_refresh='))?.split(';')[0];

// Signs in and returns { token, cookie, user, res }. Throws if it fails.
async function signIn(username, password = TEST_PASSWORD) {
  const res = await request(app).post('/api/auth/login').send({ username, password });
  if (res.status !== 200) throw new Error(`sign-in as ${username} failed: ${res.status} ${res.body.message}`);
  return { token: res.body.accessToken, cookie: refreshCookieOf(res), user: res.body.user, res };
}

const bearer = (req, token) => req.set('Authorization', `Bearer ${token}`);
const refreshWith = (cookie) => request(app).post('/api/auth/refresh').set('Cookie', cookie);

// A valid, unique User ID (lowercase, <= 30 chars).
let n = 0;
const uniqueUsername = (prefix = 'u') => `${prefix}${Date.now().toString(36)}${(n++).toString(36)}`.slice(0, 30);

module.exports = { signIn, refreshCookieOf, bearer, refreshWith, uniqueUsername };
