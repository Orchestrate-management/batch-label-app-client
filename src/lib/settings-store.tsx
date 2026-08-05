import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState } from
'react';
import { setPrintedIdentity, ADDRESS_BLOCKS, type PrintedMarket } from './identity';
import { isSupabaseConfigured } from './supabase';
import { useEntitlement } from './entitlement';
import {
  createDataRequest,
  fetchBusinessIdentity,
  fetchDataRequests,
  fetchSupplierAddresses,
  fetchWorkspacePreferences,
  saveBusinessIdentity,
  saveSupplierAddress,
  saveWorkspacePreferences,
  type BusinessIdentity,
  type BusinessIdentityInput,
  type DataRequest,
  type DataRequestKind,
  type SupplierAddressRecord,
  type WorkspacePreferences } from
'./settings-data';

/**
 * The account's settings, read once and shared — and pushed into what prints.
 *
 * WHY IT IS A PROVIDER AND NOT A HOOK ON THE SETTINGS PAGE. The supplier block prints on every
 * label preview and in sections 1 and 15 of every safety data sheet, and those screens are
 * reachable without ever opening Settings. A maker who saved their business name and then went
 * straight to a label would have seen "[Your registered business name]" on it, which is the
 * defect this whole pass exists to remove: a screen stating something the software has already
 * been told is false.
 *
 * So the read happens once, high up, and `setPrintedIdentity` hands it to the module-level
 * holder in lib/identity.ts that every renderer already imports. The state update that follows
 * re-renders the tree, so nothing reads a stale holder.
 *
 * IT IS CLEARED ON EVERY ACCOUNT CHANGE, including the transition to none. The entitlement
 * provider learned this the hard way (see its own header): a session can be replaced in place
 * with no signed-out frame between, and a cached value that survives that is one person's
 * registered address printed under another person's product name.
 */

export type SettingsStatus = 'unconfigured' | 'no-account' | 'loading' | 'ready' | 'error';

export interface SettingsValue {
  status: SettingsStatus;
  accountId: string | null;
  /** Null means never saved. It does NOT mean a failed read — that is `status: 'error'`. */
  identity: BusinessIdentity | null;
  addresses: SupplierAddressRecord[];
  /** Null means never saved; the defaults below stand in, and nothing pretends otherwise. */
  preferences: WorkspacePreferences | null;
  requests: DataRequest[];
  /** Only ever set alongside `status: 'error'`. */
  error: string | null;
  reload: () => void;
  /**
   * Every save hands back the row the DATABASE returned, never the input it was given.
   * The screen redraws from that, so what a maker sees after a save is what is stored —
   * trimmed, defaulted and normalised — rather than what they typed.
   */
  saveIdentity: (
  input: BusinessIdentityInput)
  => Promise<{error: string | null;value: BusinessIdentity | null;}>;
  saveAddress: (
  market: PrintedMarket,
  lines: string[])
  => Promise<{error: string | null;value: SupplierAddressRecord | null;}>;
  savePreferences: (next: WorkspacePreferences) => Promise<{error: string | null;}>;
  requestData: (kind: DataRequestKind) => Promise<{error: string | null;}>;
}

/**
 * What the app behaves as before anybody has saved a preference.
 *
 * `enabled_categories` is NOT NULL with a `cardinality(...) > 0` CHECK and is not being
 * migrated, so every write still sends the one category there is. It matches the column's own
 * default now, which it did not when there were three.
 */
export const DEFAULT_PREFERENCES: WorkspacePreferences = {
  enabledCategories: ['home-fragrance'],
  defaultMarket: null,
  defaultExport: null
};

/**
 * Said when a save is attempted before the entitlement has resolved an account.
 *
 * It is not "something went wrong": nothing was attempted and nothing was lost. The screens
 * that can reach it never render an enabled save button in this state, so it is a backstop
 * rather than copy anybody should normally see.
 */
const NO_ACCOUNT_YET =
'We have not worked out which workspace this is yet, so nothing was sent. Reload the page and try again.';

/**
 * Exported so a test can mount a screen over a KNOWN store state — ready, mid-read, refused —
 * without a database. The app never uses it directly; it uses the provider below.
 */
export const SettingsContext = createContext<SettingsValue | null>(null);

