import { describe, test, expect, vi, beforeEach } from 'vitest';
import { screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import MatchReview from '../MatchReview';
import { renderWithProviders, ACCOUNTANT, VIEWER } from '../../../test/renderWithProviders';
import toast from 'react-hot-toast';
import * as api from '../../../api/matching.api';

vi.mock('../../../api/matching.api', () => ({
  getMatchingSummary: vi.fn(), listResults: vi.fn(), getResult: vi.fn(), decide: vi.fn(), searchVouchers: vi.fn(), runMatching: vi.fn(),
}));
vi.mock('../../../api/audit.api', () => ({ getEntityHistory: vi.fn().mockResolvedValue([]) }));
vi.mock('../../../api/autofill.api', () => ({
  getAutofillSummary: vi.fn().mockResolvedValue({ fields: { po: { mode: 'approve' }, rtv: { mode: 'off' } } }),
  overwriteAutofill: vi.fn(),
}));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

const SUMMARY = {
  counts: { po: { linked: 687, review: 3, waiting: 118, not_matched: 42 }, rtv: { linked: 96, review: 18, waiting: 100, not_matched: 14 } },
  reasons: { po: { bill_differs: 2, several_invoices: 1, not_invoiced: 115 }, rtv: { several_cns: 18 } },
  methods: { po: { order_no: 600 }, rtv: { agst_ref: 96 } },
  fills: { po: {}, rtv: {} },
  notes: {},
  last_run: { id: 9, trigger: 'connector', status: 'ok', started_at: '2026-10-05 10:00:00', finished_at: '2026-10-05 10:00:03' },
  roms: { connected: true, last_ok_at: '2026-10-05 10:00:01', last_error: null },
  vendors: ['Blinkit', 'Scootsy', 'Zepto'],
  companies: [{ id: 1, code: 'MH', name: 'Roymax MH' }],
};

const S292 = {
  kind: 'po', id: 'S292', po_id: 'S292', outcome: 'review', reason: 'bill_differs', method: 'order_no', vendor: 'Scootsy',
  company_id: null, company: null, voucher_guid: null, voucher_number: null, voucher_date: null, fill: null,
  params: { typed: '1819', number: '1219/RM/26-27', company: 'MH' }, notes: [], person: null, candidate_count: 2,
  po: { vendor_po_id: 'ETPPO99340', bill_no: '1819', bill_date: null, po_date: '2026-07-20' }, rtv: null,
};
const B002 = {
  ...S292, id: 'B002', po_id: 'B002', outcome: 'linked', reason: null, vendor: 'Blinkit', company_id: 1, company: 'MH',
  voucher_guid: 'g-607', voucher_number: '607/RM/26-27', voucher_date: '2026-07-01', params: {}, notes: ['date'],
  fill: { field: 'bill_no', current: '607', value: '607/RM/26-27', kind: 'replace' },
  autofill: { state: 'checked', write_kind: 'replace', reason: null, dry: true, written_at: null },
  po: { vendor_po_id: 'P4588464', bill_no: '607', po_date: '2026-06-28' },
};
const DETAIL = {
  ...S292,
  how: [{ code: 'order_no', params: { value: 'ETPPO99340', count: 1 } }],
  checks: [],
  candidates: [
    { company_id: 1, company: 'MH', guid: 'g-1219', number: '1219/RM/26-27', date: '2026-07-22', party: 'PJTJ', total_paise: 1234500, via: ['order_no'] },
    { company_id: 1, company: 'MH', guid: 'g-1819', number: '1819/RM/26-27', date: '2026-09-02', party: 'PJTJ', total_paise: 99900, via: ['bill_serial'] },
  ],
  lines: [{ line_no: 1, item_code: '10192283', sku_code: 'WB003', qty: 10 }],
  rtv_rows: [],
  decisions: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  api.getMatchingSummary.mockResolvedValue(SUMMARY);
  api.listResults.mockImplementation(async (params) => (params.outcome === 'linked'
    ? { rows: [B002], total: 1, page: 1, page_size: 25 }
    : { rows: [S292], total: 1, page: 1, page_size: 25 }));
  api.getResult.mockResolvedValue(DETAIL);
});

