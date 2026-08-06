import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { Products } from './Products';
import { Studio } from './Studio';
import { ArtefactDesigner } from './ArtefactDesigner';
import { FIXTURE_MATERIALS } from '../lib/fixtures';
import { publishMaterialStatus, publishMaterials, resetMaterials } from '../lib/material-index';
import { mapEntitlement, type EntitlementRow } from '../lib/membership';
import type { EntitlementValue } from '../lib/entitlement';
import type { MaterialsValue } from '../lib/materials-store';
import type { Product, RecordedEvidence } from '../lib/model';

/**
 * THE SENTENCES THEMSELVES, on the three screens that said them.
 *
 * The units are asserted in lib/absence-is-not-a-pass.test.ts. This file exists because a
 * mechanism that can answer honestly is worth nothing if the screen above it still renders the
 * old sentence, and because two of these defects are only visible in composition: Studio's
 * all-clear is produced by four individually correct steps, and the products table's green pill
 * is only obviously wrong when you put it beside what Studio says about the same product in the
 * same session.
 */

const entitlement = vi.fn<() => EntitlementValue>();
vi.mock('../lib/entitlement', () => ({ useEntitlement: () => entitlement() }));
vi.mock('../lib/meta-pixel', () => ({ metaInitiateCheckout: () => {} }));
vi.mock('../lib/auth', () => ({
  useAuth: () => ({ user: { id: 'user-a', email: 'maker@example.com' }, loading: false })
}));

const store = vi.hoisted(() => ({ products: [] as Product[] }));
vi.mock('../lib/product-store', () => ({
  useProducts: () => ({
    status: 'ready',
    products: store.products,
    error: null,
    refresh: () => {},
    reload: async () => {}
  }),
  useProduct: () => ({
    status: 'ready',
    product: store.products[0] ?? null,
    error: null,
    refresh: () => {},
    reload: async () => {}
  })
}));

/**
 * A materials store standing in for the real provider.
 *
 * It has to publish BOTH halves the real one does — the module index the derivations read, and
 * a context value that can wake a subscriber — because a screen that reads only the index is
 * exactly the bug in Finding 4's neighbourhood. The index is set per test; this supplies the
 * context.
 */
const register = vi.hoisted(() => ({ status: 'loading' as MaterialsValue['status'] }));
vi.mock('../lib/materials-store', () => ({
  useOptionalMaterials: (): MaterialsValue => ({
    status: register.status,
    materials: register.status === 'ready' ? [] : [],
    error: null,
    accountId: 'acct-1111',
    refresh: () => {},
    reload: async () => {}
  })
}));

// Only the hook, not the module: a wholesale mock would take the rest of it away too.
// A null identity holder is what the designer already handles.
vi.mock('../lib/settings-store', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/settings-store')>()),
  useOptionalSettings: () => null
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
  skuLimit: 25,
  skuCount: 1,
  skuUnlimited: false,
  editorSeatLimit: 1,
  seatsInUse: null,
  callerRole: null,

  canModify: true
};

function evidence(id: string): RecordedEvidence {
  return { id, recordedAt: '2026-01-04', reference: 'REF-1', summary: 'Recorded in a test' };
}

/** See the same helper in lib/absence-is-not-a-pass.test.ts: nothing left to do, once asked. */
function settledProduct(overrides: Partial<Product['spec']> = {}): Product {
  return {
    id: 'p-1',
    name: 'Ash and Amber',
    sku: 'AA-001',
    categoryId: 'home-fragrance',
    markets: ['GB'],
    regimes: ['clp'],
    identifiers: {},
    spec: {
      kind: 'mixture',
      productType: 'Container candle',
      baseId: 'ing-crw45',
      fragranceId: 'ing-black-fig',
      load: 8,
      dyeId: '',
      additive: 'None',
      netQuantity: 220,
      netUnit: 'g',
      packagingId: 'pkg-tumbler-250',
      ...overrides
    } as Product['spec'],
    artefacts: [],
    evidence: { obligations: { 'clp-pcn-gb': evidence('clp-pcn-gb') }, sdsSections: {} }
  };
}

beforeEach(() => {
  resetMaterials();
  register.status = 'loading';
  store.products = [settledProduct()];
  entitlement.mockReturnValue({
    ...mapEntitlement(ROW),
    loading: false,
    skuCountStale: false,
    refresh: () => {},
    noteSkuCountChanged: () => {}
  });
});

afterEach(() => resetMaterials());

function draw(node: React.ReactElement) {
  return render(
    <MemoryRouter>
      {node}
    </MemoryRouter>
  );
}

/**
 * FINDING 4. Route `/`, the first screen after sign-in, with the materials register read
 * FAILED — and the words it printed:
 *
 *   Nothing outstanding
 *   Every composition is settled, every material is classified, and nothing is waiting on you.
 *
 * Studio consulted `useProducts()` and nothing else. Grepping it for `useMaterials` or
 * `register.status` returned nothing, and it never read `Stage.checked` either. The middle
 * clause of that sentence is a claim about the materials register, made by a screen that had
 * not asked one.
 */
