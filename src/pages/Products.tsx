import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { PackageIcon, PlusIcon, RefreshCwIcon } from 'lucide-react';
import { PageHeader } from '../components/AppShell';
import { Button, Callout, Card, EmptyState, Pill, SectionTitle, Skeleton } from '../components/ui/Primitives';
import { NewProductDialog } from '../components/NewProductDialog';
import { SkuLimitNotice } from '../components/SkuLimitNotice';
import { CATEGORIES } from '../lib/categories';
import { outstandingObligations } from '../lib/regimes';
import { specSummary } from '../lib/derive';
import { formatDate } from '../lib/model';
import { useProducts } from '../lib/product-store';
import { useWorkspace } from '../lib/workspace';

/**
 * Grouped by category, so a separate category filter would say the same thing
 * twice. One table language, shared with materials and records.
 *
 * THREE ANSWERS, NOT TWO. This screen used to have one: a list, read synchronously from an
 * array that was seeded with six products and could not fail. It now asks a database, so it
 * has to be able to say "we are still asking", "we asked and could not get an answer", and
 * "we asked, and you have none yet" — and the last two must never be rendered as each other.
 * An empty state shown after a failed read tells a maker with forty SKUs that their products
 * are gone. That is the ticket this file exists to prevent.
 */
export function Products() {
  const navigate = useNavigate();
  const { enabledCategories } = useWorkspace();
  const { status, products, error, refresh } = useProducts();
  const [creating, setCreating] = useState(false);

  // Only categories that hold something get a section. A brand new account gets ONE empty
  // state rather than three — "nothing in home fragrance yet", "nothing in cosmetics yet",
  // "nothing in electronics yet" is the same sentence three times and reads as a broken
  // screen rather than as a beginning.
  const categories = CATEGORIES.filter(
    (category) =>
    enabledCategories.includes(category.id) &&
    products.some((product) => product.categoryId === category.id)
  );

  return (
    <main className="flex-1 pb-24 xl:pb-0">
      <PageHeader
        eyebrow="Products"
        title="What you make"
        description="Each product holds a composition, the classification it produces, and the two outputs that follow: a label and a safety data sheet."
        actions={
        <Button variant="primary" onClick={() => setCreating(true)}>
            <PlusIcon className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />
            New product
          </Button>
        } />


      {creating && <NewProductDialog onClose={() => setCreating(false)} />}

      <div className="space-y-10 px-6 py-8 lg:px-10">
        <SkuLimitNotice />

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

        {status === 'error' &&
        <Callout tone="warn" role="alert" title="We could not read your products">
            <p className="max-w-prose leading-relaxed">
              {error} Nothing has been deleted and nothing has been changed — we simply could
              not get an answer just now.
            </p>
            <Button size="sm" variant="secondary" className="mt-3" onClick={refresh}>
              <RefreshCwIcon className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />
              Try again
            </Button>
          </Callout>
        }

        {status === 'ready' && products.length === 0 &&
        <EmptyState
          icon={<PackageIcon className="h-5 w-5" strokeWidth={1.25} aria-hidden="true" />}
          title="No products yet"
          body="A product is one thing you sell: one recipe, in one pack size, in one container. Create the first one and the pipeline asks for the materials it needs, then produces the classification, the label and the safety data sheet from them."
          action={
          <Button variant="primary" onClick={() => setCreating(true)}>
                <PlusIcon className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />
                Create your first product
              </Button>
          } />

        }

        {status === 'ready' &&
        categories.map((category) => {
          const inCategory = products.filter((product) => product.categoryId === category.id);
          return (
            <section key={category.id} aria-label={category.name}>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <SectionTitle>{category.name}</SectionTitle>
                <p className="text-2xs text-ink-tertiary">{category.blurb}</p>
              </div>

              <Card className="overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[760px] text-left text-sm">
                    <thead>
                      <tr className="border-b border-paper-line bg-paper-panel/60 text-2xs uppercase tracking-[0.1em] text-ink-tertiary">
                        <th scope="col" className="px-5 py-3 font-medium">Product</th>
                        <th scope="col" className="px-5 py-3 font-medium">Composition</th>
                        <th scope="col" className="px-5 py-3 font-medium">Outputs</th>
                        <th scope="col" className="px-5 py-3 font-medium">Last produced</th>
                        <th scope="col" className="px-5 py-3 font-medium">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {inCategory.map((product) => {
                        const outstanding = outstandingObligations(product).length;
                        const stale = product.artefacts.filter((a) => !a.current).length;
                        return (
                          <React.Fragment key={product.id}>
                            <tr
                              className="cursor-pointer border-b border-paper-line last:border-0 hover:bg-teal-tint"
                              onClick={() => navigate(`/products/${product.id}`)}>

                              <td className="px-5 py-3.5">
                                <Link
                                  to={`/products/${product.id}`}
                                  className="font-medium text-ink hover:text-teal">

                                  {product.name}
                                </Link>
                                <p className="tabular mt-0.5 text-2xs text-ink-tertiary">
                                  {product.sku || 'No product code'}
                                </p>
                              </td>
                              <td className="px-5 py-3.5 text-ink-secondary">
                                {specSummary(product.spec)}
                                <span className="tabular block text-2xs text-ink-tertiary">
                                  {product.spec.netQuantity}
                                  {product.spec.netUnit}
                                </span>
                              </td>
                              <td className="tabular px-5 py-3.5 text-ink-secondary">
                                {product.artefacts.length}
                                {stale > 0 &&
                                <span className="text-clay-dark">, {stale} out of date</span>
                                }
                              </td>
                              <td className="tabular px-5 py-3.5 text-ink-secondary">
                                {formatDate(product.artefacts[0]?.printedOn)}
                              </td>
                              <td className="px-5 py-3.5">
                                <Pill tone={outstanding ? 'warn' : 'good'}>
                                  {outstanding ? `${outstanding} outstanding` : 'Complete'}
                                </Pill>
                              </td>
                            </tr>
                          </React.Fragment>);

                      })}
                    </tbody>
                  </table>
                </div>
              </Card>
            </section>);

        })}
      </div>
    </main>);

}
