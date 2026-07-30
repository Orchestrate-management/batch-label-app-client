import { beforeEach, describe, expect, it } from 'vitest';
import { SESSION_COOKIE_CONFIG, sharedCookieStorage } from './session-storage';

/**
 * The storage adapter is the whole handoff.
 *
 * If it stops agreeing with the marketing site's copy, or drops part of a large
 * session, the symptom is "users are randomly signed out" — reported days later,
 * reproducible on nobody's machine, and traced back here only after a long
 * afternoon. These tests are the cheap version of that afternoon.
 *
 * The jsdom document is served from https://app.batchlabel.xyz (see
 * vitest.config.ts), so the same branches run here as in production: `Secure` is
 * added, and the domain is set to `.batchlabel.xyz` rather than being left
 * host-only.
 */

const KEY = 'sb-cqzrwfresuiktgzhkhok-auth-token';

/** Expire every cookie the previous test left behind, on both domain scopes. */
function clearAllCookies() {
  for (const pair of document.cookie.split('; ')) {
    const name = pair.split('=')[0];
    if (!name) continue;
    document.cookie = `${name}=; path=/; max-age=0; domain=.batchlabel.xyz`;
    document.cookie = `${name}=; path=/; max-age=0`;
  }
}

/** Names currently present in the jar. */
function cookieNames(): string[] {
  return document.cookie.
  split('; ').
  map((pair) => pair.split('=')[0]).
  filter(Boolean);
}

/** Captures the raw `document.cookie = …` strings so attributes can be asserted. */
function captureWrites(run: () => void): string[] {
  const writes: string[] = [];
  const descriptor = Object.getOwnPropertyDescriptor(
    Object.getPrototypeOf(document),
    'cookie'
  );
  Object.defineProperty(document, 'cookie', {
    configurable: true,
    get: () => descriptor?.get?.call(document),
    set: (value: string) => {
      writes.push(value);
      descriptor?.set?.call(document, value);
    }
  });
  try {
    run();
  } finally {
    delete (document as unknown as {cookie?: unknown;}).cookie;
  }
  return writes;
}

beforeEach(() => {
  clearAllCookies();
});

describe('the contract with the marketing site', () => {
  /**
   * This file is duplicated byte for byte from the marketing repo. These are the
   * three values that must never diverge: a different cookie name and the two
   * sites cannot see each other's session at all; a different chunk size and a
   * session written by one is reassembled wrongly by the other; a different
   * domain and the cookie is scoped to one subdomain only.
   */
  it('pins the values both copies have to agree on', () => {
    expect(SESSION_COOKIE_CONFIG.CHUNK_SIZE).toBe(3000);
    expect(SESSION_COOKIE_CONFIG.MAX_CHUNKS).toBe(12);
    expect(SESSION_COOKIE_CONFIG.PARENT_DOMAIN).toBe('batchlabel.xyz');
    // 400 days: Chrome's ceiling, and refresh tokens outlive access tokens.
    expect(SESSION_COOKIE_CONFIG.MAX_AGE_SECONDS).toBe(60 * 60 * 24 * 400);
  });

  it('scopes the cookie to the parent domain so www and app share it', () => {
    const writes = captureWrites(() => sharedCookieStorage.setItem(KEY, 'session'));
    expect(writes[0]).toContain('domain=.batchlabel.xyz');
    expect(writes[0]).toContain('path=/');
    expect(writes[0]).toContain('SameSite=Lax');
    // The jsdom origin is https, so this branch must fire.
    expect(writes[0]).toContain('Secure');
  });
});

describe('reading and writing', () => {
  it('returns null for a key that was never written', () => {
    expect(sharedCookieStorage.getItem(KEY)).toBeNull();
  });

  it('round-trips a small value in a single cookie', () => {
    sharedCookieStorage.setItem(KEY, 'a-short-session');
    expect(sharedCookieStorage.getItem(KEY)).toBe('a-short-session');
    expect(cookieNames()).toContain(KEY);
    expect(cookieNames()).not.toContain(`${KEY}.0`);
  });

  it('round-trips values containing characters that need encoding', () => {
    // Real sessions are base64url JSON and contain '=' and ';' after encoding.
    const value = '{"access_token":"a.b=c","user":{"email":"maker@example.com"}}';
    sharedCookieStorage.setItem(KEY, value);
    expect(sharedCookieStorage.getItem(KEY)).toBe(value);
  });

  it('removes the value and every chunk of it', () => {
    sharedCookieStorage.setItem(KEY, 'x'.repeat(7000));
    sharedCookieStorage.removeItem(KEY);
    expect(sharedCookieStorage.getItem(KEY)).toBeNull();
    expect(cookieNames().filter((name) => name.startsWith(KEY))).toHaveLength(0);
  });
});

