import api from './axios';

// Auto-fill into ROMS (backend controllers/autofill.controller.js). Who may
// call what is the autofill.* permissions; Admin and Owner may call everything.

// { settings, recommended, fields: { po, rtv }, last_run, roms }
export async function getAutofillSummary() {
  const { data } = await api.get('/autofill/summary');
  return data;
}

// The open work: { rows, total, page, page_size }; params: kind, state
// (comma-separated), q, page, page_size
export async function listAutofillItems(params) {
  const { data } = await api.get('/autofill/items', { params });
  return data;
}

// What RAMS wrote into ROMS, newest first; params: kind, result, q, page, page_size
export async function listAutofillEvents(params) {
  const { data } = await api.get('/autofill/events', { params });
  return data;
}

// Any of bill_mode, cn_mode, replace_typed, bill_date_rule: { settings, recommended, changed }
export async function updateAutofillSettings(body) {
  const { data } = await api.put('/autofill/settings', body);
  return data;
}

// Every write waiting for approval in a field (kind po | rtv), or the listed rows.
export async function approveAutofill(kind, ids = null) {
  const { data } = await api.post('/autofill/approve', ids ? { kind, ids } : { kind });
  return data;
}

// One round of writing: { ok, counts, remaining, more, summary }. Ask again while `more`.
export async function runAutofill() {
  const { data } = await api.post('/autofill/run');
  return data;
}

export async function retryAutofill(kind, id) {
  const { data } = await api.post(`/autofill/items/${kind}/${encodeURIComponent(id)}/retry`);
  return data;
}

// Tally's number over a different value staff typed: { result, reason, summary }
export async function overwriteAutofill(kind, id) {
  const { data } = await api.post(`/autofill/items/${kind}/${encodeURIComponent(id)}/overwrite`);
  return data;
}
