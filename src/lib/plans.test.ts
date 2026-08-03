import { describe, expect, it } from 'vitest';
import {
  formatPence,
  isPurchasableAt,
  monthsFreeOnAnnual,
  planAllowanceLabel,
  planBySlug,
  priceFor,
  readCatalogue,
  readPlan,
  type PublicPlan } from
'./plans';

/**
 * The catalogue this app renders and the rules for refusing to render it.
 *
 * The single property worth protecting: this repo holds no price and no allowance, so every
 * one of these tests works from a payload rather than from a constant, and the failure cases
 * all assert that a MISSING number produces an admission rather than an invented one. A
 * plausible number on a billing page is worse than a blank, because the customer is about to
 * be charged the real one.
 */

function plan(overrides: Partial<PublicPlan> = {}): PublicPlan {
  return {
    slug: 'maker',
    displayName: 'Maker',
    monthlyPence: 1400,
    annualPence: 14000,
    skuLimit: 45,
    skuUnlimited: false,
    editorSeatLimit: 1,
    purchasable: true,
    ...overrides
  };
}

describe('reading one catalogue entry', () => {
  it('reads a well-formed entry', () => {
    expect(
      readPlan({
        slug: 'studio',
        displayName: 'Studio',
        monthlyPence: 3500,
        annualPence: 35000,
        skuLimit: 180,
        skuUnlimited: false,
        editorSeatLimit: 3,
        purchasable: true
      })
    ).toEqual({
      slug: 'studio',
      displayName: 'Studio',
      monthlyPence: 3500,
      annualPence: 35000,
      skuLimit: 180,
      skuUnlimited: false,
      editorSeatLimit: 3,
      purchasable: true
    });
  });

  it('drops an entry that cannot be named', () => {
    // A tier with no slug cannot be bought and a tier with no display name cannot be shown.
    expect(readPlan({ displayName: 'Mystery', monthlyPence: 1400 })).toBeNull();
    expect(readPlan({ slug: 'mystery', monthlyPence: 1400 })).toBeNull();
  });

  it.each([[null], [undefined], ['maker'], [42], [[]]])('tolerates %s', (raw) => {
    expect(readPlan(raw)).toBeNull();
  });

  it('refuses a price that is not whole pence', () => {
    // A float in a pence field has no meaning, and rounding one would be this app inventing
    // a price. Absent renders as "not sold at that interval", which is at least true.
    expect(readPlan(plan({ monthlyPence: 14.5 as unknown as number }))?.monthlyPence).toBeNull();
    expect(readPlan({ ...plan(), monthlyPence: '1400' })?.monthlyPence).toBeNull();
  });

  it('reads the unlimited tier as unlimited with no number attached', () => {
    const consultant = readPlan({
      slug: 'consultant',
      displayName: 'Consultant',
      monthlyPence: 19900,
      annualPence: 199000,
      skuLimit: null,
      skuUnlimited: true,
      editorSeatLimit: 10,
      purchasable: true
    });
    expect(consultant?.skuUnlimited).toBe(true);
    expect(consultant?.skuLimit).toBeNull();
  });

  it('treats a missing purchasable flag as not purchasable', () => {
    // Fail closed on the field that decides whether a checkout button exists.
    expect(readPlan({ slug: 'free', displayName: 'Free' })?.purchasable).toBe(false);
  });
});

describe('reading the whole catalogue', () => {
  it('reads a payload', () => {
    const catalogue = readCatalogue({
      currency: 'gbp',
      taxBehaviour: 'exclusive',
      plans: [plan(), plan({ slug: 'free', displayName: 'Free', monthlyPence: null, annualPence: null, purchasable: false })]
    });
    expect(catalogue.currency).toBe('gbp');
    expect(catalogue.taxBehaviour).toBe('exclusive');
    expect(catalogue.plans).toHaveLength(2);
  });

  it('throws rather than returning an empty price list', () => {
    // An empty list renders as "nothing is for sale", which is a different and worse untruth
    // than "we could not load the prices". The caller has a failure state; give it one.
    expect(() => readCatalogue({ currency: 'gbp', taxBehaviour: 'exclusive', plans: [] })).toThrow();
    expect(() => readCatalogue({})).toThrow();
    expect(() => readCatalogue(null)).toThrow();
  });

  it('throws when it cannot label the price truthfully', () => {
    // Currency and tax basis are top-level so no two tiers can differ. Without either, every
    // price on the page would be an unlabelled number, and an unlabelled number is a £16.80
    // surprise on a £14 expectation.
    expect(() => readCatalogue({ taxBehaviour: 'exclusive', plans: [plan()] })).toThrow();
    expect(() => readCatalogue({ currency: 'gbp', plans: [plan()] })).toThrow();
  });

  it('keeps the good entries and drops the unreadable ones', () => {
    const catalogue = readCatalogue({
      currency: 'gbp',
      taxBehaviour: 'exclusive',
      plans: [plan(), { displayName: 'nameless' }, null]
    });
    expect(catalogue.plans.map((entry) => entry.slug)).toEqual(['maker']);
  });
});

