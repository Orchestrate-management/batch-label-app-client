import React, { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeftIcon, PlusIcon, SearchIcon } from 'lucide-react';
import { toast } from 'sonner';
import { PageHeader } from '../components/AppShell';
import { Button, Card, Input, Pill, SectionTitle } from '../components/ui/Primitives';
import { ArtefactRail } from '../components/artefact/ArtefactRail';
import { ProductionRecord, formatDate } from '../lib/model';
import { derive } from '../lib/derive';
import { materialById } from '../lib/catalog';
import { RECORDS, categoryById, productById, recordByCode } from '../lib/products';
import { useCategorySurface } from '../lib/workspace';

function matchesQuery(record: ProductionRecord, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return false;
  if (record.lots.some((lot) => lot.lot.toLowerCase().includes(needle))) return true;
  if (record.identity.code.toLowerCase().includes(needle)) return true;
  if (record.identity.kind === 'serial-range') {
    if (
    record.identity.from.toLowerCase().includes(needle) ||
    record.identity.to.toLowerCase().includes(needle))
    {
      return true;
    }
  }
  return record.code.toLowerCase().includes(needle);
}

export function Records() {
  const { recordCode } = useParams();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');

  if (recordCode) {
    const record = recordByCode(recordCode);
    if (record) return <RecordDetail record={record} />;
  }

  const records = RECORDS;

  const lots = Array.from(new Set(records.flatMap((record) => record.lots.map((l) => l.lot)))).slice(
    0,
    6
  );
  const matches = records.filter((record) => matchesQuery(record, query));
  const affectedUnits = matches.reduce((sum, record) => sum + record.units, 0);

  return (
    <main className="flex-1 pb-24 xl:pb-0">
      <PageHeader
        eyebrow="Products · records"
        title="Production records"
        description="Every run, holding the composition and every output version used on the day. A batch for consumables, a serial range for devices."
        actions={
        <Button
          variant="primary"
          onClick={() =>
          toast('Run logged', { description: 'BFC-3007-015 added to the register.' })
          }>
          
            <PlusIcon className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />
            Log a run
          </Button>
        } />
      

      <div className="space-y-8 px-6 py-8 lg:px-10">
        <section aria-labelledby="recall-heading">
          <SectionTitle className="mb-3">
            <span id="recall-heading">Recall search</span>
          </SectionTitle>
          <Card className="px-5 py-5">
            <p className="max-w-prose text-[0.8125rem] leading-relaxed text-ink-secondary">
              Search any material lot, component lot or serial number. Every run that used it comes
              back with unit counts and dates.
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <div className="relative min-w-[280px] flex-1">
                <SearchIcon
                  className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-tertiary"
                  strokeWidth={1.25}
                  aria-hidden="true" />
                
                <Input
                  className="tabular pl-9"
                  placeholder="Lot or serial, for example AUR-24118-B or WW100-26-0001"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  aria-label="Lot or serial number" />
                
              </div>
              <div className="flex flex-wrap gap-2">
                {lots.map((lot) =>
                <button
                  key={lot}
                  type="button"
                  onClick={() => setQuery(lot)}
                  className="tabular rounded-full border border-paper-line px-3 py-1.5 text-2xs text-ink-secondary hover:bg-paper-panel">
                  
                    {lot}
                  </button>
                )}
              </div>
            </div>

            {query &&
            <div className="mt-5">
                {matches.length === 0 ?
              <p className="text-sm text-ink-secondary">
                    No run used a lot or serial matching “{query}”. Check the number stamped on the
                    unit or printed on the supplier label.
                  </p> :

              <>
                    <div className="mb-3 flex flex-wrap items-center gap-2">
                      <Pill tone="warn">
                        <span className="tabular">{matches.length}</span> affected runs
                      </Pill>
                      <Pill tone="warn">
                        <span className="tabular">{affectedUnits}</span> units
                      </Pill>
                      <Pill tone="quiet">
                        {formatDate(matches[matches.length - 1].date)} to{' '}
                        {formatDate(matches[0].date)}
                      </Pill>
                    </div>
                    <RecordTable records={matches} />
                  </>
              }
              </div>
            }
          </Card>
        </section>

        <section aria-labelledby="all-records-heading">
          <SectionTitle className="mb-3">
            <span id="all-records-heading">All runs</span>
          </SectionTitle>
          <RecordTable records={records} onOpen={(code) => navigate(`/records/${code}`)} />
        </section>
      </div>
    </main>);

}

