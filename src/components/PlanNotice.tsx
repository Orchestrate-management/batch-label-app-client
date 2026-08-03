import { Link } from 'react-router-dom';
import { RefreshCwIcon } from 'lucide-react';
import { Button, Callout } from './ui/Primitives';
import { useEntitlement } from '../lib/entitlement';
import { planLabel } from '../lib/membership';
import { SUPPORT_EMAIL } from '../lib/marketing';
import type { EntitlementStatus } from '../lib/membership';

/**
 * What to say to a maker whose plan does not currently allow something.
 *
 * One component for every not-entitled state, because the difference between them is the
 * whole point. "You have not paid", "we could not reach the server" and "your card bounced"
 * are three completely different sentences and three completely different next actions, and a
 * single generic "upgrade to continue" would be wrong — sometimes insultingly so, to someone
 * who is paying.
 *
 * TWO THINGS CHANGED WHEN BILLING MOVED INTO THIS APP.
 *
 * Every action now stays here. It used to leave for www.batchlabel.xyz, because plans were
 * sold there; they are sold on /billing now, and sending somebody to another origin to buy
 * the thing they are looking at is a step that loses people for no reason. The one exception
 * is `suspended`, which needs a human rather than a checkout.
 *
 * And `cancelled` became `lapsed`, which is not a rename for its own sake. Ruling R9: a
 * lapsed account is a FREE account, with Free's allowance and Free's abilities. Nothing about
 * having once paid may leave somebody worse off than a new signup, so the copy may not imply
 * a penalty, a lockout or a countdown.
 *
 * WHAT THIS COMPONENT MAY NOT SAY. It names the gate, never the machinery behind it. There is
 * no exporter yet — both export buttons are stubs — and there is no SDS upload and no
 * archive, so no sentence here describes a print-ready file, a document you can upload, or
 * anything you can archive. `feature` is the label on the control the maker is looking at,
 * and that is deliberately all it is.
 */

type Action =
{kind: 'internal';to: string;label: string;} |
{kind: 'external';href: string;label: string;} |
{kind: 'retry';label: string;} |
{kind: 'none';};

interface Copy {
  tone: 'info' | 'warn';
  title: string;
  body: string;
  action: Action;
}

/**
 * `plan` is the tier the account holds, already display-cased — Free, Maker, Studio or
 * Consultant, or whatever a comped account carries. It is named in the copy wherever it
 * changes the sentence, because "your plan" and "your Studio plan" read very differently to
 * somebody who is paying £35 a month and has just been told something is off.
 */
export function copyFor(status: EntitlementStatus, feature: string, plan: string): Copy | null {
  switch (status) {
    case 'active':
    case 'past_due':
      // BOTH are entitled — `past_due` deliberately so, because Stripe retries a failed card
      // for days and the database keeps access on throughout. Nothing is being withheld, so
      // this component has nothing to explain. The dunning nag lives on /billing instead,
      // beside the button that opens the portal where the card is actually replaced; a
      // "update your card" banner over a screen with no card field is a dead end.
      return null;

    case 'free':
      return {
        tone: 'info',
        title: `${feature} is part of a paid plan`,
        body:
        'You are on Free. Building products, working through a specification and seeing which ' +
        'checks each regime requires all stay open. A plan raises how many SKUs your account ' +
        'holds and turns this on.',
        action: { kind: 'internal', to: '/billing', label: 'See plans' }
      };

    case 'lapsed':
      return {
        tone: 'info',
        title: `Your ${plan} plan is not running`,
        body:
        'Nothing has been deleted and nothing has been taken off you. Your account can do ' +
        'everything the Free plan can, exactly as it would for somebody who never subscribed. ' +
        'Starting a plan again switches this back on.',
        action: { kind: 'internal', to: '/billing', label: 'Start a plan again' }
      };

    case 'no_membership':
      return {
        tone: 'info',
        title: 'Your account is still being set up',
        body:
        'You are signed in, but your account has not finished setting up. This usually takes a ' +
        'moment — check again, and if it keeps saying this, get in touch and we will finish it ' +
        'off for you.',
        action: { kind: 'retry', label: 'Check again' }
      };

    case 'suspended':
      return {
        tone: 'warn',
        title: 'This account is suspended',
        body:
        'We have paused this account rather than closed it, so nothing has been lost. Paying ' +
        'again will not switch it back on by itself — email us and we will sort it out.',
        action: { kind: 'external', href: `mailto:${SUPPORT_EMAIL}`, label: 'Email us' }
      };

    case 'unknown':
    default:
      return {
        tone: 'warn',
        title: 'We could not check your plan',
        body:
        'This is us, not you — we could not read your plan just now, so anything that depends ' +
        'on it is held back until we can. Nothing has changed about your account.',
        action: { kind: 'retry', label: 'Try again' }
      };
  }
}

const ACTION_CLASS =
'mt-3 inline-flex h-9 items-center gap-2 rounded-control bg-teal px-3 text-[0.8125rem] font-medium text-white transition-colors hover:bg-teal-hover';

/**
 * `feature` names the thing being withheld, so the free-plan copy can name the control the
 * maker is actually looking at rather than waving at "premium features".
 */
export function PlanNotice({
  feature = 'Exporting',
  className




}: {feature?: string;className?: string;}) {
  const entitlement = useEntitlement();

  // Nothing to say until the read resolves. Flashing "you are on the free plan" at a paying
  // customer for half a second is worse than saying nothing.
  if (entitlement.loading) return null;

  const copy = copyFor(entitlement.status, feature, planLabel(entitlement));
  if (!copy) return null;

  return (
    <Callout tone={copy.tone} title={copy.title} className={className}>
      <p className="max-w-prose leading-relaxed">{copy.body}</p>
      {copy.action.kind === 'internal' &&
      <Link to={copy.action.to} className={ACTION_CLASS}>
          {copy.action.label}
        </Link>
      }
      {copy.action.kind === 'external' &&
      <a href={copy.action.href} className={ACTION_CLASS}>
          {copy.action.label}
        </a>
      }
      {copy.action.kind === 'retry' &&
      <Button size="sm" variant="secondary" className="mt-3" onClick={entitlement.refresh}>
          <RefreshCwIcon className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />
          {copy.action.label}
        </Button>
      }
    </Callout>);

}
