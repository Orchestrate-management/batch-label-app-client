import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState } from
'react';
import type { Session, User } from '@supabase/supabase-js';
import { Logo } from '../components/Logo';
import { supabase, isSupabaseConfigured, MISSING_CONFIG_MESSAGE } from './supabase';
import { HOME_URL, loginUrl } from './marketing';
import {
  clearBounceRecord,
  currentUrl,
  decideBounce,
  navigateTo,
  readBounceRecord,
  writeBounceRecord } from
'./auth-redirect';

/**
 * Authentication for the product app.
 *
 * There is no login form here and there never will be. Accounts, passwords,
 * Google, password resets and payment all live on www.batchlabel.xyz; this app
 * only ever asks "is there a session?" and, if not, hands the visitor over. The
 * session itself crosses in a cookie on `.batchlabel.xyz` (lib/session-storage.ts).
 */

/**
 * What a sign-out DID. Never `void`, and that is the fix rather than a detail of it.
 *
 * `signOut()` used to return `Promise<void>`, and both call sites dropped it with `void`. That
 * was survivable only for as long as the function could not fail — and it could. supabase-js
 * rethrows anything it does not recognise as an AuthError, so a rejected `auth.signOut()` took
 * the two lines under it with it: the browser never left for www, `signingOut` stayed true
 * forever, and because `signingOut` is folded into `loading`, RequireAuth replaced THE WHOLE APP
 * with "Checking your session…" and left it there. The maker was still signed in, on a shared
 * computer as easily as their own, looking at a splash screen that named nothing.
 *
 * A caller cannot now drop that without deleting a value it was handed, and the provider holds
 * it as `signOutFailure` so the two screens with a Sign out button can say it without inventing
 * a mechanism of their own.
 */
export type SignOutResult =
/** The session is gone from this browser, and the browser is leaving for www. */
{state: 'signed-out';} |
/** Nothing was established. They are still signed in here AND on www, and are told so. */
{state: 'still-signed-in';message: string;};

/**
 * Said when the sign-out did not take.
 *
 * It states the fact, states that nothing changed, and gives the one action that is certain to
 * work on the machine they are actually sitting at — because "try again" is not good enough
 * advice for somebody who clicked Sign out on a library computer and is about to walk away.
 */
const STILL_SIGNED_IN =
'We could not sign you out, so you are still signed in here and on batchlabel.xyz. Nothing has ' +
'changed. Try again — and if this is a shared computer, close the browser to be certain.';

/**
 * Is there still a session in this browser?
 *
 * THE ONLY QUESTION WORTH ASKING AFTER THE ATTEMPT, and the reason this exists rather than a
 * check of what `signOut()` returned. supabase-js answers a failed sign-out in three ways and
 * they do not agree about what happened locally:
 *
 *  - `{ error }` because the POST to /logout was refused or never arrived. auth-js calls
 *    `_removeSession()` BEFORE returning that error, so the shared cookie is already gone and
 *    the maker is signed out here and on www. Only the refresh token on the server survives,
 *    which is not what this button ever claimed to end.
 *  - `{ error }` because the session itself could not be read or refreshed. Nothing was removed
 *    and the maker is still signed in — the opposite answer, from the same shape.
 *  - A REJECTED PROMISE, which is where this started. auth-js returns `{ error }` for anything
 *    it recognises as an AuthError — a network failure at /logout becomes AuthRetryableFetchError,
 *    a 5xx becomes the same, a 4xx becomes AuthApiError — and rethrows everything else. For this
 *    app the reachable case is our own storage adapter: `sharedCookieStorage` touches
 *    `document.cookie` and calls `decodeURIComponent` on what it finds, and a partitioned
 *    document throws SecurityError while a malformed cookie value throws URIError. Neither is
 *    caught anywhere between there and our `await`. How far the sign-out got is then unknown.
 *
 * So we ask, rather than infer. `getSession()` reads the same storage the sign-out was supposed
 * to clear, which is the same storage www reads, so its answer is the answer to the question the
 * maker is really asking.
 *
 * AN ERROR COUNTS AS STILL SIGNED IN. Not knowing is not the same as being out, and a session
 * kept in a cookie on `.batchlabel.xyz` outlives this tab. The false confirmation is the
 * expensive one here, exactly as it is for "sign out on every device".
 */
