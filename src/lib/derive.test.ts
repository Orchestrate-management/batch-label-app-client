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
 * the panel a maker opens to find out where a classification came from. A citation may name a
 * PUBLIC document — a regulation, a directive, a published standard — because that exists
 * whoever is reading it. It may never name a document held FOR THIS ACCOUNT, because there is
 * no document store and no account holds one.
 *
 * The rule was found on a declaration-of-conformity row citing "HH-DOC-WW100-01, issued 8 June
 * 2026" — a hardcoded literal naming the invented business this round removed, identical for
 * every account. That row and the category behind it are gone; the rule is not, and it is
 * asserted here on the composition shape that remains.
 *
 * fixtures.guard.test.ts cannot see this: it watches imports, and a copied string literal is
 * invisible to it. Hence a behavioural test.
 */

function freshFragrance(): Product {
  const category = categoryById('home-fragrance');
  const spec = blankSpec(category.productTypes[0]);
  return {
    id: 'prod-1',
    specificationId: 'spec-1',
    name: 'First candle',
    sku: 'FC-001',
    categoryId: 'home-fragrance',
    markets: ['GB'],
    regimes: category.regimes,
    spec,
    artefacts: artefactsFor(category),
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
  it('cites no document held for this account', () => {
    // Citing a PUBLIC document is fine and stays — "EN 15494:2019" is a published standard
    // that exists whoever is reading. Citing a DOCUMENT HELD FOR THIS ACCOUNT is the lie,
    // because there is no document store and no account holds one.
    const sources = sourcesOf(freshFragrance());
    expect(sources.length).toBeGreaterThan(0);
    expect(sources.join(' ')).not.toMatch(/declaration|certificate|report\b/i);
    for (const source of sources) {
      expect(source).toMatch(/Directive|Regulation|Act\b|EN \d|guidance/);
    }
  });

  it('carries no trace of the deleted fixture business', () => {
    const derivation = derive(freshFragrance().spec, freshFragrance(), 'GB');
    const everything = JSON.stringify(derivation);
    expect(everything).not.toMatch(/HH-/);
    expect(everything).not.toMatch(/WW100/);
    expect(everything).not.toMatch(/Hearth/i);
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
