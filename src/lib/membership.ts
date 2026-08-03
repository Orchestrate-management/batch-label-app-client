/**
 * Reading the signed-in maker's entitlement.
 *
 * WHERE IT COMES FROM, AND WHY IT MOVED
 *
 * This used to query `public.brand_memberships` directly and then decide, in this file,
 * whether the row entitled anybody. It disagreed with the database in three ways: `unpaid`
 * entitled here and not there, a paid plan with a null Stripe status entitled here and not
 * there, and `current_period_end` was never even selected, so an expired period never
 * revoked anything. Three ways to show "active" on this screen and a paywall on the next.
 *
 * It now reads `public.entitlements`, the view the marketing repo publishes as the contract
 * (docs/ENTITLEMENTS.md over there, "use `active`, do not reimplement it"). That view calls
 * `public.entitlement_is_active(membership_status, plan, plan_status, current_period_end)`,
 * which is the ONE definition of "currently entitled" in the whole system.
 *
 * So: THE DATABASE DECIDES. This module only labels the answer. `active` is copied out of
 * the column and is never recomputed, never widened, never narrowed. Every rule that used
 * to live here — LIVE_STATUSES, GRACE_STATUSES, ENDED_STATUSES, the "paid plan with no
 * status is a comped account" special case — is deleted rather than moved, because a second
 * copy anywhere is how the two sides drift again.
 *
 * What is still decided here is WORDING: which of seven sentences to show somebody. That is
 * presentation, it changes no permission, and `status` is deliberately never consulted by a
 * gate. Gates read `active`.
 *
 * WHETHER versus HOW MUCH. `active` answers "may they use the product". `sku_limit` and
 * `editor_seat_limit` answer "how many things may they have". The migration that added them
 * keeps the two apart on purpose and so does this file: an account over its SKU allowance is
 * `active = true` AND at its limit, which is two facts, not one.
 *
 * THE ALLOWANCE IS NOW ENFORCED, which is a change from what this comment used to say. The
 * account data schema ships a trigger on public.products that counts live rows for the
 * ACCOUNT and refuses one too many — on INSERT and on un-archiving, and on nothing else. So
 * everything already created stays editable, printable and exportable at any tier, and this
 * file may now say what happens at the limit, because something happens. `sku_count` and
 * `can_modify` arrive on the view from the same migration, computed by the same function the
 * trigger calls, so the number the app shows and the insert the database refuses cannot
 * disagree.
 *
 * THIS CLIENT NEVER WRITES. RLS grants SELECT on your own row and grants nobody INSERT or
 * UPDATE; every write is server-side, from the marketing site's Stripe webhook under the
 * service role. There is no write path in this module and none should be added — a browser
 * that can write its own `plan` is a browser that can award itself a subscription.
 */

import { supabase } from './supabase';
import { BRAND_SLUG } from './brand';

/**
 * - `active`         entitled, in good standing.
 * - `past_due`       entitled, but the last payment failed and Stripe is retrying.
 * - `lapsed`         held a paid plan, the database no longer entitles it. Free's abilities.
 * - `free`           no paid plan.
 * - `no_membership`  signed in but no row for this brand yet — mid-signup.
 * - `suspended`      the membership itself is suspended or left, whatever the plan says.
 * - `unknown`        we could not read it. Never presented as "you have not paid".
 *
 * `cancelled` is gone and `lapsed` replaces it, because the word had to stop implying a
 * penalty. Ruling R9: a lapsed account is a Free account, with Free's allowance and Free's
 * abilities. Nothing about having once paid may leave somebody worse off than a new signup.
 */
export type EntitlementStatus =
'active' |
'past_due' |
'lapsed' |
'free' |
'no_membership' |
'suspended' |
'unknown';

/**
 * One row of `public.entitlements`, tolerantly read.
 *
 * Every field is nullable because absent must be distinguishable from false. The view gains
 * columns over time (`can_modify` and `sku_count` are both named in the migration as coming
 * later, with the enforcement trigger) and a column this app has never heard of must read as
 * "we do not know", never as zero and never as a denial.
 */
