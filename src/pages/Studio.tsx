import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRightIcon, FileTextIcon, PlusIcon } from 'lucide-react';
import { PageHeader } from '../components/AppShell';
import { NewProductDialog } from '../components/NewProductDialog';
import { Button, Card, Pill, SectionTitle, Skeleton } from '../components/ui/Primitives';
import { categoryById } from '../lib/products';
import { INBOX } from '../lib/catalog';
import { derive } from '../lib/derive';
import { outstandingFor } from '../lib/pipeline';
import { useProducts } from '../lib/workspace';

/**
 * A work queue, not a dashboard. Every row is something standing between a
 * product and shipping. Nothing here restates what another screen already says.
 */
export function Studio() {
  const navigate = useNavigate();
  const products = useProducts();
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setLoading(false), 400);
    return () => window.clearTimeout(timer);
  }, []);

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
  const stale = products.reduce(
    (sum, product) => sum + product.artefacts.filter((artefact) => !artefact.current).length,
    0
  );

  return (
    <main className="flex-1 pb-24 xl:pb-0">
      <PageHeader
        eyebrow="Thursday, 30 July"
        title="Good morning, Nadia"
        description="Ingredients in, the right label and a compliant safety data sheet out. Here is what is between you and that today."
        actions={
        <>
            <Button variant="secondary" onClick={() => setCreating(true)}>
              <PlusIcon className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />
              New product
            </Button>
            <Button variant="primary" onClick={() => navigate('/materials/ingredient')}>
              <FileTextIcon className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />
              Read a data sheet
            </Button>
          </>
        }
        meta={
        loading ?
        <Skeleton className="h-4 w-72 bg-paper-line/70" /> :

        <p className="text-[0.8125rem] text-ink-secondary">
              <Link to="/materials/ingredient" className="text-teal hover:text-teal-hover">
                <span className="tabular">{INBOX.length}</span> documents waiting to be read
              </Link>
              <span className="mx-2 text-ink-tertiary" aria-hidden="true">
                ·
              </span>
              <span className="tabular">{stale}</span> outputs out of date
              <span className="mx-2 text-ink-tertiary" aria-hidden="true">
                ·
              </span>
              <span className="tabular">{total}</span> things outstanding across{' '}
              <span className="tabular">{outstanding.length}</span> products
            </p>

        } />
      

      {creating && <NewProductDialog onClose={() => setCreating(false)} />}

      <div className="px-6 py-8 lg:px-10">
        <SectionTitle className="mb-3">Outstanding</SectionTitle>

        {loading ?
        <div className="space-y-4">
            {[0, 1].map((index) =>
          <Card key={index} className="px-5 py-5">
                <Skeleton className="h-3.5 w-40 bg-paper-line/70" />
                <Skeleton className="mt-4 h-3 w-full bg-paper-line/70" />
                <Skeleton className="mt-2.5 h-3 w-4/5 bg-paper-line/70" />
              </Card>
          )}
          </div> :
        outstanding.length === 0 ?
        <Card className="px-6 py-8">
            <p className="font-display text-base font-medium text-ink">Nothing outstanding</p>
            <p className="mt-1 max-w-prose text-sm leading-relaxed text-ink-secondary">
              Every product has current documents, a settled composition and outputs that match it.
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
      </div>
    </main>);

}