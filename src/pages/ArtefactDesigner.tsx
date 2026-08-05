import React, { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeftIcon,
  CheckIcon,
  DownloadIcon,
  PackageIcon,
  RefreshCwIcon,
  StampIcon,
  TriangleAlertIcon } from
'lucide-react';
import { toast } from 'sonner';
import { PageHeader } from '../components/AppShell';
import { NoAccountNotice } from '../components/NoAccountNotice';
import { PlanNotice } from '../components/PlanNotice';
import {
  Button,
  Callout,
  Card,
  EmptyState,
  Field,
  Pill,
  SectionTitle,
  Select,
  Skeleton } from
'../components/ui/Primitives';
import { useEntitlement } from '../lib/entitlement';
import { ArtefactRenderer } from '../components/artefact/ArtefactRenderer';
import { ArtefactType, Market, Product, formatDate } from '../lib/model';
import { recordArtefactPrinted } from '../lib/evidence';
import {
  MIN_FONT_PT,
  MIN_LINE_SPACING,
  clpMinimumDimensions,
  derive,
  geometryRules } from
'../lib/derive';
import { packagingById } from '../lib/material-index';
import { useOptionalMaterials } from '../lib/materials-store';
import { useOptionalSettings } from '../lib/settings-store';
import { ARTEFACT_LABELS, STOCK, categoryById } from '../lib/categories';
import { addressForMarket } from '../lib/identity';
import { useProduct, useProducts } from '../lib/product-store';
import { blocksFor, regimeById } from '../lib/regimes';
import { useCategorySurface } from '../lib/workspace';

/**
 * Resolves the product first, for the same reason the specification screen does.
 *
 * `productById(productId) ?? PRODUCTS[0]` used to mean that a designer opened on an unknown
 * id laid out a fixture candle's label — at actual size, with its name and its classification
 * on it, on a screen whose whole purpose is to show a maker what they are about to print.
 */
export function ArtefactDesigner() {
  const { productId } = useParams();
  const navigate = useNavigate();
  const { status, product, error, refresh } = useProduct(productId);

  if (status === 'loading') {
    return (
      <main className="flex-1 px-6 py-8 lg:px-10" aria-busy="true" aria-label="Loading product">
        <Skeleton className="h-4 w-40 bg-paper-line/70" />
        <Skeleton className="mt-4 h-8 w-72 bg-paper-line/70" />
        <Skeleton className="mt-6 h-64 w-full bg-paper-line/70" />
      </main>);

  }

  if (status === 'error') {
    return (
      <main className="flex-1 px-6 py-8 lg:px-10">
        <Callout tone="warn" role="alert" title="We could not read this product">
          <p className="max-w-prose leading-relaxed">
            {error} Nothing has been changed, and nothing here has been laid out from a guess.
          </p>
          <Button size="sm" variant="secondary" className="mt-3" onClick={refresh}>
            <RefreshCwIcon className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />
            Try again
          </Button>
        </Callout>
      </main>);

  }

  // Before the not-found branch, and for the same reason as on the specification screen: a
  // suspended account arrives here on a bookmark it has used every week, and "there is nothing
  // in your products with this address" is not true of it.
  if (status === 'unavailable') {
    return (
      <main className="flex-1 px-6 py-8 lg:px-10">
        <PlanNotice states={['suspended']} />
      </main>);

  }

  // And before it too. No account resolved means no read was made, so "there is nothing in
  // your products with this address" states the outcome of a read that never happened — on
  // the screen a maker opens to check what they are about to print.
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
          body="There is nothing in your products with this address, so there is no surface to lay out."
          action={
          <Button variant="secondary" onClick={() => navigate('/products')}>
              Back to your products
            </Button>
          } />

      </main>);

  }

  return <ArtefactDesignerView product={product} />;
}

