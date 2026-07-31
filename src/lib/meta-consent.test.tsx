/**
 * The decision half of the gate: does `advertising_opt_in` open it, and does
 * anything else close it?
 *
 * Every case that is not a resolved `true` is asserted separately rather than
 * folded into one "falsy" test, because they are different failures with the
 * same required outcome and a regression would only break one of them.
 *
 * `./meta-pixel` is mocked, so what these tests observe is the instruction sent
 * to the Pixel rather than the Pixel's own behaviour. The two halves are tested
 * apart on purpose: meta-pixel.test.ts proves that being told `false` sends
 * nothing, and this file proves what it gets told.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, waitFor, act } from '@testing-library/react';
import type { User } from '@supabase/supabase-js';

const mocks = vi.hoisted(() => ({
  maybeSingle: vi.fn(),
  setMetaConsent: vi.fn(),
  user: { current: { id: 'user-1' } as User | null }
}));

vi.mock('./supabase', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({ maybeSingle: mocks.maybeSingle }))
      }))
    }))
  }
}));

vi.mock('./meta-pixel', () => ({
  setMetaConsent: mocks.setMetaConsent
}));

vi.mock('./auth', () => ({
  useAuth: () => ({
    user: mocks.user.current,
    session: mocks.user.current ? {} : null,
    loading: false,
    configured: true,
    signOut: vi.fn()
  })
}));

import { MetaTrackingProvider, readAdvertisingConsent, RECHECK_INTERVAL_MS } from './meta-consent';

/** A supabase-js result shape: one of data / error, never both meaningfully. */
function resolves(data: unknown, error: unknown = null) {
  return Promise.resolve({ data, error });
}

