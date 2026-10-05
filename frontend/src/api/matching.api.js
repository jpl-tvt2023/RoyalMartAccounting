import api from './axios';

// Matching (backend controllers/matching.controller.js). Who may call what is
// the matching.* permissions; Admin and Owner may call everything.

// { counts, reasons, methods, fills, notes, last_run, roms, vendors, companies }
export async function getMatchingSummary() {
  const { data } = await api.get('/matching/summary');
  return data;
}

// { rows, total, page, page_size }; params: kind, outcome, reason, vendor,
// company_id, q, sort, page, page_size
export async function listResults(params) {
  const { data } = await api.get('/matching/results', { params });
  return data;
}

// One PO ('po') or RTV row ('rtv') with how it matched, its checks, candidates,
// PO lines and RTV rows.
export async function getResult(kind, id) {
  const { data } = await api.get(`/matching/results/${kind}/${encodeURIComponent(id)}`);
  return data;
}

// action: confirm | pick | reject | undo; body { company_id, voucher_guid }
// (confirm and reject default to the voucher linked now). Returns the result.
export async function decide(kind, id, action, body = {}) {
  const { data } = await api.post(`/matching/results/${kind}/${encodeURIComponent(id)}/${action}`, body);
  return data;
}

export async function searchVouchers(kind, q) {
  const { data } = await api.get('/matching/vouchers', { params: { kind, q } });
  return data.rows;
}

// "Match now": reads ROMS again and re-matches. { run_id, counts, roms, ms, summary }
export async function runMatching() {
  const { data } = await api.post('/matching/run');
  return data;
}

// { settings, recommended }
export async function getMatchSettings() {
  const { data } = await api.get('/matching/settings');
  return data;
}

// Saves any of the rules and re-matches: { settings, recommended, changed, counts }
export async function updateMatchSettings(body) {
  const { data } = await api.put('/matching/settings', body);
  return data;
}

export async function resetMatchSettings() {
  const { data } = await api.post('/matching/settings/reset');
  return data;
}

// What draft rules would change: { before, after, changed, examples }
export async function previewMatchSettings(body) {
  const { data } = await api.post('/matching/preview', body);
  return data;
}

export async function listVendors() {
  const { data } = await api.get('/matching/vendors');
  return data.rows;
}

export async function updateVendor(vendor, mode) {
  const { data } = await api.put(`/matching/vendors/${encodeURIComponent(vendor)}`, { mode });
  return data;
}

export async function listVoucherTypes() {
  const { data } = await api.get('/matching/voucher-types');
  return data.rows;
}

// { rows, total, page, page_size, suggestions_waiting }; params: company_id,
// status (not_set | suggested | set), q, page, page_size
export async function listPartyLedgers(params) {
  const { data } = await api.get('/matching/party-ledgers', { params });
  return data;
}

// body { kind: 'vendor' | 'internal' | 'other' | null, vendor? }
export async function updatePartyLedger(companyId, guid, body) {
  const { data } = await api.put(`/matching/party-ledgers/${companyId}/${encodeURIComponent(guid)}`, body);
  return data;
}

export async function acceptSuggestions(companyId) {
  const { data } = await api.post('/matching/party-ledgers/accept-suggestions', companyId ? { company_id: companyId } : {});
  return data;
}