function ArtefactDesignerView({ product }: {product: Product;}) {
  const { artefactType } = useParams();
  const navigate = useNavigate();

  /**
   * The export is the paid line.
   *
   * Everything up to it stays open: designing the surface, reading the rules,
   * seeing which checks fail. What a plan buys is the artefact you can actually
   * send to a printer. That is the honest place to draw it — the free tier is
   * genuinely useful rather than a demo, and nobody discovers the paywall after
   * doing the work, because this notice is on screen the whole time.
   *
   * `active` is the only thing consulted. It is false for free, cancelled and
   * suspended, and false when the read failed — but PlanNotice distinguishes
   * those, so a customer whose plan we could not reach is never told they have
   * not paid.
   */
  const entitlement = useEntitlement();
  const canExport = entitlement.active;

  // The designer always knows what it is designing: both the product and the
  // surface come from the route, never from a picker inside the screen.
  useCategorySurface(product.categoryId);
  const category = categoryById(product.categoryId);

  // The safety data sheet is a document, not a designed surface. It is produced
  // on the product screen and previewed in the rail, never laid out here.
  const available = product.artefacts.filter((item) => item.type !== 'sds');
  const artefact = available.find((item) => item.type === artefactType) ?? available[0];

  const [market, setMarket] = useState<Market>(product.markets[0]);
  const [stockId, setStockId] = useState(
    () => STOCK.find((s) => s.artefactType === artefact.type)?.id ?? STOCK[0].id
  );
  const [fontPt, setFontPt] = useState(6);
  const [lineSpacing, setLineSpacing] = useState(1.18);
  const [hidden, setHidden] = useState<Record<string, boolean>>({});
  const [recording, setRecording] = useState(false);

  const openSurface = (type: ArtefactType) => {
    const firstStock = STOCK.find((s) => s.artefactType === type);
    if (firstStock) setStockId(firstStock.id);
    setHidden({});
    navigate(`/products/${product.id}/artefacts/${type}`);
  };

  /**
   * THE SAME TWO SUBSCRIPTIONS THE SPECIFICATION SCREEN NEEDS, AND FOR THE SAME REASON — with
   * more at stake here, because this screen draws the label at actual size.
   *
   * `derive` reads the materials register through a module-level index, and `ArtefactRenderer`
   * below reads the printed business identity the same way (lib/identity.ts is a live holder
   * filled by SettingsProvider, not six frozen constants any more). Both are published
   * ASYNCHRONOUSLY by providers above the router, after this screen has painted; and a
   * component that consumes neither context is not re-rendered when they land, because the
   * provider's `children` is the same element object and React bails out of the subtree.
   *
   * Without these two hooks a maker who opens a label straight from a link — or reloads on one
   * — gets a proof with no hazard statements on it and "[Business name]" where their own name
   * belongs, and it stays that way until they navigate away and back. Both are label elements
   * a regulator reads.
   *
   * `useOptionalSettings` rather than `useSettings`: this screen must still render in harnesses
   * that mount it without the provider, and a null there means "no identity holder above me",
   * which is exactly what the placeholder text already says.
   */
  const register = useOptionalMaterials();
  const settings = useOptionalSettings();

  const derivation = useMemo(
    () => derive(product.spec, product, market),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [product, market, register, settings]
  );

  const stockOptions = STOCK.filter((s) => s.artefactType === artefact.type);
  const stock = stockOptions.find((s) => s.id === stockId) ?? stockOptions[0];
  const widthMm = stock?.widthMm ?? artefact.widthMm;
  const heightMm = stock?.heightMm ?? artefact.heightMm;

  const blocks = blocksFor(product, artefact.type);
  const packaging = packagingById(product.spec.packagingId);
  const pictogramMm = product.regimes.includes('clp') ?
  // A drawing default, not a check — see the same line in ArtefactRail. geometryRules is
  // what states the minimum, and it declines to state one without a capacity.
  clpMinimumDimensions(packaging?.capacityMl ?? 100).pictogram :
  8;

  const rules = geometryRules(product, widthMm, heightMm);
  const brandingShown = hidden.branding !== true && blocks.some((b) => b.key === 'branding');
  const area = widthMm * heightMm;
  // An optional block crowds when the surface is tight and the type is already
  // at the legibility floor. The same check covers any optional block, not only branding.
  const optionalCrowds = brandingShown && fontPt <= MIN_FONT_PT && area < 4500;

  // A placeholder, and it reads as one on the canvas. It was a fixture batch code — the number
  // a recall is run against — printed at actual size onto a maker's proof. It stays a
  // placeholder now that `batchlabel.record_events` holds real batch records, for the reason
  // set out at the same line in Specification.tsx: a label belongs to a composition and a batch
  // code belongs to a fill, so there is no "the" batch code for a product to print here.
  const identityCode = category.recordIdentity === 'batch' ? '[Batch code]' : '[Serial number]';

  return (
    <main className="flex-1 pb-24 xl:pb-0">
      <PageHeader
        eyebrow={
        <span className="flex flex-wrap items-center gap-2">
            <Link
            to={`/products/${product.id}`}
            className="inline-flex items-center gap-1.5 normal-case tracking-normal text-teal hover:text-teal-hover">
            
              <ArrowLeftIcon className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />
              {product.name}
            </Link>
            <span aria-hidden="true">·</span>
            <span>{ARTEFACT_LABELS[artefact.type]}</span>
          </span>
        }
        title={product.name}
        description="Arrange the blocks the active regimes require. The canvas is at actual size, and the checks below state the rule and its source."
        actions={
        <>
            {/* THE PRIMARY ACTION IS THE ONE THAT WRITES. The two export buttons keep their
                plan gate and their honest toasts, but they are no longer the most prominent
                thing on the screen, because neither of them produces anything. What a maker
                can actually do today — print from their own process and have Batchlabel
                remember which recipe it was printed from — is now the primary. */}
            <Button
            variant="secondary"
            disabled={!canExport}
            aria-describedby={canExport ? undefined : 'export-plan-notice'}
            /* The exporter is not built yet. Until it is, these toasts say so rather than
               reporting a file that was never written — a customer who is told "Sheet
               exported" and finds nothing in Downloads assumes their browser ate it, and
               a paying one has been told the thing they paid for happened. The button and
               its label stay: they name the feature being built, and the plan gate around
               them is real. Only the claim of a completed export goes. */
            onClick={() =>
            toast('Export is not ready yet', {
              description: stock ?
              `Sheet layout for ${stock.name} is coming. Nothing has been downloaded.` :
              'Sheet layout export is coming. Nothing has been downloaded.'
            })
            }>

              <DownloadIcon className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />
              Export sheet
            </Button>
            <Button
            variant="secondary"
            disabled={!canExport}
            aria-describedby={canExport ? undefined : 'export-plan-notice'}
            onClick={() =>
            toast('Export is not ready yet', {
              description:
              `A single ${ARTEFACT_LABELS[artefact.type].toLowerCase()} at ${widthMm} × ${heightMm} mm ` +
              `is what this will produce. Nothing has been downloaded.`
            })
            }>

              Export PDF
            </Button>
            <Button variant="primary" onClick={() => setRecording(true)}>
              <StampIcon className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />
              Record a print
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
            <Pill tone="quiet">{addressForMarket(market).label}</Pill>
          </>
        } />


      {recording &&
      <RecordPrintDialog
        product={product}
        artefactType={artefact.type}
        widthMm={widthMm}
        heightMm={heightMm}
        stockName={stock?.name}
        onClose={() => setRecording(false)} />

      }

      {!canExport &&
      <div id="export-plan-notice" className="px-6 pt-6 lg:px-10">
          <PlanNotice feature="Exporting a finished artefact" />
        </div>
      }

      {/* Said once, in plain sight, on the screen whose entire promise is that the canvas is
          what will be printed. The two export buttons above are honest when pressed, but a
          toast is only read by somebody who pressed the button — and the state of this
          artefact is worth knowing before you decide what to do with it. */}
      <div className="px-6 pt-6 lg:px-10">
        <PrintState product={product} artefactType={artefact.type} />
      </div>

      <div className="grid gap-8 px-6 py-8 lg:px-10 xl:grid-cols-[330px_minmax(0,1fr)]">
        <section aria-label="Blocks and settings" className="space-y-5">
          <Card className="space-y-4 px-5 py-5">
            <div>
              <span className="mb-1.5 block text-[0.8125rem] font-medium text-ink-secondary">
                Surface
              </span>
              <div
                className="flex flex-wrap gap-1.5"
                role="group"
                aria-label="Surfaces this product's regimes require">
                
                {available.map((item) => {
                  const active = item.type === artefact.type;
                  return (
                    <button
                      key={item.type}
                      type="button"
                      aria-pressed={active}
                      onClick={() => openSurface(item.type)}
                      className={`rounded-control border px-3 py-2 text-[0.8125rem] transition-colors ${
                      active ?
                      'border-teal bg-teal-tint text-teal-hover' :
                      'border-paper-line bg-paper text-ink-secondary hover:bg-paper-panel'}`
                      }>
                      
                      {item.label}
                      {item.currency === 'out-of-date' &&
                      <span
                        className="ml-1.5 text-clay"
                        title="The last print you recorded no longer matches this composition">
                          ·
                        </span>}
                    </button>);

                })}
              </div>
              <span className="mt-1.5 block text-2xs text-ink-tertiary">
                Only surfaces this product's regimes require.
              </span>
            </div>
            <Field label="Market">
              <Select value={market} onChange={(event) => setMarket(event.target.value as Market)}>
                <option value="GB">Great Britain</option>
                <option value="EU">European Union and Northern Ireland</option>
              </Select>
            </Field>
            <Field
              label="Stock preset"
              hint={stock ? `${stock.perSheet} per ${stock.sheet}` : 'No preset for this surface'}>
              
              <Select value={stock?.id} onChange={(event) => setStockId(event.target.value)}>
                {stockOptions.map((option) =>
                <option key={option.id} value={option.id}>
                    {option.name}
                  </option>
                )}
              </Select>
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Font size">
                <div className="flex items-center gap-2">
                  <input
                    type="range"
                    min={4}
                    max={10}
                    step={0.5}
                    value={fontPt}
                    onChange={(event) => setFontPt(Number(event.target.value))}
                    aria-label="Font size in points"
                    className="h-1.5 w-full appearance-none rounded-full bg-paper-line accent-teal" />
                  
                  <span className="tabular w-12 text-right text-sm text-ink">{fontPt} pt</span>
                </div>
              </Field>
              <Field label="Line spacing">
                <div className="flex items-center gap-2">
                  <input
                    type="range"
                    min={1}
                    max={1.6}
                    step={0.01}
                    value={lineSpacing}
                    onChange={(event) => setLineSpacing(Number(event.target.value))}
                    aria-label="Line spacing"
                    className="h-1.5 w-full appearance-none rounded-full bg-paper-line accent-teal" />
                  
                  <span className="tabular w-12 text-right text-sm text-ink">
                    {lineSpacing.toFixed(2)}
                  </span>
                </div>
              </Field>
            </div>
          </Card>

          <Card className="px-5 py-5">
            <SectionTitle className="mb-3">Blocks</SectionTitle>
            <ul className="space-y-1">
              {blocks.map((block) =>
              <li
                key={block.key}
                className="flex items-center gap-3 rounded-control px-2 py-2 hover:bg-paper-panel">

                  {/* THE GRIP HANDLE IS GONE WITH THE SENTENCE THAT PROMISED IT. There is no
                      draggable attribute, no onDragStart, no onDrop and no pointer handling
                      anywhere in this file: dragging a block did nothing at all, on the one
                      screen whose promise is that the canvas is what will be printed, and a
                      maker who tried it concluded the app was broken. Same treatment as the
                      export buttons, which now say export is not ready rather than claim a
                      file. */}
                  <span className="min-w-0 flex-1 text-[0.8125rem] text-ink">
                    {block.label}
                    <span className="mt-0.5 block text-2xs text-ink-tertiary">
                      {block.regimeId === 'workspace' ?
                    'Your own block' :
                    regimeById(block.regimeId).short}
                      {block.note ? ` · ${block.note}` : ''}
                    </span>
                  </span>
                  <input
                  type="checkbox"
                  checked={hidden[block.key] !== true}
                  disabled={block.mandatory}
                  aria-label={`Show ${block.label}`}
                  onChange={(event) =>
                  setHidden((prev) => ({ ...prev, [block.key]: !event.target.checked }))
                  }
                  className="h-4 w-4 flex-none accent-teal disabled:opacity-40" />
                
                </li>
              )}
            </ul>
            <p className="mt-3 text-2xs leading-relaxed text-ink-tertiary">
              Mandatory blocks come from the regimes this product is subject to and cannot be
              removed. Reordering is not built yet — the order here is the order that prints.
            </p>
          </Card>
        </section>

        <section aria-label="Canvas" className="space-y-6">
          <Canvas>
            <ArtefactRenderer
              product={product}
              derivation={derivation}
              market={market}
              artefact={{ ...artefact, widthMm, heightMm }}
              options={{
                fontPt,
                lineSpacing,
                pictogramMm,
                showBranding: hidden.branding !== true,
                blocks: Object.fromEntries(
                  Object.entries(hidden).map(([key, value]) => [key, !value])
                ),
                identityCode
              }} />
            
          </Canvas>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="px-5 py-5">
              <SectionTitle className="mb-3">Geometry rules</SectionTitle>
              <ul className="space-y-3 text-sm">
                {rules.map((rule) =>
                <li
                  key={rule.label}
                  className="border-b border-paper-line pb-3 last:border-0 last:pb-0">
                  
                    <div className="flex items-start justify-between gap-3">
                      <span className="text-ink-secondary">{rule.label}</span>
                      <span className="tabular text-right text-ink">{rule.value}</span>
                    </div>
                    <p className="mt-1 text-2xs text-ink-tertiary">{rule.source}</p>
                  </li>
                )}
                <li className="flex items-start justify-between gap-3">
                  <span className="text-ink-secondary">This surface</span>
                  <span className="tabular text-right">
                    <Pill tone={rules.every((r) => r.ok !== false) ? 'good' : 'warn'}>
                      {widthMm} × {heightMm} mm
                    </Pill>
                  </span>
                </li>
              </ul>
            </Card>

            <Card className="px-5 py-5">
              <SectionTitle className="mb-3">Legibility check</SectionTitle>
              <ul className="space-y-2.5 text-[0.8125rem]">
                <Check
                  ok={fontPt >= MIN_FONT_PT}
                  label={`Font size ${fontPt} pt`}
                  detail={`Minimum ${MIN_FONT_PT} pt for a surface of this size.`} />
                
                <Check
                  ok={lineSpacing >= MIN_LINE_SPACING}
                  label={`Line spacing ${lineSpacing.toFixed(2)}`}
                  detail={`Minimum ${MIN_LINE_SPACING} for continuous text.`} />
                
                {rules.
                filter((rule) => rule.ok !== undefined).
                map((rule) =>
                <Check
                  key={rule.label}
                  ok={rule.ok !== false}
                  label={rule.label}
                  detail={`${rule.value}. ${rule.source}.`} />

                )}
                <Check
                  ok={!optionalCrowds}
                  label="Optional blocks"
                  detail={
                  optionalCrowds ?
                  'An optional block is crowding mandatory content. Remove it, or move to a larger surface, so the required elements stay above the legibility floor.' :
                  'Optional blocks sit clear of mandatory content.'
                  } />
                
              </ul>
            </Card>
          </div>
        </section>
      </div>
    </main>);

}

