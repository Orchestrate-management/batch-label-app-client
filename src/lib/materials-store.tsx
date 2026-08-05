import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useAuth } from './auth';
import { useEntitlement } from './entitlement';
import { publishMaterialStatus, publishMaterials, resetMaterials } from './material-index';
import { fetchMaterials } from './materials';
import { Material } from './model';

/**
 * The signed-in account's materials register, read once and shared.
 *
 * DELIBERATELY THE SAME SHAPE AS ProductsProvider, down to the state names, because it has
 * the same four problems and getting a different answer to any of them would be a bug rather
 * than a style. Read that file's header for the argument; what follows is only what differs.
 *
 * WHAT DIFFERS: this provider also publishes into the synchronous index in
 * lib/material-index.ts, which is what `derive`, `buildSds`, `regimes` and `pipeline` read
 * during render. So there are two consumers of one read — components, through the hook, and
 * the derivation, through the index — and they must never disagree. That is why the index is
 * written in the same statement that sets the state, and why every non-ready state publishes
 * a non-ready STATUS rather than an empty list: `materialsSettled()` is what stops an
 * unfinished read being rendered as "this material is not classified as hazardous".
 *
 * ON SIGN-OUT AND ON A CHANGE OF USER THE INDEX IS RESET, not merely re-fetched. A materials
 * register read under A's JWT is not a stale answer about B; it is somebody else's supplier
 * data, and it would be resolved into B's label until the new read landed.
 */

export type MaterialsStatus =
'loading' |
'ready' |
'error' |
/** Suspended. The account holds materials; we are declining to show them. */
'unavailable' |
/** No account resolved, so there is nothing to scope a read to. Nothing failed. */
'no-account';

export interface MaterialsValue {
  status: MaterialsStatus;
  /** Empty unless `status` is 'ready'. Never read this without checking the status first. */
  materials: Material[];
  /** Set only when `status` is 'error'. Customer-safe: it blames us, never them. */
  error: string | null;
  /** The account the register belongs to. Every write needs it; see materials.ts. */
  accountId: string | null;
  refresh: () => void;
  /** Re-read and resolve when it has landed. Used after a write, so a screen can show it. */
  reload: () => Promise<void>;
}

const MaterialsContext = createContext<MaterialsValue | null>(null);

export function MaterialsProvider({ children }: {children: React.ReactNode;}) {
  const { user } = useAuth();
  const entitlement = useEntitlement();
  const [state, setState] = useState<{
    userId: string | null;
    status: MaterialsStatus;
    materials: Material[];
    error: string | null;
  }>({ userId: null, status: 'loading', materials: [], error: null });
  const [attempt, setAttempt] = useState(0);

  const userId = user?.id ?? null;
  const accountId = entitlement.loading ? null : entitlement.accountId;
  const accountResolved = !entitlement.loading;
  const suspended = accountResolved && entitlement.status === 'suspended';

  /** One place that sets both the React state and the index they must agree on. */
  const publish = useCallback(
    (
    next: {userId: string | null;status: MaterialsStatus;materials: Material[];error: string | null;},
    forAccount: string | null) =>
    {
      setState(next);
      if (next.status === 'ready') publishMaterials(forAccount, next.materials);else
      if (next.status === 'error') publishMaterialStatus('error', forAccount);else
      if (next.status === 'loading') publishMaterialStatus('loading', forAccount);else
      publishMaterialStatus('unavailable', forAccount);
    },
    []
  );

  const read = useCallback(async () => {
    if (!userId) return;
    if (suspended) {
      publish({ userId, status: 'unavailable', materials: [], error: null }, accountId);
      return;
    }
    if (accountResolved && !accountId) {
      publish({ userId, status: 'no-account', materials: [], error: null }, null);
      return;
    }
    if (!accountId) return;

    const result = await fetchMaterials(accountId);
    publish(
      result.ok ?
      { userId, status: 'ready', materials: result.materials, error: null } :
      { userId, status: 'error', materials: [], error: result.message },
      accountId
    );
  }, [userId, accountId, accountResolved, suspended, publish]);

  useEffect(() => {
    if (!userId) {
      setState({ userId: null, status: 'loading', materials: [], error: null });
      // Not `publishMaterialStatus('loading')`: signed out is not a read in flight, and the
      // next signed-in user must not inherit one byte of the last one's register.
      resetMaterials();
      return;
    }
    if (!accountResolved) return;
    if (suspended) {
      publish({ userId, status: 'unavailable', materials: [], error: null }, accountId);
      return;
    }
    if (!accountId) {
      publish({ userId, status: 'no-account', materials: [], error: null }, null);
      return;
    }
    let active = true;
    void fetchMaterials(accountId).then((result) => {
      if (!active) return;
      publish(
        result.ok ?
        { userId, status: 'ready', materials: result.materials, error: null } :
        { userId, status: 'error', materials: [], error: result.message },
        accountId
      );
    });
    return () => {
      active = false;
    };
  }, [userId, accountId, accountResolved, suspended, attempt, publish]);

  const mine = state.userId === userId;

  const value = useMemo<MaterialsValue>(
    () => ({
      status: mine ? state.status : 'loading',
      materials: mine ? state.materials : [],
      error: mine ? state.error : null,
      accountId,
      refresh: () => setAttempt((value) => value + 1),
      reload: read
    }),
    [state, mine, accountId, read]
  );

  return <MaterialsContext.Provider value={value}>{children}</MaterialsContext.Provider>;
}

export function useMaterials(): MaterialsValue {
  const value = useContext(MaterialsContext);
  if (!value) throw new Error('useMaterials must be used inside MaterialsProvider');
  return value;
}

/**
 * The same subscription, for screens that READ THE REGISTER THROUGH THE MODULE INDEX rather
 * than out of this value — and therefore need to be woken up rather than supplied.
 *
 * THE DISTINCTION IS NOT COSMETIC. `useMaterials` above throws because a picker with no
 * register behind it has nothing to offer and would render an empty select that looks like an
 * empty account; that is a wiring mistake and it should be loud. Studio, Specification and the
 * artefact designer are a different case: they call `derive`, `stagesFor`, `buildSds` and
 * `obligationState`, all of which read lib/material-index.ts directly and all of which already
 * have a true answer for "the register has not answered" — so with no provider above them they
 * do not lie, they simply say `not-tracked` and "Not worked out" forever.
 *
 * What they cannot do without a subscription is NOTICE the register arriving. MaterialsProvider
 * publishes asynchronously from above the router, and React does not re-render a subtree whose
 * `children` element has not changed — only context consumers. So the hook is the wake-up, and
 * the returned value goes in their memo keys.
 *
 * The provider being absent in the real app is caught by src/App.split.test.ts, which asserts
 * the tree in App.tsx, rather than by a throw here that would only fire in test harnesses that
 * are deliberately mounting one screen.
 */
export function useOptionalMaterials(): MaterialsValue | null {
  return useContext(MaterialsContext);
}
