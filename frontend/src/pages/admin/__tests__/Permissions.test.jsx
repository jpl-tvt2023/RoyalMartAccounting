import { describe, test, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Permissions from '../Permissions';
import { renderWithProviders, ADMIN } from '../../../test/renderWithProviders';
import * as settingsApi from '../../../api/settings.api';

vi.mock('../../../api/settings.api', () => ({ getPermissions: vi.fn(), updatePermissions: vi.fn() }));
vi.mock('../../../api/audit.api', () => ({ getEntityHistory: vi.fn().mockResolvedValue([]) }));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

const CATALOG = [
  { key: 'matching.view', area: 'Matching', label: 'See matching', description: 'Match review and the rest' },
  { key: 'matching.rules', area: 'Matching', label: 'Change matching rules', description: 'How POs are matched' },
  { key: 'sync.schedule', area: 'Tally sync', label: 'Change the sync schedule', description: 'Office hours' },
];
const VIEW = {
  catalog: CATALOG, roles: ['Accountant', 'Viewer'],
  matrix: { Accountant: ['matching.view', 'matching.rules'], Viewer: ['matching.view'] },
  updated_at: null, updated_by_name: null,
};

describe('Roles & permissions', () => {
  beforeEach(() => { vi.clearAllMocks(); settingsApi.getPermissions.mockResolvedValue(VIEW); });

  test('Admin and Owner are always ticked and locked; ticking a box and saving sends the new matrix', async () => {
    settingsApi.updatePermissions.mockImplementation(async (roles) => ({ ...VIEW, matrix: roles, updated_at: '2026-10-05 12:00:00', updated_by_name: 'Keshav' }));
    renderWithProviders(<Permissions />, { user: ADMIN });
    expect(await screen.findByText('Change the sync schedule')).toBeInTheDocument();
    expect(screen.getByLabelText('Admin: See matching (always)')).toBeDisabled();
    expect(screen.getByLabelText('Owner: Change the sync schedule (always)')).toBeChecked();
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();

    const user = userEvent.setup();
    await user.click(screen.getByLabelText('Accountant: Change the sync schedule'));
    await user.click(screen.getByLabelText('Viewer: See matching'));
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(settingsApi.updatePermissions).toHaveBeenCalledWith({
      Accountant: ['matching.view', 'matching.rules', 'sync.schedule'],
      Viewer: [],
    });
    expect(await screen.findByText(/Last changed .* by Keshav/)).toBeInTheDocument();
  });
});