/**
 * What Batchlabel knows about this surface having been printed. Four states, four sentences.
 *
 * NOTHING HERE CLAIMS A FILE EXISTS. `is_placeholder` is TRUE on every artefact row this app
 * writes, because no exporter has been built — a print record says the MAKER printed something
 * and which composition it was printed from, and that is a genuinely useful fact (it is what
 * answers "which of my labels stopped being right when I corrected my address") without being
 * a claim that Batchlabel produced anything.
 */
function PrintState({ product, artefactType }: {product: Product;artefactType: ArtefactType;}) {
  const artefact = product.artefacts.find((item) => item.type === artefactType);
  if (!artefact) return null;

  if (artefact.currency === 'not-produced') {
    return (
      <Callout tone="info" title="No print recorded for this surface">
        <p className="max-w-prose leading-relaxed">
          Batchlabel does not generate the file yet, so nothing here has been produced. When you
          print this label from your own setup, record it — we keep the version and a fingerprint
          of the composition it was printed from, and tell you if the composition later moves.
        </p>
      </Callout>);

  }

  if (artefact.currency === 'out-of-date') {
    return (
      <Callout tone="warn" role="alert" title={`${artefact.version} no longer matches this product`}>
        <p className="max-w-prose leading-relaxed">
          You recorded printing {artefact.version} on {formatDate(artefact.printedOn)}. The
          composition, the pack, the classification of a material it names, or your printed
          business details have changed since. What is on screen is the current version; what is
          on your jars is not.
        </p>
      </Callout>);

  }

  if (artefact.currency === 'unknown') {
    return (
      <Callout tone="info" title="We could not check this one">
        <p className="max-w-prose leading-relaxed">
          {artefact.version} was recorded as printed on {formatDate(artefact.printedOn)}, but we
          could not work out what this product would be produced from just now, so we will not
          say whether it still matches. Nothing has changed — reload and it will try again.
        </p>
      </Callout>);

  }

  return (
    <Callout tone="info" title={`${artefact.version} still matches this composition`}>
      <p className="max-w-prose leading-relaxed">
        You recorded printing it on {formatDate(artefact.printedOn)}, and nothing that goes onto
        the label has changed since: not the composition, not the pack, not the classification of
        any material it is made from, not your printed business details. Batchlabel did not
        generate the file — this is a record of your print, checked against all four.
      </p>
    </Callout>);

}

