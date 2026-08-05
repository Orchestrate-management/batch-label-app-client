import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { BOUNCE_STORAGE_KEY } from './auth-redirect';

/**
 * A sign-out that did not take, from the maker's chair.
 *
 * `signOut()` was `Promise<void>` over an `await supabase.auth.signOut()`, and both call sites
 * dropped it with `void`. supabase-js rethrows anything it does not recognise as an AuthError —
 * for this app the reachable case is our own storage adapter, which touches `document.cookie`
 * and calls `decodeURIComponent` on what it finds — so that await was one rejection away from
 * skipping the two lines under it. When it did:
 *
 *   - the browser never left for www;
 *   - `signingOut` stayed true, and because it is folded into `loading`, RequireAuth replaced
 *     THE WHOLE APP with "Checking your session…" and left it there for the life of the tab;
 *   - the maker was still signed in, on a shared computer as easily as their own;
 *   - and nothing anywhere said any of that.
 *
 * So these tests are mounted through the real gate and the real shell rather than against the
 * hook, because the app disappearing is the symptom and only the gate can produce it.
 *
 * The other half of what is under test is that a FAILED CALL AND A SURVIVING SESSION ARE NOT
 * THE SAME THING. supabase-js removes the local session before it returns an error from
 * /logout, so a refused revoke usually does leave the maker signed out here and on www; but a
 * session it could not read or refresh is returned in the same shape with nothing removed. The
 * app asks afterwards rather than reading the tea leaves, and the sentence it says is decided
 * by the answer.
 */

const navigateTo = vi.fn();

const A_SESSION = { user: { id: 'user-1', email: 'maker@example.com' } };

/** What `getSession()` answers once a sign-out has been attempted. */
const STILL_THERE = () => Promise.resolve({ data: { session: A_SESSION }, error: null });
const GONE = () => Promise.resolve({ data: { session: null }, error: null });

interface Options {
  /** What `auth.signOut()` does when the maker clicks. */
  signOut: () => Promise<unknown>;
  /** What `getSession()` answers afterwards. */
  after: () => Promise<unknown>;
}

/**
 * The gate, the shell and the account menu, over a Supabase client that answers to order.
 *
 * Fresh module graph per test: `auth.tsx` captures `supabase` at module scope, so mutating a
 * shared mock afterwards would not reach it.
 */
async function renderShell(options: Options) {
  vi.resetModules();
  let attempted = false;

  const getSession = vi.fn(() =>
  attempted ? options.after() : Promise.resolve({ data: { session: A_SESSION }, error: null })
  );
  const signOut = vi.fn(() => {
    // Set before the promise is returned, so the answer `getSession` gives is the one that
    // applies AFTER the attempt however the attempt ends.
    attempted = true;
    return options.signOut();
  });

  vi.doMock('./supabase', () => ({
    supabase: { auth: {
      getSession,
      onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
      signOut
    } },
    isSupabaseConfigured: true,
    MISSING_CONFIG_MESSAGE: 'Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.'
  }));

  // Keep the real bounce logic and replace only the navigation, because jsdom has none.
  vi.doMock('./auth-redirect', async () => {
    const actual = await vi.importActual<typeof import('./auth-redirect')>('./auth-redirect');
    return { ...actual, navigateTo };
  });

  // The shell draws the business name in the account strip. Not what is under test.
  vi.doMock('./entitlement', () => ({
    useEntitlement: () => ({ loading: false, businessName: 'Willow & Wick', active: true })
  }));

  const { AuthProvider, RequireAuth } = await import('./auth');
  const { AppShell } = await import('../components/AppShell');

  await act(async () => {
    render(
      <AuthProvider>
        <RequireAuth>
          <MemoryRouter>
            <AppShell>
              <p>the product</p>
            </AppShell>
          </MemoryRouter>
        </RequireAuth>
      </AuthProvider>
    );
  });

  return { getSession, signOut };
}

/** Opens the account menu and presses Sign out, as a maker on a laptop does. */
async function pressSignOut() {
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: /Willow & Wick/i }));
  await user.click(await screen.findByRole('menuitem', { name: /sign out/i }));
}

beforeEach(() => {
  navigateTo.mockClear();
  window.sessionStorage.clear();
});

afterEach(() => {
  vi.doUnmock('./supabase');
  vi.doUnmock('./auth-redirect');
  vi.doUnmock('./entitlement');
});

