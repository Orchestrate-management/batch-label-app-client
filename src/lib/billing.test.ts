import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The two calls that move money, and what they are allowed to send.
 *
 * Everything here is about the REQUEST rather than the happy path, because the request is
 * where this client could do damage. It may name a tier and an interval. It may not name a
 * price, an amount, a currency, an allowance, a plan or a user — the server resolves all of
 * those from the verified token and from server-only env, and a field added here would be the
 * first line of the drift the billing rail was rebuilt to remove.
 */

const getSession = vi.fn();

vi.mock('./supabase', () => ({
  supabase: { auth: { getSession: () => getSession() } },
  isSupabaseConfigured: true
}));

import {
  createCheckoutSession,
  createPortalSession,
  createRailTestSession,
  leaveFor } from
'./billing';

const fetchMock = vi.fn();

function respondWith(status: number, body: unknown) {
  fetchMock.mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body
  } as Response);
}

function lastBody(): Record<string, unknown> {
  const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
  return JSON.parse(init.body as string);
}

beforeEach(() => {
  getSession.mockResolvedValue({ data: { session: { access_token: 'token-abc' } } });
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('opening checkout', () => {
  it('sends the tier and the interval and nothing that costs money', async () => {
    respondWith(200, { id: 'cs_test', url: 'https://checkout.stripe.com/c/pay/cs_test' });
    const result = await createCheckoutSession('studio', 'annual');

    expect(result).toEqual({ ok: true, url: 'https://checkout.stripe.com/c/pay/cs_test' });

    const body = lastBody();
    expect(body.tier).toBe('studio');
    expect(body.interval).toBe('annual');
    // The list that must never grow. A price id in a browser is the one value the checkout
    // endpoint refuses to accept, and an amount here would be a number a customer could edit.
    for (const forbidden of ['price', 'price_id', 'priceId', 'amount', 'currency', 'plan', 'user_id', 'userId', 'email', 'brand', 'skuLimit', 'railTest']) {
      expect(body).not.toHaveProperty(forbidden);
    }
  });

  it('returns the customer to this app, not to www', async () => {
    respondWith(200, { url: 'https://checkout.stripe.com/c/pay/cs_test' });
    await createCheckoutSession('maker', 'monthly');
    const body = lastBody();
    expect(body.success_path).toBe('/billing/success');
    expect(body.cancel_path).toBe('/billing');
  });

  it('carries the access token, because the session must bind to a Supabase user', async () => {
    respondWith(200, { url: 'https://checkout.stripe.com/c/pay/cs_test' });
    await createCheckoutSession('maker', 'annual');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://www.batchlabel.xyz/api/create-checkout-session');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer token-abc');
  });

  it('does not call the endpoint at all without a session', async () => {
    // Checkout requires a signed-in buyer. Firing the request anyway would only trade a clear
    // message for a 401 the customer cannot act on.
    getSession.mockResolvedValue({ data: { session: null } });
    const result = await createCheckoutSession('maker', 'annual');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result).toEqual({
      ok: false,
      status: 401,
      message: expect.stringContaining('sign-in has expired')
    });
  });

  it('shows the server’s own message rather than inventing one', async () => {
    // The 409 for somebody who already has a subscription. The server names the plan they
    // hold and where to change it, and that sentence is better than anything invented here.
    respondWith(409, { error: 'You are already on the Studio plan. Use Manage billing to change plan.' });
    const result = await createCheckoutSession('maker', 'annual');
    expect(result).toEqual({
      ok: false,
      status: 409,
      message: 'You are already on the Studio plan. Use Manage billing to change plan.'
    });
  });

  it('falls back to a message that promises nothing when the body has none', async () => {
    respondWith(500, {});
    const result = await createCheckoutSession('maker', 'annual');
    expect(result.ok).toBe(false);
    expect(result).toMatchObject({ status: 500 });
  });

  it('treats a network or CORS failure as a failure, not a hang', async () => {
    // A cross-origin block on a preview deployment throws here and logs nothing on the
    // server, so it has to surface as a plain error rather than a button that does nothing.
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    const result = await createCheckoutSession('maker', 'annual');
    expect(result).toMatchObject({ ok: false, status: 0 });
  });

  it('refuses a 200 with no URL in it', async () => {
    respondWith(200, { id: 'cs_test' });
    expect(await createCheckoutSession('maker', 'annual')).toMatchObject({ ok: false, status: 502 });
  });
});

describe('opening the billing portal', () => {
  it('sends only a return path — never a user id', async () => {
    // A portal session URL is a bearer link to somebody's cards, invoices and cancel button.
    // The customer is resolved from the verified token; there is no user id field to misuse.
    respondWith(200, { url: 'https://billing.stripe.com/p/session/test' });
    const result = await createPortalSession();
    expect(result).toEqual({ ok: true, url: 'https://billing.stripe.com/p/session/test' });

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://www.batchlabel.xyz/api/create-portal-session');
    expect(lastBody()).toEqual({ return_path: '/billing' });
  });

  it('passes on the ordinary "no billing record yet" answer', async () => {
    // The normal state of every free-plan account, and a 404 rather than a 500 for exactly
    // that reason. It must read as information, not as a fault.
    respondWith(404, { error: 'We could not find a billing record for this account yet.' });
    expect(await createPortalSession()).toEqual({
      ok: false,
      status: 404,
      message: 'We could not find a billing record for this account yet.'
    });
  });
});

/**
 * THE 30p RAIL TEST, which buys a real thing with a real card on the live rail.
 *
 * It was the one call in this file with no test, which is how per-file coverage thresholds came
 * to be blocked on the money module (docs/PRODUCTION_TODO.md, entry 2). What it must prove is
 * not that it works — the server decides that — but that the penny price and a tier cannot
 * reach each other from this side.
 */
describe('the payment rail test', () => {
  it('asks by its own field and names no tier, so a penny can never buy a plan', async () => {
    respondWith(200, { url: 'https://checkout.stripe.com/c/pay/cs_rail' });
    const result = await createRailTestSession();

    expect(result).toEqual({ ok: true, url: 'https://checkout.stripe.com/c/pay/cs_rail' });

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://www.batchlabel.xyz/api/create-checkout-session');

    const body = lastBody();
    expect(body.railTest).toBe(true);
    // The pair is not expressible in either direction: a tier request cannot resolve to the
    // penny price (checkout's test above forbids `railTest`), and this cannot resolve to a
    // tier. The price id itself is server-only env either way.
    for (const forbidden of ['tier', 'interval', 'price', 'price_id', 'priceId', 'amount', 'currency', 'plan', 'user_id', 'userId', 'email']) {
      expect(body).not.toHaveProperty(forbidden);
    }
  });

  it('comes back to this app, the same way a plan purchase does', async () => {
    respondWith(200, { url: 'https://checkout.stripe.com/c/pay/cs_rail' });
    await createRailTestSession();
    const body = lastBody();
    expect(body.success_path).toBe('/billing/success');
    expect(body.cancel_path).toBe('/billing');
  });

  it('surfaces the 403 for an email that is not on the server\'s allow-list', async () => {
    // THE GATE IS NOT THIS FUNCTION. www checks the email on the verified token against
    // RAIL_TEST_ALLOWED_EMAILS, so anybody who finds the undocumented URL — or calls this from
    // a console — gets the same answer, and the client's job is only to show it.
    respondWith(403, { error: 'That is not available on this account.' });
    expect(await createRailTestSession()).toEqual({
      ok: false,
      status: 403,
      message: 'That is not available on this account.'
    });
  });
});

describe('leaving for Stripe', () => {
  it('navigates the tab rather than opening a window a blocker can eat', () => {
    // A popup that never appears looks to the customer like a button that does nothing, on the
    // screen where they are trying to give us money. Both Checkout and the portal bring them
    // back by URL, so there is nothing to preserve here.
    const assign = vi.fn();
    vi.stubGlobal('location', { assign });
    leaveFor('https://checkout.stripe.com/c/pay/cs_test');
    expect(assign).toHaveBeenCalledWith('https://checkout.stripe.com/c/pay/cs_test');
  });
});
