import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRightIcon, PackageIcon, PlusIcon, RefreshCwIcon } from 'lucide-react';
import { PageHeader } from '../components/AppShell';
import { NewProductDialog } from '../components/NewProductDialog';
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
import { outstandingFor } from '../lib/pipeline';
import { useProducts } from '../lib/product-store';

/**
 * A work queue, not a dashboard. Every row is something standing between a
 * product and shipping. Nothing here restates what another screen already says.
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
  const [creating, setCreating] = useState(false);

  const outstanding = useMemo(
    () =>
    products.
    map((product) => ({
      product,
      issues: outstandingFor(
        product,
        derive(product.spec, product, product.markets[0]),
        product.markets[0]
      )
    })).
    filter((entry) => entry.issues.length > 0),
    [products]
  );

  const total = outstanding.reduce((sum, entry) => sum + entry.issues.length, 0);
  const ready = status === 'ready';

  return (
    <main className="flex-1 pb-24 xl:pb-0">
      <PageHeader
        eyebrow={today()}
        title={greeting(entitlement.businessName)}
        description="Ingredients in, the right label and a compliant safety data sheet out. Here is what is between you and that today."
        actions={
        <Button variant="primary" onClick={() => setCreating(true)}>
            <PlusIcon className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />
            New product
          </Button>
        }
        meta={
        status === 'loading' ?
        <Skeleton className="h-4 w-72 bg-paper-line/70" /> :
        ready && products.length > 0 ?
        <p className="text-[0.8125rem] text-ink-secondary">
              <span className="tabular">{products.length}</span>{' '}
              {products.length === 1 ? 'product' : 'products'}
              <span className="mx-2 text-ink-tertiary" aria-hidden="true">
                ·
              </span>
              <span className="tabular">{total}</span> things outstanding across{' '}
              <span className="tabular">{outstanding.length}</span>{' '}
              {outstanding.length === 1 ? 'product' : 'products'}
            </p> :
        null
        } />


      {creating && <NewProductDialog onClose={() => setCreating(false)} />}

      <div className="px-6 py-8 lg:px-10">
        <SkuLimitNotice className="mb-6" />

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
            {outstanding.length === 0 ?
          <Card className="px-6 py-8">
                <p className="font-display text-base font-medium text-ink">Nothing outstanding</p>
                <p className="mt-1 max-w-prose text-sm leading-relaxed text-ink-secondary">
                  Every product has current documents, a settled composition and outputs that
                  match it.
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
