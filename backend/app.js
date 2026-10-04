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

// Security headers. The SPA document's CSP lives on the static host
// (frontend/vercel.json).
app.use(helmet());

const allowedOrigins = (process.env.FRONTEND_URL || 'http://localhost:5174')
  .split(',')
  .map((s) => s.trim());

app.use(cors({
  origin: (origin, cb) => {
    if (!origin || allowedOrigins.includes(origin)) cb(null, true);
    else cb(new Error('Not allowed by CORS'));
  },
  credentials: true,
}));
app.use(express.json({ limit: '256kb' }));
app.use(cookieParser());
app.use(globalLimiter);

app.use('/api/auth',       require('./src/routes/auth.routes'));
app.use('/api/users',      require('./src/routes/users.routes'));
app.use('/api/audit-logs', require('./src/routes/audit.routes'));

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

app.use(errorHandler);

module.exports = app;
