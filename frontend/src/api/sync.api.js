import api from './axios';

// Every role: { sync_from, connector, companies } -- the Connector's last
// heartbeat and where each company with sync on stands.
export async function getSyncStatus() {
  const { data } = await api.get('/sync/status');
  return data;
}
