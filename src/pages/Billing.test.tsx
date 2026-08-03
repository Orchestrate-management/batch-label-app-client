import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { Billing } from './Billing';
import type { EntitlementValue } from '../lib/entitlement';
import { mapEntitlement, type EntitlementRow } from '../lib/membership';

/**
 * The billing page, in jsdom.
 *
 * Three failures matter here and none of them shows up in a type check:
 *
 *   * a price on screen that this repo made up, rather than one the catalogue served;
 *   * a price on screen with no tax basis next to it, which is a 20% surprise;
 *   * a purchase button offered to somebody who already has a subscription, which the server
 *     answers with a 409 and which, if it ever got past, is two charges a month on one
 *     account.
 */

const entitlement = vi.fn<() => EntitlementValue>();
const createCheckoutSession = vi.fn();
const createPortalSession = vi.fn();
const leaveFor = vi.fn();
const mocks = { metaInitiateCheckout: vi.fn() };

vi.mock('../lib/entitlement', () => ({
  useEntitlement: () => entitlement()
}));

vi.mock('../lib/meta-pixel', () => ({
  metaInitiateCheckout: (...args: unknown[]) => mocks.metaInitiateCheckout(...args)
}));

/**
 * Twelve products, read successfully — and the STATUS is settable, which is the point.
 *
 * The store reports a status as well as a list, because products come from the database and
 * the read can fail. This page renders the count beside an allowance, so all three states have
 * to be distinguishable here: a zero from a failed read reads as "you have used none of your
 * plan", and an apology during an ordinary load reads as a failure that has not happened. The
 * old mock was permanently `ready`, which is why the loading path shipped saying "We could not
 * count your products just now" on every visit.
 */
const store = vi.hoisted(() => ({
  status: 'ready' as 'loading' | 'ready' | 'error',
  products: new Array(12).fill(null) as unknown[]
}));

vi.mock('../lib/product-store', () => ({
  useProducts: () => ({
    status: store.status,
    products: store.products,
    error: store.status === 'error' ? 'We could not read your products just now.' : null,
    refresh: () => {},
    reload: async () => {}
  })
}));

vi.mock('../lib/billing', () => ({
  createCheckoutSession: (...args: unknown[]) => createCheckoutSession(...args),
  createPortalSession: (...args: unknown[]) => createPortalSession(...args),
  leaveFor: (...args: unknown[]) => leaveFor(...args)
}));

const CATALOGUE = {
  currency: 'gbp',
  taxBehaviour: 'exclusive',
  plans: [
  { slug: 'free', displayName: 'Free', monthlyPence: null, annualPence: null, skuLimit: 3, skuUnlimited: false, editorSeatLimit: 1, purchasable: false },
  { slug: 'maker', displayName: 'Maker', monthlyPence: 1400, annualPence: 14000, skuLimit: 45, skuUnlimited: false, editorSeatLimit: 1, purchasable: true },
  { slug: 'studio', displayName: 'Studio', monthlyPence: 3500, annualPence: 35000, skuLimit: 180, skuUnlimited: false, editorSeatLimit: 3, purchasable: true },
  { slug: 'consultant', displayName: 'Consultant', monthlyPence: 19900, annualPence: 199000, skuLimit: null, skuUnlimited: true, editorSeatLimit: 10, purchasable: true }]

};

function stateFor(row: Partial<EntitlementRow> | null, failed = false): EntitlementValue {
  const full: EntitlementRow | null = row === null ?
  null :
  {
    brand: 'batchlabel',
    accountId: 'acct-1111',
    membershipStatus: 'active',
    businessName: 'Hearth & Hollow',
    plan: 'free',
    planStatus: null,
    active: false,
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
    trialEnd: null,
    skuLimit: 3,
    // Null by default, so the tests that do not care about the count exercise the fallback to
    // the store's list length. The tests that DO care set it.
    skuCount: null,
    skuUnlimited: false,
    editorSeatLimit: 1,
    canModify: null,
    ...row
  };
  return { ...mapEntitlement(full, failed), loading: false, refresh: vi.fn() };
}

const fetchMock = vi.fn();

