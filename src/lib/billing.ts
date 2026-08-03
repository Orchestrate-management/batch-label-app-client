/**
 * Talking to the billing endpoints, which live on the marketing origin.
 *
 * This app is where a customer buys and manages a plan; www is marketing plus auth and no
 * longer creates Checkout sessions for existing customers. But the endpoints themselves stay
 * on www, because that is where the Stripe secret key, the service-role key and the plan
 * contract live, and none of those may ever be in a browser bundle. So the app makes two
 * cross-origin, credentialed calls:
 *
 *   POST /api/create-checkout-session  { tier, interval, success_path, cancel_path }
 *   POST /api/create-portal-session    { return_path }
 *
 * Both carry `Authorization: Bearer <supabase access token>` and both are 401 without it.
 * The user id is taken from that VERIFIED token on the server and from nowhere else — there
 * is deliberately no user_id field in either body. A portal session URL is a bearer link to
 * somebody's cards, addresses, invoices and cancel button; an endpoint that accepted a user
 * id in a request body would be one edited string away from handing over a stranger's
 * billing account.
 *
 * WHAT THIS FILE MAY NOT SEND, and the reason it is worth stating in a client module that
 * obviously does not send it today: no price id, no amount, no currency, no allowance, no
 * plan, no brand, no email. The body names a tier and an interval; the server turns the tier
 * into an env var name, reads the price id from server-only env, and then re-derives the plan
 * and interval it writes to Stripe by resolving that price id BACK through the same index the
 * webhook uses. Adding an amount here would not overcharge anybody — it would simply be
 * ignored — but it would be the first line of the drift this design removed.
 *
 * ERRORS ARE VALUES, NOT EXCEPTIONS. Every failure the customer can actually hit is an
 * ordinary state of a billing screen — an expired session, an account with no Stripe customer
 * yet, a plan they already hold — so they come back as data with the server's own
 * customer-safe message, and the page renders it. The server splits `message` (safe to show)
 * from `detail` (logged only) at the type level, and only `message` crosses the wire.
 */

import { supabase } from './supabase';
import { MARKETING_URL } from './marketing';
import type { BillingInterval } from './plans';

/** Where Stripe returns a customer. Both land in THIS app; www has no billing screen. */
export const CHECKOUT_SUCCESS_PATH = '/billing/success';
export const CHECKOUT_CANCEL_PATH = '/billing';
export const PORTAL_RETURN_PATH = '/billing';

export type BillingResult =
{ok: true;url: string;} |
{ok: false;status: number;message: string;};

/** Shown when the response carried no message of its own. Never invents a cause. */
const GENERIC_FAILURE = 'We could not reach billing just now. Please try again in a moment.';

const NO_SESSION =
'Your sign-in has expired. Refresh the page to sign in again, and we will bring you straight back.';

async function accessToken(): Promise<string | null> {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

async function post(path: string, body: Record<string, unknown>): Promise<BillingResult> {
  const token = await accessToken();
  // Checkout REQUIRES a signed-in buyer, so that the session carries a Supabase user id and
  // the webhook can bind the subscription to an identity without ever resolving by email.
  // The whole app is behind the auth gate, so reaching this without a token means the token
  // expired while the page was open — which is a refresh, not a signup.
  if (!token) return { ok: false, status: 401, message: NO_SESSION };

  let response: Response;
  try {
    response = await fetch(`${MARKETING_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body)
    });
  } catch {
    // A network failure, or a CORS block because this origin is not on the allow-list in the
    // marketing repo's src/server/cors.ts. The second one is invisible in server logs and is
    // the likeliest cause on a preview deployment, so it is worth naming.
    return { ok: false, status: 0, message: GENERIC_FAILURE };
  }

  const payload = (await response.json().catch(() => null)) as
  {url?: unknown;error?: unknown;} |
  null;

  if (!response.ok) {
    const message = typeof payload?.error === 'string' && payload.error.trim() ? payload.error : GENERIC_FAILURE;
    return { ok: false, status: response.status, message };
  }
  if (typeof payload?.url !== 'string' || !payload.url) {
    return { ok: false, status: 502, message: GENERIC_FAILURE };
  }
  return { ok: true, url: payload.url };
}

/**
 * Opens Stripe Checkout for a tier.
 *
 * `railTest` is not a parameter and must not become one. The £0.30 payment-rail item is
 * requested through its own server-side field, gated behind an env flag that is off in
 * production except for the minutes a live rail test is running, and it is not on the public
 * catalogue this page renders. There is no route from a tier button to that price.
 */
export function createCheckoutSession(tier: string, interval: BillingInterval): Promise<BillingResult> {
  return post('/api/create-checkout-session', {
    tier,
    interval,
    success_path: CHECKOUT_SUCCESS_PATH,
    cancel_path: CHECKOUT_CANCEL_PATH
  });
}

/**
 * Buys the 30p rail-test price, to prove the live payment rail without a £14 charge.
 *
 * Sends no tier. `railTest` is a separate field precisely so a tier request can never
 * resolve to the penny price and the penny can never buy a tier — the pair is not
 * expressible in either direction.
 *
 * THE GATE IS SERVER-SIDE AND IS NOT THIS FUNCTION. www compares the email on the VERIFIED
 * Supabase token against RAIL_TEST_ALLOWED_EMAILS and answers 403 to everyone else. So it
 * does not matter what this app renders, or who calls this from a browser console: the
 * answer is the same. That is what makes it safe for the affordance to be nothing more
 * than a URL nobody is told about.
 */
export function createRailTestSession(): Promise<BillingResult> {
  return post('/api/create-checkout-session', {
    railTest: true,
    success_path: CHECKOUT_SUCCESS_PATH,
    cancel_path: CHECKOUT_CANCEL_PATH
  });
}

/**
 * Opens the Stripe Customer Portal: card, invoices, VAT number, tier switch and cancel.
 *
 * There is no in-app substitute for any of it, and that is the design rather than a gap. One
 * Stripe product per subscription and no add-ons means the portal handles tier changes
 * natively with proration; rebuilding that here would mean rebuilding proration, credit notes
 * and the downgrade schedule, and getting one of them subtly wrong with the customer's money.
 */
export function createPortalSession(): Promise<BillingResult> {
  return post('/api/create-portal-session', { return_path: PORTAL_RETURN_PATH });
}

/**
 * Leaves for Stripe. A full navigation rather than a new tab: Checkout and the portal both
 * return the customer to this app by URL, and a popup that a blocker eats looks to the
 * customer like a button that does nothing.
 */
export function leaveFor(url: string): void {
  window.location.assign(url);
}
