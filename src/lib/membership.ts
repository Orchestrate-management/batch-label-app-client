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
import { fetchAccountEntitlement } from './team';

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
   * Editor seats the DATABASE counted as consumed: active members holding a seat-consuming role,
   * plus live pending invites for one. Null on the entitlements view, which never carried it,
   * and on any read that failed. Never zero as a stand-in for unknown, for the same reason
   * `skuCount` is not.
   */
  seatsInUse: number | null;
  /**
   * The caller's own role in this account, from `public.account_entitlement`. Null on the
   * entitlements view, which is keyed by ownership and has no notion of a role.
   */
  callerRole: string | null;
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
   * for THIS brand — which is the whole reason it can be handed to a write. Item 1 of THE
   * account_id CONTRACT in the migration header: "THE APP MAY — AND SHOULD — SEND account_id
   * EXPLICITLY. The id to send is the one it already reads back from entitlements /
   * get_entitlement(BRAND_SLUG)." And the INSERT policy (`with check (is_member_of(account_id))`)
   * refuses one that is not yours, so sending it weakens nothing.
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
  /**
   * Editor seats in use, counted by the database over the same definition the seat trigger
   * enforces. Null is UNKNOWN, and the team screen says so rather than printing a nought that
   * would read as "nobody is here".
   */
  seatsInUse: number | null;
  /**
   * The caller's role in this account, as the database sees it.
   *
   * GATES DO NOT READ THIS. They read `useCan()`, whose role comes from `my_accounts()` and
   * which carries the matrix alongside it. This copy exists so the team screen can show the
   * role beside the seat count without a second source of truth appearing in a component.
   */
  role: string | null;
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
  seatsInUse: null,
  role: null,
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
    // TWO NAMES FOR ONE COLUMN, AND BOTH ARE READ ON PURPOSE. `public.entitlements` aliases the
    // Stripe subscription status as `status`; `public.account_entitlement` returns it as
    // `plan_status`, because that function also returns `membership_status` and one bare
    // `status` between the two would be a coin toss. Reading both means this parser does not
    // have to know which of the two sources it was handed.
    planStatus: text(row.status) ?? text(row.plan_status),
    active: bool(row.active),
    currentPeriodEnd: text(row.current_period_end),
    cancelAtPeriodEnd: bool(row.cancel_at_period_end),
    trialEnd: text(row.trial_end),
    skuLimit: count(row.sku_limit),
    skuCount: count(row.sku_count),
    skuUnlimited: bool(row.sku_unlimited),
    editorSeatLimit: count(row.editor_seat_limit),
    seatsInUse: count(row.seats_in_use),
    callerRole: text(row.caller_role),
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
    seatsInUse: row.seatsInUse,
    role: row.callerRole,
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

/**
 * The two states where offering "New product" wastes a maker's time, and ONLY those two.
 *
 * It is deliberately not "can this account create a product", which we do not know and must
 * not pretend to: the SKU allowance may be full, the code may be a duplicate, the read may be
 * a moment old. It answers the narrower question a create BUTTON needs — is this a state where
 * the insert is already established to fail, so that a form collecting four fields would
 * collect them in order to be refused?
 *
 *   suspended       the INSERT policy refuses it with a bare 42501. Already gated this way on
 *                   every create surface; this function is where that rule now lives.
 *   no_membership   there is no account row for this brand, so there is nothing for the
 *                   column to be and nothing for the database's own `current_account_id()`
 *                   default to resolve. Signup was not finished. The write fails, and the
 *                   thing that fixes it is finishing signup, not pressing the button again.
 *
 * EVERYTHING ELSE KEEPS THE BUTTON, and the two near misses are the point of this comment.
 *
 *   unknown         the entitlement read failed, or has not landed. `createProduct` then omits
 *                   account_id and `current_account_id()` resolves it server-side — so for a
 *                   maker holding exactly one account the create WOULD have worked. Hiding it
 *                   here would take away something they can genuinely do because one read of
 *                   ours blipped, which is the expensive direction to be wrong in.
 *   account_ambiguous
 *                   is not a status; it is a write hint the database returns for a person
 *                   holding more than one account. It arrives after the attempt, with a true
 *                   sentence and correctly no retry (see NO_ACCOUNT / ACCOUNT_AMBIGUOUS in
 *                   lib/products.ts). We cannot see it in advance, so we do not guess at it.
 *   free / lapsed / past_due
 *                   are money states. §6.1: no new, keep everything old working — and the
 *                   allowance, not the plan, is what governs a create. SkuLimitNotice states
 *                   that separately and before anything is typed.
 *
 * Fails OPEN on every state it does not name, for the same reason `mayModify` does.
 */
export function createIsCertainToFail(entitlement: Entitlement): boolean {
  return entitlement.status === 'suspended' || entitlement.status === 'no_membership';
}