async function sessionRemains(): Promise<boolean> {
  if (!supabase) return false;
  try {
    const { data, error } = await supabase.auth.getSession();
    if (error) return true;
    return data.session !== null;
  } catch {
    return true;
  }
}

interface AuthContextValue {
  session: Session | null;
  user: User | null;
  /** True until the first getSession() resolves. Nothing may redirect while true. */
  loading: boolean;
  /** False when the Supabase env vars are absent. The app refuses to render. */
  configured: boolean;
  signOut: () => Promise<SignOutResult>;
  /**
   * Set when a sign-out left the maker signed in, cleared when the next one starts.
   *
   * It lives here and not on either button because neither button survives the attempt:
   * `signingOut` is folded into `loading`, so RequireAuth unmounts the entire tree — shell,
   * Settings page and both Sign out buttons — for as long as the sign-out is in flight. Local
   * state in those components is destroyed on the way past, which is precisely the window this
   * message has to cross.
   */
  signOutFailure: string | null;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: {children: React.ReactNode;}) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  // Between "signOut() resolved" and "the browser actually left for www" there is
  // a render with no session. Without this flag the guard would see it and fire a
  // bounce to the login page, which is both a wasted navigation and a confusing
  // flash of the login screen for someone who asked to sign out.
  const [signingOut, setSigningOut] = useState(false);
  const [signOutFailure, setSignOutFailure] = useState<string | null>(null);

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return;
    }
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession(data.session ?? null);
      setLoading(false);
    });
    const { data: subscription } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setLoading(false);
    });
    return () => {
      active = false;
      subscription.subscription.unsubscribe();
    };
  }, []);

  /**
   * Ask for the session to end, THEN CHECK WHETHER IT DID, and leave only if it has.
   *
   * The order is the whole of it. This function used to call `auth.signOut()`, assume, and
   * navigate; the assumption held right up until the call rejected, and then the app sat on
   * "Checking your session…" for as long as the tab was open (see SignOutResult above).
   *
   * NEITHER THE ERROR NOR THE REJECTION IS THE ANSWER, so neither decides anything here. Both
   * are swallowed on purpose and the question is put to `sessionRemains()` instead, which reads
   * the same cookie www reads. A sign-out that came back with an error may well have removed
   * the session, and one that came back clean has; what must never happen is this app claiming
   * a session ended when it is still sitting on `.batchlabel.xyz` waiting for the next tab.
   *
   * `signingOut` is set BEFORE the call and cleared only on the path that stays. It exists to
   * cover the render between SIGNED_OUT arriving and the browser leaving, so it cannot be moved
   * after the await — and leaving it set on the failing path is the bug being fixed, because it
   * is what turned a failed sign-out into a permanent splash screen.
   */
  const signOut = useCallback(async (): Promise<SignOutResult> => {
    setSigningOut(true);
    setSignOutFailure(null);

    try {
      // signOut() goes through the same storage adapter, so it clears the shared
      // cookie (and every numbered chunk of it) on `.batchlabel.xyz`. The user is
      // signed out of www as well, which is the correct reading of "sign out".
      if (supabase) await supabase.auth.signOut();
    } catch {
      // Deliberately empty. A rejection says the call did not finish, not that the session
      // survived it, and `sessionRemains()` is about to establish which.
    }

    if (await sessionRemains()) {
      setSigningOut(false);
      setSignOutFailure(STILL_SIGNED_IN);
      return { state: 'still-signed-in', message: STILL_SIGNED_IN };
    }

    clearBounceRecord();
    navigateTo(HOME_URL);
    return { state: 'signed-out' };
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      user: session?.user ?? null,
      loading: loading || signingOut,
      configured: isSupabaseConfigured,
      signOut,
      signOutFailure
    }),
    [session, loading, signingOut, signOut, signOutFailure]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
}

