import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The password change guard.
 *
 * The one behaviour worth defending with tests is the order of operations:
 * nothing may reach `updateUser` until `signInWithPassword` has succeeded with
 * the current password. `updateUser({ password })` does not ask for the current
 * password itself, so if that check is ever removed or reordered, a live session
 * alone is enough to take the account and no type check would notice.
 */

const signInWithPassword = vi.fn();
const updateUser = vi.fn();
const signOut = vi.fn();
const resetPasswordForEmail = vi.fn();

/** Records the order calls arrive in, which is the actual invariant. */
let calls: string[] = [];

async function loadAccount(configured = true) {
  vi.resetModules();
  vi.doMock('./supabase', () => ({
    supabase: configured ?
    {
      auth: {
        signInWithPassword: (...args: unknown[]) => {
          calls.push('signInWithPassword');
          return signInWithPassword(...args);
        },
        updateUser: (...args: unknown[]) => {
          calls.push('updateUser');
          return updateUser(...args);
        },
        signOut: (...args: unknown[]) => {
          calls.push('signOut');
          return signOut(...args);
        },
        resetPasswordForEmail: (...args: unknown[]) => {
          calls.push('resetPasswordForEmail');
          return resetPasswordForEmail(...args);
        }
      }
    } :
    null,
    isSupabaseConfigured: configured,
    MISSING_CONFIG_MESSAGE: 'not configured'
  }));
  return import('./account');
}

const good = {
  email: 'maker@example.com',
  currentPassword: 'the-old-one',
  newPassword: 'a-brand-new-passphrase',
  confirmPassword: 'a-brand-new-passphrase'
};

beforeEach(() => {
  calls = [];
  signInWithPassword.mockReset().mockResolvedValue({ data: {}, error: null });
  updateUser.mockReset().mockResolvedValue({ data: {}, error: null });
  signOut.mockReset().mockResolvedValue({ error: null });
  resetPasswordForEmail.mockReset().mockResolvedValue({ data: {}, error: null });
});

describe('changePassword', () => {
  it('verifies the current password before changing it, then ends other sessions', async () => {
    const { changePassword } = await loadAccount();

    const result = await changePassword(good);

    expect(result).toEqual({ error: null, otherSessionsRemain: false });
    expect(calls).toEqual(['signInWithPassword', 'updateUser', 'signOut']);
    expect(signInWithPassword).toHaveBeenCalledWith({
      email: good.email,
      password: good.currentPassword
    });
    expect(updateUser).toHaveBeenCalledWith({ password: good.newPassword });
    // 'others', never 'global': signing the maker out of the browser they are
    // standing in front of is not what they asked for.
    expect(signOut).toHaveBeenCalledWith({ scope: 'others' });
  });

  it('does not change anything when the current password is wrong', async () => {
    signInWithPassword.mockResolvedValue({
      data: {},
      error: { message: 'Invalid login credentials', status: 400, code: 'invalid_credentials' }
    });
    const { changePassword } = await loadAccount();

    const result = await changePassword(good);

    expect(result.error).toBe('That is not your current password.');
    expect(result.field).toBe('current');
    // The whole point. A live session that cannot produce the password changes nothing.
    expect(updateUser).not.toHaveBeenCalled();
    expect(signOut).not.toHaveBeenCalled();
  });

  /**
   * Every re-auth failure used to be reported as "That is not your current
   * password", which tells someone their correct password is wrong whenever the
   * real cause was the network or a rate limit. People respond to that by
   * resetting a password that was never broken.
   *
   * A transport failure must also stop the change — it proves nothing about who
   * is asking — but it must not blame the field, so no `field` is returned and
   * nothing gets marked invalid.
   */
  describe('a failure that is not a wrong password', () => {
    const cases: Array<[string, unknown, RegExp]> = [
    [
    'a dropped connection',
    Object.assign(new Error('Failed to fetch'), {
      __isAuthError: true,
      name: 'AuthRetryableFetchError',
      status: 0
    }),
    /could not reach batchlabel/i],

    ['a rate limit', { message: 'rate limited', status: 429 }, /too many attempts/i],
    [
    'a rate limit reported by code',
    { message: 'rate limited', code: 'over_request_rate_limit' },
    /too many attempts/i],

    ['a server error', { message: 'boom', status: 503 }, /problem at our end/i],
    ['something unrecognised', { message: '???' }, /could not check your password/i]];


    for (const [label, error, expected] of cases) {
      it(`does not blame the password for ${label}`, async () => {
        signInWithPassword.mockResolvedValue({ data: {}, error });
        const { changePassword } = await loadAccount();

        const result = await changePassword(good);

        expect(result.error).toMatch(expected);
        expect(result.error).not.toMatch(/not your current password/i);
        // No field, so nothing is marked aria-invalid and focus is not yanked
        // to a box that is perfectly correct.
        expect(result.field).toBeUndefined();
        // Still refuses to change anything: a failed check is not a passed one.
        expect(updateUser).not.toHaveBeenCalled();
      });
    }
  });

  it('never reaches the network when the new password is too short', async () => {
    const { changePassword } = await loadAccount();

    const result = await changePassword({
      ...good,
      newPassword: 'short',
      confirmPassword: 'short'
    });

    expect(result.field).toBe('next');
    expect(calls).toEqual([]);
  });

  it('rejects a mismatched confirmation', async () => {
    const { changePassword } = await loadAccount();

    const result = await changePassword({ ...good, confirmPassword: 'something-else-entirely' });

    expect(result.error).toBe('The two new passwords do not match.');
    expect(result.field).toBe('confirm');
    expect(calls).toEqual([]);
  });

  it('rejects an empty current password without asking Supabase', async () => {
    const { changePassword } = await loadAccount();

    const result = await changePassword({ ...good, currentPassword: '' });

    expect(result.field).toBe('current');
    expect(calls).toEqual([]);
  });

  it('refuses a new password identical to the old one', async () => {
    const { changePassword } = await loadAccount();

    const result = await changePassword({
      ...good,
      newPassword: good.currentPassword,
      confirmPassword: good.currentPassword
    });

    expect(result.field).toBe('next');
    expect(calls).toEqual([]);
  });

  it('reports a failed revoke without claiming the change failed', async () => {
    signOut.mockResolvedValue({ error: { message: 'network' } });
    const { changePassword } = await loadAccount();

    const result = await changePassword(good);

    // The password DID change. Saying otherwise would send someone back to a
    // password that no longer works.
    expect(result.error).toBeNull();
    expect(result.otherSessionsRemain).toBe(true);
  });

  it('surfaces an updateUser failure against the new password field', async () => {
    updateUser.mockResolvedValue({ data: {}, error: { message: 'Password is too weak' } });
    const { changePassword } = await loadAccount();

    const result = await changePassword(good);

    expect(result.error).toBe('Password is too weak');
    expect(result.field).toBe('next');
    expect(signOut).not.toHaveBeenCalled();
  });

  it('does nothing at all when Supabase is not configured', async () => {
    const { changePassword } = await loadAccount(false);

    const result = await changePassword(good);

    expect(result.error).toBe('Sign in is not connected.');
    expect(calls).toEqual([]);
  });
});

