require('./src/config/env');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const errorHandler = require('./src/middleware/errorHandler');
const { globalLimiter } = require('./src/middleware/rateLimit');

// The middleware order is load-bearing (same as ROMS): env first, so a missing
// variable exits before anything boots, then proxy trust, security headers,
// CORS, body and cookie parsing, the limiter, the routes, and the error
// handler last.
const app = express();

// Behind Vercel / a reverse proxy: needed for Secure/SameSite=None cookies and
// for rate limiters to see the real client IP rather than the proxy's.
app.set('trust proxy', 1);

// Security headers. The web app's CSP is set on its Vercel service, in the
// root vercel.json.
app.use(helmet());

// Which browser origins may call the API with credentials:
//   - the API's own domain, always. On Vercel the web app and the API share one
//     domain (root vercel.json), and that holds for production, every preview
//     and every per-deployment URL alike, none of which can be listed ahead
//   - anything listed in FRONTEND_URL (comma-separated), e.g. the Vite dev
//     server on http://localhost:5174
// Anything else is refused with a 403, not passed on.
const allowedOrigins = (process.env.FRONTEND_URL || 'http://localhost:5174')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

function isOwnHost(req, origin) {
  let host;
  try { host = new URL(origin).host; } catch { return false; }
  return [req.get('x-forwarded-host'), req.get('host')]
    .filter(Boolean)
    .flatMap((h) => h.split(',').map((s) => s.trim()))
    .includes(host);
}

app.use(cors((req, cb) => {
  const origin = req.get('origin');
  if (!origin || allowedOrigins.includes(origin) || isOwnHost(req, origin)) {
    return cb(null, { origin: true, credentials: true });
  }
  return cb(Object.assign(new Error('This origin is not allowed to call the RAMS API'), { status: 403 }));
}));
// The Connector sends voucher batches of up to 250 (about 300 KB); everything
// else stays on the small limit. The global parser skips a body already read.
app.use('/api/agent', express.json({ limit: '4mb' }));
app.use(express.json({ limit: '256kb' }));
app.use(cookieParser());
app.use(globalLimiter);

app.use('/api/auth',       require('./src/routes/auth.routes'));
app.use('/api/users',      require('./src/routes/users.routes'));
app.use('/api/audit-logs', require('./src/routes/audit.routes'));
app.use('/api/companies',  require('./src/routes/companies.routes'));
app.use('/api/sync',       require('./src/routes/sync.routes'));
app.use('/api/settings',   require('./src/routes/settings.routes'));
app.use('/api/matching',   require('./src/routes/matching.routes'));
app.use('/api/autofill',   require('./src/routes/autofill.routes'));
app.use('/api/reports',    require('./src/routes/reports.routes'));
app.use('/api/agent',      require('./src/routes/agent.routes'));

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

app.use(errorHandler);

module.exports = app;
