import api from './axios';

// Every role: { sync_from, connector, companies } -- the Connector's last
// heartbeat and where each company with sync on stands.
export async function getSyncStatus() {
  const { data } = await api.get('/sync/status');
  return data;
}

// The sync runs, newest first: { rows, total, page, page_size, waiting }.
export async function getSyncRuns(params) {
  const { data } = await api.get('/sync/runs', { params });
  return data;
}

// "Sync now" (sync.run): the Connector runs a light sync at its next check-in.
export async function syncNow(companyId = null) {
  const { data } = await api.post('/sync/now', companyId ? { company_id: companyId } : {});
  return data;
}
