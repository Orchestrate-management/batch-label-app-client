/**
 * The second and last InitiateCheckout call site: Settings → Billing.
 *
 * "Compare plans" and "Manage billing" sit side by side in the same card and
 * both leave for www. One is somebody deciding to start paying and the other is
 * somebody opening the Stripe portal to change a card or cancel. Only the first
 * is a checkout, and this test exists so the pair cannot quietly be treated the
 * same by a later edit.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const mocks = vi.hoisted(() => ({ metaInitiateCheckout: vi.fn() }));

vi.mock('../lib/meta-pixel', () => ({
  metaInitiateCheckout: mocks.metaInitiateCheckout
}));

vi.mock('../lib/entitlement', () => ({
  useEntitlement: () => ({
    status: 'free' as const,
    active: false,
    plan: 'free',
    planStatus: null,
    businessName: null,
    loading: false,
    refresh: vi.fn()
  })
}));

import { Settings } from './Settings';
import { WorkspaceProvider } from '../lib/workspace';

function renderBilling() {
  return render(
    <WorkspaceProvider>
      <MemoryRouter initialEntries={['/settings/billing']}>
        <Routes>
          <Route path="/settings/:tab" element={<Settings />} />
        </Routes>
      </MemoryRouter>
    </WorkspaceProvider>
  );
}

beforeEach(() => {
  mocks.metaInitiateCheckout.mockReset();
  // jsdom cannot follow a cross-origin link and logs a stack trace per attempt.
  document.addEventListener('click', (event) => event.preventDefault());
});

describe('Settings → Billing', () => {
  it('reports an InitiateCheckout when a maker goes to compare plans', async () => {
    renderBilling();

    await userEvent.click(screen.getByRole('link', { name: /compare plans/i }));

    expect(mocks.metaInitiateCheckout).toHaveBeenCalledTimes(1);
    expect(mocks.metaInitiateCheckout).toHaveBeenCalledWith('billing-settings');
  });

  it('reports nothing when a maker opens the billing portal', async () => {
    renderBilling();

    await userEvent.click(screen.getByRole('link', { name: /manage billing/i }));

    expect(mocks.metaInitiateCheckout).not.toHaveBeenCalled();
  });
});
