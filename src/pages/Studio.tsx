import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRightIcon, PackageIcon, PlusIcon, RefreshCwIcon } from 'lucide-react';
import { PageHeader } from '../components/AppShell';
import { NewProductDialog } from '../components/NewProductDialog';
import { NoAccountNotice } from '../components/NoAccountNotice';
import { PlanNotice } from '../components/PlanNotice';
import { SkuLimitNotice } from '../components/SkuLimitNotice';
import {
  Button,
  Callout,
  Card,
  EmptyState,
  Pill,
  SectionTitle,
  Skeleton } from
'../components/ui/Primitives';
import { categoryById } from '../lib/categories';
import { derive } from '../lib/derive';
import { useEntitlement } from '../lib/entitlement';
import { createIsCertainToFail, readSkuCount, skuCountBeside } from '../lib/membership';
import { useOptionalMaterials } from '../lib/materials-store';
import { queueAcross, queueFor } from '../lib/pipeline';
import { useProducts } from '../lib/product-store';

/**
 * A work queue, not a dashboard. Every row is something standing between a
 * product and shipping. Nothing here restates what another screen already says.
 *
 * IT IS ALSO ROUTE `/`, THE FIRST SCREEN AFTER SIGN-IN, which is why the `unavailable` branch
 * below matters more here than anywhere. A suspended account reads zero products with no
 * error; before that state existed this screen greeted the maker by their business name and
 * then told them they had nothing and should create their first product. Billing, in the same
 * session, said the account was suspended — so the app contradicted itself on two tabs.
 *
 * THREE FIXTURES LEFT THIS SCREEN AND ARE WORTH NAMING. It greeted everybody as Nadia, under
 * the date "Thursday, 30 July", after a 400 millisecond `setTimeout` pretending to be a read.
 * A greeting is the first thing a new customer sees and it was somebody else's name; the date
 * was a string; and the fake delay is now a real one, because there is now really something
 * to wait for. Every number below is derived from this account's own products and from
 * nothing else — which is why the "documents waiting to be read" count went with them: it
 * came from the shipped materials catalogue, not from anything this account has received.
 */
