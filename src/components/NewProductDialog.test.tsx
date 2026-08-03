import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { NewProductDialog } from './NewProductDialog';
import { WorkspaceProvider } from '../lib/workspace';
import { mapEntitlement, type EntitlementRow } from '../lib/membership';
import type { EntitlementValue } from '../lib/entitlement';
import type { WriteFailure } from '../lib/products';

/**
 * CREATING A PRODUCT MOVES A NUMBER ONLY THE DATABASE HOLDS.
 *
 * `entitlements.sku_count` is counted server-side over the same rows the enforcement trigger
 * counts, and this app reads it exactly once — when the provider mounts. Until this dialog
 * asked for a re-read, the only caller of `entitlement.refresh()` in the entire application
 * was the return from Stripe Checkout. So a maker who signed in, created their first product
 * and looked at the screen was told:
 *
 *   Studio    "0 products · 3 things outstanding across 1 product"
 *   Settings  "It affects every output on all 0 products this account holds."
 *   Billing   "0 of 3 SKUs on your plan", with a 0% meter and aria-valuenow=0
 *
 * all three from a count taken before the row existed, and all three wrong for the rest of
 * the session. It is the first thing a new customer does, and every screen that mentions
 * their products disagreed with what they had just watched themselves do.
 *
 * THE FIX MAY NOT BE `products.length`. Billing removed exactly that fallback: fetchProducts
 * drops a product whose specification did not come back, so the client's list and the meter's
 * count can differ by the amount that shows "2 of 3" beside an insert the database refuses
 * for holding 3. The number is the database's; the app's job is to ask again once it has
 * changed it.
 */

const entitlementRefresh = vi.fn();
const reload = vi.fn(async () => {});
const navigate = vi.fn();
const createProduct = vi.hoisted(() => vi.fn());

vi.mock('../lib/products', () => ({ createProduct }));

vi.mock('../lib/product-store', () => ({
  useProducts: () => ({
    status: 'ready',
    products: [],
    error: null,
    refresh: () => {},
    reload
  })
}));

vi.mock('../lib/meta-pixel', () => ({ metaInitiateCheckout: () => {} }));

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => navigate };
});

const ROW: EntitlementRow = {
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
  // What makes this test the one that matters: the count the app is holding is already
  // stale by the time the create returns.
  skuCount: 0,
  skuUnlimited: false,
  editorSeatLimit: 1,
  canModify: true
};

const value: EntitlementValue = {
  ...mapEntitlement(ROW),
  loading: false,
  refresh: entitlementRefresh
};

vi.mock('../lib/entitlement', () => ({
  useEntitlement: () => value
}));

function draw() {
  return render(
    <MemoryRouter>
      <WorkspaceProvider>
        <NewProductDialog onClose={() => {}} />
      </WorkspaceProvider>
    </MemoryRouter>
  );
}

async function createNamed(name: string) {
  const user = userEvent.setup();
  // By placeholder: Field wraps its input in the label, so the accessible name of the box
  // carries the hint text after it and an exact /^Name$/ match never lands.
  await user.type(screen.getByPlaceholderText('Black Fig and Cassis'), name);
  await user.click(screen.getByRole('button', { name: /create product/i }));
}

beforeEach(() => {
  entitlementRefresh.mockReset();
  reload.mockClear();
  navigate.mockReset();
  createProduct.mockReset();
});

describe('after a product is created', () => {
  beforeEach(() => {
    createProduct.mockResolvedValue({ ok: true, value: { id: 'p-9' } });
  });

  it('asks the database for the account\'s count again', async () => {
    draw();
    await createNamed('Black Fig and Cassis');
    await waitFor(() => expect(entitlementRefresh).toHaveBeenCalled());
  });

  it('still lands the list before navigating to the new product', async () => {
    // The re-read is additional, not a replacement: the product screen has to find the
    // product it is about to render rather than race a background refresh into "no such
    // product".
    draw();
    await createNamed('Black Fig and Cassis');
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/products/p-9'));
    expect(reload).toHaveBeenCalled();
  });
});

/**
 * A refused write moved nothing, and re-reading is not how the app learns it was refused.
 *
 * SkuLimitNotice takes the refusal as a separate input on purpose — the entitlement's
 * `can_modify` and the trigger's answer can legitimately disagree for a moment, and the
 * refusal is the established fact. Re-reading here would be a round trip that changes no
 * number and could only replace a fact with an older guess.
 */
describe('after a create the database refused', () => {
  it.each<WriteFailure>(['sku_limit', 'duplicate_sku', 'no_account'])(
    'does not re-read the count (%s)',
    async (reason) => {
      createProduct.mockResolvedValue({ ok: false, reason, message: 'Not this time.' });
      draw();
      await createNamed('Black Fig and Cassis');
      await waitFor(() => expect(createProduct).toHaveBeenCalled());
      expect(entitlementRefresh).not.toHaveBeenCalled();
      expect(navigate).not.toHaveBeenCalled();
    }
  );
});
