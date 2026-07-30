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

interface AuthContextValue {
  session: Session | null;
  user: User | null;
  /** True until the first getSession() resolves. Nothing may redirect while true. */
  loading: boolean;
  /** False when the Supabase env vars are absent. The app refuses to render. */
  configured: boolean;
  signOut: () => Promise<void>;
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

  const signOut = useCallback(async () => {
    setSigningOut(true);
    // signOut() goes through the same storage adapter, so it clears the shared
    // cookie (and every numbered chunk of it) on `.batchlabel.xyz`. The user is
    // signed out of www as well, which is the correct reading of "sign out".
    if (supabase) await supabase.auth.signOut();
    clearBounceRecord();
    navigateTo(HOME_URL);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      user: session?.user ?? null,
      loading: loading || signingOut,
      configured: isSupabaseConfigured,
      signOut
    }),
    [session, loading, signingOut, signOut]
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
