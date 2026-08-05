import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  ClipboardListIcon,
  PlusIcon,
  RefreshCwIcon,
  SearchIcon } from
'lucide-react';
import { PageHeader } from '../components/AppShell';
import { NoAccountNotice } from '../components/NoAccountNotice';
import { PlanNotice } from '../components/PlanNotice';
import { RecordBatchDialog } from '../components/RecordBatchDialog';
import {
  Button,
  Callout,
  Card,
  EmptyState,
  Field,
  FormError,
  Input,
  Pill,
  SectionTitle,
  Select,
  Skeleton } from
'../components/ui/Primitives';
import { ARTEFACT_LABELS } from '../lib/categories';
import { useEntitlement } from '../lib/entitlement';
import { Product } from '../lib/model';
import { useProducts } from '../lib/product-store';
import {
  EVENT_GROUP,
  EVENT_LABELS,
  GROUP_LABELS,
  artefactCurrency,
  currentSourceFingerprint,
  fetchProducedArtefacts,
  fetchRecordLog,
  insertEvent,
  recallByArtefact,
  recallByLot,
  unitsAcross,
  type ProducedArtefact,
  type RecallResult,
  type RecordEvent,
  type RecordEventGroup } from
'../lib/records';

/**
 * THE LOG. What happened and when, referenceable at any point.
 *
 * WHAT THIS SCREEN USED TO BE, twice over, because both versions are the argument for this
 * one. First it was ten production runs of a business that does not exist, made by Nadia, Tom
 * and Priya, with a recall search on top of them — a search that could answer "no run used a
 * lot matching that" to a real maker typing a real lot number, which is a false negative on a
 * recall rendered as a confident sentence. Then it was 82 lines saying, correctly, that there
 * was nowhere to store a run and therefore nothing honest to show.
 *
 * There is somewhere now: `batchlabel.record_events` and its two children. So this screen is
 * the log — every entry read from that table, newest first, filterable, with the recall search
 * answering from the same rows.
 *
 * THE ONE RULE THIS SCREEN IS BUILT AROUND. "No batch used this lot" and "you have not
 * recorded any batches" are opposite instructions to give somebody on the morning a supplier
 * withdraws a drum, and a screen that merges them is worse than a screen with no search on it.
 * Every recall answer here therefore carries the number of batch records it searched, counted
 * by the database, and the three outcomes — a match, an empty search over N records, and an
 * empty search over none — get three different sentences. A FOURTH state, the search that
 * failed, never borrows any of them: a failure says it failed and says outright that it is not
 * an answer of "no".
 *
 * WHAT IS STILL A PLACEHOLDER, AND IT SAYS SO. Batchlabel does not generate label artwork.
 * Every row in `batchlabel.artefacts` this app writes has `is_placeholder` true and no file
 * behind it — what it records is that the maker applied a version of their own label, and the
 * fingerprint of what the composition was at that moment. The fingerprint is real and it is
 * what makes the recall join worth anything. The screen says which of the two it is wherever
 * a version appears.
 */
