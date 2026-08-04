import { afterEach, describe, expect, it } from 'vitest';
import { categoryById } from './categories';
import { derive, deriveMixture } from './derive';
import { FIXTURE_MATERIALS } from './fixtures';
import {
  publishMaterialStatus,
  publishMaterials,
  resetMaterials } from
'./material-index';
import { IngredientMaterial, MixtureSpec, Product } from './model';
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
    obligations: {}
  };
}

describe('what a brand new cosmetics product is allowed to cite', () => {
  it('cites no safety report and no product information file, because it holds neither', () => {
    const sources = sourcesOf(freshCosmetic());
    expect(sources.join(' ')).not.toMatch(
      /safety report|product information file|challenge testing|stability data/i
    );
  });

  it('attributes the period after opening to the composition, not to a study', () => {
    const derivation = derive(freshCosmetic().spec, freshCosmetic(), 'GB');
    const durability = derivation.groups.find((group) => group.id === 'durability');
    if (!durability) throw new Error('no durability group');
    const line = durability.items[0].why[0];
    expect(line.source).toBeUndefined();
    expect(line.meta).toMatch(/value set on this composition/i);
    // The lead asserted a minimum durability of more than thirty months. Nothing has measured
    // the durability at all, so there is no number for it to be more than.
    expect(JSON.stringify(durability)).not.toMatch(/30 months/i);
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
 * WHAT A DEVICE'S CONFORMITY FILE MAY SAY NOW THE COMPONENT CATALOGUE IS GONE.
 *
 * The test this replaces asserted the WORDING of a certificate-expiry countdown: a date from
 * the shipped COMPONENTS array, rendered as a note against the maker's own model. The wording
 * had already been corrected once ("Batchlabel's document, not your evidence"), which is what
 * the old test protected. Rhys's ruling removed the array underneath it, so there is no date,
 * no RoHS status and no standards list left to word — and the assertion worth keeping is that
 * none of them comes back.
 */
describe('a device whose bill of materials has parts on it', () => {
  it('states no RoHS status, no standard and no certificate date for any of them', () => {
    const product = freshDevice();
    const spec = {
      ...product.spec,
      items: [{ materialId: 'PTC heating element', quantity: 1, position: 'A1' }]
    };
    if (spec.kind !== 'bom') throw new Error('expected a bill of materials');
    const derivation = derive(spec, { ...product, spec }, 'GB');
    const everything = JSON.stringify(derivation);

    // Every one of these was rendered from a constant, under the maker's own model name.
    // The word RoHS is fine and stays — "nothing here has been checked for RoHS" is the
    // honest sentence; what may not come back is a STATUS, which is a finding.
    expect(everything).not.toMatch(/compliant/i);
    expect(everything).not.toMatch(/not declared/i);
    expect(everything).not.toMatch(/EN IEC/);
    expect(everything).not.toMatch(/exemption/i);
    expect(derivation.proximity.filter((note) => note.code === 'Certificate')).toEqual([]);
    // And no count of declarations held, because none is held and none is examined.
    expect(everything).not.toMatch(/\d+ of \d+/);
  });

  it('lists the part as entered and says nothing has been checked', () => {
    const product = freshDevice();
    const spec = {
      ...product.spec,
      items: [{ materialId: 'PTC heating element', quantity: 1, position: 'A1' }]
    };
    if (spec.kind !== 'bom') throw new Error('expected a bill of materials');
    const group = derive(spec, { ...product, spec }, 'GB').groups.find((g) => g.id === 'components');
    expect(group?.items[0].text).toBe('PTC heating element');
    expect(group?.items[0].why[0].meta).toMatch(/nothing here has been checked/i);
  });
});

/**
 * A DERIVATION THAT HAS NOT READ THE REGISTER IS NOT A DERIVATION THAT FOUND NOTHING.
 *
 * The single most dangerous consequence of materials moving out of the bundle. Every lookup
 * misses while the read is in flight, the classification comes back with no hazards, and the
 * group underneath it used to read "No hazard statements are required at this fragrance load"
 * — a compliance claim about a real candle, produced by a request that had not finished. It is
 * worse than the invented findings this codebase has already removed, because it removes
 * warnings instead of adding them.
 */
describe('a classification derived before the materials register has answered', () => {
  afterEach(() => resetMaterials());

  const candle: MixtureSpec = {
    kind: 'mixture',
    productType: 'Container candle',
    baseId: 'ing-crw45',
    fragranceId: 'ing-black-fig',
    load: 8,
    dyeId: '',
    additive: '',
    netQuantity: 220,
    netUnit: 'g',
    packagingId: 'pkg-tumbler-250'
  };

  it('marks itself pending rather than answering', () => {
    publishMaterialStatus('loading', 'acct-1');
    const derivation = deriveMixture(candle);
    expect(derivation.pending).toBe(true);
  });

  it('does not say no hazard statements are required', () => {
    publishMaterialStatus('loading', 'acct-1');
    const hazards = deriveMixture(candle).groups.find((group) => group.id === 'hazards');
    expect(hazards?.items).toEqual([]);
    expect(hazards?.emptyText).not.toMatch(/no hazard statements are required/i);
    expect(hazards?.emptyText).toMatch(/has not loaded/i);
  });

  it('does not say the signal word is None required', () => {
    // The loudest thing on a CLP label. Its absence is a positive statement.
    publishMaterialStatus('loading', 'acct-1');
    const signal = deriveMixture(candle).summary.find((entry) => entry.label === 'Signal word');
    expect(signal?.value).toBe('Not worked out');
  });

  it('answers properly once the register has landed', () => {
    publishMaterials('acct-1', FIXTURE_MATERIALS);
    const derivation = deriveMixture(candle);
    expect(derivation.pending).toBe(false);
    expect(derivation.unresolved).toEqual([]);
    expect(derivation.clp?.hazards.length).toBeGreaterThan(0);
  });
});

/**
 * A composition naming a material the register cannot produce.
 *
 * Reachable on a real account for one ordinary reason: the maker archived the material. The
 * id stays on the specification, resolves to nothing, and contributes nothing.
 */
describe('a classification whose fragrance oil is not in the register', () => {
  afterEach(() => resetMaterials());

  const orphaned: MixtureSpec = {
    kind: 'mixture',
    productType: 'Container candle',
    baseId: 'ing-crw45',
    fragranceId: 'ing-archived-last-year',
    load: 8,
    dyeId: '',
    additive: '',
    netQuantity: 220,
    netUnit: 'g',
    packagingId: 'pkg-tumbler-250'
  };

  it('names the material it could not resolve', () => {
    publishMaterials('acct-1', FIXTURE_MATERIALS);
    const derivation = deriveMixture(orphaned);
    expect(derivation.unresolved).toEqual([
    { slot: 'Fragrance oil', id: 'ing-archived-last-year' }]
    );
  });

  it('refuses to report the empty result as a finished classification', () => {
    publishMaterials('acct-1', FIXTURE_MATERIALS);
    const derivation = deriveMixture(orphaned);
    const hazards = derivation.groups.find((group) => group.id === 'hazards');
    expect(hazards?.emptyText).toMatch(/not in your materials register/i);
    expect(hazards?.emptyText).not.toMatch(/no hazard statements are required/i);
    const signal = derivation.summary.find((entry) => entry.label === 'Signal word');
    expect(signal?.value).toBe('Not worked out');
  });

  it('does not treat an unchosen slot as an unresolved material', () => {
    // An empty slot is a composition the maker has not finished, which the pipeline already
    // reports as its own kind of gap. Only an id that was SET and did not resolve is this.
    publishMaterials('acct-1', FIXTURE_MATERIALS);
    const derivation = deriveMixture({ ...orphaned, fragranceId: '', baseId: '', dyeId: '' });
    expect(derivation.unresolved).toEqual([]);
  });
});

/**
 * A HAZARD WITH NO CONCENTRATION LIMIT CANNOT BE PLACED, AND MUST NOT BE DECIDED EITHER WAY.
 *
 * `material_hazards.gcl` is nullable because a supplier does not always state one, and the
 * column comment gives the rule: a null must be rendered as unknown and never as zero. Zero
 * transfers the hazard at every load; a hundred transfers it at none.
 */
describe('a material carrying a hazard with no concentration limit', () => {
  afterEach(() => resetMaterials());

  const oil: IngredientMaterial = {
    id: 'mat-oil',
    source: 'account',
    class: 'ingredient',
    role: 'Fragrance oil',
    name: 'My oil',
    categories: ['home-fragrance'],
    editable: true,
    hazards: [
    {
      code: 'H317',
      statement: 'May cause an allergic skin reaction.',
      hazardClass: 'Skin Sens. 1'
    }],

    allergens: [],
    ifra: []
  };

  const spec: MixtureSpec = {
    kind: 'mixture',
    productType: 'Container candle',
    baseId: '',
    fragranceId: 'mat-oil',
    load: 10,
    dyeId: '',
    additive: '',
    netQuantity: 220,
    netUnit: 'g',
    packagingId: ''
  };

  it('shows it in the working, marked as unplaced', () => {
    publishMaterials('acct-1', [oil]);
    const hazards = deriveMixture(spec).groups.find((group) => group.id === 'hazards');
    expect(hazards?.items).toHaveLength(1);
    expect(hazards?.items[0].tone).toBe('warn');
    expect(hazards?.items[0].text).toMatch(/not placed/i);
    expect(hazards?.items[0].why[0].meta).toMatch(/no generic or specific concentration limit/i);
  });

  it('keeps it off the label, because nothing decided that it belongs there', () => {
    publishMaterials('acct-1', [oil]);
    const derivation = deriveMixture(spec);
    expect(derivation.clp?.hazards).toEqual([]);
    expect(derivation.clp?.signalWord).toBeNull();
  });
});
