import api from './axios';

// The whole log (Admin/Owner): { rows, total, page, page_size }. params use
// snake_case keys: user_id, action_type, entity_type, date_from, date_to, q,
// page, page_size.
export async function listAuditLogs(params) {
  const { data } = await api.get('/audit-logs', { params });
  return data;
}

// The values the Audit Log filters offer: { action_types, entity_types, users }.
export async function getAuditFacets() {
  const { data } = await api.get('/audit-logs/facets');
  return data;
}

// One record's history, newest first.
export async function getEntityHistory(entityType, entityId) {
  const { data } = await api.get('/audit-logs/entity', {
    params: { entity_type: entityType, entity_id: entityId },
  });
  return data;
}
