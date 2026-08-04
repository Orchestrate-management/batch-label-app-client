import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import { EntitlementProvider } from './entitlement';
import { ProductsProvider, useProduct, useProducts } from './product-store';
import type { ReactNode } from 'react';
import type { EntitlementRow } from './membership';
import type { Product } from './model';

/**
 * The products list, across a change of signed-in user.
 *
 * THE RENDER THIS FILE EXISTS TO PREVENT is the one this module's own docstring forbids: "A
 * failed read rendered as 'you have no products yet' is indistinguishable from a brand new
 * account, and to a maker with forty SKUs it reads as 'your data is gone'." It arrived by a
 * route the three states did not cover — not a failed read, but a read fired with the previous
 * user's account id.
 *
 * A session can be replaced in place: cross-tab sign-in over the shared .batchlabel.xyz
 * cookie, or a callback landing in a signed-in tab. RequireAuth sees a session throughout and
 * keeps both providers mounted, so the entitlement still held A's row, `loading` was already
 * false, and this provider read `!entitlement.loading` as "the account is resolved" and called
 * fetchProducts(A) under B's JWT. RLS answers nothing, and the store published
 * {status:'ready', products:[]} — the empty state, to an account with products.
 *
 * The two properties below are separate and both are load-bearing: the read must not be FIRED
 * with the stale id, and the previous account's list must not be PUBLISHED while the new one
 * is being fetched. Neither provider had any test before this file.
 */

const auth = vi.hoisted(() => ({ userId: null as string | null }));
const fetchEntitlement = vi.hoisted(() => vi.fn());
const fetchProducts = vi.hoisted(() => vi.fn());

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

vi.mock('./products', () => ({
  fetchProducts: (accountId: string | null) => fetchProducts(accountId)
}));

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
    skuCount: 1,
    skuUnlimited: false,
    editorSeatLimit: 1,
    canModify: true
  };
}

function productNamed(name: string): Product {
  return {
    id: `prod-${name}`,
    specificationId: `spec-${name}`,
    name,
    sku: name,
    categoryId: 'home-fragrance',
    markets: ['GB'],
    regimes: [],
    spec: {
      kind: 'mixture',
      productType: 'Container candle',
      baseId: 'ing-crw45',
      fragranceId: 'ing-bfc',
      load: 8,
      dyeId: 'ing-no-dye',
      additive: 'None',
      netQuantity: 220,
      netUnit: 'g',
      packagingId: 'pkg-tumbler-250'
    },
    artefacts: [],
    identifiers: {},
    obligations: {}
  };
}

function Probe() {
  const { status, products, error, refresh, reload } = useProducts();
  return (
    <div>
      <span data-testid="status">{status}</span>
      <span data-testid="names">{products.map((product) => product.name).join(',') || 'empty'}</span>
      <span data-testid="error">{error ?? 'none'}</span>
      <button
        onClick={() => {
          void reload();
        }}>
        reload
      </button>
      <button onClick={refresh}>refresh</button>
    </div>);

}

/** The single-product view of the same store, which is what the two detail screens use. */
function OneProbe({ id }: {id: string | undefined;}) {
  const { status, product, error } = useProduct(id);
  return (
    <div>
      <span data-testid="one-status">{status}</span>
      <span data-testid="one-name">{product ? product.name : 'null'}</span>
      <span data-testid="one-error">{error ?? 'none'}</span>
    </div>);

}

function tree(children: ReactNode = <Probe />) {
  return (
    <EntitlementProvider>
      <ProductsProvider>{children}</ProductsProvider>
    </EntitlementProvider>);

}

async function press(label: string) {
  await act(async () => {
    screen.getByText(label).click();
  });
}

beforeEach(() => {
  auth.userId = 'user-a';
  fetchEntitlement.mockReset();
  fetchEntitlement.mockImplementation(async () => ({
    row: rowFor(auth.userId ?? 'nobody'),
    failed: false
  }));
  fetchProducts.mockReset();
  // Keyed on the account it was asked for, so a read fired with the wrong id is visible as the
  // wrong list rather than as a coincidence.
  fetchProducts.mockImplementation(async (accountId: string | null) => ({
    ok: true,
    products: accountId ? [productNamed(accountId)] : []
  }));
});

