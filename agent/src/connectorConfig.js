// The Connector's settings: connector.json, then environment variables.
//
// Where connector.json is looked for, first found wins:
//   --config FILE
//   %ProgramData%\RAMS\connector.json   (the office PC install, M8)
//   agent/connector.json                (the dev PC; gitignored)
// RAMS_API_URL, RAMS_API_TOKEN, RAMS_TALLY_HOST and RAMS_TALLY_PORT override
// the file. connector.example.json lists every setting.
const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  apiUrl: '',
  token: '',
  tally: { host: '127.0.0.1', port: 9000, timeoutSeconds: 300, encoding: 'utf16' },
  // Office hours on this PC's clock. Days: 0 = Sunday ... 6 = Saturday.
  officeHours: { days: [1, 2, 3, 4, 5, 6], start: '09:00', end: '20:00' },
  lightEveryMinutes: 60,
  heavyAfter: '19:30',
  backfillInOfficeHours: false,
  heartbeatSeconds: 60,
  tallyCheckMinutes: 5,
  batchSize: 100,
  logDir: '',
  keepLogDays: 14,
};

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

function defaultConfigFile({ env = process.env, platform = process.platform, exists = fs.existsSync } = {}) {
  if (platform === 'win32' && env.ProgramData) {
    const installed = path.join(env.ProgramData, 'RAMS', 'connector.json');
    if (exists(installed)) return installed;
  }
  return path.resolve(__dirname, '..', 'connector.json');
}

function check(cfg) {
  const problems = [];
  if (!HHMM.test(cfg.officeHours.start) || !HHMM.test(cfg.officeHours.end)) problems.push('officeHours start/end must be HH:MM');
  if (!Array.isArray(cfg.officeHours.days) || cfg.officeHours.days.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) {
    problems.push('officeHours.days must list days 0 (Sunday) to 6 (Saturday)');
  }
  if (!HHMM.test(cfg.heavyAfter)) problems.push('heavyAfter must be HH:MM');
  for (const key of ['lightEveryMinutes', 'heartbeatSeconds', 'tallyCheckMinutes', 'batchSize', 'keepLogDays']) {
    if (!Number.isInteger(cfg[key]) || cfg[key] < 1) problems.push(`${key} must be a whole number above 0`);
  }
  if (cfg.batchSize > 250) problems.push('batchSize can be at most 250 (what RAMS accepts)');
  if (problems.length) throw new Error(`connector.json: ${problems.join('; ')}`);
  return cfg;
}

// Returns { config, file, found }.
function loadConfig({ file = null, env = process.env, platform = process.platform } = {}) {
  const where = file ? path.resolve(file) : defaultConfigFile({ env, platform });
  const found = fs.existsSync(where);
  if (file && !found) throw new Error(`No such config file: ${where}`);
  let fromFile = {};
  if (found) {
    try {
      fromFile = JSON.parse(fs.readFileSync(where, 'utf8').replace(/^﻿/, ''));
    } catch (e) {
      throw new Error(`${where} is not valid JSON: ${e.message}`);
    }
  }
  const cfg = {
    ...DEFAULTS,
    ...fromFile,
    tally: { ...DEFAULTS.tally, ...(fromFile.tally || {}) },
    officeHours: { ...DEFAULTS.officeHours, ...(fromFile.officeHours || {}) },
  };
  if (env.RAMS_API_URL) cfg.apiUrl = env.RAMS_API_URL;
  if (env.RAMS_API_TOKEN) cfg.token = env.RAMS_API_TOKEN;
  if (env.RAMS_TALLY_HOST) cfg.tally.host = env.RAMS_TALLY_HOST;
  if (env.RAMS_TALLY_PORT) cfg.tally.port = Number(env.RAMS_TALLY_PORT);
  if (!cfg.logDir) {
    cfg.logDir = found && path.basename(path.dirname(where)) === 'RAMS'
      ? path.join(path.dirname(where), 'logs')
      : path.resolve(__dirname, '..', 'out', 'logs');
  }
  return { config: check(cfg), file: where, found };
}

module.exports = { loadConfig, defaultConfigFile, DEFAULTS };