beforeEach(() => {
  store.status = 'ready';
  store.products = new Array(12).fill(null);
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => CATALOGUE } as Response);
  vi.stubGlobal('fetch', fetchMock);
  createCheckoutSession.mockReset();
  createPortalSession.mockReset();
  leaveFor.mockReset();
  mocks.metaInitiateCheckout.mockReset();
  entitlement.mockReturnValue(stateFor({ plan: 'free' }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function renderPage() {
  return render(
    <MemoryRouter>
      <Billing />
    </MemoryRouter>
  );
}

describe('the prices', () => {
  it('fetches them rather than holding them', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('Maker')).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledWith(
      'https://www.batchlabel.xyz/api/plans',
      expect.objectContaining({ method: 'GET' })
    );
  });

  it('shows annual by default, because that is the cheaper way to buy the same thing', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('£140')).toBeInTheDocument());
    expect(screen.getByText('£350')).toBeInTheDocument();
    expect(screen.getByText('£1,990')).toBeInTheDocument();
    expect(screen.queryByText('£14')).not.toBeInTheDocument();
  });

  it('labels every price with its tax basis', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('£140')).toBeInTheDocument());
    // One "a year exc VAT" per priced tier. Without it a maker budgets £140 and is invoiced
    // £168.
    expect(screen.getAllByText(/a year exc VAT/)).toHaveLength(3);
  });

  it('switches to monthly as the secondary option', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('£140')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: 'Monthly' }));
    expect(screen.getByText('£14')).toBeInTheDocument();
    expect(screen.getByText('£199')).toBeInTheDocument();
    expect(screen.getAllByText(/a month exc VAT/)).toHaveLength(3);
  });

  it('states the annual saving only because the numbers say so', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('£140')).toBeInTheDocument());
    expect(screen.getAllByText(/2 months free/)).toHaveLength(3);
  });

  it('renders the unlimited tier without a number', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('Consultant')).toBeInTheDocument());
    expect(screen.getByText('Unlimited SKUs')).toBeInTheDocument();
    expect(screen.queryByText(/2,147,483,647/)).not.toBeInTheDocument();
  });

  it('says nothing rather than guessing when the catalogue will not load', async () => {
    // The whole point of holding no local price table. A fallback here is a stale number
    // quoted to somebody about to be charged a different one.
    fetchMock.mockResolvedValue({ ok: false, status: 503, json: async () => ({}) } as Response);
    const { container } = renderPage();
    await waitFor(() =>
    expect(screen.getByText('We could not load the prices')).toBeInTheDocument()
    );
    expect(container.textContent).not.toMatch(/£\s?\d/);
    expect(screen.queryByRole('button', { name: /^Choose/ })).not.toBeInTheDocument();
  });
});

describe('buying', () => {
  it('sends the chosen tier and interval to checkout and leaves', async () => {
    createCheckoutSession.mockResolvedValue({ ok: true, url: 'https://checkout.stripe.com/x' });
    renderPage();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Choose Studio' })).toBeEnabled());
    await userEvent.click(screen.getByRole('button', { name: 'Choose Studio' }));
    expect(createCheckoutSession).toHaveBeenCalledWith('studio', 'annual');
    await waitFor(() => expect(leaveFor).toHaveBeenCalledWith('https://checkout.stripe.com/x'));
  });

  it('carries the interval the customer actually chose', async () => {
    createCheckoutSession.mockResolvedValue({ ok: true, url: 'https://checkout.stripe.com/x' });
    renderPage();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Monthly' })).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: 'Monthly' }));
    await userEvent.click(screen.getByRole('button', { name: 'Choose Maker' }));
    expect(createCheckoutSession).toHaveBeenCalledWith('maker', 'monthly');
  });

  it('never offers a checkout for Free', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('Free')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Choose Free' })).not.toBeInTheDocument();
  });

  it('stops offering a purchase to somebody who is already entitled', async () => {
    // The checkout endpoint refuses this with a 409, and would be right to: two subscriptions
    // is two charges a month on one account. A tier change belongs in the portal, which
    // handles the proration.
    entitlement.mockReturnValue(stateFor({ plan: 'studio', planStatus: 'active', active: true, skuLimit: 180 }));
    renderPage();
    await waitFor(() => expect(screen.getByText('Consultant')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /^Choose/ })).not.toBeInTheDocument();
    expect(screen.getByText(/changing tier or interval happens in the billing portal/)).
    toBeInTheDocument();
  });

  it('shows the server’s refusal instead of inventing one', async () => {
    createCheckoutSession.mockResolvedValue({
      ok: false,
      status: 409,
      message: 'You are already on the Studio plan. Use Manage billing to change plan.'
    });
    renderPage();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Choose Maker' })).toBeEnabled());
    await userEvent.click(screen.getByRole('button', { name: 'Choose Maker' }));
    await waitFor(() =>
    expect(screen.getByText(/already on the Studio plan/)).toBeInTheDocument()
    );
    expect(leaveFor).not.toHaveBeenCalled();
  });
});

