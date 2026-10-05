import { describe, test, expect, vi, beforeEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SyncSchedulePanel from '../SyncSchedulePanel';
import { renderWithProviders, ADMIN } from '../../../test/renderWithProviders';
import * as settingsApi from '../../../api/settings.api';
import { describeDays } from '../../../utils/syncSchedule';

vi.mock('../../../api/settings.api', () => ({ getSyncSchedule: vi.fn(), updateSyncSchedule: vi.fn() }));
vi.mock('../../../api/audit.api', () => ({ getEntityHistory: vi.fn().mockResolvedValue([]) }));

const AGREED = {
  office_days: [1, 2, 3, 4, 5, 6], office_start: '09:00', office_end: '20:00', light_every_minutes: 60,
  heavy_after: '19:30', backfill_in_office_hours: false, updated_at: null, updated_by_name: null,
};

describe('Sync schedule panel', () => {
  beforeEach(() => vi.clearAllMocks());

  test('shows the schedule in force', async () => {
    settingsApi.getSyncSchedule.mockResolvedValue(AGREED);
    renderWithProviders(<SyncSchedulePanel />, { user: ADMIN });
    expect(await screen.findByText('Mon–Sat, 09:00–20:00')).toBeInTheDocument();
    expect(screen.getByText('60 min')).toBeInTheDocument();
    expect(screen.getByText('19:30')).toBeInTheDocument();
    expect(screen.getByText('outside office hours')).toBeInTheDocument();
  });

  test('an Admin changes the days and times', async () => {
    settingsApi.getSyncSchedule.mockResolvedValue(AGREED);
    settingsApi.updateSyncSchedule.mockImplementation(async (body) => ({ ...AGREED, ...body, updated_at: '2026-10-05 15:00:00', updated_by_name: 'Keshav' }));
    renderWithProviders(<SyncSchedulePanel />, { user: ADMIN });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /edit/i }));
    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByLabelText('Sat'));
    const end = within(dialog).getByLabelText('to');
    await user.clear(end);
    await user.type(end, '18:30');
    const every = within(dialog).getByLabelText(/light sync every/i);
    await user.clear(every);
    await user.type(every, '30');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));

    expect(settingsApi.updateSyncSchedule).toHaveBeenCalledWith(expect.objectContaining({
      office_days: [1, 2, 3, 4, 5], office_end: '18:30', light_every_minutes: 30,
    }));
    expect(await screen.findByText('Mon–Fri, 09:00–18:30')).toBeInTheDocument();
    expect(screen.getByText(/by Keshav/)).toBeInTheDocument();
  });

  test('days read the way people say them', () => {
    expect(describeDays([0, 1, 2, 3, 4, 5, 6])).toBe('Every day');
    expect(describeDays([1, 2, 3, 4, 5, 6])).toBe('Mon–Sat');
    expect(describeDays([1, 3, 5])).toBe('Mon, Wed, Fri');
    expect(describeDays([6, 0])).toBe('Sat, Sun');
  });
});
