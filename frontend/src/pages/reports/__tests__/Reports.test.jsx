import { describe, test, expect, vi, beforeEach } from 'vitest';
import { screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Invoices from '../Invoices';
import Receivables from '../Receivables';
import Exceptions from '../Exceptions';
import SyncHealth from '../SyncHealth';
import { renderWithProviders, ACCOUNTANT, VIEWER } from '../../../test/renderWithProviders';
import toast from 'react-hot-toast';
import * as reports from '../../../api/reports.api';
import * as sync from '../../../api/sync.api';

vi.mock('../../../api/reports.api', () => ({
  getInvoices: vi.fn(), getNotes: vi.fn(), getTransfers: vi.fn(), getReceivables: vi.fn(), getExceptions: vi.fn(),
  getReportSettings: vi.fn(), updateReportSettings: vi.fn(), updateTerms: vi.fn(),
}));
vi.mock('../../../api/sync.api', () => ({ getSyncStatus: vi.fn(), getSyncRuns: vi.fn(), syncNow: vi.fn() }));
vi.mock('../../../api/audit.api', () => ({ getEntityHistory: vi.fn().mockResolvedValue([]) }));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

const COMPANIES = [{ id: 2, code: 'MH', name: 'Roymax MH' }];
const INVOICE = {
  guid: 'g607', company_id: 2, company: 'MH', number: '607/RM/26-27', date: '2026-07-01', party: 'BLINK COMMERCE PVT LTD(LUCKNOW L4)',
  vendor: 'Blinkit', vendor_from: 'po', pos: ['B002'], total_paise: 12988395, taxable_paise: 12369900, gst_paise: 618495, received_paise: 0,
  credit_notes_paise: 39800, tds_paise: 0, adjustments_paise: 0, outstanding_paise: 12948595, due_date: '2026-07-31', overdue_days: 67, status: 'overdue',
};
const row = (over) => ({
  vendor: 'Blinkit', company_id: 2, company: 'MH', invoices: 133, open_invoices: 120, invoiced_paise: 2769586900, received_paise: 0, credit_notes_paise: 231843300,
  tds_paise: 0, adjustments_paise: -26341600, outstanding_paise: 2537743600, overdue_paise: 2198604100, d0_30_paise: 0, d31_60_paise: 0, d61_90_paise: 0,
  d90_plus_paise: 2537743600, unallocated_paise: 0, net_outstanding_paise: 2537743600, ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  reports.getInvoices.mockResolvedValue({
    rows: [INVOICE], total: 1, page: 1, page_size: 50, companies: COMPANIES, vendors: ['Blinkit', 'Zepto'],
    totals: { invoices: 1, total_paise: 12988395, outstanding_paise: 12948595, overdue_paise: 12948595 },
  });
  reports.getReceivables.mockResolvedValue({
    rows: [row(), row({ vendor: null, invoices: 55, unallocated_paise: 1707771600, net_outstanding_paise: 2537743600 - 1707771600 })],
    totals: row({ vendor: null }),
    buckets: [{ key: 'd0_30', label: '0–30 days' }, { key: 'd31_60', label: '31–60 days' }, { key: 'd61_90', label: '61–90 days' }, { key: 'd90_plus', label: '90+ days' }],
    as_of: '2026-10-06',
    companies: COMPANIES,
  });
  reports.getReportSettings.mockResolvedValue({
    settings: { default_credit_days: 30, exception_days: 15 },
    terms: [{ vendor: 'Blinkit', credit_days: null }, { vendor: 'Scootsy', credit_days: 5 }],
  });
});

describe('Invoices', () => {
  test('each invoice with its PO, what settled it and what is owed; the tabs filter', async () => {
    renderWithProviders(<Invoices />, { user: VIEWER });
    expect(await screen.findByText('607/RM/26-27')).toBeInTheDocument();
    expect(screen.getByText('B002')).toBeInTheDocument();
    expect(screen.getAllByText('₹1,29,485.95').length).toBeGreaterThan(0);
    expect(screen.getByText('67 days past 31 Jul 2026')).toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(screen.getByRole('tab', { name: 'No PO' }));
    await waitFor(() => expect(reports.getInvoices).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'no_po', page: 1 })));
  });
});

