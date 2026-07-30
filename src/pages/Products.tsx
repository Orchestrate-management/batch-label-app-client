import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { PlusIcon } from 'lucide-react';
import { PageHeader } from '../components/AppShell';
import { Button, Card, EmptyState, Pill, SectionTitle } from '../components/ui/Primitives';
import { NewProductDialog } from '../components/NewProductDialog';
import { CATEGORIES, driftFor } from '../lib/products';
import { obligationsFor } from '../lib/regimes';
import { specSummary } from '../lib/derive';
import { formatDate } from '../lib/model';
import { useProducts, useWorkspace } from '../lib/workspace';

/**
 * Grouped by category, so a separate category filter would say the same thing
 * twice. One table language, shared with materials and records.
 */
export function Products() {
  const navigate = useNavigate();
  const { enabledCategories } = useWorkspace();
  const allProducts = useProducts();
  const [creating, setCreating] = useState(false);
  const categories = CATEGORIES.filter((category) => enabledCategories.includes(category.id));

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
        {categories.map((category) => {
          const products = allProducts.filter((product) => product.categoryId === category.id);
          return (
            <section key={category.id} aria-label={category.name}>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <SectionTitle>{category.name}</SectionTitle>
                <p className="text-2xs text-ink-tertiary">{category.blurb}</p>
              </div>

              {products.length === 0 ?
              <EmptyState
                icon={<PlusIcon className="h-5 w-5" strokeWidth={1.25} aria-hidden="true" />}
                title={`Nothing in ${category.name.toLowerCase()} yet`}
                body={`Create one and the pipeline will ask for the materials it needs, then produce the label and the safety data sheet from them.`}
                action={
                <Button variant="secondary" onClick={() => setCreating(true)}>
                      New {category.name.toLowerCase()} product
                    </Button>
                } /> :


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
                        {products.map((product) => {
                        const outstanding = obligationsFor(product).filter(
                          (obligation) => !product.obligations[obligation.id]
                        ).length;
                        const drift = driftFor(product);
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
                                    {product.sku}
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
                              {drift &&
                            <tr className="border-b border-paper-line last:border-0">
                                  <td colSpan={5} className="px-5 pb-3.5">
                                    <p className="max-w-prose text-2xs leading-relaxed text-clay-dark">
                                      {drift.sentence}
                                    </p>
                                  </td>
                                </tr>
                            }
                            </React.Fragment>);

                      })}
                      </tbody>
                    </table>
                  </div>
                </Card>
              }
            </section>);

        })}
      </div>
    </main>);

}