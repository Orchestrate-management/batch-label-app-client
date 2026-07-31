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

import { PlanNotice } from './PlanNotice';

beforeEach(() => {
  mocks.metaInitiateCheckout.mockReset();
  // Every action here is a real cross-origin link and jsdom cannot follow one,
  // so it logs a stack trace per click. Cancelling the default keeps the output
  // readable; React's onClick has already run by the time this fires, which is
  // the thing being asserted.
  document.addEventListener('click', (event) => event.preventDefault());
});

async function clickTheAction(status: EntitlementStatus, label: string) {
  mocks.status.current = status;
  render(<PlanNotice />);
  await userEvent.click(screen.getByRole('link', { name: new RegExp(label, 'i') }));
}

describe('reports an upgrade click', () => {
  it.each([
  ['free', 'See plans'],
  ['cancelled', 'Start a plan again']] as
  const)('when a %s maker presses "%s"', async (status, label) => {
    await clickTheAction(status, label);
    expect(mocks.metaInitiateCheckout).toHaveBeenCalledTimes(1);
    expect(mocks.metaInitiateCheckout).toHaveBeenCalledWith('plan-gate');
  });
});

describe('reports nothing', () => {
  it.each([
  ['past_due', 'Update your card'],
  ['suspended', 'Go to your account']] as
  const)('when a %s maker presses "%s"', async (status, label) => {
    await clickTheAction(status, label);
    // Fixing a card or asking about a suspension is not a purchase starting.
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
