import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CheckIcon, ExternalLinkIcon, RefreshCwIcon } from 'lucide-react';
import { PageHeader } from '../components/AppShell';
import { Button, Callout, Card, Pill, SectionTitle, Skeleton } from '../components/ui/Primitives';
import { useEntitlement } from '../lib/entitlement';
import {
  allowanceLabel,
  entitlementMessage,
  periodLine,
  planLabel,
  readSkuCount } from
'../lib/membership';
import { metaInitiateCheckout } from '../lib/meta-pixel';
import {
  createCheckoutSession,
  createRailTestSession,
  createPortalSession,
  leaveFor,
  type BillingResult } from
'../lib/billing';
import {
  TAX_NOTE,
  fetchPlanCatalogue,
  formatPence,
  intervalNoun,
  isPurchasableAt,
  monthsFreeOnAnnual,
  planAllowanceLabel,
  planBySlug,
  priceFor,
  type BillingInterval,
  type PlanCatalogue,
  type PublicPlan } from
'../lib/plans';

/**
 * Plan and billing. This is where a purchase happens.
 *
 * It used to be a Settings tab that showed a real plan status and then linked to www for
 * everything that changed one. www no longer creates Checkout sessions for existing
 * customers, so the buy is here: pick a tier, pick an interval, land in Stripe Checkout with
 * a session that carries the Supabase user id, and come back to /billing/success.
 *
 * THREE RULES THIS SCREEN IS BUILT AROUND.
 *
 * 1. NO PRICE AND NO ALLOWANCE IS WRITTEN IN THIS REPO. Every number on the page comes from
 *    GET /api/plans, which is generated from the plan contract on the origin that owns it.
 *    When that request fails the page says so and shows no prices at all. There is no
 *    fallback table, because a fallback table is a stale price quoted to a customer who is
 *    about to be charged a different one.
 * 2. EVERY PRICE IS EXCLUSIVE OF VAT, IN GBP, AND SAYS SO. Prices are stored tax-exclusive
 *    and Stripe adds the customer's VAT at checkout from their address and VAT number, so
 *    the number here never changes by country and would be a £16.80 surprise if the basis
 *    were left implied.
 * 3. NOTHING HERE DESCRIBES A MECHANISM THAT DOES NOT EXIST. The tiers differ by SKU
 *    allowance and by editor seats, and editor seats are not built, so they are shown as
 *    recorded-but-unavailable rather than sold. The SKU allowance IS enforced — a trigger on
 *    public.products refuses one over the limit, on creation and on nothing else — so the
 *    sentence about the limit says that, and says the other half too: everything already here
 *    stays editable and printable at any tier.
 */
