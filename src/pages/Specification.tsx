import React, { useMemo, useState } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { ColumnsIcon, PackageIcon, RefreshCwIcon, SaveIcon } from 'lucide-react';
import { PageHeader } from '../components/AppShell';
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
import { DerivationPanel } from '../components/DerivationPanel';
import { NoAccountNotice } from '../components/NoAccountNotice';
import { PlanNotice } from '../components/PlanNotice';
import { ArtefactRail } from '../components/artefact/ArtefactRail';
import { ArtefactRenderer, defaultArtefactOptions } from '../components/artefact/ArtefactRenderer';
import {
  ArtefactCurrency,
  BomSpec,
  IngredientMaterial,
  Market,
  Material,
  MixtureSpec,
  PhasedSpec,
  Product,
  Spec,
  formatDate } from
'../lib/model';
import { clpMinimumDimensions, derive, phasedTotal } from '../lib/derive';
import { ProductPipeline } from '../components/ProductPipeline';
import { StageId, stagesFor } from '../lib/pipeline';
import { SdsDocumentModel, buildSds } from '../lib/sds';
import {
  ingredientById,
  materialById,
  materialOrigin,
  packagingById } from
'../lib/material-index';
import { useMaterials } from '../lib/materials-store';
import { categoryById } from '../lib/categories';
import { addressForMarket } from '../lib/identity';
import { useEntitlement } from '../lib/entitlement';
import { saveComposition } from '../lib/products';
import { recordEvidence, recordSdsSectionReviewed } from '../lib/evidence';
import { useProduct, useProducts } from '../lib/product-store';
import {
  Obligation,
  obligationOutcome,
  obligationsFor,
  regimeById } from
'../lib/regimes';
import { useCategorySurface } from '../lib/workspace';

/**
 * Resolves the product before anything renders, so the screen below can assume it has one.
 *
 * FIVE ANSWERS, AND THE OLD CODE HAD ONE. It used to be
 * `productById(productId) ?? PRODUCTS[0]` — a URL that matched nothing silently rendered the
 * first fixture product, so a stale bookmark, a deleted product or a typo all showed somebody
 * a fully populated candle with a name and a classification that had nothing to do with what
 * they asked for. There is no fallback here on purpose: not found says not found.
 *
 * `unavailable` is the fifth and it has to come BEFORE the not-found branch, because a
 * suspended account reaches this route with a perfectly good bookmark and no product in the
 * store. The not-found copy says "We read your products and there is nothing here with this
 * address. It may have been archived" — every clause of which is false in that case, and it is
 * the sentence a maker sees on a link they have used every week.
 */
export function Specification() {
  const { productId } = useParams();
  const navigate = useNavigate();
  const { status, product, error, refresh } = useProduct(productId);

  if (status === 'loading') {
    return (
      <main className="flex-1 px-6 py-8 lg:px-10" aria-busy="true" aria-label="Loading product">
        <Skeleton className="h-4 w-40 bg-paper-line/70" />
        <Skeleton className="mt-4 h-8 w-72 bg-paper-line/70" />
        <Skeleton className="mt-6 h-40 w-full bg-paper-line/70" />
      </main>);

  }

  if (status === 'error') {
    return (
      <main className="flex-1 px-6 py-8 lg:px-10">
        <Callout tone="warn" role="alert" title="We could not read this product">
          <p className="max-w-prose leading-relaxed">
            {error} Nothing has been changed. This is not the same as the product not existing
            — we simply could not get an answer.
          </p>
          <Button size="sm" variant="secondary" className="mt-3" onClick={refresh}>
            <RefreshCwIcon className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />
            Try again
          </Button>
        </Callout>
      </main>);

  }

  if (status === 'unavailable') {
    return (
      <main className="flex-1 px-6 py-8 lg:px-10">
        <PlanNotice states={['suspended']} />
      </main>);

  }

  // Also before the not-found branch, and for a sharper version of the same reason. There is
  // no account to scope a read to, so no read was made — and "we read your products and there
  // is nothing here with this address, it may have been archived" is then false in every
  // clause AND is a deletion notice. The most likely reader is a Google signup abandoned at
  // /finish-setup returning to a bookmark: their product is almost certainly still there, and
  // what they need is to be told to go and finish.
  if (status === 'no-account') {
    return (
      <main className="flex-1 px-6 py-8 lg:px-10">
        <NoAccountNotice />
      </main>);

  }

  if (!product) {
    return (
      <main className="flex-1 px-6 py-8 lg:px-10">
        <EmptyState
          icon={<PackageIcon className="h-5 w-5" strokeWidth={1.25} aria-hidden="true" />}
          title="No such product"
          body="We read your products and there is nothing here with this address. It may have been archived, or the link may be out of date."
          action={
          <Button variant="secondary" onClick={() => navigate('/products')}>
              Back to your products
            </Button>
          } />

      </main>);

  }

  return <SpecificationView product={product} />;
}

