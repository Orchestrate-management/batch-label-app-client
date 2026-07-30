import { beforeEach, describe, expect, it } from 'vitest';
import {
  BOUNCE_WINDOW_MS,
  MAX_BOUNCES_PER_WINDOW,
  clearBounceRecord,
  decideBounce,
  parseBounceRecord,
  readBounceRecord,
  writeBounceRecord } from
'./auth-redirect';
import { PRICING_URL, loginUrl, marketingUrl } from './marketing';

/**
 * The rule that stops an infinite redirect.
 *
 * Both halves of the handoff are correct on their own — "no session, go to
 * login" and "authenticated, go back where you came from" — and together, if the
 * session does not carry, they are a loop with no error boundary in it, because
 * each hop is a full page navigation. Testing this without a browser is the
 * entire reason the decision is a pure function.
 */

const NOW = 1_800_000_000_000;

beforeEach(() => {
  clearBounceRecord();
});

describe('decideBounce', () => {
  it('bounces a first-time visitor', () => {
    const decision = decideBounce(null, NOW);
    expect(decision.bounce).toBe(true);
    expect(decision.next).toEqual({ at: NOW, count: 1 });
  });

  it('allows one retry inside the window', () => {
    const decision = decideBounce({ at: NOW, count: 1 }, NOW + 2_000);
    expect(decision.bounce).toBe(true);
    expect(decision.next.count).toBe(2);
  });

  it('holds the window open from the first attempt, not the last', () => {
    // Otherwise every bounce slides the window forward and the limit never bites.
    const decision = decideBounce({ at: NOW, count: 1 }, NOW + 20_000);
    expect(decision.next.at).toBe(NOW);
  });

  it('stops bouncing once the budget is spent', () => {
    const decision = decideBounce({ at: NOW, count: MAX_BOUNCES_PER_WINDOW }, NOW + 1_000);
    expect(decision.bounce).toBe(false);
  });

  it('starts a fresh budget after the window expires', () => {
    // Someone who bounced, read the marketing site for a while and came back is
    // not in a loop — they get a clean attempt.
    const spent = { at: NOW, count: MAX_BOUNCES_PER_WINDOW };
    const decision = decideBounce(spent, NOW + BOUNCE_WINDOW_MS + 1);
    expect(decision.bounce).toBe(true);
    expect(decision.next).toEqual({ at: NOW + BOUNCE_WINDOW_MS + 1, count: 1 });
  });

  it('does not lock anyone out when the clock jumps backwards', () => {
    // A device clock correction must not read as "an enormous window" and wedge
    // the gate shut.
    const decision = decideBounce({ at: NOW, count: MAX_BOUNCES_PER_WINDOW }, NOW - 60_000);
    expect(decision.bounce).toBe(true);
    expect(decision.next.count).toBe(1);
  });

  it('gives a real login enough room', () => {
    // The window has to be shorter than a human sign-in, or someone who types
    // their password slowly is told the session did not carry.
    expect(BOUNCE_WINDOW_MS).toBeLessThanOrEqual(60_000);
    expect(MAX_BOUNCES_PER_WINDOW).toBeGreaterThanOrEqual(2);
  });
});

describe('parseBounceRecord', () => {
  it.each([
  ['nothing stored', null],
  ['not JSON', 'not json at all'],
  ['the wrong shape', '{"foo":1}'],
  ['a non-numeric count', '{"at":1,"count":"two"}'],
  ['a non-finite time', '{"at":null,"count":1}']])(
  'treats %s as no history', (_label, raw) => {
    expect(parseBounceRecord(raw)).toBeNull();
  });

  it('reads back what it wrote', () => {
    writeBounceRecord({ at: NOW, count: 2 });
    expect(readBounceRecord()).toEqual({ at: NOW, count: 2 });
  });

  it('forgets the history when cleared', () => {
    writeBounceRecord({ at: NOW, count: 2 });
    clearBounceRecord();
    expect(readBounceRecord()).toBeNull();
  });
});

describe('where we send people', () => {
  it('points at the marketing login with the current page as next', () => {
    const url = loginUrl('https://app.batchlabel.xyz/products/hearth-01');
    expect(url).toBe(
      'https://www.batchlabel.xyz/log-in?next=https%3A%2F%2Fapp.batchlabel.xyz%2Fproducts%2Fhearth-01'
    );
  });

  it('encodes a next that already has a query string', () => {
    // Unencoded, the `&` would truncate `next` and the maker would land on the
    // app's front door instead of the page they asked for.
    const url = loginUrl('https://app.batchlabel.xyz/records?run=BFC-2607-014&view=full');
    expect(url).toContain('next=https%3A%2F%2Fapp.batchlabel.xyz%2Frecords%3Frun%3D');
    expect(url.split('?').length).toBe(2);
    expect(new URL(url).searchParams.get('next')).toBe(
      'https://app.batchlabel.xyz/records?run=BFC-2607-014&view=full'
    );
  });

  it('builds marketing links without doubling the slash', () => {
    expect(marketingUrl('/pricing')).toBe('https://www.batchlabel.xyz/pricing');
    expect(marketingUrl('pricing')).toBe('https://www.batchlabel.xyz/pricing');
    expect(PRICING_URL).toBe('https://www.batchlabel.xyz/pricing');
  });
});
