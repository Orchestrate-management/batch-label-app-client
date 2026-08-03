import { describe, expect, it } from 'vitest';
import {
  classifyWriteError,
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
});
