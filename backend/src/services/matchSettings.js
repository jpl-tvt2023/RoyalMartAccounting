// The matching rules (migration 012 match_settings): read, validated, reset.
// Defaults are what the Phase 0 data supported; whoever holds matching.rules
// changes them on Matching -> Matching rules.
const LEVELS = ['off', 'note', 'review'];
const STRENGTHS = ['exact', 'normalised', 'compact'];
const BOOLEANS = ['use_order_no', 'order_no_drop_label', 'order_no_split', 'use_bill_no', 'bill_no_serial',
  'pick_same_date', 'pick_same_fy', 'cn_agst_ref', 'cn_number'];
const CHECK_FIELDS = ['check_party', 'check_sku', 'check_qty', 'check_date', 'check_split', 'check_reused'];
const INTS = {
  qty_tolerance_pct: [0, 100, 'The quantity tolerance must be 0-100 %'],
  date_tolerance_days: [0, 60, 'The date tolerance must be 0-60 days'],
  grace_days: [0, 90, 'The waiting time must be 0-90 days'],
  run_every_minutes: [15, 720, 'Matching must run every 15-720 minutes'],
};

const DEFAULTS = {
  use_order_no: true,
  order_no_drop_label: true,
  order_no_split: true,
  use_bill_no: true,
  bill_no_serial: true,
  number_strength: 'compact',
  pick_same_date: true,
  pick_same_fy: true,
  bill_only_links: 'linked',
  check_party: 'review',
  check_sku: 'review',
  check_qty: 'note',
  qty_tolerance_pct: 0,
  check_date: 'note',
  date_tolerance_days: 0,
  check_split: 'note',
  check_reused: 'review',
  cn_agst_ref: true,
  cn_number: true,
  grace_days: 7,
  excluded_voucher_types: [],
  run_every_minutes: 60,
};
const FIELDS = Object.keys(DEFAULTS);

async function loadRow(client) {
  const { rows } = await client.execute(
    'SELECT s.*, u.name AS updated_by_name FROM match_settings s LEFT JOIN users u ON u.id = s.updated_by WHERE s.id = 1',
  );
  return rows[0];
}

const parseList = (v) => {
  try {
    const list = JSON.parse(v || '[]');
    return Array.isArray(list) ? list : [];
  } catch { return []; }
};

// A stored row -> the settings the engine and the page use.
function shape(row) {
  const out = {};
  for (const f of FIELDS) {
    if (BOOLEANS.includes(f)) out[f] = Boolean(row[f]);
    else if (f in INTS) out[f] = Number(row[f]);
    else if (f === 'excluded_voucher_types') out[f] = parseList(row[f]);
    else out[f] = row[f];
  }
  out.updated_at = row.updated_at ?? null;
  out.updated_by_name = row.updated_by_name ?? null;
  return out;
}

async function loadSettings(client) {
  return shape(await loadRow(client));
}

// The columns as stored, from shaped settings.
function toColumns(settings) {
  const values = {};
  for (const f of FIELDS) {
    const v = settings[f];
    values[f] = BOOLEANS.includes(f) ? (v ? 1 : 0) : f === 'excluded_voucher_types' ? JSON.stringify(v) : v;
  }
  return values;
}

// A PUT body (any subset) -> { settings } merged over the current ones, or { error }.
function validate(body, current) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: 'Send the rules to change' };
  const unknown = Object.keys(body).filter((k) => !FIELDS.includes(k));
  if (unknown.length) return { error: `Unknown rule: ${unknown.join(', ')}` };
  const m = { ...current, ...body };
  for (const f of BOOLEANS) if (typeof m[f] !== 'boolean') return { error: `${f} must be true or false` };
  if (!m.use_order_no && !m.use_bill_no) return { error: 'Keep at least one way of finding the invoice: the Buyer\'s Order No or the Bill No' };
  if (!STRENGTHS.includes(m.number_strength)) return { error: 'How closely numbers must agree is exact, normalised or compact' };
  if (!['linked', 'review'].includes(m.bill_only_links)) return { error: 'A link found by Bill No alone is either linked or needs review' };
  for (const f of CHECK_FIELDS) if (!LEVELS.includes(m[f])) return { error: `${f} must be off, note or review` };
  for (const [f, [min, max, message]] of Object.entries(INTS)) {
    if (!Number.isInteger(m[f]) || m[f] < min || m[f] > max) return { error: message };
  }
  const types = m.excluded_voucher_types;
  if (!Array.isArray(types) || types.some((t) => typeof t !== 'string' || !t.trim() || t.length > 100) || types.length > 200) {
    return { error: 'The voucher types left out must be a list of names' };
  }
  const settings = {};
  for (const f of FIELDS) settings[f] = m[f];
  settings.excluded_voucher_types = [...new Set(types.map((t) => t.trim()))].sort();
  return { settings };
}

module.exports = {
  DEFAULTS, FIELDS, BOOLEANS, CHECK_FIELDS, loadSettings, loadRow, shape, toColumns, validate,
};