function RecordTable({
  records,
  onOpen



}: {records: ProductionRecord[];onOpen?: (code: string) => void;}) {
  return (
    <Card className="overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[900px] text-left text-sm">
          <thead>
            <tr className="border-b border-paper-line bg-paper-panel/60 text-2xs uppercase tracking-[0.1em] text-ink-tertiary">
              <th scope="col" className="px-5 py-3 font-medium">Code</th>
              <th scope="col" className="px-5 py-3 font-medium">Product</th>
              <th scope="col" className="px-5 py-3 font-medium">Date</th>
              <th scope="col" className="px-5 py-3 font-medium">Units</th>
              <th scope="col" className="px-5 py-3 font-medium">Identity</th>
              <th scope="col" className="px-5 py-3 font-medium">Input lots</th>
              <th scope="col" className="px-5 py-3 font-medium">Outputs</th>
            </tr>
          </thead>
          <tbody>
            {records.map((record) => {
              const product = productById(record.productId);
              return (
                <tr
                  key={record.code}
                  className={`border-b border-paper-line last:border-0 ${onOpen ? 'cursor-pointer hover:bg-teal-tint' : ''}`}
                  onClick={onOpen ? () => onOpen(record.code) : undefined}>
                  
                  <td className="px-5 py-3.5">
                    <Link
                      to={`/records/${record.code}`}
                      className="tabular font-medium text-ink hover:text-teal">
                      
                      {record.code}
                    </Link>
                  </td>
                  <td className="px-5 py-3.5 text-ink-secondary">{product?.name}</td>
                  <td className="tabular px-5 py-3.5 text-ink-secondary">
                    {formatDate(record.date)}
                  </td>
                  <td className="tabular px-5 py-3.5 text-ink-secondary">{record.units}</td>
                  <td className="tabular px-5 py-3.5 text-ink-secondary">
                    {record.identity.kind === 'batch' ?
                    `Batch ${record.identity.code}` :
                    `${record.identity.from} to ${record.identity.to}`}
                  </td>
                  <td className="tabular px-5 py-3.5 text-ink-secondary">
                    {record.lots.
                    slice(0, 2).
                    map((lot) => lot.lot).
                    join(', ')}
                    {record.lots.length > 2 ? ` +${record.lots.length - 2}` : ''}
                  </td>
                  <td className="px-5 py-3.5">
                    <div className="flex flex-wrap gap-1.5">
                      {record.artefactVersions.map((artefact) =>
                      <Pill key={artefact.type} tone="quiet">
                          {artefact.version}
                        </Pill>
                      )}
                    </div>
                  </td>
                </tr>);

            })}
          </tbody>
        </table>
      </div>
    </Card>);

}