describe('hasEmailIdentity', () => {
  const user = (identities: unknown) =>
  ({ id: 'u1', identities } as unknown as Parameters<
    typeof import('./account').hasEmailIdentity>[
    0]);

  it('is false for a Google-only account, so the set-password card leads', async () => {
    const { hasEmailIdentity } = await loadAccount();
    expect(hasEmailIdentity(user([{ provider: 'google' }]))).toBe(false);
  });

  it('is true when an email identity exists', async () => {
    const { hasEmailIdentity } = await loadAccount();
    expect(hasEmailIdentity(user([{ provider: 'google' }, { provider: 'email' }]))).toBe(true);
  });

  it('is false with no user', async () => {
    const { hasEmailIdentity } = await loadAccount();
    expect(hasEmailIdentity(null)).toBe(false);
  });

  it('falls back to true on an unknown shape rather than hiding the form', async () => {
    const { hasEmailIdentity } = await loadAccount();
    expect(hasEmailIdentity(user(undefined))).toBe(true);
    expect(hasEmailIdentity(user([]))).toBe(true);
  });
});

describe('signInMethods', () => {
  it('de-duplicates providers and never returns an empty list', async () => {
    const { signInMethods } = await loadAccount();
    const user = (identities: unknown) =>
    ({ id: 'u1', identities } as unknown as Parameters<
      typeof import('./account').signInMethods>[
      0]);

    expect(signInMethods(user([{ provider: 'google' }, { provider: 'google' }]))).toEqual([
    'google']
    );
    expect(signInMethods(null)).toEqual(['email']);
  });
});

describe('sendSetPasswordLink', () => {
  it('points the recovery link at the marketing site, which owns password screens', async () => {
    const { sendSetPasswordLink } = await loadAccount();

    const result = await sendSetPasswordLink('maker@example.com');

    expect(result.error).toBeNull();
    expect(resetPasswordForEmail).toHaveBeenCalledWith('maker@example.com', {
      redirectTo: 'https://www.batchlabel.xyz/reset-password'
    });
  });

  it('does not leak the raw Supabase error', async () => {
    resetPasswordForEmail.mockResolvedValue({ data: {}, error: { message: 'boom' } });
    const { sendSetPasswordLink } = await loadAccount();

    const result = await sendSetPasswordLink('maker@example.com');

    expect(result.error).toBe('We could not send that email just now. Please try again.');
  });

  /**
   * Supabase rate-limits recovery email harder than anything else here. Telling
   * someone who is being asked to wait to "try again" is a loop they cannot
   * escape, so this case gets its own sentence with the actual instruction.
   */
  it('tells someone being rate limited to wait, not to retry', async () => {
    resetPasswordForEmail.mockResolvedValue({
      data: {},
      error: { message: 'rate limited', status: 429 }
    });
    const { sendSetPasswordLink } = await loadAccount();

    const result = await sendSetPasswordLink('maker@example.com');

    expect(result.error).toMatch(/try again in a few minutes/i);
    expect(result.error).not.toMatch(/^We could not send that email just now/);
  });

  it('names a connection problem as a connection problem', async () => {
    resetPasswordForEmail.mockResolvedValue({
      data: {},
      error: Object.assign(new Error('Failed to fetch'), {
        __isAuthError: true,
        name: 'AuthRetryableFetchError',
        status: 0
      })
    });
    const { sendSetPasswordLink } = await loadAccount();

    expect((await sendSetPasswordLink('maker@example.com')).error).toMatch(
      /could not reach batchlabel/i
    );
  });
});
