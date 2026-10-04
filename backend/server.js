// Local entry point. On Vercel, api/index.js exports the same app instead.
const app = require('./app');
const { PORT, NODE_ENV } = require('./src/config/env');

app.listen(PORT, () => {
  console.log(`RAMS backend running on port ${PORT} [${NODE_ENV}]`);
});
