import React, { useEffect, useRef, useState } from 'react';
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
import { useAuth } from '../../lib/auth';
import { useEntitlement } from '../../lib/entitlement';
import {
  changePassword,
  hasEmailIdentity,
  MIN_PASSWORD_LENGTH,
  sendSetPasswordLink,
  signInMethods } from
'../../lib/account';
import {
  fetchConsentPreferences,
  updateConsentPreference,
  type ConsentPreferences } from
'../../lib/consent-preferences';
import { ADVERTISING_AGREEMENT, MARKETING_EMAIL_AGREEMENT } from '../../lib/agreements';
import {
  ACCOUNT_URL,
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

        <p className="mt-5 max-w-prose text-[0.8125rem] leading-relaxed text-ink-secondary">
          Changing your email address or business name is not self service yet. Email
          hello@batchlabel.co.uk and we will do it for you.
        </p>
      </Card>
    </section>);

}

/* -------------------------------------------------------------- password */

function PasswordSection() {
  const { user } = useAuth();
  const email = user?.email ?? null;
  const canUsePassword = hasEmailIdentity(user);

  return (
    <section aria-labelledby="password-heading">
      <SectionTitle className="mb-1">
        <span id="password-heading">Password</span>
      </SectionTitle>
      <p className="mb-3 max-w-prose text-2xs leading-relaxed text-ink-tertiary">
        {canUsePassword ?
        'Changing your password signs you out everywhere else.' :
        'You sign in with Google, so there is no password on this account yet.'}
      </p>
      {canUsePassword ?
      <ChangePasswordForm email={email} /> :
      <SetPasswordCard email={email} />
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
function ChangePasswordForm({ email }: {email: string | null;}) {
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

        {done &&
        <Callout title="Password changed">
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
 * What a Google-only maker sees.
 *
 * They have no password, so there is nothing to change and a "current password"
 * box would be a dead end. What they can do is add one, which is worth offering:
 * it is the difference between having a second way into the account and having
 * none if they ever lose access to their Google account.
 */
function SetPasswordCard({ email }: {email: string | null;}) {
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
        You signed up with Google, so Batchlabel never held a password for you. You can add one if
        you want a second way in. We will email you a link to set it.
      </p>
      <div className="mt-4">
        {sent ?
        <FormStatus>
            If we can reach {email}, a link to set a password is on its way. It is valid for one
            hour.
          </FormStatus> :

        <Button variant="secondary" disabled={busy || !email} onClick={handleSend}>
            {busy ? 'Sending…' : 'Email me a link to set a password'}
          </Button>
        }
        {error && <div className="mt-3"><FormError>{error}</FormError></div>}
      </div>
      <p className="mt-4 max-w-prose text-2xs leading-relaxed text-ink-tertiary">
        Adding a password does not remove Google. You will be able to use either.
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
            <div>
              <Checkbox
              id="marketing-email-opt-in"
              checked={prefs.marketingEmail}
              disabled={saving}
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
        <p className="max-w-prose text-[0.8125rem] leading-relaxed text-ink-secondary">
          You can ask for a copy of everything we hold, or ask us to close your account and delete
          your uploaded safety data sheets. Email privacy@batchlabel.co.uk and we will reply within
          a month, usually the same week. There is no button for it yet.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <ExternalLink href={ACCOUNT_URL}>Billing and invoices</ExternalLink>
          <ExternalLink href={TERMS_URL}>Terms you accepted</ExternalLink>
          <ExternalLink href={PRIVACY_URL}>Privacy notice</ExternalLink>
        </div>
      </Card>

      <SignOutRow />
    </section>);

}

/**
 * Sign out, from a page rather than a menu.
 *
 * The account menu in the sidebar is desktop only, so until this existed a maker
 * on a phone could not sign out at all. Repeating it here is safe in a way a
 * second consent control would not be: signing out twice is signing out.
 */
function SignOutRow() {
  const { signOut } = useAuth();
  return (
    <div className="mt-4 flex flex-wrap items-center gap-4">
      <Button variant="secondary" onClick={() => void signOut()}>
        Sign out
      </Button>
      <p className="max-w-prose text-2xs leading-relaxed text-ink-tertiary">
        Signs you out of batchlabel.xyz as well. One sign-in covers both, so one sign-out ends
        both.
      </p>
    </div>);

}
