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
import { isAuthApiError, isAuthRetryableFetchError } from '@supabase/supabase-js';
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
 * A HINT about whether this account is likely to have a password. Never a gate.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * DO NOT USE THIS TO DECIDE WHETHER SOMEONE MAY CHANGE THEIR PASSWORD.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Supabase exposes no "has password" flag, and `identities` is not a stand-in
 * for one. It is wrong in both directions:
 *
 *  - **False negatives.** Setting a password through `updateUser` writes
 *    `encrypted_password` on the user. It does not add an `email` identity. So a
 *    maker who signed up with Google and then used the set-password link below
 *    has a working password and still reports Google only, for ever.
 *  - **False positives.** A magic-link signup creates an `email` identity and
 *    never sets a password.
 *
 * An earlier version of this screen used it as a gate, which permanently
 * stranded the exact people the set-password flow was written for: they set a
 * password, then could never reach the form to change it. The UI now offers both
 * routes whichever way this answers, and uses it only to decide which one to
 * lead with. Getting the hint wrong costs one extra click; gating on it locked
 * people out.
 */
export function hasEmailIdentity(user: User | null): boolean {
  if (!user) return false;
  const identities = user.identities;
  if (!Array.isArray(identities) || identities.length === 0) {
    // Unknown shape (an older token, or something we do not recognise). Lead
    // with the change form, which is the common case.
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

/**
 * Turns a Supabase auth failure into something true.
 *
 * Every failure used to become "That is not your current password." That is a
 * lie whenever the real cause was a dropped connection, a 500, or a rate limit —
 * and it is the worst possible lie, because it tells someone their correct
 * password is wrong. People respond to that by resetting a password that was
 * never broken, or by concluding the account is gone.
 *
 * Only a genuine credential rejection is attributed to the current-password box.
 * The others are transport problems and say so, and deliberately carry no
 * `field`, so nothing is marked invalid and focus is not yanked to a box that is
 * perfectly correct.
 */
export function describeAuthFailure(error: unknown): {error: string; field?: 'current';} {
  // Status 0 / no response. isAuthRetryableFetchError covers both the network
  // being down and a 5xx worth retrying.
  if (isAuthRetryableFetchError(error)) {
    return { error: 'We could not reach Batchlabel. Check your connection and try again.' };
  }

  const status = (error as {status?: number;} | null)?.status;
  const code = (error as {code?: string;} | null)?.code;

  if (status === 429 || code === 'over_request_rate_limit') {
    return { error: 'Too many attempts. Wait a minute, then try again.' };
  }

  // What a wrong password actually looks like: 400 with invalid_credentials.
  if (code === 'invalid_credentials') {
    return { error: 'That is not your current password.', field: 'current' };
  }
  if (isAuthApiError(error) && status === 400 && !code) {
    // Older servers answer 400 with no machine code. On this endpoint, sending
    // a well-formed email and password, that is a rejected password.
    return { error: 'That is not your current password.', field: 'current' };
  }

  if (typeof status === 'number' && status >= 500) {
    return { error: 'Batchlabel had a problem at our end. Please try again in a moment.' };
  }

  return { error: 'We could not check your password just now. Please try again.' };
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
    // Not the raw Supabase message ("Invalid login credentials"), which reads as
    // though the whole session is wrong rather than one box — and not a blanket
    // "wrong password" either, which would be false whenever the real cause was
    // the network or a rate limit.
    return describeAuthFailure(reauth.error);
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
  if (!error) return { error: null };

  // Supabase rate-limits recovery emails harder than anything else here, and
  // "please try again" to someone who is being told to wait is just a loop.
  if (isAuthRetryableFetchError(error)) {
    return { error: 'We could not reach Batchlabel. Check your connection and try again.' };
  }
  if (error.status === 429 || error.code === 'over_email_send_rate_limit') {
    return { error: 'We have sent one recently. Check your inbox, then try again in a few minutes.' };
  }
  return { error: 'We could not send that email just now. Please try again.' };
}