export function SettingsProvider({ children }: {children: React.ReactNode;}) {
  const entitlement = useEntitlement();
  const accountId = entitlement.accountId;

  const [read, setRead] = useState<{
    accountId: string;
    identity: BusinessIdentity | null;
    addresses: SupplierAddressRecord[];
    preferences: WorkspacePreferences | null;
    requests: DataRequest[];
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    if (!accountId) {
      // Nobody's identity is current once we do not know whose workspace this is. Left set,
      // it would print under the next account's products.
      setPrintedIdentity(null);
      setRead(null);
      setError(null);
      return;
    }

    let active = true;
    setError(null);

    void Promise.all([
    fetchBusinessIdentity(accountId),
    fetchSupplierAddresses(accountId),
    fetchWorkspacePreferences(accountId),
    fetchDataRequests(accountId)]
    ).then(([identityResult, addressResult, preferencesResult, requestResult]) => {
      if (!active) return;

      // THE IDENTITY READ IS THE ONE THAT MAY NOT DEGRADE QUIETLY. If we could not read it we
      // must not print placeholders as though the account had told us nothing — that is the
      // "empty state and failure state share a sentence" fault. The holder is cleared, the
      // status goes to error, and the screen says which it is.
      if (!identityResult.ok) {
        setPrintedIdentity(null);
        setRead(null);
        setError(identityResult.message);
        return;
      }
      if (!addressResult.ok) {
        setPrintedIdentity(null);
        setRead(null);
        setError(addressResult.message);
        return;
      }

      setPrintedIdentity({
        business: identityResult.value,
        addresses: addressResult.value.map((address) => ({
          market: address.market,
          lines: address.lines
        }))
      });

      setRead({
        accountId,
        identity: identityResult.value,
        addresses: addressResult.value,
        // A failed preferences or requests read is not allowed to hide the identity, which is
        // the one thing on this provider that prints. Both fall back to "nothing stored",
        // and both are re-read by `reload`.
        preferences: preferencesResult.ok ? preferencesResult.value : null,
        requests: requestResult.ok ? requestResult.value : []
      });
      setError(null);
    });

    return () => {
      active = false;
    };
  }, [accountId, attempt]);

  const reload = useCallback(() => setAttempt((value) => value + 1), []);

  const status: SettingsStatus = !isSupabaseConfigured ?
  'unconfigured' :
  entitlement.loading ?
  'loading' :
  !accountId ?
  'no-account' :
  error ?
  'error' :
  read && read.accountId === accountId ?
  'ready' :
  'loading';

  // Derived at render, never in an effect, so there is no frame in which the previous
  // account's identity is published as this account's.
  const current = read && read.accountId === accountId ? read : null;

  const saveIdentity = useCallback(
    async (input: BusinessIdentityInput) => {
      if (!accountId) return { error: NO_ACCOUNT_YET, value: null };
      const result = await saveBusinessIdentity(accountId, input);
      if (!result.ok) return { error: result.message, value: null };
      setRead((previous) =>
      previous && previous.accountId === accountId ?
      { ...previous, identity: result.value } :
      previous
      );
      setPrintedIdentity({
        business: result.value,
        addresses: (current?.addresses ?? []).map((address) => ({
          market: address.market,
          lines: address.lines
        }))
      });
      return { error: null, value: result.value };
    },
    [accountId, current]
  );

  const saveAddress = useCallback(
    async (market: PrintedMarket, lines: string[]) => {
      if (!accountId) return { error: NO_ACCOUNT_YET, value: null };
      const block = ADDRESS_BLOCKS[market];
      const result = await saveSupplierAddress(accountId, {
        market,
        label: block.label,
        role: block.role,
        isDefault: block.isDefault,
        lines
      });
      if (!result.ok) return { error: result.message, value: null };

      const next = [
      ...(current?.addresses ?? []).filter((address) => address.market !== market),
      result.value];

      setRead((previous) =>
      previous && previous.accountId === accountId ? { ...previous, addresses: next } : previous
      );
      setPrintedIdentity({
        business: current?.identity ?? null,
        addresses: next.map((address) => ({ market: address.market, lines: address.lines }))
      });
      return { error: null, value: result.value };
    },
    [accountId, current]
  );

  const savePreferences = useCallback(
    async (next: WorkspacePreferences) => {
      if (!accountId) return { error: NO_ACCOUNT_YET };
      const result = await saveWorkspacePreferences(accountId, next);
      if (!result.ok) return { error: result.message };
      setRead((previous) =>
      previous && previous.accountId === accountId ?
      { ...previous, preferences: result.value } :
      previous
      );
      return { error: null };
    },
    [accountId]
  );

  const requestData = useCallback(
    async (kind: DataRequestKind) => {
      if (!accountId) return { error: NO_ACCOUNT_YET };
      const result = await createDataRequest(accountId, kind);
      if (!result.ok) return { error: result.message };
      setRead((previous) =>
      previous && previous.accountId === accountId ?
      { ...previous, requests: [result.value, ...previous.requests] } :
      previous
      );
      return { error: null };
    },
    [accountId]
  );

  const value = useMemo<SettingsValue>(
    () => ({
      status,
      accountId,
      identity: current?.identity ?? null,
      addresses: current?.addresses ?? [],
      preferences: current?.preferences ?? null,
      requests: current?.requests ?? [],
      error,
      reload,
      saveIdentity,
      saveAddress,
      savePreferences,
      requestData
    }),
    [
    status,
    accountId,
    current,
    error,
    reload,
    saveIdentity,
    saveAddress,
    savePreferences,
    requestData]

  );

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): SettingsValue {
  const value = useContext(SettingsContext);
  if (!value) throw new Error('useSettings must be used inside SettingsProvider');
  return value;
}

/**
 * The same store, or null when there is no provider above.
 *
 * `WorkspaceProvider` uses this rather than `useSettings` so that it still works standalone —
 * several test harnesses in this repo mount it on its own, and a provider that throws when a
 * sibling is missing turns a rendering test into a wiring test. Outside a SettingsProvider the
 * category toggles are session state, exactly as they were before this existed, and the
 * Preferences screen (which does require the provider) is the only place that claims a save.
 */
export function useOptionalSettings(): SettingsValue | null {
  return useContext(SettingsContext);
}

