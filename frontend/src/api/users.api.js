import api from './axios';

// Admin/Owner only. Users are deactivated, never deleted.
export async function listUsers() {
  const { data } = await api.get('/users');
  return data;
}

export async function createUser(body) {
  const { data } = await api.post('/users', body);
  return data;
}

export async function updateUser(id, body) {
  const { data } = await api.put(`/users/${id}`, body);
  return data;
}

export async function deactivateUser(id) {
  const { data } = await api.post(`/users/${id}/deactivate`);
  return data;
}

export async function reactivateUser(id) {
  const { data } = await api.post(`/users/${id}/reactivate`);
  return data;
}

export async function resetUserPassword(id, newPassword) {
  const { data } = await api.post(`/users/${id}/reset-password`, { newPassword });
  return data;
}