function SpecificationView({ product }: {product: Product;}) {
  const category = categoryById(product.categoryId);
  useCategorySurface(product.categoryId);
  const { reload } = useProducts();
  // For the record log only. A saved composition writes a line saying so, and the account it
  // is filed under comes from the entitlement, never from this screen. See lib/records.ts.
  const entitlement = useEntitlement();

  const [spec, setSpec] = useState<Spec>(product.spec);
  const [market, setMarket] = useState<Market>(product.markets[0]);
  const [compare, setCompare] = useState(false);
  const [stage, setStage] = useState<StageId>('composition');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [partialSave, setPartialSave] = useState(false);
  const [saved, setSaved] = useState(false);

  const working: Product = { ...product, spec };
  const derivation = useMemo(() => derive(spec, working, market), [spec, market, product.id]);
  const stale = product.artefacts.filter((artefact) => artefact.currency === 'out-of-date');

  /**
   * The batch or serial marking on the preview. A PLACEHOLDER, and it says so on the label.
   *
   * This used to be the string 'BFC-2607-014' — a batch code from a fixture production run,
   * printed at actual size onto the label of whatever product was on screen. A batch code is
   * a traceability claim: it is the number a recall is run against. Printing somebody else's
   * onto a maker's proof is the single worst thing on this page to get wrong, and production
   * records have no table yet, so there is no real one to print.
   */
  const identityCode = category.recordIdentity === 'batch' ? '[Batch code]' : '[Serial number]';

  const stages = useMemo(
    () => stagesFor(working, derivation, market),
    [derivation, market, product.id]
  );
  const sds = product.artefacts.some((artefact) => artefact.type === 'sds') ?
  buildSds(working, derivation, market) :
  null;

  // Compared by value rather than by identity: every keystroke in the editors below builds a
  // new spec object, so an identity check would call an untouched composition dirty the
  // moment somebody dragged the load slider and dragged it back.
  const dirty = JSON.stringify(spec) !== JSON.stringify(product.spec);

  const save = async () => {
    if (saving || !dirty) return;
    setSaving(true);
    setSaveError(null);
    setPartialSave(false);
    setSaved(false);
    const result = await saveComposition(product, spec, entitlement.accountId);
    setSaving(false);
    if (!result.ok) {
      setSaveError(result.message);
      // A partial save COMMITTED the composition, so the shared list is now stale — every
      // other screen would keep drawing the old recipe. Reloading also re-bases `dirty`
      // against what is actually stored, which is the whole point: after this the difference
      // the button is offering to save is the pack, which is exactly the half still missing.
      // What is on screen stays what was typed; `spec` is seeded once and not resynced.
      if (result.reason === 'partial_save') {
        setPartialSave(true);
        await reload();
      }
      return;
    }
    setSaved(true);
    await reload();
  };

  return (
    <div className="flex min-w-0 flex-1">
      <main className="min-w-0 flex-1 pb-24 xl:pb-0">
        <PageHeader
          eyebrow={`${category.name}${product.sku ? ` · ${product.sku}` : ''}`}
          title={product.name}
          description="The composition on this page produces both outputs. Change anything and the label and the safety data sheet move together."
          actions={
          <>
              {product.markets.length > 1 &&
            <Button variant="secondary" onClick={() => setCompare((value) => !value)}>
                  <ColumnsIcon className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />
                  {compare ? 'Hide market comparison' : 'Compare GB and EU'}
                </Button>
            }
              {/* This was "Generate outputs", which raised a toast saying outputs had been
                  generated. Nothing was generated: the label and the sheet are derived on
                  every keystroke and rendered in the rail, and there is no export yet. What
                  the button does now is the write that was actually missing — saving the
                  composition, so that a recipe survives a reload. */}
              <Button variant="primary" onClick={save} disabled={!dirty || saving}>
                <SaveIcon className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />
                {saving ? 'Saving…' : 'Save composition'}
              </Button>
            </>
          }
          meta={
          <>
              {product.regimes.map((regime) =>
            <Pill key={regime} tone="neutral">
                  {regimeById(regime).short}
                </Pill>
            )}
              <Pill tone="quiet">{product.markets.join(' and ')}</Pill>
            </>
          } />
        

        <ProductPipeline stages={stages} activeId={stage} onSelect={setStage} />

        <div className="space-y-10 px-6 py-8 lg:px-10">
          {/* Two different failures and two different titles, because they are not the same
              news. A refused save changed nothing, so the reassurance below it is true. A
              PARTIAL save changed half of it — the recipe is stored against the old pack —
              and "it is only the saving that failed" would be a false sentence printed over
              the one state where the stored product is a combination nobody approved. */}
          {saveError &&
          <Callout
            tone="warn"
            role="alert"
            title={partialSave ? 'Only part of that saved' : 'That did not save'}>

              <p className="max-w-prose leading-relaxed">{saveError}</p>
              {!partialSave &&
            <p className="mt-2 max-w-prose leading-relaxed">
                  What is on screen is still what you typed, and it is still what the preview is
                  drawn from — it is only the saving that failed. Press save again.
                </p>
            }
            </Callout>
          }
          {saved && !dirty && !saveError &&
          <p role="status" className="text-[0.8125rem] text-ink-secondary">
              Composition saved. Every output on this page is derived from it.
            </p>
          }
          {dirty && !saveError &&
          <p role="status" className="text-[0.8125rem] text-ink-secondary">
              Unsaved changes. The classification and both outputs below already reflect them;
              saving is what makes them survive a reload.
            </p>
          }

          <section aria-label="Composition" className="space-y-5">
            <SectionTitle>Composition</SectionTitle>
            {spec.kind === 'mixture' &&
            <MixtureEditor spec={spec} onChange={(next) => setSpec(next)} />
            }
            {spec.kind === 'phased' &&
            <PhasedEditor spec={spec} onChange={(next) => setSpec(next)} />
            }
            {spec.kind === 'bom' && <BomEditor spec={spec} onChange={(next) => setSpec(next)} />}

            <Card className="px-5 py-5">
              <SectionTitle className="mb-3">Market</SectionTitle>
              <div className="flex flex-wrap gap-2">
                {(['GB', 'EU'] as Market[]).map((option) =>
                <button
                  key={option}
                  type="button"
                  onClick={() => setMarket(option)}
                  aria-pressed={market === option}
                  className={`rounded-control border px-4 py-2 text-sm transition-colors ${
                  market === option ?
                  'border-teal bg-teal-tint text-teal-hover' :
                  'border-paper-line bg-paper text-ink-secondary hover:bg-paper-panel'}`
                  }>
                  
                    {option === 'GB' ? 'Great Britain' : 'European Union and Northern Ireland'}
                  </button>
                )}
              </div>
              <p className="mt-3 max-w-prose text-2xs leading-relaxed text-ink-tertiary">
                Address block in use: {addressForMarket(market).lines[0]},{' '}
                {addressForMarket(market).role.toLowerCase()}.{' '}
                {market === 'EU' ?
                'Products sold into the EU or Northern Ireland need an EU based operator named on the artefact.' :
                'A GB address is sufficient for supply in Great Britain.'}
              </p>
            </Card>
          </section>

          <section aria-label="Classification" className="space-y-5">
            <SectionTitle>Classification</SectionTitle>
            <DerivationPanel derivation={derivation} help={category.strings.derivationHelp} />
          </section>

          <section aria-label="Outputs" className="space-y-5">
            <SectionTitle>Outputs</SectionTitle>

            {/* The drift banner and its "Version this output" buttons are gone. Both described
                a difference between a PRINTED artefact and the current composition, and
                nothing stores printed artefacts — the buttons raised a toast saying an output
                had been versioned and versioned nothing. Outputs are derived live from the
                composition above, which is why they cannot fall behind it. */}
            {stale.length > 0 &&
            <Callout tone="warn">
                <p className="max-w-prose leading-relaxed">
                  The composition changed after{' '}
                  {stale.length === 1 ? 'this output was' : 'these outputs were'} produced.
                </p>
              </Callout>
            }

            <Card className="px-5 py-5">
              <ul className="divide-y divide-paper-line">
                {product.artefacts.map((artefact) => {
                  const isSds = artefact.type === 'sds';
                  return (
                    <li
                      key={artefact.type}
                      className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                      
                      <div className="min-w-0">
                        {isSds ?
                        <span className="text-sm font-medium text-ink">{artefact.label}</span> :

                        <Link
                          to={`/products/${product.id}/artefacts/${artefact.type}`}
                          className="text-sm font-medium text-ink hover:text-teal">
                          
                            {artefact.label}
                          </Link>
                        }
                        <p className="tabular mt-0.5 text-2xs text-ink-tertiary">
                          {isSds ? 'A4' : `${artefact.widthMm} × ${artefact.heightMm} mm`} ·{' '}
                          {artefact.version} · {formatDate(artefact.printedOn)}
                        </p>
                      </div>
                      {/* FOUR STATES, ONE PILL EACH. This used to be a two-state good/warn over
                          a boolean that was `true` for every unproduced artefact, so it painted
                          a green "Current" on every row of a list whose every row also said
                          "Not yet produced" — a maker scanning the pills saw four ticks and
                          concluded their label and their sheet were up to date and in
                          existence. Current is now a comparison of two md5s and nothing else
                          may claim it. */}
                      <ArtefactStatePill currency={artefact.currency} />
                    </li>);

                })}
              </ul>
              <p className="mt-4 max-w-prose text-2xs leading-relaxed text-ink-tertiary">
                Batchlabel does not generate the files yet. What it records is that you printed
                a surface and which composition it was printed from, so it can tell you when one
                stops matching. Record a print from the label designer.
              </p>
            </Card>

            {sds && <SdsSummary sds={sds} product={product} onRecorded={reload} />}
          </section>

          <section aria-label="Compliance record" className="space-y-5">
            <SectionTitle>Compliance record</SectionTitle>
            <ComplianceRecord product={product} onRecorded={reload} />
          </section>
        </div>

        {compare &&
        <section
          aria-label="Market comparison"
          className="border-t border-paper-line px-6 py-8 lg:px-10">
          
            <SectionTitle className="mb-4">Great Britain and the European Union, side by side</SectionTitle>
            <div className="grid gap-6 lg:grid-cols-2">
              {(['GB', 'EU'] as Market[]).map((option) =>
            <div key={option}>
                  <div className="mb-3 flex flex-wrap items-center gap-2">
                    <Pill tone={option === market ? 'good' : 'neutral'}>
                      {option === 'GB' ? 'Great Britain' : 'EU and Northern Ireland'}
                    </Pill>
                    <span className="text-2xs text-ink-tertiary">
                      {addressForMarket(option).role}
                    </span>
                  </div>
                  <div className="mm-grid flex justify-center overflow-auto rounded-control border border-paper-line p-4">
                    <ArtefactRenderer
                  product={working}
                  derivation={derive(spec, working, option)}
                  market={option}
                  artefact={product.artefacts[0]}
                  options={defaultArtefactOptions({
                    identityCode,
                    pictogramMm: product.regimes.includes('clp') ?
                    clpMinimumDimensions(
                      packagingById(spec.packagingId)?.capacityMl ?? 100
                    ).pictogram :
                    8
                  })} />
                
                  </div>
                </div>
            )}
            </div>

            <Card className="mt-6 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] text-left text-sm">
                  <thead>
                    <tr className="border-b border-paper-line bg-paper-panel/60 text-2xs uppercase tracking-[0.1em] text-ink-tertiary">
                      <th scope="col" className="px-5 py-3 font-medium">Element</th>
                      <th scope="col" className="px-5 py-3 font-medium">Great Britain</th>
                      <th scope="col" className="px-5 py-3 font-medium">European Union</th>
                    </tr>
                  </thead>
                  <tbody>{comparisonRows(product, spec)}</tbody>
                </table>
              </div>
            </Card>
          </section>
        }
      </main>

      <ArtefactRail
        product={working}
        derivation={derivation}
        market={market}
        identityCode={identityCode} />
      
    </div>);

}