describe('when the sign-out call never comes back', () => {
  /** A rejection out of the storage adapter, which is the reachable one for this app. */
  const rejects = () => Promise.reject(new TypeError('Cannot read document.cookie'));

  it('gives the maker the app back instead of a splash screen that never ends', async () => {
    await renderShell({ signOut: rejects, after: STILL_THERE });

    await pressSignOut();

    // THE ONE THAT MATTERS. Before this fix the rejection skipped everything under the await,
    // `signingOut` stayed true, and this splash was the entire application until the tab was
    // closed — with a maker behind it who was still signed in.
    await waitFor(() =>
    expect(screen.queryByText('Checking your session…')).not.toBeInTheDocument()
    );
    expect(screen.getByText('the product')).toBeInTheDocument();
  });

  it('says they are still signed in, here and on the marketing site', async () => {
    await renderShell({ signOut: rejects, after: STILL_THERE });

    await pressSignOut();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/still signed in/i);
    expect(alert).toHaveTextContent(/batchlabel\.xyz/i);
    // The advice that is actually true on a shared computer, where "try again" is not enough.
    expect(alert).toHaveTextContent(/close the browser/i);
  });

  it('does not hand the browser to www, which would look exactly like signing out', async () => {
    await renderShell({ signOut: rejects, after: STILL_THERE });

    await pressSignOut();

    await screen.findByRole('alert');
    expect(navigateTo).not.toHaveBeenCalled();
  });

  it('lets them try again, and forgets the failure when the next one works', async () => {
    // One client whose answer changes between clicks: the first attempt rejects and leaves the
    // session where it was, the second works.
    let attempts = 0;
    await renderShell({
      signOut: () => {
        attempts += 1;
        return attempts === 1 ?
        Promise.reject(new TypeError('Cannot read document.cookie')) :
        Promise.resolve({ error: null });
      },
      after: () => (attempts === 1 ? STILL_THERE() : GONE())
    });

    await pressSignOut();
    await screen.findByRole('alert');

    await pressSignOut();

    await waitFor(() => expect(navigateTo).toHaveBeenCalledWith('https://www.batchlabel.xyz'));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('when the call comes back with an error', () => {
  const refused = () =>
  Promise.resolve({ error: { name: 'AuthApiError', message: 'nope', status: 500 } });

  it('still leaves for www if the session went with it', async () => {
    // supabase-js calls `_removeSession()` BEFORE returning an error from /logout, so the
    // shared cookie is already gone: the maker IS signed out here and on www, and only the
    // refresh token on the server survived. That is not what this button claimed to end, and
    // keeping them here over it would be its own false statement.
    await renderShell({ signOut: refused, after: GONE });

    await waitFor(() => expect(screen.getByText('the product')).toBeInTheDocument());
    await pressSignOut();

    await waitFor(() => expect(navigateTo).toHaveBeenCalledWith('https://www.batchlabel.xyz'));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('does not, if the session is still sitting there', async () => {
    // The other `{ error }`: the session itself could not be read or refreshed, so nothing was
    // removed. Same shape from supabase-js, opposite answer to "am I signed out?".
    await renderShell({ signOut: refused, after: STILL_THERE });

    await pressSignOut();

    expect(await screen.findByRole('alert')).toHaveTextContent(/still signed in/i);
    expect(navigateTo).not.toHaveBeenCalled();
  });
});

describe('when the app cannot tell either way', () => {
  const clean = () => Promise.resolve({ error: null });

  it('treats an unreadable session as still signed in', async () => {
    // The cookie the sign-out was meant to clear is the cookie this read goes through, so the
    // fault that broke one commonly breaks the other. Not knowing is not being signed out.
    await renderShell({
      signOut: clean,
      after: () => Promise.reject(new URIError('URI malformed'))
    });

    await pressSignOut();

    expect(await screen.findByRole('alert')).toHaveTextContent(/still signed in/i);
    expect(navigateTo).not.toHaveBeenCalled();
  });

  it('treats a session read that errored as still signed in', async () => {
    // getSession() answers `{ session: null, error }` when a refresh fails, and the session is
    // still in the cookie: www, on a working connection, would show them signed in.
    await renderShell({
      signOut: clean,
      after: () => Promise.resolve({ data: { session: null }, error: { message: 'network' } })
    });

    await pressSignOut();

    expect(await screen.findByRole('alert')).toHaveTextContent(/still signed in/i);
    expect(navigateTo).not.toHaveBeenCalled();
  });
});

describe('when the sign-out works', () => {
  it('clears the bounce budget and hands the browser to the marketing site', async () => {
    window.sessionStorage.setItem(BOUNCE_STORAGE_KEY, JSON.stringify({ at: Date.now(), count: 2 }));

    await renderShell({ signOut: () => Promise.resolve({ error: null }), after: GONE });

    await pressSignOut();

    await waitFor(() => expect(navigateTo).toHaveBeenCalledWith('https://www.batchlabel.xyz'));
    // So the sign-in that follows starts from a clean budget rather than an inherited, spent
    // one that refuses to redirect.
    expect(window.sessionStorage.getItem(BOUNCE_STORAGE_KEY)).toBeNull();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
