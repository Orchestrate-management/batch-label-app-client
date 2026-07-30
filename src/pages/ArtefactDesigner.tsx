import React, { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeftIcon,
  CheckIcon,
  DownloadIcon,
  GripVerticalIcon,
  TriangleAlertIcon } from
'lucide-react';
import { toast } from 'sonner';
import { PageHeader } from '../components/AppShell';
import { Button, Card, Field, Pill, SectionTitle, Select } from '../components/ui/Primitives';
import { ArtefactRenderer } from '../components/artefact/ArtefactRenderer';
import { ArtefactType, Market } from '../lib/model';
import {
  MIN_FONT_PT,
  MIN_LINE_SPACING,
  clpMinimumDimensions,
  derive,
  geometryRules } from
'../lib/derive';
import { packagingById } from '../lib/catalog';
import {
  ARTEFACT_LABELS,
  PRODUCTS,
  STOCK,
  addressForMarket,
  categoryById,
  productById } from
'../lib/products';
import { blocksFor, regimeById } from '../lib/regimes';
import { useCategorySurface } from '../lib/workspace';

export function ArtefactDesigner() {
  const { productId, artefactType } = useParams();
  const navigate = useNavigate();

  // The designer always knows what it is designing: both the product and the
  // surface come from the route, never from a picker inside the screen.
  const product = productById(productId ?? '') ?? PRODUCTS[0];
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

  const openSurface = (type: ArtefactType) => {
    const firstStock = STOCK.find((s) => s.artefactType === type);
    if (firstStock) setStockId(firstStock.id);
    setHidden({});
    navigate(`/products/${product.id}/artefacts/${type}`);
  };

  const derivation = useMemo(() => derive(product.spec, product, market), [product, market]);

  const stockOptions = STOCK.filter((s) => s.artefactType === artefact.type);
  const stock = stockOptions.find((s) => s.id === stockId) ?? stockOptions[0];
  const widthMm = stock?.widthMm ?? artefact.widthMm;
  const heightMm = stock?.heightMm ?? artefact.heightMm;

  const blocks = blocksFor(product, artefact.type);
  const packaging = packagingById(product.spec.packagingId);
  const pictogramMm = product.regimes.includes('clp') ?
  clpMinimumDimensions(packaging?.capacityMl ?? 100).pictogram :
  8;

  const rules = geometryRules(product, widthMm, heightMm);
  const brandingShown = hidden.branding !== true && blocks.some((b) => b.key === 'branding');
  const area = widthMm * heightMm;
  // An optional block crowds when the surface is tight and the type is already
  // at the legibility floor. The same check covers any optional block, not only branding.
  const optionalCrowds = brandingShown && fontPt <= MIN_FONT_PT && area < 4500;

  const identityCode = category.recordIdentity === 'batch' ? 'BFC-2607-014' : 'WW100-26-0001';

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
            <Button
            variant="secondary"
            onClick={() =>
            toast('Sheet exported', {
              description: stock ?
              `${stock.name}, ${stock.perSheet} per ${stock.sheet}.` :
              'Sheet layout exported.'
            })
            }>
            
              <DownloadIcon className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />
              Export sheet
            </Button>
            <Button
            variant="primary"
            onClick={() =>
            toast('Artefact exported', {
              description: `Single ${ARTEFACT_LABELS[artefact.type].toLowerCase()} PDF at ${widthMm} × ${heightMm} mm.`
            })
            }>
            
              Export PDF
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
                      {!item.current && <span className="ml-1.5 text-clay">·</span>}
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
                    className="h-1.5 w-full appearance-none rounded-full bg-paper-line accent-[#1A6A62]" />
                  
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
                    className="h-1.5 w-full appearance-none rounded-full bg-paper-line accent-[#1A6A62]" />
                  
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
                
                  <GripVerticalIcon
                  className="h-4 w-4 flex-none text-ink-tertiary"
                  strokeWidth={1.25}
                  aria-hidden="true" />
                
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
                  className="h-4 w-4 flex-none accent-[#1A6A62] disabled:opacity-40" />
                
                </li>
              )}
            </ul>
            <p className="mt-3 text-2xs leading-relaxed text-ink-tertiary">
              Mandatory blocks come from the regimes this product is subject to and cannot be
              removed. Reorder by dragging.
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
                background: '#5F6E6A',
                opacity: major ? 0.6 : 0.35
              } :
              {
                height: '0.2mm',
                width: major ? '3mm' : '1.6mm',
                background: '#5F6E6A',
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