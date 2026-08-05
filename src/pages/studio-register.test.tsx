import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Studio } from './Studio';
import { FIXTURE_MATERIALS, PRODUCTS } from '../lib/fixtures';
import type { Product } from '../lib/model';
import { publishMaterialStatus, publishMaterials, resetMaterials } from '../lib/material-index';
import { mapEntitlement, type EntitlementRow } from '../lib/membership';
import type { EntitlementValue } from '../lib/entitlement';
import type { MaterialsValue } from '../lib/materials-store';

/**
 * THE WORK QUEUE HAS TO BE RECOMPUTED WHEN THE MATERIALS REGISTER LANDS.
 *
 * This is a defect that neither branch could have had on its own, and that both branches'
 * suites would have stayed green through. It exists at the seam.
 *
 *   The materials work made every derivation able to say "the register has not answered yet"
 *   instead of answering. `clp-classification` resolves to `not-tracked` rather than to a
 *   finding while `materialsSettled()` is false — which is right, and is not the final answer.
 *
 *   The register is filled by MaterialsProvider, which sits above the router in App.tsx and
 *   publishes asynchronously, after this screen has already painted once.
 *
 *   A component that does not consume MaterialsContext is NOT re-rendered when that read
 *   lands. The provider re-renders, but its `children` is the same element object it was
 *   handed, so React bails out of the subtree; only context consumers are re-run.
 *
 * Put those three together and route `/` — the first screen a maker sees after signing in —
 * counts their outstanding work once, against a register that had not loaded, and shows that
 * count for the rest of the session. It is wrong in the reassuring direction, which is the
 * worst one: a queue that quietly under-reports teaches a maker that there is nothing to do.
 *
 * So the assertion is behavioural rather than structural. It does not check that `useMaterials`
 * is called or that the dependency array has three entries; it checks that the number on the
 * screen changes when the register answers. Any wiring that keeps that true may replace it.
 */

const entitlement = vi.fn<() => EntitlementValue>();

vi.mock('../lib/entitlement', () => ({
  useEntitlement: () => entitlement()
}));

vi.mock('../lib/meta-pixel', () => ({ metaInitiateCheckout: () => {} }));

vi.mock('../lib/auth', () => ({
  useAuth: () => ({ user: { id: 'user-a', email: 'maker@example.com' }, loading: false })
}));

/**
 * ONE PRODUCT, AND ITS COMPOSITION IS CHOSEN TO MAKE THE ANSWER MOVE.
 *
 * Its fragrance slot names a wax — a material that IS in the register and carries no hazard
 * rows. That is the case where the two answers differ and the bug is visible:
 *
 *   register unsettled  `clp-classification` is `not-tracked`, so it is NOT in the queue,
 *                       because a duty we have not checked is not a finding
 *   register settled    it is `outstanding`, and it IS in the queue, because now we HAVE
 *                       looked and there is genuinely no classification to derive
 *
 * A product whose oil does carry hazards would sit at the same count either side — met and
 * not-tracked are both absent from a queue of outstanding work — and the test would pass
 * against the broken wiring. That is the trap this fixture is shaped to avoid.
 */
const UNCLASSIFIED: Product = {
  ...PRODUCTS[1],
  spec: { ...PRODUCTS[1].spec, fragranceId: 'ing-crw45' } as Product['spec']
};

/**
 * ONE ARRAY, BUILT ONCE, AND THAT IS LOAD-BEARING RATHER THAN TIDY.
 *
 * `products: [UNCLASSIFIED]` written inline inside `useProducts` allocates a NEW array on every
 * render. `useMemo(…, [products])` compares by identity, so a fresh array each time defeats the
 * memo completely and the queue recomputes whatever the dependency list says — the harness
 * would then pass against the broken wiring, which is the one outcome that makes the test
 * worthless. The real store memoises its value, so a stable reference is also the truthful
 * stand-in.
 */
const PRODUCT_LIST = [UNCLASSIFIED];

vi.mock('../lib/product-store', () => ({
  useProducts: () => ({
    status: 'ready',
    products: PRODUCT_LIST,
    error: null,
    refresh: () => {},
    reload: async () => {}
  })
}));

/**
 * A materials store standing in for the real provider, and it publishes the same two things
 * the real one does: the module-level index (which the derivations read) and a context value
 * (which is what can wake a subscriber up). Both halves matter — a stub that only wrote the
 * index would reproduce the bug rather than test it.
 */
let setStoreValue: ((next: MaterialsValue) => void) | null = null;

vi.mock('../lib/materials-store', async () => {
  const react = await import('react');
  const index = await import('../lib/material-index');
  return {
    useOptionalMaterials: (): MaterialsValue => {
      const [value, setValue] = react.useState<MaterialsValue>({
        status: 'loading',
        materials: [],
        error: null,
        accountId: null,
        refresh: () => {},
        reload: async () => {}
      });
      setStoreValue = setValue;
      react.useEffect(() => () => void index, []);
      return value;
    }
  };
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
  skuLimit: 25,
  skuCount: 1,
  skuUnlimited: false,
  editorSeatLimit: 1,
  seatsInUse: null,
  callerRole: null,

  canModify: true
};

beforeEach(() => {
  resetMaterials();
  publishMaterialStatus('loading', 'acct-1111');
  entitlement.mockReturnValue({
    ...mapEntitlement(ROW),
    loading: false,
    skuCountStale: false,
    refresh: () => {},
    noteSkuCountChanged: () => {}
  });
});

afterEach(() => {
  resetMaterials();
  setStoreValue = null;
});

/**
 * The queue total from the header sentence, which reads
 * "<n> products · <total> things outstanding across <m> products".
 *
 * Taken from the DOM rather than from the component, because the sentence is the thing that
 * has to be right: a memo that recomputed into a variable nobody rendered would be no fix.
 * The node holding the phrase is the paragraph, so the figures are read off its `.tabular`
 * spans by position and the middle one is the total.
 */
const outstandingCount = (): number => {
  const paragraph = screen.getByText(/things outstanding across/i);
  const figures = Array.from(paragraph.querySelectorAll('.tabular')).
  map((node) => Number(node.textContent));
  // [stated products, total outstanding, products with something outstanding]
  return figures[figures.length - 2];
};

describe('the outstanding queue on route /', () => {
  it('recounts once the materials register answers, rather than keeping its first answer', () => {
    render(
      <MemoryRouter>
        <Studio />
      </MemoryRouter>
    );

    // Two rows, and 'Classification complete' is deliberately not one of them: the register
    // has not answered, so that duty is not-tracked rather than outstanding.
    const beforeRegister = outstandingCount();
    expect(beforeRegister).toBe(2);
    expect(screen.queryByText('Classification complete')).toBeNull();

    // The register lands: both the index the derivations read AND the context that wakes a
    // subscriber, in that order, exactly as MaterialsProvider does it.
    act(() => {
      publishMaterials('acct-1111', FIXTURE_MATERIALS);
      setStoreValue?.({
        status: 'ready',
        materials: FIXTURE_MATERIALS,
        error: null,
        accountId: 'acct-1111',
        refresh: () => {},
        reload: async () => {}
      });
    });

    // The screen ASKED AGAIN. A memo keyed only on `products` returns the pre-register count
    // forever, and these two lines are what catch it.
    expect(outstandingCount()).toBe(3);
    expect(screen.getByText('Classification complete')).toBeTruthy();
  });
});
