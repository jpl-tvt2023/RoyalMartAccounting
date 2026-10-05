import { describe, test, expect } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Help from '../Help';
import { renderWithProviders, VIEWER } from '../../test/renderWithProviders';

describe('Help & FAQ', () => {
  test('shows every guide with its steps and who can do it, and the search narrows it down', async () => {
    renderWithProviders(<Help />, { user: VIEWER, route: '/help#match-review' });
    expect(screen.getByRole('heading', { name: 'Match review' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Clear the review queue' })).toBeInTheDocument();
    expect(screen.getAllByText(/Who can do this:/).length).toBeGreaterThan(5);

    const user = userEvent.setup();
    await user.type(screen.getByRole('searchbox', { name: 'Search help' }), 'forgot password');
    expect(screen.getByRole('heading', { name: 'Signing in' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Match review' })).not.toBeInTheDocument();

    await user.clear(screen.getByRole('searchbox', { name: 'Search help' }));
    await user.type(screen.getByRole('searchbox', { name: 'Search help' }), 'zzzz');
    expect(screen.getByText(/Nothing matches “zzzz”/)).toBeInTheDocument();
  });
});