export function Records() {
  const { recordCode } = useParams();
  const entitlement = useEntitlement();
  const { products, status: productsStatus } = useProducts();

  const [group, setGroup] = useState<RecordEventGroup | 'all'>('all');
  const [productId, setProductId] = useState('');
  const [recording, setRecording] = useState(false);
  const [noting, setNoting] = useState(false);

  const log = useRecordLog({
    accountId: entitlement.loading ? null : entitlement.accountId,
    resolved: !entitlement.loading,
    suspended: !entitlement.loading && entitlement.status === 'suspended',
    group: group === 'all' ? undefined : group,
    productId: productId || undefined,
    // `/records/:recordCode` still resolves here rather than falling through to the catch-all
    // redirect, and now it does something: it filters the log to that batch code. An address
    // that matches nothing says so as an empty filter, not as an error and not as a redirect
    // back to Studio.
    batchCode: recordCode
  });

  const productsById = useMemo(() => {
    const map = new Map<string, Product>();
    for (const product of products) map.set(product.id, product);
    return map;
  }, [products]);

  return (
    <main className="flex-1 pb-24 xl:pb-0">
      <PageHeader
        eyebrow="Products · records"
        title="Records"
        description="Everything Batchlabel has recorded, newest first: what you made, which lots went into it, and which label version went on it. Nothing here can be edited or deleted once it is written — a mistake is corrected by adding another entry."
        actions={
        log.status === 'ready' ?
        <>
              <Button variant="secondary" onClick={() => setNoting((open) => !open)}>
                Add a note
              </Button>
              <Button variant="primary" onClick={() => setRecording(true)}>
                <PlusIcon className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />
                Record a batch
              </Button>
            </> :
        undefined
        } />


      {recording &&
      <RecordBatchDialog
        products={products}
        accountId={entitlement.accountId}
        onClose={() => setRecording(false)}
        onRecorded={log.refresh} />

      }

      <div className="space-y-8 px-6 py-8 lg:px-10">
        {log.status === 'unavailable' && <PlanNotice states={['suspended']} />}
        {log.status === 'no-account' && <NoAccountNotice />}

        {log.status === 'error' &&
        <Callout tone="warn" role="alert" title="We could not read your records">
            <p className="max-w-prose leading-relaxed">
              {log.error} This is not an empty log — it is a log we could not read, and the two
              would look the same if we drew one anyway.
            </p>
            <Button size="sm" variant="secondary" className="mt-3" onClick={log.refresh}>
              <RefreshCwIcon className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />
              Try again
            </Button>
          </Callout>
        }

        {log.status === 'loading' &&
        <div className="space-y-4" aria-busy="true" aria-label="Reading your records">
            {[0, 1, 2].map((index) =>
          <Card key={index} className="px-5 py-5">
                <Skeleton className="h-3.5 w-48 bg-paper-line/70" />
                <Skeleton className="mt-4 h-3 w-full bg-paper-line/70" />
              </Card>
          )}
          </div>
        }

        {log.status === 'ready' &&
        <>
            <Recall
            accountId={entitlement.accountId}
            products={products}
            productsReady={productsStatus === 'ready'} />


            {noting &&
            <NoteForm
              accountId={entitlement.accountId}
              products={products}
              onClose={() => setNoting(false)}
              onWritten={log.refresh} />

            }

            <section aria-labelledby="the-log">
              <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
                <SectionTitle>
                  <span id="the-log">The log</span>
                </SectionTitle>
                <div className="flex flex-wrap items-end gap-2">
                  <Field label="Show" className="w-[170px]">
                    <Select
                    value={group}
                    onChange={(event) =>
                    setGroup(event.target.value as RecordEventGroup | 'all')
                    }>

                      <option value="all">Everything</option>
                      {(Object.keys(GROUP_LABELS) as RecordEventGroup[]).map((key) =>
                    <option key={key} value={key}>
                          {GROUP_LABELS[key]}
                        </option>
                    )}
                    </Select>
                  </Field>
                  <Field label="Product" className="w-[200px]">
                    <Select
                    value={productId}
                    onChange={(event) => setProductId(event.target.value)}>

                      <option value="">Every product</option>
                      {products.map((product) =>
                    <option key={product.id} value={product.id}>
                          {product.name}
                        </option>
                    )}
                    </Select>
                  </Field>
                </div>
              </div>

              {recordCode &&
            <Callout tone="info" className="mb-3">
                  <p className="max-w-prose leading-relaxed">
                    Filtered to batch code{' '}
                    <span className="tabular font-medium">{recordCode}</span>.{' '}
                    <Link to="/records" className="font-medium text-teal hover:text-teal-hover">
                      Show the whole log
                    </Link>
                  </p>
                </Callout>
            }

              {log.events.length === 0 ?
            <EmptyLog filtered={Boolean(group !== 'all' || productId || recordCode)} /> :

            <ol className="space-y-3">
                  {log.events.map((event) =>
              <li key={event.id}>
                      <LogEntry event={event} product={productsById.get(event.productId ?? '')} />
                    </li>
              )}
                </ol>
            }

              {log.truncated &&
            <p className="mt-4 max-w-prose text-2xs leading-relaxed text-ink-tertiary">
                  This is the most recent 200 entries and there are more below them. The recall
                  search above is not limited in the same way — it asks the database over your
                  whole log, which is the only way its answer would be worth anything.
                </p>
            }
            </section>
          </>
        }
      </div>
    </main>);

}

/* ------------------------------------------------------------- the entry */