describe('route /, when the materials register could not be read', () => {
  beforeEach(() => {
    publishMaterialStatus('error', 'acct-1111');
    register.status = 'error';
  });

  it('does not say every material is classified', () => {
    draw(<Studio />);
    expect(screen.queryByText(/every material is classified/i)).toBeNull();
    expect(screen.queryByText('Nothing outstanding')).toBeNull();
  });

  it('says which check did not run, and that silence is not an all-clear', () => {
    draw(<Studio />);
    expect(screen.getByText('Nothing outstanding among the checks that ran')).toBeTruthy();
    expect(screen.getByText(/your materials register could not be read/i)).toBeTruthy();
    expect(screen.getByText(/silence rather than an all-clear/i)).toBeTruthy();
  });

  /**
   * SAID BESIDE A QUEUE WITH ROWS IN IT TOO. An under-reported queue is under-reported whether
   * it happens to be empty or not, and the header's "N things outstanding" is then a floor
   * rather than a total — so the warning cannot be tied to the empty case alone.
   */
  it('warns even when the queue does have rows, because the count is then a floor', () => {
    store.products = [settledProduct({ netQuantity: 0 } as never)];
    draw(<Studio />);
    expect(screen.getByText('Some checks did not run')).toBeTruthy();
    expect(screen.getByText(/not the whole of it/i)).toBeTruthy();
  });
});

describe('route /, when every check did run and found nothing', () => {
  it('still gets its all-clear, which is the sentence being protected', () => {
    publishMaterials('acct-1111', FIXTURE_MATERIALS);
    register.status = 'ready';
    draw(<Studio />);
    expect(screen.getByText('Nothing outstanding')).toBeTruthy();
    expect(screen.getByText(/every material is classified/i)).toBeTruthy();
    expect(screen.queryByText('Some checks did not run')).toBeNull();
  });
});

/**
 * FINDING 5. One product, one session, two screens, opposite answers — and the products screen
 * was the one saying the reassuring thing about a product with no base wax, no packaging and no
 * net quantity. Two of those three are mandatory CLP label elements.
 */
describe('the products table and Studio, asked about the same product', () => {
  beforeEach(() => {
    publishMaterials('acct-1111', FIXTURE_MATERIALS);
    register.status = 'ready';
    store.products = [settledProduct({ baseId: '', packagingId: '', netQuantity: 0 } as never)];
  });

  it('does not call an unlabellable product complete', () => {
    draw(<Products />);
    expect(screen.queryByText('Complete')).toBeNull();
    expect(screen.getByText('3 outstanding')).toBeTruthy();
  });

  it('gives the same number Studio gives, from the same function', () => {
    const products = draw(<Products />);
    const pill = screen.getByText(/outstanding$/).textContent;
    products.unmount();

    draw(<Studio />);
    const studio = screen.getByText(/things outstanding across/i).textContent ?? '';
    expect(pill).toBe('3 outstanding');
    expect(studio).toContain('3 things outstanding');
  });

  /**
   * AND THE PILL DOES NOT GO GREEN OVER A REGISTER THAT HAS NOT ANSWERED EITHER. This is the
   * same defect as Finding 4 wearing a different shape: with the composition filled in and the
   * classification check unable to run, the queue is empty and a two-state pill reads that as
   * good news.
   */
  it('says it has not fully checked, rather than going green, while the register is unread', () => {
    publishMaterialStatus('error', 'acct-1111');
    register.status = 'error';
    store.products = [settledProduct()];
    draw(<Products />);
    expect(screen.getByText('Not fully checked')).toBeTruthy();
    expect(screen.queryByText('Nothing outstanding')).toBeNull();
  });

  it('does go green when every check ran and found nothing', () => {
    store.products = [settledProduct()];
    draw(<Products />);
    expect(screen.getByText('Nothing outstanding')).toBeTruthy();
  });
});

/**
 * FINDING 6. The "This surface" pill in the Geometry rules card, green over the only rule in
 * the card, which was deliberately left with no verdict. derive.ts says so in the line above
 * it: "ok: false renders as a failed check, and nothing has been checked; undefined renders as
 * a rule with no verdict." The pill read `rules.every((r) => r.ok !== false)` and went green.
 *
 * This is the guaranteed state of every new product, since `blankSpec` stopped seeding a
 * packaging id: no pack, no capacity, no CLP Annex I Table 1.3 band, nothing checked.
 */
describe('the artefact designer, on a product with no pack chosen', () => {
  beforeEach(() => {
    publishMaterials('acct-1111', FIXTURE_MATERIALS);
    register.status = 'ready';
    store.products = [
    {
      ...settledProduct({ packagingId: '' } as never),
      artefacts: [
      {
        type: 'unit-label',
        label: 'Unit label',
        widthMm: 52,
        heightMm: 74,
        version: 'Not yet produced',
        printedOn: '—',
        currency: 'not-produced',
        isPlaceholder: true
      }]

    }];

  });

  function drawDesigner() {
    return render(
      <MemoryRouter initialEntries={['/products/p-1/artefacts/unit-label']}>
          <Routes>
            <Route
              path="/products/:productId/artefacts/:artefactType"
              element={<ArtefactDesigner />} />

          </Routes>
      </MemoryRouter>
    );
  }

  it('does not paint the surface green over a rule that was never evaluated', () => {
    drawDesigner();
    // The rule is on screen and declines to state a minimum.
    expect(screen.getByText('Cannot be worked out yet')).toBeTruthy();
    const pill = screen.getByText(/52 × 74 mm/);
    // The green tone. Tested through the class because the tone IS the claim: the dimensions
    // are a fact either way, and only the colour asserts a verdict.
    expect(pill.className).not.toMatch(/teal-tint/);
  });

  it('says in words that nothing has been checked', () => {
    drawDesigner();
    expect(screen.getByText(/has not been checked against anything/i)).toBeTruthy();
  });
});