describe('Receivables', () => {
  test('per marketplace, with money received on account and net outstanding', async () => {
    renderWithProviders(<Receivables />, { user: VIEWER });
    expect(await screen.findByText('Not known')).toBeInTheDocument();
    expect(screen.getAllByText('₹1,70,77,716').length).toBeGreaterThan(0);
    expect(await screen.findByLabelText('Scootsy credit days')).toBeDisabled();
  });

  test('an Accountant sets a marketplace\'s credit days; empty means the default', async () => {
    reports.updateTerms.mockResolvedValue({ settings: { default_credit_days: 30, exception_days: 15 }, terms: [{ vendor: 'Blinkit', credit_days: 20 }, { vendor: 'Scootsy', credit_days: 5 }] });
    renderWithProviders(<Receivables />, { user: ACCOUNTANT });
    const user = userEvent.setup();
    const blinkit = await screen.findByLabelText('Blinkit credit days');
    await user.type(blinkit, '20');
    await user.tab();
    expect(reports.updateTerms).toHaveBeenCalledWith('Blinkit', 20);
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Blinkit: 20 days'));
  });
});

describe('Exceptions', () => {
  test('each kind with its count; opening one lists them and says where to fix it', async () => {
    reports.getExceptions.mockResolvedValue({
      exception_days: 15, as_of: '2026-10-06', companies: COMPANIES,
      categories: [
        { code: 'bill_not_in_tally', count: 0, rows: [] },
        { code: 'invoice_no_po', count: 1, rows: [{ company: 'MH', number: '6', date: '2026-07-02', party: 'ROYMAX', vendor: null, total_paise: 98983, age_days: 96 }] },
        { code: 'conflict', count: 1, rows: [{ kind: 'po', id: 'S292', po_id: 'S292', reason: 'autofill_differs', params: { typed: '1819', number: '1219/RM/26-27' } }] },
        { code: 'ambiguous', count: 0, rows: [] },
        { code: 'rtv_no_cn', count: 0, rows: [] },
        { code: 'autofill_refused', count: 0, rows: [] },
      ],
    });
    renderWithProviders(<Exceptions />, { user: VIEWER });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /ROMS and Tally disagree/ }));
    expect(screen.getByText(/ROMS has 1819, Tally says 1219\/RM\/26-27/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open Match review' })).toHaveAttribute('href', '/matching');
    expect(screen.getByRole('button', { name: /Bill No or CN No in ROMS, not found in Tally/ })).toBeDisabled();
  });
});

describe('Sync health', () => {
  const STATUS = {
    sync_from: '2026-06-08',
    connector: {
      name: 'Office PC', version: '0.5.0', last_seen_at: '2026-10-06 15:00:00', online: true, tally: { reachable: true, educational: false }, activity: { state: 'idle' }, last_error: null,
    },
    companies: [{
      id: 2, name: 'Roymax MH', code: 'MH', vouchers: 3775, loaded_in_tally: true, pending: false, sync: { backfillDone: true },
      last_run: { kind: 'heavy', status: 'ok', started_at: '2026-10-06 13:45:28', finished_at: '2026-10-06 13:45:55', errors: [] },
    }],
  };

  beforeEach(() => {
    sync.getSyncStatus.mockResolvedValue(STATUS);
    sync.getSyncRuns.mockResolvedValue({
      rows: [{ id: 5, company: 'MH', kind: 'heavy', status: 'ok', started_at: '2026-10-06 13:45:28', vouchers_upserted: 0, vouchers_deleted: 0, errors: [] }], total: 1, waiting: [],
    });
  });

  test('Sync now asks the Connector, for whoever holds "Sync now"', async () => {
    sync.syncNow.mockResolvedValue({ requested: [2], message: 'The Connector syncs MH at its next check-in (within a minute or two)' });
    renderWithProviders(<SyncHealth />, { user: ACCOUNTANT });
    expect(await screen.findByText('Connector online')).toBeInTheDocument();
    const user = userEvent.setup();
    const mh = screen.getAllByRole('row').find((r) => within(r).queryByText('Roymax MH'));
    await user.click(within(mh).getByRole('button', { name: /Sync now/ }));
    expect(sync.syncNow).toHaveBeenCalledWith(2);
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('The Connector syncs MH at its next check-in (within a minute or two)'));
  });

  test('a Viewer sees it but cannot Sync now', async () => {
    renderWithProviders(<SyncHealth />, { user: VIEWER });
    expect(await screen.findByText('Up to date')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Sync now/ })).not.toBeInTheDocument();
  });
});
