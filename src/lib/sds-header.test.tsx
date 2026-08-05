import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { categoryById } from './categories';
import { derive } from './derive';
import { Product } from './model';
import { buildSds } from './sds';
import { artefactsFor, blankSpec } from './products';
import { SdsDocument } from '../components/artefact/SdsDocument';

/**
 * THE TOP-RIGHT CORNER OF EVERY PAGE OF A SAFETY DATA SHEET.
 *
 * `buildSds` used to end `version: sdsArtefact?.version ?? 'v1'` with `revisionDate` defaulting
 * to an em dash, and components/artefact/SdsDocument.tsx prints both on every page of a
 * sixteen-section A4 document a maker may hand to a customer or a regulator. So a caller that
 * did not happen to guard on an sds artefact existing printed a VERSION NUMBER NOTHING
 * PRODUCED on a regulated document.
 *
 * It was unreachable: all three callers guarded. That is not what made it worth closing. What
 * made it worth closing is that `revisionLine`, thirty lines earlier IN THE SAME FUNCTION,
 * guards this exact case explicitly and at length on the grounds that a revision history is a
 * regulatory claim — and the header did not. One expression guarded and its neighbour not is a
 * fourth call site away from being real, and a fourth guard at that call site would have been
 * the fifth place this rule is written down.
 *
 * So the model type holds `string | null` now. The fourth caller is a compile error rather than
 * a document, which is the only version of this that cannot be got wrong again by being
 * forgotten.
 *
 * WHAT WOULD MAKE THIS FILE RED, AND SHOULD. `version` or `revisionDate` going back to a
 * non-nullable string with a default. The header printing a produced sheet's raw `printedOn` —
 * it is a timestamptz off the row, and it printed as `2026-07-01T09:00:00.000Z` in the one
 * corner of the document a person reads for provenance.
 */

function mixture(artefacts: Product['artefacts']): Product {
  const category = categoryById('home-fragrance');
  const spec = blankSpec('Container candle', 'ing-bfc');
  return {
    id: 'prod-1',
    specificationId: 'spec-1',
    name: 'First product',
    sku: 'FP-001',
    categoryId: 'home-fragrance',
    markets: ['GB'],
    regimes: category.regimes,
    spec: { ...spec, kind: 'mixture', load: 8 } as Product['spec'],
    artefacts,
    identifiers: {},
    evidence: { obligations: {}, sdsSections: {} }
  };
}

function sheetFor(product: Product) {
  return buildSds(product, derive(product.spec, product, 'GB'), 'GB');
}

const ALL = artefactsFor(categoryById('home-fragrance'));

describe('the version and revision date in the header', () => {
  it('is nothing at all for a caller with no sds artefact to guard on', () => {
    // The fourth caller, written out. This is what used to print `v1 · —`.
    const sheet = sheetFor(mixture(ALL.filter((artefact) => artefact.type !== 'sds')));
    expect(sheet.version).toBeNull();
    expect(sheet.revisionDate).toBeNull();
  });

  it('is nothing at all while the sheet has not been produced', () => {
    // `artefactsFor` gives every unproduced surface the words "Not yet produced" and no print
    // date. Those belong in a workspace panel; on the face of the document they are a revision
    // history that reads as one.
    const sheet = sheetFor(mixture(ALL));
    expect(sheet.version).toBeNull();
    expect(sheet.revisionDate).toBeNull();
  });

  it('states a real one, formatted, once a sheet has actually been produced', () => {
    const produced = ALL.map((artefact) =>
    artefact.type === 'sds' ?
    {
      ...artefact,
      version: 'v3',
      printedOn: '2026-07-01T09:00:00.000Z',
      currency: 'current' as const,
      isPlaceholder: false
    } :
    artefact
    );
    const sheet = sheetFor(mixture(produced));

    expect(sheet.version).toBe('v3');
    // A date a person reads, not the timestamptz off the row — the same treatment the revision
    // line in section 16 already gave it, and the header did not.
    expect(sheet.revisionDate).not.toContain('T09:00:00');
    expect(sheet.revisionDate).toMatch(/2026/);
  });
});

describe('what the rendered document actually shows', () => {
  it('prints no version and no revision date on an unproduced sheet', () => {
    render(<SdsDocument model={sheetFor(mixture(ALL))} />);
    const page = screen.getAllByText(/REACH Annex II/)[0].closest('div')?.parentElement;
    expect(page?.textContent).not.toMatch(/\bv1\b/);
    expect(page?.textContent).toMatch(/Draft · not issued/);
  });

  it('prints the real one once there is one', () => {
    const produced = ALL.map((artefact) =>
    artefact.type === 'sds' ?
    {
      ...artefact,
      version: 'v3',
      printedOn: '2026-07-01T09:00:00.000Z',
      currency: 'current' as const,
      isPlaceholder: false
    } :
    artefact
    );
    render(<SdsDocument model={sheetFor(mixture(produced))} />);
    const page = screen.getAllByText(/REACH Annex II/)[0].closest('div')?.parentElement;
    expect(page?.textContent).toMatch(/v3/);
    expect(page?.textContent).not.toMatch(/Draft · not issued/);
  });
});
