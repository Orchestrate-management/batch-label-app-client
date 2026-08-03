import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useAuth } from './auth';
import {
  fetchEntitlement,
  mapEntitlement,
  UNRESOLVED_ENTITLEMENT,
  type Entitlement } from
'./membership';

/**
 * The signed-in maker's entitlement, read once and shared.
 *
 * Read once because several places need it at the same time — the sidebar wants
 * the business name, the designer wants to know whether export is on, the
 * billing page wants the plan, the allowance and the period end — and four
 * components each firing their own query on every render is how you turn one row
 * into a rate limit.
 */

export interface EntitlementValue extends Entitlement {
  /** True until the first read resolves. Check this before trusting `status`. */
  loading: boolean;
  /**
   * Re-read the entitlement. Used by the retry on a failed read, and by the
   * return-from-checkout poll: the subscription row is written by a Stripe
   * webhook that races the browser redirect, so the billing return screen asks
   * again on a backoff until the row says what happened.
   */
  refresh: () => void;
}

const EntitlementContext = createContext<EntitlementValue | null>(null);

export function EntitlementProvider({ children }: {children: React.ReactNode;}) {
  const { user } = useAuth();
  /**
   * The entitlement AND the user it was read for, held together and never apart.
   *
   * IT USED TO BE THE ROW ALONE, reset only inside `if (!userId)` — that is, only on a
   * sign-out. A session can be replaced in place, with no signed-out frame between: a
   * cross-tab sign-in over the shared .batchlabel.xyz cookie, or an auth callback landing in
   * a tab that is already signed in. RequireAuth gates on "is there a session", so it keeps
   * the providers mounted straight through that, and the cached row survived as A's while
   * the JWT became B's.
   *
   * What made that expensive is downstream. `loading` was `entitlement === null`, so it was
   * already false; `accountId` was still A's; and ProductsProvider reads `!loading` as "the
   * account is resolved" and fires its one deliberately-scoped read with it. Under B's JWT
   * that returns nothing, and the store publishes {ready, []} — the empty state, on an
   * account with products. Isolation held (a wrong id shows too little, never somebody
   * else's rows) but the screen stated something the software had not established, which is
   * the house rule, and to a maker with forty SKUs "you have no products yet" reads as loss.
   *
   * So the identity is part of the value. A mismatch is not stale data to be corrected on
   * the next tick; it is an answer about a different person, and it is worth nothing.
   */
  const [read, setRead] = useState<{userId: string | null;entitlement: Entitlement;} | null>(null);
  const [attempt, setAttempt] = useState(0);

  // Key on the user id, not the session object. supabase-js hands out a freshly
  // parsed session on every token refresh and tab refocus, so depending on the
  // object would re-query on each one.
  const userId = user?.id ?? null;

  useEffect(() => {
    if (!userId) {
      setRead({ userId: null, entitlement: mapEntitlement(null) });
      return;
    }
    let active = true;
    // No reset to null here: a refresh revalidates in the background and keeps
    // showing the answer we already have, so a manual retry does not blank the
    // screen someone is working on. That is safe precisely because the identity
    // check below is on the value rather than in this effect — a re-read for the
    // SAME user keeps the old row, a change of user does not.
    fetchEntitlement().then(({ row, failed }) => {
      if (active) setRead({ userId, entitlement: mapEntitlement(row, failed) });
    });
    return () => {
      active = false;
    };
  }, [userId, attempt]);

  const refresh = useCallback(() => setAttempt((value) => value + 1), []);

  // Derived at render, not in an effect, so there is no frame in which the previous user's
  // account id is published as resolved. `loading` stays true until the entitlement for the
  // CURRENT user has landed, which is what every consumer already assumes it means.
  const entitlement = read && read.userId === userId ? read.entitlement : null;

  const value = useMemo<EntitlementValue>(
    () => ({
      ...(entitlement ?? UNRESOLVED_ENTITLEMENT),
      loading: entitlement === null,
      refresh
    }),
    [entitlement, refresh]
  );

  return <EntitlementContext.Provider value={value}>{children}</EntitlementContext.Provider>;
}

export function useEntitlement(): EntitlementValue {
  const value = useContext(EntitlementContext);
  if (!value) throw new Error('useEntitlement must be used inside EntitlementProvider');
  return value;
}