export function Studio() {
  const { status, products, error, refresh } = useProducts();
  const entitlement = useEntitlement();
  /**
   * SUBSCRIBED TO, AND IN THE MEMO KEY BELOW, because this queue's answer depends on it.
   *
   * `outstandingFor` and `derive` both read the synchronous material index, and both now tell
   * "the register says no" apart from "the register has not answered": with materials
   * unsettled, `clp-classification` resolves to `not-tracked` rather than to a finding, which
   * is correct and is also not the final answer.
   *
   * MaterialsProvider publishes that read asynchronously, from above the router. A component
   * that does not consume its context is not re-rendered when it lands — the provider's
   * `children` is the same element object, so React bails out of the subtree and only context
   * consumers re-render. Without this hook, the first screen a maker sees after signing in
   * would count their outstanding work once, against a register that had not loaded, and would
   * keep showing that count for the rest of the session. A work queue that is quietly wrong in
   * the reassuring direction is worse than one that is missing.
   */
  const register = useOptionalMaterials();
  const [creating, setCreating] = useState(false);

  const queues = useMemo(
    () =>
    products.map((product) => ({
      product,
      queue: queueFor(
        product,
        derive(product.spec, product, product.markets[0]),
        product.markets[0]
      )
    })),
    // `register` looks unused to the exhaustive-deps rule and is not:
    // the register they describe is read through a module-level index rather than passed in as
    // an argument, so the rule cannot see the edge. DO NOT DELETE THEM TO SILENCE IT — that
    // restores a queue that is computed once, before the register has answered, and never
    // again. There is a test for exactly this in src/pages/studio-register.test.tsx.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [products, register]
  );

  const outstanding = queues.
  map((entry) => ({ product: entry.product, issues: entry.queue.issues })).
  filter((entry) => entry.issues.length > 0);

  const total = outstanding.reduce((sum, entry) => sum + entry.issues.length, 0);

  /**
   * The checks that exist and did not run, across every product on this screen.
   *
   * THE SENTENCE BELOW USED TO BE COMPOSED WITHOUT THIS. Studio consulted `useProducts()` and
   * nothing else: no `useMaterials`, no `register.status`, no reading of `Stage.checked`. When
   * the materials register read FAILED, the classification stage raised no issues (correctly —
   * it had not looked), `clp-classification` resolved to not-tracked (correctly — a duty we
   * have not checked is not a finding), the queue emptied, and route `/` greeted the maker with
   * "Every composition is settled, every material is classified, and nothing is waiting on
   * you." Every step was honest and the sentence was a lie.
   *
   * An empty queue is now only allowed to be good news when this is empty too.
   */
  const blocked = queueAcross(queues.map((entry) => entry.queue)).blocked;

  const ready = status === 'ready';

  /**
   * Withheld, not empty. The store publishes this only when the entitlement it already read
   * says the membership is suspended, so there is a true sentence to show in place of the
   * empty state — and no reason to offer a control whose write the database will refuse.
   */
  const unavailable = status === 'unavailable';

  /**
   * Whether to offer "New product" at all.
   *
   * Was `!unavailable` — suspension only. That left an unfinished signup a create button that
   * opens a dialog, takes four fields, and is refused: `no_membership` means there is no
   * account row for the column to point at and none for the database's own default to
   * resolve, so the insert cannot land however carefully it is filled in. The refusal is
   * honest (lib/products.ts names the cause and points at the setup step) but it arrives
   * after the typing.
   *
   * The rule lives in `createIsCertainToFail` rather than here, because it is the same rule on
   * four surfaces and the case it must NOT cover — a blipped entitlement read, where the
   * create would have worked — is the one that costs a maker a product. See the comment on
   * that function; it is doing the arguing.
   */
  const offerCreate = !createIsCertainToFail(entitlement);

  /**
   * How many products the ACCOUNT holds, which is not the length of the list on this screen.
   *
   * `entitlement.skuCount` is counted by the database over the same rows the enforcement
   * trigger counts. `products.length` is what came back and could be described:
   * `fetchProducts` drops a product whose specification did not, so the two can differ by
   * exactly the amount that makes this header say "3 products" while Billing says "4 of 45"
   * and the next create is refused. Billing removed its own `products.length` fallback for
   * this reason; the same argument applies to any screen stating a fact about the account.
   *
   * Null is unknown and is simply not said. The clause below disappears rather than
   * substituting a number, which is the whole rule the view's `sku_count` was built around.
   *
   * IT USED TO READ NOUGHT AS UNKNOWN, here and on the Settings identity tab, which fixed the
   * symptom ("0 products · 3 things outstanding across 1 product", the first line a maker read
   * after their first create) by making a genuine zero unsayable while leaving a stale 3 sayable.
   * The two real states are named now instead: `readSkuCount` separates a count we do not have
   * from one we know a write of ours has moved, and `skuCountBeside` refuses any count lower
   * than the list it is printed next to — the account cannot hold fewer products than this
   * screen just read out of it, so that is the two sources disagreeing rather than a total.
   */
  const stated = skuCountBeside(
    readSkuCount(entitlement.skuCount, entitlement.skuCountStale),
    products.length
  );

  return (
    <main className="flex-1 pb-24 xl:pb-0">
      <PageHeader
        eyebrow={today()}
        title={greeting(entitlement.businessName)}
        description="Ingredients in, the right label and a compliant safety data sheet out. Here is what is between you and that today."
        actions={
        offerCreate ?
        <Button variant="primary" onClick={() => setCreating(true)}>
            <PlusIcon className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />
            New product
          </Button> :
        undefined
        }
        meta={
        status === 'loading' ?
        <Skeleton className="h-4 w-72 bg-paper-line/70" /> :
        ready && products.length > 0 ?
        <p className="text-[0.8125rem] text-ink-secondary">
              {stated !== null &&
          <>
                  <span className="tabular">{stated}</span>{' '}
                  {stated === 1 ? 'product' : 'products'}
                  <span className="mx-2 text-ink-tertiary" aria-hidden="true">
                    ·
                  </span>
                </>
          }
              <span className="tabular">{total}</span> things outstanding across{' '}
              <span className="tabular">{outstanding.length}</span>{' '}
              {outstanding.length === 1 ? 'product' : 'products'}
            </p> :
        null
        } />


      {creating && <NewProductDialog onClose={() => setCreating(false)} />}

      <div className="px-6 py-8 lg:px-10">
        <SkuLimitNotice className="mb-6" />

        {/* The one thing this screen may say instead of a work queue. `states` keeps it to
            suspension: a free or lapsed maker gets the queue and the create button, because
            neither the plan nor the policy withholds anything from them. */}
        {unavailable && <PlanNotice states={['suspended']} />}

        {status === 'error' &&
        <Callout tone="warn" role="alert" title="We could not read your products">
            <p className="max-w-prose leading-relaxed">
              {error} This screen is built entirely from them, so it is showing nothing rather
              than a total that would be wrong.
            </p>
            <Button size="sm" variant="secondary" className="mt-3" onClick={refresh}>
              <RefreshCwIcon className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />
              Try again
            </Button>
          </Callout>
        }

        {status === 'loading' &&
        <div className="space-y-4" aria-busy="true" aria-label="Loading your products">
            {[0, 1].map((index) =>
          <Card key={index} className="px-5 py-5">
                <Skeleton className="h-3.5 w-40 bg-paper-line/70" />
                <Skeleton className="mt-4 h-3 w-full bg-paper-line/70" />
                <Skeleton className="mt-2.5 h-3 w-4/5 bg-paper-line/70" />
              </Card>
          )}
          </div>
        }

        {/* THE ONE STATE THIS SCREEN USED TO RENDER AS NOTHING AT ALL. `ready` is false, so
            neither the queue nor the empty state drew; nothing matched 'error' or 'loading';
            and route `/` — the first screen after sign-in — came up as a greeting, a create
            button and blank space below them. The person most likely to be looking at it is
            a Google signup who never finished at /finish-setup: signed in, no account, and
            nothing anywhere telling them that is what happened. Same sentences the products
            screen shows, because it is the same fact. */}
        {status === 'no-account' && <NoAccountNotice />}

        {ready && products.length === 0 &&
        <EmptyState
          icon={<PackageIcon className="h-5 w-5" strokeWidth={1.25} aria-hidden="true" />}
          title="Nothing here yet, and that is the right place to start"
          body="This screen fills up with whatever stands between a product and shipping: a supplier sheet you have not read, a formula that does not total 100 percent, a classification with nothing in it yet. Create your first product and it will start telling you what it needs."
          action={
          <Button variant="primary" onClick={() => setCreating(true)}>
                <PlusIcon className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />
                Create your first product
              </Button>
          } />

        }

        {ready && products.length > 0 &&
        <>
            <SectionTitle className="mb-3">Outstanding</SectionTitle>

            {/* SAID BESIDE A QUEUE THAT HAS ROWS IN IT TOO, not only in place of an empty one.
                A queue missing the classification check is under-reported whether it happens to
                show three rows or none, and the count in the header above is then a floor
                rather than a total. */}
            {blocked.length > 0 && outstanding.length > 0 &&
          <Callout tone="warn" className="mb-4" title="Some checks did not run">
                <p className="max-w-prose leading-relaxed">
                  {capitalise(blocked.join(', and '))}. What is below is what we could establish,
                  and it is not the whole of it.
                </p>
              </Callout>
          }

            {outstanding.length === 0 ?
          blocked.length === 0 ?
          <Card className="px-6 py-8">
                  <p className="font-display text-base font-medium text-ink">Nothing outstanding</p>
                  {/* Says what was checked, and does not extend it to what was not. This read
                      "every product has current documents, a settled composition and outputs
                      that match it" — two thirds of which the software has never established.
                      Nothing watches supplier documents, and no output has been produced, so
                      there is no such thing yet as an output that matches or fails to.

                      IT IS ALSO GATED ON `blocked` NOW, which is the rest of the same argument.
                      "Every material is classified" is a claim about the materials register,
                      and this screen used to make it without ever consulting one — so a failed
                      register read produced this card verbatim. An empty queue only earns these
                      words when nothing was stopped from looking. */}
                  <p className="mt-1 max-w-prose text-sm leading-relaxed text-ink-secondary">
                    Every composition is settled, every material is classified, and nothing is
                    waiting on you. Supplier documents are not watched yet, and no output has
                    been produced.
                  </p>
                </Card> :

          <Card className="px-6 py-8">
                  <p className="font-display text-base font-medium text-ink">
                    Nothing outstanding among the checks that ran
                  </p>
                  <p className="mt-1 max-w-prose text-sm leading-relaxed text-ink-secondary">
                    {capitalise(blocked.join(', and '))}, so that check did not run on any of
                    your products. This is silence rather than an all-clear: a check that did
                    not run raises nothing, exactly like a check that found nothing. Supplier
                    documents are not watched yet, and no output has been produced.
                  </p>
                </Card> :


          <div className="space-y-4">
                {outstanding.map(({ product, issues }) =>
            <Card key={product.id} className="overflow-hidden">
                    <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-paper-line bg-paper-panel/60 px-5 py-3">
                      <Link
                  to={`/products/${product.id}`}
                  className="text-[0.8125rem] font-medium text-ink hover:text-teal">

                        {product.name}
                      </Link>
                      <p className="text-2xs text-ink-tertiary">
                        {categoryById(product.categoryId).name} ·{' '}
                        <span className="tabular">{issues.length}</span> outstanding
                      </p>
                    </div>
                    <ul className="divide-y divide-paper-line">
                      {issues.map((issue) =>
                <li
                  key={`${issue.stage.id}-${issue.label}`}
                  className="flex flex-wrap items-start gap-3 px-5 py-3.5">

                          <Pill tone="quiet">{issue.stage.label}</Pill>
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium text-clay-dark">{issue.label}</p>
                            <p className="mt-0.5 max-w-prose text-[0.8125rem] leading-relaxed text-ink-secondary">
                              {issue.detail}
                            </p>
                          </div>
                          <Link
                    to={issue.to}
                    className="mt-0.5 flex flex-none items-center gap-1 text-[0.8125rem] font-medium text-teal hover:text-teal-hover">

                            Resolve
                            <ArrowRightIcon
                      className="h-3.5 w-3.5"
                      strokeWidth={1.5}
                      aria-hidden="true" />

                          </Link>
                        </li>
                )}
                    </ul>
                  </Card>
            )}
              </div>
          }
          </>
        }
      </div>
    </main>);

}

/**
 * A `blockedBy` clause at the start of a sentence.
 *
 * The clauses are written lowercase in lib/pipeline.ts so they can be joined and dropped into
 * the middle of a sentence as well as the front of one. Only the first character moves.
 */
function capitalise(text: string): string {
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}

/** Today, as a person would write it. Was the string "Thursday, 30 July". */
function today(): string {
  return new Date().toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long'
  });
}

/**
 * A greeting that is true.
 *
 * The business name comes from the membership — it is what the maker typed when they signed
 * up — and is simply left out when we do not have one, rather than substituted. "Good
 * morning" on its own is a perfectly good sentence; "Good morning, Nadia" addressed to
 * somebody who is not Nadia is not.
 */
function greeting(businessName: string | null): string {
  const hour = new Date().getHours();
  const part = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  return businessName ? `${part}, ${businessName}` : part;
}