describe('the products of whoever is signed in now', () => {
  it('waits for the account before reading, and reads it once', async () => {
    render(tree());
    expect(screen.getByTestId('status')).toHaveTextContent('loading');

    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('ready'));
    expect(screen.getByTestId('names')).toHaveTextContent('acct-for-user-a');
    expect(fetchProducts).toHaveBeenCalledTimes(1);
    expect(fetchProducts).toHaveBeenCalledWith('acct-for-user-a');
  });

  it('never reads with the previous user\'s account id', async () => {
    const view = render(tree());
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('ready'));

    auth.userId = 'user-b';
    view.rerender(tree());

    await waitFor(() => expect(screen.getByTestId('names')).toHaveTextContent('acct-for-user-b'));

    // The whole point. Every call carries the account of the user who was signed in when it
    // was made, and B's JWT was never sent A's id — which under RLS returns nothing and
    // publishes "you have no products" to somebody who has products.
    const idsAsked = fetchProducts.mock.calls.map((call) => call[0]);
    expect(idsAsked).toEqual(['acct-for-user-a', 'acct-for-user-b']);
  });

  it('does not show the previous account\'s list while the new one is being read', async () => {
    const view = render(tree());
    await waitFor(() => expect(screen.getByTestId('names')).toHaveTextContent('acct-for-user-a'));

    auth.userId = 'user-b';
    view.rerender(tree());

    // Not 'ready' with A's rows, and not 'ready' with none — both are claims about B that
    // nothing has established. The only honest answer in this frame is that we are still
    // asking.
    expect(screen.getByTestId('status')).toHaveTextContent('loading');
    expect(screen.getByTestId('names')).toHaveTextContent('empty');

    await waitFor(() => expect(screen.getByTestId('names')).toHaveTextContent('acct-for-user-b'));
  });

  it('renders an empty account as ready and empty, which is the real first screen', async () => {
    fetchProducts.mockImplementation(async () => ({ ok: true, products: [] }));
    render(tree());
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('ready'));
    expect(screen.getByTestId('names')).toHaveTextContent('empty');
  });

  it('reports a failed read as an error rather than as an empty account', async () => {
    fetchProducts.mockImplementation(async () => ({
      ok: false,
      message: 'We could not read your products just now.'
    }));
    render(tree());
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('error'));
  });

  it('carries the reader\'s own sentence, and shows no list behind it', async () => {
    // The screens render `error` verbatim, on purpose: a read can fail for more than one
    // reason and only fetchProducts knows which, so a fixed sentence here would contradict it
    // half the time. What the store adds is that the list goes with it — a stale list under an
    // error banner is a maker editing rows that may no longer be what is stored.
    fetchProducts.mockImplementation(async () => ({
      ok: false,
      message: 'We could not read your products just now. This is us, not you.'
    }));
    render(tree());

    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('error'));
    expect(screen.getByTestId('error')).toHaveTextContent('This is us, not you.');
    expect(screen.getByTestId('names')).toHaveTextContent('empty');
  });

  it('publishes nothing at all when nobody is signed in', async () => {
    // Not 'ready' with an empty list, which is the empty state, and not 'error' either —
    // nothing was asked and nothing failed. Nothing renders behind the auth gate anyway, so
    // the only honest answer is that there is no answer.
    auth.userId = null;
    render(tree());

    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('loading'));
    expect(screen.getByTestId('names')).toHaveTextContent('empty');
    expect(fetchProducts).not.toHaveBeenCalled();
  });
});

/**
 * Re-reading: `refresh`, which the error screens' "Try again" is wired to, and `reload`, which
 * the two writers await so a screen can navigate to a product it just created.
 *
 * The property that matters for both is what is on the screen WHILE the re-read is in flight.
 * Resetting to `loading` would blank a page somebody is working on every time they pressed try
 * again — and worse, on the create path it would replace a list with a skeleton at the exact
 * moment the maker is looking for the row they just made.
 */
