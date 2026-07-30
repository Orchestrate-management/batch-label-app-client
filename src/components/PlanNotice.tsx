import { ExternalLinkIcon, RefreshCwIcon } from 'lucide-react';
import { Button, Callout } from './ui/Primitives';
import { useEntitlement } from '../lib/entitlement';
import { ACCOUNT_URL, PRICING_URL } from '../lib/marketing';
import type { EntitlementStatus } from '../lib/membership';

/**
 * What to say to a maker whose plan does not currently allow something.
 *
 * One component for every not-entitled state, because the difference between
 * them is the whole point. "You have not paid" and "we could not reach the
 * server" and "your card bounced" are three completely different sentences and
 * three completely different next actions, and a single generic "upgrade to
 * continue" would be wrong — sometimes insultingly so, to someone who is paying.
 *
 * Every action leaves for www.batchlabel.xyz. This app deliberately has no
 * checkout of its own: plans are sold, changed and cancelled in one place, next
 * to the Stripe customer portal, and that place is not here.
 */

type Action =
{kind: 'link';href: string;label: string;} |
{kind: 'retry';label: string;} |
{kind: 'none';};

interface Copy {
  tone: 'info' | 'warn';
  title: string;
  body: string;
  action: Action;
}

function copyFor(status: EntitlementStatus, feature: string): Copy | null {
  switch (status) {
    case 'active':
      return null;

    case 'free':
      return {
        tone: 'info',
        title: `${feature} is part of a paid plan`,
        body:
        'Everything else stays open on the free plan — build products, read supplier documents ' +
        'and check what the regulations require. Producing the finished artefact is the paid part.',
        action: { kind: 'link', href: PRICING_URL, label: 'See plans' }
      };

    case 'past_due':
      return {
        tone: 'warn',
        title: 'Your last payment did not go through',
        body:
        'Your plan is still on while your bank retries, so nothing is blocked yet. Update your ' +
        'card to keep it that way.',
        action: { kind: 'link', href: ACCOUNT_URL, label: 'Update your card' }
      };

    case 'cancelled':
      return {
        tone: 'warn',
        title: 'Your plan has ended',
        body:
        'Nothing has been deleted. Your products, materials and records are all still here and ' +
        'still readable — starting a plan again switches this back on exactly as it was.',
        action: { kind: 'link', href: PRICING_URL, label: 'Start a plan again' }
      };

    case 'no_membership':
      return {
        tone: 'info',
        title: 'Your account is still being set up',
        body:
        'You are signed in, but your account has not finished setting up. This usually takes a ' +
        'moment — check again, and if it keeps saying this, finish setting up on batchlabel.xyz.',
        action: { kind: 'retry', label: 'Check again' }
      };

    case 'suspended':
      return {
        tone: 'warn',
        title: 'This account is suspended',
        body:
        'We have paused this account rather than closed it, so nothing has been lost. Get in ' +
        'touch from your account page and we will sort it out.',
        action: { kind: 'link', href: ACCOUNT_URL, label: 'Go to your account' }
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

/**
 * `feature` names the thing being withheld, so the free-plan copy can be honest
 * about what is and is not included rather than waving at "premium features".
 */
export function PlanNotice({
  feature = 'Exporting',
  className




}: {feature?: string;className?: string;}) {
  const entitlement = useEntitlement();

  // Nothing to say until the read resolves. Flashing "you are on the free plan"
  // at a paying customer for half a second is worse than saying nothing.
  if (entitlement.loading) return null;

  const copy = copyFor(entitlement.status, feature);
  if (!copy) return null;

  return (
    <Callout tone={copy.tone} title={copy.title} className={className}>
      <p className="max-w-prose leading-relaxed">{copy.body}</p>
      {copy.action.kind === 'link' &&
      <a
        href={copy.action.href}
        className="mt-3 inline-flex h-9 items-center gap-2 rounded-control bg-teal px-3 text-[0.8125rem] font-medium text-white transition-colors hover:bg-teal-hover">

          {copy.action.label}
          <ExternalLinkIcon className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />
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
