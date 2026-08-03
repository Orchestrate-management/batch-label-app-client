import { describe, expect, it } from 'vitest';
import { categoryById } from './categories';
import { derive } from './derive';
import { Product } from './model';
import { buildSds } from './sds';
import { artefactsFor, blankSpec } from './products';

/**
 * What the safety data sheet says about itself.
 *
 * This is the one artefact rendered at A4 and meant to be handed to a customer or a regulator,
 * so a sentence on its face is a sentence the maker is putting their name to. Two of them were
 * not ours to write:
 *
 *   Section 16 said "This sheet was assembled from the supplier documents on file." There is
 *   no document store, no account holds a supplier document, and every classification in the
 *   sheet comes from Batchlabel's shipped reference library — which the materials register was
 *   rewritten to say plainly, and the same sentence has to survive onto the artefact.
 *
 *   The line above it printed "Revision Not yet produced, issued —." A revision history is a
 *   regulatory claim; the placeholders belong in a workspace panel, not on the document.
 */

function freshMixture(): Product {
  const category = categoryById('home-fragrance');
  const spec = blankSpec(category, 'Container candle', 'ing-bfc');
  return {
    id: 'prod-1',
    specificationId: 'spec-1',
    name: 'First product',
    sku: 'FP-001',
    categoryId: 'home-fragrance',
    markets: ['GB'],
    regimes: category.regimes,
    spec: { ...spec, kind: 'mixture', load: 8 } as Product['spec'],
    artefacts: artefactsFor(category, 'mixture'),
    identifiers: {},
    obligations: {}
  };
}

function sheetFor(product: Product) {
  return buildSds(product, derive(product.spec, product, 'GB'), 'GB');
}

describe('what section 16 claims about where the sheet came from', () => {
  it('does not claim a supplier document of the maker\'s was used', () => {
    const lines = sheetFor(freshMixture()).sections.flatMap((section) => section.lines ?? []);
    expect(lines.join(' ')).not.toMatch(/supplier documents on file/i);
  });

  it('names the reference data it actually used, and says none of theirs is held', () => {
    const lines = sheetFor(freshMixture()).sections.flatMap((section) => section.lines ?? []);
    const joined = lines.join(' ');
    expect(joined).toMatch(/Batchlabel's reference data/i);
    expect(joined).toMatch(/No supplier document of yours is held/i);
    // Still a draft until a competent person signs it — that part was true and stays.
    expect(joined).toMatch(/not issued until signed/i);
  });

  it('prints no revision line while nothing has been produced', () => {
    // artefactsFor gives every artefact "Not yet produced" and no print date, because there is
    // no artefacts table. Printing those onto the sheet is worse than an absent line.
    const lines = sheetFor(freshMixture()).sections.flatMap((section) => section.lines ?? []);
    const joined = lines.join(' ');
    expect(joined).not.toMatch(/Revision Not yet produced/i);
    expect(joined).not.toMatch(/issued —/i);
  });

  it('prints the revision line once there is a revision to print', () => {
    // The branch is kept rather than deleted: the day artefacts are stored, a sheet with a real
    // version and a real issue date must state them, and that is a regulatory requirement
    // rather than a nicety.
    const product = freshMixture();
    const withRevision: Product = {
      ...product,
      artefacts: product.artefacts.map((artefact) =>
      artefact.type === 'sds' ?
      { ...artefact, version: 'v2', printedOn: '2026-07-01' } :
      artefact
      )
    };
    const joined = sheetFor(withRevision).
    sections.
    flatMap((section) => section.lines ?? []).
    join(' ');
    expect(joined).toMatch(/Revision v2, issued 2026-07-01\./);
  });
});
