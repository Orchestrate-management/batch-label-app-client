import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useAuth } from './auth';
import { useOptionalActiveAccount } from './active-account';
import {
  fetchEntitlement,
  fetchEntitlementForAccount,
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
   * True when a write THIS APP MADE has moved the SKU count and the read that answers for it has
   * not landed yet. The number in `skuCount` is then the one from before the write: not unread,
   * and not right.
   *
   * Read it through `readSkuCount(entitlement.skuCount, entitlement.skuCountStale)` rather than
   * as a bare boolean, for the same reason `canModify` is read through `mayModify` — the pair
   * has three meaningful states and a screen that looks at either half alone will get one of
   * them wrong.
   */
  skuCountStale: boolean;
  /**
   * Re-read the entitlement. Used by the retry on a failed read, and by the
   * return-from-checkout poll: the subscription row is written by a Stripe
   * webhook that races the browser redirect, so the billing return screen asks
   * again on a backoff until the row says what happened.
   */
  refresh: () => void;
  /**
   * SAY THAT A WRITE WE JUST MADE MOVED THE SKU COUNT. Marks the held number stale and re-reads,
   * in that order and as one call, because they are one fact: the number we are holding is wrong
   * and we have gone to find the new one.
   *
   * This is the seam a create calls (NewProductDialog) and the seam an archive or delete path
   * must call when one exists — the browser holds no DELETE grant on `products` today and
   * nothing in `src/pages/**` archives one, so there is exactly one caller. Whoever adds the
   * second should call this and not `refresh`: `refresh` alone re-reads while leaving a number
   * on screen that we already know is a create behind, which is what happened before this
   * existed.
   *
   * Not for a REFUSED create. Nothing moved, and SkuLimitNotice takes the refusal itself as its
   * input precisely because the refusal is the established fact and a re-read would replace it
   * with an older guess.
   */
  noteSkuCountChanged: () => void;
}

const EntitlementContext = createContext<EntitlementValue | null>(null);

/**
 * One read, from whichever of the two sources this database actually has.
 *
 * Exported so a test can drive both halves without a provider tree. The fallback is on
 * `missing` alone: a read that failed for any other reason is reported as a failure rather than
 * retried against a second source, because asking a different question after the first one broke
 * is how "we could not check your plan" turns into "you are on the free plan".
 */
export async function readEntitlement(accountId: string | null) {
  if (accountId) {
    const keyed = await fetchEntitlementForAccount(accountId);
    if (!keyed.missing) return { row: keyed.row, failed: keyed.failed };
  }
  return fetchEntitlement();
}

export function EntitlementProvider({ children }: {children: React.ReactNode;}) {
  const { user } = useAuth();
  /**
   * WHICH ACCOUNT THIS IS AN ENTITLEMENT FOR, WHICH IS NO LONGER "whichever one they own".
   *
   * The read is keyed on the ACTIVE account now, because `public.entitlements` resolves its
   * account through `owner_user_id` and therefore returns nothing at all for an invited member.
   * `public.account_entitlement(account_id)` is keyed on the account instead, and hands any
   * member the account's allowance plus their own role in it.
   *
   * OPTIONAL, DELIBERATELY. Several tests mount this provider on its own, and the whole app
   * behaved correctly against the view for as long as every account was one person. With no
   * provider above, and on a database that predates `my_accounts`, this falls straight back to
   * the view and nothing changes.
   */
  const active = useOptionalActiveAccount();
  const activeStatus = active?.status ?? 'legacy';
  const activeAccountId = active?.accountId ?? null;
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
  /**
   * Whether a write of ours has moved the SKU count since the number we are holding was read.
   *
   * Held here rather than derived, because nothing in the row can show it: `sku_count` is a
   * number and looks exactly as authoritative a create later as it did a create earlier. It is
   * set by `noteSkuCountChanged` and cleared by the read that answers for it — never by a
   * timeout and never by a render, so there is no frame in which we have quietly decided the
   * old number is current again.
   */
  const [countStale, setCountStale] = useState(false);

  // Key on the user id, not the session object. supabase-js hands out a freshly
  // parsed session on every token refresh and tab refocus, so depending on the
  // object would re-query on each one.
  const userId = user?.id ?? null;

  useEffect(() => {
    if (!userId) {
      setRead({ userId: null, entitlement: mapEntitlement(null) });
      // Nobody's count is outstanding once nobody is signed in. Left set, it would follow the
      // next person into their first frame and suppress a number that is theirs and current.
      setCountStale(false);
      return;
    }
    // Nothing to ask yet. The account list has not landed, so a read fired here would either be
    // unscoped or scoped to the wrong account, and both are worse than one more frame of the
    // skeleton every screen already draws.
    if (activeStatus === 'loading') return;

    // The account list came back holding nothing this person is a member of, or holding more
    // than one with none chosen. Neither is a state to ask the database about: there is no
    // account to name. `mapEntitlement(null)` is `no_membership`, which every screen already
    // knows how to say, and the chooser in App.tsx is what a person actually sees for the
    // second case.
    if (activeStatus === 'none' || activeStatus === 'choose') {
      setRead({ userId, entitlement: mapEntitlement(null) });
      setCountStale(false);
      return;
    }

    let active = true;
    // No reset to null here: a refresh revalidates in the background and keeps
    // showing the answer we already have, so a manual retry does not blank the
    // screen someone is working on. That is safe precisely because the identity
    // check below is on the value rather than in this effect — a re-read for the
    // SAME user keeps the old row, a change of user does not.
    //
    // TWO SOURCES AND ONE FALLBACK. With an active account resolved, the read is
    // `account_entitlement(id)`, which answers for members as well as owners. Where that
    // function does not exist — a database that stops before 20260805120000, which is the
    // ordinary state of an environment the day this app deploys ahead of its migrations — the
    // view still answers for the owner, which is who every account held before roles existed.
    void readEntitlement(activeAccountId).then(({ row, failed }) => {
      if (!active) return;
      setRead({ userId, entitlement: mapEntitlement(row, failed) });
      // This read started at or after the note that set the flag — an earlier one in flight has
      // already had `active` set false by the cleanup below — so its answer is the one that
      // covers the write, and the number it carries is current. A failed read clears the flag
      // too, and correctly: `mapEntitlement(null, true)` carries no count at all, so it reads as
      // `unread` rather than as a stale number we are still pretending to hold.
      setCountStale(false);
    });
    return () => {
      active = false;
    };
  }, [userId, attempt, activeStatus, activeAccountId]);

  const refresh = useCallback(() => setAttempt((value) => value + 1), []);

  const noteSkuCountChanged = useCallback(() => {
    setCountStale(true);
    setAttempt((value) => value + 1);
  }, []);

  // Derived at render, not in an effect, so there is no frame in which the previous user's
  // account id is published as resolved. `loading` stays true until the entitlement for the
  // CURRENT user has landed, which is what every consumer already assumes it means.
  const entitlement = read && read.userId === userId ? read.entitlement : null;

  const value = useMemo<EntitlementValue>(
    () => ({
      ...(entitlement ?? UNRESOLVED_ENTITLEMENT),
      loading: entitlement === null,
      skuCountStale: countStale,
      refresh,
      noteSkuCountChanged
    }),
    [entitlement, countStale, refresh, noteSkuCountChanged]
  );

  return <EntitlementContext.Provider value={value}>{children}</EntitlementContext.Provider>;
}

export function useEntitlement(): EntitlementValue {
  const value = useContext(EntitlementContext);
  if (!value) throw new Error('useEntitlement must be used inside EntitlementProvider');
  return value;
}