describe('oversized sessions', () => {
  /**
   * The trap the adapter exists for: browsers cap a cookie at roughly 4KB and
   * DROP an oversized one rather than erroring. A Supabase session with a fat
   * JWT sails past that, so the value has to be split.
   */
  it('splits a value larger than one cookie across numbered chunks', () => {
    const value = 'a'.repeat(7000);
    sharedCookieStorage.setItem(KEY, value);

    const names = cookieNames();
    expect(names).toContain(`${KEY}.0`);
    expect(names).toContain(`${KEY}.1`);
    expect(names).toContain(`${KEY}.2`);
    expect(names).not.toContain(`${KEY}.3`);
  });

  it('drops the unchunked cookie when it chunks', () => {
    // It has to: readValue prefers the whole cookie, so leaving a short stale one
    // behind would make every read return the previous session forever.
    sharedCookieStorage.setItem(KEY, 'small');
    expect(cookieNames()).toContain(KEY);

    sharedCookieStorage.setItem(KEY, 'b'.repeat(7000));
    expect(cookieNames()).not.toContain(KEY);
  });

  it('reassembles the chunks in order on read', () => {
    const value = `${'a'.repeat(3000)}${'b'.repeat(3000)}${'c'.repeat(1000)}`;
    sharedCookieStorage.setItem(KEY, value);
    expect(sharedCookieStorage.getItem(KEY)).toBe(value);
  });

  it('keeps every chunk under the browser limit', () => {
    const writes = captureWrites(() => sharedCookieStorage.setItem(KEY, 'a'.repeat(7000)));
    for (const write of writes) {
      // A cookie is capped on name + value + attributes together, not value alone.
      expect(write.length).toBeLessThan(4096);
    }
  });
});

describe('a shrinking session', () => {
  /**
   * The subtle half of chunking. A session that gets shorter — a token refresh
   * with fewer claims, a smaller user object — writes fewer chunks than last
   * time. If the leftover tail is not cleared, the next read concatenates the
   * new head onto the old tail and produces JSON that parses into nonsense, or
   * does not parse at all. That reads to the user as being signed out.
   */
  it('clears the stale tail when the new value needs fewer chunks', () => {
    sharedCookieStorage.setItem(KEY, 'a'.repeat(9000)); // 3 chunks
    expect(cookieNames()).toContain(`${KEY}.2`);

    const shorter = 'b'.repeat(3500); // 2 chunks
    sharedCookieStorage.setItem(KEY, shorter);

    expect(cookieNames()).not.toContain(`${KEY}.2`);
    expect(sharedCookieStorage.getItem(KEY)).toBe(shorter);
  });

  it('clears every chunk when the new value fits in one cookie again', () => {
    sharedCookieStorage.setItem(KEY, 'a'.repeat(9000));
    sharedCookieStorage.setItem(KEY, 'tiny');

    expect(cookieNames().filter((name) => name.startsWith(`${KEY}.`))).toHaveLength(0);
    expect(sharedCookieStorage.getItem(KEY)).toBe('tiny');
  });

  it('does not leave a readable fragment of the previous session behind', () => {
    sharedCookieStorage.setItem(KEY, 'a'.repeat(9000));
    sharedCookieStorage.setItem(KEY, 'b'.repeat(3500));
    // The tell-tale bug: the read comes back longer than what was written.
    expect(sharedCookieStorage.getItem(KEY)).toHaveLength(3500);
  });
});

describe('bounds', () => {
  it('refuses to spray more than MAX_CHUNKS cookies', () => {
    // Well past the sanity bound: 12 chunks x 3000 = 36000.
    sharedCookieStorage.setItem(KEY, 'a'.repeat(60000));
    const chunks = cookieNames().filter((name) => name.startsWith(`${KEY}.`));
    expect(chunks.length).toBeLessThanOrEqual(SESSION_COOKIE_CONFIG.MAX_CHUNKS);
  });
});