/**
 * Records a print. One row in `batchlabel.artefacts`, one line in the append-only log.
 *
 * THE DIALOG SAYS WHAT IT IS RECORDING BEFORE IT RECORDS IT, because "Record a print" could
 * easily be read as "print it for me" on a screen with two export buttons beside it. The
 * sentence at the top is the one that has to survive somebody skim-reading.
 */
function RecordPrintDialog({
  product,
  artefactType,
  widthMm,
  heightMm,
  stockName,
  onClose
}: {
  product: Product;
  artefactType: ArtefactType;
  widthMm: number;
  heightMm: number;
  stockName?: string;
  onClose: () => void;
}) {
  const entitlement = useEntitlement();
  const { reload } = useProducts();
  const [notes, setNotes] = useState('');
  const [when, setWhen] = useState(() => new Date().toISOString().slice(0, 10));
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const submit = async () => {
    if (saving) return;
    setSaving(true);
    setFailure(null);
    const result = await recordArtefactPrinted({
      accountId: entitlement.accountId,
      product,
      artefactType,
      widthMm,
      heightMm,
      notes: notes.trim() || (stockName ? `Printed on ${stockName}.` : null),
      // Midday, so a date typed here cannot land on the previous day once stored as an instant.
      occurredAt: when ? new Date(`${when}T12:00:00`).toISOString() : undefined
    });
    setSaving(false);

    if (!result.ok) {
      setFailure(result.message);
      // A partial save DID store the artefact version, so the list on every other screen is now
      // stale and the drift check will already be using it. Reloading is what stops this screen
      // contradicting the one the maker goes to next.
      if (result.reason === 'partial_save') await reload();
      return;
    }

    await reload();
    onClose();
    toast(`Recorded ${ARTEFACT_LABELS[artefactType].toLowerCase()} v${result.value.version}`, {
      description:
      'Stored with a fingerprint of the composition it was printed from. Batchlabel did not generate a file.'
    });
  };

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-ink/20 px-6"
      role="dialog"
      aria-modal="true"
      aria-label="Record a print">

      <Card className="max-h-[90vh] w-full max-w-lg overflow-y-auto px-6 py-6">
        <h2 className="font-display text-lg font-medium text-ink">Record a print</h2>
        <p className="mt-1 max-w-prose text-sm leading-relaxed text-ink-secondary">
          This does not print anything and does not make a file — Batchlabel cannot do either
          yet. It records that you printed the{' '}
          {ARTEFACT_LABELS[artefactType].toLowerCase()} at {widthMm} × {heightMm} mm, and stores
          a fingerprint of the composition it was printed from, so we can tell you if that
          composition later changes.
        </p>

        <div className="mt-5 space-y-4">
          <Field label="When you printed it" hint="Not when you are typing this in.">
            <input
              type="date"
              value={when}
              onChange={(event) => setWhen(event.target.value)}
              aria-label="Date printed"
              className="tabular w-full rounded-control border border-paper-line bg-paper px-3 py-2 text-sm text-ink" />

          </Field>
          <Field label="Note" hint="Optional. Which printer, which stock, how many.">
            <input
              value={notes}
              placeholder={stockName ? `Printed on ${stockName}` : 'Anything worth remembering'}
              onChange={(event) => setNotes(event.target.value)}
              aria-label="Note"
              className="w-full rounded-control border border-paper-line bg-paper px-3 py-2 text-sm text-ink" />

          </Field>

          {failure &&
          <Callout tone="warn" role="alert" title="That did not record">
              <p className="max-w-prose leading-relaxed">{failure}</p>
            </Callout>
          }

          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="quiet" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button type="button" variant="primary" onClick={submit} disabled={saving}>
              {saving ? 'Recording…' : 'Record it'}
            </Button>
          </div>
        </div>
      </Card>
    </div>);

}

