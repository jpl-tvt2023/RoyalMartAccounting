import axios from 'axios';

// The single axios instance (copied from ROMS). Falls back to the same-origin
// '/api' proxy (vite.config.js locally, vercel.json when deployed) unless
// VITE_API_BASE_URL points this deployment at a separate backend.
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '/api';

const api = axios.create({
  baseURL: API_BASE_URL,
  withCredentials: true,
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('accessToken');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// Endpoints that establish or renew the session themselves. A 401 from one of
// these IS the answer ("wrong password", "your session is gone"), not a stale
// access token, so it is never run back through /auth/refresh.
const AUTH_ENDPOINTS = ['/auth/login', '/auth/refresh', '/auth/change-password'];
const isAuthEndpoint = (url = '') => AUTH_ENDPOINTS.some((path) => url.includes(path));

// The session is unrecoverable: drop both halves of it and go to sign-in.
// Never reload the sign-in page itself -- that wipes the toast explaining why.
function endSession() {
  localStorage.removeItem('accessToken');
  localStorage.removeItem('user');
  if (window.location.pathname !== '/login') window.location.href = '/login';
}

let isRefreshing = false;
let failedQueue = [];

function processQueue(error, token = null) {
  failedQueue.forEach(({ resolve, reject }) => (error ? reject(error) : resolve(token)));
  failedQueue = [];
}

api.interceptors.response.use(
  (res) => res,
  async (error) => {
    const original = error.config;

    // The API holds a user with a first or reset password to the change
    // (403 PASSWORD_CHANGE_REQUIRED) -- send them to it.
    if (error.response?.status === 403 && error.response.data?.code === 'PASSWORD_CHANGE_REQUIRED') {
      if (window.location.pathname !== '/force-reset') window.location.href = '/force-reset';
      return Promise.reject(error);
    }

    if (
      !original ||
      error.response?.status !== 401 ||
      isAuthEndpoint(original.url) ||
      original._retry
    ) {
      return Promise.reject(error);
    }

    original._retry = true;

    // Single-flight: ten concurrent 401s produce one refresh, then replay.
    if (isRefreshing) {
      return new Promise((resolve, reject) => {
        failedQueue.push({ resolve, reject });
      }).then((token) => {
        original.headers.Authorization = `Bearer ${token}`;
        return api(original);
      });
    }

    isRefreshing = true;
    try {
      // Raw axios, not `api`, so the refresh cannot recurse through this interceptor.
      const { data } = await axios.post(`${API_BASE_URL}/auth/refresh`, {}, { withCredentials: true });
      localStorage.setItem('accessToken', data.accessToken);
      if (data.user) localStorage.setItem('user', JSON.stringify(data.user));
      processQueue(null, data.accessToken);
      original.headers.Authorization = `Bearer ${data.accessToken}`;
      return api(original);
    } catch (err) {
      processQueue(err, null);
      endSession();
      return Promise.reject(err);
    } finally {
      isRefreshing = false;
    }
  },
);

export default api;
