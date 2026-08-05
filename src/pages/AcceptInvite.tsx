import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { PageHeader } from '../components/AppShell';
import { Button, Callout, Card, Skeleton } from '../components/ui/Primitives';
import { useActiveAccount } from '../lib/active-account';
import { useAuth } from '../lib/auth';
import { roleLabel } from '../lib/permissions';
import { acceptInvite, type AcceptOutcome } from '../lib/team';

/**
 * REDEEMING AN INVITATION.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THE LINK IS AND WHAT IT IS NOT
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * The token in the path is 64 hex characters minted inside `public.create_account_invite` and
 * emailed once. The database stores only sha256 of it, so a dump of `account_invites` yields
 * nothing redeemable, and `token_hash` sits outside the column-level SELECT grant so not even
 * the admin who sent the invitation can read it back.
 *
 * IT IS NOT A SIGN-IN LINK. Holding it proves nothing on its own:
 * `public.accept_account_invite` requires `auth.uid()`, then compares the SIGNED-IN PERSON'S
 * verified email against the invited address, and answers `wrong_recipient` when they differ.
 * That comparison is what makes a forwarded or intercepted link useless, and it is why this
 * screen sits behind the ordinary auth gate like everything else rather than having a public
 * route of its own.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * FIVE OUTCOMES, AND WHY THEY ARE NOT FOUR OR SIX
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * The database collapses unknown, revoked and already-accepted into one word, `invalid`,
 * because distinguishing them would tell whoever holds a token that they had been removed from
 * an account, or that somebody else had used their link. This screen may not un-collapse them
 * by guessing, so it says one thing for all three.
 *
 * `expired` is deliberately separate. To reach that branch you must already hold a real token,
 * which you got from the email, so the answer discloses nothing to somebody guessing while
 * being the difference between a useful sentence and a dead end.
 *
 * `no_seat` is its own case because it is the account's problem and not the invitee's, and the
 * only person who can fix it is the one who invited them.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * IT RUNS ONCE
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * React mounts effects twice under StrictMode in development, and a second call would find its
 * own `accepted_at` already stamped and answer `invalid` over the top of a success. The ref
 * below is what stops that. The database is safe either way (the invite row is taken
 * `for update`, so a replay is a race nobody wins) but the SCREEN would not be: the customer
 * would watch a successful join turn into "this invitation cannot be used".
 */

type State =
{phase: 'working';} |
{phase: 'done';outcome: AcceptOutcome;accountId: string | null;role: string | null;};

export function AcceptInvite() {
  const { token } = useParams();
  const { user } = useAuth();
  const { select, refresh } = useActiveAccount();
  const [state, setState] = useState<State>({ phase: 'working' });
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    if (!token || !token.trim()) {
      setState({ phase: 'done', outcome: 'invalid', accountId: null, role: null });
      return;
    }

    void acceptInvite(token).then((result) => {
      setState({
        phase: 'done',
        outcome: result.outcome,
        accountId: result.accountId,
        role: result.role
      });

      if (result.outcome === 'accepted' && result.accountId) {
        // The account list is a read older than this membership, so it has to be taken again
        // before the new account can be selected. `select` validates against that list, so the
        // order matters: choose first and the id is not yet in the list and is discarded.
        refresh();
        select(result.accountId);
      }
    });
  }, [token, select, refresh]);

  if (state.phase === 'working') {
    return (
      <main className="flex-1 pb-24 xl:pb-0">
        <PageHeader eyebrow="Invitation" title="Checking your invitation" />
        <div className="px-6 py-8 lg:px-10">
          <Card className="space-y-3 px-5 py-5" aria-busy="true">
            <Skeleton className="h-4 w-56" />
            <Skeleton className="h-4 w-72" />
          </Card>
        </div>
      </main>);

  }

  return (
    <main className="flex-1 pb-24 xl:pb-0">
      <PageHeader eyebrow="Invitation" title={TITLES[state.outcome]} />
      <div className="space-y-4 px-6 py-8 lg:px-10">
        {state.outcome === 'accepted' ?
        <>
            <Callout role="status" title="You are in">
              <p className="max-w-prose leading-relaxed">
                You have joined as {roleLabel(state.role).toLowerCase()}. Everything you do from
                here belongs to this workspace, and what you can change is set by that role.
              </p>
            </Callout>
            <Button variant="primary" onClick={() => window.location.assign('/')}>
              Go to the workspace
            </Button>
          </> :

        <>
            <Callout role="alert" tone="warn" title={HEADINGS[state.outcome]}>
              <p className="max-w-prose leading-relaxed">
                {body(state.outcome, user?.email ?? null)}
              </p>
            </Callout>
            <p className="text-[0.8125rem] text-ink-secondary">
              <Link to="/" className="underline">
                Go to your workspace
              </Link>{' '}
              if you already have one.
            </p>
          </>
        }
      </div>
    </main>);

}

const TITLES: Record<AcceptOutcome, string> = {
  accepted: 'You have joined',
  invalid: 'This invitation cannot be used',
  expired: 'This invitation has expired',
  wrong_recipient: 'This invitation is for a different address',
  no_seat: 'There is no seat free on this account',
  failed: 'We could not check this invitation'
};

const HEADINGS: Record<AcceptOutcome, string> = {
  accepted: 'You are in',
  invalid: 'Nothing has changed',
  expired: 'It ran out',
  wrong_recipient: 'Signed in as somebody else',
  no_seat: 'The account is full',
  failed: 'This is us, not you'
};

function body(outcome: AcceptOutcome, email: string | null): string {
  switch (outcome) {
    case 'invalid':
      // ONE SENTENCE FOR THREE CAUSES, AND THE VAGUENESS IS THE POINT. Saying which of unknown,
      // withdrawn or already used it was would tell whoever is holding this link something about
      // an account they may have no business knowing.
      return 'This link is not one we can accept. It may already have been used, or it may have been withdrawn. Ask whoever invited you to send a new one.';
    case 'expired':
      return 'An invitation is good for seven days. Ask whoever invited you to send another one and it will work straight away.';
    case 'wrong_recipient':
      return email ?
      `This invitation was sent to a different address, and you are signed in as ${email}. Sign in with the address the invitation was sent to, or ask for a new one at this address.` :
      'This invitation was sent to a different address from the one you are signed in with. Sign in with the address it was sent to, or ask for a new one.';
    case 'no_seat':
      // THE ACCOUNT'S PROBLEM AND NOT THIS PERSON'S. The seat ceiling has dropped below what is
      // already in use, which is what a downgrade does. Nobody was removed to make it happen and
      // nobody will be.
      return 'This account is using every editor seat its plan allows, so we could not add you. Nobody has been removed. Ask whoever invited you to free a seat or change the plan, and then use this link again.';
    case 'failed':
    default:
      return 'We could not reach the database to check this invitation, so nothing has changed. Reload the page and try again.';
  }
}
