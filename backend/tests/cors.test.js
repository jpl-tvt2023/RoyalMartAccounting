const request = require('supertest');
const app = require('../app');

// Which browser origins may call the API (app.js). On Vercel the web app and
// the API share one domain, so the API's own domain must always pass, without
// being listed in FRONTEND_URL.
describe('allowed origins', () => {
  test('no Origin (server-to-server, curl, same-origin GET) passes', async () => {
    expect((await request(app).get('/api/health')).status).toBe(200);
  });

  test('an origin listed in FRONTEND_URL passes, with credentials allowed', async () => {
    const res = await request(app).get('/api/health').set('Origin', 'http://localhost:5174');
    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5174');
    expect(res.headers['access-control-allow-credentials']).toBe('true');
  });

  test("the API's own domain passes without being listed — by Host or by X-Forwarded-Host", async () => {
    const byHost = await request(app).get('/api/health')
      .set('Host', 'royalmartaccounting.vercel.app')
      .set('Origin', 'https://royalmartaccounting.vercel.app');
    expect(byHost.status).toBe(200);

    const byForwarded = await request(app).get('/api/health')
      .set('X-Forwarded-Host', 'royalmartaccounting-git-feature-x.vercel.app')
      .set('Origin', 'https://royalmartaccounting-git-feature-x.vercel.app');
    expect(byForwarded.status).toBe(200);
  });

  test("the browser's pre-flight for sign-in from the app's own domain is answered", async () => {
    const res = await request(app).options('/api/auth/login')
      .set('Host', 'royalmartaccounting.vercel.app')
      .set('Origin', 'https://royalmartaccounting.vercel.app')
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'content-type');
    expect(res.status).toBe(204);
  });

  test('any other origin is refused with a 403 and a clear message, not a 500', async () => {
    const res = await request(app).get('/api/health').set('Origin', 'https://evil.example');
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ message: 'This origin is not allowed to call the RAMS API' });

    // A look-alike domain is not the API's own.
    const lookalike = await request(app).get('/api/health')
      .set('Host', 'royalmartaccounting.vercel.app')
      .set('Origin', 'https://royalmartaccounting.vercel.app.evil.example');
    expect(lookalike.status).toBe(403);
  });
});
