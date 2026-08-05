import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState } from
'react';
import { useAuth } from './auth';
import { reportError } from './report-error';
import {
  DEFAULT_MATRIX,
  mayAct,
  matrixDrift,
  permissionReason,
  readRole,
  roleLabel,
  type AccountRole,
  type Capability,
  type PermissionMatrix } from
'./permissions';
import { fetchMyAccounts, fetchPermissionMatrix, type AccountMembership } from './team';

/**
 * WHICH ACCOUNT THIS PERSON IS ACTING IN, AND WHAT THEY MAY DO IN IT.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS HAD TO EXIST BEFORE SEATS COULD SHIP
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Until now the app had exactly one notion of "which account": one brand-filtered read of
 * `public.entitlements`, which is keyed by OWNERSHIP. It can only ever hand back the account
 * this person OWNS for this brand. An invited member who owns nothing gets null and sees the
 * "still being set up" screen; an invited member who ALSO owns an account gets their own
 * account id rather than the one they were invited into, which is worse — they would be looking
 * at the right chrome over the wrong workspace.
 *
 * `public.my_accounts()` is the answer to the question the app actually has. It is keyed on
 * auth.uid(), takes no argument so it cannot be used to probe anybody else, and returns one row
 * per account the caller is an ACTIVE member of, with the role they hold in each.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * HOW THE ACTIVE ACCOUNT IS RESOLVED, IN THIS ORDER, NEVER BY GUESSING
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *   exactly one account   that is the one. No UI at all, which is every customer today, so
 *                         nothing about the current experience changes.
 *   ?account=<uuid>       validated against my_accounts() before it is believed. A parameter
 *                         makes a link to a specific workspace shareable and lets two tabs sit
 *                         in two accounts, which a stored preference cannot express.
 *   the last one used     from localStorage, keyed by user id, and validated the same way.
 *   otherwise             NOTHING IS SELECTED and a chooser renders. An unrecognised or hostile
 *                         id falls through to here and is never quietly substituted with
 *                         whichever account sorted first, because filing a maker's product in
 *                         the wrong business is the failure this whole contract exists to stop.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE PRE-MIGRATION CASE, WHICH IS AN ORDINARY DEPLOY AND NOT AN ERROR
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * This repo deploys independently of the migrations in the www repo, and the app usually lands
 * first. An environment whose schema stops before 20260805120000 has no `my_accounts`, and
 * PostgREST answers PGRST202. Treating that as "you are in no accounts" would black out every
 * screen for everybody the moment this deploy went out.
 *
 * So it is its own state. `legacy` means the account id continues to come from the entitlements
 * view exactly as it did before, there is no role to read, and `can()` fails open. That is
 * correct rather than lax: in a database with no roles table there are no roles, every account
 * is one owner, and the database refuses anything the app gets wrong regardless.
 */

export type ActiveAccountStatus =
/** The first read has not landed. */
'loading' |
/** Supabase is not configured at all. */
'unconfigured' |
/** An account is selected and may be acted in. */
'ready' |
/** The read succeeded and this person is in no account. Signup did not finish. */
'none' |
/** More than one account and none chosen. The chooser renders. */
'choose' |
/** We could not read the list. Not the same as being in no accounts. */
'error' |
/** The database predates public.my_accounts(). The entitlements view still answers. */
'legacy';

export interface ActiveAccountValue {
  status: ActiveAccountStatus;
  /** Every account this person may act in. Empty unless the read succeeded. */
  accounts: AccountMembership[];
  /**
   * The account being acted in, or null.
   *
   * NOT THE ACCOUNT ID THE REST OF THE APP WRITES WITH. That stays `useEntitlement().accountId`,
   * which equals this in the ordinary case and comes from the entitlements view in `legacy`.
   * One field, one meaning, and every existing write path keeps reading the field it already
   * reads.
   */
  accountId: string | null;
  /** The caller's role in the active account, or null when it is not knowable. */
  role: AccountRole | null;
  /** The printable name of that role. */
  roleName: string;
  /** The matrix in force: the database's copy where it could be read, the compiled one where not. */
  matrix: PermissionMatrix;
  /** Whether the signed-in person may do something in the active account. Fails OPEN on a null role. */
  can: (capability: Capability) => boolean;
  /** Why a control is off, in one sentence, or null when it is not off. */
  reason: (capability: Capability) => string | null;
  /** Choose an account. Ignores an id this person is not a member of. */
  select: (accountId: string) => void;
  /** Re-read the list of accounts and the matrix. */
  refresh: () => void;
}

