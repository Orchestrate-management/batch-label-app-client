import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AccountSwitcher } from '../AccountChooser';
import {
  Button,
  Callout,
  Card,
  Field,
  FormError,
  FormStatus,
  Input,
  Pill,
  SectionTitle,
  Select,
  Skeleton } from
'../ui/Primitives';
import { useActiveAccount, useCan } from '../../lib/active-account';
import { useAuth } from '../../lib/auth';
import { useEntitlement } from '../../lib/entitlement';
import { COMPETENT_PERSON } from '../../lib/identity';
import {
  assignableRoles,
  consumesSeat,
  mayManageMember,
  roleLabel } from
'../../lib/permissions';
import {
  changeMemberRole,
  fetchInvites,
  fetchMembers,
  revokeInvite,
  seatState,
  sendInvite,
  setMemberStatus,
  type AccountInvite,
  type AccountMember } from
'../../lib/team';

/**
 * WHO IS IN THIS WORKSPACE, WHAT THEY MAY DO, AND WHAT IT COSTS.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS TAB USED TO BE, AND WHY THAT WAS THE RIGHT ANSWER AT THE TIME
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Before this change it showed one row, a hardcoded `<Pill>Owner</Pill>`, the line "One account,
 * one person, for now" and a callout titled "Inviting people is not built yet". Every word of
 * that was true: `account_members` granted the browser SELECT and nothing else, there was no
 * invitations table, and `public.is_member_of()` never read the role column, so a viewer and an
 * editor had byte-identical rights and a role would have been decoration.
 *
 * All four of those facts have changed. The role column is a foreign key to
 * `public.account_roles`, thirty-seven write policies gate on `public.can(account_id, ...)`,
 * `public.account_invites` exists, and the browser holds column-level UPDATE on (role, status).
 * So the placeholder is deleted rather than softened, which is the rule: a register of what is
 * not built loses a row when the thing ships, and keeps every word of it until then.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE RULE EVERY CONTROL ON THIS SCREEN FOLLOWS
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * NOTHING HERE RENDERS A BUTTON THAT DIES AT THE DATABASE. Every refusal the database can make
 * against these tables is predictable from what this screen has already read, so each one is
 * spent on a disabled control with the reason attached rather than on a request:
 *
 *   not a manager        `can('manage_members')` is false, so the role picker and the remove
 *                        button are not rendered at all and the invite form says who to ask.
 *   somebody above you   the UPDATE policy compares ranks in BOTH its USING and WITH CHECK
 *                        slots, so an admin acting on the owner matches no rows and gets no
 *                        error. `mayManageMember` is the same comparison, made before the click.
 *   the owner's row      an account always has an owner, and a deferred constraint trigger
 *                        refuses the transaction that would leave it without one. So the owner's
 *                        role is not editable here at all and the row says why.
 *   no seat left         the ceiling is enforced at commit with `hint = 'seat_limit_reached'`.
 *                        The seat card states the number before anybody types an address, and
 *                        the invite form refuses a seat-consuming role while naming the two
 *                        things that actually fix it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS SCREEN CANNOT SHOW EVERYBODY'S EMAIL ADDRESS
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * `public.profiles` publishes `auth.uid() = id`, so the only address this browser can read is
 * its own. That is a deliberate property of the schema and not a gap to route around: an app
 * that could list the contact details of everybody in an account is an app whose least
 * privileged member is an email harvest.
 *
 * What CAN be shown is the address somebody was invited at, from `account_invite_list`, which is
 * readable only by a manager. So members who joined by invitation are named, the signed-in
 * person is named from their own session, and the founding owner has no invitation and is
 * labelled as the owner rather than left blank. The screen says which of those it is doing.
 */
