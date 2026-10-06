import { describe, test, expect, vi, beforeEach } from 'vitest';
import { screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AutoFill from '../AutoFill';
import { renderWithProviders, ADMIN, ACCOUNTANT, VIEWER } from '../../../test/renderWithProviders';
import toast from 'react-hot-toast';
import * as api from '../../../api/autofill.api';

vi.mock('../../../api/autofill.api', () => ({
  getAutofillSummary: vi.fn(), listAutofillItems: vi.fn(), listAutofillEvents: vi.fn(), updateAutofillSettings: vi.fn(),
  approveAutofill: vi.fn(), runAutofill: vi.fn(), retryAutofill: vi.fn(), overwriteAutofill: vi.fn(),
}));
vi.mock('../../../api/audit.api', () => ({ getEntityHistory: vi.fn().mockResolvedValue([]) }));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

const STATES = {
  to_check: 0, checked: 0, to_write: 0, refused: 0, differs: 0,
};
const field = (over) => ({
  mode: 'off', states: STATES, refused_in_preview: 0, written: 0, written_today: 0, already: 0, rejected: 0, due: { write: 0, check: 0 }, ...over,
});
const SUMMARY = {
  settings: {
    bill_mode: 'approve', cn_mode: 'off', replace_typed: true, bill_date_rule: 'tally', updated_at: null, updated_by_name: null,
  },
  recommended: {
    bill_mode: 'off', cn_mode: 'off', replace_typed: true, bill_date_rule: 'tally',
  },
  fields: {
    po: field({
      mode: 'approve', states: { ...STATES, checked: 2, refused: 1, differs: 1 }, written: 5, written_today: 2,
    }),
    rtv: field({ states: { ...STATES, to_check: 96 } }),
  },
  last_run: null,
  roms: { connected: true },
};
const item = (over) => ({
  kind: 'po', id: 'B002', po_id: 'B002', field: 'bill_no', write_kind: 'replace', expected: '607', expected_date: '2026-07-01',
  value: '607/RM/26-27', date: '2026-07-01', state: 'checked', reason: null, dry: true, company: 'MH', vendor: 'Blinkit',
  voucher_number: '607/RM/26-27', ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  api.getAutofillSummary.mockResolvedValue(SUMMARY);
  api.listAutofillItems.mockImplementation(async ({ state }) => {
    if (state === 'differs') return { rows: [item({ id: 'S292', po_id: 'S292', write_kind: 'differs', expected: '1819', value: '1219/RM/26-27', state: 'differs' })], total: 1 };
    if (state === 'refused') return { rows: [item({ id: 'S5', po_id: 'S5', state: 'refused', reason: 'Bill no "605/RM/26-27" is already used on PO Z9' })], total: 1 };
    return { rows: [item(), item({ id: 'B003', po_id: 'B003', expected: null, expected_date: null, write_kind: 'fill' })], total: 2 };
  });
  api.listAutofillEvents.mockResolvedValue({
    rows: [
      { id: 2, kind: 'po', po_id: 'B009', write_kind: 'replace', old_value: '779', new_value: '779/RM/26-27', old_date: '2026-07-02', new_date: '2026-07-02', result: 'applied', by: 'Asha', at: '2026-10-06 10:00:00' },
      { id: 1, kind: 'po', po_id: 'B010', write_kind: 'fill', old_value: null, new_value: '780/RM/26-27', old_date: null, new_date: '2026-07-02', result: 'applied', by: null, at: '2026-10-06 09:00:00' },
    ],
    total: 2,
  });
});

describe('Auto-fill', () => {
  test('each field shows its mode and counts; a Viewer reads but cannot switch, approve or write', async () => {
    renderWithProviders(<AutoFill />, { user: VIEWER });
    const bill = await screen.findByRole('region', { name: 'Bill No + Bill Date' });
    expect(within(bill).getByLabelText('Bill No + Bill Date auto-fill mode')).toHaveValue('approve');
    expect(within(bill).getByLabelText('Bill No + Bill Date auto-fill mode')).toBeDisabled();
    expect(within(bill).getByText('Like Preview, then a person approves and RAMS writes.')).toBeInTheDocument();
    expect(within(bill).getByText('Written (2 today)')).toBeInTheDocument();

    expect(await screen.findByText('607 → 607/RM/26-27')).toBeInTheDocument();
    expect(screen.getByText(/^blank → 607\/RM\/26-27 · date blank → /)).toBeInTheDocument();
    expect(screen.getAllByText('Waiting for approval — ROMS would accept')).toHaveLength(2);
    expect(api.listAutofillItems).toHaveBeenCalledWith(expect.objectContaining({ kind: 'po', state: 'to_check,checked,to_write' }));
    expect(screen.queryByRole('button', { name: /Approve/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Write now/ })).not.toBeInTheDocument();
  });

  test('Ask first: Approve all asks, then writes with progress until nothing is left', async () => {
    api.approveAutofill.mockResolvedValue({ approved: 2 });
    api.runAutofill
      .mockResolvedValueOnce({ ok: true, counts: { written: 1, already: 0, refused: 0, checked: 0 }, remaining: 1, more: true, summary: SUMMARY })
      .mockResolvedValueOnce({ ok: true, counts: { written: 1, already: 0, refused: 0, checked: 0 }, remaining: 0, more: false, summary: SUMMARY });
    renderWithProviders(<AutoFill />, { user: ACCOUNTANT });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Approve all (2)' }));
    const dialog = screen.getByRole('dialog', { name: 'Approve and write' });
    expect(within(dialog).getByText(/Write 2 Bill No values into ROMS now\?/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Approve and write' }));
    expect(api.approveAutofill).toHaveBeenCalledWith('po', null);
    await waitFor(() => expect(api.runAutofill).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Written into ROMS: 2'));
  });

  test('switching a field to Automatic asks first, and needs "Switch auto-fill on or off"', async () => {
    api.updateAutofillSettings.mockResolvedValue({});
    renderWithProviders(<AutoFill />, { user: ACCOUNTANT });
    expect(await screen.findByLabelText('Bill No + Bill Date auto-fill mode')).toBeDisabled();
  });

  test('an Admin switches to Automatic after a confirm, and to Preview straight away', async () => {
    api.updateAutofillSettings.mockResolvedValue({});
    renderWithProviders(<AutoFill />, { user: ADMIN });
    const user = userEvent.setup();
    await user.selectOptions(await screen.findByLabelText('RTV Credit Note No + CN Date auto-fill mode'), 'preview');
    expect(api.updateAutofillSettings).toHaveBeenCalledWith({ cn_mode: 'preview' });

    await user.selectOptions(screen.getByLabelText('Bill No + Bill Date auto-fill mode'), 'auto');
    const dialog = screen.getByRole('dialog', { name: 'Write into ROMS automatically' });
    expect(api.updateAutofillSettings).toHaveBeenCalledTimes(1);
    await user.click(within(dialog).getByRole('button', { name: 'Switch to Automatic' }));
    expect(api.updateAutofillSettings).toHaveBeenLastCalledWith({ bill_mode: 'auto' });
  });

  test('a value that needs a person: only "Replace a different value" may write Tally\'s number', async () => {
    api.overwriteAutofill.mockResolvedValue({ result: 'written', reason: null });
    const user = userEvent.setup();
    const { unmount } = renderWithProviders(<AutoFill />, { user: ACCOUNTANT });
    await user.click(await screen.findByRole('tab', { name: 'Needs a person' }));
    expect(await screen.findByText('1819 → 1219/RM/26-27')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Write Tally’s number/ })).not.toBeInTheDocument();
    unmount();

    renderWithProviders(<AutoFill />, { user: ADMIN });
    await user.click(await screen.findByRole('button', { name: /Write Tally’s number/ }));
    const dialog = screen.getByRole('dialog', { name: 'Write Tally’s number' });
    expect(within(dialog).getByText(/ROMS has "1819" on PO S292/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Write it' }));
    expect(api.overwriteAutofill).toHaveBeenCalledWith('po', 'S292');
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Written into ROMS: 1219/RM/26-27'));
  });

  test('a refusal shows ROMS\'s words and can be tried again; Written says who approved', async () => {
    api.retryAutofill.mockResolvedValue({ state: 'to_write' });
    renderWithProviders(<AutoFill />, { user: ACCOUNTANT });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('tab', { name: 'Refused by ROMS' }));
    expect(await screen.findByText(/already used on PO Z9 \(asked in Preview — nothing was written\)/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Try again/ }));
    expect(api.retryAutofill).toHaveBeenCalledWith('po', 'S5');

    await user.click(screen.getByRole('tab', { name: 'Written' }));
    expect(await screen.findByRole('cell', { name: 'Approved by Asha' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: 'Automatic' })).toBeInTheDocument();
    expect(api.listAutofillEvents).toHaveBeenCalledWith(expect.objectContaining({ kind: 'po', result: 'applied' }));
  });
});
