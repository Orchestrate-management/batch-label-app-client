import { afterEach, describe, expect, it } from 'vitest';
import { FIXTURE_MATERIALS } from './fixtures';
import {
  allMaterials,
  ingredientById,
  materialById,
  materialCitation,
  materialOrigin,
  materialsSettled,
  packagingById,
  publishMaterialStatus,
  publishMaterials,
  resetMaterials } from
'./material-index';
import { IngredientMaterial, Material } from './model';

/**
 * THE INDEX EXISTS SO THE DERIVATION CAN STAY SYNCHRONOUS, AND ITS DANGER IS ONE QUESTION:
 * what does a lookup miss mean?
 *
 * Three different things — not loaded, failed to load, genuinely absent — and only the third
 * is a fact about the composition. Everything below is about keeping those three apart, and
 * about the one property that makes the module safe to have at all: an answer about one
 * account never survives into another's screen.
 */

afterEach(() => resetMaterials());

describe('what an empty lookup means', () => {
  it('is not settled before anything has been published', () => {
    expect(materialsSettled()).toBe(false);
    expect(materialById('ing-black-fig')).toBeUndefined();
  });

  it('is not settled while a read is in flight', () => {
    publishMaterialStatus('loading', 'acct-1');
    expect(materialsSettled()).toBe(false);
  });

  it('is not settled when the read failed', () => {
    publishMaterialStatus('error', 'acct-1');
    expect(materialsSettled()).toBe(false);
  });

  it('is settled — and empty is then an answer — when a read came back with nothing', () => {
    // The first screen every real customer sees. An empty register IS the answer here, and
    // the screens are allowed to say so.
    publishMaterials('acct-1', []);
    expect(materialsSettled()).toBe(true);
    expect(allMaterials()).toEqual([]);
  });
});

describe('publishing an answer', () => {
  it('resolves a material by id, by class, and not by the wrong class', () => {
    publishMaterials('acct-1', FIXTURE_MATERIALS);
    expect(materialById('ing-black-fig')?.name).toBe('Black Fig and Cassis');
    expect(ingredientById('ing-black-fig')).toBeDefined();
    // A packaging id asked for as an ingredient is a caller mistake, not a fallback.
    expect(ingredientById('pkg-tumbler-250')).toBeUndefined();
    expect(packagingById('pkg-tumbler-250')).toBeDefined();
    expect(packagingById('ing-black-fig')).toBeUndefined();
  });

  it('replaces wholesale rather than merging', () => {
    // A material archived in another tab must stop resolving. A merge would leave it
    // resolvable, and a resolved material is one a label is printed from.
    publishMaterials('acct-1', FIXTURE_MATERIALS);
    publishMaterials('acct-1', []);
    expect(materialById('ing-black-fig')).toBeUndefined();
  });

  it('empties the map when a non-ready status is published', () => {
    publishMaterials('acct-1', FIXTURE_MATERIALS);
    publishMaterialStatus('error', 'acct-1');
    expect(materialById('ing-black-fig')).toBeUndefined();
    expect(allMaterials()).toEqual([]);
  });

  it('is emptied by a reset, so no signed-in user inherits the last one\'s register', () => {
    publishMaterials('acct-1', FIXTURE_MATERIALS);
    resetMaterials();
    expect(materialsSettled()).toBe(false);
    expect(materialById('ing-black-fig')).toBeUndefined();
  });

  it('ignores an empty id rather than resolving something', () => {
    publishMaterials('acct-1', FIXTURE_MATERIALS);
    expect(materialById('')).toBeUndefined();
  });
});

describe('what a derived line may cite', () => {
  const own = (extra: Partial<IngredientMaterial> = {}): Material =>
  ({
    id: 'mat-1',
    source: 'account',
    class: 'ingredient',
    role: 'Fragrance oil',
    name: 'My oil',
    categories: [],
    editable: true,
    hazards: [],
    allergens: [],
    ifra: [],
    ...extra
  } as IngredientMaterial);

  it('cites nothing when no document is recorded, even when a supplier is', () => {
    // THE ONE THAT MUST NEVER BE INVENTED. WhyLine.source is optional precisely so a line
    // with no honest source carries none — a citation is what a maker repeats to a regulator.
    expect(materialCitation(own({ supplier: 'Aurelia Fragrances' }))).toBeUndefined();
  });

  it('cites nothing at all for a material with neither', () => {
    expect(materialCitation(own())).toBeUndefined();
  });

  it('cites the supplier and the document when both are recorded', () => {
    const citation = materialCitation(
      own({
        supplier: 'Aurelia Fragrances',
        document: {
          kind: 'Safety data sheet',
          reference: 'aurelia-fo-4471-sds',
          version: '4.2',
          date: '2025-11-14'
        }
      })
    );
    expect(citation).toContain('Aurelia Fragrances');
    expect(citation).toContain('4.2');
  });
});

describe('how a material describes whose fact it is', () => {
  const base = {
    id: 'x',
    class: 'ingredient' as const,
    role: 'Wax',
    name: 'x',
    categories: [],
    hazards: [],
    allergens: [],
    ifra: []
  };

  it('says a maker\'s own row is theirs', () => {
    expect(materialOrigin({ ...base, source: 'account', editable: true })).toMatch(/your own/i);
  });

  it('says when their row is standing in place of ours', () => {
    expect(
      materialOrigin({
        ...base,
        source: 'account',
        editable: true,
        overridesReferenceId: 'ref-1'
      })
    ).toMatch(/in place of ours/i);
  });

  it('says an illustrative example is not a classification', () => {
    // The provenance value that means "made up to show the shape". A screen rendering one
    // has to label it, and this is the sentence it labels it with.
    expect(
      materialOrigin({
        ...base,
        source: 'reference',
        editable: false,
        provenance: 'illustrative-example'
      })
    ).toMatch(/example/i);
  });

  it('says a real reference row is Batchlabel\'s, without calling it an example', () => {
    const origin = materialOrigin({
      ...base,
      source: 'reference',
      editable: false,
      provenance: 'supplier-document'
    });
    expect(origin).toMatch(/Batchlabel reference/i);
    expect(origin).not.toMatch(/example/i);
  });
});
