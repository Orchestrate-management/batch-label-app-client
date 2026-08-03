import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A stand-in for the two tables, chained the way supabase-js chains.
 *
 * It exists for one function: createProduct, whose failure path decides whether a
 * specification is archived — and archiving the specification of a product that DID commit
 * hides a live, metered SKU on every screen, permanently, with no way back from the browser.
 * That decision cannot be reasoned about from a type check; it needs the shapes supabase-js
 * actually hands back, including the one with no Postgres code in it.
 */
const db = vi.hoisted(() => {
  const state = {
    specInsert: { data: null as unknown, error: null as unknown },
    productInsert: { data: null as unknown, error: null as unknown },
    lookup: { data: null as unknown, error: null as unknown },
    specPayload: null as Record<string, unknown> | null,
    productPayload: null as Record<string, unknown> | null,
    lookupFilters: [] as Array<[string, unknown]>,
    archived: [] as string[]
  };

  const query = (result: () => {data: unknown;error: unknown;}, onEq?: (column: string, value: unknown) => void) => {
    const q: Record<string, unknown> = {};
    const chain = () => q;
    Object.assign(q, {
      select: chain,
      is: chain,
      limit: chain,
      order: chain,
      eq: (column: string, value: unknown) => {
        onEq?.(column, value);
        return q;
      },
      single: async () => result(),
      maybeSingle: async () => result(),
      then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
      Promise.resolve(result()).then(resolve, reject)
    });
    return q;
  };

  const supabase = {
    from(table: string) {
      return {
        insert(payload: Record<string, unknown>) {
          if (table === 'specifications') state.specPayload = payload;
          else state.productPayload = payload;
          return query(() => table === 'specifications' ? state.specInsert : state.productInsert);
        },
        // Only createProduct's "did it land anyway?" lookup reaches this.
        select: () =>
        query(
          () => state.lookup,
          (column, value) => state.lookupFilters.push([column, value])
        ),
        update: (payload: Record<string, unknown>) => ({
          eq: (_column: string, value: unknown) => {
            if (payload.archived_at) state.archived.push(String(value));
            return Promise.resolve({ data: null, error: null });
          }
        })
      };
    }
  };

  return { state, supabase };
});

vi.mock('./supabase', () => ({ supabase: db.supabase, isSupabaseConfigured: true }));

import {
  classifyWriteError,
  createProduct,
  toProduct,
  type ProductRow,
  type SpecificationRow } from
'./products';

/**
 * The two things in lib/products.ts that can be tested without a database, and both of them
 * are places where being wrong is expensive rather than annoying.
 *
 * The mapping, because a row that comes back slightly different from what was expected must
 * degrade to something renderable rather than throw inside a render — one malformed row would
 * otherwise cost a maker every other row on the screen.
 *
 * The error classification, because it is what stands between the SKU meter and a maker: get
 * it wrong and somebody at their plan allowance is told "something went wrong, try again",
 * and tries again, and is told it again.
 */

function specRow(overrides: Partial<SpecificationRow> = {}): SpecificationRow {
  return {
    id: 'spec-1',
    name: 'Black Fig and Cassis',
    category_id: 'home-fragrance',
    kind: 'mixture',
    product_type: 'Container candle',
    fragrance_id: 'ing-black-fig',
    base_id: 'ing-crw45',
    dye_id: 'ing-no-dye',
    load: 8,
    additive: 'None',
    markets: ['GB', 'EU'],
    regimes: ['clp', 'gpsr'],
    ufi: null,
    data: {},
    ...overrides
  };
}

function productRow(overrides: Partial<ProductRow> = {}): ProductRow {
  return {
    id: 'prod-1',
    specification_id: 'spec-1',
    name: 'Black Fig and Cassis',
    sku: 'CC-BFC-220',
    net_quantity: 220,
    net_unit: 'g',
    packaging_id: 'pkg-tumbler-250',
    identifiers: {},
    obligations: {},
    data: {},
    created_at: '2026-08-01T10:00:00Z',
    ...overrides
  };
}