export interface EntitlementRow {
  brand: string | null;
  /**
   * THE ACCOUNT KEY, and not a user id. The view aliased `m.user_id as account_id` until the
   * account data schema landed; it now resolves to `accounts.id` for this membership's brand.
   * Null means we could not resolve one, never "use auth.uid() instead".
   */
  accountId: string | null;
  /** The account lifecycle: active | suspended | left. About us, not about Stripe. */
  membershipStatus: string | null;
  businessName: string | null;
  plan: string | null;
  /** Mirrors the Stripe subscription status. Null when no subscription exists. */
  planStatus: string | null;
  /** THE ANSWER, computed by entitlement_is_active(). Null only when the column is absent. */
  active: boolean | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean | null;
  trialEnd: string | null;
  /** How many live SKUs this membership may hold. Null when unreadable. */
  skuLimit: number | null;
  /**
   * How many live SKUs the account is holding, counted by the database over
   * `products where archived_at is null` — the same definition the enforcement trigger uses.
   * Null is UNKNOWN and never zero: the view is built so that a membership with no account
   * yields null rather than a count of nought, because zero is a claim.
   */
  skuCount: number | null;
  /** The view's own answer, so the 2147483647 sentinel never reaches a browser. */
  skuUnlimited: boolean | null;
  editorSeatLimit: number | null;
  /**
   * Computed by the same function the enforcement trigger calls. Absent reads as null, and
   * null MUST fail open — see `mayModify`. A column that is not there must never become a
   * lockout.
   */
  canModify: boolean | null;
}

export interface Entitlement {
  status: EntitlementStatus;
  /** Copied from the view's `active` column. Never recomputed here. */
  active: boolean;
  /**
   * The account this deployment's brand resolves to for the signed-in user, or null when we
   * could not resolve one. `fetchEntitlement` filters on BRAND_SLUG, so this is the account
   * for THIS brand — which is the whole reason it can be handed to a write: the migration
   * header says "Prefer passing entitlements.account_id explicitly", and the INSERT policy
   * (`with check (is_member_of(account_id))`) refuses one that is not yours.
   */
  accountId: string | null;
  /** Lower-cased plan slug, or null when there is no membership / no read. */
  plan: string | null;
  planStatus: string | null;
  businessName: string | null;
  /**
   * The SKU allowance. Null means UNKNOWN — read `skuUnlimited` to tell unknown apart from
   * unlimited. Displayed only: nothing in this app enforces it.
   */
  skuLimit: number | null;
  skuUnlimited: boolean;
  /**
   * Live SKUs the DATABASE counted for this account. Null is unknown, never zero.
   *
   * This is the number a screen should show beside the allowance, in preference to the length
   * of any list this client assembled: the products read drops a product whose specification
   * did not come back, and the meter counts products whatever their specification, so the two
   * can differ by exactly the amount that turns "2 of 3" into a refused insert.
   */
  skuCount: number | null;
  editorSeatLimit: number | null;
  /** Null = we could not read it. Read it through `mayModify`, never directly. */
  canModify: boolean | null;
  /** ISO timestamp. When the paid period ends, or when a cancellation takes effect. */
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  trialEnd: string | null;
}

/** What we hold before the first read resolves, and after one that failed. */
const UNREADABLE: Entitlement = {
  status: 'unknown',
  active: false,
  accountId: null,
  plan: null,
  planStatus: null,
  businessName: null,
  skuLimit: null,
  skuUnlimited: false,
  skuCount: null,
  editorSeatLimit: null,
  canModify: null,
  currentPeriodEnd: null,
  cancelAtPeriodEnd: false,
  trialEnd: null
};

