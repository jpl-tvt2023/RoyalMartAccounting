import { describe, test, expect, vi, beforeEach } from 'vitest';
import { screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import MatchingRules from '../MatchingRules';
import PartyLedgers from '../PartyLedgers';
import { renderWithProviders, ACCOUNTANT, VIEWER } from '../../../test/renderWithProviders';
import * as api from '../../../api/matching.api';

vi.mock('../../../api/matching.api', () => ({
  getMatchSettings: vi.fn(), updateMatchSettings: vi.fn(), resetMatchSettings: vi.fn(), previewMatchSettings: vi.fn(),
  getMatchingSummary: vi.fn(), listVendors: vi.fn(), updateVendor: vi.fn(), listVoucherTypes: vi.fn(),
  listPartyLedgers: vi.fn(), updatePartyLedger: vi.fn(), acceptSuggestions: vi.fn(),
}));
vi.mock('../../../api/audit.api', () => ({ getEntityHistory: vi.fn().mockResolvedValue([]) }));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

const RECOMMENDED = {
  use_order_no: true, order_no_drop_label: true, order_no_split: true, use_bill_no: true, bill_no_serial: true,
  number_strength: 'compact', pick_same_date: true, pick_same_fy: true, bill_only_links: 'linked',
  check_party: 'review', check_sku: 'review', check_qty: 'note', qty_tolerance_pct: 0, check_date: 'note', date_tolerance_days: 0,
  check_split: 'note', check_reused: 'review', cn_agst_ref: true, cn_number: true, grace_days: 7, excluded_voucher_types: [], run_every_minutes: 60,
};
const SUMMARY = {
  counts: { po: { linked: 687, review: 3, waiting: 118, not_matched: 42 }, rtv: { linked: 96, review: 18, waiting: 100, not_matched: 14 } },
  reasons: { po: { bill_differs: 2 }, rtv: {} },
  methods: { po: { order_no: 609, order_no_label: 61, bill_serial: 11 }, rtv: { agst_ref: 96 } },
  fills: { po: {}, rtv: {} },
  notes: { date: 9, qty: 3, split: 6 },
  last_run: null,
  roms: { connected: true },
  vendors: [],
  companies: [{ id: 1, code: 'MH', name: 'Roymax MH' }],
};

beforeEach(() => {
  vi.clearAllMocks();
  api.getMatchSettings.mockResolvedValue({ settings: { ...RECOMMENDED, updated_at: null, updated_by_name: null }, recommended: RECOMMENDED });
  api.getMatchingSummary.mockResolvedValue(SUMMARY);
  api.listVendors.mockResolvedValue([
    { vendor: 'Blinkit', mode: 'match', pos: 108, linked: 106 },
    { vendor: 'Flipkart', mode: 'transfer', pos: 26, linked: 0 },
  ]);
  api.listVoucherTypes.mockResolvedValue([
    { voucher_type: 'Sales', base_type: 'Sales', n: 868, excluded: false },
    { voucher_type: 'B2c Sales', base_type: 'Sales', n: 20, excluded: false },
  ]);
});

describe('Matching rules', () => {
  test('each rule says what it does and how many POs it decides now', async () => {
    renderWithProviders(<MatchingRules />, { user: VIEWER });
    expect(await screen.findByText('Match a PO by the Buyer’s Order No on the Tally invoice')).toBeInTheDocument();
    expect(screen.getByText(/Used for 609 now/)).toBeInTheDocument();
    expect(screen.getByText(/Zepto’s “P4588464- Dry” is read as P4588464/)).toBeInTheDocument();
    // Read-only without "Change matching rules".
    expect(screen.queryByRole('button', { name: /Edit/ })).not.toBeInTheDocument();
    expect(screen.getByLabelText('How Blinkit is matched')).toBeDisabled();
  });

  test('edit, preview the effect (nothing saved), then save and re-match', async () => {
    api.previewMatchSettings.mockResolvedValue({
      before: SUMMARY.counts, after: { ...SUMMARY.counts, po: { ...SUMMARY.counts.po, linked: 681, review: 9 } }, changed: 6,
      examples: [{ target_kind: 'po', target_id: 'S078', po_id: 'S078', vendor: 'Scootsy', from: { outcome: 'linked', reason: null }, to: { outcome: 'review', reason: 'check_split', voucher_number: '674/RM/26-27' } }],
    });
    api.updateMatchSettings.mockResolvedValue({ settings: { ...RECOMMENDED, check_split: 'review' }, recommended: RECOMMENDED, changed: 1 });
    renderWithProviders(<MatchingRules />, { user: ACCOUNTANT });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /Edit/ }));
    await user.selectOptions(screen.getByLabelText('The PO number is also on another invoice no other PO has'), 'review');
    expect(screen.getByText('1 change')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Preview the effect/ }));
    expect(api.previewMatchSettings).toHaveBeenCalledWith({ check_split: 'review' });
    const preview = await screen.findByRole('region', { name: 'Preview' });
    expect(within(preview).getByText('If you save: 6 rows would change status')).toBeInTheDocument();
    expect(within(preview).getByText(/Needs review \(PO on other invoices too\) → 674\/RM\/26-27/)).toBeInTheDocument();
    expect(api.updateMatchSettings).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Save and re-match' }));
    expect(api.updateMatchSettings).toHaveBeenCalledWith({ check_split: 'review' });
  });

  test('a voucher type can be left out, and a vendor set to stock transfer', async () => {
    api.updateVendor.mockResolvedValue({});
    renderWithProviders(<MatchingRules />, { user: ACCOUNTANT });
    const user = userEvent.setup();
    await user.selectOptions(await screen.findByLabelText('How Blinkit is matched'), 'transfer');
    expect(api.updateVendor).toHaveBeenCalledWith('Blinkit', 'transfer');

    await user.click(screen.getByRole('button', { name: /Edit/ }));
    await user.click(screen.getByRole('checkbox', { name: /B2c Sales/ }));
    await user.click(screen.getByRole('button', { name: /Preview the effect/ }));
    expect(api.previewMatchSettings).toHaveBeenCalledWith({ excluded_voucher_types: ['B2c Sales'] });
  });
});