export function Billing() {
  const entitlement = useEntitlement();
  const catalogue = usePlanCatalogue();

  /**
   * THE COUNT COMES FROM THE DATABASE, AND FROM NOWHERE ELSE.
   *
   * `entitlements.sku_count` is counted by the view over the same rows the enforcement trigger
   * counts — live products for the ACCOUNT — which is the whole reason the column was added:
   * "so the button the app disables and the insert the database refuses can never disagree".
   *
   * THERE USED TO BE A FALLBACK TO `products.length`, and it was the one thing this page must
   * not do. The view's `where acct.id is not null` is load-bearing on purpose: a membership
   * with no resolvable account yields sku_count NULL rather than 0, because "zero is a claim
   * ('you have none'); the honest answer is that we do not know" (migration §10). The fallback
   * then answered that null with a client-side 0 — fetchProducts returns [] and 'ready' when
   * there is no account — and rendered "0 of 3 SKUs on your plan", a 0% meter and
   * aria-valuenow=0 on the page that takes money. Exactly the number the database had just
   * refused to state.
   *
   * Its comment claimed it covered "the moment before the entitlement resolves, and only
   * then". That moment does not exist: ProductsProvider holds at 'loading' until the
   * entitlement resolves, so the fallback could only ever fire AFTER the database had said
   * unknown. And the list is not the same number anyway — fetchProducts drops a product whose
   * specification did not come back, so it could show "2 of 3" while the next create is
   * refused for holding 3 of 3.
   *
   * `null` means WE DO NOT KNOW and is rendered as such: an em dash, no meter, no percentage.
   *
   * A COUNT WE KNOW IS BEHIND IS NOT A COUNT EITHER. This page states the number with no list
   * beside it, so unlike Studio and the identity tab it has nothing to notice a stale one
   * against: it would simply have shown "3 of 45" and a matching meter for the rest of a session
   * in which the maker had just created their fourth. `readSkuCount` is what tells them apart —
   * a nought from the database is a fact and is still shown as one, which is why this page does
   * not go through `skuCountBeside`.
   */
  const skus = readSkuCount(entitlement.skuCount, entitlement.skuCountStale);
  const skuCount = skus.known ? skus.count : null;

  // A read in flight is not a read that failed. The entitlement starts unresolved on every
  // visit, so collapsing that into "could not count" would open every visit on an apology for
  // a failure that has not happened. A re-read fired by a create we just made is the same
  // thing one visit later — the row it is fetching carries both halves of the sentence below,
  // so "counting what you are holding and checking what your plan allows" is literally what is
  // happening, and it beats restating the number we already know that create has moved.
  const countPending = entitlement.loading || (!skus.known && skus.reason === 'stale');

  // Annual is the default and monthly is the secondary option, which is the founder
  // decision and also the honest one: annual is the cheaper way to buy the same thing.
  const [interval, setInterval] = useState<BillingInterval>('annual');

  // The rail test is reachable at /billing?railtest=1 and is advertised nowhere.
  //
  // Obscurity is NOT the control. www refuses the 30p price to any email that is not on
  // RAIL_TEST_ALLOWED_EMAILS, checked against the verified token, so a customer who finds
  // this URL gets a 403 and nothing else. Hiding it just keeps a confusing card off the
  // page for the people it would only confuse.
  const [params] = useSearchParams();
  const showRailTest = params.get('railtest') === '1';
  const [pending, setPending] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const held = planBySlug(catalogue.data, entitlement.plan);

  const run = useCallback(async (key: string, call: () => Promise<BillingResult>) => {
    setPending(key);
    setFailure(null);
    const result = await call();
    if (result.ok) {
      // Deliberately no setPending(null): the browser is leaving, and re-enabling the
      // buttons for the frame before it does invites a second click and a second session.
      leaveFor(result.url);
      return;
    }
    setPending(null);
    setFailure(result.message);
  }, []);

  return (
    <main className="flex-1 pb-24 xl:pb-0">
      <PageHeader
        eyebrow="Billing"
        title="Plan and billing"
        description="What you are on, what it allows, and where to change it. Prices are in pounds and exclude VAT; Stripe adds VAT at checkout from your address and your VAT number." />


      <div className="space-y-8 px-6 py-8 lg:px-10">
        {failure &&
        <Callout tone="warn" title="That did not go through">
            <p className="max-w-prose leading-relaxed">{failure}</p>
          </Callout>
        }

        {showRailTest &&
        <Callout tone="info" title="Payment rail test">
            <p className="max-w-prose leading-relaxed">
              Proves the live payment path end to end with a real card — Checkout, the
              webhook, the entitlement write and the purchase events — for a few pence
              instead of a full plan. Stripe shows the exact amount before you confirm. It
              grants no plan and no allowance.
            </p>
            <Button
            size="sm"
            variant="secondary"
            className="mt-3"
            disabled={pending !== null}
            onClick={() => run('rail_test', createRailTestSession)}>

              {pending === 'rail_test' ? 'Opening…' : 'Run the rail test'}
            </Button>
          </Callout>
        }

        <CurrentPlan
          held={held}
          currency={catalogue.data?.currency ?? null}
          skuCount={skuCount}
          countPending={countPending}
          portalPending={pending === 'portal'}
          busy={pending !== null}
          onManage={() => run('portal', createPortalSession)} />


        <section aria-labelledby="plans-heading">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <SectionTitle>
              <span id="plans-heading">Plans</span>
            </SectionTitle>
            <IntervalToggle value={interval} onChange={setInterval} />
          </div>

          {catalogue.loading && <CatalogueSkeleton />}

          {catalogue.failed &&
          <Callout tone="warn" title="We could not load the prices">
              <p className="max-w-prose leading-relaxed">
                Prices and allowances live on batchlabel.xyz and that request did not come back.
                We are not going to guess at them, so nothing is shown rather than a number that
                might be wrong by the time you are charged.
              </p>
              <Button size="sm" variant="secondary" className="mt-3" onClick={catalogue.reload}>
                <RefreshCwIcon className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />
                Try again
              </Button>
            </Callout>
          }

          {catalogue.data &&
          <PlanLadder
            catalogue={catalogue.data}
            interval={interval}
            currentSlug={entitlement.plan}
            /* Somebody already entitled cannot buy a second subscription — the checkout
               endpoint refuses it with a 409 — so the cards stop offering one and point at
               the portal, which is where a tier change belongs and where proration is
               handled. The UI is not the guard; it is the explanation.

               `!active` alone is not enough. entitlement_is_active requires
               coalesce(membership_status,'active') = 'active', so a SUSPENDED membership is
               permanently active=false — which made it the one account the old guard
               offered checkout to. It would have paid, and apply_stripe_entitlement would
               still refuse to entitle it, so the money buys nothing. Same for a session
               with no membership at all: the RPC returns 'no_membership' and writes nothing.
               PlanNotice and BillingReturn already say as much to a suspended customer
               ("Paying again will not switch it back on by itself"); this is the surface
               that used to contradict them. */
            purchasable={
            !entitlement.active &&
            !entitlement.loading &&
            entitlement.status !== 'suspended' &&
            entitlement.status !== 'no_membership'
            }
            busy={pending !== null}
            pendingSlug={pending}
            /* Meta's InitiateCheckout, and only here. This press is somebody deciding to
               start paying; "Manage billing" above it opens the portal to change a card or
               cancel, and reporting that as a checkout would inflate the exact number the ad
               account optimises against. The event used to fire from Settings → Billing on
               www; it moved with the purchase, it did not disappear. Fired before the await
               so a slow session-create cannot lose it. */
            onChoose={(slug) => {
              metaInitiateCheckout('billing-page');
              run(slug, () => createCheckoutSession(slug, interval));
            }} />

          }
        </section>
      </div>
    </main>);

}

