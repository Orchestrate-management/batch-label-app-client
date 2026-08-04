import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { Settings } from './Settings';
import { WorkspaceProvider } from '../lib/workspace';

/**
 * CONTROLS THAT LOOK LIKE SETTINGS MUST EITHER BE SETTINGS OR SAY THEY ARE NOT.
 *
 * The Preferences tab holds two kinds of control and they used to be indistinguishable. The
 * category checkboxes are real — `WorkspaceProvider` holds them and the create dialog reads
 * them. "Default export" and "Default market" were uncontrolled `<Select defaultValue=…>`
 * with no `onChange` and nowhere to write to: changing either did nothing and survived
 * nothing, under a tab description that promised "what the export defaults to".
 *
 * This is the same fault the identity tab was fixed for, and it is the house rule — no screen
 * may state as fact something the software has not established. A control that accepts a
 * choice states that the choice was taken. So the two get the identity tab's answer: shown,
 * disabled, and told plainly that nothing stores them.
 *
 * THE REASON THIS IS PINNED RATHER THAN LEFT TO REVIEW is that re-enabling a disabled select
 * is a one-character change that reads as tidying, and wiring these into WorkspaceProvider
 * beside the category toggles reads as finishing the job — while actually being worse, because
 * then the widget remembers and still changes nothing. Both of those turn this test red.
 */

vi.mock('../lib/entitlement', () => ({
  useEntitlement: () => ({
    status: 'active',
    accountId: 'acct-1111',
    businessName: 'Test Ltd',
    plan: 'maker',
    skuLimit: 45,
    skuCount: 4,
    skuUnlimited: false,
    canModify: true,
    loading: false,
    refresh: () => {}
  })
}));

vi.mock('../lib/auth', () => ({
  useAuth: () => ({ user: { id: 'user-a', email: 'maker@example.com' }, loading: false })
}));

vi.mock('../lib/meta-pixel', () => ({ metaInitiateCheckout: () => {} }));

vi.mock('../lib/product-store', () => ({
  useProducts: () => ({
    status: 'ready',
    products: [],
    error: null,
    refresh: () => {},
    reload: async () => {}
  })
}));

function drawPreferencesTab() {
  render(
    <MemoryRouter initialEntries={['/settings/preferences']}>
      <WorkspaceProvider>
        <Routes>
          <Route path="/settings/:tab" element={<Settings />} />
        </Routes>
      </WorkspaceProvider>
    </MemoryRouter>
  );
}

describe('the two Preferences controls that store nothing', () => {
  it('does not accept a choice for the default export', () => {
    drawPreferencesTab();
    expect(screen.getByLabelText(/Default export/)).toBeDisabled();
  });

  it('does not accept a choice for the default market', () => {
    drawPreferencesTab();
    expect(screen.getByLabelText(/Default market/)).toBeDisabled();
  });

  it('says of each one that it is not stored, rather than leaving it to be discovered', () => {
    drawPreferencesTab();
    // "Disabled" on its own is a control that looks broken. The identity tab's pattern is
    // disabled AND a sentence, so the state reads as "not yet" rather than as a fault.
    expect(screen.getAllByText(/Not stored yet/i).length).toBeGreaterThanOrEqual(2);
  });

  it('does not promise an export default in the tab description', () => {
    drawPreferencesTab();
    // The first sentence somebody reads on this screen. It used to say "…and what the export
    // defaults to", naming a setting the screen does not have.
    expect(screen.queryByText(/what the export defaults to/i)).not.toBeInTheDocument();
    expect(screen.getByText(/Which categories are switched on/i)).toBeInTheDocument();
  });
});

describe('the half of this tab that is real, which must stay real', () => {
  it('still lets a category be switched off', () => {
    // The whole point of disabling the two above is that a maker can tell them apart from
    // this. If the checkboxes ever go the same way, the tab has stopped doing anything and
    // the description is wrong again in the other direction.
    drawPreferencesTab();
    const boxes = screen.getAllByRole('checkbox');
    expect(boxes.length).toBeGreaterThan(0);
    for (const box of boxes) expect(box).toBeEnabled();
  });
});
