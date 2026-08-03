import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useAuth } from './auth';
import { useEntitlement } from './entitlement';
import { Product } from './model';
import { fetchProducts } from './products';

/**
 * The signed-in account's products, read once and shared.
 *
 * WHAT THIS REPLACES. `useSyncExternalStore(subscribeProducts, allProducts)` over a
 * module-level array. That store had no concept of a read at all, so it had no loading state
 * and no error state — there was nothing to load and nothing that could fail. Reading from a
 * database introduces both, and the distinction between them is the entire point of this
 * module.
 *
 * FOUR STATES, AND THEY ARE NOT INTERCHANGEABLE.
 *
 *   loading      we have not finished asking. Screens show a skeleton. They must not show an
 *                empty state: "you have no products" is a claim, and we do not yet know.
 *   error        we asked and could not get an answer. Screens say so, blame us, and offer a
 *                retry. THIS IS THE ONE THAT MATTERS. A failed read rendered as "you have no
 *                products yet" is indistinguishable from a brand new account, and to a maker
 *                with forty SKUs it reads as "your data is gone" — which is a support ticket,
 *                a frightening ten minutes, and quite possibly a cancellation, over a dropped
 *                request that fixed itself on the next reload.
 *   unavailable  this account's rows are withheld from it, and we know why. Screens say the
 *                why. See below; it is the state this file was missing.
 *   ready        we asked and got an answer. An empty list here IS the answer, and it is the
 *                first screen every real customer ever sees.
 *
 * WHY `unavailable` HAD TO EXIST. `is_member_of` gained a second gate — the ACCOUNT's standing
 * on its brand, not just the person's membership of the account — so a suspended business now
 * reads zero rows, with no error, from every table. Every ingredient of the paragraph above
 * then lines up the wrong way: the read succeeds, the list is legitimately empty, the store
 * publishes 'ready' with [], and Studio and Products render "Nothing here yet, and that is the
 * right place to start" to a maker holding forty SKUs. It is the exact ticket this module's
 * three states were written to prevent, arriving through the one door they did not cover — not
 * a failed read, but a refused one that looks like an empty account.
 *
 * The database is right not to say so in an error (section 3 of the migration argues it at
 * length: a policy refusal that explains itself is a policy refusal that can be used to probe).
 * It does not have to. `entitlements.membership_status` is a column, the app reads it before it
 * renders anything, and by the time this provider runs the answer is already in hand as
 * `entitlement.status === 'suspended'`. So the read is not fired at all: a query whose answer
 * we can predict, and whose answer would be a lie on the screen, is not worth a round trip.
 *
 * WHY A PROVIDER RATHER THAN A HOOK PER SCREEN. Studio, the products table, the specification
 * screen and the settings identity tab all want the same list at the same time, and four
 * components each firing their own query on every render is how you turn one read into a rate
 * limit. Same reasoning, and the same shape, as EntitlementProvider.
 *
 * WHY IT WAITS FOR THE ENTITLEMENT. The account to scope the read to comes from the
 * entitlement, which resolves it for THIS deployment's brand. Firing the read before that
 * lands would mean one unscoped read followed by a scoped one — twice the queries, and, the
 * day a person holds accounts on two Orchestrate brands, a first paint listing both accounts'
 * products before the correct list replaces it. One read, after one row, is the cheaper and
 * the honest order. Holding at `loading` in the meantime is exactly what that state is for:
 * screens show a skeleton, and none of them claims the account is empty.
 */

export type ProductsStatus = 'loading' | 'ready' | 'error' | 'unavailable';

export interface ProductsValue {
  status: ProductsStatus;
  /** Empty unless `status` is 'ready'. Never read this without checking the status first. */
  products: Product[];
  /** Set only when `status` is 'error'. Customer-safe: it blames us, never them. */
  error: string | null;
  /** Re-read in the background, keeping whatever is on screen until the answer arrives. */
  refresh: () => void;
  /**
   * Re-read and resolve when it has landed. Used after a write, so that a screen can navigate
   * to a product it just created and find it in the list rather than racing the refresh.
   */
  reload: () => Promise<void>;
}

const ProductsContext = createContext<ProductsValue | null>(null);

