// The auto-fill switches (migration 013 autofill_settings): read, validated,
// reset. Every field starts Off; whoever holds autofill.settings moves it
// through Preview and Ask first to Automatic on Matching -> Auto-fill.
const MODES = ['off', 'preview', 'approve', 'auto'];
const DATE_RULES = ['tally', 'keep'];

const DEFAULTS = {
  bill_mode: 'off',
  cn_mode: 'off',
  replace_typed: true,
  bill_date_rule: 'tally',
};
const FIELDS = Object.keys(DEFAULTS);

async function loadRow(client) {
  const { rows } = await client.execute(
    'SELECT s.*, u.name AS updated_by_name FROM autofill_settings s LEFT JOIN users u ON u.id = s.updated_by WHERE s.id = 1',
  );
  return rows[0];
}

// A stored row -> the settings the sender and the page use.
function shape(row) {
  return {
    bill_mode: row.bill_mode,
    cn_mode: row.cn_mode,
    replace_typed: Boolean(row.replace_typed),
    bill_date_rule: row.bill_date_rule,
    updated_at: row.updated_at ?? null,
    updated_by_name: row.updated_by_name ?? null,
  };
}

async function loadSettings(client) {
  return shape(await loadRow(client));
}

function toColumns(settings) {
  return { ...Object.fromEntries(FIELDS.map((f) => [f, settings[f]])), replace_typed: settings.replace_typed ? 1 : 0 };
}

// A PUT body (any subset) -> { settings } merged over the current ones, or { error }.
function validate(body, current) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: 'Send the settings to change' };
  const unknown = Object.keys(body).filter((k) => !FIELDS.includes(k));
  if (unknown.length) return { error: `Unknown setting: ${unknown.join(', ')}` };
  const m = { ...current, ...body };
  for (const f of ['bill_mode', 'cn_mode']) {
    if (!MODES.includes(m[f])) return { error: 'A mode is off, preview, approve (ask first) or auto' };
  }
  if (typeof m.replace_typed !== 'boolean') return { error: 'replace_typed must be true or false' };
  if (!DATE_RULES.includes(m.bill_date_rule)) return { error: 'The Bill Date rule is tally or keep' };
  return { settings: Object.fromEntries(FIELDS.map((f) => [f, m[f]])) };
}

module.exports = {
  DEFAULTS, FIELDS, MODES, DATE_RULES, loadSettings, loadRow, shape, toColumns, validate,
};