describe('re-reading the list', () => {
  it('keeps the answer it already has on screen while it re-reads', async () => {
    render(tree());
    await waitFor(() => expect(screen.getByTestId('names')).toHaveTextContent('acct-for-user-a'));

    let release: (value: unknown) => void = () => {};
    fetchProducts.mockImplementation(
      () =>
      new Promise((resolve) => {
        release = resolve;
      })
    );

    await press('refresh');

    // Still ready, still showing the list. A skeleton here is a page blanked under somebody
    // mid-edit, for a read that will probably succeed.
    expect(screen.getByTestId('status')).toHaveTextContent('ready');
    expect(screen.getByTestId('names')).toHaveTextContent('acct-for-user-a');

    await act(async () => {
      release({ ok: true, products: [productNamed('acct-for-user-a')] });
    });
    expect(fetchProducts).toHaveBeenCalledTimes(2);
  });

  it('resolves the reload only once the new answer has landed', async () => {
    // NewProductDialog awaits this and then navigates to the product it just created. If it
    // resolved before the read had landed, the screen it navigates to would look the product
    // up in the OLD list and render "no such product" for the thing the maker just made.
    render(tree());
    await waitFor(() => expect(screen.getByTestId('names')).toHaveTextContent('acct-for-user-a'));

    fetchProducts.mockImplementation(async () => ({
      ok: true,
      products: [productNamed('acct-for-user-a'), productNamed('the-new-one')]
    }));

    await press('reload');

    expect(screen.getByTestId('names')).toHaveTextContent('the-new-one');
    expect(fetchProducts).toHaveBeenCalledTimes(2);
  });

  it('turns a re-read that failed into the error state', async () => {
    render(tree());
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('ready'));

    fetchProducts.mockImplementation(async () => ({ ok: false, message: 'Could not read.' }));
    await press('reload');

    // And the list goes rather than staying behind the banner: after a failed read we no
    // longer know that what we were showing is what is stored.
    expect(screen.getByTestId('status')).toHaveTextContent('error');
    expect(screen.getByTestId('names')).toHaveTextContent('empty');
  });
});

/**
 * No account to scope a read to — the third of the store's non-answers, and the one whose
 * copy exists on Products.tsx already.
 *
 * Three causes reach here and they are three different sentences: signup never finished, the
 * entitlement read did not come back, or the person holds more than one account and
 * current_account_id() correctly refuses to guess. The screen reads `entitlement.status` to
 * say which — so the store's job is only to publish `no-account` and NOT to fire a read that
 * has nothing to be scoped to.
 *
 * BOTH PATHS PUBLISH IT, and they did not always. The mount effect used to call
 * fetchProducts(null), which refuses, and the refusal arrived as `error` — so an unfinished
 * signup got "We could not read your products" and a Try again button on first paint, which is
 * the wrong one of three sentences and the one action that cannot help. Entry 1 of
 * docs/PRODUCTION_TODO.md. Both paths get a test below, and they now agree.
 */
describe('a session with no account behind it', () => {
  beforeEach(() => {
    // The entitlement read itself failed: resolved (so `loading` is false), no account id, and
    // a status that is not `suspended`.
    fetchEntitlement.mockImplementation(async () => ({ row: null, failed: true }));
    fetchProducts.mockImplementation(async () => ({
      ok: false,
      message:
      'We could not tell which account this workspace belongs to, so it is showing none ' +
      'rather than the wrong one. Nothing has been lost.'
    }));
  });

  it('never publishes an empty account when it has no account to ask about', async () => {
    // THE LOAD-BEARING ONE, and it holds on both paths. Whatever the status ends up being, it
    // may not be `ready` with nothing in it: that is the sentence "you have no products", and
    // a person whose entitlement read merely failed may hold forty.
    render(tree());

    await waitFor(() => expect(screen.getByTestId('status')).not.toHaveTextContent('loading'));
    expect(screen.getByTestId('status')).not.toHaveTextContent('ready');
    expect(screen.getByTestId('names')).toHaveTextContent('empty');
  });

  it('publishes no-account on a reload, without firing a read to find out', async () => {
    render(tree());
    await waitFor(() => expect(screen.getByTestId('status')).not.toHaveTextContent('loading'));
    fetchProducts.mockClear();

    await press('reload');

    expect(screen.getByTestId('status')).toHaveTextContent('no-account');
    // Nothing failed, so there is no error sentence to render — the screen says which of the
    // three causes it is, from the entitlement.
    expect(screen.getByTestId('error')).toHaveTextContent('none');
    // A read with nothing to scope it to is the read the account_id contract forbids. Not
    // firing it is the point.
    expect(fetchProducts).not.toHaveBeenCalled();
  });

  it('publishes no-account on the mount path too, without firing a read to find out', async () => {
    // This expectation used to read `error`, pinning the gap deliberately so that closing it
    // would be a visible change rather than a silent one. The effect now carries the same
    // branch `read` has, so both paths answer the same way — which is what makes the copy on
    // Products.tsx, Studio, the specification screen and the designer reachable at all.
    render(tree());

    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('no-account'));
    expect(screen.getByTestId('error')).toHaveTextContent('none');
    // Not merely "did not come back as error": the read with nothing to scope it to is never
    // fired. fetchProducts(null) refuses, and asking it to refuse is a round trip spent
    // learning something the entitlement already told us.
    expect(fetchProducts).not.toHaveBeenCalled();
  });
});

