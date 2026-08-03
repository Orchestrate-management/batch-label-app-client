import { describe, expect, it } from 'vitest';
import { ACTIVATION_BACKOFF_MS, activationState, delayForAttempt } from './activation';

/**
 * Coming back from Checkout before the entitlement exists.
 *
 * The one rule with teeth: `confirmed` is reachable from exactly one input — the view's
 * `active` column being true. A success URL means a browser was redirected. It does not mean
 * money moved, and `session_id` in the query string is a value anybody can type. Every other
 * state is a shade of "not yet", and they are kept apart because "your card was declined",
 * "we cannot read your account" and "the webhook is a few seconds behind" need three
 * different next actions.
 */

describe('the backoff schedule', () => {
  it('walks the schedule in order', () => {
    ACTIVATION_BACKOFF_MS.forEach((delay, index) => {
      expect(delayForAttempt(index)).toBe(delay);
    });
  });

  it('ends rather than looping', () => {
    // A page that spins forever is a page that never tells anybody what to do next.
    expect(delayForAttempt(ACTIVATION_BACKOFF_MS.length)).toBeNull();
    expect(delayForAttempt(99)).toBeNull();
  });

  it('rejects a nonsense attempt count instead of waiting forever', () => {
    expect(delayForAttempt(-1)).toBeNull();
    expect(delayForAttempt(1.5)).toBeNull();
  });

  it('waits long enough to be worth waiting, and not longer', () => {
    // Roughly half a minute in six requests: nearly every checkout resolves inside two
    // seconds, and the ones that do not are waiting on a Stripe retry measured in tens.
    const total = ACTIVATION_BACKOFF_MS.reduce((sum, delay) => sum + delay, 0);
    expect(total).toBeGreaterThanOrEqual(20_000);
    expect(total).toBeLessThanOrEqual(45_000);
  });
});

describe('what the return screen may say', () => {
  it('confirms only when the row says active', () => {
    expect(activationState({ loading: false, status: 'active', active: true, attempts: 0 })).toBe(
      'confirmed'
    );
  });

  it('confirms an entitled past_due account too', () => {
    // past_due is entitled. Somebody who has just paid off a failed renewal must not be told
    // we still cannot see a subscription.
    expect(activationState({ loading: false, status: 'past_due', active: true, attempts: 0 })).toBe(
      'confirmed'
    );
  });

  it('never confirms on the strength of the redirect alone', () => {
    // The whole point. Free with attempts spent is `not_confirmed`, not `confirmed`.
    expect(activationState({ loading: false, status: 'free', active: false, attempts: 99 })).toBe(
      'not_confirmed'
    );
  });

  it('keeps checking while the schedule has attempts left', () => {
    expect(activationState({ loading: false, status: 'free', active: false, attempts: 0 })).toBe(
      'checking'
    );
    expect(
      activationState({
        loading: false,
        status: 'free',
        active: false,
        attempts: ACTIVATION_BACKOFF_MS.length - 1
      })
    ).toBe('checking');
  });

  it('checks rather than concluding while the first read is in flight', () => {
    expect(activationState({ loading: true, status: 'unknown', active: false, attempts: 99 })).toBe(
      'checking'
    );
  });

  it('stops early for a suspended account', () => {
    // Waiting will never turn a suspension into an entitlement, so counting down a timer to a
    // conclusion we already have just delays telling somebody the truth.
    expect(activationState({ loading: false, status: 'suspended', active: false, attempts: 0 })).toBe(
      'suspended'
    );
  });

  it('blames us when the read itself failed', () => {
    // "We could not check" and "we cannot see a subscription" are different admissions. Only
    // the second one should make somebody wonder whether their payment worked.
    expect(activationState({ loading: false, status: 'unknown', active: false, attempts: 99 })).toBe(
      'unreadable'
    );
  });

  it('confirms a suspended row that somehow still entitles, because the column wins', () => {
    // Unreachable through the view's own predicate, and asserted anyway: this module labels
    // the database's answer and never overrules it.
    expect(activationState({ loading: false, status: 'suspended', active: true, attempts: 0 })).toBe(
      'confirmed'
    );
  });
});
