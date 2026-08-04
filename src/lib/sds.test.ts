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
    evidence: { obligations: {}, sdsSections: {} }
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

  /**
   * THE ATTRIBUTION MOVED, BECAUSE THE DATA MOVED.
   *
   * This asserted that the sheet credited "Batchlabel's reference data", which was the honest
   * sentence while every classification came from a catalogue shipped in the bundle. That
   * catalogue is deleted: the figures now come from the maker's OWN materials register, and
   * crediting them to us on the one document a regulator reads would understate whose figures
   * they are — the mirror image of the fault this test was written to catch.
   *
   * What has not changed, and is still asserted, is the second half: no supplier document of
   * theirs is held, because there is still nowhere to upload one.
   */
  it('credits the maker\'s own register, and still says no document of theirs is held', () => {
    const lines = sheetFor(freshMixture()).sections.flatMap((section) => section.lines ?? []);
    const joined = lines.join(' ');
    expect(joined).toMatch(/your own register/i);
    expect(joined).toMatch(/holds no copy of any supplier document/i);
    // And it does not credit a shipped library that no longer exists.
    expect(joined).not.toMatch(/Batchlabel's reference data/i);
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
    // The date is FORMATTED, not echoed. `printedOn` comes off a timestamptz column, so an
    // unformatted line printed "issued 2026-07-01T09:00:00.000Z." in the one section of a
    // safety data sheet a person reads for provenance.
    expect(joined).toMatch(/Revision v2, issued 1 Jul 2026\./);
  });
});
