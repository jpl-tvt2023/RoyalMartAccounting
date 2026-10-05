import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import TallySyncCard from '../TallySyncCard';
import * as syncApi from '../../../api/sync.api';

vi.mock('../../../api/sync.api', () => ({ getSyncStatus: vi.fn() }));

const company = (overrides = {}) => ({
  id: 1, name: 'Roymax Products LLP ( Maharashtra )', code: 'MH', state_name: 'Maharashtra', gstin: '27ABGFR0562B1ZI',
  vouchers: 3774, loaded_in_tally: true, pending: false,
  sync: {
    altVchId: 56845, altMstId: 25247, backfillThrough: '2027-03-31', backfillDone: true, needsResync: false,
    lastLightAt: '2026-10-05 10:00:00', lastHeavyAt: '2026-10-04 14:30:00', lastCheckedAt: '2026-10-05 10:05:00',
  },
  last_run: { kind: 'light', status: 'ok', errors: [] },
  ...overrides,
});

const renderCard = (props) => render(<MemoryRouter><TallySyncCard {...props} /></MemoryRouter>);

describe('TallySyncCard', () => {
  beforeEach(() => vi.clearAllMocks());

  test('shows the Connector online, Tally answering, the Educational-mode warning and each company', async () => {
    syncApi.getSyncStatus.mockResolvedValue({
      sync_from: '2026-06-08',
      connector: {
        name: 'Dev PC', version: '0.2.0', last_seen_at: '2026-10-05 10:05:00', online: true,
        tally: { reachable: true, educational: true }, activity: { state: 'idle' }, last_error: null,
      },
      companies: [
        company(),
        company({ id: 2, code: 'HR', name: 'ROYMAX PRODUCTS LLP ( HARYANA )', vouchers: 26, pending: true }),
        company({
          id: 3, code: 'WB', name: 'ROYMAX PRODUCTS LLP ( WEST BENGAL )', vouchers: 9, loaded_in_tally: false,
          sync: { ...company().sync, backfillDone: false, backfillThrough: '2026-06-30' },
          last_run: { kind: 'backfill', status: 'failed', errors: ['Tally stopped answering'] },
        }),
      ],
    });
    renderCard({ isAdmin: true });

    expect(await screen.findByText('Connector online')).toBeInTheDocument();
    expect(screen.getByText('Tally is answering.')).toBeInTheDocument();
    expect(screen.getByText(/Educational mode/)).toBeInTheDocument();
    expect(screen.getByText('3,774')).toBeInTheDocument();
    expect(screen.getByText('Up to date')).toBeInTheDocument();
    expect(screen.getByText('Changes waiting in Tally')).toBeInTheDocument();
    expect(screen.getByText('Backfilling — done through 30 Jun 2026')).toBeInTheDocument();
    expect(screen.getByText('Not loaded in Tally')).toBeInTheDocument();
    expect(screen.getByText('Last run failed: Tally stopped answering')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Tally companies' })).toHaveAttribute('href', '/admin/companies');
  });

  test('an offline Connector, and no company synced yet', async () => {
    syncApi.getSyncStatus.mockResolvedValue({
      sync_from: '2026-06-08',
      connector: { name: 'Office PC', version: '0.2.0', last_seen_at: '2026-10-05 08:00:00', online: false, tally: null, activity: null },
      companies: [],
    });
    renderCard({ isAdmin: false });
    expect(await screen.findByText('Connector offline')).toBeInTheDocument();
    expect(screen.getByText(/No company is being synced yet/)).toBeInTheDocument();
    expect(screen.getByText(/An Admin or Owner chooses/)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Tally companies' })).toBeNull();
  });

  test('before any Connector has reported', async () => {
    syncApi.getSyncStatus.mockResolvedValue({ sync_from: '2026-06-08', connector: null, companies: [] });
    renderCard({ isAdmin: true });
    expect(await screen.findByText('No Connector has reported yet.')).toBeInTheDocument();
  });
});