/* ----------------------------------------------------------------- catalogue */

interface CatalogueState {
  data: PlanCatalogue | null;
  loading: boolean;
  failed: boolean;
  reload: () => void;
}

/**
 * The catalogue, fetched once per mount with a manual retry.
 *
 * `failed` is a first-class state rather than an empty list, because an empty price list
 * renders as "nothing is for sale" — a different and worse untruth than "we could not load
 * the prices".
 */
function usePlanCatalogue(): CatalogueState {
  const [data, setData] = useState<PlanCatalogue | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setFailed(false);
    fetchPlanCatalogue(controller.signal).
    then((catalogue) => {
      setData(catalogue);
      setLoading(false);
    }).
    catch(() => {
      if (controller.signal.aborted) return;
      setData(null);
      setFailed(true);
      setLoading(false);
    });
    return () => controller.abort();
  }, [attempt]);

  const reload = useCallback(() => setAttempt((value) => value + 1), []);
  return { data, loading, failed, reload };
}

function CatalogueSkeleton() {
  return (
    <div className="grid gap-4 md:grid-cols-3" aria-hidden="true">
      <Skeleton className="h-56" />
      <Skeleton className="h-56" />
      <Skeleton className="h-56" />
    </div>);

}

/* -------------------------------------------------------------- current plan */

