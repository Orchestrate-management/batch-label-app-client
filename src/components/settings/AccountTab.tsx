import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ExternalLinkIcon } from 'lucide-react';
import {
  Button,
  Callout,
  Card,
  Checkbox,
  FormError,
  FormStatus,
  Input,
  Pill,
  RequiredKey,
  RequiredMark,
  SectionTitle } from
'../ui/Primitives';
import { useCan } from '../../lib/active-account';
import { useAuth } from '../../lib/auth';
import { useEntitlement } from '../../lib/entitlement';
import {
  changeEmail,
  changePassword,
  hasEmailIdentity,
  MIN_PASSWORD_LENGTH,
  pendingEmailChange,
  sendSetPasswordLink,
  signInMethods,
  signOutEverywhere } from
'../../lib/account';
import { useSettings } from '../../lib/settings-store';
import type { DataRequestKind } from '../../lib/settings-data';
import {
  fetchConsentPreferences,
  updateConsentPreference,
  type ConsentPreferences } from
'../../lib/consent-preferences';
import { ADVERTISING_AGREEMENT, MARKETING_EMAIL_AGREEMENT } from '../../lib/agreements';
import {
  COOKIE_SETTINGS_URL,
  FORGOT_PASSWORD_URL,
  PRIVACY_URL,
  TERMS_URL } from
'../../lib/marketing';

/**
 * Everything about the person rather than the product.
 *
 * Three things live here and nowhere else in this app: the password, the
 * marketing email opt-in, and a truthful account of what is changed elsewhere.
 * The last one is not padding. A maker who signed up on www and then only ever
 * opens the product had no way of finding any of this, and "it is on the other
 * site" is only useful if something says so.
 */
export function AccountTab() {
  return (
    <>
      <IdentitySection />
      <PasswordSection />
      <ConsentSection />
      <DataSection />
    </>);

}

function ExternalLink({ href, children }: {href: string;children: React.ReactNode;}) {
  return (
    <a
      href={href}
      className="inline-flex h-9 items-center gap-2 rounded-control border border-paper-line bg-paper px-3 text-[0.8125rem] font-medium text-ink transition-colors hover:bg-paper-panel">

      {children}
      <ExternalLinkIcon className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />
    </a>);

}

/* -------------------------------------------------------------- identity */

const PROVIDER_LABELS: Record<string, string> = {
  email: 'Email and password',
  google: 'Google'
};

function IdentitySection() {
  const { user } = useAuth();
  const entitlement = useEntitlement();
  const methods = signInMethods(user);

  return (
    <section aria-labelledby="account-heading">
      <SectionTitle className="mb-1">
        <span id="account-heading">Your account</span>
      </SectionTitle>
      <p className="mb-3 max-w-prose text-2xs leading-relaxed text-ink-tertiary">
        Who you are signed in as. Your email address is also how you sign in.
      </p>
      <Card className="px-5 py-5">
        <dl className="grid gap-5 md:grid-cols-2">
          <div>
            <dt className="text-[0.8125rem] font-medium text-ink-secondary">Email</dt>
            <dd className="mt-1 break-words text-sm text-ink">{user?.email ?? 'Not signed in'}</dd>
          </div>
          <div>
            <dt className="text-[0.8125rem] font-medium text-ink-secondary">Business name</dt>
            <dd className="mt-1 text-sm text-ink">
              {entitlement.loading ?
              'Checking…' :
              entitlement.businessName ?? 'Not set yet'}
            </dd>
          </div>
          <div className="md:col-span-2">
            <dt className="text-[0.8125rem] font-medium text-ink-secondary">You sign in with</dt>
            <dd className="mt-1.5 flex flex-wrap gap-1.5">
              {methods.map((method) =>
              <Pill key={method} tone="neutral">
                  {PROVIDER_LABELS[method] ?? method}
                </Pill>
              )}
            </dd>
          </div>
        </dl>

        <ChangeEmailForm />

        <p className="mt-5 max-w-prose text-[0.8125rem] leading-relaxed text-ink-secondary">
          Your business name here is the one on your plan. The name that PRINTS on a label is
          the registered and trading name on the Identity tab, and they are deliberately
          separate fields — one is who we bill, the other is what a regulator reads.
        </p>
      </Card>
    </section>);

}

