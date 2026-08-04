import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Products } from './Products';
import { WorkspaceProvider } from '../lib/workspace';
import { mapEntitlement, type EntitlementRow } from '../lib/membership';
import type { EntitlementValue } from '../lib/entitlement';
import type { ProductsStatus } from '../lib/product-store';

/**
 * The products screen, and the one sentence it may never say by accident.
 *
 * "No products yet — create your first one" is correct exactly once in a customer's life and
 * catastrophic every other time. Three different states can produce an empty list, and only
 * one of them is a new account:
 *
 *   * the read has not landed        -> a skeleton
 *   * the read failed                -> an apology and a retry
 *   * the read was REFUSED           -> the reason, which the app already holds
 *
 * The third is the one this file was written for. `is_member_of` now checks the account's
 * standing on its brand as well as the person's membership, so a suspended business reads zero
 * product rows with NO ERROR — the read succeeds, the list really is empty, and every
 * non-suspension code path in the app agrees that this is a brand new account. It is not. It is
 * a maker with forty SKUs being shown an empty workspace and invited to start again, on a
 * screen whose own header comment says preventing that is why it exists.
 *
 * The database will not explain the refusal, and section 3 of the migration is right that it
 * should not. It does not have to: `entitlements.membership_status` is read before anything
 * renders.
 */

const entitlement = vi.fn<() => EntitlementValue>();

vi.mock('../lib/entitlement', () => ({
  useEntitlement: () => entitlement()
}));

vi.mock('../lib/meta-pixel', () => ({
  metaInitiateCheckout: () => {}
}));

const store = vi.hoisted(() => ({
  status: 'ready' as ProductsStatus,
  products: [] as unknown[]
}));

vi.mock('../lib/product-store', () => ({
  useProducts: () => ({
    status: store.status,
    products: store.products,
    error: store.status === 'error' ? 'We could not read your products just now.' : null,
    refresh: () => {},
    reload: async () => {}
  })
}));

function stateFor(row: Partial<EntitlementRow>): EntitlementValue {
  const full: EntitlementRow = {
    brand: 'batchlabel',
    accountId: 'acct-1111',
    membershipStatus: 'active',
    businessName: 'Test Ltd',
    plan: 'maker',
    planStatus: 'active',
    active: true,
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
    trialEnd: null,
    skuLimit: 45,
    skuCount: 40,
    skuUnlimited: false,
    editorSeatLimit: 1,
    canModify: true,
    ...row
  };
  return {
    ...mapEntitlement(full),
    loading: false,
    skuCountStale: false,
    refresh: () => {},
    noteSkuCountChanged: () => {}
  };
}

function draw() {
  return render(
    <MemoryRouter>
      <WorkspaceProvider>
        <Products />
      </WorkspaceProvider>
    </MemoryRouter>
  );
}

beforeEach(() => {
  store.status = 'ready';
  store.products = [];
  entitlement.mockReturnValue(stateFor({}));
});

describe('a brand new account', () => {
  it('does get the empty state, which is the screen it is for', () => {
    draw();
    expect(screen.getByText('No products yet')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /create your first product/i })).toBeInTheDocument();
  });
});

describe('a suspended account', () => {
  beforeEach(() => {
    // What the store publishes rather than 'ready' with an empty list. See product-store.tsx.
    store.status = 'unavailable';
    store.products = [];
    // What the view actually returns for a suspended membership: the account_id and the count
    // go null together, because the view's lateral runs under the caller's own RLS.
    entitlement.mockReturnValue(
      stateFor({ accountId: null, skuCount: null, membershipStatus: 'suspended', active: false })
    );
  });

  it('is never told it has no products', () => {
    draw();
    expect(screen.queryByText('No products yet')).not.toBeInTheDocument();
    expect(screen.queryByText(/create the first one/i)).not.toBeInTheDocument();
  });

  it('is told what is actually true, in words that point at a human', () => {
    draw();
    expect(screen.getByText('This account is suspended')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /email us/i })).toBeInTheDocument();
  });

  it('is not offered a create the database will refuse', () => {
    draw();
    expect(screen.queryByRole('button', { name: /new product/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /create your first product/i })).not.toBeInTheDocument();
  });
});

/**
 * The other half of the rule, and the one that is easy to get wrong in the rush to fix the
 * first. `is_member_of` consults membership status ONLY — not plan, not plan_status, not the
 * period end — so a free, lapsed, past_due or downgraded maker keeps full read and write
 * access to everything they already hold (§6.1: "no new, keep everything old fully working").
 * Withholding their list, or hiding their create button, would be the same false sentence
 * pointing the other way, and worse: they can see their products, and we would be saying they
 * cannot.
 */
describe('a lapsed account, which is not a suspended one', () => {
  it('keeps the screen, the list and the create button', () => {
    entitlement.mockReturnValue(
      stateFor({ plan: 'maker', planStatus: 'canceled', active: false })
    );
    draw();
    expect(screen.queryByText('This account is suspended')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /new product/i })).toBeInTheDocument();
    expect(screen.getByText('No products yet')).toBeInTheDocument();
  });
});
