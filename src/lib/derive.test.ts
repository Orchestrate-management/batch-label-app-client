import { describe, expect, it } from 'vitest';
import { categoryById } from './categories';
import { derive } from './derive';
import { Product } from './model';
import { artefactsFor, blankSpec } from './products';

/**
 * The "why" lines, and the documents they are allowed to cite.
 *
 * A why-line's `source` renders on the Specification screen as "Source: X." — a citation, in
 * the panel a maker opens to find out where a classification came from. The declaration of
 * conformity row cited "HH-DOC-WW100-01, issued 8 June 2026": HH is Hearth and Hollow, WW100
 * is its wax warmer, and both belong to the invented business this round removed. It was a
 * hardcoded literal, so it was identical for every account and every model, and a reference
 * number plus an issue date is precisely what a market surveillance officer asks for.
 *
 * All three categories are on by default, so a brand-new account can create an Electronics
 * product on its first visit and read it on the blank specification — model "Not yet assigned",
 * no components, and a declaration reference for a device nobody has.
 *
 * fixtures.guard.test.ts cannot see this: it watches imports, and a copied string literal is
 * invisible to it. Hence a behavioural test.
 */

function freshDevice(): Product {
  const category = categoryById('electronics');
  const spec = blankSpec(category, category.productTypes[0]);
  return {
    id: 'prod-1',
    specificationId: 'spec-1',
    name: 'First device',
    sku: 'FD-001',
    categoryId: 'electronics',
    markets: ['GB'],
    regimes: category.regimes,
    spec,
    artefacts: artefactsFor(category, spec.kind),
    identifiers: {},
    obligations: {}
  };
}

function sourcesOf(product: Product): string[] {
  const derivation = derive(product.spec, product, 'GB');
  return derivation.groups.
  flatMap((group) => group.items).
  flatMap((item) => item.why).
  map((line) => line.source).
  filter((source): source is string => Boolean(source));
}

describe('what a derivation is allowed to cite as its source', () => {
  it('cites no declaration of conformity, because none is held', () => {
    // Citing LEGISLATION is fine and stays — "Directive 2012/19/EU" is a public document that
    // exists whoever is reading. Citing a DOCUMENT HELD FOR THIS ACCOUNT is the lie, because
    // there is no document store and no account holds one.
    const sources = sourcesOf(freshDevice());
    expect(sources.join(' ')).not.toMatch(/declaration/i);
    for (const source of sources) {
      expect(source).toMatch(/Directive|Regulation|Act\b/);
    }
  });

  it('carries no trace of the deleted fixture business', () => {
    const derivation = derive(freshDevice().spec, freshDevice(), 'GB');
    const everything = JSON.stringify(derivation);
    expect(everything).not.toMatch(/HH-/);
    expect(everything).not.toMatch(/WW100/);
    expect(everything).not.toMatch(/Hearth/i);
  });

  it('still explains the declaration, without inventing a document for it', () => {
    const derivation = derive(freshDevice().spec, freshDevice(), 'GB');
    const doc = derivation.groups.
    flatMap((group) => group.items).
    find((item) => item.code === 'DoC');
    if (!doc) throw new Error('no declaration-of-conformity row');
    // The explanation the maker needs is which directives it covers and why it cannot be
    // signed yet. Neither is a claim about a document that exists.
    expect(doc.why[0].lead).toMatch(/Low Voltage Directive/);
    expect(doc.why[0].source).toBeUndefined();
  });
});