function LogEntry({ event, product }: {event: RecordEvent;product?: Product;}) {
  const group = EVENT_GROUP[event.kind];
  const lateBy = writtenUpLate(event.occurredAt, event.recordedAt);

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-paper-line bg-paper-panel/60 px-5 py-3">
        <span className="flex flex-wrap items-center gap-2">
          <Pill tone={group === 'production' ? 'good' : 'quiet'}>{EVENT_LABELS[event.kind]}</Pill>
          {product ?
          <Link
            to={`/products/${product.id}`}
            className="text-[0.8125rem] font-medium text-ink hover:text-teal">

              {product.name}
            </Link> :
          null}
        </span>
        <span className="text-2xs text-ink-tertiary">
          <time dateTime={event.occurredAt}>{longDate(event.occurredAt)}</time>
          {/* Both timestamps, but only when they differ by more than a day. occurred_at is
              when the units were made and is what a recall works backwards from; recorded_at
              is when we learned of it. A log that showed only the second would be wrong about
              the one field that matters most, and one that always showed both would be noise
              on the entries written the moment they happened. */}
          {lateBy &&
          <span className="ml-2">
              · written up <time dateTime={event.recordedAt}>{longDate(event.recordedAt)}</time>
            </span>
          }
        </span>
      </div>

      <div className="px-5 py-4">
        <p className="text-sm font-medium text-ink">{event.summary}</p>

        <dl className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-2xs text-ink-secondary">
          {event.batchCode &&
          <span>
              <dt className="inline text-ink-tertiary">Batch </dt>
              <dd className="inline tabular font-medium text-ink">{event.batchCode}</dd>
            </span>
          }
          {typeof event.units === 'number' &&
          <span>
              <dt className="inline text-ink-tertiary">Units </dt>
              <dd className="inline tabular">{event.units}</dd>
            </span>
          }
          {event.reference &&
          <span>
              <dt className="inline text-ink-tertiary">Reference </dt>
              <dd className="inline tabular">{event.reference}</dd>
            </span>
          }
          {event.obligationId &&
          <span>
              <dt className="inline text-ink-tertiary">Obligation </dt>
              <dd className="inline">{event.obligationId}</dd>
            </span>
          }
        </dl>

        {event.lots.length > 0 &&
        <div className="mt-3">
            <p className="text-2xs font-medium uppercase tracking-[0.1em] text-ink-tertiary">
              Input lots
            </p>
            <ul className="mt-1 space-y-0.5 text-[0.8125rem] text-ink-secondary">
              {event.lots.map((lot) =>
            <li key={lot.id}>
                  <span className="tabular font-medium text-ink">{lot.lot}</span>
                  {lot.materialRef && <span> · {lot.materialRef}</span>}
                  {typeof lot.quantity === 'number' &&
              <span className="tabular">
                      {' '}
                      · {lot.quantity}
                      {lot.unit ? ` ${lot.unit}` : ''}
                    </span>
              }
                </li>
            )}
            </ul>
          </div>
        }

        {event.artefacts.length > 0 &&
        <div className="mt-3">
            <p className="text-2xs font-medium uppercase tracking-[0.1em] text-ink-tertiary">
              Label version applied
            </p>
            <ul className="mt-1 space-y-0.5 text-[0.8125rem] text-ink-secondary">
              {event.artefacts.map((artefact) =>
            <li key={artefact.id}>
                  {ARTEFACT_LABELS[artefact.artefactType]}{' '}
                  <span className="tabular">v{artefact.version}</span>
                  {artefact.isPlaceholder &&
              <span className="text-ink-tertiary"> · your own artwork, recorded here</span>
              }
                </li>
            )}
            </ul>
          </div>
        }

        {typeof event.detail.note === 'string' && event.detail.note.trim() !== '' &&
        <p className="mt-3 max-w-prose text-[0.8125rem] leading-relaxed text-ink-secondary">
            {event.detail.note}
          </p>
        }
      </div>
    </Card>);

}

/**
 * An empty log, said as an empty log.
 *
 * TWO SENTENCES, NOT ONE, AND THE DIFFERENCE IS THE WHOLE POINT. An account that has recorded
 * nothing is at the beginning; a filter that matched nothing is a filter. Neither is a
 * failure, and the failure has its own callout further up which this component never renders.
 *
 * THE FILTERED SENTENCE SAYS NOTHING ABOUT THE REST OF THE LOG, and the first draft of it did:
 * "Your log is not empty — this view of it is." That is a claim, and it is false for the
 * account that has recorded nothing AND arrived on a `/records/:batchCode` link. The read was
 * filtered, so the only thing established is that the filter matched nothing.
 */
