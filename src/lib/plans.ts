/**
 * The plan catalogue, fetched from the marketing origin at runtime.
 *
 * THIS REPO HOLDS NO PRICE AND NO ALLOWANCE. Not a constant, not a fallback, not a "sensible
 * default" for when the request fails. `GET /api/plans` on www is generated from
 * `src/server/plan-contract.ts`, which is the single source of truth for what a tier costs
 * and what it includes; a copy of any of those numbers in this repo would be a second place
 * for them to live and a stale literal sitting next to a live Stripe price is precisely the
 * defect the whole billing rail was rebuilt to remove.
 *
 * The consequence has to be accepted honestly rather than papered over: when the request
 * fails there is nothing to show. The billing page says the prices could not be loaded and
 * offers a retry. It does not guess, and it does not fall back to the last thing anybody
 * remembered — which is how a customer gets charged £35 for something a page said was £24.
 *
 * WHAT THE PAYLOAD DELIBERATELY DOES NOT CONTAIN, and so neither does this module:
 *   * no Stripe price ids — checkout sends a `tier` and the server resolves the id from
 *     server-only env, so the one value that decides what somebody is charged never enters
 *     a browser;
 *   * no `rail_test` — filtered out server-side on `publiclyListed`, so the £0.30 payment
 *     rail item cannot appear on a price list;
 *   * no unlimited sentinel — the unlimited tier arrives as `skuLimit: null` with
 *     `skuUnlimited: true`, which is why "2,147,483,647 SKUs" is not renderable here.
 *
 * Amounts are integer pence, GBP, EXCLUSIVE of VAT. Every surface that prints one must say
 * "exc VAT" — see `formatPence`'s callers. Stripe adds the customer's VAT at checkout from
 * their location and their VAT number, so the number on this page never changes by country.
 */

import { MARKETING_URL } from './marketing';

export interface PublicPlan {
  slug: string;
  displayName: string;
  /** Integer pence, exclusive of VAT. Null where the tier has no price of that interval. */
  monthlyPence: number | null;
  annualPence: number | null;
  /** Null when `skuUnlimited` is true, and null when the field was unreadable. */
  skuLimit: number | null;
  skuUnlimited: boolean;
  editorSeatLimit: number | null;
  /** False for `free`, which is the absence of a subscription and has nothing to check out. */
  purchasable: boolean;
}

export interface PlanCatalogue {
  /** Lower-case ISO currency, one for the whole catalogue so no two tiers can differ. */
  currency: string;
  /** 'exclusive' — the reason every price on screen is followed by "exc VAT". */
  taxBehaviour: string;
  plans: PublicPlan[];
}

export type BillingInterval = 'monthly' | 'annual';

export const PLANS_ENDPOINT = `${MARKETING_URL}/api/plans`;

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function pence(value: unknown): number | null {
  // Integers only. A float has no meaning in a pence field and a rounded one would be a
  // price we invented.
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
}

/**
 * One catalogue entry, tolerantly read.
 *
 * Returns null for an entry with no slug or no display name, because an unnameable tier
 * cannot be rendered or bought. Everything else degrades to null and the card says what it
 * does not know — a missing allowance must never render as "0 SKUs".
 */
export function readPlan(raw: unknown): PublicPlan | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  const slug = text(row.slug);
  const displayName = text(row.displayName);
  if (!slug || !displayName) return null;
  return {
    slug: slug.toLowerCase(),
    displayName,
    monthlyPence: pence(row.monthlyPence),
    annualPence: pence(row.annualPence),
    skuLimit: pence(row.skuLimit),
    skuUnlimited: row.skuUnlimited === true,
    editorSeatLimit: pence(row.editorSeatLimit),
    purchasable: row.purchasable === true
  };
}

/**
 * The whole payload, tolerantly read. Throws when there is nothing usable in it, so the
 * caller shows the "prices could not be loaded" state rather than an empty price list — an
 * empty list looks like "no plans are for sale", which is a different and worse lie.
 */