export function TeamTab() {
  const { user } = useAuth();
  const { accountId, accounts, refresh: refreshAccounts } = useActiveAccount();
  const { role, can, reason } = useCan();
  const entitlement = useEntitlement();

  const [members, setMembers] = useState<AccountMember[] | null>(null);
  const [invites, setInvites] = useState<AccountInvite[]>([]);
  const [readError, setReadError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  const manages = can('manage_members');

  const reload = useCallback(() => setAttempt((value) => value + 1), []);

  useEffect(() => {
    if (!accountId) {
      setMembers(null);
      setInvites([]);
      return;
    }
    let active = true;
    void Promise.all([fetchMembers(accountId), fetchInvites(accountId)]).then(
      ([memberResult, inviteResult]) => {
        if (!active) return;
        if (!memberResult.ok) {
          // A FAILED READ IS NOT AN EMPTY ACCOUNT. Rendering "nobody is here" over an account
          // with four people in it is the same class of false sentence as "you have no
          // products", and on this screen it would read as everybody having been removed.
          setMembers(null);
          setReadError(memberResult.message);
          return;
        }
        setMembers(memberResult.value);
        setReadError(null);
        // The invite read failing is NOT the members read failing. Anybody below admin is
        // refused it by policy, which is correct and is not an error to report.
        setInvites(inviteResult.ok ? inviteResult.value : []);
      }
    );
    return () => {
      active = false;
    };
  }, [accountId, attempt]);

  const pending = invites.filter((invite) => invite.status === 'pending');
  const seats = seatState(entitlement.editorSeatLimit, entitlement.seatsInUse);

  return (
    <>
      <CompetentPerson />

      {accounts.length > 1 &&
      <section aria-labelledby="workspaces-heading">
          <SectionTitle className="mb-1">
            <span id="workspaces-heading">Your workspaces</span>
          </SectionTitle>
          <p className="mb-3 max-w-prose text-2xs leading-relaxed text-ink-tertiary">
            You are a member of more than one. Everything you create belongs to the one you are
            working in, and this browser remembers which that is.
          </p>
          <AccountSwitcher />
        </section>
      }

      <Seats seats={seats} manages={manages} />

      <section aria-labelledby="team-heading">
        <SectionTitle className="mb-1">
          <span id="team-heading">Members</span>
        </SectionTitle>
        <p className="mb-3 max-w-prose text-2xs leading-relaxed text-ink-tertiary">
          What somebody may change is set by their role, and it is the database that enforces it
          rather than this screen.
        </p>

        {readError &&
        <Callout tone="warn" role="alert" title="We could not read who is in this account">
            <p className="max-w-prose leading-relaxed">{readError}</p>
            <div className="mt-3">
              <Button variant="secondary" onClick={reload}>
                Try again
              </Button>
            </div>
          </Callout>
        }

        {!readError && members === null &&
        <Card className="space-y-3 px-5 py-5" aria-busy="true">
            <Skeleton className="h-4 w-48" />
            <Skeleton className="h-4 w-64" />
          </Card>
        }

        {members !== null &&
        <Card className="divide-y divide-paper-line">
            {members.map((member) =>
          <MemberRow
            key={member.userId}
            member={member}
            accountId={accountId}
            actorRole={role}
            isSelf={member.userId === user?.id}
            selfEmail={user?.email ?? null}
            businessName={entitlement.businessName}
            onChanged={reload} />

          )}
          </Card>
        }
      </section>

      {manages &&
      <section aria-labelledby="invites-heading">
          <SectionTitle className="mb-1">
            <span id="invites-heading">Invitations</span>
          </SectionTitle>
          <p className="mb-3 max-w-prose text-2xs leading-relaxed text-ink-tertiary">
            An invitation is good for seven days. One for an editor holds a seat from the moment
            it is sent, so the count above is what you have committed rather than who has turned
            up.
          </p>
          <InviteForm
          accountId={accountId}
          actorRole={role}
          seatsFull={seats.full}
          onSent={reload} />

          {pending.length > 0 &&
        <Card className="mt-4 divide-y divide-paper-line">
              {pending.map((invite) =>
          <InviteRow key={invite.id} invite={invite} onChanged={reload} />
          )}
            </Card>
        }
        </section>
      }

      {!manages &&
      <Callout title="Adding people is not yours to do">
          <p className="max-w-prose leading-relaxed">{reason('manage_members')}</p>
        </Callout>
      }

      {/* The account list is read once when the app starts, so somebody who has just been added
          to a second workspace in another tab would not see it here. One button, said plainly,
          rather than a poll. */}
      {accounts.length > 0 &&
      <p className="text-2xs text-ink-tertiary">
          <button type="button" className="underline" onClick={refreshAccounts}>
            Check for workspaces you have joined since this page loaded
          </button>
        </p>
      }
    </>);

}

/* ------------------------------------------------------------------ seats */

function Seats({
  seats,
  manages



}: {seats: ReturnType<typeof seatState>;manages: boolean;}) {
  const { limit, inUse, remaining, full, over } = seats;

  return (
    <section aria-labelledby="seats-heading">
      <SectionTitle className="mb-1">
        <span id="seats-heading">Seats</span>
      </SectionTitle>
      <p className="mb-3 max-w-prose text-2xs leading-relaxed text-ink-tertiary">
        Editor seats are what a plan counts. Read-only seats are free and unlimited on every
        plan, so somebody who reviews and signs off never costs a seat.
      </p>
      <Card className="px-5 py-5">
        {limit === null || inUse === null ?
        // UNKNOWN IS SAID, NEVER SUBSTITUTED WITH A NUMBER. A plausible "1 of 1" printed off a
        // read that failed is the sentence somebody plans a hire around.
        <p className="text-sm text-ink-secondary">
            We could not read this account&rsquo;s seat allowance just now, so the number is not
            shown rather than guessed at. Nothing about who is here has changed.
          </p> :

        <>
            <p className="text-sm text-ink">
              <span className="tabular font-medium">{inUse}</span> of{' '}
              <span className="tabular font-medium">{limit}</span> editor{' '}
              {limit === 1 ? 'seat' : 'seats'} in use
            </p>
            <p className="mt-1 text-2xs leading-relaxed text-ink-tertiary">
              Owners, admins and editors each hold one. Invitations that have not been accepted
              hold one as well, so a seat is never promised to two people.
            </p>

            {over &&
          <Callout tone="warn" className="mt-4" title="This plan now allows fewer seats than are in use">
                <p className="max-w-prose leading-relaxed">
                  Nobody has been removed and nobody will be. Everyone here keeps what they can
                  already do. What is blocked is adding another editor, until the number in use
                  is back at or below the allowance or the plan changes.
                </p>
              </Callout>
          }

            {!over && full &&
          <Callout tone="warn" className="mt-4" title="Every editor seat is taken">
                <p className="max-w-prose leading-relaxed">
                  You can still add somebody read-only, which is free and unlimited. To add
                  another editor, move one of the people here to read only or{' '}
                  {manages ?
              <Link to="/billing" className="underline">
                      change the plan
                    </Link> :

              'ask the account owner to change the plan'
              }
                  .
                </p>
              </Callout>
          }

            {!full && remaining !== null &&
          <p className="mt-3 text-2xs text-ink-tertiary">
                <span className="tabular">{remaining}</span> free.
              </p>
          }
          </>
        }
      </Card>
    </section>);

}

/* ---------------------------------------------------------------- members */

const STATUS_TONE: Record<string, 'good' | 'warn' | 'quiet'> = {
  active: 'good',
  suspended: 'warn',
  removed: 'quiet'
};

const STATUS_WORD: Record<string, string> = {
  active: 'Active',
  suspended: 'Paused',
  removed: 'Removed'
};

function MemberRow({
  member,
  accountId,
  actorRole,
  isSelf,
  selfEmail,
  businessName,
  onChanged








}: {member: AccountMember;accountId: string | null;actorRole: string | null;isSelf: boolean;selfEmail: string | null;businessName: string | null;onChanged: () => void;}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const isOwner = member.role === 'owner';
  const roles = assignableRoles(actorRole);
  const manageable = mayManageMember(actorRole, member.role) && !isOwner && accountId !== null;

  /**
   * WHY THE OWNER'S ROW HAS NO CONTROLS, WHICH IS NOT THE SAME AS BEING ABOVE YOUR RANK.
   *
   * An admin cannot touch it because of rank. THE OWNER CANNOT TOUCH THEIR OWN because an
   * account must always have exactly one active owner, asserted at commit by a deferred
   * constraint trigger and, for the other half, by a partial unique index that refuses a second
   * active owner even to a superuser. So a self-demotion is a transaction that cannot commit,
   * and offering it would be the definition of a button that dies at the database.
   */
  const ownerNote = isOwner ?
  'An account always has an owner, so this role cannot be changed here. Moving an account to a different owner moves the subscription with it, which we do by hand: get in touch at hello@batchlabel.xyz and we will sort it out.' :
  null;

  const label = isSelf ?
  selfEmail ?? 'You' :
  member.email ?? (isOwner ? businessName ?? 'The account owner' : 'A member of this account');

  const act = async (run: () => Promise<{ok: boolean;message?: string;}>) => {
    setBusy(true);
    setError(null);
    const result = await run();
    setBusy(false);
    if (!result.ok) {
      setError(result.message ?? 'That did not save.');
      return;
    }
    setConfirming(false);
    onChanged();
  };

  return (
    <div className="px-5 py-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-ink">
            {label}
            {isSelf && <span className="ml-2 text-2xs font-normal text-ink-tertiary">You</span>}
          </p>
          <p className="text-2xs text-ink-tertiary">
            {!isSelf && !member.email && !isOwner ?
            'We cannot show this address: the database only lets you read your own.' :
            consumesSeat(member.role) ?
            'Holds an editor seat.' :
            'Read only, so it costs no seat.'}
          </p>
        </div>

        <Pill tone={STATUS_TONE[member.status] ?? 'quiet'}>
          {STATUS_WORD[member.status] ?? member.status}
        </Pill>

        {manageable ?
        <label className="flex items-center gap-2">
            <span className="sr-only">Role for {label}</span>
            <Select
            aria-label={`Role for ${label}`}
            className="h-9 w-40 py-0 text-[0.8125rem]"
            value={member.role}
            disabled={busy}
            onChange={(event) =>
            act(() => changeMemberRole(accountId as string, member.userId, event.target.value))
            }>

              {roles.map((entry) =>
            <option key={entry.role} value={entry.role}>
                  {entry.label}
                </option>
            )}
              {/* A role the picker may not offer is still shown, so the select never silently
                  renames somebody. It cannot be chosen, because choosing it is what the policy
                  refuses. */}
              {!roles.some((entry) => entry.role === member.role) &&
            <option value={member.role} disabled>
                  {roleLabel(member.role)}
                </option>
            }
            </Select>
          </label> :

        <Pill tone="neutral">{roleLabel(member.role)}</Pill>
        }

        {manageable && member.status !== 'removed' && !confirming &&
        <Button size="sm" variant="quiet" disabled={busy} onClick={() => setConfirming(true)}>
            Remove
          </Button>
        }
      </div>

      {confirming &&
      <div className="mt-3 rounded-control border border-clay/30 bg-clay-tint px-4 py-3">
          <p className="max-w-prose text-[0.8125rem] leading-relaxed text-clay-dark">
            Remove {label} from this account? They lose access on their very next action rather
            than at their next sign-in, and their seat is free straight away. The record that they
            were here is kept, because a batch signed off by somebody has to stay traceable to
            them.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
            size="sm"
            variant="danger"
            disabled={busy}
            onClick={() =>
            act(() => setMemberStatus(accountId as string, member.userId, 'removed'))
            }>

              {busy ? 'Removing…' : 'Yes, remove them'}
            </Button>
            <Button size="sm" variant="quiet" disabled={busy} onClick={() => setConfirming(false)}>
              Keep them
            </Button>
          </div>
        </div>
      }

      {ownerNote &&
      <p className="mt-2 max-w-prose text-2xs leading-relaxed text-ink-tertiary">{ownerNote}</p>
      }

      {error && <div className="mt-2"><FormError>{error}</FormError></div>}
    </div>);

}

/* ------------------------------------------------------------ invitations */

function InviteRow({
  invite,
  onChanged


}: {invite: AccountInvite;onChanged: () => void;}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="px-5 py-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-ink">{invite.email}</p>
          <p className="text-2xs text-ink-tertiary">
            Invited as {roleLabel(invite.role).toLowerCase()}
            {invite.expiresAt ? ` · runs out ${readableDate(invite.expiresAt)}` : ''}
          </p>
        </div>
        <Pill tone="neutral">Waiting</Pill>
        <Button
          size="sm"
          variant="quiet"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError(null);
            const result = await revokeInvite(invite.id);
            setBusy(false);
            if (!result.ok) {
              setError(result.message);
              return;
            }
            onChanged();
          }}>

          {busy ? 'Withdrawing…' : 'Withdraw'}
        </Button>
      </div>
      {error && <div className="mt-2"><FormError>{error}</FormError></div>}
    </div>);

}

function readableDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'soon';
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long' });
}

function InviteForm({
  accountId,
  actorRole,
  seatsFull,
  onSent




}: {accountId: string | null;actorRole: string | null;seatsFull: boolean;onSent: () => void;}) {
  const roles = assignableRoles(actorRole);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<string>('viewer');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);

  const seatBlocked = seatsFull && consumesSeat(role);
  const noAccount = accountId === null;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy || !email.trim() || seatBlocked || noAccount) return;
    setBusy(true);
    setError(null);
    setSent(null);

    const result = await sendInvite({ accountId, email, role });
    setBusy(false);

    if (!result.ok) {
      setError(result.message);
      return;
    }
    setSent(email.trim());
    setEmail('');
    onSent();
  };

  return (
    <Card className="px-5 py-5">
      <form onSubmit={submit} noValidate className="space-y-4">
        <div className="grid gap-4 md:grid-cols-2">
          <Field
            label="Email address"
            hint="One link, sent once, good for seven days. Whoever opens it has to be signed in as this address before they can join.">

            <Input
              type="email"
              autoComplete="off"
              value={email}
              onChange={(event) => {
                setEmail(event.target.value);
                setSent(null);
              }}
              disabled={busy || noAccount} />

          </Field>
          <Field
            label="What they can do"
            hint="Read only is free and unlimited on every plan. Editor and admin each hold one of the account's editor seats.">
            <Select
              value={role}
              disabled={busy || noAccount}
              onChange={(event) => setRole(event.target.value)}>

              {roles.map((entry) =>
              <option key={entry.role} value={entry.role}>
                  {entry.label}
                  {entry.consumesSeat ? ' (uses a seat)' : ' (free)'}
                </option>
              )}
            </Select>
          </Field>
        </div>

        {/* THE SEAT REFUSAL IS SAID BEFORE THE ADDRESS IS TYPED, not after it is sent. The
            ceiling is enforced at commit by a deferred constraint trigger, so a request here
            would come back refused with the same information this sentence already has. */}
        {seatBlocked &&
        <FormError>
            Every editor seat on this plan is taken, so this invitation cannot be sent. Choose
            read only, which is free and unlimited, or free a seat by moving somebody to read
            only.
          </FormError>
        }

        {noAccount &&
        <FormError>
            We have not worked out which workspace this is yet, so nothing can be sent. Reload the
            page and try again.
          </FormError>
        }

        {error && <FormError>{error}</FormError>}
        {sent &&
        <FormStatus>
            Invitation sent to {sent}. It holds a seat until it is accepted or withdrawn.
          </FormStatus>
        }

        <Button
          type="submit"
          variant="primary"
          disabled={busy || !email.trim() || seatBlocked || noAccount}>

          {busy ? 'Sending…' : 'Send invitation'}
        </Button>
      </form>
    </Card>);

}