/**
 * The gate. Nothing in this app renders without a session.
 *
 * Three things it is careful about:
 *
 * 1. It never redirects while the session is still resolving. Someone arriving
 *    straight from signup on www has a valid cookie, but reading it is async —
 *    checking too early would throw a brand new customer back to the login page
 *    they just came from.
 * 2. It redirects at most once per page load (`redirected`), because React can
 *    re-render this component several times before the browser actually leaves.
 * 3. It counts bounces across page loads (see auth-redirect.ts) so a session
 *    that fails to carry produces a readable dead end rather than an infinite
 *    ping-pong between www and app.
 */
export function RequireAuth({ children }: {children: React.ReactNode;}) {
  const { session, loading, configured } = useAuth();
  const [loopDetected, setLoopDetected] = useState(false);
  const redirected = useRef(false);

  useEffect(() => {
    if (!configured || loading) return;
    if (session) {
      // Signed in: forget any earlier failed attempts so a future sign-out and
      // sign-in starts from a clean budget.
      clearBounceRecord();
      return;
    }
    if (redirected.current) return;

    const decision = decideBounce(readBounceRecord(), Date.now());
    if (!decision.bounce) {
      setLoopDetected(true);
      return;
    }
    writeBounceRecord(decision.next);
    redirected.current = true;
    navigateTo(loginUrl(currentUrl()));
  }, [configured, loading, session]);

  if (!configured) return <NotConfigured />;
  if (loading) return <AuthSplash message="Checking your session…" />;
  if (session) return <>{children}</>;
  if (loopDetected) return <SignInDidNotCarry />;
  return <AuthSplash message="Taking you to sign in…" />;
}

/* ------------------------------------------------------------------ screens */

/**
 * Deliberately plain. This is on screen for a few hundred milliseconds on a
 * normal load, so it must not flash layout or colour.
 */
function AuthSplash({ message }: {message: string;}) {
  return (
    <div className="flex min-h-screen w-full flex-col items-center justify-center gap-5 bg-paper px-6">
      <Logo size={34} />
      <p className="text-sm text-ink-secondary" role="status">
        {message}
      </p>
    </div>);

}

/**
 * Fail closed, not open.
 *
 * If the environment is missing we show this instead of the app. The tempting
 * alternative — let the app through when auth is not configured, so it can be
 * reviewed locally — would mean a single missing environment variable in
 * production silently restores the thing this whole change exists to fix: a
 * product readable by anyone with the URL.
 */
function NotConfigured() {
  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-paper px-6">
      <div className="max-w-prose">
        <Logo size={34} />
        <h1 className="mt-6 font-display text-xl font-semibold text-ink">
          Sign in is not configured
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-ink-secondary">{MISSING_CONFIG_MESSAGE}</p>
        <p className="mt-3 text-sm leading-relaxed text-ink-secondary">
          Until they are set this app cannot tell who you are, so it will not show anything. See{' '}
          <span className="font-mono text-[0.8125rem]">docs/INTEGRATION.md</span> for the full list
          of environment variables.
        </p>
      </div>
    </div>);

}

/**
 * The dead end that replaces the loop. Says what happened in plain words and
 * offers the one action that sometimes fixes it (a fresh login), plus the
 * likeliest real cause, which is blocked cookies.
 */
function SignInDidNotCarry() {
  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-paper px-6">
      <div className="max-w-prose">
        <Logo size={34} />
        <h1 className="mt-6 font-display text-xl font-semibold text-ink">
          We could not carry your sign-in across
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-ink-secondary">
          You signed in on batchlabel.xyz, but this app could not read the session when you
          arrived. Rather than send you back and forth, we have stopped here.
        </p>
        <p className="mt-3 text-sm leading-relaxed text-ink-secondary">
          This is almost always cookies. Batchlabel stores your session in a cookie shared between
          the website and the app, so if your browser or an extension is blocking cookies for
          batchlabel.xyz, the app cannot see that you are signed in.
        </p>
        <a
          href={loginUrl(currentUrl())}
          className="mt-6 inline-flex h-11 items-center justify-center rounded-control bg-teal px-4 text-sm font-medium text-white transition-colors hover:bg-teal-hover">

          Try signing in again
        </a>
      </div>
    </div>);

}