function EmptyLog({ filtered }: {filtered: boolean;}) {
  if (filtered) {
    return (
      <EmptyState
        icon={<ClipboardListIcon className="h-5 w-5" strokeWidth={1.25} aria-hidden="true" />}
        title="Nothing in the log matches this filter"
        body="This is a filtered view, so this says nothing about the rest of your log. Widen the filters above to see everything in it." />);


  }
  return (
    <EmptyState
      icon={<ClipboardListIcon className="h-5 w-5" strokeWidth={1.25} aria-hidden="true" />}
      title="Nothing recorded yet"
      body="This log fills up as you work: a product created, a composition changed, a batch produced, a label version applied. Record your first batch and it becomes the thing you look back at when somebody asks what you made and when." />);


}

/* ------------------------------------------------------------------ note */

/**
 * The only way to correct an entry, because there is no other way.
 *
 * `record_events` refuses UPDATE and DELETE from every session carrying a JWT, and
 * `authenticated` is granted neither verb in the first place. So "a mistake is corrected by
 * adding another entry" — which this screen and the batch form both say — is not a design
 * preference to be explained away; it is the only mechanism there is. A screen that says it
 * and then offers no way to add an entry other than recording a whole batch would be stating
 * a capability that does not exist, which is the defect this work is about.
 */
function NoteForm({
  accountId,
  products,
  onClose,
  onWritten




}: {accountId: string | null;products: Product[];onClose: () => void;onWritten: () => void;}) {
  const [text, setText] = useState('');
  const [productId, setProductId] = useState('');
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (saving || !text.trim() || !accountId) return;
    setSaving(true);
    setFailure(null);
    const result = await insertEvent({
      accountId,
      kind: 'note',
      summary: text.trim(),
      productId: productId || null
    });
    setSaving(false);
    if (!result.ok) {
      // Held open with the text still in it. Retyping a correction is how a correction stops
      // being written down.
      setFailure(result.message);
      return;
    }
    onWritten();
    onClose();
  };

  return (
    <Card className="px-5 py-5">
      <form onSubmit={submit} className="space-y-3">
        <Field
          label="Add a note to the log"
          hint="Dated and attributed the moment you add it, and permanent once it is there.">

          <Input
            autoFocus
            value={text}
            placeholder="The batch code on BF-2026-014 was written down wrong; the tins say BF-2026-041"
            onChange={(field) => setText(field.target.value)} />

        </Field>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <Field label="About" className="min-w-[200px] flex-1">
            <Select value={productId} onChange={(field) => setProductId(field.target.value)}>
              <option value="">Nothing in particular</option>
              {products.map((product) =>
              <option key={product.id} value={product.id}>
                  {product.name}
                </option>
              )}
            </Select>
          </Field>
          <div className="flex gap-2">
            <Button type="button" variant="quiet" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" variant="secondary" disabled={!text.trim() || saving || !accountId}>
              {saving ? 'Adding…' : 'Add to the log'}
            </Button>
          </div>
        </div>
        {failure && <FormError>{failure}</FormError>}
      </form>
    </Card>);

}

/* ---------------------------------------------------------------- recall */

type RecallMode = 'lot' | 'artefact';

/**
 * The recall search, and the four answers it is allowed to give.
 *
 * Read the module header of lib/records.ts before changing anything here. The short version:
 * a match, an empty search over N batch records, an empty search over none, and a search that
 * failed are four different things, and only one of them may be phrased as "nothing matched".
 * The count that separates the middle two is `totalBatchRecords`, counted by the database over
 * the same table the search ran against, and a failure to count it fails the whole answer
 * rather than defaulting to nought.
 */