/**
 * One pill per artefact state, and there are four states.
 *
 * `unknown` gets its own quiet pill rather than being folded into either answer: a fingerprint
 * we could not compute is a failure to check, and rendering it as "Current" is the exact shape
 * of defect this screen keeps being corrected for.
 */
function ArtefactStatePill({ currency }: {currency: ArtefactCurrency;}) {
  if (currency === 'not-produced') return <Pill tone="quiet">No print recorded</Pill>;
  if (currency === 'out-of-date') return <Pill tone="warn">No longer matches</Pill>;
  if (currency === 'unknown') return <Pill tone="quiet">Could not check</Pill>;
  return <Pill tone="good">Matches this composition</Pill>;
}

/**
 * The sheet is a legal document, so what it cannot derive is stated rather than
 * quietly filled. This counts those sections, names them, and — new — lets a review be recorded.
 *
 * WHY THE CONTROL HAD TO EXIST HERE. Sections 4, 8, 11 and 13 are hardcoded `needs-you` in
 * lib/sds.ts, so `sds.outstanding` was always 4, on every mixture and every phased product,
 * from the moment it was created, forever. Studio rendered that as "4 sections of the safety
 * data sheet need a competent person" with a Resolve link to this screen — which listed the
 * same four sections and offered nothing at all to do about them. A work queue row that cannot
 * be cleared teaches a maker to stop reading the queue.
 *
 * What is recorded is a REVIEW, not an approval by Batchlabel: the app still does not sign the
 * sheet, and the sentence below says so. The event is `compliance.sds_section_reviewed` on the
 * append-only log, carrying the section number, so it survives and can be shown next to the
 * section it belongs to.
 */
function SdsSummary({
  sds,
  product,
  onRecorded
}: {sds: SdsDocumentModel;product: Product;onRecorded: () => Promise<void>;}) {
  const entitlement = useEntitlement();
  const needsYou = sds.sections.filter((section) => section.kind === 'needs-you');
  const derived = sds.sections.filter((section) => section.kind === 'derived');
  const awaiting = needsYou.filter((section) => !(section.number in product.evidence.sdsSections));

  const [open, setOpen] = useState<number | null>(null);
  const [reviewer, setReviewer] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const submit = async (section: {number: number;title: string;}) => {
    if (saving) return;
    setSaving(true);
    setFailure(null);
    const result = await recordSdsSectionReviewed({
      accountId: entitlement.accountId,
      product,
      section: section.number,
      summary:
      note.trim() ||
      `Section ${section.number}, ${section.title}, reviewed for ${product.name}.`,
      reviewer: reviewer.trim() || null
    });
    setSaving(false);
    if (!result.ok) {
      setFailure(result.message);
      return;
    }
    setOpen(null);
    setReviewer('');
    setNote('');
    // Re-read, so the row below this one is drawn from the stored event rather than from an
    // optimistic guess. The whole reason this section exists is that a screen was claiming a
    // state nothing had established; claiming it locally would be the same mistake in miniature.
    await onRecorded();
  };

  return (
    <Card className="px-5 py-5">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <SectionTitle>Safety data sheet, {sds.version}</SectionTitle>
        <Pill tone={awaiting.length ? 'warn' : 'good'}>
          {awaiting.length ?
          `${awaiting.length} ${awaiting.length === 1 ? 'section needs' : 'sections need'} a competent person` :
          'Every section reviewed'}
        </Pill>
      </div>
      {/* NOT "the supplier sheets on file". No supplier document of this account's is held,
          there is nowhere to put one, and section 16 of the sheet itself now says so plainly —
          this sentence was the last surface still contradicting it. */}
      <p className="mt-2 max-w-prose text-[0.8125rem] leading-relaxed text-ink-secondary">
        {derived.length} of the sixteen sections are derived from the composition and from
        Batchlabel&rsquo;s reference data for the materials in it, and carry the same reasoning
        as the label. The sheet is a draft for review by a competent person; the app produces it
        and shows its working, but does not sign it.
      </p>
      {needsYou.length > 0 &&
      <ul className="mt-4 space-y-3">
          {needsYou.map((section) => {
          const recorded = product.evidence.sdsSections[section.number];
          return (
            <li key={section.number} className="flex gap-3">
                <span
                className={`tabular mt-0.5 flex-none text-2xs font-medium ${
                recorded ? 'text-ink-tertiary' : 'text-clay-dark'}`
                }>

                  {String(section.number).padStart(2, '0')}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[0.8125rem] font-medium text-ink">
                    {section.title}
                  </span>
                  <span className="mt-0.5 block max-w-prose text-2xs leading-relaxed text-ink-tertiary">
                    {recorded ?
                  `${recorded.summary} Recorded as reviewed on ${formatDate(recorded.recordedAt)}. Batchlabel has not checked the wording and does not sign the sheet.` :
                  section.prompt}
                  </span>

                  {!recorded && open !== section.number &&
                <button
                  type="button"
                  onClick={() => {
                    setOpen(section.number);
                    setFailure(null);
                  }}
                  className="mt-1.5 text-2xs font-medium text-teal hover:text-teal-hover">

                      Record that this has been reviewed
                    </button>
                }

                  {open === section.number &&
                <div className="mt-2 space-y-2 rounded-control border border-paper-line bg-paper-panel/60 px-3 py-3">
                      <Field label="Reviewed by" hint="The competent person's name. Optional.">
                        <Input
                      value={reviewer}
                      placeholder="Who confirmed the wording"
                      onChange={(event) => setReviewer(event.target.value)} />

                      </Field>
                      <Field label="What they confirmed" hint="This is the line your log shows.">
                        <Input
                      value={note}
                      placeholder={`Section ${section.number} wording confirmed appropriate for this product`}
                      onChange={(event) => setNote(event.target.value)} />

                      </Field>
                      {failure && <FormError>{failure}</FormError>}
                      <div className="flex justify-end gap-2">
                        <Button
                      type="button"
                      size="sm"
                      variant="quiet"
                      disabled={saving}
                      onClick={() => setOpen(null)}>

                          Cancel
                        </Button>
                        <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      disabled={saving}
                      onClick={() => submit(section)}>

                          {saving ? 'Recording…' : 'Record review'}
                        </Button>
                      </div>
                    </div>
                }
                </span>
              </li>);

        })}
        </ul>
      }
    </Card>);

}

