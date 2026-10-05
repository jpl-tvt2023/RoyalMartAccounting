// The sync schedule (migration 009): read, validated, and turned into what
// the Connector reads from the heartbeat reply. The Connector checks the same
// rules again before using it (agent/src/connectorConfig.js checkSchedule).
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const LIGHT_MIN = 15;
const LIGHT_MAX = 720;

const daysOf = (text) => String(text || '').split(',').filter((d) => d !== '').map(Number);

async function loadSettings(client) {
  const { rows } = await client.execute(
    `SELECT s.*, u.name AS updated_by_name FROM sync_settings s LEFT JOIN users u ON u.id = s.updated_by WHERE s.id = 1`,
  );
  return rows[0];
}

// For people: GET /api/settings/sync.
const shape = (row) => ({
  office_days: daysOf(row.office_days),
  office_start: row.office_start,
  office_end: row.office_end,
  light_every_minutes: Number(row.light_every_minutes),
  heavy_after: row.heavy_after,
  backfill_in_office_hours: Boolean(row.backfill_in_office_hours),
  updated_at: row.updated_at ?? null,
  updated_by_name: row.updated_by_name ?? null,
});

// For the Connector: the heartbeat reply's settings.schedule.
const scheduleOf = (row) => ({
  officeHours: { days: daysOf(row.office_days), start: row.office_start, end: row.office_end },
  lightEveryMinutes: Number(row.light_every_minutes),
  heavyAfter: row.heavy_after,
  backfillInOfficeHours: Boolean(row.backfill_in_office_hours),
});

// A PUT body -> { values } for the columns, or { error }.
function validate(body, current) {
  const merged = { ...shape(current), ...body };
  const days = merged.office_days;
  if (!Array.isArray(days) || !days.length || days.some((d) => !Number.isInteger(d) || d < 0 || d > 6)
      || new Set(days).size !== days.length) {
    return { error: 'Choose at least one office day (0 = Sunday ... 6 = Saturday)' };
  }
  if (!HHMM.test(merged.office_start || '') || !HHMM.test(merged.office_end || '')) return { error: 'Office hours must be HH:MM' };
  if (merged.office_start >= merged.office_end) return { error: 'Office hours must end after they start' };
  const light = merged.light_every_minutes;
  if (!Number.isInteger(light) || light < LIGHT_MIN || light > LIGHT_MAX) {
    return { error: `The light sync interval must be ${LIGHT_MIN}-${LIGHT_MAX} minutes` };
  }
  if (!HHMM.test(merged.heavy_after || '')) return { error: 'The end-of-day check time must be HH:MM' };
  if (typeof merged.backfill_in_office_hours !== 'boolean') return { error: 'backfill_in_office_hours must be true or false' };
  return {
    values: {
      office_days: [...days].sort((a, b) => a - b).join(','),
      office_start: merged.office_start,
      office_end: merged.office_end,
      light_every_minutes: light,
      heavy_after: merged.heavy_after,
      backfill_in_office_hours: merged.backfill_in_office_hours ? 1 : 0,
    },
  };
}

module.exports = { loadSettings, shape, scheduleOf, validate, LIGHT_MIN, LIGHT_MAX };
