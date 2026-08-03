import { describe, expect, it } from 'vitest';
import { Product } from './model';
import { PRODUCTS, createProduct } from './products';
import { obligationSatisfied, outstandingObligations } from './regimes';

/**
 * The UFI claim.
 *
 * Nothing in Batchlabel generates a UFI. Telling a maker the CLP UFI obligation
 * is met is the most expensive lie the app can tell: they ship a label missing a
 * mandatory element and skip the poison centre notification keyed on it. So the
 * assertion is behavioural rather than textual — no route through the app may
 * report that obligation as done, whatever is stored against the product.
 */

function withObligations(overrides: Record<string, boolean>): Product {
  return { ...PRODUCTS[0], obligations: { ...PRODUCTS[0].obligations, ...overrides } };
}

describe('the UFI obligation', () => {
  it('is not satisfied even when a product claims it is', () => {
    expect(obligationSatisfied(withObligations({ 'clp-ufi': true }), 'clp-ufi')).toBe(false);
  });

  it('is outstanding on every product subject to CLP', () => {
    const clpProducts = PRODUCTS.filter((product) => product.regimes.includes('clp'));
    expect(clpProducts.length).toBeGreaterThan(0);
    for (const product of clpProducts) {
      expect(outstandingObligations(product).map((o) => o.id)).toContain('clp-ufi');
    }
  });

  it('leaves no product carrying a UFI, seeded or created', () => {
    for (const product of PRODUCTS) {
      expect(product.identifiers.ufi).toBeUndefined();
    }
    const created = createProduct({
      name: 'Test Only',
      sku: 'TO-001',
      categoryId: 'home-fragrance',
      productType: 'Container candle'
    });
    expect(created.identifiers.ufi).toBeUndefined();
  });
});

describe('every other obligation', () => {
  it('still answers from what the product records', () => {
    const product = withObligations({ 'clp-classification': true, 'clp-pcn-gb': false });
    expect(obligationSatisfied(product, 'clp-classification')).toBe(true);
    expect(obligationSatisfied(product, 'clp-pcn-gb')).toBe(false);
  });

  it('treats an unrecorded obligation as outstanding', () => {
    expect(obligationSatisfied(PRODUCTS[0], 'never-heard-of-it')).toBe(false);
  });
});
