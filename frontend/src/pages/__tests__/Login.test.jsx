import { describe, test, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Routes, Route } from 'react-router-dom';
import Login from '../Login';
import { renderWithProviders } from '../../test/renderWithProviders';
import * as authApi from '../../api/auth.api';

vi.mock('../../api/auth.api', () => ({
  login: vi.fn(),
  logout: vi.fn(),
  me: vi.fn(),
}));

const renderLogin = () => renderWithProviders(
  <Routes>
    <Route path="/login" element={<Login />} />
    <Route path="/dashboard" element={<p>dashboard page</p>} />
    <Route path="/force-reset" element={<p>set-password page</p>} />
  </Routes>,
  { route: '/login' },
);

async function signIn(username, password) {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText(/user id/i), username);
  await user.type(screen.getByLabelText(/^password$/i), password);
  await user.click(screen.getByRole('button', { name: /sign in/i }));
}

describe('Login page', () => {
  beforeEach(() => vi.clearAllMocks());

  test('shows the RAMS mark, the User ID and password fields, and Sign In', () => {
    renderLogin();
    expect(screen.getByText('RAMS')).toBeInTheDocument();
    expect(screen.getByLabelText(/user id/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^password$/i)).toHaveAttribute('type', 'password');
    expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument();
  });

  test('the eye button shows and hides the password', async () => {
    renderLogin();
    await userEvent.setup().click(screen.getByRole('button', { name: /show password/i }));
    expect(screen.getByLabelText(/^password$/i)).toHaveAttribute('type', 'text');
  });

  test('signs in, stores the session and goes to the dashboard', async () => {
    authApi.login.mockResolvedValue({ accessToken: 'tok', user: { id: 1, name: 'A', roles: ['Admin'], is_first_login: false } });
    renderLogin();
    await signIn('Admin', 'Secret#1');
    expect(authApi.login).toHaveBeenCalledWith('admin', 'Secret#1');
    expect(await screen.findByText('dashboard page')).toBeInTheDocument();
    expect(localStorage.getItem('accessToken')).toBe('tok');
  });

  test('a first sign-in goes to set a password instead', async () => {
    authApi.login.mockResolvedValue({ accessToken: 'tok', user: { id: 2, name: 'B', roles: ['Viewer'], is_first_login: true } });
    renderLogin();
    await signIn('newbie', 'First#Pass1');
    expect(await screen.findByText('set-password page')).toBeInTheDocument();
  });
});