/**
 * Every obligation this product's regimes place on it, what state it is in, and — where the
 * maker can discharge it — a control that writes to the append-only log.
 *
 * THIS IS THE SCREEN THE "RESOLVE" LINKS WERE POINTING AT AND NOT FINDING. Fifteen obligations
 * were permanently outstanding because the only thing that could satisfy them was
 * `products.obligations`, a jsonb column written by nothing; nine of their Resolve links went
 * to /settings, whose identity fields were `disabled readOnly` and bound to a constant. So the
 * work queue sent a maker to a screen with nothing on it that could change the row that sent
 * them there, and the row came back next time.
 *
 * WHAT A RECORDED ENTRY CLAIMS, EXACTLY. That the maker said they did it, on a date, with a
 * reference. Not that Batchlabel saw a document, checked a portal or verified anything — the
 * three states below are worded from lib/regimes.ts, where every `missingText` is now a
 * sentence about our log rather than a finding about the business.
 *
 * THERE IS NO UNDO, AND THAT IS THE DESIGN. `record_events` is append-only in three separate
 * ways, and a correction is another event: the reader takes the most recent entry per
 * obligation, so recording again supersedes without destroying the earlier statement. A
 * compliance log a maker can quietly edit is not evidence of anything.
 */
function ComplianceRecord({
  product,
  onRecorded
}: {product: Product;onRecorded: () => Promise<void>;}) {
  const entitlement = useEntitlement();
  const obligations = obligationsFor(product);
  const [open, setOpen] = useState<string | null>(null);

  if (obligations.length === 0) {
    return (
      <Card className="px-5 py-8">
        <p className="max-w-prose text-sm leading-relaxed text-ink-secondary">
          None of this product&rsquo;s regimes place a recordable obligation on it.
        </p>
      </Card>);

  }

  return (
    <Card className="px-5 py-5">
      <ul className="divide-y divide-paper-line">
        {obligations.map((obligation) => {
          const outcome = obligationOutcome(product, obligation);
          return (
            <li key={obligation.id} className="py-4 first:pt-0 last:pb-0">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-sm font-medium text-ink">{obligation.label}</span>
                <span className="flex items-center gap-2">
                  <span className="text-2xs text-ink-tertiary">
                    {regimeById(obligation.regimeId).short}
                  </span>
                  <Pill
                    tone={
                    outcome.state === 'met' ?
                    'good' :
                    outcome.state === 'outstanding' ?
                    'warn' :
                    'quiet'
                    }>

                    {outcome.state === 'met' ?
                    'Recorded' :
                    outcome.state === 'outstanding' ?
                    'Not recorded' :
                    'Not checked here'}
                  </Pill>
                </span>
              </div>
              <p className="mt-1 max-w-prose text-[0.8125rem] leading-relaxed text-ink-secondary">
                {outcome.text}
              </p>
              {outcome.evidence?.reference &&
              <p className="tabular mt-1 text-2xs text-ink-tertiary">
                  Reference: {outcome.evidence.reference}
                </p>
              }

              {/* Offered only where recording it is a true thing to do. A derived obligation
                  (the classification, the period after opening, whether the last recorded print
                  still matches) has an answer already, and letting a maker assert one over the
                  top of it would put back exactly the class of claim this work removed. */}
              {obligation.recordable && open !== obligation.id &&
              <button
                type="button"
                onClick={() => setOpen(obligation.id)}
                className="mt-2 text-2xs font-medium text-teal hover:text-teal-hover">

                  {outcome.state === 'met' ? 'Record this again' : 'Record this'}
                </button>
              }

              {obligation.recordable && open === obligation.id &&
              <EvidenceForm
                product={product}
                obligation={obligation}
                accountId={entitlement.accountId}
                onCancel={() => setOpen(null)}
                onDone={async () => {
                  setOpen(null);
                  await onRecorded();
                }} />

              }
            </li>);

        })}
      </ul>
      <p className="mt-4 max-w-prose text-2xs leading-relaxed text-ink-tertiary">
        Recording something here writes one line to your records log saying you did it and when.
        Batchlabel does not hold your documents, submit your notifications or check any of this
        — what it can tell you is what you have and have not recorded, and it will not say more
        than that.
      </p>
    </Card>);

}