describe('Party ledgers', () => {
  const LEDGERS = {
    rows: [
      { company_id: 1, company: 'MH', guid: 'L1', name: 'BLINK COMMERCE PVT LTD(BENGALURU B5)', gstin: '29AAICB1234C1Z5', vouchers: 24, kind: null, vendor: null, source: null, suggested_vendor: 'Blinkit', suggested_votes: 12 },
      { company_id: 1, company: 'MH', guid: 'L2', name: 'Roymax (Haryana)', gstin: '06ABGFR0562B1ZM', vouchers: 8, kind: 'internal', vendor: null, source: 'gstin', suggested_vendor: null, suggested_votes: 0 },
    ],
    total: 2, page: 1, page_size: 25, suggestions_waiting: 1,
  };

  beforeEach(() => {
    api.listPartyLedgers.mockResolvedValue(LEDGERS);
    api.listVendors.mockResolvedValue([{ vendor: 'Blinkit' }, { vendor: 'Zepto' }]);
  });

  test('accept every suggestion after a confirm, or map one ledger by hand', async () => {
    api.acceptSuggestions.mockResolvedValue({ accepted: 1 });
    api.updatePartyLedger.mockResolvedValue({});
    renderWithProviders(<PartyLedgers />, { user: ACCOUNTANT });
    expect(await screen.findByText('BLINK COMMERCE PVT LTD(BENGALURU B5)')).toBeInTheDocument();
    expect(screen.getByText('From GSTIN')).toBeInTheDocument();
    expect(screen.getByText('(12 POs)')).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /Accept all suggestions \(1\)/ }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Accept all' }));
    expect(api.acceptSuggestions).toHaveBeenCalledWith(null);

    await user.selectOptions(screen.getByLabelText('What BLINK COMMERCE PVT LTD(BENGALURU B5) is'), 'vendor:Zepto');
    expect(api.updatePartyLedger).toHaveBeenCalledWith(1, 'L1', { kind: 'vendor', vendor: 'Zepto' });
    await user.selectOptions(screen.getByLabelText('What Roymax (Haryana) is'), '');
    await waitFor(() => expect(api.updatePartyLedger).toHaveBeenLastCalledWith(1, 'L2', { kind: null }));
  });

  test('without "Map party ledgers" the mappings are read-only', async () => {
    renderWithProviders(<PartyLedgers />, { user: VIEWER });
    expect(await screen.findByLabelText('What BLINK COMMERCE PVT LTD(BENGALURU B5) is')).toBeDisabled();
    expect(screen.queryByRole('button', { name: /Accept all/ })).not.toBeInTheDocument();
  });
});
