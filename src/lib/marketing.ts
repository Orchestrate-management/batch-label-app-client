/**
 * Links back to the marketing site.
 *
 * The split: www.batchlabel.xyz owns accounts, payments and plan changes.
 * app.batchlabel.xyz (this repo) owns the product. Anything that creates or
 * changes an entitlement happens on www, because that is where Stripe lives and
 * where the webhook that writes `brand_memberships` runs. This app never invents
 * a payment flow of its own — it links.
 *
 * Override the origin per deployment with VITE_MARKETING_URL (a preview of the
 * marketing site, or a local dev instance).
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

/** Plans and prices. Where someone on the free plan goes to start paying. */
export const PRICING_URL = marketingUrl('/pricing');

/** The signed-in account area on www: card, invoices, cancel, Stripe portal. */
export const ACCOUNT_URL = marketingUrl('/dashboard/account');

/** The marketing front door. Where sign-out returns to. */
export const HOME_URL = MARKETING_URL;
