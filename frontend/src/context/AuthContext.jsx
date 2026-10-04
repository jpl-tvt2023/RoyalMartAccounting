import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { login as apiLogin, logout as apiLogout, me as apiMe } from '../api/auth.api';

// (Adapted from ROMS.) The access token and the user live in localStorage; the
// refresh token is an httpOnly cookie the browser holds.
const AuthContext = createContext(null);

const store = (accessToken, user) => {
  if (accessToken) localStorage.setItem('accessToken', accessToken);
  localStorage.setItem('user', JSON.stringify(user));
};

// The session left from a previous visit, read synchronously on first render.
function storedUser() {
  const stored = localStorage.getItem('user');
  if (!stored || !localStorage.getItem('accessToken')) return null;
  try { return JSON.parse(stored); } catch { localStorage.clear(); return null; }
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(storedUser);
  // The session is read synchronously, so there is nothing to wait for. Kept
  // in the context so ProtectedRoute's spinner has a hook if that changes.
  const loading = false;

  useEffect(() => {
    if (!storedUser()) return;
    // Re-read the user in the background, so a role change or a forced
    // password change made since the last visit shows without a new sign-in.
    apiMe()
      .then((fresh) => { localStorage.setItem('user', JSON.stringify(fresh)); setUser(fresh); })
      .catch(() => { /* the axios interceptor ends a dead session */ });
  }, []);

  const login = useCallback(async (username, password) => {
    const data = await apiLogin(username, password);
    // Guard against storing `undefined`: the string "undefined" is truthy in
    // the request interceptor and would 401-loop every later call.
    if (!data?.accessToken) throw new Error('Sign-in failed — unexpected response from the server.');
    store(data.accessToken, data.user);
    setUser(data.user);
    return data.user;
  }, []);

  // After change-password: the old sessions are gone, this one carries on.
  const applySession = useCallback(({ accessToken, user: next }) => {
    store(accessToken, next);
    setUser(next);
  }, []);

  const logout = useCallback(async () => {
    try { await apiLogout(); } catch { /* signing out anyway */ }
    localStorage.removeItem('accessToken');
    localStorage.removeItem('user');
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, applySession }}>
      {children}
    </AuthContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  return useContext(AuthContext);
}
