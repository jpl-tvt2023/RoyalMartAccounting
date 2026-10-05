// Facts about Royal Mart that the probe and analysis lean on. Each can be
// overridden from the command line; none is trusted blindly — the profile
// reports what Tally actually holds next to these expectations.

// Roymax Products LLP's PAN. A ledger whose GSTIN carries it is one of our
// own registrations (MH 27…, HR 06…, WB 19…): an internal party, so vouchers
// to it are stock transfers, never receivables or revenue.
const OUR_PAN = 'ABGFR0562B';

const EXPECTED_GSTINS = {
  MH: '27ABGFR0562B1ZI',
  HR: '06ABGFR0562B1ZM',
  WB: '19ABGFR0562B1ZF',
};

// GSTIN state code → short code used in reports.
const STATE_CODES = {
  '06': 'HR', '07': 'DL', '08': 'RJ', '09': 'UP', 19: 'WB', 24: 'GJ', 27: 'MH', 29: 'KA', 33: 'TN', 36: 'TS',
};
const STATE_NAMES = {
  haryana: 'HR', delhi: 'DL', rajasthan: 'RJ', 'uttar pradesh': 'UP', 'west bengal': 'WB',
  gujarat: 'GJ', maharashtra: 'MH', karnataka: 'KA', 'tamil nadu': 'TN', telangana: 'TS',
};

// ROMS accepts only these characters in Bill No (orderSummary.controller.js)
// and in RTV CN/DN numbers (rtv.controller.js ALNUM). A Tally number outside
// it cannot be auto-filled as-is — the Phase 0 decision gate.
const ROMS_REF_RULE = /^[A-Za-z0-9-]+$/;

// ROMS vendors whose rows are stock transfers between our own registrations
// followed by a marketplace sale, rather than outright B2B purchase orders.
const TRANSFER_VENDORS = ['Flipkart', 'Amazon'];

// ROMS went live on this day. RAMS's sync starts here unless RAMS says
// otherwise (its RAMS_SYNC_FROM); `sync --dry-run` uses it as the default --from.
const ROMS_GO_LIVE = '2026-06-08';

module.exports = { OUR_PAN, EXPECTED_GSTINS, STATE_CODES, STATE_NAMES, ROMS_REF_RULE, TRANSFER_VENDORS, ROMS_GO_LIVE };