/**
 * The two races the provider has to lose safely: a component that goes away mid-read, and a
 * consumer mounted where there is no provider at all.
 */
describe('reads that outlive what asked for them', () => {
  it('does not publish an answer to a provider that has been unmounted', async () => {
    let release: (value: unknown) => void = () => {};
    fetchProducts.mockImplementation(
      () =>
      new Promise((resolve) => {
        release = resolve;
      })
    );

    const view = render(tree());
    await act(async () => {});
    view.unmount();

    // Landing after the unmount. Without the `active` guard this is a setState on a gone
    // component — a console error in React 18, and in a future React a leak of the whole
    // product list held alive by a resolved promise.
    await act(async () => {
      release({ ok: true, products: [productNamed('late')] });
    });
  });

  it('refuses to be used outside its provider rather than answering with nothing', async () => {
    // The failure mode this replaces is silent: a default context value would make a screen
    // mounted outside the provider render "you have no products" forever, which is the one
    // sentence this module exists to prevent.
    //
    // React logs the boundary-less throw as well as rethrowing it, and the log is the point of
    // the test rather than a symptom, so it is silenced for the duration — a wall of expected
    // stack in the gate output is how a real one stops being read.
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const Orphan = () => {
        useProducts();
        return null;
      };
      expect(() => render(<Orphan />)).toThrow(/ProductsProvider/);
    } finally {
      logged.mockRestore();
    }
  });
});

/**
 * One product out of the list, which is what the specification screen and the designer use.
 *
 * `product === null` means nothing on its own, and the whole risk here is a screen reading it
 * as "no such product". Null while loading is "we have not looked yet"; null on an error is "we
 * could not look"; null on `unavailable` is "it is almost certainly still there". Only null on
 * `ready` means the product is not there. So the status has to travel with it, every time.
 */
describe('one product from the list', () => {
  it('finds the product once the list has landed', async () => {
    fetchProducts.mockImplementation(async () => ({ ok: true, products: [productNamed('candle')] }));
    render(tree(<OneProbe id="prod-candle" />));

    await waitFor(() => expect(screen.getByTestId('one-status')).toHaveTextContent('ready'));
    expect(screen.getByTestId('one-name')).toHaveTextContent('candle');
  });

  it('is null-and-ready for a product this account does not hold', async () => {
    // The only combination that means "no such product". A screen may say so here and nowhere
    // else.
    fetchProducts.mockImplementation(async () => ({ ok: true, products: [productNamed('candle')] }));
    render(tree(<OneProbe id="prod-someone-elses" />));

    await waitFor(() => expect(screen.getByTestId('one-status')).toHaveTextContent('ready'));
    expect(screen.getByTestId('one-name')).toHaveTextContent('null');
  });

  it('is null-and-not-ready while the list is still being read', async () => {
    // Held pending: this is the first two hundred milliseconds of the specification screen,
    // and a screen that renders "no such product" in them sends people back to the list they
    // just came from.
    fetchProducts.mockImplementation(() => new Promise(() => {}));
    render(tree(<OneProbe id="prod-candle" />));
    // Let the entitlement land, so the read is genuinely in flight rather than not yet fired.
    await act(async () => {});

    expect(screen.getByTestId('one-status')).toHaveTextContent('loading');
    expect(screen.getByTestId('one-name')).toHaveTextContent('null');
  });

  it('carries the error so a failed read is not read as a deleted product', async () => {
    // The expensive misread: a dropped request on the specification screen telling a maker the
    // product they were editing no longer exists.
    fetchProducts.mockImplementation(async () => ({ ok: false, message: 'Could not read.' }));
    render(tree(<OneProbe id="prod-candle" />));

    await waitFor(() => expect(screen.getByTestId('one-status')).toHaveTextContent('error'));
    expect(screen.getByTestId('one-error')).toHaveTextContent('Could not read.');
    expect(screen.getByTestId('one-name')).toHaveTextContent('null');
  });

  it('looks nothing up when there is no id in the route', async () => {
    fetchProducts.mockImplementation(async () => ({ ok: true, products: [productNamed('candle')] }));
    render(tree(<OneProbe id={undefined} />));

    await waitFor(() => expect(screen.getByTestId('one-status')).toHaveTextContent('ready'));
    expect(screen.getByTestId('one-name')).toHaveTextContent('null');
  });
});

