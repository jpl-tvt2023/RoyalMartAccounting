import api from './axios';

// When the Connector syncs: { office_days, office_start, office_end,
// light_every_minutes, heavy_after, backfill_in_office_hours, updated_at,
// updated_by_name }. Every role reads it; Admin/Owner change it.
export async function getSyncSchedule() {
  const { data } = await api.get('/settings/sync');
  return data;
}

export async function updateSyncSchedule(body) {
  const { data } = await api.put('/settings/sync', body);
  return data;
}