export function readCatalogue(raw: unknown): PlanCatalogue {
  const body = (raw ?? {}) as Record<string, unknown>;
  const plans = Array.isArray(body.plans) ?
  body.plans.map(readPlan).filter((plan): plan is PublicPlan => plan !== null) :
  [];
  if (plans.length === 0) throw new Error('plan catalogue is empty');
  const currency = text(body.currency);
  const taxBehaviour = text(body.taxBehaviour);
  // Both are top-level constants of the catalogue on the server precisely so no client can
  // render one tier in a different currency or tax basis from another. If either is missing
  // we cannot label the price truthfully, and an unlabelled price is not shippable.
  if (!currency || !taxBehaviour) throw new Error('plan catalogue is missing currency or tax behaviour');
  return { currency, taxBehaviour, plans };
}

/**
 * GET /api/plans. Unauthenticated and cacheable — it is the same projection already printed
 * on the public pricing page, so no token is sent and an expired session cannot stop a
 * customer seeing what they would be paying.
 */
export async function fetchPlanCatalogue(signal?: AbortSignal): Promise<PlanCatalogue> {
  const response = await fetch(PLANS_ENDPOINT, { method: 'GET', signal });
  if (!response.ok) throw new Error(`plan catalogue request failed (${response.status})`);
  return readCatalogue(await response.json());
}

/* ------------------------------------------------------------------ selection */

export function planBySlug(catalogue: PlanCatalogue | null, slug: string | null): PublicPlan | null {
  if (!catalogue || !slug) return null;
  return catalogue.plans.find((plan) => plan.slug === slug.toLowerCase()) ?? null;
}

export function priceFor(plan: PublicPlan, interval: BillingInterval): number | null {
  return interval === 'annual' ? plan.annualPence : plan.monthlyPence;
}

/** A tier can be bought at an interval only when the server actually sells that pairing. */
export function isPurchasableAt(plan: PublicPlan, interval: BillingInterval): boolean {
  return plan.purchasable && priceFor(plan, interval) !== null;
}

/**
 * How many months of the year an annual price is free, DERIVED from the two prices rather
 * than asserted.
 *
 * "Two months free" is only true while annual is exactly ten times monthly. That relation is
 * an invariant of the plan contract today and it is still not this repo's to promise: if the
 * numbers ever stop dividing cleanly this returns null and the saving is simply not
 * mentioned, instead of a claim that quietly stops being true.
 */
export function monthsFreeOnAnnual(plan: PublicPlan): number | null {
  const { monthlyPence, annualPence } = plan;
  if (monthlyPence === null || annualPence === null || monthlyPence <= 0) return null;
  if (annualPence % monthlyPence !== 0) return null;
  const monthsCharged = annualPence / monthlyPence;
  const free = 12 - monthsCharged;
  return free > 0 && Number.isInteger(free) ? free : null;
}

/* ---------------------------------------------------------------- formatting */

/**
 * Integer pence to a printable amount.
 *
 * Whole pounds print without a decimal (£14, not £14.00) because every advertised price in
 * the contract is a whole number of pounds and the trailing zeros only add noise; anything
 * with pence in it prints both digits so a £0.30 amount cannot round to £0.
 *
 * The currency comes from the payload, never from a constant here. Callers must print the
 * tax basis alongside — see `TAX_NOTE`.
 */
export function formatPence(amountPence: number, currency: string): string {
  const whole = amountPence % 100 === 0;
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: currency.toUpperCase(),
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: whole ? 0 : 2
  }).format(amountPence / 100);
}

/**
 * The three words that must accompany every price on every surface.
 *
 * Prices are stored and displayed EXCLUSIVE of VAT, which is the correct B2B convention —
 * but it has to be stated rather than implied, or a maker budgets £14 and is charged £16.80.
 */
export const TAX_NOTE = 'exc VAT';

export function intervalNoun(interval: BillingInterval): string {
  return interval === 'annual' ? 'a year' : 'a month';
}

/** The allowance line for a catalogue card. Never renders a number it was not given. */
export function planAllowanceLabel(plan: PublicPlan): string {
  if (plan.skuUnlimited) return 'Unlimited SKUs';
  if (plan.skuLimit === null) return 'SKU allowance unavailable';
  return `${plan.skuLimit.toLocaleString('en-GB')} SKUs`;
}