describe('reading a product row', () => {
  it('assembles the composition from the specification and the pack from the product', () => {
    const product = toProduct(productRow(), specRow());

    expect(product.id).toBe('prod-1');
    expect(product.specificationId).toBe('spec-1');
    expect(product.categoryId).toBe('home-fragrance');
    expect(product.markets).toEqual(['GB', 'EU']);
    expect(product.regimes).toEqual(['clp', 'gpsr']);
    expect(product.spec.kind).toBe('mixture');
    if (product.spec.kind === 'mixture') {
      expect(product.spec.fragranceId).toBe('ing-black-fig');
      expect(product.spec.load).toBe(8);
    }
    // The pack is the product's, not the specification's. This is the whole point of the split.
    expect(product.spec.netQuantity).toBe(220);
    expect(product.spec.netUnit).toBe('g');
    expect(product.spec.packagingId).toBe('pkg-tumbler-250');
  });

  it('carries the specification id, so a composition edit knows what to update', () => {
    // Without it saveComposition refuses rather than guessing, and a wrong guess would
    // rewrite a different product's classification.
    expect(toProduct(productRow(), specRow()).specificationId).toBe('spec-1');
  });

  it('reads a numeric that arrived as a string rather than turning it into NaN', () => {
    const product = toProduct(productRow({ net_quantity: '220.000' }), specRow({ load: '8.5' }));
    expect(product.spec.netQuantity).toBe(220);
    if (product.spec.kind === 'mixture') expect(product.spec.load).toBe(8.5);
  });

  it('takes the UFI from the specification, never from the product', () => {
    // CLP Annex VIII ties the UFI to the composition: one UFI, however many pack sizes. The
    // schema has no ufi column on products at all, and an identifiers blob claiming one must
    // not become a UFI on a label.
    const withUfi = toProduct(
      productRow({ identifiers: { ufi: 'ABCD-1234-EFGH-5678' } }),
      specRow({ ufi: 'UFI0-1111-2222-3333' })
    );
    expect(withUfi.identifiers.ufi).toBe('UFI0-1111-2222-3333');

    const withoutUfi = toProduct(productRow(), specRow());
    expect(withoutUfi.identifiers.ufi).toBeUndefined();
  });

  it('never reports an artefact as produced', () => {
    for (const artefact of toProduct(productRow(), specRow()).artefacts) {
      expect(artefact.version).toBe('Not yet produced');
      expect(artefact.printedOn).toBe('—');
    }
  });

  it('falls back rather than throwing on a row it does not recognise', () => {
    const product = toProduct(
      productRow({ name: null, sku: null, net_unit: 'furlongs', net_quantity: null }),
      specRow({ category_id: 'something-new', kind: 'phased', markets: [], regimes: null })
    );
    expect(product.name).toBe('Untitled product');
    expect(product.sku).toBe('');
    // An unknown category resolves through `kind`, which still says what shape the
    // composition has, rather than silently becoming home fragrance.
    expect(product.categoryId).toBe('cosmetics');
    expect(product.spec.kind).toBe('phased');
    // GB is the column's own default; a product sold nowhere would render no address block.
    expect(product.markets).toEqual(['GB']);
    // Which rules apply is a fact about what the product is. An empty list would tell a maker
    // that no regime applies to a cosmetic.
    expect(product.regimes.length).toBeGreaterThan(0);
  });

  it('keeps only boolean obligations', () => {
    const product = toProduct(
      productRow({ obligations: { 'clp-classification': true, 'clp-ufi': 'yes', other: null } }),
      specRow()
    );
    expect(product.obligations).toEqual({ 'clp-classification': true });
  });
});

describe('classifying a refused write', () => {
  it('matches the SKU meter on its hint, not on its sentence', () => {
    // The trigger's own comment: "Match the hint, never the sentence: the sentence is
    // customer-facing copy and will be rewritten." So a reworded message must still classify.
    expect(
      classifyWriteError({
        code: 'P0001',
        hint: 'sku_limit_reached',
        message: 'anything at all, rewritten next week'
      }).reason
    ).toBe('sku_limit');
  });

  it('reads a unique violation as a duplicate product code', () => {
    expect(classifyWriteError({ code: '23505', message: 'duplicate key' }).reason).toBe(
      'duplicate_sku'
    );
  });

  it('reads a not-null violation as an account that is not set up', () => {
    // account_id defaults to current_account_id(), which is NULL for a user with no
    // membership or with two. The NOT NULL constraint is what turns that into an error at
    // the insert rather than a row filed against a guess.
    expect(classifyWriteError({ code: '23502', message: 'null value in column' }).reason).toBe(
      'no_account'
    );
  });

  it('never surfaces the database sentence to a customer', () => {
    const classified = classifyWriteError({
      code: 'P0001',
      hint: 'sku_limit_reached',
      message: 'SKU limit reached: this account already holds 3 of 3 SKUs.'
    });
    expect(classified.message).not.toContain('SKU limit reached:');
  });

  it('falls back to a generic failure for anything it does not know', () => {
    expect(classifyWriteError({ code: '42P01', message: 'relation does not exist' }).reason).toBe(
      'failed'
    );
    expect(classifyWriteError(null).reason).toBe('failed');
  });

  it('does not blame a missing account when the call supplied one', () => {
    // A 23502 on a write that sent account_id cannot be about the account. Saying it is would
    // be inventing a cause, and the sentence tells somebody to wait for something that has
    // already happened.
    const classified = classifyWriteError(
      { code: '23502', message: 'null value in column' },
      { accountIdSupplied: true }
    );
    expect(classified.reason).toBe('failed');
  });

  it('does not tell anybody their account is nearly ready', () => {
    // current_account_id() returns NULL for two reasons — no membership, which resolves on
    // its own, and more than one, which never does. Both arrive as 23502, so the one sentence
    // that covers both must not promise that waiting fixes it.
    const message = classifyWriteError({ code: '23502', message: 'null value in column' }).message;
    expect(message).toMatch(/nothing has been saved/i);
    expect(message).not.toMatch(/usually takes a moment/i);
  });
});