export function ProductsProvider({ children }: {children: React.ReactNode;}) {
  const { user } = useAuth();
  const entitlement = useEntitlement();
  /**
   * The answer, and the user it is an answer about. Same rule as EntitlementProvider, and for
   * the same reason: a session can be replaced in place with no signed-out frame, and a list
   * read under A's JWT is not a partial answer about B — it is somebody else's data on B's
   * screen. It is discarded on identity change rather than corrected on the next read.
   */
  const [state, setState] = useState<{userId: string | null;status: ProductsStatus;products: Product[];error: string | null;}>(
    { userId: null, status: 'loading', products: [], error: null }
  );
  const [attempt, setAttempt] = useState(0);

  // Key on the user id, not the session object: supabase-js hands out a freshly parsed
  // session on every token refresh and tab refocus, and depending on the object would
  // re-query the whole list on each one.
  const userId = user?.id ?? null;

  // Null is "we do not know which account", not "no filter is needed" — a failed entitlement
  // read lands here too. fetchProducts falls back to RLS alone in that case, and refuses to
  // publish a list that turns out to span two accounts.
  const accountId = entitlement.loading ? null : entitlement.accountId;
  const accountResolved = !entitlement.loading;

  /**
   * Suspension, from the read the entitlement provider has already made.
   *
   * ONLY `suspended`. Not free, not lapsed, not past_due, not unknown — those are money
   * states and `is_member_of` deliberately does not consult one of them, so every one of
   * those customers can still read and write everything they hold (§6.1: "no new, keep
   * everything old fully working"). Withholding the list from a lapsed maker would be the
   * same lie in the other direction, and a worse one: they can see their products, and we
   * would be telling them they cannot.
   */
  const suspended = accountResolved && entitlement.status === 'suspended';

  const read = useCallback(async () => {
    if (!userId) return;
    if (suspended) {
      setState({ userId, status: 'unavailable', products: [], error: null });
      return;
    }
    const result = await fetchProducts(accountId);
    setState(
      result.ok ?
      { userId, status: 'ready', products: result.products, error: null } :
      { userId, status: 'error', products: [], error: result.message }
    );
  }, [userId, accountId, suspended]);

  useEffect(() => {
    if (!userId) {
      // Signed out is neither an empty account nor a failure, and nothing renders behind the
      // auth gate anyway, so there is no answer worth publishing.
      setState({ userId: null, status: 'loading', products: [], error: null });
      return;
    }
    // Hold at `loading` until the entitlement has answered, so the one read we fire is scoped
    // to the account it resolved. A failed entitlement read still resolves — to null — so this
    // cannot wait forever on one that went wrong.
    if (!accountResolved) return;
    // The one read we would fire is a read we already know returns nothing, and 'ready' with
    // nothing is the false sentence. Publish the fact instead.
    if (suspended) {
      setState({ userId, status: 'unavailable', products: [], error: null });
      return;
    }
    let active = true;
    // No reset to 'loading' on a re-read: a retry revalidates in the background and keeps
    // showing the answer we already have, so pressing "try again" does not blank a screen
    // somebody is working on.
    void fetchProducts(accountId).then((result) => {
      if (!active) return;
      setState(
        result.ok ?
        { userId, status: 'ready', products: result.products, error: null } :
        { userId, status: 'error', products: [], error: result.message }
      );
    });
    return () => {
      active = false;
    };
  }, [userId, accountId, accountResolved, suspended, attempt]);

  // Derived at render, so a change of signed-in user cannot leave one paint showing the
  // previous account's list. An answer about somebody else is `loading`, not `ready`.
  const mine = state.userId === userId;

  const value = useMemo<ProductsValue>(
    () => ({
      status: mine ? state.status : 'loading',
      products: mine ? state.products : [],
      error: mine ? state.error : null,
      refresh: () => setAttempt((value) => value + 1),
      reload: read
    }),
    [state, mine, read]
  );

  return <ProductsContext.Provider value={value}>{children}</ProductsContext.Provider>;
}

export function useProducts(): ProductsValue {
  const value = useContext(ProductsContext);
  if (!value) throw new Error('useProducts must be used inside ProductsProvider');
  return value;
}

/**
 * One product from the list already in memory.
 *
 * `product === null` means nothing on its own — READ THE STATUS FIRST. Null while loading
 * means we have not looked yet; null on an error means we could not look; null on
 * `unavailable` means the account's rows are withheld and this one is almost certainly still
 * there; null when ready is the only one that means "there is no such product". A screen that
 * renders "no such product" during the first two hundred milliseconds sends people back to a
 * list they just came from, and one that renders it after a failed or refused read tells them
 * their product has been deleted.
 */
export function useProduct(id: string | undefined): {
  status: ProductsStatus;
  product: Product | null;
  error: string | null;
  refresh: () => void;
} {
  const { status, products, error, refresh } = useProducts();
  const product = id ? products.find((entry) => entry.id === id) ?? null : null;
  return { status, product, error, refresh };
}
