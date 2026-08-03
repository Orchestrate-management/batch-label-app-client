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
 * THREE STATES, AND THEY ARE NOT INTERCHANGEABLE.
 *
 *   loading  we have not finished asking. Screens show a skeleton. They must not show an
 *            empty state: "you have no products" is a claim, and we do not yet know.
 *   error    we asked and could not get an answer. Screens say so, blame us, and offer a
 *            retry. THIS IS THE ONE THAT MATTERS. A failed read rendered as "you have no
 *            products yet" is indistinguishable from a brand new account, and to a maker
 *            with forty SKUs it reads as "your data is gone" — which is a support ticket, a
 *            frightening ten minutes, and quite possibly a cancellation, over a dropped
 *            request that fixed itself on the next reload.
 *   ready    we asked and got an answer. An empty list here IS the answer, and it is the
 *            first screen every real customer ever sees.
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

export type ProductsStatus = 'loading' | 'ready' | 'error';

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
  const [state, setState] = useState<{status: ProductsStatus;products: Product[];error: string | null;}>(
    { status: 'loading', products: [], error: null }
  );
  const [attempt, setAttempt] = useState(0);

  // Key on the user id, not the session object: supabase-js hands out a freshly parsed
  // session on every token refresh and tab refocus, and depending on the object would
  // re-query the whole list on each one.
  const userId = user?.id ?? null;

  // Null is "we do not know which account", not "no filter is needed" — a failed entitlement
  // read lands here too. fetchProducts falls back to RLS alone in that case and says so.
  const accountId = entitlement.loading ? null : entitlement.accountId;
  const accountResolved = !entitlement.loading;

  const read = useCallback(async () => {
    if (!userId) return;
    const result = await fetchProducts(accountId);
    setState(
      result.ok ?
      { status: 'ready', products: result.products, error: null } :
      { status: 'error', products: [], error: result.message }
    );
  }, [userId, accountId]);

  useEffect(() => {
    if (!userId) {
      // Signed out is neither an empty account nor a failure, and nothing renders behind the
      // auth gate anyway, so there is no answer worth publishing.
      setState({ status: 'loading', products: [], error: null });
      return;
    }
    // Hold at `loading` until the entitlement has answered, so the one read we fire is scoped
    // to the account it resolved. A failed entitlement read still resolves — to null — so this
    // cannot wait forever on one that went wrong.
    if (!accountResolved) return;
    let active = true;
    // No reset to 'loading' on a re-read: a retry revalidates in the background and keeps
    // showing the answer we already have, so pressing "try again" does not blank a screen
    // somebody is working on.
    void fetchProducts(accountId).then((result) => {
      if (!active) return;
      setState(
        result.ok ?
        { status: 'ready', products: result.products, error: null } :
        { status: 'error', products: [], error: result.message }
      );
    });
    return () => {
      active = false;
    };
  }, [userId, accountId, accountResolved, attempt]);

  const value = useMemo<ProductsValue>(
    () => ({
      status: state.status,
      products: state.products,
      error: state.error,
      refresh: () => setAttempt((value) => value + 1),
      reload: read
    }),
    [state, read]
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
 * means we have not looked yet; null on an error means we could not look; null when ready is
 * the only one that means "there is no such product". A screen that renders "no such product"
 * during the first two hundred milliseconds sends people back to a list they just came from,
 * and one that renders it after a failed read tells them their product has been deleted.
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
