// Vercel entry point: the whole API is one serverless function (vercel.json
// rewrites every path here). No listen, no background jobs.
module.exports = require('../app');