function CurrentPlan({
  held,
  currency,
  skuCount,
  countPending,
  portalPending,
  busy,
  onManage






}: {held: PublicPlan | null;currency: string | null;skuCount: number | null;countPending: boolean;portalPending: boolean;busy: boolean;onManage: () => void;}) {
  const entitlement = useEntitlement();

  const tone =
  entitlement.status === 'active' ?
  'good' :
  entitlement.status === 'free' || entitlement.status === 'no_membership' ?
  'neutral' :
  'warn';

  // The catalogue's display name where the tier is one we sell, the slug title-cased where
  // it is not. A tier this deploy has never heard of still has to render as something.
  const name = held?.displayName ?? planLabel(entitlement);
  const when = periodLine(entitlement);

  // The ceiling comes from the ENTITLEMENT, not from the catalogue and not from a constant
  // in this repo — a comped or grandfathered account has an allowance that no tier's card
  // describes, and it is the row that is true for them.
  const limit = entitlement.skuUnlimited ? null : entitlement.skuLimit;
  const pct =
  limit && limit > 0 && skuCount !== null ? Math.min(100, Math.round(skuCount / limit * 100)) : 0;

  return (
    <section aria-labelledby="current-heading" className="space-y-4">
      <SectionTitle>
        <span id="current-heading">Your plan</span>
      </SectionTitle>

      <Card className="px-5 py-5">
        {entitlement.loading ?
        <p className="text-sm text-ink-secondary">Checking your plan…</p> :

        <>
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <p className="font-display text-base font-medium text-ink">{name}</p>
              <Pill tone={tone}>
                {entitlement.status === 'active' &&
              <CheckIcon className="h-3 w-3" strokeWidth={1.5} aria-hidden="true" />
              }
                {entitlement.planStatus ?? entitlement.status.replace(/_/g, ' ')}
              </Pill>
            </div>

            <p className="mt-2 max-w-prose text-[0.8125rem] leading-relaxed text-ink-secondary">
              {entitlementMessage(entitlement)}
            </p>
            {when && <p className="mt-2 text-[0.8125rem] text-ink-secondary">{when}</p>}

            <dl className="mt-4 grid gap-4 border-t border-paper-line pt-4 sm:grid-cols-2">
              <div>
                <dt className="text-2xs uppercase tracking-[0.1em] text-ink-tertiary">Allowance</dt>
                <dd className="tabular mt-1 text-sm text-ink">{allowanceLabel(entitlement)}</dd>
              </div>
              <div>
                <dt className="text-2xs uppercase tracking-[0.1em] text-ink-tertiary">
                  Editor seats
                </dt>
                <dd className="mt-1 text-sm text-ink">
                  {entitlement.editorSeatLimit === null ?
                'Not available' :
                <span className="tabular">{entitlement.editorSeatLimit}</span>
                }
                </dd>
              </div>
            </dl>

            {entitlement.businessName &&
          <p className="mt-4 text-2xs text-ink-tertiary">Billed as {entitlement.businessName}</p>
          }
          </>
        }
      </Card>

      <Card className="px-5 py-5">
        {/* THREE STATES, KEPT APART, and all three are the entitlement's. In flight says it
            is counting: this page opens in flight every single time, so folding that into
            "could not count" is an apology for a failure that has not happened. Resolved with
            a number says the number. Resolved with NO number — the read failed, or no account
            resolved and the view declined to call that nought — says we could not, and shows
            no meter and no percentage, because a 0 sitting beside an allowance reads as "you
            have used none of your plan". The same rule governs the allowance sentence. */}
        <p className="text-sm text-ink">
          <span className="tabular font-medium">{skuCount ?? '—'}</span>
          {/* One row answers both halves now, so the in-flight frame is one sentence rather
              than two branches — while it is loading we know neither the count nor the
              allowance, and there is no state where we know one and not the other. */}
          {countPending ?
          <> SKUs. Counting what you are holding and checking what your plan allows…</> :
          skuCount === null ?
          <> SKUs. We could not count your products just now.</> :
          entitlement.skuUnlimited ?
          <> SKUs. This plan has no SKU ceiling.</> :
          limit !== null ?
          <>
              {' of '}
              <span className="tabular">{limit.toLocaleString('en-GB')}</span> SKUs on your plan
            </> :

          <> SKUs. We could not read your allowance.</>
          }
        </p>
        {!entitlement.loading && skuCount !== null && limit !== null && limit > 0 &&
        <div
          className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-paper-line"
          role="progressbar"
          aria-valuenow={skuCount}
          aria-valuemin={0}
          aria-valuemax={limit}
          aria-label="SKUs used">

            <div className="h-full rounded-full bg-teal" style={{ width: `${pct}%` }} />
          </div>
        }
        {/* This used to say what a SKU IS and deliberately nothing about what happens at
            the limit, because nothing enforced it. Something does now: a trigger on
            public.products counts live rows for the ACCOUNT and refuses one too many. So the
            copy states the rule — and states the other half of it, which matters more to
            somebody who has just downgraded: the meter fires on creating a product and on
            nothing else, so everything already here stays editable and printable at any
            tier, forever. */}
        <p className="mt-3 max-w-prose text-[0.8125rem] leading-relaxed text-ink-secondary">
          A SKU is one thing you sell: one fragrance in one pack size. At your allowance you
          cannot add a new one until you are under it or on a larger plan — everything you
          already have stays editable and printable whatever happens to your plan.
        </p>
      </Card>

      <Card className="px-5 py-5">
        <p className="max-w-prose text-[0.8125rem] leading-relaxed text-ink-secondary">
          Your card, your invoices, your VAT number, switching between monthly and yearly,
          changing tier and cancelling are all in the Stripe billing portal. Changes there
          reach this app as soon as Stripe confirms them.
        </p>
        <div className="mt-4">
          <Button variant="primary" disabled={busy} onClick={onManage}>
            {portalPending ? 'Opening…' : 'Manage billing'}
            <ExternalLinkIcon className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />
          </Button>
        </div>
        {currency &&
        <p className="mt-3 text-2xs text-ink-tertiary">
            Everything is billed in {currency.toUpperCase()}, in every country, {TAX_NOTE}.
          </p>
        }
      </Card>
    </section>);

}

