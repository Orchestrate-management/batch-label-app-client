import React, { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ColumnsIcon, HistoryIcon, TagIcon } from 'lucide-react';
import { toast } from 'sonner';
import { PageHeader } from '../components/AppShell';
import { Button, Card, Field, Input, Pill, SectionTitle, Select } from '../components/ui/Primitives';
import { DerivationPanel } from '../components/DerivationPanel';
import { ArtefactRail } from '../components/artefact/ArtefactRail';
import { ArtefactRenderer, defaultArtefactOptions } from '../components/artefact/ArtefactRenderer';
import {
  BomSpec,
  Market,
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
import { COMPONENTS, INGREDIENTS, PACKAGING, componentById, ingredientById, packagingById } from '../lib/catalog';
import { PRODUCTS, addressForMarket, categoryById, driftFor, productById } from '../lib/products';
import { regimeById } from '../lib/regimes';
import { useCategorySurface } from '../lib/workspace';

export function Specification() {
  const { productId } = useParams();
  const product = productById(productId ?? '') ?? PRODUCTS[0];
  const category = categoryById(product.categoryId);
  useCategorySurface(product.categoryId);

  const [spec, setSpec] = useState<Spec>(product.spec);
  const [market, setMarket] = useState<Market>(product.markets[0]);
  const [compare, setCompare] = useState(false);
  const [stage, setStage] = useState<StageId>('composition');

  // The route reuses this component when only the product changes, so the
  // working composition has to follow the product rather than the mount.
  useEffect(() => {
    setSpec(product.spec);
    setMarket(product.markets[0]);
    setStage('composition');
  }, [product.id]);

  const working: Product = { ...product, spec };
  const derivation = useMemo(() => derive(spec, working, market), [spec, market, product.id]);
  const stale = product.artefacts.filter((artefact) => !artefact.current);
  const identityCode = category.recordIdentity === 'batch' ? 'BFC-2607-014' : 'WW100-26-0001';
  const stages = useMemo(
    () => stagesFor(working, derivation, market),
    [derivation, market, product.id]
  );
  const sds = product.artefacts.some((artefact) => artefact.type === 'sds') ?
  buildSds(working, derivation, market) :
  null;
  const drift = driftFor(product);

  return (
    <div className="flex min-w-0 flex-1">
      <main className="min-w-0 flex-1 pb-24 xl:pb-0">
        <PageHeader
          eyebrow={`${category.name} · ${product.sku}`}
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
              <Button
              variant="primary"
              onClick={() =>
              toast('Outputs generated', {
                description: `${product.artefacts.length} outputs for ${product.name}, all from the current composition.`
              })
              }>
              
                <TagIcon className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />
                Generate outputs
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

            {drift &&
            <div className="rounded-card border border-clay/30 bg-clay-tint px-5 py-4">
                <p className="max-w-prose text-[0.8125rem] leading-relaxed text-clay-dark">
                  {drift.sentence}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {stale.map((artefact) =>
                <Button
                  key={artefact.type}
                  size="sm"
                  variant="secondary"
                  onClick={() =>
                  toast('Output versioned', {
                    description: `${artefact.label} versioned. ${artefact.version} is kept for runs already made.`
                  })
                  }>
                  
                      <HistoryIcon className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />
                      Version {artefact.label.toLowerCase()}
                    </Button>
                )}
                </div>
              </div>
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
                      <Pill tone={artefact.current ? 'good' : 'warn'}>
                        {artefact.current ? 'Current' : 'Out of date'}
                      </Pill>
                    </li>);

                })}
              </ul>
            </Card>

            {sds && <SdsSummary sds={sds} />}
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
 * The sheet is a legal document, so what it cannot derive is stated rather than
 * quietly filled. This counts those sections and names them.
 */
