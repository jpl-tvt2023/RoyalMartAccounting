import api from './axios';

export async function login(username, password) {
  const { data } = await api.post('/auth/login', { username, password });
  return data; // { accessToken, user }
}

export async function me() {
  const { data } = await api.get('/auth/me');
  return data.user;
}

// { oldPassword?, newPassword } -> { message, accessToken, user }: the change
// ends every other session, and this one carries on with the returned token.
export async function changePassword(body) {
  const { data } = await api.post('/auth/change-password', body);
  return data;
}

export async function logout() {
  await api.post('/auth/logout');
}
