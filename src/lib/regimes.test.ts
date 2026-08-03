import { describe, expect, it } from 'vitest';
import { Product } from './model';
import { PRODUCTS } from './fixtures';
import { categoryById } from './categories';
import { artefactsFor, blankSpec } from './products';
import { obligationSatisfied, outstandingObligations,
  obligationState,
  untrackedObligations} from './regimes';

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

function withObligations(overrides: Record<string, boolean>): Product {
  return { ...PRODUCTS[0], obligations: { ...PRODUCTS[0].obligations, ...overrides } };
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
        expect(artefact.current).toBe(true);
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
