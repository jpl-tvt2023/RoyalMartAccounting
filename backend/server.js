// Local entry point. On Vercel, the root vercel.json runs app.js (which exports
// the app) as the `backend` service on /api, with no listen and no jobs.
const app = require('./app');
const { PORT, NODE_ENV } = require('./src/config/env');

app.listen(PORT, () => {
  console.log(`RAMS backend running on port ${PORT} [${NODE_ENV}]`);
});
