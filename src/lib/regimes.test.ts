import { describe, expect, it } from 'vitest';
import { Product } from './model';
import { PRODUCTS } from './fixtures';
import { categoryById } from './categories';
import { artefactsFor, blankSpec } from './products';
import {
  DERIVED_OBLIGATIONS,
  REGIMES,
  obligationOutcome,
  obligationSatisfied,
  obligationState,
  obligationsFor,
  outstandingObligations,
  untrackedObligations } from
'./regimes';

/**
 * The UFI claim.
 *
 * Nothing in Batchlabel generates a UFI. Telling a maker the CLP UFI obligation
 * is met is the most expensive lie the app can tell: they ship a label missing a
 * mandatory element and skip the poison centre notification keyed on it. So the
 * assertion is behavioural rather than textual — no route through the app may
 * report that obligation as done, whatever is stored against the product.
 *
 * The products under test come from lib/fixtures.ts now rather than from lib/products.ts,
 * which no longer holds any: it reads them from Supabase. The rule is unchanged and so is
 * the test, because the rule was never a property of where the data came from.
 */

/**
 * A product with evidence recorded against the named obligations.
 *
 * Was `obligations: Record<string, boolean>` over a jsonb column nothing wrote. The shape
 * changed, the assertion did not: no route through the app may report the UFI obligation as
 * done, whatever this account has recorded.
 */
function withObligations(overrides: Record<string, boolean>): Product {
  const obligations = { ...PRODUCTS[0].evidence.obligations };
  for (const [id, done] of Object.entries(overrides)) {
    if (done) {
      obligations[id] = {
        id: `ev-${id}`,
        recordedAt: '2026-07-01T00:00:00.000Z',
        reference: null,
        summary: 'Recorded in a test.'
      };
    } else {
      delete obligations[id];
    }
  }
  return { ...PRODUCTS[0], evidence: { ...PRODUCTS[0].evidence, obligations } };
}

