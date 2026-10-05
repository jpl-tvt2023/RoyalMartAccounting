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

// Admin -> Roles & permissions (Admin/Owner): { catalog, roles, matrix,
// updated_at, updated_by_name }. matrix is { Accountant: [keys], Viewer: [keys] }.
export async function getPermissions() {
  const { data } = await api.get('/settings/permissions');
  return data;
}

export async function updatePermissions(roles) {
  const { data } = await api.put('/settings/permissions', { roles });
  return data;
}