export const UNRESOLVED_ENTITLEMENT: Entitlement = UNREADABLE;

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function bool(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function count(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * Normalises a column before comparing it. Trims as well as lower-cases: `readEntitlementRow`
 * already trims what it reads, but `mapEntitlement` is a public pure function and must not
 * depend on having been fed by it.
 */
function key(value: string | null): string {
  return (value ?? '').trim().toLowerCase();
}

/** Tolerant reader: anything unexpected becomes null rather than throwing. */
export function readEntitlementRow(raw: unknown): EntitlementRow {
  const row = (raw ?? {}) as Record<string, unknown>;
  return {
    brand: text(row.brand),
    accountId: text(row.account_id),
    membershipStatus: text(row.membership_status),
    businessName: text(row.business_name),
    plan: text(row.plan),
    planStatus: text(row.status),
    active: bool(row.active),
    currentPeriodEnd: text(row.current_period_end),
    cancelAtPeriodEnd: bool(row.cancel_at_period_end),
    trialEnd: text(row.trial_end),
    skuLimit: count(row.sku_limit),
    skuCount: count(row.sku_count),
    skuUnlimited: bool(row.sku_unlimited),
    editorSeatLimit: count(row.editor_seat_limit),
    canModify: bool(row.can_modify)
  };
}

/**
 * The allowance, as the UI may state it.
 *
 * Deliberately refuses to produce a number unless the view told us whether the tier is
 * unlimited. `sku_limit` on the unlimited tier is int4 max, and the whole point of the
 * `sku_unlimited` column is that no client ever holds that integer — so without the boolean
 * we cannot know whether 2147483647 is an allowance or a sentinel, and "we do not know" is
 * the only honest answer. This is why the sentinel appears nowhere in this repo.
 */
function readAllowance(row: EntitlementRow): {skuLimit: number | null;skuUnlimited: boolean;} {
  if (row.skuUnlimited === true) return { skuLimit: null, skuUnlimited: true };
  if (row.skuUnlimited === false) return { skuLimit: row.skuLimit, skuUnlimited: false };
  return { skuLimit: null, skuUnlimited: false };
}

/**
 * Labels the database's answer. Decides no permission.
 *
 * `failed` is kept separate from "no row" on purpose. A network blip must not tell a paying
 * customer they are on the free plan — that reads as an accusation and it is the kind of
 * thing people cancel over. `unknown` withholds the paid output (we cannot prove they are
 * entitled) but says so honestly and offers a retry, rather than showing an upgrade prompt.
 */
export function mapEntitlement(row: EntitlementRow | null, failed = false): Entitlement {
  if (failed || !row) {
    return { ...UNREADABLE, status: failed ? 'unknown' : 'no_membership' };
  }

  const allowance = readAllowance(row);
  const base = {
    active: row.active === true,
    accountId: row.accountId,
    plan: key(row.plan) || 'free',
    planStatus: row.planStatus,
    businessName: row.businessName,
    skuLimit: allowance.skuLimit,
    skuUnlimited: allowance.skuUnlimited,
    skuCount: row.skuCount,
    editorSeatLimit: row.editorSeatLimit,
    canModify: row.canModify,
    currentPeriodEnd: row.currentPeriodEnd,
    cancelAtPeriodEnd: row.cancelAtPeriodEnd === true,
    trialEnd: row.trialEnd
  };

  // No `active` column means we are talking to a schema that predates the entitlements view,
  // and there is nothing left to fall back on now that the local rule is gone. Withhold, and
  // say so: `unknown` is the one state whose copy blames us rather than the customer.
  //
  // This is the deliberate exception to "a missing column fails open". `can_modify` fails
  // open because its absence would silently REMOVE an ability the customer already has;
  // `active`'s absence means we cannot establish an ability at all, and inventing one would
  // hand out the paid product on a schema error.
  if (row.active === null) return { ...base, status: 'unknown', active: false };

  // A suspended or departed membership overrides the plan entirely, and needs its own words:
  // "we paused your account" and "your subscription ended" are not the same sentence, and
  // somebody suspended may well still be paying. `active` is already false here — the view's
  // predicate requires membership_status = 'active' — so this only picks the wording.
  const membershipStatus = key(row.membershipStatus);
  if (membershipStatus !== '' && membershipStatus !== 'active') {
    return { ...base, status: 'suspended' };
  }

  if (base.active) {
    // past_due is entitled and stays entitled: Stripe retries a failed card for days, and
    // locking a maker out mid-batch over a card that expired on a Sunday is worse for them
    // and for us than a loud banner. The view already made that call; we only nag.
    return { ...base, status: key(row.planStatus) === 'past_due' ? 'past_due' : 'active' };
  }

  // Not entitled. Free and lapsed are the same ABILITIES (ruling R9) and different sentences:
  // one has nothing to reassure, the other needs telling that nothing was taken away.
  //
  // Any non-free slug that is not entitled reads as lapsed, rather than this file holding a
  // list of which slugs entitle. That list is `entitlement_is_active`'s, and copying it here
  // is exactly the drift this cutover removed.
  return { ...base, status: base.plan === 'free' ? 'free' : 'lapsed' };
}

/**
 * The reader every SKU-enforcement point must use. FAILS OPEN.
 *
 * `can_modify` now exists: the account data schema computes it from the same function the
 * enforcement trigger calls, so this agrees with the insert the database would refuse. It is
 * still read through here rather than as `canModify === true`, because null means the read
 * failed or the schema predates the column, and denying on null would lock out every account
 * whose read went wrong — including a paying Consultant, silently, with no error anywhere.
 * The trigger fails open on a missing allowance for the same reason; one refused write with
 * an honest message is the whole cost of guessing wrong this way round.
 */
export function mayModify(entitlement: Entitlement): boolean {
  return entitlement.canModify !== false;
}

export interface EntitlementFetch {
  row: EntitlementRow | null;
  /** True when the read itself failed, as opposed to succeeding and finding nothing. */
  failed: boolean;
}

/**
 * One row of the view, for the signed-in user and this deployment's brand.
 *
 * No `user_id` filter, and none should be added: the view is `security_invoker`, so the
 * `auth.uid() = user_id` policy on `brand_memberships` already restricts the result to the
 * caller's own row. A client-side id filter would be redundant at best and, if the id were
 * ever wrong, a way to read nothing at all.
 *
 * `select('*')` rather than a column list, which is a change from the old
 * brand_memberships read and is deliberate. The view IS the published contract surface — it
 * is per-user, it holds no secret, and there is nothing to over-fetch. In exchange: it cannot
 * raise 42703, so the old "retry with `*` on undefined_column" dance is gone; and the columns
 * the migration promised — `can_modify` with the enforcement trigger, `sku_count` with the
 * products table, and `account_id` moving from the user id to a real accounts.id — arrived
 * exactly that way, with the tolerant reader mapping each to null on any schema that predates
 * them.
 *
 * `.eq('brand', BRAND_SLUG)` is what makes `account_id` usable as a write target: it is the
 * account for THIS deployment's brand, not "whichever account sorted first" across the shared
 * Orchestrate identity pool.
 */
export async function fetchEntitlement(): Promise<EntitlementFetch> {
  const client = supabase;
  if (!client) return { row: null, failed: true };

  const { data, error } = await client.
  from('entitlements').
  select('*').
  eq('brand', BRAND_SLUG).
  maybeSingle();

  if (error) return { row: null, failed: true };
  return { row: data ? readEntitlementRow(data) : null, failed: false };
}

/* --------------------------------------------------------------- presentation */

/**
 * A plan name to print.
 *
 * Title-cases the slug rather than holding a slug -> name map, because the display names are
 * the plan contract's and reach this app over the wire from GET /api/plans. Where the
 * catalogue has loaded, prefer its `displayName`; this is the fallback for a screen that has
 * no catalogue, and for a slug the catalogue does not list.
 */
export function planLabel(entitlement: Entitlement): string {
  if (entitlement.status === 'unknown') return 'Unknown';
  if (entitlement.status === 'no_membership') return 'Not set up';
  const plan = entitlement.plan ?? 'free';
  return plan.charAt(0).toUpperCase() + plan.slice(1);
}

/** One plain-English sentence per state, for banners and gates. */
export function entitlementMessage(entitlement: Entitlement): string {
  switch (entitlement.status) {
    case 'active':
      return 'Your plan is active.';
    case 'past_due':
      return 'Your last payment did not go through. Update your card to keep your plan.';
    case 'lapsed':
      // R9 in one sentence. Never "you have lost access": the account can do everything the
      // free plan can, which is everything somebody who never paid can do.
      return 'Your paid plan is not running. Your account can do everything the free plan can, and nothing has been deleted.';
    case 'free':
      return 'You are on the free plan.';
    case 'no_membership':
      return 'Your account is still being set up. This usually takes a moment.';
    case 'suspended':
      return 'This account is suspended. Please get in touch and we will sort it out.';
    case 'unknown':
    default:
      return 'We could not check your plan just now.';
  }
}

/**
 * The allowance as a phrase. Three outcomes, and the third is the one that matters: an
 * allowance we could not read says so, instead of rendering a plausible number.
 */
export function allowanceLabel(entitlement: Entitlement): string {
  if (entitlement.skuUnlimited) return 'Unlimited SKUs';
  if (entitlement.skuLimit === null) return 'Allowance unavailable';
  return `${entitlement.skuLimit.toLocaleString('en-GB')} SKUs`;
}

/** A timestamptz from the view as a date somebody can read, or null if it is not one. */
export function formatEntitlementDate(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

/**
 * What happens next, and when. Null when the row says nothing about a date.
 *
 * Order matters and is the point of the function. A cancellation scheduled at the period end
 * is still `active` — they paid up to that date and everything stays on until it — so
 * "your plan ends on the 14th" has to win over "renews on the 14th", which is the same date
 * carrying the opposite meaning.
 */
export function periodLine(entitlement: Entitlement): string | null {
  const periodEnd = formatEntitlementDate(entitlement.currentPeriodEnd);
  const trialEnd = formatEntitlementDate(entitlement.trialEnd);

  if (entitlement.cancelAtPeriodEnd && periodEnd) {
    return `Your plan ends on ${periodEnd}. Everything stays on until then.`;
  }
  if (entitlement.active && trialEnd) return `Your trial ends on ${trialEnd}.`;
  if (entitlement.active && periodEnd) return `Renews on ${periodEnd}.`;
  if (entitlement.status === 'lapsed' && periodEnd) return `Your last paid period ended on ${periodEnd}.`;
  return null;
}