/**
 * Changing the sign-in address.
 *
 * IT NEVER SAYS THE ADDRESS CHANGED, because at the point this form returns it has not. Supabase
 * accepts the request, sends a confirmation, and moves the address only when the link is
 * clicked — so the confirmation here is about an email being sent, and the pending address is
 * read back off the session user (`new_email`) rather than remembered from the form. That is
 * the difference between a screen reporting what it did and a screen reporting what it hopes.
 *
 * The pending banner therefore survives a reload, and disappears by itself when the change
 * completes, because both facts come from the auth server.
 */
function ChangeEmailForm() {
  const { user } = useAuth();
  const current = user?.email ?? null;
  const pending = pendingEmailChange(user);

  const [next, setNext] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setSentTo(null);

    const result = await changeEmail({ currentEmail: current, nextEmail: next });
    setBusy(false);

    if (result.error) {
      setError(result.error);
      return;
    }
    setNext('');
    setSentTo(result.pending ?? null);
  };

  return (
    <form onSubmit={handleSubmit} noValidate className="mt-5 max-w-md space-y-3">
      {pending &&
      <Callout title="A change is waiting to be confirmed">
          <p className="max-w-prose leading-relaxed">
            We are holding a request to move this account to {pending}. You still sign in with{' '}
            {current ?? 'your current address'} until the confirmation links have been clicked.
          </p>
        </Callout>
      }

      <div>
        <label
          htmlFor="new-email"
          className="mb-1.5 block text-[0.8125rem] font-medium text-ink-secondary">

          Change your email address
        </label>
        <Input
          id="new-email"
          type="email"
          autoComplete="email"
          placeholder="you@yourbusiness.co.uk"
          aria-describedby="new-email-hint"
          value={next}
          onChange={(event) => setNext(event.target.value)} />

        <p id="new-email-hint" className="mt-1.5 text-2xs leading-relaxed text-ink-tertiary">
          This is also how you sign in, here and on batchlabel.xyz.
        </p>
      </div>

      {error && <FormError>{error}</FormError>}
      {sentTo &&
      <Callout role="status" title="Confirmation sent">
          <p className="max-w-prose leading-relaxed">
            We have emailed {sentTo}. Nothing has changed yet — your address moves when every
            link we sent has been clicked, so check your current inbox as well, since a change
            may need confirming from there too.
          </p>
        </Callout>
      }

      <Button type="submit" variant="secondary" disabled={busy || next.trim() === ''}>
        {busy ? 'Sending…' : 'Send a confirmation link'}
      </Button>
    </form>);

}

/* -------------------------------------------------------------- password */

/**
 * Both password routes, always both reachable.
 *
 * The identity list only decides which one leads. It cannot decide which one a
 * maker is *allowed* — Supabase has no "has password" flag, and `identities`
 * answers wrongly in both directions (see lib/account.ts). An earlier version
 * used it as a gate and permanently stranded the very people the set-password
 * link exists for: they set a password through it, and were then shown the
 * "you have no password" card for ever, with no way to reach the change form.
 *
 * So the other route is always one click away, and neither piece of copy claims
 * as fact something we cannot know.
 */
function PasswordSection() {
  const { user } = useAuth();
  const email = user?.email ?? null;
  const leadsWithChange = hasEmailIdentity(user);
  const [showing, setShowing] = useState<'change' | 'set'>(
    leadsWithChange ? 'change' : 'set'
  );

  return (
    <section aria-labelledby="password-heading">
      <SectionTitle className="mb-1">
        <span id="password-heading">Password</span>
      </SectionTitle>
      <p className="mb-3 max-w-prose text-2xs leading-relaxed text-ink-tertiary">
        {showing === 'change' ?
        'Changing your password signs you out everywhere else.' :
        'Signing in with Google does not create a password. You can add one.'}
      </p>

      {showing === 'change' ?
      <ChangePasswordForm
        email={email}
        onNoPassword={() => setShowing('set')} /> :

      <SetPasswordCard email={email} onHasPassword={() => setShowing('change')} />
      }
    </section>);

}

/**
 * The change form.
 *
 * The current password is required, and it is checked against Supabase before
 * anything changes. `updateUser({ password })` on its own does not ask for it,
 * which means a live session is enough to take an account — see lib/account.ts
 * for why the Supabase dashboard setting does not cover that case either.
 */
