/**
 * Coming back from Stripe Checkout, before the entitlement exists.
 *
 * THE RACE, precisely. Stripe redirects the browser to the success URL as soon as the
 * Checkout Session completes. The entitlement is written by a webhook, and it is NOT written
 * by the event that fires at that moment: `checkout.session.completed` carries no line items,
 * so it cannot say which tier was bought. The plan, the allowance and the period end land on
 * the `customer.subscription.*` event that follows a beat later. The redirect usually loses
 * that race by a fraction of a second and occasionally loses it by several.
 *
 * So the return screen ASKS AGAIN on a backoff, and until the row says otherwise it says
 * "we are waiting", not "you are on Maker". A success URL is proof that a browser was
 * redirected. It is not proof that money moved, and `session_id` in the query string is a
 * string anybody can type — this app never treats either as evidence of a plan. The only
 * thing that counts as evidence is `public.entitlements.active`, which is written server-side
 * from a signature-verified Stripe event.
 *
 * The backoff is generous at the top and slow at the bottom, which is the shape the failure
 * actually has: nearly every checkout resolves inside two seconds, and the ones that do not
 * are usually waiting on a Stripe retry measured in tens of seconds. Roughly thirty seconds
 * of polling in six requests, then it stops and says so — a page that spins forever is a page
 * that never tells anybody what to do next.
 */

import type { EntitlementStatus } from './membership';

/** Delay before each re-read, in order. Six reads, about thirty seconds in total. */
export const ACTIVATION_BACKOFF_MS: readonly number[] = [1000, 2000, 3000, 5000, 8000, 13000];

/**
 * How long to wait before re-read number `attempt` (zero-based), or null when the schedule is
 * spent. Null is the signal to stop polling and show a settled answer.
 */
export function delayForAttempt(attempt: number): number | null {
  if (!Number.isInteger(attempt) || attempt < 0) return null;
  return ACTIVATION_BACKOFF_MS[attempt] ?? null;
}

export type ActivationState =
/** Still asking. Nothing has been claimed yet. */
'checking' |
/** The row says entitled. This is the ONLY state that may say the plan is on. */
'confirmed' |
/** The membership is suspended — a different problem from a slow webhook. */
'suspended' |
/** We could not read the entitlement at all. Our fault, and said as such. */
'unreadable' |
/** We asked as long as we said we would and the row still shows no plan. */
'not_confirmed';

export interface ActivationInput {
  /** True until the first read of this page load resolves. */
  loading: boolean;
  status: EntitlementStatus;
  /** The view's `active` column, as read. Never anything this app computed. */
  active: boolean;
  /** Re-reads issued so far. */
  attempts: number;
}

/**
 * What the return screen may say.
 *
 * `confirmed` is reachable from exactly one input — `active` being true — and it is the only
 * state whose copy is allowed to name the plan as live. Everything else is a shade of "not
 * yet", and each shade gets its own sentence because "your card was declined", "we cannot
 * reach the database" and "the webhook is a few seconds behind" need three different next
 * actions.
 */
export function activationState(input: ActivationInput): ActivationState {
  if (input.active) return 'confirmed';
  if (input.loading) return 'checking';
  // A suspended membership is never going to become active by waiting, so stop early and say
  // the true thing rather than counting down a timer to a conclusion we already have.
  if (input.status === 'suspended') return 'suspended';
  if (delayForAttempt(input.attempts) !== null) return 'checking';
  return input.status === 'unknown' ? 'unreadable' : 'not_confirmed';
}
