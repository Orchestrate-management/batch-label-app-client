import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { PackageIcon, PlusIcon, RefreshCwIcon } from 'lucide-react';
import { PageHeader } from '../components/AppShell';
import { Button, Callout, Card, EmptyState, Pill, SectionTitle, Skeleton } from '../components/ui/Primitives';
import { NewProductDialog } from '../components/NewProductDialog';
import { ReadOnlyNotice } from '../components/ReadOnlyNotice';
import { NoAccountNotice } from '../components/NoAccountNotice';
import { PlanNotice } from '../components/PlanNotice';
import { SkuLimitNotice } from '../components/SkuLimitNotice';
import { CATEGORIES } from '../lib/categories';
import { useCan } from '../lib/active-account';
import { useEntitlement } from '../lib/entitlement';
import { createIsCertainToFail } from '../lib/membership';
import { derive, specSummary } from '../lib/derive';
import { useOptionalMaterials } from '../lib/materials-store';
import { formatDate } from '../lib/model';
import { queueFor } from '../lib/pipeline';
import { useProducts } from '../lib/product-store';

/**
 * Grouped by category, so a separate category filter would say the same thing
 * twice. One table language, shared with materials and records.
 *
 * FOUR ANSWERS, NOT TWO. This screen used to have one: a list, read synchronously from an
 * array that was seeded with six products and could not fail. It now asks a database, so it
 * has to be able to say "we are still asking", "we asked and could not get an answer", "your
 * account's rows are being withheld and here is why", and "we asked, and you have none yet" —
 * and none of the first three may be rendered as the last. An empty state shown after a failed
 * or a refused read tells a maker with forty SKUs that their products are gone. That is the
 * ticket this file exists to prevent.
 */
