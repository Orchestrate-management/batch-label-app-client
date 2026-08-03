import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { EntitlementProvider } from './entitlement';
import { ProductsProvider, useProducts } from './product-store';
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
  const { status, products } = useProducts();
  return (
    <div>
      <span data-testid="status">{status}</span>
      <span data-testid="names">{products.map((product) => product.name).join(',') || 'empty'}</span>
    </div>);

}

function tree() {
  return (
    <EntitlementProvider>
      <ProductsProvider>
        <Probe />
      </ProductsProvider>
    </EntitlementProvider>);

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
});
