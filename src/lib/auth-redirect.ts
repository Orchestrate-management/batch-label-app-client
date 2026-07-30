/**
 * Bouncing an unauthenticated visitor to the marketing login — without a loop.
 *
 * THE LOOP THIS PREVENTS
 *
 * The gate's rule is "no session, go to www/log-in?next=<here>". The marketing
 * login's rule is "authenticated, go back to `next`". If the session does not
 * survive the crossing — a blocked third-party-ish cookie, a cookie dropped for
 * being oversized, a `.batchlabel.xyz` domain mismatch between the two copies of
 * session-storage.ts — then both rules keep firing and the browser ping-pongs
 * between the two sites forever. It is a full page navigation each way, so there
 * is no React error boundary or router guard to catch it; the user just sees a
 * flickering address bar.
 *
 * So the bounce is counted. A couple of attempts inside a short window is
 * normal (a real login takes longer than the window, so a person who genuinely
 * signs in never trips it). Beyond that we stop redirecting and say plainly that
 * the sign-in did not carry, with a manual link — a dead end the user can read
 * beats an infinite loop they cannot.
 *
 * The counter lives in sessionStorage: per tab, cleared when the tab closes, and
 * preserved across a navigation away to www and back. It is reset the moment a
 * session is seen, so a normal signed-in visit never accumulates anything.
 */

export const BOUNCE_STORAGE_KEY = 'batchlabel.auth.bounce';

/** A real human login takes longer than this, so it cannot trip the limit. */
export const BOUNCE_WINDOW_MS = 30_000;

/** One retry. Enough to survive a transient cookie race, not enough to loop. */
export const MAX_BOUNCES_PER_WINDOW = 2;

export interface BounceRecord {
  /** Start of the current window, not the time of the last bounce. */
  at: number;
  count: number;
}

export interface BounceDecision {
  bounce: boolean;
  next: BounceRecord;
}

export function parseBounceRecord(raw: string | null): BounceRecord | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<BounceRecord>;
    if (typeof parsed?.at !== 'number' || typeof parsed?.count !== 'number') return null;
    if (!Number.isFinite(parsed.at) || !Number.isFinite(parsed.count)) return null;
    return { at: parsed.at, count: parsed.count };
  } catch {
    return null;
  }
}

/**
 * Whether to bounce now, and the record to store if we do.
 *
 * Pure so the rule can be tested without a browser: this is the one piece of
 * logic whose failure mode is an infinite redirect.
 */
export function decideBounce(previous: BounceRecord | null, now: number): BounceDecision {
  // No history, or the window has expired: this is a fresh attempt.
  if (!previous || now - previous.at > BOUNCE_WINDOW_MS || now < previous.at) {
    return { bounce: true, next: { at: now, count: 1 } };
  }
  if (previous.count < MAX_BOUNCES_PER_WINDOW) {
    // Keep the original window start so repeated attempts cannot slide it forward
    // indefinitely and defeat the limit.
    return { bounce: true, next: { at: previous.at, count: previous.count + 1 } };
  }
  return { bounce: false, next: previous };
}

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage;
  } catch {
    // Safari in Lockdown Mode and some privacy extensions throw on access.
    return null;
  }
}

export function readBounceRecord(): BounceRecord | null {
  try {
    return parseBounceRecord(storage()?.getItem(BOUNCE_STORAGE_KEY) ?? null);
  } catch {
    return null;
  }
}

export function writeBounceRecord(record: BounceRecord): void {
  try {
    storage()?.setItem(BOUNCE_STORAGE_KEY, JSON.stringify(record));
  } catch {
    // If we cannot count bounces we still prefer to let the redirect happen; the
    // guard also refuses to redirect twice within one page load.
  }
}

export function clearBounceRecord(): void {
  try {
    storage()?.removeItem(BOUNCE_STORAGE_KEY);
  } catch {
    // Nothing to do — an uncleared counter only costs one skipped bounce.
  }
}

/** The page the user was actually trying to reach, for `next`. */
export function currentUrl(): string {
  if (typeof window === 'undefined') return '/';
  return window.location.href;
}

/**
 * Leaves this app. A full navigation, not a router push — we are crossing to a
 * different origin.
 *
 * Wrapped rather than called inline so the guard can be tested: jsdom has no
 * navigation, and a test that really wants to assert "we sent them to www with
 * this exact next" needs somewhere to hang a spy.
 */
export function navigateTo(url: string): void {
  if (typeof window === 'undefined') return;
  window.location.assign(url);
}
