/**
 * Which upgrade controls report an InitiateCheckout, and which deliberately do
 * not.
 *
 * This is the test that stops the event spreading. Every action in PlanNotice
 * is a link to www, so "fire on every link in this component" would look like a
 * reasonable simplification to a future reader — and it would quietly start
 * counting a maker updating a bounced card as a new checkout. The distinction
 * is a product decision, so it is pinned here rather than left to a comment.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { EntitlementStatus } from '../lib/membership';

const mocks = vi.hoisted(() => ({
  metaInitiateCheckout: vi.fn(),
  status: { current: 'free' as EntitlementStatus }
}));

vi.mock('../lib/meta-pixel', () => ({
  metaInitiateCheckout: mocks.metaInitiateCheckout
}));

vi.mock('../lib/entitlement', () => ({
  useEntitlement: () => ({
    status: mocks.status.current,
    active: false,
    plan: null,
    planStatus: null,
    businessName: null,
    loading: false,
    refresh: vi.fn()
  })
}));

import { copyFor, PlanNotice } from './PlanNotice';

beforeEach(() => {
  mocks.metaInitiateCheckout.mockReset();
  // The suspended action is still a real link jsdom cannot follow (a mailto), so it logs a
  // stack trace per click. Cancelling the default keeps the output readable; React's onClick
  // has already run by the time this fires, which is the thing being asserted.
  document.addEventListener('click', (event) => event.preventDefault());
});

async function clickTheAction(status: EntitlementStatus, label: string) {
  mocks.status.current = status;
  // The paying actions are router Links now — billing moved into this app, so they navigate
  // internally to /billing rather than leaving for www — and Link needs router context.
  render(
    <MemoryRouter>
      <PlanNotice />
    </MemoryRouter>
  );
  await userEvent.click(screen.getByRole('link', { name: new RegExp(label, 'i') }));
}

describe('reports an upgrade click', () => {
  it.each([
  ['free', 'See plans'],
  // `cancelled` became `lapsed` when billing moved into this app. Not a rename for its own
  // sake: a lapsed account is a Free account with Free's abilities, so the copy may not
  // imply a penalty. The press is still somebody starting to pay, so it still reports.
  ['lapsed', 'Start a plan again']] as
  const)('when a %s maker presses "%s"', async (status, label) => {
    await clickTheAction(status, label);
    expect(mocks.metaInitiateCheckout).toHaveBeenCalledTimes(1);
    expect(mocks.metaInitiateCheckout).toHaveBeenCalledWith('plan-gate');
  });
});

describe('reports nothing', () => {
  it('when a suspended maker presses "Email us"', async () => {
    await clickTheAction('suspended', 'Email us');
    // Asking about a suspension is not a purchase starting. It is the one action that still
    // leaves this app, because it needs a human rather than a checkout.
    expect(mocks.metaInitiateCheckout).not.toHaveBeenCalled();
  });

  it('when a past_due maker sees nothing, because nothing is being withheld', () => {
    // past_due is ENTITLED — Stripe retries a failed card for days and the database keeps
    // access on throughout — so this component renders null and there is no press to report.
    // The dunning nag lives on /billing instead, beside the button that opens the portal
    // where the card is actually replaced.
    expect(copyFor('past_due', 'Exporting', 'Maker')).toBeNull();
    expect(mocks.metaInitiateCheckout).not.toHaveBeenCalled();
  });

  it('when the entitlement could not be read, because nothing is shown to press', async () => {
    mocks.status.current = 'unknown';
    render(<PlanNotice />);
    await userEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(mocks.metaInitiateCheckout).not.toHaveBeenCalled();
  });

  it('when the maker is already on a paid plan and the notice is absent', () => {
    mocks.status.current = 'active';
    const { container } = render(<PlanNotice />);
    expect(container).toBeEmptyDOMElement();
    expect(mocks.metaInitiateCheckout).not.toHaveBeenCalled();
  });
});