/**
 * WHAT WE KNOW ABOUT THE ACCOUNT'S LIVE-SKU COUNT, WHICH IS THREE THINGS AND NOT TWO.
 *
 * `Entitlement.skuCount` is `number | null`, and null already carries one meaning: the database
 * declined to state a count (no account resolved, or the read failed). That is the whole reason
 * the view yields null rather than nought — "zero is a claim; the honest answer is that we do
 * not know".
 *
 * There is a third state and it has been getting answered with a number. The count is read once,
 * when the entitlement provider mounts; a create then moves it, and until the re-read lands the
 * number in hand is KNOWN to be wrong — not unread, not right. Two screens patched over that by
 * treating 0 as unknown, which is not a model: it made a genuine zero unsayable everywhere while
 * leaving a stale 3 perfectly sayable. Overloading nought only hid the first create.
 *
 * So the three are named:
 *
 *   `{ known: false, reason: 'unread' }`  no number at all. Say nothing, or an em dash.
 *   `{ known: false, reason: 'stale' }`   we hold a number and we know a write moved it. Do not
 *                                         state it; a re-read is already in flight.
 *   `{ known: true, count }`              the database counted this, and nothing we did since has
 *                                         moved it. Nought here is a fact and may be stated.
 */
export type SkuCount =
{known: true;count: number;} |
{known: false;reason: 'unread' | 'stale';};

/**
 * The sanctioned reader for the count, in the same spirit as `mayModify`: the raw field is still
 * there, and a screen that states the number should come through here rather than reading it and
 * deciding on its own what a null or a nought means.
 *
 * `unread` beats `stale`: having no number at all is the stronger answer, and after a refresh that
 * failed both are true at once.
 */
export function readSkuCount(skuCount: number | null, stale: boolean): SkuCount {
  if (skuCount === null) return { known: false, reason: 'unread' };
  if (stale) return { known: false, reason: 'stale' };
  return { known: true, count: skuCount };
}

/**
 * The count as a sentence may state it BESIDE A LIST of the same account's products — Studio's
 * header and the Settings identity tab, both of which print the account's total next to products
 * they have just drawn.
 *
 * THE RULE IS NOT "ZERO IS UNKNOWN", which is what those two screens used to do. It is that an
 * account cannot hold fewer live products than this client has just read out of it, so a count
 * BELOW what is on screen is not a fact about the account — it is the two sources disagreeing,
 * and neither of them is worth printing as the winner. Zero beside a non-empty list is only the
 * loudest case of that; "1 product · 3 things outstanding across 3 products" is the same nonsense
 * one row further up.
 *
 * A genuine zero stays sayable. `skuCountBeside({ known: true, count: 0 }, 0)` is 0, so a screen
 * that wants to state an empty account can — Billing already does, beside no list at all, and it
 * does not come through here.
 *
 * It does not reconcile the disagreement and must not: `fetchProducts` drops a product whose
 * specification did not come back, and the count is the database's own over the rows the
 * enforcement trigger counts, so a difference is real information about one of them being
 * incomplete. What this decides is only whether a number may be printed in that sentence.
 */
export function skuCountBeside(skus: SkuCount, shown: number): number | null {
  if (!skus.known) return null;
  if (skus.count < shown) return null;
  return skus.count;
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

/**
 * The same shape, for ONE account, keyed by the account rather than by who owns it.
 *
 * THIS IS THE READ THAT MAKES SEATS WORK AT ALL. `public.entitlements` resolves its account by a
 * lateral join on `owner_user_id`, so an active invited member selects zero rows from it and the
 * app renders "your account is still being set up" at somebody who is sitting in a workspace
 * they were invited into. Measured on a live chain before this change.
 *
 * `public.account_entitlement(uuid)` is keyed on the account and guarded by a trailing
 * `is_member_of(p_account_id)`, so a stranger naming an account gets zero rows and a member gets
 * the OWNER's allowance. Returning the owner's allowance to any member is right: the allowance
 * belongs to the account and not to the person sitting in it.
 *
 * `missing` is kept apart from `failed` because a database that predates the function is an
 * ordinary deploy ordering rather than a fault, and the caller falls back to the view for it.
 */
export interface AccountEntitlementFetch extends EntitlementFetch {
  /** True when this database does not publish `public.account_entitlement` at all. */
  missing: boolean;
}

export async function fetchEntitlementForAccount(
accountId: string)
: Promise<AccountEntitlementFetch> {
  const result = await fetchAccountEntitlement(accountId);
  if (!result.ok) return { row: null, failed: true, missing: result.missing };
  return {
    row: result.row ? readEntitlementRow(result.row) : null,
    failed: false,
    missing: false
  };
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
