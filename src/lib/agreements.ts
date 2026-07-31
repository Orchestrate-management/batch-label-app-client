/**
 * The versioned agreements this app can record a change to.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE VERSION STRINGS BELOW ARE MIRRORED FROM batch-label/src/lib/agreements.ts.
 * If a version is bumped there, bump it here in the same change. The two repos
 * write to the same `consent_events` table through the same `set_consent()`
 * function, so a version that disagrees puts two different answers to "which
 * wording did they agree to" in one audit log — which is worse than no record,
 * because a contradiction proves we did not know.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Only the two withdrawable consents are here. Terms of Service is deliberately
 * absent: it is a contract, not a withdrawable consent, `set_consent()` rejects
 * it, and it is accepted once during signup on www.
 *
 * See batch-label/docs/CONSENT.md — that document is the source of truth for
 * which system owns which permission.
 */

import { marketingUrl } from './marketing';

export interface Agreement {
  /** Stable machine id. Also `consent_events.consent_id`, and what set_consent whitelists. */
  id: string;
  /** Human title, shown to the maker and stored in the snapshot. */
  title: string;
  /** Version of the document wording. Mirrored from www. */
  version: string;
  /** Path to the document, which lives on the marketing site. */
  path: string;
}

/** Changed here and in www's account area. Both write through set_consent(). */
export const MARKETING_EMAIL_AGREEMENT: Agreement = {
  id: 'marketing_emails',
  title: 'Marketing emails',
  version: '2026-07-30',
  path: '/privacy'
};

/**
 * Read-only in this app, and it must stay that way.
 *
 * Advertising is the cookie banner's marketing toggle and nothing else. This app
 * has no banner, loads no tags and cannot see the banner's stored choice — that
 * lives in localStorage and a host-only cookie on www.batchlabel.xyz. It is here
 * so the account state can be *shown* with the right title, never written.
 */
export const ADVERTISING_AGREEMENT: Agreement = {
  id: 'advertising',
  title: 'Advertising and retargeting',
  version: '2026-07-30.2',
  path: '/cookie-policy'
};

/**
 * Absolute URL for the document.
 *
 * Resolved against the marketing site, NOT this app's origin. The documents only
 * exist on www, so recording `https://app.batchlabel.xyz/privacy` would put a
 * URL in the audit trail that has never served that document.
 */
export function agreementUrl(agreement: Agreement): string {
  return marketingUrl(agreement.path);
}