const ActiveAccountContext = createContext<ActiveAccountValue | null>(null);

/* --------------------------------------------------------------- storage */

const STORAGE_PREFIX = 'batchlabel.active-account.';

/**
 * Remembering the last account used, per signed-in person.
 *
 * Keyed by user id because two people share a browser more often than anybody plans for, and an
 * account id remembered for one of them is a workspace the other cannot open. Every access is
 * wrapped: Safari in private mode throws on `localStorage` access rather than returning null,
 * and a storage failure must degrade to "ask which account" rather than crashing the app.
 */
function rememberedAccount(userId: string): string | null {
  try {
    return window.localStorage.getItem(`${STORAGE_PREFIX}${userId}`);
  } catch {
    return null;
  }
}

function rememberAccount(userId: string, accountId: string): void {
  try {
    window.localStorage.setItem(`${STORAGE_PREFIX}${userId}`, accountId);
  } catch {
    // A browser refusing storage is a browser that asks which account on the next visit. That
    // is a small cost and it is the only safe direction to fail in.
  }
}

/**
 * The account named in the address bar, if any.
 *
 * Read from `window.location` rather than from a router hook, because this provider sits ABOVE
 * the router: the account has to be resolved before the entitlement, and the entitlement before
 * any screen. It is read once per sign-in, which is what a deep link needs; switching afterwards
 * goes through `select`.
 */
function accountFromUrl(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return new URLSearchParams(window.location.search).get('account');
  } catch {
    return null;
  }
}

/* -------------------------------------------------------------- provider */

interface Read {
  userId: string;
  status: 'ready' | 'none' | 'error' | 'legacy';
  accounts: AccountMembership[];
  matrix: PermissionMatrix;
}