function Check({ ok, label, detail }: {ok: boolean;label: string;detail: string;}) {
  return (
    <li className="flex items-start gap-2.5">
      {ok ?
      <CheckIcon className="mt-0.5 h-4 w-4 flex-none text-teal" strokeWidth={1.5} aria-hidden="true" /> :

      <TriangleAlertIcon
        className="mt-0.5 h-4 w-4 flex-none text-clay"
        strokeWidth={1.5}
        aria-hidden="true" />

      }
      <span>
        <span className={`font-medium ${ok ? 'text-ink' : 'text-clay-dark'}`}>{label}</span>
        <span className="mt-0.5 block leading-relaxed text-ink-tertiary">{detail}</span>
      </span>
    </li>);

}

/** True-size canvas with a millimetre ruler along the top and left edges. */
function Canvas({ children }: {children: React.ReactNode;}) {
  return (
    <div className="overflow-auto rounded-card border border-paper-line bg-paper-panel p-6">
      <div className="inline-block">
        <div className="flex">
          <div style={{ width: '8mm' }} aria-hidden="true" />
          <Ruler orientation="horizontal" lengthMm={150} />
        </div>
        <div className="flex">
          <Ruler orientation="vertical" lengthMm={170} />
          <div className="mm-grid inline-block border border-paper-line p-[4mm]">{children}</div>
        </div>
      </div>
    </div>);

}