function SdsSummary({ sds }: {sds: SdsDocumentModel;}) {
  const needsYou = sds.sections.filter((section) => section.kind === 'needs-you');
  const derived = sds.sections.filter((section) => section.kind === 'derived');

  return (
    <Card className="px-5 py-5">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <SectionTitle>Safety data sheet, {sds.version}</SectionTitle>
        <Pill tone={needsYou.length ? 'warn' : 'good'}>
          {needsYou.length ?
          `${needsYou.length} sections need you` :
          'Every section complete'}
        </Pill>
      </div>
      <p className="mt-2 max-w-prose text-[0.8125rem] leading-relaxed text-ink-secondary">
        {derived.length} of the sixteen sections are derived from the composition and the supplier
        sheets on file, and carry the same reasoning as the label. The sheet is a draft for review
        by a competent person; the app produces it and shows its working, but does not sign it.
      </p>
      {needsYou.length > 0 &&
      <ul className="mt-4 space-y-2.5">
          {needsYou.map((section) =>
        <li key={section.number} className="flex gap-3">
              <span className="tabular mt-0.5 flex-none text-2xs font-medium text-clay-dark">
                {String(section.number).padStart(2, '0')}
              </span>
              <span className="min-w-0">
                <span className="block text-[0.8125rem] font-medium text-ink">{section.title}</span>
                <span className="mt-0.5 block max-w-prose text-2xs leading-relaxed text-ink-tertiary">
                  {section.prompt}
                </span>
              </span>
            </li>
        )}
        </ul>
      }
    </Card>);

}