describe('Match review', () => {
  test('opens on Needs review, explains each row, and a tile switches the list', async () => {
    renderWithProviders(<MatchReview />, { user: ACCOUNTANT });
    expect(await screen.findByText(/isn't a way of writing invoice 1219\/RM\/26-27 \(MH\)/)).toBeInTheDocument();
    expect(api.listResults).toHaveBeenCalledWith(expect.objectContaining({ kind: 'po', outcome: 'review' }));
    expect(screen.getByText('687')).toBeInTheDocument();
    expect(screen.getByText(/ROMS read/)).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /687 Linked/ }));
    expect(await screen.findByText('Bill No: 607 → 607/RM/26-27')).toBeInTheDocument();
    expect(screen.getByText('Waiting for approval')).toBeInTheDocument();
    expect(screen.getByText('Note: Date')).toBeInTheDocument();
    expect(api.listResults).toHaveBeenLastCalledWith(expect.objectContaining({ outcome: 'linked' }));
  });

  test('a row opens the explanation; "Use this invoice" asks first, then links it', async () => {
    api.decide.mockResolvedValue({ ...S292, outcome: 'linked', method: 'person', voucher_guid: 'g-1819', voucher_number: '1819/RM/26-27', person: { by: 'Asha' } });
    renderWithProviders(<MatchReview />, { user: ACCOUNTANT });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'S292' }));
    const panel = await screen.findByRole('dialog', { name: 'PO S292' });
    expect(within(panel).getByText(/The Tally invoice's Buyer's Order No matches this PO's number “ETPPO99340”/)).toBeInTheDocument();

    const rows = within(panel).getAllByRole('row');
    const second = rows.find((r) => within(r).queryByText('1819/RM/26-27'));
    await user.click(within(second).getByRole('button', { name: 'Use this invoice' }));
    const confirm = screen.getByRole('dialog', { name: 'Use this invoice' });
    expect(within(confirm).getByText(/RAMS keeps this link, whatever the rules say later/)).toBeInTheDocument();
    await user.click(within(confirm).getByRole('button', { name: 'Use this invoice' }));
    expect(api.decide).toHaveBeenCalledWith('po', 'S292', 'pick', { company_id: 1, voucher_guid: 'g-1819' });
    await waitFor(() => expect(api.getMatchingSummary).toHaveBeenCalledTimes(2));
  });

  test('a Viewer reads, but sees no Match now and no decisions', async () => {
    renderWithProviders(<MatchReview />, { user: VIEWER });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'S292' }));
    const panel = await screen.findByRole('dialog', { name: 'PO S292' });
    await within(panel).findByText('1219/RM/26-27');
    expect(within(panel).queryByRole('button', { name: /Use this invoice|Confirm|Reject/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Match now/ })).not.toBeInTheDocument();
  });

  test('Match now reads ROMS again and says what it found', async () => {
    api.runMatching.mockResolvedValue({ counts: { po: { linked: 690, review: 2 } }, roms: { ok: true }, summary: SUMMARY });
    renderWithProviders(<MatchReview />, { user: ACCOUNTANT });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /Match now/ }));
    expect(api.runMatching).toHaveBeenCalled();
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Matched: 690 linked, 2 need review'));
  });

  test('without ROMS connected it says so, in words an Admin can act on', async () => {
    api.getMatchingSummary.mockResolvedValue({ ...SUMMARY, roms: { connected: false, last_ok_at: null } });
    renderWithProviders(<MatchReview />, { user: ACCOUNTANT });
    expect(await screen.findByText(/ROMS isn't connected yet/)).toBeInTheDocument();
  });
});
