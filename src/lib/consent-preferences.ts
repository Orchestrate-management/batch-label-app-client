/**
 * Reading and changing the signed-in maker's marketing consents.
 *
 * THE WRITE PATH, AND WHY THIS APP IS ALLOWED ONE
 *
 * `docs/CONSENT.md` in the marketing repo tells this app never to write consent:
 * not to `brand_memberships`, not to `consent_events`, not through an endpoint of
 * its own. None of that is broken here. There is no table write in this file and
 * there is no endpoint. Every change goes through the `set_consent()` SECURITY
 * DEFINER function — the same call www makes from its account area, granted to
 * `authenticated`, taking identity from `auth.uid()` and stamping the time with
 * `now()`. RLS still gives this browser no write path to either table.
 *
 * That distinction is the whole point of the rule. The prohibition is on
 * inventing a second way to record a consent, because two ways produce two
 * records that can disagree. Calling the one sanctioned function is the opposite
 * of that: one function, one transaction, one audit row, whichever site the
 * maker happened to be on.
 *
 * WHAT IT MAY NOT DO
 *
 * Advertising stays read-only here. It is the cookie banner's marketing toggle,
 * this app has no banner and can no longer even see the stored choice, and a
 * second control writing that flag is exactly the duplication the rule exists to
 * prevent. `fetchConsentPreferences` returns it so it can be shown; nothing in
 * this file will write it.
 */

import { supabase } from './supabase';
import { BRAND_SLUG } from './brand';
import { agreementUrl, MARKETING_EMAIL_AGREEMENT, type Agreement } from './agreements';

export interface ConsentPreferences {
  marketingEmail: boolean;
  advertising: boolean;
}

/**
 * The caller's current opt-in state for this brand.
 *
 * Null means we could not read it — no client, no membership row yet, or the
 * request failed. A failed read is never presented as "off", because assuming a
 * consent was withdrawn is as wrong as assuming it was given.
 */
export async function fetchConsentPreferences(): Promise<ConsentPreferences | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.
  from('brand_memberships').
  select('marketing_email_opt_in, advertising_opt_in').
  eq('brand_slug', BRAND_SLUG).
  maybeSingle();
  if (error || !data) return null;
  return {
    marketingEmail: Boolean(data.marketing_email_opt_in),
    advertising: Boolean(data.advertising_opt_in)
  };
}

/**
 * Records a change to one withdrawable consent.
 *
 * Sends the agreement snapshot so the audit row captures which wording was in
 * front of the maker. The server supplies the identity and the timestamp; a
 * browser cannot forge either.
 *
 * Only `marketing_emails` may be passed. `set_consent()` rejects anything else
 * anyway — terms are not withdrawable and advertising belongs to the banner —
 * but refusing here means a mistake is a type error rather than a database
 * exception a maker has to read.
 */
export async function updateConsentPreference(
agreement: Agreement,
accepted: boolean)
: Promise<{error: string | null;}> {
  if (!supabase) return { error: 'Sign in is not connected.' };
  if (agreement.id !== MARKETING_EMAIL_AGREEMENT.id) {
    return { error: 'That preference cannot be changed here.' };
  }

  const { error } = await supabase.rpc('set_consent', {
    p_consent_id: agreement.id,
    p_accepted: accepted,
    p_brand: BRAND_SLUG,
    p_title: agreement.title,
    p_version: agreement.version,
    p_url: agreementUrl(agreement)
  });

  if (error) {
    return { error: 'We could not save that just now. Please try again.' };
  }
  return { error: null };
}
