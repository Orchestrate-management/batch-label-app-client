import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import { BOUNCE_STORAGE_KEY, MAX_BOUNCES_PER_WINDOW } from './auth-redirect';

/**
 * The gate, end to end in jsdom.
 *
 * Two failures matter here and neither shows up in a type check. Redirecting
 * before the session has resolved throws a maker who just signed up straight
 * back to the login page they came from. Redirecting more than once turns a
 * failed handoff into a ping-pong between two origins that the user cannot
 * escape without closing the tab.
 */

const navigateTo = vi.fn();

interface Options {
  /** Session to hand back, or null. */
  session: unknown;
  /** Leave getSession pending, to test the "still resolving" state. */
  pending?: boolean;
  configured?: boolean;
}

/**
 * Fresh module graph per test so the Supabase client can differ. `auth.tsx`
 * captures its imports at module scope, so mutating a shared mock afterwards
 * would not reach it.
 */
async function renderGate(options: Options) {
  vi.resetModules();

  const getSession = vi.fn(() =>
  options.pending ?
  new Promise(() => {}) :
  Promise.resolve({ data: { session: options.session } })
  );

  const client = {
    auth: {
      getSession,
      onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
      signOut: vi.fn(() => Promise.resolve({ error: null }))
    }
  };

  const configured = options.configured ?? true;

  vi.doMock('./supabase', () => ({
    supabase: configured ? client : null,
    isSupabaseConfigured: configured,
    MISSING_CONFIG_MESSAGE: 'Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.'
  }));

  // Keep the real bounce logic — it is what is under test — and replace only the
  // navigation, because jsdom has none.
  vi.doMock('./auth-redirect', async () => {
    const actual = await vi.importActual<typeof import('./auth-redirect')>('./auth-redirect');
    return { ...actual, navigateTo };
  });

  const { AuthProvider, RequireAuth } = await import('./auth');

  const tree =
  <AuthProvider>
      <RequireAuth>
        <p>the product</p>
      </RequireAuth>
    </AuthProvider>;


  // getSession resolves on a microtask, so the state update that follows it lands
  // outside React's batching unless the render is awaited inside act().
  let result!: ReturnType<typeof render>;
  await act(async () => {
    result = render(tree);
  });
  return { ...result, client, tree };
}

const A_SESSION = { user: { id: 'user-1', email: 'maker@example.com' } };

beforeEach(() => {
  navigateTo.mockClear();
  window.sessionStorage.clear();
});

afterEach(() => {
  vi.doUnmock('./supabase');
  vi.doUnmock('./auth-redirect');
});

describe('while the session is still resolving', () => {
  it('waits instead of bouncing', async () => {
    await renderGate({ session: null, pending: true });

    expect(await screen.findByText('Checking your session…')).toBeInTheDocument();
    expect(screen.queryByText('the product')).not.toBeInTheDocument();

    // The one that matters. A maker arriving straight from signup on www has a
    // valid cookie, but reading it is asynchronous — bouncing here would send
    // them back to the login page they just used.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(navigateTo).not.toHaveBeenCalled();
  });
});

describe('with a session', () => {
  it('renders the app and never navigates away', async () => {
    await renderGate({ session: A_SESSION });

    expect(await screen.findByText('the product')).toBeInTheDocument();
    expect(navigateTo).not.toHaveBeenCalled();
  });

  it('forgets earlier failed attempts', async () => {
    // So a later sign-out and sign-in starts from a clean budget rather than
    // inheriting a spent one and refusing to redirect.
    window.sessionStorage.setItem(
      BOUNCE_STORAGE_KEY,
      JSON.stringify({ at: Date.now(), count: MAX_BOUNCES_PER_WINDOW })
    );

    await renderGate({ session: A_SESSION });

    await screen.findByText('the product');
    expect(window.sessionStorage.getItem(BOUNCE_STORAGE_KEY)).toBeNull();
  });
});

describe('with no session', () => {
  it('sends the visitor to the marketing login carrying where they were', async () => {
    await renderGate({ session: null });

    await waitFor(() => expect(navigateTo).toHaveBeenCalled());

    const target = new URL(navigateTo.mock.calls[0][0] as string);
    expect(target.origin).toBe('https://www.batchlabel.xyz');
    expect(target.pathname).toBe('/log-in');
    expect(target.searchParams.get('next')).toBe(window.location.href);
    // Encoded, not raw — a raw next breaks the moment the page has a query string.
    expect(navigateTo.mock.calls[0][0]).toContain('next=https%3A%2F%2Fapp.batchlabel.xyz');
  });

  it('never renders the product', async () => {
    await renderGate({ session: null });

    await waitFor(() => expect(navigateTo).toHaveBeenCalled());
    expect(screen.queryByText('the product')).not.toBeInTheDocument();
  });

  it('redirects once, however many times React re-renders', async () => {
    const { rerender, tree } = await renderGate({ session: null });

    await waitFor(() => expect(navigateTo).toHaveBeenCalledTimes(1));

    await act(async () => {
      rerender(tree);
      rerender(tree);
    });

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(navigateTo).toHaveBeenCalledTimes(1);
  });

  it('records the attempt so a loop can be detected across page loads', async () => {
    await renderGate({ session: null });

    await waitFor(() => expect(navigateTo).toHaveBeenCalled());
    expect(JSON.parse(window.sessionStorage.getItem(BOUNCE_STORAGE_KEY) ?? '{}')).toMatchObject({
      count: 1
    });
  });
});

describe('when the session will not carry', () => {
  it('stops bouncing and explains, rather than looping forever', async () => {
    // Simulates arriving back from www for the third time in half a minute with
    // still no session: blocked cookies, or the two copies of session-storage.ts
    // disagreeing about the cookie domain.
    window.sessionStorage.setItem(
      BOUNCE_STORAGE_KEY,
      JSON.stringify({ at: Date.now(), count: MAX_BOUNCES_PER_WINDOW })
    );

    await renderGate({ session: null });

    expect(await screen.findByText(/could not carry your sign-in/i)).toBeInTheDocument();
    expect(navigateTo).not.toHaveBeenCalled();
    expect(screen.queryByText('the product')).not.toBeInTheDocument();
  });

  it('still offers a way back in', async () => {
    window.sessionStorage.setItem(
      BOUNCE_STORAGE_KEY,
      JSON.stringify({ at: Date.now(), count: MAX_BOUNCES_PER_WINDOW })
    );

    await renderGate({ session: null });

    const link = await screen.findByRole('link', { name: /try signing in again/i });
    expect(link).toHaveAttribute('href', expect.stringContaining('/log-in?next='));
  });
});

describe('when Supabase is not configured', () => {
  it('refuses to render the app rather than falling open', async () => {
    // Failing open here would mean one missing environment variable in
    // production silently makes the whole product public again.
    await renderGate({ session: null, configured: false });

    expect(await screen.findByText(/sign in is not configured/i)).toBeInTheDocument();
    expect(screen.queryByText('the product')).not.toBeInTheDocument();
    expect(navigateTo).not.toHaveBeenCalled();
  });
});