/* -------------------------------------------------------------------- ladder */

/** The one plan slug this client names, and it names it for LAYOUT only — never for a
 *  price, an allowance or an entitlement decision, all of which arrive from the server.
 *  Consultant is a different buyer from a maker moving up a rung, so it is set apart rather
 *  than rendered as a fourth step on the same ladder. If the slug is ever absent from the
 *  catalogue nothing breaks: the ladder simply renders everything it was given. */
const SET_APART = 'consultant';

function PlanLadder({
  catalogue,
  interval,
  currentSlug,
  purchasable,
  busy,
  pendingSlug,
  onChoose







}: {catalogue: PlanCatalogue;interval: BillingInterval;currentSlug: string | null;purchasable: boolean;busy: boolean;pendingSlug: string | null;onChoose: (slug: string) => void;}) {
  const ladder = catalogue.plans.filter((plan) => plan.slug !== SET_APART);
  const apart = catalogue.plans.filter((plan) => plan.slug === SET_APART);

  const card = (plan: PublicPlan) =>
  <PlanCard
    key={plan.slug}
    plan={plan}
    currency={catalogue.currency}
    interval={interval}
    current={currentSlug === plan.slug}
    purchasable={purchasable}
    busy={busy}
    pending={pendingSlug === plan.slug}
    onChoose={onChoose} />;



  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-3">{ladder.map(card)}</div>
      {apart.length > 0 &&
      <div className="grid gap-4">{apart.map(card)}</div>
      }

      {!purchasable &&
      <p className="max-w-prose text-2xs leading-relaxed text-ink-tertiary">
          You are already on a plan, so changing tier or interval happens in the billing portal
          rather than here — that is what handles the proration on the change.
        </p>
      }

      {/* R10, stated once rather than on every card. Editor seats are a real column on the
          plan and on the account, and inviting an editor is not built, so they are reported
          and not sold. */}
      <p className="max-w-prose text-2xs leading-relaxed text-ink-tertiary">
        Editor seats are recorded on each plan and on your account. Inviting a second editor is
        not built yet, so today every account is one person whatever the number says.
      </p>
    </div>);

}

