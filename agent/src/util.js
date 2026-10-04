// Small helpers shared by the probe, the analysis and the mock.
const fs = require('fs');
const path = require('path');

const pct = (n, d) => (d ? `${Math.round((n / d) * 1000) / 10}%` : '—');

function slugify(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'company';
}

// Dates travel as ISO 'YYYY-MM-DD' strings and are computed in UTC, so the
// office PC's timezone can never shift a month boundary.
function parseIso(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
  return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : null;
}
const iso = (d) => d.toISOString().slice(0, 10);
const addDays = (d, n) => new Date(d.getTime() + n * 86400000);

function todayIso(now = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

// Indian financial year of an ISO date: 2026-05-02 → "2026-27".
function fyOf(isoDate) {
  const m = /^(\d{4})-(\d{2})/.exec(isoDate || '');
  if (!m) return 'unknown';
  const start = Number(m[2]) >= 4 ? Number(m[1]) : Number(m[1]) - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}

// 1 April of the financial year before the one `isoDate` falls in.
function previousFyStart(isoDate) {
  return `${Number(fyOf(isoDate).slice(0, 4)) - 1}-04-01`;
}

// [from, to] cut into calendar months, or into `chunkDays`-day pieces.
function periods(from, to, chunkDays) {
  const start = parseIso(from), end = parseIso(to);
  if (!start || !end) throw new Error(`Bad date range ${from} → ${to} (use YYYY-MM-DD)`);
  const out = [];
  for (let s = start; s <= end;) {
    let e = chunkDays
      ? addDays(s, chunkDays - 1)
      : new Date(Date.UTC(s.getUTCFullYear(), s.getUTCMonth() + 1, 0));
    if (e > end) e = end;
    out.push({ from: iso(s), to: iso(e) });
    s = addDays(e, 1);
  }
  return out;
}

function inc(obj, key, n = 1) {
  obj[key] = (obj[key] || 0) + n;
  return obj;
}

// { key: count } → [[key, count], …] largest first.
function top(counts, n = Infinity) {
  return Object.entries(counts).sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]))).slice(0, n);
}

// Keep the first few distinct examples of something.
function addExample(list, value, max = 5) {
  if (value != null && value !== '' && list.length < max && !list.includes(value)) list.push(value);
  return list;
}

function mdTable(headers, rows) {
  const cell = (v) => String(v ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
  return [
    `| ${headers.map(cell).join(' | ')} |`,
    `|${headers.map(() => '---').join('|')}|`,
    ...rows.map((r) => `| ${r.map(cell).join(' | ')} |`),
  ].join('\n');
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

// A minimal .env reader (KEY=value, # comments, optional quotes) so reading
// ROMS's backend/.env does not need dotenv.
function readEnvFile(file) {
  const out = {};
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m || line.trim().startsWith('#')) continue;
    let v = m[2];
    if (/^(['"]).*\1$/.test(v)) v = v.slice(1, -1);
    else v = v.replace(/\s+#.*$/, '');
    out[m[1]] = v;
  }
  return out;
}

module.exports = {
  pct, slugify, parseIso, todayIso, fyOf, previousFyStart, periods,
  inc, top, addExample, mdTable, writeJson, readJson, readEnvFile,
};
