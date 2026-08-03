import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckIcon, RefreshCwIcon } from 'lucide-react';
import { PageHeader } from '../components/AppShell';
import { Button, Callout, Card } from '../components/ui/Primitives';
import { useEntitlement } from '../lib/entitlement';
import { allowanceLabel, periodLine, planLabel } from '../lib/membership';
import { activationState, delayForAttempt, type ActivationState } from '../lib/activation';

/**
 * The success URL Stripe returns a customer to after Checkout.
 *
 * IT DOES NOT KNOW THAT THE PLAN IS ON, and the whole screen is built around that. Stripe
 * redirects the browser the moment the Checkout Session completes; the entitlement is written
 * by a webhook, and not by the event firing at that moment — `checkout.session.completed`
 * carries no line items, so the plan and the allowance only land on the
 * `customer.subscription.*` event that follows. Usually a fraction of a second later.
 * Sometimes several.
 *
 * So this page re-reads on a backoff and says "we are waiting" until the row says otherwise.
 * It never renders a plan name as live off the back of the redirect, because the redirect is
 * evidence that a browser was sent here and nothing more.
 *
 * `session_id` is in the query string and is deliberately unused. It is a value in a URL: it
 * can be typed, shared, or kept from a checkout that was later refunded, and this client has
 * no way to verify any of that. The only evidence this app accepts is
 * `public.entitlements.active`, written server-side from a signature-verified Stripe event.
 */
export function BillingReturn() {
  const entitlement = useEntitlement();
  // Destructured for the effect's dependency list: the context value is a fresh object on
  // every render, so depending on it would restart the backoff on each one.
  const { loading, status, active, refresh } = entitlement;
  const [attempts, setAttempts] = useState(0);

  const state = activationState({ loading, status, active, attempts });

  useEffect(() => {
    // Settled: entitled, or suspended (which waiting will never fix).
    if (active || status === 'suspended') return;
    const delay = delayForAttempt(attempts);
    if (delay === null) return;
    const timer = window.setTimeout(() => {
      refresh();
      setAttempts((value) => value + 1);
    }, delay);
    return () => window.clearTimeout(timer);
  }, [active, status, attempts, refresh]);

  // A manual retry restarts the schedule rather than adding one more request to a spent one,
  // because the person pressing it has usually just done something — reopened the tab, fixed
  // a card — that makes a fresh round of asking worth it.
  const askAgain = useCallback(() => {
    setAttempts(0);
    refresh();
  }, [refresh]);

  return (
    <main className="flex-1 pb-24 xl:pb-0">
      <PageHeader
        eyebrow="Billing"
        title={TITLES[state]}
        description="Stripe has brought you back. What happens next depends on your account, not on this page." />


      <div className="space-y-6 px-6 py-8 lg:px-10">
        {state === 'checking' &&
        <Card className="px-5 py-5">
            <p className="max-w-prose text-sm leading-relaxed text-ink-secondary" role="status">
              We are waiting for your subscription to reach us. Stripe sends it separately from
              the page you were just on, so this usually takes a second or two and occasionally
              a little longer. Nothing needs doing — this page is checking on its own.
            </p>
            <div className="mt-4">
              <Button size="sm" variant="secondary" onClick={askAgain}>
                <RefreshCwIcon className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />
                Check now
              </Button>
            </div>
          </Card>
        }

        {state === 'confirmed' &&
        <Card className="px-5 py-5">
            <p className="flex items-center gap-2 font-display text-base font-medium text-ink">
              <CheckIcon className="h-4 w-4 text-teal" strokeWidth={1.75} aria-hidden="true" />
              {planLabel(entitlement)}
            </p>
            <p className="mt-2 max-w-prose text-sm leading-relaxed text-ink-secondary">
              Your account is on {planLabel(entitlement)} with {allowanceLabel(entitlement).toLowerCase()}.
            </p>
            {periodLine(entitlement) &&
          <p className="mt-2 text-[0.8125rem] text-ink-secondary">{periodLine(entitlement)}</p>
          }
            <div className="mt-5 flex flex-wrap gap-2">
              <Link
              to="/"
              className="inline-flex h-11 items-center rounded-control bg-teal px-4 text-sm font-medium text-paper transition-colors hover:bg-teal-hover">

                Back to the studio
              </Link>
              <Link
              to="/billing"
              className="inline-flex h-11 items-center rounded-control border border-paper-line bg-paper px-4 text-sm font-medium text-ink transition-colors hover:bg-paper-panel">

                Plan and billing
              </Link>
            </div>
          </Card>
        }

        {state === 'not_confirmed' &&
        <Callout tone="warn" title="We cannot see a subscription yet">
            <p className="max-w-prose leading-relaxed">
              We have been checking for about half a minute and your account still shows no plan.
              If you completed a payment it will almost certainly arrive shortly — nothing is
              lost and you will not be charged twice. If your bank declined the card, no payment
              was taken at all.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" onClick={askAgain}>
                <RefreshCwIcon className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />
                Check again
              </Button>
              <Link
              to="/billing"
              className="inline-flex h-9 items-center rounded-control border border-paper-line bg-paper px-3 text-[0.8125rem] font-medium text-ink transition-colors hover:bg-paper-panel">

                Plan and billing
              </Link>
            </div>
          </Callout>
        }

        {state === 'unreadable' &&
        <Callout tone="warn" title="We could not check your plan">
            <p className="max-w-prose leading-relaxed">
              This is us, not you. We could not read your account just now, so we cannot tell you
              what it says — including whether a payment landed. Nothing about your account has
              changed because of it.
            </p>
            <div className="mt-3">
              <Button size="sm" variant="secondary" onClick={askAgain}>
                <RefreshCwIcon className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />
                Try again
              </Button>
            </div>
          </Callout>
        }

        {state === 'suspended' &&
        <Callout tone="warn" title="This account is suspended">
            <p className="max-w-prose leading-relaxed">
              We have paused this account rather than closed it, so nothing has been lost. A
              payment cannot switch it back on by itself — get in touch and we will sort it out.
            </p>
          </Callout>
        }
      </div>
    </main>);

}

/** One title per state. `confirmed` is the only one allowed to say the plan is on. */
const TITLES: Record<ActivationState, string> = {
  checking: 'Finishing up',
  confirmed: 'Your plan is active',
  not_confirmed: 'Still waiting',
  unreadable: 'We could not check',
  suspended: 'Account suspended'
};
