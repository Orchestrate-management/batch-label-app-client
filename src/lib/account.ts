/**
 * Changing the signed-in maker's password.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS NOT JUST updateUser({ password })
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * `supabase.auth.updateUser({ password })` does not ask for the current
 * password. Anyone holding a live session can therefore silently change it and
 * own the account: a borrowed laptop, an unlocked phone, a stolen session
 * cookie. The person who owns the account finds out when their password stops
 * working.
 *
 * Supabase's own answer is the **Secure password change** option in the email
 * provider settings. It is worth turning on, and it does not close this hole.
 * From supabase-js's own documentation on `reauthenticate()`:
 *
 *   "A user is only required to reauthenticate before updating their password if
 *    Secure password change is enabled AND the user hasn't recently signed in. A
 *    user is deemed recently signed in if the session was created in the last 24
 *    hours."
 *
 * A borrowed laptop is a recent session. A stolen cookie is a live session. Both
 * are inside the 24 hour exemption, which is the case that matters. The setting
 * defends a fourth-day session and nothing else.
 *
 * So this module re-authenticates with the current password first, using
 * `signInWithPassword`, and only calls `updateUser` if that succeeds. Anyone who
 * has the session but not the password is stopped, which is the whole threat.
 * It needs no dashboard change, and it composes with the dashboard setting
 * rather than replacing it — turn that on as well for defence in depth.
 *
 * Two facts that make the probe safe, both verified in @supabase/auth-js 2.111:
 *
 *  - A failed `signInWithPassword` returns the error and leaves the existing
 *    session untouched. It does not sign anyone out, so a typo costs a retry and
 *    nothing else.
 *  - A successful one issues a fresh session through the same shared cookie
 *    adapter, so www and this app stay in step.
 *
 * Brute force is bounded by the same Supabase rate limit that protects the login
 * form on www, because it is literally the same endpoint.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT HAPPENS TO OTHER SESSIONS
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * They are ended. After a successful change we call
 * `signOut({ scope: 'others' })`, which revokes every other session for this
 * user and leaves the current one alone.
 *
 * This is deliberate rather than inherited. Changing a password is what someone
 * does when they think another person has their account, and a password change
 * that leaves the intruder signed in achieves nothing. Doing it explicitly also
 * means the answer to "what happened to my other devices" is a fact this repo
 * decides and tests, not a server default that could change underneath us.
 *
 * The revoke is reported separately from the change itself. If it fails the
 * password has still changed, and telling someone their password change failed
 * when it did not is how they end up locked out of their own account.
 */

import type { User } from '@supabase/supabase-js';
import { supabase } from './supabase';
import { marketingUrl } from './marketing';

/** Matches the hint on www's signup and reset forms. Keep the two in step. */
export const MIN_PASSWORD_LENGTH = 8;

export interface PasswordChangeResult {
  /** Null when the password changed. */
  error: string | null;
  /** Which field the error belongs to, so focus can be moved to it. */
  field?: 'current' | 'next' | 'confirm';
  /**
   * True when the password changed but other sessions could not be revoked. The
   * change still happened; this only softens what we promise about other devices.
   */
  otherSessionsRemain?: boolean;
}

/**
 * Does this account have a password at all?
 *
 * A Google-only maker has one identity, `google`, and no password — there is
 * nothing for them to change and a "current password" box would be a trap.
 *
 * The check is deliberately narrow. An `email` identity means the account *can*
 * carry a password; it does not prove one was ever set, because a magic-link
 * signup also creates an email identity. Supabase exposes no "has password"
 * flag, so that case is handled in the UI instead: the form is shown, the
 * current password does not match, and the reset-by-email route sits directly
 * underneath the error.
 */
export function hasEmailIdentity(user: User | null): boolean {
  if (!user) return false;
  const identities = user.identities;
  if (!Array.isArray(identities) || identities.length === 0) {
    // No identities array at all (an older token, or a shape we do not know).
    // Assume the password form is usable rather than hiding it from someone who
    // needs it — a wrong guess here shows one extra form, the other way round
    // strands them.
    return true;
  }
  return identities.some((identity) => identity.provider === 'email');
}

/** The providers this account can sign in with, for display. Never empty. */
export function signInMethods(user: User | null): string[] {
  const identities = user?.identities;
  if (!Array.isArray(identities) || identities.length === 0) return ['email'];
  return Array.from(new Set(identities.map((identity) => identity.provider)));
}

/** Local checks, run before we touch the network. */
export function validateNewPassword(
next: string,
confirm: string)
: {error: string; field: 'next' | 'confirm';} | null {
  if (next.length < MIN_PASSWORD_LENGTH) {
    return { error: `Please use at least ${MIN_PASSWORD_LENGTH} characters.`, field: 'next' };
  }
  if (next !== confirm) {
    return { error: 'The two new passwords do not match.', field: 'confirm' };
  }
  return null;
}

/**
 * Verifies the current password, then changes it, then ends every other session.
 */
export async function changePassword(input: {
  email: string;
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}): Promise<PasswordChangeResult> {
  const client = supabase;
  if (!client) return { error: 'Sign in is not connected.' };

  if (input.currentPassword.length === 0) {
    return { error: 'Please enter your current password.', field: 'current' };
  }
  const invalid = validateNewPassword(input.newPassword, input.confirmPassword);
  if (invalid) return { error: invalid.error, field: invalid.field };
  if (input.newPassword === input.currentPassword) {
    return { error: 'That is already your password. Choose a different one.', field: 'next' };
  }

  // 1. Prove it is really them. Everything else depends on this line.
  const reauth = await client.auth.signInWithPassword({
    email: input.email,
    password: input.currentPassword
  });
  if (reauth.error) {
    // Deliberately not the raw Supabase message ("Invalid login credentials"),
    // which reads as though the whole session is wrong rather than one box.
    return { error: 'That is not your current password.', field: 'current' };
  }

  // 2. Change it.
  const { error } = await client.auth.updateUser({ password: input.newPassword });
  if (error) return { error: error.message, field: 'next' };

  // 3. End every other session. Reported, not thrown: the password has changed
  //    either way and saying otherwise would be a lie in the dangerous direction.
  const { error: revokeError } = await client.auth.signOut({ scope: 'others' });

  return { error: null, otherSessionsRemain: Boolean(revokeError) };
}

/**
 * Emails a link to set a password, for an account that has none.
 *
 * This is the Google-only maker's only route to a password, and there is no
 * equivalent on www: `/forgot-password` is written for someone who had one and
 * forgot it, and a Google user has no reason to look there.
 *
 * It is the same Supabase call that page makes, and it lands on the same
 * `/reset-password` screen on www — the recovery link must go to the site that
 * owns password screens, and that site's origin is already the Supabase Site URL,
 * so no redirect allow-list entry is needed for it.
 */
export async function sendSetPasswordLink(email: string): Promise<{error: string | null;}> {
  const client = supabase;
  if (!client) return { error: 'Sign in is not connected.' };
  const { error } = await client.auth.resetPasswordForEmail(email, {
    redirectTo: marketingUrl('/reset-password')
  });
  return { error: error ? 'We could not send that email. Please try again.' : null };
}
