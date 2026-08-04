import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { Studio } from './Studio';
import { Settings } from './Settings';
import { WorkspaceProvider } from '../lib/workspace';
import { PRODUCTS } from '../lib/fixtures';
import { mapEntitlement, type EntitlementRow } from '../lib/membership';
import type { EntitlementValue } from '../lib/entitlement';

/**
 * THE SENTENCE THAT COUNTS AN ACCOUNT'S PRODUCTS, BESIDE A LIST OF THEM.
 *
 * Two screens state how many products the ACCOUNT holds, and both take the number from
 * `entitlements.sku_count` rather than from the length of the list they drew. That is the
 * right source and it stays: the view counts the same rows the enforcement trigger counts,
 * whereas the client's list silently drops a product whose specification did not come back —
 * which is how a header says "3 products" while the next create is refused for holding 4.
 *
 * The number was read once, when the entitlement provider mounted, and after that nothing in
 * the app asked for it again except the return from Stripe Checkout. So a maker's first
 * session ran on a count taken before they had made anything:
 *
 *   Studio    "0 products · 3 things outstanding across 1 product"
 *   Settings  "It affects every output on all 0 products this account holds."
 *
 * Both sentences are printed beside the products they are denying. The first fix for that was
 * to read nought as unknown on these two screens, which hid the symptom and modelled nothing:
 * it made a genuine zero unsayable everywhere, and left a stale 3 — the same bug on a maker's
 * fourth create rather than their first — as sayable as ever.
 *
 * The shape underneath it is named now, in three parts:
 *
 *   the create says the count MOVED, not merely "read it again" (NewProductDialog)
 *   the provider publishes that as `skuCountStale` until the read answering for it lands
 *   `readSkuCount` / `skuCountBeside` turn the pair into "no number", "moved" or a number
 *
 * So these two clauses ask one question — may this number be stated beside this list — and the
 * answer is no when there is no count, no when a write of ours has moved it, and no when the
 * count is lower than what the screen has already drawn, because an account cannot hold fewer
 * products than we just read out of it. A genuine zero stays sayable; it is simply never
 * reached from inside a non-empty branch.
 *
 * Nothing here invents a number, and neither screen falls back to `products.length`.
 */

const entitlement = vi.fn<() => EntitlementValue>();

vi.mock('../lib/entitlement', () => ({
  useEntitlement: () => entitlement()
}));

vi.mock('../lib/meta-pixel', () => ({ metaInitiateCheckout: () => {} }));

vi.mock('../lib/auth', () => ({
  useAuth: () => ({ user: { id: 'user-a', email: 'maker@example.com' }, loading: false })
}));

const store = vi.hoisted(() => ({ products: [] as unknown[] }));

vi.mock('../lib/product-store', () => ({
  useProducts: () => ({
    status: 'ready',
    products: store.products,
    error: null,
    refresh: () => {},
    reload: async () => {}
  })
}));

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
  skuCount: 0,
  skuUnlimited: false,
  editorSeatLimit: 1,
  canModify: true
};

function withCount(skuCount: number | null, skuCountStale = false): EntitlementValue {
  return {
    ...mapEntitlement({ ...ROW, skuCount }),
    loading: false,
    skuCountStale,
    refresh: () => {},
    noteSkuCountChanged: () => {}
  };
}

function drawStudio() {
  render(
    <MemoryRouter>
      <WorkspaceProvider>
        <Studio />
      </WorkspaceProvider>
    </MemoryRouter>
  );
}

function drawIdentityTab() {
  render(
    <MemoryRouter initialEntries={['/settings/identity']}>
      <WorkspaceProvider>
        <Routes>
          <Route path="/settings/:tab" element={<Settings />} />
        </Routes>
      </WorkspaceProvider>
    </MemoryRouter>
  );
}

beforeEach(() => {
  // One real product on screen, so both clauses under test are rendered at all.
  store.products = [PRODUCTS[0]];
  entitlement.mockReturnValue(withCount(4));
});

describe('the studio header', () => {
  it('states the count the database gave it', () => {
    entitlement.mockReturnValue(withCount(4));
    drawStudio();
    expect(screen.getByText('4')).toBeInTheDocument();
    expect(screen.getByText('products', { exact: false })).toBeInTheDocument();
  });

  it('says nothing about the count when the database has none to give', () => {
    entitlement.mockReturnValue(withCount(null));
    drawStudio();
    expect(screen.queryByText(/^0 products/)).not.toBeInTheDocument();
  });

  it('does not greet a maker with "0 products" over the products they can see', () => {
    entitlement.mockReturnValue(withCount(0));
    drawStudio();
    // The clause disappears; the outstanding-work half of the sentence, which is derived
    // from what is genuinely on this screen, stays.
    expect(screen.queryByText('0')).not.toBeInTheDocument();
    expect(screen.getByText(/things outstanding across/)).toBeInTheDocument();
  });

  it('says nothing while a count a create has moved is being re-read', () => {
    // The state the zero guard could not see: a real number, from before the write, on a
    // screen already showing what the write produced. Stating it is how "3 products" appears
    // over four of them for a whole session.
    entitlement.mockReturnValue(withCount(3, true));
    drawStudio();
    // Read off the header's own text, because the number is in a span of its own and the
    // outstanding-work half of the same sentence carries digits too.
    const meta = screen.getByText(/things outstanding across/);
    expect(meta.textContent).not.toMatch(/3 products/);
    expect(meta.textContent).toMatch(/things outstanding across/);
  });

  it('says nothing when the count is lower than the list it is printed beside', () => {
    store.products = [PRODUCTS[0], PRODUCTS[1], PRODUCTS[2]];
    entitlement.mockReturnValue(withCount(1));
    drawStudio();
    const meta = screen.getByText(/things outstanding across/);
    expect(meta.textContent).not.toMatch(/^1 product/);
    expect(meta.textContent).toMatch(/things outstanding across/);
  });
});

describe('the settings identity tab', () => {
  it('names the number of products an identity change would move', () => {
    entitlement.mockReturnValue(withCount(4));
    drawIdentityTab();
    expect(screen.getByText(/all 4 products this account holds/)).toBeInTheDocument();
  });

  it('falls back to the wording with no number when the count is unknown', () => {
    entitlement.mockReturnValue(withCount(null));
    drawIdentityTab();
    expect(screen.getByText(/every product this account holds/)).toBeInTheDocument();
  });

  it('never says an identity change affects all 0 of the products on screen', () => {
    entitlement.mockReturnValue(withCount(0));
    drawIdentityTab();
    expect(screen.queryByText(/all 0 products/)).not.toBeInTheDocument();
    expect(screen.getByText(/every product this account holds/)).toBeInTheDocument();
  });

  it('names no number while a count a create has moved is being re-read', () => {
    entitlement.mockReturnValue(withCount(3, true));
    drawIdentityTab();
    expect(screen.queryByText(/all 3 products/)).not.toBeInTheDocument();
    expect(screen.getByText(/every product this account holds/)).toBeInTheDocument();
  });
});
