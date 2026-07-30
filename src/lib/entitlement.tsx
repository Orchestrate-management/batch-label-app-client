import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useAuth } from './auth';
import { fetchMembership, mapEntitlement, type Entitlement } from './membership';

/**
 * The signed-in maker's entitlement, read once and shared.
 *
 * Read once because several places need it at the same time — the sidebar wants
 * the business name, the designer wants to know whether export is on, the
 * billing screen wants the plan — and three components each firing their own
 * query on every render is how you turn one row into a rate limit.
 */

export interface EntitlementValue extends Entitlement {
  /** True until the first read resolves. Check this before trusting `status`. */
  loading: boolean;
  /** Re-read the membership. Used by the retry on a failed read. */
  refresh: () => void;
}

const UNRESOLVED: Entitlement = {
  status: 'unknown',
  active: false,
  plan: null,
  planStatus: null,
  businessName: null
};

const EntitlementContext = createContext<EntitlementValue | null>(null);

export function EntitlementProvider({ children }: {children: React.ReactNode;}) {
  const { user } = useAuth();
  const [entitlement, setEntitlement] = useState<Entitlement | null>(null);
  const [attempt, setAttempt] = useState(0);

  // Key on the user id, not the session object. supabase-js hands out a freshly
  // parsed session on every token refresh and tab refocus, so depending on the
  // object would re-query on each one.
  const userId = user?.id ?? null;

  useEffect(() => {
    if (!userId) {
      setEntitlement(mapEntitlement(null));
      return;
    }
    let active = true;
    // No setEntitlement(null) here: a refresh revalidates in the background and
    // keeps showing the answer we already have, so a manual retry does not blank
    // the screen someone is working on.
    fetchMembership().then(({ row, failed }) => {
      if (active) setEntitlement(mapEntitlement(row, failed));
    });
    return () => {
      active = false;
    };
  }, [userId, attempt]);

  const refresh = useCallback(() => setAttempt((value) => value + 1), []);

  const value = useMemo<EntitlementValue>(
    () => ({
      ...(entitlement ?? UNRESOLVED),
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