function PlanCard({
  plan,
  currency,
  interval,
  current,
  purchasable,
  busy,
  pending,
  onChoose








}: {plan: PublicPlan;currency: string;interval: BillingInterval;current: boolean;purchasable: boolean;busy: boolean;pending: boolean;onChoose: (slug: string) => void;}) {
  const amount = priceFor(plan, interval);
  const buyable = isPurchasableAt(plan, interval);
  const monthsFree = interval === 'annual' ? monthsFreeOnAnnual(plan) : null;

  return (
    <Card className={`flex flex-col px-5 py-5 ${current ? 'border-teal' : ''}`}>
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="font-display text-base font-medium text-ink">{plan.displayName}</h3>
        {current && <Pill tone="good">Your plan</Pill>}
      </div>

      <p className="mt-3">
        {amount === null ?
        <span className="text-sm text-ink-secondary">
            {plan.purchasable ? `Not sold ${intervalNoun(interval)}` : 'Free'}
          </span> :

        <>
            <span className="tabular font-display text-2xl font-semibold text-ink">
              {formatPence(amount, currency)}
            </span>
            <span className="ml-1.5 text-[0.8125rem] text-ink-secondary">
              {intervalNoun(interval)} {TAX_NOTE}
            </span>
          </>
        }
      </p>

      {monthsFree !== null &&
      <p className="mt-1 text-2xs text-ink-tertiary">
          {monthsFree === 1 ? 'One month' : `${monthsFree} months`} free against the monthly price.
        </p>
      }

      <dl className="mt-4 space-y-1.5 text-[0.8125rem]">
        <div className="flex items-baseline justify-between gap-2">
          <dt className="text-ink-secondary">SKUs</dt>
          <dd className="tabular text-ink">{planAllowanceLabel(plan)}</dd>
        </div>
        <div className="flex items-baseline justify-between gap-2">
          <dt className="text-ink-secondary">Editor seats</dt>
          <dd className="tabular text-ink">
            {plan.editorSeatLimit === null ? 'Unavailable' : plan.editorSeatLimit}
          </dd>
        </div>
      </dl>

      <div className="mt-5 pt-1">
        {buyable && purchasable ?
        <Button
          variant={current ? 'secondary' : 'primary'}
          className="w-full"
          disabled={busy}
          onClick={() => onChoose(plan.slug)}>

            {pending ? 'Opening checkout…' : `Choose ${plan.displayName}`}
          </Button> :
        !plan.purchasable ?
        <p className="text-2xs leading-relaxed text-ink-tertiary">
            Free is the absence of a subscription. There is nothing to buy and nothing to cancel.
          </p> :
        null}
      </div>
    </Card>);

}

/* ------------------------------------------------------------------- toggle */

function IntervalToggle({
  value,
  onChange



}: {value: BillingInterval;onChange: (next: BillingInterval) => void;}) {
  const option = (next: BillingInterval, label: string) =>
  <button
    key={next}
    type="button"
    aria-pressed={value === next}
    onClick={() => onChange(next)}
    className={`rounded-control px-3 py-1.5 text-[0.8125rem] transition-colors ${
    value === next ? 'bg-paper text-ink shadow-sm' : 'text-ink-secondary hover:text-ink'}`
    }>

      {label}
    </button>;


  return (
    <div
      className="inline-flex items-center gap-1 rounded-control border border-paper-line bg-paper-panel p-1"
      role="group"
      aria-label="Billing interval">

      {option('annual', 'Yearly')}
      {option('monthly', 'Monthly')}
    </div>);

}