function comparisonRows(product: Product, spec: Spec) {
  const rows: React.ReactNode[] = [
  <DiffRow
    key="address"
    element="Address block"
    gb="Hearth and Hollow Ltd, Lewes BN7 2QA"
    eu="Kelder Compliance BV, Rotterdam"
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
        gb="Hearth and Hollow Ltd, Lewes"
        eu="Kelder Compliance BV, Rotterdam"
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

/* --------------------------------------------------- mixture, fragrance */

function MixtureEditor({
  spec,
  onChange



}: {spec: MixtureSpec;onChange: (next: MixtureSpec) => void;}) {
  const set = <K extends keyof MixtureSpec,>(key: K, value: MixtureSpec[K]) =>
  onChange({ ...spec, [key]: value });

  const bases = INGREDIENTS.filter((i) => i.role === 'Wax' || i.role === 'Carrier');
  const oils = INGREDIENTS.filter((i) => i.role === 'Fragrance oil');
  const dyes = INGREDIENTS.filter((i) => i.role === 'Dye');
  const fragrance = ingredientById(spec.fragranceId);

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

        <Field
          label="Base wax or carrier"
          hint={`${ingredientById(spec.baseId)?.supplier ?? ''}, document v${ingredientById(spec.baseId)?.document.version ?? ''}`}>
          
          <Select value={spec.baseId} onChange={(event) => set('baseId', event.target.value)}>
            {bases.map((base) =>
            <option key={base.id} value={base.id}>
                {base.name}
              </option>
            )}
          </Select>
        </Field>

        <Field
          label="Fragrance oil"
          hint={`${fragrance?.supplier ?? ''}, document v${fragrance?.document.version ?? ''}`}>
          
          <Select
            value={spec.fragranceId}
            onChange={(event) => set('fragranceId', event.target.value)}>
            
            {oils.map((oil) =>
            <option key={oil.id} value={oil.id}>
                {oil.name}
              </option>
            )}
          </Select>
        </Field>

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
          
          <p className="mt-2 text-2xs text-ink-tertiary">
            IFRA category 12 maximum for this oil is{' '}
            <span className="tabular">{fragrance?.ifra[0]?.max ?? 100} percent</span>.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Dye">
            <Select value={spec.dyeId} onChange={(event) => set('dyeId', event.target.value)}>
              {dyes.map((dye) =>
              <option key={dye.id} value={dye.id}>
                  {dye.name}
                </option>
              )}
            </Select>
          </Field>
          <Field label="Additives">
            <Input value={spec.additive} onChange={(event) => set('additive', event.target.value)} />
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
          <Field
            label="Packaging"
            hint={`Capacity ${packagingById(spec.packagingId)?.capacityMl ?? 0} ml`}>
            
            <Select
              value={spec.packagingId}
              onChange={(event) => set('packagingId', event.target.value)}>
              
              {PACKAGING.filter((p) => p.categories.includes('home-fragrance')).map((item) =>
              <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              )}
            </Select>
          </Field>
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
          <tbody>
            <tr className="border-t border-paper-line">
              <td className="py-2 text-ink">{ingredientById(spec.baseId)?.name}</td>
              <td className="tabular py-2 text-right text-ink-secondary">
                {(100 - spec.load).toFixed(1)} %
              </td>
            </tr>
            <tr className="border-t border-paper-line">
              <td className="py-2 text-ink">{fragrance?.name}</td>
              <td className="tabular py-2 text-right text-ink-secondary">
                {spec.load.toFixed(1)} %
              </td>
            </tr>
            <tr className="border-t border-paper-line">
              <td className="py-2 text-ink-tertiary">{ingredientById(spec.dyeId)?.name}</td>
              <td className="tabular py-2 text-right text-ink-tertiary">
                {spec.dyeId === 'ing-no-dye' ? '0.0 %' : '0.5 %'}
              </td>
            </tr>
          </tbody>
        </table>
      </Card>
    </>);

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

  const cosmeticIngredients = INGREDIENTS.filter((i) => i.categories.includes('cosmetics'));

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
          <Field label="Period after opening" hint="Months">
            <Input
              type="number"
              className="tabular"
              value={spec.paoMonths}
              onChange={(event) => onChange({ ...spec, paoMonths: Number(event.target.value) })} />
            
          </Field>
          <Field
            label="Packaging"
            hint={`Printable area ${packagingById(spec.packagingId)?.labelAreaMm.width ?? 0} × ${packagingById(spec.packagingId)?.labelAreaMm.height ?? 0} mm`}
            className="sm:col-span-2">
            
            <Select
              value={spec.packagingId}
              onChange={(event) => onChange({ ...spec, packagingId: event.target.value })}>
              
              {PACKAGING.filter((p) => p.categories.includes('cosmetics')).map((item) =>
              <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              )}
            </Select>
          </Field>
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
                      <Select
                        value={item.materialId}
                        aria-label={`Ingredient ${itemIndex + 1} in ${phase.name}`}
                        onChange={(event) =>
                        setItemMaterial(phaseIndex, itemIndex, event.target.value)
                        }>
                        
                        {cosmeticIngredients.map((option) =>
                        <option key={option.id} value={option.id}>
                            {option.name}
                          </option>
                        )}
                      </Select>
                      <p className="mt-1 text-2xs text-ink-tertiary">
                        {ingredient?.inci ?? 'No INCI name on file'}
                        {ingredient?.inciFunction ? ` · ${ingredient.inciFunction}` : ''}
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
          <Field label="Model and type reference">
            <Input
              value={spec.model}
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
          <Field label="Packaging">
            <Select
              value={spec.packagingId}
              onChange={(event) => onChange({ ...spec, packagingId: event.target.value })}>
              
              {PACKAGING.filter((p) => p.categories.includes('electronics')).map((item) =>
              <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              )}
            </Select>
          </Field>
        </div>
      </Card>

      <Card className="px-5 py-5">
        <SectionTitle className="mb-3">Components</SectionTitle>
        <div className="space-y-3">
          {spec.items.map((item, index) => {
            const component = componentById(item.materialId);
            return (
              <div key={item.position} className="rounded-control border border-paper-line px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-2xs uppercase tracking-[0.1em] text-ink-tertiary">
                    {item.position}
                  </p>
                  <Pill tone={component?.rohsStatus === 'Not declared' ? 'warn' : 'good'}>
                    {component?.rohsStatus ?? 'Unknown'}
                  </Pill>
                </div>
                <div className="mt-2">
                  <Select
                    value={item.materialId}
                    aria-label={`Component at ${item.position}`}
                    onChange={(event) => setItemMaterial(index, event.target.value)}>
                    
                    {COMPONENTS.map((option) =>
                    <option key={option.id} value={option.id}>
                        {option.name}
                      </option>
                    )}
                  </Select>
                </div>
                <p className="tabular mt-2 text-2xs text-ink-tertiary">
                  {component?.partNumber} · {component?.supplier} ·{' '}
                  {component?.document.kind ?? 'No document'}{' '}
                  {component?.document.version !== '—' ? `v${component?.document.version}` : ''} ·
                  quantity {item.quantity}
                </p>
              </div>);

          })}
        </div>
        <p className="mt-4 max-w-prose text-2xs leading-relaxed text-ink-tertiary">
          A device has no composition arithmetic. What makes the declaration supportable is evidence
          per component, which is what the conformity file on the right assembles.
        </p>
      </Card>
    </>);

}