function Recall({
  accountId,
  products,
  productsReady



}: {accountId: string | null;products: Product[];productsReady: boolean;}) {
  const [mode, setMode] = useState<RecallMode>('lot');
  const [lot, setLot] = useState('');
  const [productId, setProductId] = useState(products[0]?.id ?? '');
  const [versions, setVersions] = useState<ProducedArtefact[] | null>(null);
  const [versionId, setVersionId] = useState('');
  const [searching, setSearching] = useState(false);
  const [result, setResult] = useState<{answer: RecallResult;query: string;} | null>(null);
  /**
   * What this product's label would be produced from RIGHT NOW, from the database's own
   * function. Null means we could not read it, and null is rendered as "we could not check" —
   * never as either answer. See `artefactCurrency`.
   */
  const [currentHash, setCurrentHash] = useState<string | null>(null);

  useEffect(() => {
    if (mode !== 'artefact' || !productId) return;
    let active = true;
    setVersions(null);
    setCurrentHash(null);
    void fetchProducedArtefacts(accountId, productId).then((response) => {
      if (!active) return;
      // A failed read leaves `versions` null, which renders as "we could not read them" rather
      // than as an empty picker. An empty picker says this product has no recorded versions,
      // and that is a claim.
      setVersions(response.ok ? response.artefacts : null);
      setVersionId(response.ok ? response.artefacts[0]?.id ?? '' : '');
    });
    void currentSourceFingerprint(productId).then((hash) => {
      if (active) setCurrentHash(hash);
    });
    return () => {
      active = false;
    };
  }, [accountId, mode, productId]);

  const selected = versions?.find((entry) => entry.id === versionId) ?? null;

  const search = async (event: React.FormEvent) => {
    event.preventDefault();
    if (searching) return;
    setSearching(true);
    if (mode === 'lot') {
      const trimmed = lot.trim();
      if (!trimmed) {
        setSearching(false);
        return;
      }
      setResult({ answer: await recallByLot(accountId, trimmed), query: `lot ${trimmed}` });
    } else {
      if (!versionId) {
        setSearching(false);
        return;
      }
      const version = versions?.find((entry) => entry.id === versionId);
      setResult({
        answer: await recallByArtefact(accountId, versionId),
        query: version ?
        `${ARTEFACT_LABELS[version.artefactType].toLowerCase()} v${version.version}` :
        'that label version'
      });
    }
    setSearching(false);
  };

  return (
    <section aria-labelledby="recall">
      <SectionTitle className="mb-3">
        <span id="recall">Recall</span>
      </SectionTitle>
      <Card className="px-5 py-5">
        <p className="max-w-prose text-sm leading-relaxed text-ink-secondary">
          Two questions, both answered from your production records and from nothing else:
          which batches used a supplier lot, and which batches carry a label version you have
          since found wrong.
        </p>

        <div className="mt-4 flex flex-wrap gap-1.5" role="group" aria-label="What to search by">
          {(['lot', 'artefact'] as RecallMode[]).map((option) =>
          <button
            key={option}
            type="button"
            aria-pressed={mode === option}
            onClick={() => {
              setMode(option);
              setResult(null);
            }}
            className={`rounded-control border px-3 py-2 text-[0.8125rem] transition-colors ${
            mode === option ?
            'border-teal bg-teal-tint text-teal-hover' :
            'border-paper-line bg-paper text-ink-secondary hover:bg-paper-panel'}`
            }>

              {option === 'lot' ? 'By input lot' : 'By label version'}
            </button>
          )}
        </div>

        <form onSubmit={search} className="mt-4 flex flex-wrap items-end gap-3">
          {mode === 'lot' ?
          <Field
            label="Lot number"
            className="min-w-[220px] flex-1"
            hint="Matched exactly, ignoring case. LOT-12 will not match LOT-120.">

              <Input
              className="tabular"
              value={lot}
              placeholder="LOT-88213"
              onChange={(event) => setLot(event.target.value)} />

            </Field> :

          <>
              <Field label="Product" className="min-w-[200px] flex-1">
                <Select
                value={productId}
                onChange={(event) => {
                  setProductId(event.target.value);
                  setResult(null);
                }}>

                  {products.map((product) =>
                <option key={product.id} value={product.id}>
                      {product.name}
                    </option>
                )}
                </Select>
              </Field>
              <Field label="Version" className="min-w-[200px] flex-1">
                <Select
                value={versionId}
                disabled={!versions || versions.length === 0}
                onChange={(event) => setVersionId(event.target.value)}>

                  {(versions ?? []).map((version) =>
                <option key={version.id} value={version.id}>
                      {ARTEFACT_LABELS[version.artefactType]} v{version.version}
                    </option>
                )}
                </Select>
              </Field>
            </>
          }
          <Button
            type="submit"
            variant="secondary"
            disabled={
            searching ||
            mode === 'lot' && !lot.trim() ||
            mode === 'artefact' && !versionId
            }>

            <SearchIcon className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />
            {searching ? 'Searching…' : 'Search'}
          </Button>
        </form>

        {mode === 'artefact' && !productsReady &&
        <p className="mt-3 max-w-prose text-2xs leading-relaxed text-ink-tertiary">
            Your products have not finished loading, so this list may not be all of them yet.
          </p>
        }
        {mode === 'artefact' && versions !== null && versions.length === 0 &&
        <p className="mt-3 max-w-prose text-2xs leading-relaxed text-ink-tertiary">
            No label version has been recorded against this product, so there is nothing here to
            search by. A version is recorded when you record a batch.
          </p>
        }
        {mode === 'artefact' && versions === null && productId &&
        <p className="mt-3 max-w-prose text-2xs leading-relaxed text-clay-dark">
            We could not read the label versions for this product. This is not a statement that
            it has none.
          </p>
        }

        {mode === 'artefact' && selected &&
        <VersionCurrency artefact={selected} currentHash={currentHash} />
        }

        {result && <RecallAnswer answer={result.answer} query={result.query} />}
      </Card>
    </section>);

}

