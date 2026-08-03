import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import { EntitlementProvider, useEntitlement } from './entitlement';
import type { EntitlementRow } from './membership';

/**
 * The entitlement, across a change of signed-in user.
 *
 * WHY THIS FILE EXISTS. The provider reset its cached row only inside `if (!userId)` — that
 * is, only on a sign-out. A session can be replaced in place with no signed-out frame between:
 * a cross-tab sign-in over the shared .batchlabel.xyz cookie, or an auth callback landing in a
 * tab that is already signed in. RequireAuth gates on "is there a session" and keeps the
 * providers mounted straight through that, so A's row survived into B's session while
 * `loading` — derived from `row === null` — was already false and `accountId` was still A's.
 *
 * That is not an isolation failure: ProductsProvider then reads with A's id under B's JWT and
 * RLS answers nothing. It is a HOUSE RULE failure, which is worse to ship because it is
 * invisible — the store publishes {ready, []} and every screen renders the empty state, and to
 * a maker with forty SKUs "you have no products yet" reads as "your data is gone".
 *
 * There was no test for the transition at all before this one.
 */

const auth = vi.hoisted(() => ({ userId: null as string | null }));
const fetchEntitlement = vi.hoisted(() => vi.fn());

vi.mock('./auth', () => ({
  useAuth: () => ({
    user: auth.userId ? { id: auth.userId } : null,
    session: auth.userId ? { user: { id: auth.userId } } : null,
    loading: false,
    configured: true
  })
}));

vi.mock('./membership', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./membership')>();
  return { ...actual, fetchEntitlement: () => fetchEntitlement() };
});

function rowFor(userId: string): EntitlementRow {
  return {
    brand: 'batchlabel',
    accountId: `acct-for-${userId}`,
    membershipStatus: 'active',
    businessName: `${userId} Ltd`,
    plan: 'maker',
    planStatus: 'active',
    active: true,
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
    trialEnd: null,
    skuLimit: 45,
    skuCount: 7,
    skuUnlimited: false,
    editorSeatLimit: 1,
    canModify: true
  };
}

/** Every published value, in order, so a single bad frame is catchable. */
const frames: Array<{loading: boolean;accountId: string | null;}> = [];

function Probe() {
  const entitlement = useEntitlement();
  frames.push({ loading: entitlement.loading, accountId: entitlement.accountId });
  return (
    <div>
      <span data-testid="loading">{String(entitlement.loading)}</span>
      <span data-testid="account">{entitlement.accountId ?? 'none'}</span>
      <button type="button" onClick={entitlement.refresh}>
        refresh
      </button>
    </div>);

}

beforeEach(() => {
  frames.length = 0;
  auth.userId = 'user-a';
  fetchEntitlement.mockReset();
  fetchEntitlement.mockImplementation(async () => ({
    row: rowFor(auth.userId ?? 'nobody'),
    failed: false
  }));
});

describe('the entitlement of whoever is signed in now', () => {
  it('holds at loading until the first read lands', async () => {
    render(
      <EntitlementProvider>
        <Probe />
      </EntitlementProvider>
    );
    expect(screen.getByTestId('loading')).toHaveTextContent('true');
    await waitFor(() => expect(screen.getByTestId('account')).toHaveTextContent('acct-for-user-a'));
  });

  it('never publishes the previous user\'s account as resolved', async () => {
    const view = render(
      <EntitlementProvider>
        <Probe />
      </EntitlementProvider>
    );
    await waitFor(() => expect(screen.getByTestId('account')).toHaveTextContent('acct-for-user-a'));

    // The session is replaced in place. No sign-out, no unmount — RequireAuth sees a session
    // throughout, which is exactly what a cross-tab sign-in produces.
    auth.userId = 'user-b';
    view.rerender(
      <EntitlementProvider>
        <Probe />
      </EntitlementProvider>
    );

    // The very next frame must already be loading. An extra frame here is a real read fired
    // with the wrong account id, because ProductsProvider keys its one query off `!loading`.
    expect(screen.getByTestId('loading')).toHaveTextContent('true');

    await waitFor(() => expect(screen.getByTestId('account')).toHaveTextContent('acct-for-user-b'));

    // And at no point in the whole sequence was A's account published as resolved to B.
    const resolvedAccounts = frames.filter((frame) => !frame.loading).map((frame) => frame.accountId);
    expect(resolvedAccounts).not.toContain(null);
    expect(new Set(resolvedAccounts)).toEqual(new Set(['acct-for-user-a', 'acct-for-user-b']));
    expect(resolvedAccounts.lastIndexOf('acct-for-user-a')).toBeLessThan(
      resolvedAccounts.indexOf('acct-for-user-b')
    );
  });

  it('keeps showing the answer it has while a refresh for the SAME user is in flight', async () => {
    // The other half of the rule, and the reason the identity check is on the value rather
    // than a reset inside the effect: a manual retry must not blank a screen somebody is
    // working on. Only a change of person invalidates.
    let resolveSecond = () => {};
    fetchEntitlement.
    mockImplementationOnce(async () => ({ row: rowFor('user-a'), failed: false })).
    mockImplementationOnce(
      () =>
      new Promise((resolve) => {
        resolveSecond = () => resolve({ row: rowFor('user-a'), failed: false });
      })
    );

    render(
      <EntitlementProvider>
        <Probe />
      </EntitlementProvider>
    );
    await waitFor(() => expect(screen.getByTestId('account')).toHaveTextContent('acct-for-user-a'));

    act(() => {
      screen.getByRole('button', { name: 'refresh' }).click();
    });

    expect(screen.getByTestId('loading')).toHaveTextContent('false');
    expect(screen.getByTestId('account')).toHaveTextContent('acct-for-user-a');

    await act(async () => {
      resolveSecond();
    });
  });

  it('resolves to nothing on sign-out rather than keeping the last account', async () => {
    const view = render(
      <EntitlementProvider>
        <Probe />
      </EntitlementProvider>
    );
    await waitFor(() => expect(screen.getByTestId('account')).toHaveTextContent('acct-for-user-a'));

    auth.userId = null;
    view.rerender(
      <EntitlementProvider>
        <Probe />
      </EntitlementProvider>
    );

    await waitFor(() => expect(screen.getByTestId('account')).toHaveTextContent('none'));
  });
});