function EvidenceForm({
  product,
  obligation,
  accountId,
  onCancel,
  onDone
}: {
  product: Product;
  obligation: Obligation;
  accountId: string | null;
  onCancel: () => void;
  onDone: () => Promise<void>;
}) {
  const [summary, setSummary] = useState('');
  const [reference, setReference] = useState('');
  // Defaulted to today, and editable, because `occurred_at` is when the thing HAPPENED and a
  // maker writing up last month's submission today must not have the log claim it was today.
  const [when, setWhen] = useState(() => new Date().toISOString().slice(0, 10));
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const submit = async () => {
    if (saving) return;
    setSaving(true);
    setFailure(null);
    const result = await recordEvidence({
      accountId,
      product,
      obligationId: obligation.id,
      summary: summary.trim() || `${obligation.label} recorded for ${product.name}.`,
      reference: reference.trim() || null,
      // Midday rather than midnight, so a date typed here cannot land on the previous day for
      // anybody west of Greenwich once it is stored as an instant.
      occurredAt: when ? new Date(`${when}T12:00:00`).toISOString() : undefined
    });
    setSaving(false);
    if (!result.ok) {
      setFailure(result.message);
      return;
    }
    await onDone();
  };

  return (
    <div className="mt-3 space-y-3 rounded-control border border-paper-line bg-paper-panel/60 px-4 py-4">
      <Field label="What you did" hint="This is the line your records log shows.">
        <Input
          autoFocus
          value={summary}
          placeholder={obligation.label}
          onChange={(event) => setSummary(event.target.value)} />

      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Reference" hint="A document or submission number. Optional.">
          <Input
            className="tabular"
            value={reference}
            onChange={(event) => setReference(event.target.value)} />

        </Field>
        <Field label="When it happened" hint="Not when you are typing it in.">
          <Input
            type="date"
            className="tabular"
            value={when}
            onChange={(event) => setWhen(event.target.value)} />

        </Field>
      </div>
      {failure && <FormError>{failure}</FormError>}
      <div className="flex justify-end gap-2">
        <Button type="button" size="sm" variant="quiet" disabled={saving} onClick={onCancel}>
          Cancel
        </Button>
        <Button type="button" size="sm" variant="secondary" disabled={saving} onClick={submit}>
          {saving ? 'Recording…' : 'Record it'}
        </Button>
      </div>
    </div>);

}

function comparisonRows(product: Product, spec: Spec) {
  const rows: React.ReactNode[] = [
  <DiffRow
    key="address"
    element="Address block"
    gb={addressForMarket('GB').lines.slice(0, 2).join(', ')}
    eu={addressForMarket('EU').lines.slice(0, 2).join(', ')}
    differs />];



  if (product.regimes.includes('clp')) {
    rows.push(
      <DiffRow
        key="ufi"
        element="UFI"
        gb="Required. Not generated by Batchlabel"
        eu="Required. Not generated by Batchlabel" />,

      <DiffRow
        key="pcn"
        element="Poison centre notification"
        gb="National Poisons Information Service"
        eu="ECHA submission portal"
        differs />,

      <DiffRow
        key="statements"
        element="Hazard statements"
        gb="Identical, both jurisdictions retain CLP Annex VI"
        eu="Identical, both jurisdictions retain CLP Annex VI" />

    );
  }

  if (product.regimes.includes('cpr')) {
    rows.push(
      <DiffRow
        key="rp"
        element="Responsible person"
        gb={addressForMarket('GB').lines[0]}
        eu={addressForMarket('EU').lines[0]}
        differs />,

      <DiffRow
        key="notification"
        element="Notification"
        gb="Submit through the Office for Product Safety and Standards service"
        eu="Submit through the CPNP"
        differs />,

      <DiffRow key="inci" element="Ingredient list" gb="Identical INCI list" eu="Identical INCI list" />,
      <DiffRow
        key="pao"
        element="Period after opening"
        gb={spec.kind === 'phased' ? `${spec.paoMonths}M` : '—'}
        eu={spec.kind === 'phased' ? `${spec.paoMonths}M` : '—'} />

    );
  }

  if (product.regimes.includes('ce')) {
    rows.push(
      <DiffRow
        key="mark"
        element="Conformity mark"
        gb="UKCA accepted, CE recognised for these directives"
        eu="CE mark required"
        differs />,

      <DiffRow
        key="operator"
        element="Economic operator"
        gb="Manufacturer in Great Britain"
        eu="Importer or authorised representative in the EU"
        differs />,

      <DiffRow
        key="weee"
        element="WEEE registration"
        gb="UK producer registration"
        eu="Registration required in each member state of supply"
        differs />

    );
  }

  return rows;
}

function DiffRow({
  element,
  gb,
  eu,
  differs = false





}: {element: string;gb: string;eu: string;differs?: boolean;}) {
  return (
    <tr className={`border-b border-paper-line last:border-0 ${differs ? 'bg-clay-tint/60' : ''}`}>
      <td className="px-5 py-3 text-ink">{element}</td>
      <td className={`px-5 py-3 ${differs ? 'text-clay-dark' : 'text-ink-secondary'}`}>{gb}</td>
      <td className={`px-5 py-3 ${differs ? 'text-clay-dark' : 'text-ink-secondary'}`}>{eu}</td>
    </tr>);

}

/* ------------------------------------------------------ material pickers */

/**
 * The supplier document a material's figures came off, as a hint under a picker — or nothing.
 *
 * Nothing is the common case on a new account and it is the correct output: the maker has
 * typed a classification off a sheet on their bench and has not recorded which sheet. A hint
 * reading "read from document v" with nothing after it is what the interpolated version did.
 */
function documentHint(material?: Material): string | undefined {
  if (!material?.document) return undefined;
  const { kind, version, date } = material.document;
  return [kind, version ? `v${version}` : '', date ? formatDate(date) : ''].
  filter(Boolean).
  join(' · ');
}


/**
 * A material chooser, backed by the account's own register.
 *
 * WHAT IT REPLACES: `INGREDIENTS.filter(i => i.role === 'Wax')` — a list of shipped constants,
 * every option invented, and no way to add to it (the materials screen toasted "Saving a
 * material is not built yet"). Every option here is a row the maker holds, or one Batchlabel
 * publishes with a stated provenance.
 *
 * THREE THINGS IT HAS TO SAY THAT A `<select>` CANNOT SAY BY ITSELF:
 *
 *   AN EMPTY REGISTER IS NOT A BROKEN SCREEN. A new account holds no materials and the
 *   catalogue ships empty, so the first maker to open this finds no options at all. That is
 *   the honest state and it gets a sentence and a link, rather than an empty dropdown that
 *   reads as a page that failed to load.
 *
 *   A REGISTER THAT HAS NOT LOADED IS NOT AN EMPTY ONE. While the read is in flight, or if it
 *   failed, the control is disabled and says which — because a picker offering nothing is
 *   indistinguishable from one whose options have not arrived, and a maker who picks nothing
 *   because nothing was offered has a composition they did not choose.
 *
 *   A STORED MATERIAL THAT IS NO LONGER IN THE REGISTER STILL HAS TO SHOW. Archiving a
 *   material leaves every composition that used it pointing at it. Dropping the id silently
 *   would make the select show the first option instead — quietly re-classifying somebody's
 *   product on render — so it is kept, marked, and the derivation reports it too.
 */