function ChangePasswordForm({
  email,
  onNoPassword


}: {email: string | null;onNoPassword: () => void;}) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorField, setErrorField] = useState<'current' | 'next' | 'confirm' | null>(null);
  const [done, setDone] = useState<{othersRemain: boolean;} | null>(null);

  const currentRef = useRef<HTMLInputElement>(null);
  const nextRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLInputElement>(null);

  // Move focus to the box that is wrong, so the reason is announced and the fix
  // is one keystroke away rather than a hunt back up the form.
  useEffect(() => {
    if (!errorField) return;
    const target =
    errorField === 'current' ? currentRef : errorField === 'next' ? nextRef : confirmRef;
    target.current?.focus();
  }, [errorField, error]);

  if (!email) {
    return (
      <Card className="px-5 py-5">
        <p className="max-w-prose text-[0.8125rem] leading-relaxed text-ink-secondary">
          We cannot read your email address, so we cannot change your password here. Reload the
          page, and get in touch if it keeps happening.
        </p>
      </Card>);

  }

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setErrorField(null);
    setDone(null);

    const result = await changePassword({
      email,
      currentPassword: current,
      newPassword: next,
      confirmPassword: confirm
    });

    setBusy(false);
    if (result.error) {
      setError(result.error);
      setErrorField(result.field ?? null);
      return;
    }
    setCurrent('');
    setNext('');
    setConfirm('');
    setDone({ othersRemain: Boolean(result.otherSessionsRemain) });
  };

  return (
    <Card className="px-5 py-5">
      <form onSubmit={handleSubmit} className="max-w-md space-y-5" noValidate>
        <RequiredKey />

        <PasswordField
          ref={currentRef}
          id="current-password"
          label="Current password"
          autoComplete="current-password"
          value={current}
          onChange={setCurrent}
          invalid={errorField === 'current'}
          errorId={errorField === 'current' ? 'password-error' : undefined} />

        <PasswordField
          ref={nextRef}
          id="new-password"
          label="New password"
          autoComplete="new-password"
          value={next}
          onChange={setNext}
          hint={`At least ${MIN_PASSWORD_LENGTH} characters. A short phrase works well.`}
          invalid={errorField === 'next'}
          errorId={errorField === 'next' ? 'password-error' : undefined} />

        <PasswordField
          ref={confirmRef}
          id="confirm-password"
          label="Confirm new password"
          autoComplete="new-password"
          value={confirm}
          onChange={setConfirm}
          invalid={errorField === 'confirm'}
          errorId={errorField === 'confirm' ? 'password-error' : undefined} />

        {error && <FormError id="password-error">{error}</FormError>}

        {/*
          role="status" so success is announced, not only shown. A confirmation
          a screen reader never hears is a form that appears to have done
          nothing — and this is the one message where "did that work?" matters
          most, because the answer decides whether someone tries again.
         */}
        {done &&
        <Callout role="status" title="Password changed">
            {done.othersRemain ?
          'You are still signed in here. We could not sign out your other devices, so sign out and back in on any device you are worried about.' :
          'You are still signed in here. Every other browser and device has been signed out.'}
          </Callout>
        }

        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" variant="primary" disabled={busy}>
            {busy ? 'Changing…' : 'Change password'}
          </Button>
          <a
            href={FORGOT_PASSWORD_URL}
            className="text-[0.8125rem] text-ink-secondary underline decoration-ink-tertiary/40 underline-offset-4 hover:text-ink">

            Do not know your current password?
          </a>
        </div>

        <p className="max-w-prose text-2xs leading-relaxed text-ink-tertiary">
          Signed in with Google and never set a password?{' '}
          <button
            type="button"
            onClick={onNoPassword}
            className="underline decoration-ink-tertiary/40 underline-offset-4 hover:text-ink-secondary">

            Add one instead
          </button>
          .
        </p>

        <p className="max-w-prose text-2xs leading-relaxed text-ink-tertiary">
          We ask for your current password because a signed-in browser is not proof it is you.
          Without it, anyone who picked up your laptop could change your password and lock you out.
        </p>
      </form>
    </Card>);

}

interface PasswordFieldProps {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: string;
  hint?: string;
  invalid?: boolean;
  errorId?: string;
}

/**
 * Every password box on this screen. Hand-rolled rather than using `Field`
 * because it has to wire aria-describedby to both the hint and the error, and
 * `Field` takes arbitrary children and so cannot reach the input to do it.
 */