/* -------------------------------------------------------- competent person */

/**
 * Naming a reviewer is still not built, and this card still says so.
 *
 * Kept word for word from the tab this replaced. There is no `competent_persons` table, nothing
 * attaches a person to a sheet, and roles do not change that: an admin can now be told apart
 * from an editor, which is a different question from who signed a document.
 */
function CompetentPerson() {
  return (
    <section aria-labelledby="competent-heading">
      <SectionTitle className="mb-1">
        <span id="competent-heading">Competent person</span>
      </SectionTitle>
      <p className="mb-3 max-w-prose text-2xs leading-relaxed text-ink-tertiary">
        Every safety data sheet is produced as a draft. This is who reviews and signs it.
      </p>
      <Card className="px-5 py-5">
        <p className="text-sm font-medium text-ink-tertiary">{COMPETENT_PERSON.name}</p>
        <p className="mt-3 max-w-prose text-[0.8125rem] leading-relaxed text-ink-secondary">
          Naming a reviewer is not built yet. There is no table for it, so nothing here attaches a
          person to a sheet. You can record a section as reviewed against a product, and that
          entry goes to your records log under your own account. Batchlabel assembles the document
          and shows its working; it never checks the wording, never signs on anybody&rsquo;s
          behalf, and will not tell you a sheet has been reviewed when it has not.
        </p>
        <p className="mt-3 max-w-prose text-2xs leading-relaxed text-ink-tertiary">
          A reviewer who only reads is free on every plan. Read-only seats are unlimited, so
          bringing in a consultant to check a sheet never costs a seat and never means sharing a
          login.
        </p>
      </Card>
    </section>);

}