function MaterialSelect({
  label,
  hint,
  value,
  onChange,
  options,
  ariaLabel,
  emptyHint,
  className




}: {label?: string;hint?: string;value: string;onChange: (id: string) => void;options: Material[];ariaLabel?: string;emptyHint: string;className?: string;}) {
  const { status } = useMaterials();
  const chosen = value ? materialById(value) : undefined;
  const missing = Boolean(value) && !chosen;
  const settled = status === 'ready';

  const control =
  <>
      <Select
      value={value}
      aria-label={ariaLabel}
      disabled={!settled}
      onChange={(event) => onChange(event.target.value)}>
      
        <option value="">
          {settled ? 'Not chosen' : status === 'error' ? 'Register unavailable' : 'Loading…'}
        </option>
        {missing &&
      <option value={value}>{value} — no longer in your register</option>
      }
        {options.map((option) =>
      <option key={option.id} value={option.id}>
            {option.name}
            {option.source === 'reference' ? ' (Batchlabel)' : ''}
          </option>
      )}
      </Select>
      {!settled &&
    <p className="mt-1 text-2xs text-ink-tertiary">
          {status === 'error' ?
      'We could not read your materials, so nothing can be chosen here. This is us, not you.' :
      'Reading your materials…'}
        </p>
    }
      {settled && missing &&
    <p className="mt-1 text-2xs text-clay-dark">
          This composition names a material that is not in your register any more. Nothing has
          been classified from it — pick one that is.
        </p>
    }
      {settled && !missing && options.length === 0 &&
    <p className="mt-1 text-2xs text-ink-tertiary">
          {emptyHint} <Link to="/materials" className="underline">Add one in Materials</Link>.
        </p>
    }
      {settled && chosen &&
    <p className="mt-1 text-2xs text-ink-tertiary">{materialOrigin(chosen)}</p>
    }
    </>;


  if (!label) return <div className={className}>{control}</div>;
  return (
    <Field label={label} hint={hint} className={className}>
      {control}
    </Field>);

}

/* --------------------------------------------------- mixture, fragrance */

/*
 * THREE HINT HELPERS WERE DELETED HERE, not disabled.
 *
 * `materialHint`, `packagingHint` and `printableAreaHint` all read Batchlabel's shipped
 * reference library — `Reference library · ${supplier}, read from document v${version}` — and
 * that library no longer exists. Their honest replacements are `documentHint` above, which
 * prints the supplier document reference THE MAKER recorded or nothing at all, and the two
 * inline hints in the editors below, which say "No capacity recorded on this pack" rather
 * than "Capacity 0 ml".
 */

function MixtureEditor({
  spec,
  onChange



}: {spec: MixtureSpec;onChange: (next: MixtureSpec) => void;}) {
  const set = <K extends keyof MixtureSpec,>(key: K, value: MixtureSpec[K]) =>
  onChange({ ...spec, [key]: value });

  /**
   * The options, off the account's own register rather than off a shipped array.
   *
   * FILTERED BY ROLE, AND ROLE IS FREE TEXT the maker typed on the material. So a maker who
   * calls their wax "Wax blend" will not see it under bases — which is why the fallback below
   * the pickers offers every ingredient rather than nothing, and why the materials screen
   * offers the standard roles as a list rather than a free field with no suggestions.
   */
  const { materials } = useMaterials();
  const ingredients = materials.filter(
    (material): material is IngredientMaterial => material.class === 'ingredient'
  );
  const bases = ingredients.filter((i) => i.role === 'Wax' || i.role === 'Carrier');
  const oils = ingredients.filter((i) => i.role === 'Fragrance oil');
  const dyes = ingredients.filter((i) => i.role === 'Dye');
  const packs = materials.filter(
    (material) => material.class === 'packaging' && material.categories.includes('home-fragrance')
  );
  const fragrance = ingredientById(spec.fragranceId);
  const base = ingredientById(spec.baseId);
  const dye = ingredientById(spec.dyeId);
  const pack = packagingById(spec.packagingId);

  return (
    <>
      <Card className="space-y-5 px-5 py-5">
        <Field label="Product type">
          <Select
            value={spec.productType}
            onChange={(event) =>
            onChange({
              ...spec,
              productType: event.target.value,
              netUnit:
              event.target.value === 'Container candle' || event.target.value === 'Wax melt' ?
              'g' :
              'ml'
            })
            }>
            
            {['Container candle', 'Wax melt', 'Reed diffuser', 'Room spray'].map((type) =>
            <option key={type}>{type}</option>
            )}
          </Select>
        </Field>

        {/* EVERY MATERIAL SELECT CARRIES AN EMPTY OPTION, and it is what a brand new product
            shows rather than a wax nobody picked. `blankSpec` used to seed `ing-crw45`, one
            specific container wax from Batchlabel's shipped catalogue, into every candle the
            moment it was created — so this control rendered somebody else's material as the
            maker's own choice, and its classification went onto the label. The four questions
            the create form asks do not include this one, so the honest starting state is
            unanswered.

            The hint is the SUPPLIER DOCUMENT REFERENCE the maker recorded, or nothing at all.
            It used to read "Reference library · <supplier>, read from document v<version>",
            interpolated from a shipped constant, and rendered as "Reference library · ,
            read from document v" the moment either was absent. A citation is either real or
            it is not shown. */}
        <MaterialSelect
          label="Base wax or carrier"
          hint={documentHint(base)}
          value={spec.baseId}
          onChange={(id) => set('baseId', id)}
          options={bases}
          emptyHint="You hold no material with a role of Wax or Carrier." />
        

        <MaterialSelect
          label="Fragrance oil"
          hint={documentHint(fragrance)}
          value={spec.fragranceId}
          onChange={(id) => set('fragranceId', id)}
          options={oils}
          emptyHint="You hold no material with a role of Fragrance oil." />
        

        <div>
          <div className="mb-1.5 flex items-baseline justify-between">
            <span className="text-[0.8125rem] font-medium text-ink-secondary">Fragrance load</span>
            <span className="tabular font-display text-lg font-medium text-ink">{spec.load} %</span>
          </div>
          <input
            type="range"
            min={0}
            max={30}
            step={0.5}
            value={spec.load}
            onChange={(event) => set('load', Number(event.target.value))}
            aria-label="Fragrance load percentage"
            className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-paper-line accent-teal" />
          
          {/* NOT "?? 100 percent". An IFRA maximum of 100 means the oil may be used neat,
              which is a permission — and it was being shown for an oil with no IFRA data at
              all, and for no oil at all. A limit nobody recorded is not a limit of 100. */}
          <p className="mt-2 text-2xs text-ink-tertiary">
            {!fragrance ?
          'No fragrance oil chosen, so no IFRA limit applies yet.' :
          fragrance.ifra.length === 0 ?
          `No IFRA limit is recorded for ${fragrance.name}. Add one from the supplier's IFRA certificate and it will be checked here.` :
          <>
                IFRA maximum for this oil, {fragrance.ifra[0].category}, is{' '}
                <span className="tabular">{fragrance.ifra[0].max} percent</span>.
              </>
          }
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          {/* "Not chosen" is not the same answer as "No dye", and the seeded default used to
              be the latter. One is silence and the other is a statement about the composition
              that feeds the classification. */}
          <MaterialSelect
            label="Dye"
            value={spec.dyeId}
            onChange={(id) => set('dyeId', id)}
            options={dyes}
            emptyHint="You hold no material with a role of Dye." />
          
          <Field label="Additives" hint="Leave empty if there are none.">
            <Input
              value={spec.additive}
              placeholder="None"
              onChange={(event) => set('additive', event.target.value)} />
            
          </Field>
          <Field label={`Net ${spec.netUnit === 'g' ? 'weight' : 'volume'}`}>
            <div className="flex items-center gap-2">
              <Input
                type="number"
                className="tabular"
                value={spec.netQuantity}
                onChange={(event) => set('netQuantity', Number(event.target.value))} />
              
              <span className="text-sm text-ink-tertiary">{spec.netUnit}</span>
            </div>
          </Field>
          {/* Capacity decides which row of CLP Annex I Table 1.3 the label is sized against,
              so "Capacity 0 ml" — which is what an absent pack used to render — is not a
              harmless placeholder. Absent says absent. */}
          <MaterialSelect
            label="Packaging"
            hint={
            pack?.capacityMl != null ?
            `Capacity ${pack.capacityMl} ml` :
            pack ?
            'No capacity recorded on this pack' :
            undefined
            }
            value={spec.packagingId}
            onChange={(id) => set('packagingId', id)}
            options={packs}
            emptyHint="You hold no packaging for home fragrance." />
          
        </div>
      </Card>

      <Card className="px-5 py-5">
        <SectionTitle className="mb-3">Composition</SectionTitle>
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="text-2xs uppercase tracking-[0.1em] text-ink-tertiary">
              <th scope="col" className="pb-2 font-medium">Component</th>
              <th scope="col" className="pb-2 text-right font-medium">Share</th>
            </tr>
          </thead>
          {/* A ROW PER COMPONENT THE MAKER HAS ACTUALLY CHOSEN. Each of these used to render
              unconditionally, so an unfilled composition showed three blank names against
              precise percentages — "100.0 %" of nothing, and a dye share of 0.0 or 0.5 decided
              by whether the id happened to equal 'ing-no-dye'. Percentages beside empty names
              read as a rendering fault; worse, they read as a composition that totals. */}
          <tbody>
            {/* An empty cell where a name should be is how this table used to render an
                unchosen slot — a blank line with a percentage beside it, which reads as a
                component whose name failed to load rather than as one nobody has picked.
                CompositionRow prints an em dash instead: a share is a claim about how much of
                the pack is a named thing, and there is no named thing. */}
            <CompositionRow
              name={base?.name}
              missing="No base chosen yet"
              pct={100 - spec.load - (dye ? 0.5 : 0)} />

            <CompositionRow
              name={fragrance?.name}
              missing="No fragrance oil chosen yet"
              pct={spec.load} />

            <CompositionRow
              name={dye?.name}
              missing="No dye chosen yet"
              pct={0.5}
              quiet />

          </tbody>
        </table>
      </Card>
    </>);

}