export function Products() {
  const navigate = useNavigate();
  const { status, products, error, refresh } = useProducts();
  const entitlement = useEntitlement();
  const { can } = useCan();
  /**
   * SUBSCRIBED TO FOR THE SAME REASON STUDIO IS, and it became load-bearing here the moment the
   * Status column started reading the pipeline. `queueFor` and `derive` reach the materials
   * register through the module-level index in lib/material-index.ts, which MaterialsProvider
   * fills asynchronously from above the router; a component that consumes no context is not
   * re-rendered when that read lands. Without this hook the pill would state its answer against
   * a register that had not loaded and keep it for the rest of the session.
   */
  useOptionalMaterials();
  const [creating, setCreating] = useState(false);

  // See product-store.tsx. Published only for a suspended membership, which the entitlement
  // read established before this screen rendered — so there is something true to say, and no
  // reason to offer a create the database will refuse.
  const unavailable = status === 'unavailable';

  // Suspension AND an unfinished signup: the two states where the insert is already
  // established to fail, so a form here would take four fields in order to be refused. NOT a
  // failed entitlement read, where the database resolves the account itself and the create
  // would have worked. The whole argument is on `createIsCertainToFail`.
  // The permission half of the same question. See the note on Studio's copy of this line.
  const offerCreate = !createIsCertainToFail(entitlement) && can('write_data');

  // A category only gets a section once it holds something, so a brand new account gets the
  // empty state rather than a heading over nothing.
  const categories = CATEGORIES.filter((category) =>
  products.some((product) => product.categoryId === category.id)
  );

  return (
    <main className="flex-1 pb-24 xl:pb-0">
      <PageHeader
        eyebrow="Products"
        title="What you make"
        description="Each product holds a composition, the classification it produces, and the two outputs that follow: a label and a safety data sheet."
        actions={
        offerCreate ?
        <Button variant="primary" onClick={() => setCreating(true)}>
            <PlusIcon className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />
            New product
          </Button> :
        undefined
        } />


      {creating && <NewProductDialog onClose={() => setCreating(false)} />}

      <div className="space-y-10 px-6 py-8 lg:px-10">
        <ReadOnlyNotice capability="write_data" />
        <SkuLimitNotice />

        {/* Instead of the list and instead of the empty state, never alongside them. `states`
            keeps this to suspension — a free or lapsed account keeps every product it holds,
            fully readable and fully editable, and must not be shown a plan gate here. */}
        {unavailable && <PlanNotice states={['suspended']} />}

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
            {/* The sentence is the reader's, not this screen's. A read can fail for more than
                one reason now — a dropped request, or a list that turned out to span two of
                your accounts — and only fetchProducts knows which, so a fixed "we simply could
                not get an answer" appended here would contradict it half the time. */}
            <p className="max-w-prose leading-relaxed">{error}</p>
            <Button size="sm" variant="secondary" className="mt-3" onClick={refresh}>
              <RefreshCwIcon className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />
              Try again
            </Button>
          </Callout>
        }

        {/* The copy, and the retry that goes with it, moved to NoAccountNotice — verbatim.
            It was inline here and nowhere else, so Studio, the specification screen and the
            designer each answered the same state with whatever their own fall-through
            happened to be. One of the three fixes it names is now a real fix, too: the retry
            re-reads the ENTITLEMENT rather than the products, which is the read that failed
            and the only one that can produce an account id. */}
        {status === 'no-account' && <NoAccountNotice />}

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
                        {/* NOT "Outputs", which read as outputs the product HOLDS. Batchlabel
                            generates no file, so this is still the count of surfaces this
                            product needs — never a count of files anybody has. What CAN be
                            counted now is how many of them the maker has recorded printing,
                            which is the clause after the comma. */}
                        <th scope="col" className="px-5 py-3 font-medium">Outputs to produce</th>
                        <th scope="col" className="px-5 py-3 font-medium">Last print recorded</th>
                        <th scope="col" className="px-5 py-3 font-medium">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {inCategory.map((product) => {
                        /**
                         * THE SAME QUEUE STUDIO SHOWS, NOT A SECOND OPINION ABOUT IT.
                         *
                         * This read `outstandingObligations(product).length`, which is the
                         * regime checklist and only the regime checklist: it never looked at
                         * the pipeline stages, so a product with no base wax, no packaging and
                         * no net quantity — three CLP Article 17 label elements, three rows in
                         * Studio's queue in the same session — counted zero here and got a
                         * green "Complete". Two screens, opposite answers, about a product that
                         * cannot legally be labelled.
                         *
                         * `queueFor` is the union: the composition, classification and output
                         * stages AND the outstanding obligations, which the outputs stage
                         * already folds in. One function answers "what is left on this
                         * product", so the two screens cannot disagree by construction.
                         */
                        const queue = queueFor(
                          product,
                          derive(product.spec, product, product.markets[0]),
                          product.markets[0]
                        );
                        const outstanding = queue.issues.length;
                        // `out-of-date` only. This read `!a.current`, and `current` was true
                        // for every surface nobody had produced — so the count was structurally
                        // zero on a real account and would have counted unproduced and
                        // uncheckable surfaces as stale the moment it was not.
                        const stale = product.artefacts.filter(
                          (a) => a.currency === 'out-of-date'
                        ).length;
                        const printed = product.artefacts.
                        filter((a) => a.currency !== 'not-produced').
                        map((a) => a.printedOn).
                        filter((date) => date && date !== '\u2014').
                        sort();
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
                                <span className="text-clay-dark">
                                    , {stale} no longer matching
                                  </span>
                                }
                              </td>
                              {/* The most recent print this account RECORDED, or a dash.
                                  It used to read `product.artefacts[0]?.printedOn`, which was
                                  the em dash placeholder on every row of every real account
                                  under a heading saying "Last produced" — a column that could
                                  only ever be empty. It now has a source, and an empty one
                                  still means nothing was recorded rather than nothing exists. */}
                              <td className="tabular px-5 py-3.5 text-ink-secondary">
                                {printed.length ?
                                formatDate(printed[printed.length - 1]) :
                                <span className="text-ink-tertiary">No print recorded</span>}
                              </td>
                              {/* THREE STATES, BECAUSE THERE ARE THREE. Work we found, work we
                                  found none of, and a check that could not run — the last of
                                  which used to be painted with the second. "Complete" is also
                                  gone as a word: what an empty queue establishes is that
                                  nothing Batchlabel checks is outstanding, which is not the
                                  same claim as a finished product. */}
                              <td className="px-5 py-3.5">
                                {outstanding ?
                                <Pill tone="warn">{outstanding} outstanding</Pill> :
                                queue.blocked.length ?
                                <Pill tone="quiet">Not fully checked</Pill> :
                                <Pill tone="good">Nothing outstanding</Pill>}
                                {queue.blocked.length > 0 &&
                                <p className="mt-1 max-w-[22ch] text-2xs leading-relaxed text-ink-tertiary">
                                    {queue.blocked.join(', and ')}.
                                  </p>
                                }
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
