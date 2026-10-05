// Small helpers for Tally companies and their sync state.

// A company's default short label, from the state Tally reports for it. Only a
// default: an Admin can change it on the Tally companies page.
const STATE_CODES = {
  'andaman and nicobar islands': 'AN', 'andhra pradesh': 'AP', 'arunachal pradesh': 'AR', assam: 'AS',
  bihar: 'BR', chandigarh: 'CH', chhattisgarh: 'CG', 'dadra and nagar haveli and daman and diu': 'DN',
  delhi: 'DL', goa: 'GA', gujarat: 'GJ', haryana: 'HR', 'himachal pradesh': 'HP', 'jammu and kashmir': 'JK',
  jharkhand: 'JH', karnataka: 'KA', kerala: 'KL', ladakh: 'LA', lakshadweep: 'LD', 'madhya pradesh': 'MP',
  maharashtra: 'MH', manipur: 'MN', meghalaya: 'ML', mizoram: 'MZ', nagaland: 'NL', odisha: 'OD',
  puducherry: 'PY', punjab: 'PB', rajasthan: 'RJ', sikkim: 'SK', 'tamil nadu': 'TN', telangana: 'TS',
  tripura: 'TR', 'uttar pradesh': 'UP', uttarakhand: 'UK', 'west bengal': 'WB',
};
const codeForState = (state) => STATE_CODES[String(state || '').trim().toLowerCase()] || null;

// A short label an Admin may set: 1-10 of A-Z 0-9 and -.
const CODE_RE = /^[A-Z0-9-]{1,10}$/;

// tally_sync_state row (or the LEFT JOIN's nulls) -> what the Connector and
// the UI read.
function syncShape(row) {
  return {
    altVchId: row.alt_vch_id == null ? null : Number(row.alt_vch_id),
    altMstId: row.alt_mst_id == null ? null : Number(row.alt_mst_id),
    backfillThrough: row.backfill_through ?? null,
    backfillDone: Boolean(row.backfill_done),
    needsResync: Boolean(row.needs_resync),
    lastLightAt: row.last_light_at ?? null,
    lastHeavyAt: row.last_heavy_at ?? null,
    lastCheckedAt: row.last_checked_at ?? null,
  };
}

module.exports = { codeForState, CODE_RE, syncShape };