/**
 * One line of the composition table. Shows a share only when there is something to share.
 *
 * `pct` is deliberately not rendered when the component is missing: a percentage is a claim
 * about how much of the pack is a named thing, and there is no named thing.
 */
function CompositionRow({
  name,
  missing,
  pct,
  quiet = false
}: {name?: string;missing: string;pct: number;quiet?: boolean;}) {
  const tone = quiet || !name ? 'text-ink-tertiary' : 'text-ink';
  return (
    <tr className="border-t border-paper-line">
      <td className={`py-2 ${tone}`}>{name ?? missing}</td>
      <td className="tabular py-2 text-right text-ink-tertiary">
        {name ? `${pct.toFixed(1)} %` : '—'}
      </td>
    </tr>);

}

/* ------------------------------------------------- phased, cosmetics */

function PhasedEditor({
  spec,
  onChange



}: {spec: PhasedSpec;onChange: (next: PhasedSpec) => void;}) {
  const total = phasedTotal(spec);
  const balanced = Math.abs(total - 100) < 0.005;

  const setItemPct = (phaseIndex: number, itemIndex: number, pct: number) => {
    const phases = spec.phases.map((phase, pIndex) =>
    pIndex !== phaseIndex ?
    phase :
    {
      ...phase,
      items: phase.items.map((item, iIndex) =>
      iIndex !== itemIndex ? item : { ...item, pct }
      )
    }
    );
    onChange({ ...spec, phases });
  };

  const setItemMaterial = (phaseIndex: number, itemIndex: number, materialId: string) => {
    const phases = spec.phases.map((phase, pIndex) =>
    pIndex !== phaseIndex ?
    phase :
    {
      ...phase,
      items: phase.items.map((item, iIndex) =>
      iIndex !== itemIndex ? item : { ...item, materialId }
      )
    }
    );
    onChange({ ...spec, phases });
  };

  const { materials } = useMaterials();
  const cosmeticIngredients = materials.filter(
    (material): material is IngredientMaterial =>
    material.class === 'ingredient' && material.categories.includes('cosmetics')
  );
  const packs = materials.filter(
    (material) => material.class === 'packaging' && material.categories.includes('cosmetics')
  );
  const pack = packagingById(spec.packagingId);

  return (
    <>
      <Card className="space-y-5 px-5 py-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Product type">
            <Select
              value={spec.productType}
              onChange={(event) => onChange({ ...spec, productType: event.target.value })}>
              
              {['Face oil', 'Balm', 'Body cream'].map((type) =>
              <option key={type}>{type}</option>
              )}
            </Select>
          </Field>
          <Field label="Application" hint="Sets the allergen declaration threshold">
            <Select
              value={spec.application}
              onChange={(event) =>
              onChange({ ...spec, application: event.target.value as PhasedSpec['application'] })
              }>
              
              <option value="Leave-on">Leave-on</option>
              <option value="Rinse-off">Rinse-off</option>
            </Select>
          </Field>
          <Field label="Nominal content">
            <div className="flex items-center gap-2">
              <Input
                type="number"
                className="tabular"
                value={spec.netQuantity}
                onChange={(event) => onChange({ ...spec, netQuantity: Number(event.target.value) })} />
              
              <span className="text-sm text-ink-tertiary">{spec.netUnit}</span>
            </div>
          </Field>
          <Field
            label="Period after opening"
            hint={
            spec.paoMonths > 0 ?
            'Months. Nothing here has measured it — it is yours to set and to justify.' :
            'Months. Not set, so the label prints no open-jar figure.'
            }>

            {/* Zero means unset and the label renders it as unset. This used to be seeded to
                12 by `blankSpec`, which printed "12M" onto the preview at actual size while
                the obligations list on the same screen said no period after opening was
                shown. Both halves read this one field now. */}
            <Input
              type="number"
              min={0}
              className="tabular"
              value={spec.paoMonths}
              onChange={(event) => onChange({ ...spec, paoMonths: Number(event.target.value) })} />

          </Field>
          {/* "Printable area 0 × 0 mm" is what an unrecorded area used to render as, next to
              an artefact the designer then checked against it. */}
          <MaterialSelect
            label="Packaging"
            hint={
            pack?.labelAreaMm ?
            `Printable area ${pack.labelAreaMm.width} × ${pack.labelAreaMm.height} mm` :
            pack ?
            'No printable area recorded on this pack' :
            undefined
            }
            className="sm:col-span-2"
            value={spec.packagingId}
            onChange={(id) => onChange({ ...spec, packagingId: id })}
            options={packs}
            emptyHint="You hold no packaging for cosmetics." />
          
        </div>
      </Card>

      {spec.phases.map((phase, phaseIndex) => {
        const phaseTotal = phase.items.reduce((sum, item) => sum + item.pct, 0);
        return (
          <Card key={phase.name} className="px-5 py-5">
            <div className="mb-3 flex items-center justify-between">
              <SectionTitle>{phase.name}</SectionTitle>
              <span className="tabular text-2xs text-ink-tertiary">
                {phaseTotal.toFixed(1)} % of the formula
              </span>
            </div>
            <div className="space-y-3">
              {phase.items.map((item, itemIndex) => {
                const ingredient = ingredientById(item.materialId);
                return (
                  <div
                    key={`${phase.name}-${itemIndex}`}
                    className="grid grid-cols-[minmax(0,1fr)_96px] items-center gap-3">
                    
                    <div className="min-w-0">
                      <MaterialSelect
                        value={item.materialId}
                        ariaLabel={`Ingredient ${itemIndex + 1} in ${phase.name}`}
                        onChange={(id) => setItemMaterial(phaseIndex, itemIndex, id)}
                        options={cosmeticIngredients}
                        emptyHint="You hold no ingredient marked for cosmetics." />
                      
                      <p className="mt-1 text-2xs text-ink-tertiary">
                        {/* "No INCI name on file" was said for an ingredient that had one and
                            for no ingredient at all. An INCI name is what prints in the
                            ingredient list, so its absence is the maker's to fix and has to be
                            told apart from nothing being chosen. */}
                        {!ingredient ?
                      'Nothing chosen for this line.' :
                      ingredient.inci ?
                      `${ingredient.inci}${ingredient.inciFunction ? ` · ${ingredient.inciFunction}` : ''}` :
                      'No INCI name recorded on this material, so it cannot be declared in the ingredient list.'
                      }
                      </p>
                    </div>
                    <Input
                      type="number"
                      step={0.1}
                      className="tabular text-right"
                      aria-label={`Percentage of ${ingredient?.name ?? 'ingredient'}`}
                      value={item.pct}
                      onChange={(event) =>
                      setItemPct(phaseIndex, itemIndex, Number(event.target.value))
                      } />
                    
                  </div>);

              })}
            </div>
          </Card>);

      })}

      <div
        className={`flex items-center justify-between rounded-control border px-4 py-3 text-sm ${
        balanced ?
        'border-paper-line bg-paper-panel text-ink-secondary' :
        'border-clay/30 bg-clay-tint text-clay-dark'}`
        }>
        
        <span>{balanced ? 'Formula totals 100 percent' : 'Formula does not total 100 percent'}</span>
        <span className="tabular font-display text-lg font-medium">{total.toFixed(2)} %</span>
      </div>
    </>);

}

