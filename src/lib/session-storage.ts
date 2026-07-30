/**
 * Shared session storage for batchlabel.xyz.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THIS FILE IS DUPLICATED VERBATIM IN Batch-Label-Product-Application.
 * If you change it here, change it there in the same commit. The two copies
 * must agree byte for byte on cookie name, chunk size and domain, or the
 * session silently fails to carry between www and app and users appear signed
 * out the moment they cross over.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * WHY THIS EXISTS
 *
 * supabase-js keeps the session in localStorage by default. localStorage is
 * partitioned per origin, so a session created on www.batchlabel.xyz is simply
 * not visible to app.batchlabel.xyz — the user signs up, gets handed to the
 * product, and is asked to sign in again. Storing the session in a cookie
 * scoped to the parent domain `.batchlabel.xyz` makes both subdomains read the
 * same session, so one login covers both.
 *
 * THE TRAP THIS HANDLES
 *
 * A Supabase session (access token + refresh token + user object) regularly
 * exceeds the ~4KB per-cookie limit. Browsers do not error on an oversized
 * cookie — they drop it. The failure looks like being randomly logged out, and
 * it gets worse as more claims land in the JWT. So the value is split across
 * numbered chunks, the same convention @supabase/ssr uses: `<key>.0`, `<key>.1`
 * and so on. Reading reassembles them; writing clears any chunks that are no
 * longer needed, which matters because a shorter session must not leave a stale
 * tail behind that corrupts the next read.
 *
 * The key comes from supabase-js itself (`sb-<project-ref>-auth-token`), so as
 * long as both apps point at the same Supabase project the cookie name matches
 * automatically — there is nothing to keep in sync by hand.
 */

/** Cookies must stay under ~4096 bytes including name and attributes. */
const CHUNK_SIZE = 3000;
/** Refresh tokens outlive access tokens; Chrome caps cookie lifetime at 400 days. */
const MAX_AGE_SECONDS = 60 * 60 * 24 * 400;
/** Sanity bound. Past this something is wrong and we should not spray cookies. */
const MAX_CHUNKS = 12;

const PARENT_DOMAIN = 'batchlabel.xyz';

function isBrowser(): boolean {
  return typeof document !== 'undefined';
}

/**
 * `.batchlabel.xyz` when we are on that domain, so www and app share the cookie.
 * Host-only everywhere else — localhost and *.vercel.app previews cannot set a
 * cookie for a domain they are not under, and silently get no cookie at all if
 * you try.
 */
function domainAttribute(): string {
  if (!isBrowser()) return '';
  const host = window.location.hostname;
  return host === PARENT_DOMAIN || host.endsWith(`.${PARENT_DOMAIN}`) ?
  `; domain=.${PARENT_DOMAIN}` :
  '';
}

function secureAttribute(): string {
  if (!isBrowser()) return '';
  return window.location.protocol === 'https:' ? '; Secure' : '';
}

function readCookie(name: string): string | null {
  if (!isBrowser()) return null;
  const prefix = `${name}=`;
  const hit = document.cookie.
  split('; ').
  find((row) => row.startsWith(prefix));
  return hit ? decodeURIComponent(hit.slice(prefix.length)) : null;
}

function writeCookie(name: string, value: string) {
  if (!isBrowser()) return;
  document.cookie =
  `${name}=${encodeURIComponent(value)}; path=/; max-age=${MAX_AGE_SECONDS}` +
  `; SameSite=Lax${domainAttribute()}${secureAttribute()}`;
}

function deleteCookie(name: string) {
  if (!isBrowser()) return;
  // Clear on both the shared domain and host-only. A cookie written before this
  // adapter shipped, or on a different host, would otherwise linger and shadow
  // the real one.
  document.cookie = `${name}=; path=/; max-age=0${domainAttribute()}`;
  document.cookie = `${name}=; path=/; max-age=0`;
}

/** Reassembles a value written either whole or as numbered chunks. */
function readValue(key: string): string | null {
  const whole = readCookie(key);
  if (whole !== null) return whole;

  let out = '';
  for (let i = 0; i < MAX_CHUNKS; i++) {
    const part = readCookie(`${key}.${i}`);
    if (part === null) break;
    out += part;
  }
  return out.length > 0 ? out : null;
}

function writeValue(key: string, value: string) {
  if (value.length <= CHUNK_SIZE) {
    writeCookie(key, value);
    // Drop any chunks from a previous, larger session.
    for (let i = 0; i < MAX_CHUNKS; i++) deleteCookie(`${key}.${i}`);
    return;
  }

  // Chunked: the unchunked cookie must go, or readValue would return it and
  // ignore the chunks.
  deleteCookie(key);
  let written = 0;
  for (let i = 0; i < MAX_CHUNKS && written < value.length; i++) {
    writeCookie(`${key}.${i}`, value.slice(written, written + CHUNK_SIZE));
    written += CHUNK_SIZE;
  }
  // Clear a stale tail left by a longer previous value.
  for (let i = Math.ceil(value.length / CHUNK_SIZE); i < MAX_CHUNKS; i++) {
    deleteCookie(`${key}.${i}`);
  }
}

function removeValue(key: string) {
  deleteCookie(key);
  for (let i = 0; i < MAX_CHUNKS; i++) deleteCookie(`${key}.${i}`);
}

/**
 * The storage object handed to supabase-js as `auth.storage`.
 *
 * Exported separately from the client so it can be unit tested, and so the app
 * repo can assert it matches this one.
 */
export const sharedCookieStorage = {
  getItem: (key: string): string | null => readValue(key),
  setItem: (key: string, value: string): void => writeValue(key, value),
  removeItem: (key: string): void => removeValue(key)
};

/** Exported for tests and for the app repo's parity check. */
export const SESSION_COOKIE_CONFIG = {
  CHUNK_SIZE,
  MAX_AGE_SECONDS,
  MAX_CHUNKS,
  PARENT_DOMAIN
} as const;