describe('the plan somebody is on', () => {
  it('measures usage against the allowance on the row, not against a client constant', async () => {
    entitlement.mockReturnValue(
      stateFor({ plan: 'maker', planStatus: 'active', active: true, skuLimit: 45, editorSeatLimit: 1 })
    );
    renderPage();
    const meter = await screen.findByRole('progressbar', { name: 'SKUs used' });
    expect(meter).toHaveAttribute('aria-valuenow', '12');
    expect(meter).toHaveAttribute('aria-valuemax', '45');
    // Twice on the page, and both are the same number for different reasons: the Maker card
    // states what the TIER allows, the "Your plan" panel states what THIS ACCOUNT's row
    // allows. They coincide until somebody is comped or grandfathered, which is exactly why
    // the panel reads the row rather than the card.
    expect(screen.getAllByText('45 SKUs')).toHaveLength(2);
  });

  it('counts with the number the database holds, not with the length of the list', async () => {
    // entitlements.sku_count is counted over the same rows the enforcement trigger counts.
    // The list in the browser drops a product whose specification did not come back, so
    // trusting it here is how a page that takes money shows "12 of 45" while the next create
    // is refused for holding 40.
    entitlement.mockReturnValue(
      stateFor({ plan: 'maker', planStatus: 'active', active: true, skuLimit: 45, skuCount: 40 })
    );
    renderPage();
    const meter = await screen.findByRole('progressbar', { name: 'SKUs used' });
    expect(meter).toHaveAttribute('aria-valuenow', '40');
    expect(screen.getByText('40')).toBeInTheDocument();
    expect(screen.queryByText('12')).not.toBeInTheDocument();
  });

  it('does not claim a failed count while the read is still in flight', async () => {
    // The first paint of this page ALWAYS has products loading, so folding loading into "we
    // could not count" opened every visit on an apology for a failure that had not happened.
    store.status = 'loading';
    store.products = [];
    entitlement.mockReturnValue(
      stateFor({ plan: 'maker', planStatus: 'active', active: true, skuLimit: 45 })
    );
    renderPage();
    await waitFor(() =>
    expect(screen.getByText(/Counting the products on your account/)).toBeInTheDocument()
    );
    expect(screen.queryByText(/could not count your products/)).not.toBeInTheDocument();
  });

  it('says the count failed only once a read has finished and failed', async () => {
    store.status = 'error';
    store.products = [];
    entitlement.mockReturnValue(
      stateFor({ plan: 'maker', planStatus: 'active', active: true, skuLimit: 45 })
    );
    renderPage();
    await waitFor(() =>
    expect(screen.getByText(/could not count your products/)).toBeInTheDocument()
    );
    // And never a zero, which beside an allowance reads as "you have used none of your plan".
    expect(screen.queryByRole('progressbar', { name: 'SKUs used' })).not.toBeInTheDocument();
  });

  it('admits it when the allowance is unreadable rather than showing a ceiling', async () => {
    entitlement.mockReturnValue(
      stateFor({ plan: 'maker', planStatus: 'active', active: true, skuLimit: 45, skuUnlimited: null })
    );
    renderPage();
    await waitFor(() => expect(screen.getByText('Allowance unavailable')).toBeInTheDocument());
    expect(screen.queryByRole('progressbar', { name: 'SKUs used' })).not.toBeInTheDocument();
  });

  it('shows no ceiling for the unlimited tier', async () => {
    entitlement.mockReturnValue(
      stateFor({ plan: 'consultant', planStatus: 'active', active: true, skuLimit: 2147483647, skuUnlimited: true })
    );
    renderPage();
    await waitFor(() =>
    expect(screen.getByText(/This plan has no SKU ceiling/)).toBeInTheDocument()
    );
    expect(screen.queryByRole('progressbar', { name: 'SKUs used' })).not.toBeInTheDocument();
  });

  it('tells a lapsed account it is not worse off than a new signup', async () => {
    entitlement.mockReturnValue(stateFor({ plan: 'studio', planStatus: 'canceled', active: false }));
    renderPage();
    await waitFor(() =>
    expect(screen.getByText(/everything the free plan can/)).toBeInTheDocument()
    );
  });

  it('nags a past_due customer beside the button that fixes it', async () => {
    // past_due is entitled, so nothing is withheld; the message belongs here, next to the
    // portal, rather than as a blocker over a screen with no card field on it.
    entitlement.mockReturnValue(stateFor({ plan: 'maker', planStatus: 'past_due', active: true }));
    renderPage();
    await waitFor(() => expect(screen.getByText(/Update your card/)).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /Manage billing/ })).toBeInTheDocument();
  });

  it('opens the portal and leaves', async () => {
    createPortalSession.mockResolvedValue({ ok: true, url: 'https://billing.stripe.com/p/x' });
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: /Manage billing/ }));
    expect(createPortalSession).toHaveBeenCalled();
    await waitFor(() => expect(leaveFor).toHaveBeenCalledWith('https://billing.stripe.com/p/x'));
  });

  it('passes on the ordinary "no billing record yet" answer without alarming anyone', async () => {
    createPortalSession.mockResolvedValue({
      ok: false,
      status: 404,
      message: 'We could not find a billing record for this account yet.'
    });
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: /Manage billing/ }));
    await waitFor(() =>
    expect(screen.getByText(/could not find a billing record/)).toBeInTheDocument()
    );
  });

  it('does not admit to a failure that has not happened yet', async () => {
    // "We could not read your allowance" is only true once a read has FINISHED. While one is
    // in flight the honest word is "checking", and the difference matters on the screen a
    // customer opens straight after paying.
    entitlement.mockReturnValue({ ...stateFor({ plan: 'maker' }), loading: true });
    renderPage();
    await waitFor(() => expect(screen.getByText(/Checking what your plan allows/)).toBeInTheDocument());
    expect(screen.queryByText(/could not read your allowance/)).not.toBeInTheDocument();
    // And nothing is offered for sale before we know whether they already have a plan.
    expect(screen.queryByRole('button', { name: /^Choose/ })).not.toBeInTheDocument();
  });

  it('does not accuse a customer whose entitlement could not be read', async () => {
    entitlement.mockReturnValue(stateFor(null, true));
    renderPage();
    await waitFor(() =>
    expect(screen.getByText('We could not check your plan just now.')).toBeInTheDocument()
    );
  });
});

