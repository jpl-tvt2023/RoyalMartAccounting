require('dotenv').config();

// Fails fast: a missing one of these exits before anything else boots.
// TURSO_AUTH_TOKEN and FRONTEND_URL are read straight from process.env by
// db.js and app.js, so a remote DB with a blank token boots and then fails on
// the first query.
const required = [
  'TURSO_DATABASE_URL',
  'JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET',
];

for (const key of required) {
  if (!process.env[key]) {
    console.error(`Missing required env variable: ${key}`);
    process.exit(1);
  }
}

module.exports = {
  PORT: process.env.PORT || 5001,
  NODE_ENV: process.env.NODE_ENV || 'development',
  JWT_ACCESS_SECRET: process.env.JWT_ACCESS_SECRET,
  JWT_REFRESH_SECRET: process.env.JWT_REFRESH_SECRET,
  JWT_ACCESS_EXPIRY: process.env.JWT_ACCESS_EXPIRY || '15m',
  JWT_REFRESH_EXPIRY: process.env.JWT_REFRESH_EXPIRY || '7d',
};
