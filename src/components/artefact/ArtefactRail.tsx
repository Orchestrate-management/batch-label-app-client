import React, { useState } from 'react';
import { ChevronUpIcon, RulerIcon } from 'lucide-react';
import { ArtefactInstance, Market, Product } from '../../lib/model';
import { Derivation, clpMinimumDimensions } from '../../lib/derive';
import { packagingById } from '../../lib/catalog';
import { driftFor } from '../../lib/products';
import { Pill } from '../ui/Primitives';
import { ArtefactRenderer, defaultArtefactOptions } from './ArtefactRenderer';

type RailProps = {
  product: Product;
  derivation: Derivation;
  market: Market;
  identityCode: string;
  caption?: string;
};

function optionsFor(product: Product, identityCode: string) {
  const packaging = packagingById(product.spec.packagingId);
  const pictogramMm = product.regimes.includes('clp') ?
  clpMinimumDimensions(packaging?.capacityMl ?? 100).pictogram :
  8;
  return defaultArtefactOptions({ pictogramMm, identityCode });
}

function Surface({
  product,
  derivation,
  market,
  artefact,
  identityCode
}: RailProps & {artefact: ArtefactInstance;}) {
  return (
    <div className="mm-grid flex items-start justify-center overflow-auto rounded-control border border-paper-line p-4">
      <ArtefactRenderer
        product={product}
        derivation={derivation}
        market={market}
        artefact={artefact}
        options={optionsFor(product, identityCode)} />
      
    </div>);

}

/**
 * The persistent true-size rail. One tab per output: the label surfaces the
 * product's regimes require, and the safety data sheet. One visible at a time,
 * always at actual physical size.
 */
export function ArtefactRail(props: RailProps) {
  const { product, market, caption } = props;
  const [activeType, setActiveType] = useState(product.artefacts[0]?.type);
  const [open, setOpen] = useState(false);

  const artefact = product.artefacts.find((a) => a.type === activeType) ?? product.artefacts[0];
  if (!artefact) return null;

  const isSds = artefact.type === 'sds';
  const drift = driftFor(product);

  const tabs =
  <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Outputs">
      {product.artefacts.map((item) => {
      const active = item.type === artefact.type;
      return (
        <button
          key={item.type}
          role="tab"
          aria-selected={active}
          type="button"
          onClick={() => setActiveType(item.type)}
          className={`rounded-control border px-2.5 py-1.5 text-2xs transition-colors ${
          active ?
          'border-teal bg-teal-tint text-teal-hover' :
          'border-paper-line bg-paper text-ink-secondary hover:bg-paper-panel'}`
          }>
          
            {item.label}
            {!item.current && <span className="ml-1.5 text-clay">·</span>}
          </button>);

    })}
    </div>;


  const meta =
  <div className="flex flex-wrap items-center gap-2">
      <Pill tone="quiet">
        <RulerIcon className="h-3 w-3" strokeWidth={1.25} aria-hidden="true" />
        <span className="tabular">
          {isSds ? 'A4, 210 × 297 mm' : `${artefact.widthMm} × ${artefact.heightMm} mm`}
        </span>
      </Pill>
      <Pill tone="quiet">{market === 'GB' ? 'GB' : 'EU and NI'}</Pill>
      <Pill tone={artefact.current ? 'quiet' : 'warn'}>
        {artefact.version}
        {artefact.current ? '' : ', out of date'}
      </Pill>
    </div>;


  return (
    <>
      <aside
        className="surface-shift hidden w-[400px] flex-none border-l border-paper-line bg-paper-panel/50 xl:block"
        aria-label="True size output preview">
        
        <div className="sticky top-0 max-h-screen overflow-y-auto p-6">
          <h2 className="font-display text-[0.8125rem] font-medium uppercase tracking-[0.14em] text-ink-tertiary">
            Output preview
          </h2>
          <p className="mt-1 text-2xs leading-relaxed text-ink-tertiary">
            {caption ?? 'Actual size. Both outputs come from one classification, so they cannot disagree.'}
          </p>
          <div className="mt-3">{tabs}</div>
          <div className="mt-3">
            <Surface {...props} artefact={artefact} />
          </div>
          <div className="mt-3">{meta}</div>
          {isSds &&
          <p className="mt-3 rounded-control border border-paper-line bg-paper px-3 py-2 text-2xs leading-relaxed text-ink-tertiary">
              A4 at actual size, so it is wider than the rail. Scroll the frame to read across the
              page.
            </p>
          }
          {!artefact.current && drift &&
          <p className="mt-3 rounded-control border border-clay/30 bg-clay-tint px-3 py-2 text-2xs leading-relaxed text-clay-dark">
              {drift.sentence}
            </p>
          }
        </div>
      </aside>

      <div className="fixed inset-x-0 bottom-0 z-30 xl:hidden">
        <div className="border-t border-paper-line bg-paper">
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            aria-expanded={open}
            className="flex w-full items-center justify-between px-5 py-3 text-left">
            
            <span className="font-display text-sm font-medium text-ink">
              {artefact.label}, actual size
            </span>
            <span className="flex items-center gap-2 text-2xs text-ink-tertiary">
              <span className="tabular">
                {isSds ? 'A4' : `${artefact.widthMm} × ${artefact.heightMm} mm`}
              </span>
              <ChevronUpIcon
                className={`h-4 w-4 transition-transform ${open ? 'rotate-180' : ''}`}
                strokeWidth={1.25}
                aria-hidden="true" />
              
            </span>
          </button>
          {open &&
          <div className="max-h-[62vh] space-y-3 overflow-y-auto px-5 pb-5">
              {tabs}
              <Surface {...props} artefact={artefact} />
              {meta}
            </div>
          }
        </div>
      </div>
    </>);

}