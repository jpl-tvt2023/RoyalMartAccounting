const rateLimit = require('express-rate-limit');

// (Copied from ROMS.) A loose global limiter in front of every route. The
// default store is in-memory, so on Vercel it counts per lambda instance, not
// globally. Disabled under test: the suites drive hundreds of requests from one
// IP in a few minutes.
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  limit: 3000,              // per IP per window
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many requests, please try again later.' },
  skip: () => process.env.NODE_ENV === 'test',
});

// A tight limiter for the one unauthenticated write. Counts only failed
// attempts, so a user who signs in normally is never locked out by their own
// traffic -- only sustained wrong guessing trips it.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  limit: 20,                // failed attempts per IP per window
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many failed login attempts. Please try again in a few minutes.' },
  skip: () => process.env.NODE_ENV === 'test',
});

module.exports = { globalLimiter, loginLimiter };
