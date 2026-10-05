// The Connector's log: one file per day (rams-connector-YYYY-MM-DD.log) in the
// log folder, kept for `keepDays`, and echoed to the console. A Connector
// token never reaches the log, wherever it appears in a message.
const fs = require('fs');
const path = require('path');

const PREFIX = 'rams-connector-';
const redact = (s) => String(s).replace(/rams_[A-Za-z0-9_-]{20,}/g, 'rams_***');
const day = (d) => {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

function createLogger({ dir, keepDays = 14, echo = true, now = () => new Date() }) {
  let pruned = null;
  const prune = (today) => {
    if (pruned === today) return;
    pruned = today;
    const cutoff = new Date(now().getTime() - keepDays * 86400000);
    for (const f of fs.existsSync(dir) ? fs.readdirSync(dir) : []) {
      const m = /^rams-connector-(\d{4}-\d{2}-\d{2})\.log$/.exec(f);
      if (m && m[1] < day(cutoff)) fs.rmSync(path.join(dir, f), { force: true });
    }
  };
  const write = (level, message) => {
    const t = now();
    const line = `${t.toISOString()} ${level.padEnd(5)} ${redact(message)}`;
    if (echo) (level === 'ERROR' ? console.error : console.log)(line);
    try {
      fs.mkdirSync(dir, { recursive: true });
      prune(day(t));
      fs.appendFileSync(path.join(dir, `${PREFIX}${day(t)}.log`), `${line}\n`);
    } catch (e) {
      if (echo) console.error(`(could not write the log file in ${dir}: ${e.message})`);
    }
  };
  const log = (message) => write('INFO', message);
  log.info = log;
  log.warn = (message) => write('WARN', message);
  log.error = (message) => write('ERROR', message);
  log.dir = dir;
  return log;
}

module.exports = { createLogger, redact };