/**
 * Whether the version being searched for still matches what would print today.
 *
 * A REAL FACT, FROM A REAL FUNCTION. `artefact_source_fingerprint` reads the composition, the
 * pack, the state of every material the composition names, and the printed business identity;
 * the version carries what it
 * returned when the version was recorded. Equal means nothing that prints has moved. It is the
 * one thing on this screen that could be mistaken for a compliance verdict, so the third
 * answer — we could not check — is said in those words rather than defaulting to either.
 */
function VersionCurrency({
  artefact,
  currentHash


}: {artefact: ProducedArtefact;currentHash: string | null;}) {
  const currency = artefactCurrency(artefact, currentHash);
  return (
    <p className="mt-3 max-w-prose text-2xs leading-relaxed text-ink-tertiary">
      {currency === 'current' &&
      'This version still matches the composition, the pack, the classification of every material it names and the business details stored today.'}
      {currency === 'superseded' &&
      'Something that prints has changed since this version was recorded — the composition, the pack, the classification of a material it names, or your business details.'}
      {currency === 'unknown' &&
      'We could not check whether this version still matches what is stored today, so this is not a statement either way.'}
    </p>);

}

function RecallAnswer({ answer, query }: {answer: RecallResult;query: string;}) {
  if (!answer.ok) {
    return (
      <Callout tone="warn" role="alert" className="mt-4" title="The search did not run">
        <p className="max-w-prose leading-relaxed">{answer.message}</p>
      </Callout>);

  }

  // NOTHING SEARCHED. Not "nothing matched" — there was nothing to match against, and on a
  // recall those two sentences send somebody in opposite directions.
  if (answer.totalBatchRecords === 0) {
    return (
      <Callout tone="warn" role="status" className="mt-4" title="There was nothing to search">
        <p className="max-w-prose leading-relaxed">
          You have not recorded any batch production yet, so this is not an answer of “no
          batches are affected” — it is the absence of an answer. If you have been keeping batch
          records elsewhere, they are where this has to be checked.
        </p>
      </Callout>);

  }

  if (answer.matches.length === 0) {
    return (
      <Callout tone="info" role="status" className="mt-4" title="No batch record names it">
        <p className="max-w-prose leading-relaxed">
          None of the <span className="tabular">{answer.totalBatchRecords}</span> batch{' '}
          {answer.totalBatchRecords === 1 ? 'record' : 'records'} in your log names {query}. That
          covers what you have recorded here and nothing else.
        </p>
      </Callout>);

  }

  const { total, stated } = unitsAcross(answer.matches);
  return (
    <div className="mt-4">
      <Callout
        tone="warn"
        role="status"
        title={`${answer.matches.length} batch ${
        answer.matches.length === 1 ? 'record carries' : 'records carry'} ${
        query}`}>

        <p className="max-w-prose leading-relaxed">
          Searched against the <span className="tabular">{answer.totalBatchRecords}</span> batch{' '}
          {answer.totalBatchRecords === 1 ? 'record' : 'records'} in your log.{' '}
          {stated === 0 ?
          'None of them recorded a unit count, so there is no total to give.' :
          stated === answer.matches.length ?
          `They account for ${total} units.` :
          `${stated} of them recorded a unit count, totalling ${total} units; the rest did not, so the real figure is higher.`}
        </p>
      </Callout>
      <ul className="mt-3 divide-y divide-paper-line rounded-card border border-paper-line">
        {answer.matches.map((match) =>
        <li
          key={match.id}
          className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-3">

            <span className="text-sm">
              <span className="tabular font-medium text-ink">{match.batchCode}</span>
              <span className="ml-2 text-ink-secondary">{match.summary}</span>
            </span>
            <span className="text-2xs text-ink-tertiary">
              <time dateTime={match.occurredAt}>{longDate(match.occurredAt)}</time>
              {typeof match.units === 'number' &&
            <span className="tabular"> · {match.units} units</span>
            }
            </span>
          </li>
        )}
      </ul>
    </div>);

}