/**
 * A suspended account, which is the third way to arrive at "you have no products" and the only
 * one where the read SUCCEEDS.
 *
 * `is_member_of` gained a second gate — the account's standing on its brand, not just the
 * person's membership of the account — so a suspended business now reads zero rows from every
 * table with no error at all, and its `entitlements` row comes back with account_id null,
 * sku_count null and membership_status 'suspended'. Measured against a real Postgres; the
 * fixture below is that measurement.
 *
 * Every ingredient of the empty state then lines up: read ok, list empty, status 'ready'. A
 * maker holding forty SKUs was shown "Nothing here yet, and that is the right place to start"
 * on route `/`, invited to create their first product, and refused when they did — while
 * Billing, in the same session, said the account was suspended.
 *
 * The database is right not to explain itself in an error (§3 of the migration: a policy
 * refusal that explains itself is one that can be used to probe). It does not have to. The
 * true sentence is already on the client, in a read taken before anything renders.
 */
describe('an account whose membership has been suspended', () => {
  const suspendedRow = (userId: string): EntitlementRow => ({
    ...rowFor(userId),
    // What the view actually hands back: the `acct` lateral runs under the caller's RLS, and
    // is_member_of now hides the accounts row, so the id and the count go null together.
    accountId: null,
    skuCount: null,
    membershipStatus: 'suspended',
    active: false
  });

  beforeEach(() => {
    fetchEntitlement.mockImplementation(async () => ({
      row: suspendedRow(auth.userId ?? 'nobody'),
      failed: false
    }));
    // Zero rows, no error. Exactly what RLS returns, and exactly what made this look like a
    // brand new account.
    fetchProducts.mockImplementation(async () => ({ ok: true, products: [] }));
  });

  it('publishes the refusal rather than an empty account', async () => {
    render(tree());
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('unavailable'));
    // NOT 'ready'. 'ready' with an empty list is the sentence "you have no products", and
    // nothing has established it — the rows are there and are being withheld.
    expect(screen.getByTestId('status')).not.toHaveTextContent('ready');
  });

  it('does not fire a read whose answer it can already predict', async () => {
    render(tree());
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('unavailable'));
    expect(fetchProducts).not.toHaveBeenCalled();
  });

  it('answers a reload the same way, without going to the database for it', async () => {
    // The writers call reload() after a save, and a suspended maker can still reach a form.
    // Firing the read here would return zero rows with no error — the empty state again, by
    // the other door.
    render(tree());
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('unavailable'));

    await press('reload');

    expect(screen.getByTestId('status')).toHaveTextContent('unavailable');
    expect(screen.getByTestId('names')).toHaveTextContent('empty');
    expect(fetchProducts).not.toHaveBeenCalled();
  });

  it('withholds nothing from a lapsed account, which keeps everything it holds', async () => {
    // The gate is `suspended` and only `suspended`. is_member_of consults membership status
    // and deliberately not plan, plan_status or period end (§6.1: "no new, keep everything old
    // fully working"), so a maker whose card lapsed still reads and writes every product they
    // have. Withholding their list would be the same lie pointing the other way.
    fetchEntitlement.mockImplementation(async () => ({
      row: { ...rowFor(auth.userId ?? 'nobody'), plan: 'maker', planStatus: 'canceled', active: false },
      failed: false
    }));
    fetchProducts.mockImplementation(async (accountId: string | null) => ({
      ok: true,
      products: accountId ? [productNamed(accountId)] : []
    }));

    render(tree());
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('ready'));
    expect(screen.getByTestId('names')).toHaveTextContent('acct-for-user-a');
  });
});
