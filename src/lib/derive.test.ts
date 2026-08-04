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
    evidence: { obligations: {}, sdsSections: {} }
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

/**
 * The same rule, on the cosmetics derivation, which the test above could not see.
 *
 * It asserted only that no HH-/WW100/Hearth string survived, so it was blind to a second
 * citation of a document nobody holds: the Classification section of a brand new cosmetics
 * product credited its period after opening to "the stability data in the product information
 * file" and "Source: Cosmetic product safety report, stability and challenge testing", and
 * every label warning to "Source: Cosmetic product safety report, section on warnings".
 * Further down the SAME screen the obligations list read "No product information file has been
 * assembled for this product" and "No signed cosmetic product safety report is on file".
 *
 * Nothing holds a CPSR, nothing has measured a durability, and the 12 is a constant in
 * blankSpec. The number is still shown — a maker does have to set one — but as a value on
 * their composition rather than as the finding of a study.
 */
function freshCosmetic(): Product {
  const category = categoryById('cosmetics');
  const spec = blankSpec(category, category.productTypes[0]);
  return {
    id: 'prod-2',
    specificationId: 'spec-2',
    name: 'First serum',
    sku: 'FS-001',
    categoryId: 'cosmetics',
    markets: ['GB'],
    regimes: category.regimes,
    spec,
    artefacts: artefactsFor(category, spec.kind),
    identifiers: {},
    evidence: { obligations: {}, sdsSections: {} }
  };
}

describe('what a brand new cosmetics product is allowed to cite', () => {
  it('cites no safety report and no product information file, because it holds neither', () => {
    const sources = sourcesOf(freshCosmetic());
    expect(sources.join(' ')).not.toMatch(
      /safety report|product information file|challenge testing|stability data/i
    );
  });

  /**
   * A BRAND NEW COSMETIC NOW SHOWS NO PERIOD AFTER OPENING AT ALL, which is the correction.
   *
   * This group used to emit an item unconditionally, from `spec.paoMonths`, which `blankSpec`
   * seeded to 12 — so the label preview rendered "12M" beside an open jar symbol at actual
   * size while the obligations list on the same screen read "Neither a period after opening nor
   * a date of minimum durability is shown". A period after opening is a legal marking on a
   * cosmetic and nothing in this application has measured one.
   *
   * The group stays, with `emptyText`, so the panel still says the duty exists.
   */
  it('shows no period after opening until one has been set', () => {
    const derivation = derive(freshCosmetic().spec, freshCosmetic(), 'GB');
    const durability = derivation.groups.find((group) => group.id === 'durability');
    if (!durability) throw new Error('no durability group');
    expect(durability.items).toEqual([]);
    expect(durability.emptyText).toMatch(/no period after opening is set/i);
    // Nothing anywhere in the group may read as a figure a label could carry.
    expect(JSON.stringify(durability)).not.toMatch(/\d+M\b/);
    expect(derivation.cosmetic?.pao).toBe('');
  });

  it('attributes a period after opening that HAS been set to the composition, not to a study', () => {
    const product = freshCosmetic();
    if (product.spec.kind !== 'phased') throw new Error('expected a phased spec');
    const withPao = { ...product, spec: { ...product.spec, paoMonths: 6 } };
    const derivation = derive(withPao.spec, withPao, 'GB');
    const durability = derivation.groups.find((group) => group.id === 'durability');
    if (!durability) throw new Error('no durability group');
    const line = durability.items[0].why[0];
    expect(line.source).toBeUndefined();
    expect(line.meta).toMatch(/value set on this composition/i);
    // The lead asserted a minimum durability of more than thirty months. Nothing has measured
    // the durability at all, so there is no number for it to be more than.
    expect(JSON.stringify(durability)).not.toMatch(/30 months/i);
    expect(derivation.cosmetic?.pao).toBe('6M');
  });

  it('does not describe every cosmetic as a leave-on facial product', () => {
    const derivation = derive(freshCosmetic().spec, freshCosmetic(), 'GB');
    const precautions = derivation.groups.find((group) => group.id === 'precautions');
    if (!precautions) throw new Error('no precautions group');
    for (const item of precautions.items) {
      expect(item.why[0].source).toBeUndefined();
      // "leave-on facial product" was hardcoded, for every product type in the category.
      expect(item.why[0].lead).not.toMatch(/facial/i);
      expect(item.why[0].lead).toContain(freshCosmetic().spec.productType.toLowerCase());
    }
  });
});

/**
 * A shipped certificate expiry is Batchlabel's fact about its own reference library, not a
 * countdown against the maker's product.
 *
 * The component catalogue carries expiry dates. One of them raised a clay-toned "Close to a
 * threshold" panel reading "<component> has evidence expiring in N days… The declaration for
 * <their model> stops being supportable on that date unless a current document is on file" —
 * outstanding compliance work, under the customer's own model name, identical for every
 * account that picks the part, and unresolvable by construction because there is nowhere to
 * put a document. Same shape as the invented warnings removed from the documents pipeline.
 *
 * The assertion is conditional on the note firing because the trigger is a real date in the
 * catalogue and the window is ninety days: once it passes, no note is produced and there is
 * nothing to word wrongly. What must never come back is the wording.
 */
describe('a certificate expiry in the shipped component catalogue', () => {
  it('is worded as Batchlabel\'s document rather than the maker\'s evidence', () => {
    const product = freshDevice();
    const spec = { ...product.spec, items: [{ materialId: 'cmp-heater', quantity: 1, position: 'A1' }] };
    if (spec.kind !== 'bom') throw new Error('expected a bill of materials');
    const derivation = derive(spec, { ...product, spec }, 'GB');
    const notes = derivation.proximity.filter((note) => note.code === 'Certificate');

    for (const note of notes) {
      expect(note.message).toMatch(/Batchlabel/);
      expect(note.message).not.toMatch(/unless a current document is on file/i);
      // It may not say the maker's own declaration stops being supportable: no declaration
      // exists, and nothing about this date is theirs.
      expect(note.message).not.toMatch(/stops being supportable/i);
    }
  });
});