function Ruler({
  orientation,
  lengthMm



}: {orientation: 'horizontal' | 'vertical';lengthMm: number;}) {
  const ticks = Array.from({ length: Math.floor(lengthMm / 5) + 1 }, (_, index) => index * 5);
  const horizontal = orientation === 'horizontal';
  return (
    <div
      aria-hidden="true"
      className="relative text-ink-tertiary"
      style={
      horizontal ?
      { width: `${lengthMm}mm`, height: '8mm' } :
      { width: '8mm', height: `${lengthMm}mm` }
      }>
      
      {ticks.map((mm) => {
        const major = mm % 10 === 0;
        return (
          <div
            key={mm}
            className="absolute"
            style={horizontal ? { left: `${mm}mm`, bottom: 0 } : { top: `${mm}mm`, right: 0 }}>
            
            <div
              style={
              horizontal ?
              {
                width: '0.2mm',
                height: major ? '3mm' : '1.6mm',
                background: 'rgb(var(--ink-tertiary))',
                opacity: major ? 0.6 : 0.35
              } :
              {
                height: '0.2mm',
                width: major ? '3mm' : '1.6mm',
                background: 'rgb(var(--ink-tertiary))',
                opacity: major ? 0.6 : 0.35
              }
              } />
            
            {major &&
            <span
              className="tabular absolute text-[7px] leading-none"
              style={horizontal ? { bottom: '3.4mm', left: 0 } : { right: '3.4mm', top: '-3px' }}>
              
                {mm}
              </span>
            }
          </div>);

      })}
    </div>);

}