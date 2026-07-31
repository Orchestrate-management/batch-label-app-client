import React, { useEffect } from 'react';
import { useAuth } from './auth';
import { supabase } from './supabase';
import { BRAND_SLUG } from './brand';
import { setMetaConsent } from './meta-pixel';

/**
 * The one place that decides whether Meta tracking is on in this app.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THE ACCOUNT FLAG AND NOT A BANNER
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * This app is always authenticated. There is no route — not even a 404 — that
 * renders without a session (`lib/auth.tsx`), so there is never an anonymous
 * visitor here to ask, and the person in front of us always has an account
 * whose answer we can look up.
 *
 * That answer is `brand_memberships.advertising_opt_in`, read under RLS with
 * the maker's own session. It is the same record the marketing site's cookie
 * banner keeps in step: the banner is the single place advertising consent is
 * *asked*, and `syncAdvertisingConsent()` on www writes the account flag
 * through the `set_consent` function whenever the answer changes. See
 * docs/CONSENT.md in the marketing repo — that document is the model, and this
 * file obeys it rather than inventing a second one.
 *
 * THERE IS NO COOKIE BANNER IN THIS APP AND THERE MUST NEVER BE ONE. A second
 * advertising control is precisely the drift the consent model was rebuilt to
 * eliminate: two controls produce two records, and two records that disagree
 * prove we did not know. `bl_consent`, the banner's browser record, is
 * host-only on www.batchlabel.xyz and this app cannot see it. That is the
 * correct arrangement and widening it would mainly enable the second control.
 *
 * THERE IS NO WRITE PATH IN THIS FILE. Not to `brand_memberships`, not to
 * `consent_events`, not through an endpoint of this app's own. The maker
 * changes their mind in www's cookie settings, and this app finds out by
 * reading again.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * FAIL CLOSED, IN FOUR DIRECTIONS
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * The Pixel loads only on a read that came back and said `true`. Every other
 * outcome sends nothing and loads nothing:
 *
 *   * the flag is false                    — they said no;
 *   * there is no membership row yet       — mid-signup, nobody has answered;
 *   * the read failed (network, RLS, 500)  — a failed read is not consent;
 *   * the read has not resolved            — the gate starts shut, so an
 *                                            in-flight read is a closed gate.
 *
 * The last one is why this is a provider that drives module state rather than a
 * hook a component reads: there is no window in which a component could see
 * "not loaded yet" and treat it as permission. `granted` in `./meta-pixel`
 * starts false and the only thing that opens it is a resolved `true`.
 *
 * Being wrong in this direction under-reports conversions. That is the correct
 * direction to be wrong in: an unreported upgrade click costs us attribution,
 * an unconsented send costs somebody their privacy.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WITHDRAWAL HAS TO REACH THIS TAB
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Consent is withdrawn on www — a different origin, usually a different tab.
 * Nothing pushes that to us, so a read on mount alone would leave a tag running
 * for someone who has just turned it off, and a withdrawal that leaves a tag
 * running is worse than never having asked.
 *
 * So the flag is re-read when the app is brought back to the front: the maker
 * changes their cookie settings on www and returns to the product, which is
 * exactly the sequence that has to work. Signing out closes the gate
 * immediately, without waiting for a read.
 *
 * Polling was considered and rejected. A timer would shorten the window between
 * a withdrawal and this tab noticing, at the cost of a query per interval per
 * open tab, forever, for a flag that changes a handful of times in an account's
 * life. Focus is the event that actually correlates with the change.
 */

/**
 * Three outcomes, kept distinct so the difference cannot be lost in a boolean.
 *
 * `denied` and `unknown` both close the gate — the caller treats them
 * identically and must — but they are different facts and a reader of this code
 * should be able to see that "we asked and they said no" is not the same as "we
 * could not ask".
 */
export type AdvertisingConsent = 'granted' | 'denied' | 'unknown';

/**
 * Reads the signed-in maker's advertising opt-in.
 *
 * Follows the shape of `fetchMembership()` in `./membership` — same table, same
 * RLS, same "filter on brand_slug only" reasoning: the policy is "your own
 * memberships are readable", so adding `.eq('user_id', …)` would be redundant
 * at best and a way to read nothing at all if the client-side id were wrong.
 *
 * The column is asked for by name. If it is ever renamed on the marketing side
 * the query errors, this returns `unknown`, and the Pixel stops loading. That
 * is the right failure: an entitlement read falls back to `*` because showing a
 * paying customer a broken plan is worse than a schema guess, but a consent
 * read has no equivalent excuse for guessing.
 */
export async function readAdvertisingConsent(): Promise<AdvertisingConsent> {
  const client = supabase;
  if (!client) return 'unknown';

  try {
    const { data, error } = await client.
    from('brand_memberships').
    select('advertising_opt_in').
    eq('brand_slug', BRAND_SLUG).
    maybeSingle();

    // A failed read is not consent. Neither is a missing row: nobody has
    // answered yet, and silence is not yes.
    if (error) return 'unknown';
    if (!data) return 'unknown';

    return (data as {advertising_opt_in?: unknown;}).advertising_opt_in === true ?
    'granted' :
    'denied';
  } catch {
    // supabase-js can throw rather than resolve on a transport failure.
    return 'unknown';
  }
}

/**
 * How long must pass before a refocus triggers another read.
 *
 * Alt-tabbing between two windows fires focus repeatedly; without a floor that
 * is a query per flick. Thirty seconds keeps a withdrawal noticed within one
 * return to the app while making a storm of focus events cost one read.
 */
export const RECHECK_INTERVAL_MS = 30_000;

/**
 * Drives the gate for as long as the app is mounted. Renders nothing of its own.
 *
 * Mounted inside `RequireAuth`, so it only ever runs for a signed-in maker.
 */
export function MetaTrackingProvider({ children }: {children: React.ReactNode;}) {
  const { user } = useAuth();

  // Key on the user id, not the session object: supabase-js hands out a freshly
  // parsed session on every token refresh and tab refocus, and depending on the
  // object would re-query on each one. Same reasoning as EntitlementProvider.
  const userId = user?.id ?? null;

  useEffect(() => {
    // Signed out. Close the gate now rather than after a read that has nobody
    // to read for — a sign-out is the one consent change we learn about
    // synchronously and there is no reason to be slow about it.
    if (!userId) {
      setMetaConsent(false);
      return;
    }

    let active = true;
    let lastReadAt = 0;
    let inFlight = false;

    const sync = () => {
      if (inFlight) return;
      inFlight = true;
      lastReadAt = Date.now();
      readAdvertisingConsent().
      then((consent) => {
        if (!active) return;
        // The only expression in this app that opens the gate.
        setMetaConsent(consent === 'granted');
      }).
      finally(() => {
        inFlight = false;
      });
    };

    sync();

    const recheck = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      if (Date.now() - lastReadAt < RECHECK_INTERVAL_MS) return;
      sync();
    };

    // Both, because they do not fire in the same situations: switching browser
    // tabs fires visibilitychange, switching applications fires focus.
    document.addEventListener('visibilitychange', recheck);
    window.addEventListener('focus', recheck);

    return () => {
      active = false;
      document.removeEventListener('visibilitychange', recheck);
      window.removeEventListener('focus', recheck);
      // Unmounting means nothing is watching the flag any more, and a gate
      // nobody is watching must not be left open.
      setMetaConsent(false);
    };
  }, [userId]);

  return <>{children}</>;
}
