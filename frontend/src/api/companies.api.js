import api from './axios';

// Every Tally company the Connector has seen. Companies are created in Tally;
// RAMS only chooses which ones to sync.
export async function listCompanies() {
  const { data } = await api.get('/companies');
  return data;
}

// Admin/Owner: { sync_enabled?, code? }.
export async function updateCompany(id, body) {
  const { data } = await api.patch(`/companies/${id}`, body);
  return data;
}