export function ActiveAccountProvider({ children }: {children: React.ReactNode;}) {
  const { user, configured } = useAuth();
  const userId = user?.id ?? null;

  /**
   * The answer, and the person it is an answer about, held together and never apart.
   *
   * The same rule EntitlementProvider learned the hard way: a session can be replaced in place
   * with no signed-out frame between, over the shared cookie, and a list of accounts read under
   * one JWT is not a partial answer about the next person. It is somebody else's workspaces, and
   * acting in one of them would file their products in a stranger's account.
   */
  const [read, setRead] = useState<Read | null>(null);
  const [chosen, setChosen] = useState<{userId: string;accountId: string;} | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!userId) {
      setRead(null);
      setChosen(null);
      return;
    }

    let active = true;
    void Promise.all([fetchMyAccounts(), fetchPermissionMatrix()]).then(
      ([accountsResult, liveMatrix]) => {
        if (!active) return;

        const matrix = liveMatrix ?? DEFAULT_MATRIX;

        // A matrix that disagrees with the one compiled into this bundle is filed once, with
        // the differences spelled out. It changes no decision: the database's copy is already
        // the one in use. What it buys is that a capability moved in SQL without the matching
        // edit here shows up as a report rather than as a button that looks live and is refused.
        if (liveMatrix) {
          const drift = matrixDrift(liveMatrix);
          if (drift.length > 0) {
            reportError(
              new Error(`permission matrix drift: ${drift.join('; ')}`),
              'permission-matrix'
            );
          }
        }

        if (!accountsResult.ok) {
          setRead({
            userId,
            status: accountsResult.missing ? 'legacy' : 'error',
            accounts: [],
            matrix
          });
          return;
        }

        setRead({
          userId,
          status: accountsResult.accounts.length === 0 ? 'none' : 'ready',
          accounts: accountsResult.accounts,
          matrix
        });
      }
    );

    return () => {
      active = false;
    };
  }, [userId, attempt]);

  // Derived at render, never in an effect, so there is no frame in which the previous person's
  // accounts are published as this one's.
  const mine = read && read.userId === userId ? read : null;
  const accounts = mine?.accounts ?? [];

  /**
   * The active account, resolved fresh on every render from the three candidates in order.
   *
   * Derived rather than stored, so that a list which has just been re-read cannot leave a
   * selection pointing at an account this person has since been removed from. Every candidate is
   * checked against the list; nothing that is not in it is ever returned.
   */
  const held = (candidate: string | null): string | null => {
    if (!candidate) return null;
    return accounts.some((entry) => entry.accountId === candidate) ? candidate : null;
  };

  const accountId =
  accounts.length === 1 ?
  accounts[0].accountId :
  held(chosen && chosen.userId === userId ? chosen.accountId : null) ??
  held(accountFromUrl()) ??
  held(userId ? rememberedAccount(userId) : null);

  const status: ActiveAccountStatus = !configured ?
  'unconfigured' :
  !mine ?
  'loading' :
  mine.status === 'error' ?
  'error' :
  mine.status === 'legacy' ?
  'legacy' :
  mine.status === 'none' ?
  'none' :
  accountId ?
  'ready' :
  'choose';

  const matrix = mine?.matrix ?? DEFAULT_MATRIX;

  const role = useMemo(() => {
    const entry = accounts.find((candidate) => candidate.accountId === accountId);
    return entry ? readRole(entry.role) : null;
  }, [accounts, accountId]);

  const select = useCallback(
    (next: string) => {
      if (!userId) return;
      setChosen({ userId, accountId: next });
      rememberAccount(userId, next);
    },
    [userId]
  );

  const refresh = useCallback(() => setAttempt((value) => value + 1), []);

  const value = useMemo<ActiveAccountValue>(
    () => ({
      status,
      accounts,
      accountId,
      role,
      roleName: roleLabel(role, matrix),
      matrix,
      can: (capability: Capability) => mayAct(role, capability, matrix),
      reason: (capability: Capability) => permissionReason(role, capability, matrix),
      select,
      refresh
    }),
    [status, accounts, accountId, role, matrix, select, refresh]
  );

  return (
    <ActiveAccountContext.Provider value={value}>{children}</ActiveAccountContext.Provider>);

}

/* ------------------------------------------------------------------ hooks */

export function useActiveAccount(): ActiveAccountValue {
  const value = useContext(ActiveAccountContext);
  if (!value) throw new Error('useActiveAccount must be used inside ActiveAccountProvider');
  return value;
}

/** The same context, or null when there is no provider above. */
export function useOptionalActiveAccount(): ActiveAccountValue | null {
  return useContext(ActiveAccountContext);
}

export interface PermissionCheck {
  role: AccountRole | null;
  roleName: string;
  can: (capability: Capability) => boolean;
  reason: (capability: Capability) => string | null;
}

/**
 * THE HOOK EVERY GATED CONTROL USES, AND IT WORKS WITHOUT A PROVIDER.
 *
 * Several test harnesses in this repo mount one screen on its own, and a hook that throws
 * because a sibling provider is missing turns a rendering test into a wiring test. Outside a
 * provider this answers as an unknown role, which fails OPEN for the reason `mayAct` argues at
 * length: the app is advisory, SQL is the authority, and the expensive direction to be wrong in
 * is taking an ability away from somebody who has it.
 */
export function useCan(): PermissionCheck {
  const value = useContext(ActiveAccountContext);
  const role = value?.role ?? null;
  const matrix = value?.matrix ?? DEFAULT_MATRIX;
  return {
    role,
    roleName: roleLabel(role, matrix),
    can: (capability: Capability) => mayAct(role, capability, matrix),
    reason: (capability: Capability) => permissionReason(role, capability, matrix)
  };
}