beforeEach(() => {
  mocks.maybeSingle.mockReset();
  mocks.setMetaConsent.mockReset();
  mocks.user.current = { id: 'user-1' } as User;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('readAdvertisingConsent', () => {
  it('grants only on a literal true', async () => {
    mocks.maybeSingle.mockReturnValue(resolves({ advertising_opt_in: true }));
    await expect(readAdvertisingConsent()).resolves.toBe('granted');
  });

  it('denies on false', async () => {
    mocks.maybeSingle.mockReturnValue(resolves({ advertising_opt_in: false }));
    await expect(readAdvertisingConsent()).resolves.toBe('denied');
  });

  it('denies on a null column — never answered is not yes', async () => {
    mocks.maybeSingle.mockReturnValue(resolves({ advertising_opt_in: null }));
    await expect(readAdvertisingConsent()).resolves.toBe('denied');
  });

  it.each([1, 'true', 'yes', {}])('denies on a truthy non-boolean (%s)', async (value) => {
    // Postgres returns a real boolean. Anything else means the column is not
    // what we think it is, and a shape we do not recognise is not permission.
    mocks.maybeSingle.mockReturnValue(resolves({ advertising_opt_in: value }));
    await expect(readAdvertisingConsent()).resolves.toBe('denied');
  });

  it('is unknown when the read errored', async () => {
    mocks.maybeSingle.mockReturnValue(resolves(null, { message: 'network', code: '500' }));
    await expect(readAdvertisingConsent()).resolves.toBe('unknown');
  });

  it('is unknown when the column has been renamed under us', async () => {
    // 42703, undefined_column. There is deliberately no fallback to `*` here:
    // the entitlement read has one because a broken plan screen is worse than a
    // guess, and a consent read has no equivalent excuse.
    mocks.maybeSingle.mockReturnValue(resolves(null, { code: '42703' }));
    await expect(readAdvertisingConsent()).resolves.toBe('unknown');
  });

  it('is unknown when there is no membership row yet', async () => {
    mocks.maybeSingle.mockReturnValue(resolves(null));
    await expect(readAdvertisingConsent()).resolves.toBe('unknown');
  });

  it('is unknown when the client throws rather than resolves', async () => {
    mocks.maybeSingle.mockImplementation(() => {
      throw new Error('transport');
    });
    await expect(readAdvertisingConsent()).resolves.toBe('unknown');
  });
});

describe('MetaTrackingProvider', () => {
  const renderProvider = () =>
  render(
    <MetaTrackingProvider>
        <p>product</p>
      </MetaTrackingProvider>
  );

  it('opens the gate for a maker whose account says yes', async () => {
    mocks.maybeSingle.mockReturnValue(resolves({ advertising_opt_in: true }));

    renderProvider();

    await waitFor(() => expect(mocks.setMetaConsent).toHaveBeenCalledWith(true));
  });

  it('never opens it while the read is still in flight', async () => {
    let settle: (value: unknown) => void = () => {};
    mocks.maybeSingle.mockReturnValue(new Promise((resolve) => {settle = resolve;}));

    renderProvider();

    // The whole first-paint window: the gate must be shut, not "not yet decided".
    expect(mocks.setMetaConsent).not.toHaveBeenCalledWith(true);

    await act(async () => {
      settle({ data: { advertising_opt_in: true }, error: null });
    });
    await waitFor(() => expect(mocks.setMetaConsent).toHaveBeenCalledWith(true));
  });

  it.each([
  ['a refusal', { data: { advertising_opt_in: false }, error: null }],
  ['a failed read', { data: null, error: { message: 'boom' } }],
  ['no membership row', { data: null, error: null }]] as
  const)('keeps it shut on %s', async (_label, result) => {
    mocks.maybeSingle.mockReturnValue(Promise.resolve(result));

    renderProvider();

    await waitFor(() => expect(mocks.setMetaConsent).toHaveBeenCalledWith(false));
    expect(mocks.setMetaConsent).not.toHaveBeenCalledWith(true);
  });

  it('closes the gate for a signed-out user without asking anybody', async () => {
    mocks.user.current = null;

    renderProvider();

    await waitFor(() => expect(mocks.setMetaConsent).toHaveBeenCalledWith(false));
    expect(mocks.maybeSingle).not.toHaveBeenCalled();
  });

  it('still renders the product while the gate is shut', async () => {
    mocks.maybeSingle.mockReturnValue(resolves({ advertising_opt_in: false }));

    const { getByText } = renderProvider();

    expect(getByText('product')).toBeInTheDocument();
  });

  it('closes the gate when the app unmounts', async () => {
    mocks.maybeSingle.mockReturnValue(resolves({ advertising_opt_in: true }));
    const view = renderProvider();
    await waitFor(() => expect(mocks.setMetaConsent).toHaveBeenCalledWith(true));

    view.unmount();

    expect(mocks.setMetaConsent).toHaveBeenLastCalledWith(false);
  });
});

describe('withdrawal reaching this tab', () => {
  /**
   * The sequence that has to work: the maker is consented, opens www's cookie
   * settings in another tab, turns advertising off, and comes back. Nothing
   * pushes that change to us, so returning to the app is what has to notice it.
   */
  it('stops tracking when the flag has flipped by the time the tab is refocused', async () => {
    mocks.maybeSingle.
    mockReturnValueOnce(resolves({ advertising_opt_in: true })).
    mockReturnValue(resolves({ advertising_opt_in: false }));
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000_000);

    render(
      <MetaTrackingProvider>
        <p>product</p>
      </MetaTrackingProvider>
    );
    await waitFor(() => expect(mocks.setMetaConsent).toHaveBeenCalledWith(true));

    now.mockReturnValue(1_000_000 + RECHECK_INTERVAL_MS + 1);
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
    });

    await waitFor(() => expect(mocks.setMetaConsent).toHaveBeenLastCalledWith(false));
  });

  it('also stops when the re-read fails — a failed read is not consent', async () => {
    mocks.maybeSingle.
    mockReturnValueOnce(resolves({ advertising_opt_in: true })).
    mockReturnValue(resolves(null, { message: 'offline' }));
    const now = vi.spyOn(Date, 'now').mockReturnValue(2_000_000);

    render(
      <MetaTrackingProvider>
        <p>product</p>
      </MetaTrackingProvider>
    );
    await waitFor(() => expect(mocks.setMetaConsent).toHaveBeenCalledWith(true));

    now.mockReturnValue(2_000_000 + RECHECK_INTERVAL_MS + 1);
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
    });

    await waitFor(() => expect(mocks.setMetaConsent).toHaveBeenLastCalledWith(false));
  });

  it('does not re-read on every flick between windows', async () => {
    mocks.maybeSingle.mockReturnValue(resolves({ advertising_opt_in: true }));
    vi.spyOn(Date, 'now').mockReturnValue(3_000_000);

    render(
      <MetaTrackingProvider>
        <p>product</p>
      </MetaTrackingProvider>
    );
    await waitFor(() => expect(mocks.maybeSingle).toHaveBeenCalledTimes(1));

    await act(async () => {
      window.dispatchEvent(new Event('focus'));
      window.dispatchEvent(new Event('focus'));
      document.dispatchEvent(new Event('visibilitychange'));
    });

    expect(mocks.maybeSingle).toHaveBeenCalledTimes(1);
  });
});
