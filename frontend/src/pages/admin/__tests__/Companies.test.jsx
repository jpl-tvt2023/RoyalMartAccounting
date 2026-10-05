import { describe, test, expect, vi, beforeEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Companies from '../Companies';
import { renderWithProviders } from '../../../test/renderWithProviders';
import * as companiesApi from '../../../api/companies.api';

vi.mock('../../../api/companies.api', () => ({ listCompanies: vi.fn(), updateCompany: vi.fn() }));
vi.mock('../../../api/audit.api', () => ({ getEntityHistory: vi.fn().mockResolvedValue([]) }));

const row = (overrides) => ({
  id: 1, guid: 'e91b4596-e709', name: 'Roymax Products LLP ( Maharashtra )', code: 'MH', state_name: 'Maharashtra',
  gstin: '27ABGFR0562B1ZI', books_from: '2022-04-01', sync_enabled: true, loaded_in_tally: true, vouchers: 3774,
  first_seen_at: '2026-10-05 09:00:00', last_seen_at: '2026-10-05 10:00:00', updated_at: null, updated_by_name: null,
  ...overrides,
});

describe('Tally companies page', () => {
  beforeEach(() => vi.clearAllMocks());

  test('lists the companies the Connector has seen, and turns sync on after a confirm', async () => {
    companiesApi.listCompanies.mockResolvedValue([
      row(),
      row({ id: 2, guid: 'a606914f', name: 'Test Company', code: 'MH', gstin: null, sync_enabled: false, vouchers: 0 }),
    ]);
    companiesApi.updateCompany.mockResolvedValue({});
    renderWithProviders(<Companies />);

    expect(await screen.findByText('Roymax Products LLP ( Maharashtra )')).toBeInTheDocument();
    expect(screen.getByText('1 syncing · 1 not synced')).toBeInTheDocument();
    expect(screen.getByText(/Companies are created in Tally by the accountants/)).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Turn sync on for Test Company' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(/start reading Test Company's books/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Turn on' }));
    expect(companiesApi.updateCompany).toHaveBeenCalledWith(2, { sync_enabled: true });
    expect(screen.getByRole('button', { name: 'Turn sync off for Roymax Products LLP ( Maharashtra )' })).toBeInTheDocument();
  });

  test('edits the short code', async () => {
    companiesApi.listCompanies.mockResolvedValue([row()]);
    companiesApi.updateCompany.mockResolvedValue({});
    renderWithProviders(<Companies />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /Edit code for/ }));
    const input = screen.getByLabelText('Short code');
    await user.clear(input);
    await user.type(input, 'mh1');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(companiesApi.updateCompany).toHaveBeenCalledWith(1, { code: 'MH1' });
  });
});
