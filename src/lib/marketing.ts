/**
 * Links back to the marketing site.
 *
 * THE SPLIT MOVED, and this header is the place it is easiest to be out of date about.
 * www.batchlabel.xyz is marketing plus auth: the public pricing page, signup, login,
 * password reset. app.batchlabel.xyz (this repo) owns the product AND all account
 * management, including buying a plan — see src/pages/Billing.tsx.
 *
 * What is still on www is the SERVER side of billing, and it stays there for one reason:
 * the Stripe secret key, the Supabase service-role key and the plan contract live on that
 * deployment and none of them may ever be in a browser bundle. So the app calls
 * `/api/plans`, `/api/create-checkout-session` and `/api/create-portal-session` on the
 * origin below, cross-origin and with the caller's access token, and Stripe returns the
 * customer to a path in THIS app.
 *
 * Override the origin per deployment with VITE_MARKETING_URL (a preview of the marketing
 * site, or a local dev instance). Note that a preview origin also has to be added to the
 * marketing repo's CORS allow-list, or every billing call from it is blocked in the browser
 * with nothing in the server logs.
 */

const DEFAULT_MARKETING_URL = 'https://www.batchlabel.xyz';

export const MARKETING_URL = (
(import.meta as unknown as {env?: Record<string, string>;}).env?.VITE_MARKETING_URL ||
DEFAULT_MARKETING_URL).
replace(/\/+$/, '');

/** Absolute URL for a path on the marketing site. */
export function marketingUrl(path: string): string {
  return `${MARKETING_URL}${path.startsWith('/') ? path : `/${path}`}`;
}

/**
 * Where an unauthenticated visitor is sent.
 *
 * `next` carries the page they were actually trying to reach so the marketing
 * login can hand them straight back to it (see the marketing site's
 * lib/app-handoff.ts, which validates `next` against an allow-list before
 * following it — an unchecked `next` immediately after a real login is a
 * convincing open redirect).
 */
export function loginUrl(next: string): string {
  return `${marketingUrl('/log-in')}?next=${encodeURIComponent(next)}`;
}

/**
 * THERE IS DELIBERATELY NO PRICING_URL AND NO ACCOUNT_URL HERE ANY MORE.
 *
 * Both existed because this app had no billing of its own and sent people to www to buy a
 * plan or to reach the Stripe portal. Purchases and the portal both happen on /billing now,
 * and sending a signed-in customer to another origin to buy the thing they are looking at
 * loses people for no reason — the Checkout session has to carry their Supabase user id
 * anyway, which means it has to be created from a screen that knows who they are.
 *
 * www still has a public pricing page. It is for people who are not signed in, which by
 * definition is nobody in this app.
 */

/** The marketing front door. Where sign-out returns to. */
export const HOME_URL = MARKETING_URL;

/**
 * Where a person goes when software cannot help them — a suspended account, an account that
 * never finished setting up. Published on the marketing site's footer, so it is a real
 * address rather than one invented here.
 */
export const SUPPORT_EMAIL = 'hello@batchlabel.co.uk';

/**
 * Reset by email, for someone who cannot supply their current password.
 *
 * The app's own change-password form needs the current password by design (see
 * lib/account.ts). Someone who does not have it has to prove themselves through
 * their inbox instead, and that flow lives on www.
 */
export const FORGOT_PASSWORD_URL = marketingUrl('/forgot-password');

/**
 * Cookie settings on www, opened directly.
 *
 * Advertising consent is the cookie banner's marketing toggle and is changed
 * nowhere else, so this app has to be able to send someone straight to it. The
 * banner is a component rather than a page, so www opens it from this query
 * parameter — see batch-label/src/components/CookieBanner.tsx. Landing on the
 * cookie policy is the right backstop if that ever stops working: it is the
 * document the decision is about.
 */
export const COOKIE_SETTINGS_URL = marketingUrl('/cookie-policy?cookie-settings=1');

/** The privacy notice. Where "ask us for your data" is explained. */
export const PRIVACY_URL = marketingUrl('/privacy');

/** The terms, as accepted at signup. */
export const TERMS_URL = marketingUrl('/terms');