const PasswordField = React.forwardRef<HTMLInputElement, PasswordFieldProps>(
  function PasswordField(
  { id, label, value, onChange, autoComplete, hint, invalid, errorId },
  ref)
  {
    const hintId = hint ? `${id}-hint` : undefined;
    const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;
    return (
      <div>
        <label htmlFor={id} className="mb-1.5 block text-[0.8125rem] font-medium text-ink-secondary">
          {label}
          <RequiredMark />
        </label>
        <Input
          ref={ref}
          id={id}
          type="password"
          required
          aria-required="true"
          aria-invalid={invalid ? true : undefined}
          aria-describedby={describedBy}
          autoComplete={autoComplete}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className={invalid ? 'border-clay' : undefined} />

        {hint &&
        <p id={hintId} className="mt-1.5 text-2xs text-ink-tertiary">
            {hint}
          </p>
        }
      </div>);

  }
);

/**
 * Adding a password to an account that signs in with Google.
 *
 * The button stays mounted after a send. Replacing it with its own confirmation
 * threw keyboard focus to the body and left no way to ask again — and asking
 * again is the single most likely next action, because the usual reason to come
 * back to this card is that the first email did not arrive.
 */
function SetPasswordCard({
  email,
  onHasPassword


}: {email: string | null;onHasPassword: () => void;}) {
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSend = async () => {
    if (!email) return;
    setBusy(true);
    setError(null);
    const result = await sendSetPasswordLink(email);
    setBusy(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    setSent(true);
  };

  return (
    <Card className="px-5 py-5">
      <p className="max-w-prose text-[0.8125rem] leading-relaxed text-ink-secondary">
        Signing in with Google does not create a password, so you may not have one. Adding one
        gives you a second way in if you ever lose access to your Google account. We will email
        you a link to set it.
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button variant="secondary" disabled={busy || !email} onClick={handleSend}>
          {busy ? 'Sending…' : sent ? 'Send another link' : 'Email me a link to set a password'}
        </Button>
        {sent &&
        <FormStatus>
            If we can reach {email}, a link is on its way. It is valid for one hour.
          </FormStatus>
        }
      </div>
      {error && <div className="mt-3"><FormError>{error}</FormError></div>}
      <p className="mt-4 max-w-prose text-2xs leading-relaxed text-ink-tertiary">
        Adding a password does not remove Google. You will be able to use either.{' '}
        <button
          type="button"
          onClick={onHasPassword}
          className="underline decoration-ink-tertiary/40 underline-offset-4 hover:text-ink-secondary">

          Already have a password?
        </button>
      </p>
    </Card>);

}

/* --------------------------------------------------------------- consent */

/**
 * The two marketing permissions.
 *
 * Marketing email is a real box, because it is the one consent this app is
 * allowed to change. It goes through the `set_consent()` function, the same call
 * www makes, so the flag, the snapshot and the append-only audit row move
 * together with a server-stamped time.
 *
 * Advertising is not a box, here or in www's account area. It is the cookie
 * banner's marketing toggle and it is changed there and only there — a second
 * control writing the same flag is how the two records disagreed in the first
 * place. This app cannot even read the banner's stored choice: it lives in
 * localStorage and a host-only cookie on www.batchlabel.xyz. What is shown is
 * the account record, which the banner keeps in step whenever a signed-in maker
 * changes their mind.
 */
function ConsentSection() {
  const [loading, setLoading] = useState(true);
  const [prefs, setPrefs] = useState<ConsentPreferences | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetchConsentPreferences().then((result) => {
      if (!active) return;
      setPrefs(result);
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, []);

  const toggleMarketingEmail = async (nextValue: boolean) => {
    if (!prefs || saving) return;
    const previous = prefs.marketingEmail;
    setError(null);
    setSaving(true);
    setPrefs({ ...prefs, marketingEmail: nextValue }); // optimistic

    const result = await updateConsentPreference(MARKETING_EMAIL_AGREEMENT, nextValue);
    setSaving(false);
    if (result.error) {
      setPrefs({ ...prefs, marketingEmail: previous }); // revert
      setError(result.error);
    }
  };

  return (
    <section aria-labelledby="consent-heading">
      <SectionTitle className="mb-1">
        <span id="consent-heading">Email and advertising</span>
      </SectionTitle>
      <p className="mb-3 max-w-prose text-2xs leading-relaxed text-ink-tertiary">
        Both are optional and neither affects your plan. Email is a box here. Advertising follows
        the cookie choice you made on batchlabel.xyz, so it is changed there.
      </p>
      <Card className="px-5 py-5">
        {loading ?
        <p className="text-sm text-ink-secondary">Checking your preferences…</p> :
        !prefs ?
        <p className="max-w-prose text-[0.8125rem] leading-relaxed text-ink-secondary">
            We could not read your preferences just now. Reload the page to try again.
          </p> :

        <div className="space-y-5">
            {/*
              Deliberately NOT disabled while saving. Disabling the control the
              user has just activated blurs it, and focus lands on the body — so
              a keyboard user is thrown back to the top of the document as their
              reward for ticking a box. The write is guarded in the handler
              instead, and aria-busy says what is happening.
             */}
            <div aria-busy={saving || undefined}>
              <Checkbox
              id="marketing-email-opt-in"
              checked={prefs.marketingEmail}
              onChange={toggleMarketingEmail}
              label={MARKETING_EMAIL_AGREEMENT.title}
              description="Product tips and offers by email. Unsubscribe any time." />

              {saving && <p className="mt-1.5 pl-7 text-2xs text-ink-tertiary">Saving…</p>}
              {error &&
            <div className="mt-1.5 pl-7">
                  <FormError>{error}</FormError>
                </div>
            }
            </div>

            <div className="rounded-control border border-paper-line bg-paper-panel/60 px-4 py-3.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-medium text-ink">{ADVERTISING_AGREEMENT.title}</p>
                <Pill tone={prefs.advertising ? 'good' : 'quiet'}>
                  {prefs.advertising ? 'On' : 'Off'}
                </Pill>
              </div>
              <p className="mt-1 max-w-prose text-2xs leading-relaxed text-ink-tertiary">
                Your email and account details used to build ad audiences with Meta and Google.
                This is your marketing cookie choice, kept in one place so it cannot say two
                different things.
              </p>
              <div className="mt-3">
                <ExternalLink href={COOKIE_SETTINGS_URL}>Change in cookie settings</ExternalLink>
              </div>
            </div>
          </div>
        }
      </Card>
    </section>);

}

/* ------------------------------------------------------------------ data */

function DataSection() {
  return (
    <section aria-labelledby="data-heading">
      <SectionTitle className="mb-1">
        <span id="data-heading">Your data and plan</span>
      </SectionTitle>
      <p className="mb-3 max-w-prose text-2xs leading-relaxed text-ink-tertiary">
        What we hold, what you agreed to, and where the rest of your account lives.
      </p>
      <Card className="px-5 py-5">
        <div className="flex flex-wrap gap-2">
          {/* Internal now, and no longer an ExternalLink. This used to point at
              www/dashboard/account, which is being removed: www is marketing and auth only,
              and billing moved into this app. Sending somebody off-origin to reach a page
              two clicks away in the sidebar was always the wrong shape. */}
          <Link
            to="/billing"
            className="inline-flex h-8 items-center gap-1.5 rounded-control border border-paper-line px-3 text-2xs font-medium text-ink-secondary transition-colors hover:bg-paper-raised">

            Billing and invoices
          </Link>
          <ExternalLink href={TERMS_URL}>Terms you accepted</ExternalLink>
          <ExternalLink href={PRIVACY_URL}>Privacy notice</ExternalLink>
        </div>
      </Card>

      <SignOutRow />
      <DangerZone />
    </section>);

}

/**
 * Sign out, from a page rather than a menu — and the version for a device you cannot reach.
 *
 * The account menu in the sidebar is desktop only, so until this existed a maker
 * on a phone could not sign out at all. Repeating it here is safe in a way a
 * second consent control would not be: signing out twice is signing out.
 *
 * The second button is a different action, not a louder copy of the first. `scope: 'global'`
 * revokes every refresh token this user holds — the shared laptop, the phone left at a market
 * stall, the browser on a machine that has since been sold — and this session with them. It is
 * reported honestly: a failed revoke says nothing was signed out, because "you are signed out
 * everywhere" when the call failed is the most dangerous false confirmation on this page.
 *
 * AND NOW THE FIRST BUTTON IS REPORTED HONESTLY TOO. It used to be `void signOut()` over a
 * function that could reject, and a rejection took the navigation with it — the app went to
 * "Checking your session…" and stayed there, still signed in, saying nothing. The outcome is
 * read off the provider rather than held here because this component does not survive its own
 * click: `signingOut` is folded into `loading`, so RequireAuth unmounts the whole tree, this
 * row included, for as long as the sign-out is in flight.
 */
function SignOutRow() {
  const { signOut, signOutFailure } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleEverywhere = async () => {
    setBusy(true);
    setError(null);
    const result = await signOutEverywhere();
    setBusy(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    // The tokens are gone; this clears the local session and hands the browser to www. It no
    // longer rejects — a sign-out that did not take resolves as `still-signed-in` and is said
    // by `signOutFailure` below — so `busy` cannot be stranded true by this line either.
    await signOut();
  };

  return (
    <div className="mt-4 space-y-4">
      <div className="flex flex-wrap items-center gap-4">
        <Button variant="secondary" onClick={() => void signOut()}>
          Sign out
        </Button>
        <p className="max-w-prose text-2xs leading-relaxed text-ink-tertiary">
          Signs you out of batchlabel.xyz as well. One sign-in covers both, so one sign-out ends
          both.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-4">
        <Button variant="secondary" disabled={busy} onClick={() => void handleEverywhere()}>
          {busy ? 'Signing out…' : 'Sign out on every device'}
        </Button>
        <p className="max-w-prose text-2xs leading-relaxed text-ink-tertiary">
          Ends every signed-in browser and phone, including this one. Use it if a device you
          cannot reach might still be signed in.
        </p>
      </div>
      {error && <FormError>{error}</FormError>}
      {/* Either button can land here: the second one finishes by calling the first. */}
      {signOutFailure && <FormError>{signOutFailure}</FormError>}
    </div>);

}

/* ----------------------------------------------------------- data rights */

const REQUEST_TITLES: Record<DataRequestKind, string> = {
  export: 'Copy of your data',
  erasure: 'Account erasure'
};

const REQUEST_STATUS: Record<
  string,
  {label: string;tone: 'neutral' | 'good' | 'warn' | 'quiet';}> =
{
  requested: { label: 'Recorded', tone: 'neutral' },
  in_progress: { label: 'In progress', tone: 'neutral' },
  completed: { label: 'Completed', tone: 'good' },
  refused: { label: 'Refused', tone: 'warn' }
};

/**
 * The two UK GDPR obligations the privacy notice commits to — AS REQUESTS, WHICH IS ALL THEY ARE.
 *
 * WHY THERE IS NO DELETE BUTTON THAT DELETES. This app holds no permission to erase an account
 * and it is not going to: `authenticated` has INSERT and SELECT on `account_data_requests` and
 * nothing else, and there is no route from a browser session to a deleted account. That is a
 * decision rather than missing work — a signed-in tab on a borrowed laptop must not be able to
 * destroy somebody's business records — and it is why the control is honest about being a
 * request. Fulfilment is a service-role job and there is no server function for it yet.
 *
 * So: the button writes a row, the screen says a row was written, and the status column is the
 * only thing that may ever say more. Nothing here claims data has been deleted, nothing offers
 * a download, and nothing counts down a deadline the software cannot enforce.
 */
function DangerZone() {
  const settings = useSettings();
  // FILING A REQUEST AGAINST THE ACCOUNT IS THE OWNER'S, NOT AN EDIT. `account_data_requests`
  // sits at `manage_account` in the matrix, and the survey measured a viewer successfully
  // inserting an ERASURE request against somebody else's account before that placement existed.
  const { can, reason } = useCan();
  const mayRequest = can('manage_account');
  const [busy, setBusy] = useState<DataRequestKind | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [typed, setTyped] = useState('');

  const ready = settings.status === 'ready' && mayRequest;
  const openRequest = (kind: DataRequestKind) =>
  settings.requests.find(
    (request) =>
    request.kind === kind && request.status !== 'completed' && request.status !== 'refused'
  );

  const submit = async (kind: DataRequestKind) => {
    setBusy(kind);
    setError(null);
    const result = await settings.requestData(kind);
    setBusy(null);
    if (result.error) {
      setError(result.error);
      return;
    }
    setConfirming(false);
    setTyped('');
  };

  return (
    <section aria-labelledby="danger-heading" className="mt-8">
      <SectionTitle className="mb-1">
        <span id="danger-heading">Your data rights</span>
      </SectionTitle>
      <p className="mb-3 max-w-prose text-2xs leading-relaxed text-ink-tertiary">
        Both of these record a request. Neither is carried out by this app, and neither happens
        the moment you press the button.
      </p>

      {!ready &&
      <Callout tone="warn" className="mb-3" title="These cannot be recorded right now">
          <p className="max-w-prose leading-relaxed">
            {settings.status === 'unconfigured' ?
          'This copy of the app has no database connection.' :
          settings.status === 'no-account' ?
          'We have not resolved which workspace this is.' :
          settings.status === 'error' ?
          settings.error ?? 'We could not read your account.' :
          'We are still reading your account.'}{' '}
            Email hello@batchlabel.xyz and your request counts just the same.
          </p>
        </Callout>
      }

      {!mayRequest &&
      <Callout tone="warn" title="This is the account owner's to ask for">
          <p className="max-w-prose leading-relaxed">{reason('manage_account')}</p>
          <p className="mt-2 max-w-prose leading-relaxed">
            Your own personal data is a separate matter and is yours whatever your role here.
            Email hello@batchlabel.xyz and we will deal with it.
          </p>
        </Callout>
      }

      <Card className="space-y-5 px-5 py-5">
        <div>
          <p className="text-sm font-medium text-ink">Ask for a copy of your data</p>
          <p className="mt-1 max-w-prose text-[0.8125rem] leading-relaxed text-ink-secondary">
            Your products, specifications, materials and records, and the account details behind
            them. We assemble it by hand today, so this records the request and we reply by email
            within a month — usually the same week.
          </p>
          <div className="mt-3">
            <Button
              variant="secondary"
              disabled={!ready || busy !== null || Boolean(openRequest('export'))}
              onClick={() => void submit('export')}>

              {busy === 'export' ?
              'Recording…' :
              openRequest('export') ?
              'Already requested' :
              'Request a copy of my data'}
            </Button>
          </div>
        </div>

        <div className="border-t border-paper-line pt-5">
          <p className="text-sm font-medium text-ink">Close this account and erase my data</p>
          <p className="mt-1 max-w-prose text-[0.8125rem] leading-relaxed text-ink-secondary">
            This app cannot delete an account — by design, so that a signed-in browser cannot
            destroy your records. Pressing this records the request; we carry out the erasure and
            confirm it by email. Your products stay exactly as they are until we do, and you can
            change your mind by replying to that email.
          </p>

          {!confirming ?
          <div className="mt-3">
              <Button
                variant="secondary"
                disabled={!ready || Boolean(openRequest('erasure'))}
                onClick={() => setConfirming(true)}>

                {openRequest('erasure') ? 'Already requested' : 'Request erasure'}
              </Button>
            </div> :

          <div className="mt-3 space-y-3">
              <label
                htmlFor="erase-confirm"
                className="block text-[0.8125rem] font-medium text-ink-secondary">

                Type ERASE to confirm you want us to close this account
              </label>
              <Input
                id="erase-confirm"
                value={typed}
                autoComplete="off"
                onChange={(event) => setTyped(event.target.value)}
                className="max-w-xs" />

              <div className="flex flex-wrap gap-3">
                <Button
                  variant="secondary"
                  disabled={typed.trim().toUpperCase() !== 'ERASE' || busy !== null}
                  onClick={() => void submit('erasure')}>

                  {busy === 'erasure' ? 'Recording…' : 'Record my erasure request'}
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => {
                    setConfirming(false);
                    setTyped('');
                  }}>

                  Cancel
                </Button>
              </div>
            </div>
          }
        </div>

        {error && <FormError>{error}</FormError>}

        {settings.requests.length > 0 &&
        <div className="border-t border-paper-line pt-5">
            <p className="text-[0.8125rem] font-medium text-ink-secondary">
              Requests we have recorded
            </p>
            <ul className="mt-2 space-y-2">
              {settings.requests.map((request) =>
            <li key={request.id} className="flex flex-wrap items-center gap-3">
                  <Pill tone={REQUEST_STATUS[request.status]?.tone ?? 'neutral'}>
                    {REQUEST_STATUS[request.status]?.label ?? request.status}
                  </Pill>
                  <span className="text-[0.8125rem] text-ink">
                    {REQUEST_TITLES[request.kind] ?? request.kind}
                  </span>
                  <span className="text-2xs text-ink-tertiary">
                    asked for {formatRequestDate(request.requestedAt)}
                  </span>
                  {request.note &&
              <span className="w-full text-2xs text-ink-tertiary">{request.note}</span>
              }
                </li>
            )}
            </ul>
          </div>
        }
      </Card>
    </section>);

}

/** A recorded time, said plainly. An unreadable one says so rather than printing "Invalid Date". */
function formatRequestDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'at a time we cannot read';
  return `on ${date.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  })}`;
}
