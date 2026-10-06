import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider, AuthContext, canDo } from '../context/AuthContext';

// Wraps a component in the auth context and a router at `route`. With `user`,
// renders as that user (roles, permissions) without touching the API.
export function renderWithProviders(ui, { route = '/', user } = {}) {
  if (user) {
    const value = {
      user, loading: false, can: (key) => canDo(user, key), login: async () => user, logout: async () => {}, applySession: () => {},
    };
    return render(
      <AuthContext.Provider value={value}>
        <MemoryRouter initialEntries={[route]}>{ui}</MemoryRouter>
      </AuthContext.Provider>,
    );
  }
  return render(
    <AuthProvider>
      <MemoryRouter initialEntries={[route]}>{ui}</MemoryRouter>
    </AuthProvider>,
  );
}

// Users as the API describes them, with the default permissions.
export const ADMIN = { id: 1, name: 'Keshav', username: 'admin', roles: ['Admin'], permissions: [] };
export const ACCOUNTANT = {
  id: 3, name: 'Asha', username: 'asha', roles: ['Accountant'],
  permissions: ['matching.view', 'matching.run', 'matching.review', 'matching.rules', 'matching.parties', 'autofill.view', 'autofill.approve',
    'reports.view', 'reports.settings', 'sync.run'],
};
export const VIEWER = {
  id: 4, name: 'Vik', username: 'vik', roles: ['Viewer'], permissions: ['matching.view', 'autofill.view', 'reports.view'],
};