/**
 * Creating a product, and the two rows it takes.
 *
 * Every case below is about the SECOND insert failing, because that is where a specification
 * is left behind and a decision has to be made about it. Getting that decision wrong in the
 * direction the code used to has no recovery path in this app at all: the browser holds no
 * DELETE on specifications and there is no un-archive.
 */
describe('creating a product', () => {
  const SPEC = { id: 'spec-1', name: 'Black Fig and Cassis', category_id: 'home-fragrance', kind: 'mixture' };
  const PRODUCT = { id: 'prod-1', specification_id: 'spec-1', name: 'Black Fig and Cassis', sku: 'CC-BFC-220' };

  const input = {
    name: 'Black Fig and Cassis',
    sku: 'CC-BFC-220',
    categoryId: 'home-fragrance' as const,
    productType: 'Container candle'
  };

  beforeEach(() => {
    db.state.specInsert = { data: SPEC, error: null };
    db.state.productInsert = { data: PRODUCT, error: null };
    db.state.lookup = { data: null, error: null };
    db.state.specPayload = null;
    db.state.productPayload = null;
    db.state.lookupFilters = [];
    db.state.archived = [];
  });

  it('sends the account id it was given, on both rows', async () => {
    await createProduct(input, 'acct-1111');
    expect(db.state.specPayload?.account_id).toBe('acct-1111');
    expect(db.state.productPayload?.account_id).toBe('acct-1111');
  });

  it('omits the column entirely when no account has been resolved', async () => {
    // Omitted means the database's own default decides. Sending null would be an explicit
    // claim that the row belongs to no account, and would fail the NOT NULL constraint.
    await createProduct(input);
    expect(db.state.specPayload).not.toHaveProperty('account_id');
    expect(db.state.productPayload).not.toHaveProperty('account_id');
  });

  it('archives the specification when the meter definitely refused the product', async () => {
    db.state.productInsert = {
      data: null,
      error: { code: 'P0001', hint: 'sku_limit_reached', message: 'SKU limit reached' }
    };
    const result = await createProduct(input, 'acct-1111');

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('sku_limit');
    expect(db.state.archived).toEqual(['spec-1']);
  });

  it('leaves the specification alone when the failure carried no refusal', async () => {
    // A dropped socket or a proxy 5xx: supabase-js hands back an error with no Postgres code.
    // Nothing here establishes that the database refused anything, so nothing may be archived
    // on the strength of it.
    db.state.productInsert = { data: null, error: { message: 'Failed to fetch' } };
    const result = await createProduct(input, 'acct-1111');

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('failed');
    expect(db.state.archived).toEqual([]);
  });

  it('returns the product when the insert won and only the answer was lost', async () => {
    // The expensive case. The row committed, the response did not come back, and archiving
    // the specification would hide a product that counts against the plan allowance on every
    // screen, for good.
    db.state.productInsert = { data: null, error: { message: 'Failed to fetch' } };
    db.state.lookup = { data: PRODUCT, error: null };

    const result = await createProduct(input, 'acct-1111');

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.id).toBe('prod-1');
    expect(db.state.archived).toEqual([]);
    expect(db.state.lookupFilters).toContainEqual(['specification_id', 'spec-1']);
  });

  it('archives nothing when it could not find out what happened', async () => {
    db.state.productInsert = { data: null, error: { code: '23505', message: 'duplicate key' } };
    db.state.lookup = { data: null, error: { message: 'Failed to fetch' } };

    const result = await createProduct(input, 'acct-1111');

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('duplicate_sku');
    // A lookup that itself failed proves nothing either way. An orphaned specification is
    // invisible and meters nothing; an archived one under a live product is unreachable.
    expect(db.state.archived).toEqual([]);
  });
});