describe('the UFI obligation', () => {
  it('is not satisfied even when a product claims it is', () => {
    expect(obligationSatisfied(withObligations({ 'clp-ufi': true }), 'clp-ufi')).toBe(false);
  });

  it('is shown on every product subject to CLP, as not tracked rather than outstanding', () => {
    // It used to be asserted as OUTSTANDING. That was right about the duty and wrong about
    // who established it: Batchlabel neither generates a UFI nor records one, so calling it
    // outstanding claims a finding about the maker's business that nothing checked. It is
    // still shown on every CLP product — the legal duty does not go away — but as a duty we
    // do not track, with copy that says so.
    const clpProducts = PRODUCTS.filter((product: Product) => product.regimes.includes('clp'));
    expect(clpProducts.length).toBeGreaterThan(0);
    for (const product of clpProducts) {
      expect(obligationState(product, 'clp-ufi')).toBe('not-tracked');
      expect(untrackedObligations(product).map((o) => o.id)).toContain('clp-ufi');
      // And emphatically not counted as work the maker owes.
      expect(outstandingObligations(product).map((o) => o.id)).not.toContain('clp-ufi');
    }
  });

  it('never renders as done, whatever a row claims', () => {
    // The property the original test was protecting, kept explicit: a stored `true` must not
    // turn into "a UFI is on file", because the next thing skipped is the poison centre
    // notification.
    expect(obligationSatisfied(withObligations({ 'clp-ufi': true }), 'clp-ufi')).toBe(false);
    expect(obligationState(withObligations({ 'clp-ufi': true }), 'clp-ufi')).toBe('not-tracked');
  });

  it('leaves no fixture product carrying a UFI', () => {
    for (const product of PRODUCTS) {
      expect(product.identifiers.ufi).toBeUndefined();
    }
  });

  /**
   * The old third case created a product and asserted the created one carried no UFI.
   * Creating a product is a database insert now, so what is asserted instead is the thing a
   * new product is actually built from: `blankSpec` holds nothing that could become a UFI,
   * and the UFI column it would come from is on the SPECIFICATION rather than here.
   */
  it('has nowhere to come from in a brand new composition', () => {
    const spec = blankSpec(categoryById('home-fragrance'), 'Container candle');
    expect(JSON.stringify(spec)).not.toContain('ufi');
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

/**
 * The outputs a real account's product carries.
 *
 * Nothing stores artefacts, so nothing may claim one was produced. This is the assertion
 * that stops a plausible-looking version string or print date creeping back in: a maker who
 * reads "v2 · 12 July" believes a label exists and was printed, and reprints from it.
 */
describe('artefacts derived for a stored product', () => {
  it('claims no version and no print date', () => {
    for (const category of ['home-fragrance', 'cosmetics', 'electronics'] as const) {
      const pack = categoryById(category);
      for (const artefact of artefactsFor(pack, pack.specKind)) {
        expect(artefact.version).toBe('Not yet produced');
        expect(artefact.printedOn).toBe('—');
        // NOT 'current'. `current: true` for an unproduced surface is what painted a green
        // "Current" pill on every row of a list whose every row also said "Not yet produced".
        expect(artefact.currency).toBe('not-produced');
        // Nothing was produced, so nothing was generated. Every row this app writes carries
        // this too — no exporter exists.
        expect(artefact.isPlaceholder).toBe(true);
      }
    }
  });

  it('gives a safety data sheet to a mixture and none to a device', () => {
    const fragrance = artefactsFor(categoryById('home-fragrance'), 'mixture');
    const device = artefactsFor(categoryById('electronics'), 'bom');
    expect(fragrance.some((a) => a.type === 'sds')).toBe(true);
    expect(device.some((a) => a.type === 'sds')).toBe(false);
  });
});

/* ------------------------------------------------------------------------ */

/**
 * A product with nothing recorded against it, built the way a real account's is.
 *
 * `blankSpec` plus `artefactsFor` with no rows behind it: a brand new product, before the
 * maker has chosen a base, printed anything or recorded a single thing. This is the state
 * every account is in on its first afternoon, and it is the state the fifteen invented
 * findings were being rendered in.
 */
function freshProduct(categoryId: 'home-fragrance' | 'cosmetics' | 'electronics'): Product {
  const category = categoryById(categoryId);
  const spec = blankSpec(category, category.productTypes[0]);
  return {
    id: `p-${categoryId}`,
    specificationId: `s-${categoryId}`,
    name: 'Untitled',
    sku: '',
    categoryId,
    markets: ['GB', 'EU'],
    regimes: category.regimes,
    spec,
    artefacts: artefactsFor(category, spec.kind),
    identifiers: {},
    evidence: { obligations: {}, sdsSections: {} }
  };
}

function withEvidence(product: Product, obligationId: string, at = '2026-07-01T00:00:00.000Z'): Product {
  return {
    ...product,
    evidence: {
      ...product.evidence,
      obligations: {
        ...product.evidence.obligations,
        [obligationId]: {
          id: `ev-${obligationId}`,
          recordedAt: at,
          reference: 'REF-1',
          summary: 'Recorded in a test.'
        }
      }
    }
  };
}

/**
 * THE STRUCTURAL GUARD, and the one assertion that would have caught the whole defect class.
 *
 * Fifteen obligations were permanently outstanding on every product of every account, because
 * the only thing that could satisfy them was a jsonb column nothing wrote. No individual test
 * failed: each obligation looked reasonable on its own, and the queue that rendered them was
 * correct about its own logic. What was missing was a check that every duty has SOME route out
 * of "outstanding".
 *
 * Three routes exist and there may not be a fourth: derived from the product, recorded by the
 * maker, or declared not-tracked with a sentence saying we are not the one checking. An
 * obligation in none of them is a row a maker can never clear, and this fails on the day one
 * is added.
 */
describe('every obligation, whatever regime it belongs to', () => {
  const all = REGIMES.flatMap((regime) => regime.obligations);

  it('has a route out of outstanding: derived, recordable, or honestly not tracked', () => {
    for (const obligation of all) {
      const notTracked = obligationState(freshProduct('home-fragrance'), obligation.id) === 'not-tracked' ||
      obligationState(freshProduct('cosmetics'), obligation.id) === 'not-tracked' ||
      obligationState(freshProduct('electronics'), obligation.id) === 'not-tracked';
      const routed =
      DERIVED_OBLIGATIONS.has(obligation.id) || obligation.recordable === true || notTracked;
      expect(
        routed,
        `${obligation.id} can never stop being outstanding: it is not derived, not recordable, and not declared untracked`
      ).toBe(true);
    }
  });

  it('turns met the moment evidence is recorded, for every recordable one', () => {
    const product = freshProduct('electronics');
    for (const obligation of all.filter((o) => o.recordable)) {
      expect(obligationState(product, obligation.id)).toBe('outstanding');
      expect(obligationState(withEvidence(product, obligation.id), obligation.id)).toBe('met');
    }
  });

  it('says when it happened, from the log rather than from the clock', () => {
    const product = withEvidence(freshProduct('cosmetics'), 'cpr-pif', '2026-03-04T00:00:00.000Z');
    const obligation = all.find((o) => o.id === 'cpr-pif');
    if (!obligation) throw new Error('cpr-pif is no longer an obligation');
    const outcome = obligationOutcome(product, obligation);

    expect(outcome.state).toBe('met');
    expect(outcome.text).toContain('4 Mar 2026');
    expect(outcome.evidence?.reference).toBe('REF-1');
  });

  it('never falls back to a finding when it has not checked', () => {
    // `not-tracked` exists precisely so nothing asserts a state it did not observe. An
    // obligation reaching that state and then printing its missingText would put the assertion
    // straight back, which is why obligationOutcome refuses to borrow it.
    const product = freshProduct('home-fragrance');
    for (const obligation of obligationsFor(product)) {
      const outcome = obligationOutcome(product, obligation);
      if (outcome.state !== 'not-tracked') continue;
      expect(outcome.text).not.toBe(obligation.missingText);
      expect(outcome.text.length).toBeGreaterThan(0);
    }
  });
});

/**
 * The period after opening, which was the clearest self-contradiction on the screen.
 *
 * `derivePhased` emitted a Period after opening group unconditionally and the label preview
 * rendered "12M" at actual size, from a constant `blankSpec` seeded — while this obligation,
 * on the same screen, read "Neither a period after opening nor a date of minimum durability is
 * shown". Both halves read `spec.paoMonths` now.
 */
describe('the period after opening obligation', () => {
  it('is outstanding when nothing is set, and met when a figure is', () => {
    const cosmetic = freshProduct('cosmetics');
    expect(cosmetic.spec.kind).toBe('phased');
    expect(obligationState(cosmetic, 'cpr-pao')).toBe('outstanding');

    const withPao: Product =
    cosmetic.spec.kind === 'phased' ?
    { ...cosmetic, spec: { ...cosmetic.spec, paoMonths: 6 } } :
    cosmetic;
    expect(obligationState(withPao, 'cpr-pao')).toBe('met');
  });

  it('cannot be satisfied by recording evidence over the top of the composition', () => {
    // It is a property of what the label carries, not of what the maker says. Letting an
    // entry in the log flip it would put back the exact claim this work removed.
    const cosmetic = freshProduct('cosmetics');
    expect(obligationState(withEvidence(cosmetic, 'cpr-pao'), 'cpr-pao')).toBe('outstanding');
  });
});

/**
 * Whether the label on the jar still matches the recipe on file.
 *
 * The only obligation that LEFT the not-tracked set, because `batchlabel.artefacts` now stores
 * the composition fingerprint at the moment a print was recorded. Three states, and the one
 * that matters is the third: a maker who has never recorded a print must not be told their
 * label has drifted.
 */
describe('the label currency obligation', () => {
  const category = categoryById('home-fragrance');

  const withLabel = (currency: 'current' | 'out-of-date' | 'unknown'): Product => {
    const product = freshProduct('home-fragrance');
    return {
      ...product,
      artefacts: product.artefacts.map((artefact) =>
      artefact.type === 'unit-label' ?
      { ...artefact, version: 'v1', printedOn: '2026-07-01', currency } :
      artefact
      )
    };
  };

  it('is not a finding when no print has ever been recorded', () => {
    const product = freshProduct('home-fragrance');
    expect(product.artefacts.every((a) => a.currency === 'not-produced')).toBe(true);
    expect(obligationState(product, 'clp-artefact-current')).toBe('not-tracked');
    expect(outstandingObligations(product).map((o) => o.id)).not.toContain('clp-artefact-current');
  });

  it('is met when the recorded print still matches, and outstanding when it does not', () => {
    expect(obligationState(withLabel('current'), 'clp-artefact-current')).toBe('met');
    expect(obligationState(withLabel('out-of-date'), 'clp-artefact-current')).toBe('outstanding');
  });

  it('refuses to answer when the fingerprint could not be computed', () => {
    // 'unknown' is a failure to check. Reading it as either answer is how a maker gets told
    // their label is fine by a screen that did not manage to look.
    expect(obligationState(withLabel('unknown'), 'clp-artefact-current')).toBe('not-tracked');
    expect(category.artefacts).toContain('unit-label');
  });
});