function RecordDetail({ record }: {record: ProductionRecord;}) {
  const navigate = useNavigate();
  const product = productById(record.productId)!;
  const category = categoryById(product.categoryId);
  useCategorySurface(product.categoryId);

  const derivation = useMemo(() => derive(product.spec, product, product.markets[0]), [record.code]);
  const identityCode =
  record.identity.kind === 'batch' ? record.identity.code : record.identity.from;

  return (
    <div className="flex min-w-0 flex-1">
      <main className="min-w-0 flex-1 pb-24 xl:pb-0">
        <PageHeader
          eyebrow={`${category.strings.recordNoun} record · specification ${record.specVersion}`}
          title={record.code}
          description={`${product.name}, made ${formatDate(record.date)} by ${record.madeBy}. This is the exact specification and the exact artefact versions used on the day.`}
          actions={
          <Button variant="quiet" onClick={() => navigate('/records')}>
              <ArrowLeftIcon className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />
              Records
            </Button>
          } />
        
        <div className="grid gap-6 px-6 py-8 lg:grid-cols-2 lg:px-10">
          <Card className="px-5 py-5">
            <SectionTitle className="mb-3">The run</SectionTitle>
            <dl className="space-y-2.5 text-sm">
              <Row term="Product" value={product.name} />
              <Row term="Category" value={category.name} />
              <Row term="Units made" value={String(record.units)} />
              <Row term="Date" value={formatDate(record.date)} />
              <Row term="Made by" value={record.madeBy} />
              <Row
                term="Identity"
                value={
                record.identity.kind === 'batch' ?
                `Batch ${record.identity.code}` :
                `Serial ${record.identity.from} to ${record.identity.to}`
                } />
              
            </dl>
            {record.notes &&
            <p className="mt-4 max-w-prose text-[0.8125rem] leading-relaxed text-ink-tertiary">
                {record.notes}
              </p>
            }
          </Card>

          <Card className="px-5 py-5">
            <SectionTitle className="mb-3">Input lots</SectionTitle>
            <table className="w-full text-left text-sm">
              <tbody>
                {record.lots.map((lot) =>
                <tr key={lot.materialId} className="border-b border-paper-line last:border-0">
                    <td className="py-2.5 text-ink">{materialById(lot.materialId)?.name}</td>
                    <td className="tabular py-2.5 text-right text-ink-secondary">{lot.lot}</td>
                  </tr>
                )}
              </tbody>
            </table>
            <p className="mt-4 text-2xs leading-relaxed text-ink-tertiary">
              Any of these lots returns this run from the recall search.
            </p>
          </Card>

          <Card className="px-5 py-5 lg:col-span-2">
            <SectionTitle className="mb-3">Outputs used</SectionTitle>
            <div className="flex flex-wrap gap-2">
              {record.artefactVersions.map((artefact) => {
                const instance = product.artefacts.find((a) => a.type === artefact.type);
                return (
                  <Pill key={artefact.type} tone="neutral">
                    {instance?.label ?? artefact.type} {artefact.version}
                  </Pill>);

              })}
            </div>
            <p className="mt-3 max-w-prose text-[0.8125rem] leading-relaxed text-ink-secondary">
              The rail reconstructs each surface as it was printed for this run. Later versions of
              the same surface do not overwrite what is held here.
            </p>
            {derivation.clp &&
            <p className="tabular mt-3 text-2xs text-ink-tertiary">
                {derivation.clp.signalWord ?? 'No signal word'} ·{' '}
                {derivation.clp.hazards.map((h) => h.code).join(', ') || 'No hazard statements'}
                {product.identifiers.ufi ? ` · UFI ${product.identifiers.ufi}` : ''}
              </p>
            }
            {derivation.cosmetic &&
            <p className="mt-3 text-2xs leading-relaxed text-ink-tertiary">
                Ingredients: {derivation.cosmetic.inciLine}
              </p>
            }
            {derivation.device &&
            <p className="tabular mt-3 text-2xs text-ink-tertiary">
                Model {derivation.device.model} · {derivation.device.ratings} ·{' '}
                {derivation.device.weeeRegistration}
              </p>
            }
          </Card>
        </div>
      </main>

      <ArtefactRail
        product={product}
        derivation={derivation}
        market={product.markets[0]}
        identityCode={identityCode}
        caption="Reconstructed from the specification and artefact versions frozen with this run." />
      
    </div>);

}

function Row({ term, value }: {term: string;value: string;}) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-paper-line pb-2.5 last:border-0 last:pb-0">
      <dt className="text-ink-secondary">{term}</dt>
      <dd className="tabular max-w-[60%] text-right text-ink">{value}</dd>
    </div>);

}