/**
 * The InitiateCheckout pair, moved here from Settings.billing.test.tsx.
 *
 * That file tested the Settings → Billing tab, which no longer exists — the purchase moved
 * onto this route. The assertion it protected did not move with it automatically, and for a
 * while nothing fired InitiateCheckout at all: the tab was deleted, and the new page was
 * written without it. This is why the test came too.
 *
 * "Choose a plan" and "Manage billing" sit on the same screen. One is somebody deciding to
 * start paying; the other opens the Stripe portal to change a card or cancel. Only the first
 * is a checkout, and reporting the second as one would inflate the exact number the ad
 * account optimises against.
 */
describe('reports a checkout starting, and only that', () => {
  it('fires InitiateCheckout when a plan is chosen', async () => {
    createCheckoutSession.mockResolvedValue({ ok: true, url: 'https://checkout.stripe.com/x' });
    renderPage();

    const choose = await screen.findByRole('button', { name: /choose maker/i });
    await userEvent.click(choose);

    expect(mocks.metaInitiateCheckout).toHaveBeenCalledTimes(1);
    expect(mocks.metaInitiateCheckout).toHaveBeenCalledWith('billing-page');
  });

  it('does not fire it when the billing portal is opened', async () => {
    createPortalSession.mockResolvedValue({ ok: true, url: 'https://billing.stripe.com/x' });
    renderPage();

    const manage = await screen.findByRole('button', { name: /manage billing/i });
    await userEvent.click(manage);

    expect(mocks.metaInitiateCheckout).not.toHaveBeenCalled();
  });
});