describe('what may be bought', () => {
  it('never offers a checkout for free', () => {
    // Free is the ABSENCE of a subscription: there is no Stripe price behind it, so a button
    // would 400 at best and create a £0 subscription at worst.
    const free = plan({ slug: 'free', displayName: 'Free', monthlyPence: null, annualPence: null, purchasable: false });
    expect(isPurchasableAt(free, 'annual')).toBe(false);
    expect(isPurchasableAt(free, 'monthly')).toBe(false);
  });

  it('never offers an interval the server does not sell', () => {
    const monthlyOnly = plan({ annualPence: null });
    expect(isPurchasableAt(monthlyOnly, 'monthly')).toBe(true);
    expect(isPurchasableAt(monthlyOnly, 'annual')).toBe(false);
  });

  it('picks the price for the interval', () => {
    expect(priceFor(plan(), 'annual')).toBe(14000);
    expect(priceFor(plan(), 'monthly')).toBe(1400);
  });
});

describe('the annual saving, derived rather than asserted', () => {
  it('reports two months free while annual is ten times monthly', () => {
    expect(monthsFreeOnAnnual(plan({ monthlyPence: 1400, annualPence: 14000 }))).toBe(2);
    expect(monthsFreeOnAnnual(plan({ monthlyPence: 19900, annualPence: 199000 }))).toBe(2);
  });

  it('says nothing when the numbers stop dividing cleanly', () => {
    // "Two months free" is only true while the relation holds. If it ever changes, the claim
    // disappears rather than quietly becoming false.
    expect(monthsFreeOnAnnual(plan({ monthlyPence: 1400, annualPence: 15000 }))).toBeNull();
  });

  it('says nothing when there is no saving', () => {
    expect(monthsFreeOnAnnual(plan({ monthlyPence: 1400, annualPence: 16800 }))).toBeNull();
  });

  it('says nothing when either price is missing', () => {
    expect(monthsFreeOnAnnual(plan({ annualPence: null }))).toBeNull();
    expect(monthsFreeOnAnnual(plan({ monthlyPence: null }))).toBeNull();
  });
});

describe('printing a price', () => {
  it('prints whole pounds without decimals', () => {
    expect(formatPence(1400, 'gbp')).toBe('£14');
    expect(formatPence(199000, 'gbp')).toBe('£1,990');
  });

  it('prints pence when there are any', () => {
    // The £0.30 payment-rail item is never on this catalogue, but a price that rounded to £0
    // would be the worst possible rounding bug to ship, so both digits stay.
    expect(formatPence(30, 'gbp')).toBe('£0.30');
  });

  it('uses the currency from the payload rather than a constant', () => {
    expect(formatPence(1400, 'GBP')).toBe('£14');
  });
});

describe('presenting an allowance', () => {
  it('states a finite allowance', () => {
    expect(planAllowanceLabel(plan({ skuLimit: 180 }))).toBe('180 SKUs');
  });

  it('states unlimited without a number', () => {
    expect(planAllowanceLabel(plan({ skuLimit: null, skuUnlimited: true }))).toBe('Unlimited SKUs');
  });

  it('admits when it does not know', () => {
    expect(planAllowanceLabel(plan({ skuLimit: null, skuUnlimited: false }))).toBe(
      'SKU allowance unavailable'
    );
  });
});

describe('finding the plan somebody holds', () => {
  const catalogue = readCatalogue({
    currency: 'gbp',
    taxBehaviour: 'exclusive',
    plans: [plan(), plan({ slug: 'studio', displayName: 'Studio' })]
  });

  it('matches on the slug, ignoring case', () => {
    expect(planBySlug(catalogue, 'Studio')?.displayName).toBe('Studio');
  });

  it('returns null for a tier the catalogue does not list', () => {
    // A comped or grandfathered account can hold a slug no public catalogue describes. The
    // screen falls back to the entitlement's own values rather than showing nothing.
    expect(planBySlug(catalogue, 'legacy_house')).toBeNull();
    expect(planBySlug(null, 'maker')).toBeNull();
    expect(planBySlug(catalogue, null)).toBeNull();
  });
});
