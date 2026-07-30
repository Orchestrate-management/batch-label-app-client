/**
 * Reading the signed-in maker's entitlement.
 *
 * WHERE IT COMES FROM
 *
 * `public.brand_memberships` holds one row per (user, brand). RLS grants the
 * owner SELECT on their own row and grants no INSERT or UPDATE to anybody —
 * every write is server-side, from the marketing site's Stripe webhook running
 * under the service role. That is deliberate and this file must never fight it:
 * a browser that could write its own `plan` is a browser that can award itself
 * a paid subscription. There is no write path in this module and there should
 * not be one added.
 *
 * Because the policy is "own memberships are readable", the query filters on
 * brand_slug only. Adding `.eq('user_id', …)` would be redundant at best and, if
 * the client-side id were ever wrong, a way to read nothing at all.
 *
 * SCHEMA DRIFT
 *
 * The marketing side owns this schema and is adding richer entitlement fields.
 * We therefore ask for a named list of columns that exist today and, if Postgres
 * reports one of them missing (42703 — a rename or removal on the other side),
 * fall back to `*` rather than showing every customer a broken plan. Every field
 * is then read defensively: absent is treated as absent, not as zero.
 */

import { supabase } from './supabase';
import { BRAND_SLUG } from './brand';

/**
 * - `active`         paid and in good standing. Everything is on.
 * - `past_due`       payment failed and Stripe is retrying. Access is kept, with a warning.
 * - `cancelled`      the subscription ended. Read-only.
 * - `free`           no paid plan. Read-only.
 * - `no_membership`  signed in but no row for this brand yet — mid-signup.
 * - `suspended`      the membership itself is suspended or left, whatever the plan says.
 * - `unknown`        we could not read it. Never presented as "you have not paid".
 */
export type EntitlementStatus =
'active' |
'past_due' |
'cancelled' |
'free' |
'no_membership' |
'suspended' |
'unknown';

/** Only the columns this app actually uses. Verified present in the live schema. */
export interface MembershipRow {
  brandSlug: string | null;
  /** Membership standing: active | suspended | left. */
  membershipStatus: string | null;
  businessName: string | null;
  plan: string | null;
  /** Mirrors the Stripe subscription status. Null when no subscription exists. */
  planStatus: string | null;
}

export interface Entitlement {
  status: EntitlementStatus;
  /** Whether paid features are currently switched on. */
  active: boolean;
  /** Lower-cased plan key, or null when there is no membership / no read. */
  plan: string | null;
  planStatus: string | null;
  businessName: string | null;
}

/** Stripe statuses that mean the subscription is genuinely live. */
const LIVE_STATUSES = ['active', 'trialing'];

/**
 * Dunning. Stripe is retrying the card and the customer usually has days to fix
 * it. Cutting a maker off mid-batch over a card that expired yesterday is worse
 * for them and for us than showing a loud banner, so access is retained here and
 * only genuinely ends at `canceled`.
 */
const GRACE_STATUSES = ['past_due', 'unpaid'];

/** Terminal. The subscription is over. */
const ENDED_STATUSES = ['canceled', 'cancelled', 'incomplete_expired'];

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

/**
 * Normalises a column before comparing it. Trims as well as lower-cases:
 * readMembershipRow already trims what it reads, but mapEntitlement is a public
 * pure function and must not depend on having been fed by it.
 */
function key(value: string | null): string {
  return (value ?? '').trim().toLowerCase();
}

/** Tolerant reader: anything unexpected becomes null rather than throwing. */
export function readMembershipRow(raw: unknown): MembershipRow {
  const row = (raw ?? {}) as Record<string, unknown>;
  return {
    brandSlug: text(row.brand_slug),
    membershipStatus: text(row.status),
    businessName: text(row.business_name),
    plan: text(row.plan),
    planStatus: text(row.plan_status)
  };
}

/**
 * The whole entitlement rule, as one pure function.
 *
 * `failed` is kept separate from "no row" on purpose. A network blip must not
 * tell a paying customer they are on the free plan — that reads as an accusation
 * and it is the kind of thing people cancel over. `unknown` withholds the paid
 * output (we cannot prove they are entitled) but says so honestly and offers a
 * retry, rather than showing an upgrade prompt.
 */
export function mapEntitlement(row: MembershipRow | null, failed = false): Entitlement {
  if (failed) {
    return { status: 'unknown', active: false, plan: null, planStatus: null, businessName: null };
  }
  if (!row) {
    return {
      status: 'no_membership',
      active: false,
      plan: null,
      planStatus: null,
      businessName: null
    };
  }

  const base = {
    plan: key(row.plan) || 'free',
    planStatus: row.planStatus,
    businessName: row.businessName
  };

  // A suspended or departed membership overrides the plan entirely.
  const membershipStatus = key(row.membershipStatus);
  if (membershipStatus !== '' && membershipStatus !== 'active') {
    return { ...base, status: 'suspended', active: false };
  }

  if (base.plan === 'free') {
    return { ...base, status: 'free', active: false };
  }

  const planStatus = key(row.planStatus);

  // A paid plan with no Stripe status can only have been written server-side —
  // the column defaults to 'free' and no client can change it. Treat it as a
  // granted plan (comped account, manual migration) rather than as broken.
  if (planStatus === '') return { ...base, status: 'active', active: true };
  if (LIVE_STATUSES.includes(planStatus)) return { ...base, status: 'active', active: true };
  if (GRACE_STATUSES.includes(planStatus)) return { ...base, status: 'past_due', active: true };
  if (ENDED_STATUSES.includes(planStatus)) return { ...base, status: 'cancelled', active: false };

  // Stripe added a status we do not know (`paused`, or something newer). Do not
  // guess in the customer's favour, and do not accuse them either.
  return { ...base, status: 'unknown', active: false };
}

/** Columns known to exist. Kept narrow so an unrelated schema change cannot break the read. */
const COLUMNS = 'brand_slug,status,business_name,plan,plan_status';

/** Postgres: undefined_column. Raised when the schema has moved under us. */
const UNDEFINED_COLUMN = '42703';

export interface MembershipFetch {
  row: MembershipRow | null;
  /** True when the read itself failed, as opposed to succeeding and finding nothing. */
  failed: boolean;
}

export async function fetchMembership(): Promise<MembershipFetch> {
  const client = supabase;
  if (!client) return { row: null, failed: true };

  const query = (columns: string) =>
  client.from('brand_memberships').select(columns).eq('brand_slug', BRAND_SLUG).maybeSingle();

  let result = await query(COLUMNS);
  if (result.error?.code === UNDEFINED_COLUMN) {
    result = await query('*');
  }
  if (result.error) return { row: null, failed: true };
  return { row: result.data ? readMembershipRow(result.data) : null, failed: false };
}

/* --------------------------------------------------------------- presentation */

/** Plan names are free text from Stripe. Title-case whatever we are given. */
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
    case 'cancelled':
      return 'Your plan has ended. Your work is safe and read-only until you start a plan again.';
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