/* --------------------------------------------- bill of materials, device */

function BomEditor({ spec, onChange }: {spec: BomSpec;onChange: (next: BomSpec) => void;}) {
  const { materials } = useMaterials();
  const packs = materials.filter(
    (material) => material.class === 'packaging' && material.categories.includes('electronics')
  );
  const setItemMaterial = (index: number, materialId: string) =>
  onChange({
    ...spec,
    items: spec.items.map((item, i) => i === index ? { ...item, materialId } : item)
  });

  return (
    <>
      <Card className="space-y-5 px-5 py-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Product type">
            <Select
              value={spec.productType}
              onChange={(event) => onChange({ ...spec, productType: event.target.value })}>
              
              {['Wax warmer', 'Diffuser, ultrasonic', 'Lamp'].map((type) =>
              <option key={type}>{type}</option>
              )}
            </Select>
          </Field>
          <Field
            label="Model and type reference"
            hint="Printed on the rating plate and named on the declaration of conformity.">

            {/* Empty until typed. It used to be seeded "Not yet assigned", which is a sentence
                rather than a blank, and a sentence in this field reaches a rating plate. */}
            <Input
              value={spec.model}
              placeholder="Not yet assigned"
              onChange={(event) => onChange({ ...spec, model: event.target.value })} />

          </Field>
          <Field label="Supply voltage">
            <Input
              className="tabular"
              value={spec.ratings.voltage}
              onChange={(event) =>
              onChange({ ...spec, ratings: { ...spec.ratings, voltage: event.target.value } })
              } />
            
          </Field>
          <Field label="Current">
            <Input
              className="tabular"
              value={spec.ratings.current}
              onChange={(event) =>
              onChange({ ...spec, ratings: { ...spec.ratings, current: event.target.value } })
              } />
            
          </Field>
          <Field label="Rated power">
            <Input
              className="tabular"
              value={spec.ratings.power}
              onChange={(event) =>
              onChange({ ...spec, ratings: { ...spec.ratings, power: event.target.value } })
              } />
            
          </Field>
          <MaterialSelect
            label="Packaging"
            value={spec.packagingId}
            onChange={(id) => onChange({ ...spec, packagingId: id })}
            options={packs}
            emptyHint="You hold no packaging for electronics." />
          
        </div>
      </Card>

      {/*
        THE COMPONENT PICKER IS GONE, AND SO IS EVERYTHING IT ASSERTED.
        
        It offered five shipped components and rendered, per line, a RoHS pill ("Compliant with
        exemption"), a part number, a supplier and a declaration-of-conformity version — all of
        it constants in the bundle, identical for every account that picked the part, presented
        as evidence about the maker's own device. Rhys's ruling deleted components; the
        database refuses the class. What is left is what the maker typed, said as such.
      */}
      <Card className="px-5 py-5">
        <SectionTitle className="mb-3">Bill of materials</SectionTitle>
        <Callout tone="info" title="Component materials are not built">
          <p className="max-w-prose leading-relaxed">
            You can name the parts on this device and their positions, and they are saved. What
            Batchlabel cannot yet do is hold a component as a material — with its RoHS
            declaration, its standards and its test evidence — so nothing on this list has been
            checked, and the conformity file beside it says the same.
          </p>
        </Callout>
        <div className="mt-4 space-y-3">
          {spec.items.length === 0 ?
          <p className="text-sm text-ink-secondary">
              Nothing on the bill of materials yet.
            </p> :

          spec.items.map((item, index) =>
          <div key={item.position} className="rounded-control border border-paper-line px-4 py-3">
                <p className="text-2xs uppercase tracking-[0.1em] text-ink-tertiary">
                  {item.position}
                </p>
                <div className="mt-2">
                  <Input
                value={item.materialId}
                aria-label={`Part at ${item.position}`}
                placeholder="Part name or number"
                onChange={(event) => setItemMaterial(index, event.target.value)} />
              
                </div>
                <p className="tabular mt-2 text-2xs text-ink-tertiary">
                  Quantity {item.quantity}
                </p>
              </div>
          )
          }
        </div>
      </Card>
    </>);

}