/* -------------------------------------------------------------- the read */

type LogStatus = 'loading' | 'ready' | 'error' | 'unavailable' | 'no-account';

/**
 * The log read, in the same five states the products store publishes and for the same reasons.
 *
 * They are not interchangeable and the one that matters is `error`: a failed read rendered as
 * an empty log is indistinguishable from an account that has never recorded anything, and to
 * a maker who logged forty batches it reads as data loss. `unavailable` and `no-account` are
 * here because a suspended account and an unfinished signup both read zero rows without
 * failing, and "nothing recorded yet" is false for the first and beside the point for the
 * second.
 *
 * A read of its own rather than another provider: this is the only screen that wants the log,
 * so hoisting it above the router would put a query on every navigation for a page most
 * sessions never open.
 */
function useRecordLog(options: {
  accountId: string | null;
  resolved: boolean;
  suspended: boolean;
  group?: RecordEventGroup;
  productId?: string;
  batchCode?: string;
}): {
  status: LogStatus;
  events: RecordEvent[];
  truncated: boolean;
  error: string | null;
  refresh: () => void;
} {
  const { accountId, resolved, suspended, group, productId, batchCode } = options;
  const [state, setState] = useState<{
    status: LogStatus;
    events: RecordEvent[];
    truncated: boolean;
    error: string | null;
  }>({ status: 'loading', events: [], truncated: false, error: null });
  const [attempt, setAttempt] = useState(0);

  const refresh = useCallback(() => setAttempt((value) => value + 1), []);

  useEffect(() => {
    // Hold at `loading` until the entitlement has answered, so the one read we fire is scoped
    // to the account it resolved. A failed entitlement read still resolves — to null — so this
    // cannot wait forever on one that went wrong.
    if (!resolved) return;
    // A query whose answer we can already predict, and whose answer would be a lie on the
    // screen, is not worth a round trip. Same decision ProductsProvider makes for a suspended
    // membership.
    if (suspended) {
      setState({ status: 'unavailable', events: [], truncated: false, error: null });
      return;
    }
    if (!accountId) {
      setState({ status: 'no-account', events: [], truncated: false, error: null });
      return;
    }
    let active = true;
    void fetchRecordLog(accountId, { group, productId, batchCode }).then((result) => {
      if (!active) return;
      setState(
        result.ok ?
        { status: 'ready', events: result.events, truncated: result.truncated, error: null } :
        { status: 'error', events: [], truncated: false, error: result.message }
      );
    });
    return () => {
      active = false;
    };
  }, [accountId, resolved, suspended, group, productId, batchCode, attempt]);

  return { ...state, refresh };
}

/* ----------------------------------------------------------------- dates */

/** A day and a time, because a log is read by somebody reconstructing an order of events. */
function longDate(iso: string): string {
  if (!iso) return 'Date not recorded';
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;
  return parsed.toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

/**
 * Whether an entry was written up meaningfully after the thing it records.
 *
 * A working day rather than any difference at all: everything recorded as it happens has the
 * two timestamps a few milliseconds apart, and showing both on every line would bury the case
 * this exists for — Tuesday's batch written up on Friday, where the date a recall works
 * backwards from is not the date we learned of it.
 */
function writtenUpLate(occurredAt: string, recordedAt: string): boolean {
  if (!occurredAt || !recordedAt) return false;
  const occurred = new Date(occurredAt).getTime();
  const recorded = new Date(recordedAt).getTime();
  if (Number.isNaN(occurred) || Number.isNaN(recorded)) return false;
  return recorded - occurred > 24 * 60 * 60 * 1000;
}
