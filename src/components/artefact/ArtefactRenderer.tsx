import { ArtefactInstance, Market, Product } from '../../lib/model';
import { Derivation } from '../../lib/derive';
import { BUSINESS, addressForMarket } from '../../lib/identity';
import { packagingById } from '../../lib/material-index';
import { CandleSafetySymbols, Pictogram } from './Symbols';
import { SdsDocument } from './SdsDocument';
import { buildSds } from '../../lib/sds';

export type ArtefactOptions = {
  fontPt: number;
  lineSpacing: number;
  pictogramMm: number;
  showBranding: boolean;
  blocks: Record<string, boolean>;
  identityCode: string;
};

export function defaultArtefactOptions(overrides: Partial<ArtefactOptions> = {}): ArtefactOptions {
  return {
    fontPt: 6,
    lineSpacing: 1.18,
    pictogramMm: 10,
    showBranding: true,
    blocks: {},
    identityCode: '',
    ...overrides
  };
}

const pt = (value: number) => `${(value * 0.3528).toFixed(2)}mm`;

function on(options: ArtefactOptions, key: string): boolean {
  return options.blocks[key] !== false;
}

type RenderProps = {
  product: Product;
  derivation: Derivation;
  market: Market;
  artefact: ArtefactInstance;
  options: ArtefactOptions;
};

/**
 * Every regulated surface renders here. Pure white, black text, mandated
 * geometry, at true physical size. No brand token reaches inside this tree.
 */
export function ArtefactRenderer(props: RenderProps) {
  const { artefact, product, derivation, market } = props;

  // The safety data sheet is a paginated A4 document rather than a single
  // bounded surface, so it renders its own pages.
  if (artefact.type === 'sds') {
    return <SdsDocument model={buildSds(product, derivation, market)} />;
  }

  return (
    <div
      className="artefact-surface"
      style={{
        width: `${artefact.widthMm}mm`,
        height: `${artefact.heightMm}mm`,
        background: '#FFFFFF',
        color: '#000000',
        border: '0.2mm solid #000000',
        padding: '2mm',
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'column',
        gap: '1mm',
        lineHeight: String(props.options.lineSpacing),
        overflow: 'hidden'
      }}
      role="img"
      aria-label={`${artefact.label} for ${product.name}`}>
      
      {renderBody(props)}
    </div>);

}

function renderBody(props: RenderProps) {
  if (props.artefact.type === 'listing') return <ListingBlock {...props} />;
  return <FragranceLabel {...props} />;
}

/* ------------------------------------------------- home fragrance, CLP */

function FragranceLabel({ product, derivation, market, options }: RenderProps) {
  const clp = derivation.clp;
  const address = addressForMarket(market);
  const body = pt(options.fontPt);
  const small = pt(Math.max(options.fontPt - 0.5, 4));
  if (!clp) return null;

  return (
    <>
      {on(options, 'branding') && options.showBranding &&
      <div
        style={{
          fontSize: pt(options.fontPt + 2),
          fontWeight: 700,
          letterSpacing: '0.2mm',
          textTransform: 'uppercase'
        }}>
        
          {BUSINESS.tradingName}
        </div>
      }

      {on(options, 'identifier') &&
      <div style={{ fontSize: pt(options.fontPt + 1.5), fontWeight: 700 }}>
          {product.name} — {product.spec.productType.toLowerCase()}
        </div>
      }

      <div style={{ display: 'flex', gap: '1.5mm', alignItems: 'flex-start' }}>
        {on(options, 'pictograms') && clp.pictograms.length > 0 &&
        <div style={{ display: 'flex', gap: '1mm', flex: 'none' }}>
            {clp.pictograms.map((code) =>
          <Pictogram key={code} code={code} sizeMm={options.pictogramMm} />
          )}
          </div>
        }
        <div style={{ flex: 1, minWidth: 0 }}>
          {on(options, 'signalWord') && clp.signalWord &&
          <div style={{ fontSize: pt(options.fontPt + 1), fontWeight: 700 }}>{clp.signalWord}</div>
          }
          {on(options, 'hazard') &&
          <div style={{ fontSize: body }}>
              {clp.hazards.map((h) =>
            <div key={h.code}>
                  {h.code} {h.text}
                </div>
            )}
            </div>
          }
        </div>
      </div>

      {on(options, 'precautionary') &&
      <div style={{ fontSize: body }}>
          {clp.precautions.map((p) =>
        <span key={p.code}>
              {p.code} {p.text}{' '}
            </span>
        )}
        </div>
      }

      {on(options, 'allergen') && clp.allergenLine &&
      <div style={{ fontSize: body }}>EUH208 {clp.allergenLine}</div>
      }

      {on(options, 'candleSafety') &&
      clp.supplementary.map((s) =>
      <div key={s.code} style={{ display: 'flex', gap: '1mm', alignItems: 'flex-start' }}>
            <CandleSafetySymbols sizeMm={Math.max(options.pictogramMm * 0.6, 5)} />
            <span style={{ fontSize: small }}>{s.text}</span>
          </div>
      )}

      <div style={{ marginTop: 'auto', fontSize: small }}>
        {on(options, 'supplier') &&
        <div>
            {address.lines.join(', ')}
            {on(options, 'telephone') ? `. Tel ${BUSINESS.phone}` : ''}
          </div>
        }
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '2mm' }}>
          <span>
            {/* A mandatory block with nothing behind it is named, not silently dropped:
                an empty space where the UFI belongs reads as a finished label. */}
            {on(options, 'ufi') ? `UFI: ${product.identifiers.ufi ?? 'not generated'}` : ''}
            {on(options, 'batch') ? `   Batch ${options.identityCode}` : ''}
          </span>
          {on(options, 'quantity') &&
          <span style={{ fontWeight: 700 }}>
              {product.spec.netQuantity} {product.spec.netUnit} ℮
            </span>
          }
        </div>
      </div>
    </>);

}

/* --------------------------------------------------- online listing, GPSR */

function ListingBlock({ product, derivation, market, options }: RenderProps) {
  const address = addressForMarket(market);
  const body = pt(options.fontPt);
  const small = pt(Math.max(options.fontPt - 0.5, 4));
  const packaging = packagingById(product.spec.packagingId);

  return (
    <>
      <div style={{ fontSize: pt(options.fontPt + 1), fontWeight: 700 }}>
        Safety information, shown before purchase
      </div>
      <div style={{ fontSize: small }}>
        {product.name} · {product.sku} · {product.spec.netQuantity} {product.spec.netUnit}
        {packaging ? ` · ${packaging.format}` : ''}
      </div>

      {derivation.clp &&
      <div style={{ display: 'flex', gap: '1.5mm', alignItems: 'flex-start' }}>
          <div style={{ display: 'flex', gap: '1mm', flex: 'none' }}>
            {derivation.clp.pictograms.map((code) =>
          <Pictogram key={code} code={code} sizeMm={8} />
          )}
          </div>
          <div style={{ flex: 1, minWidth: 0, fontSize: body }}>
            {derivation.clp.signalWord &&
          <div style={{ fontWeight: 700 }}>{derivation.clp.signalWord}</div>
          }
            {derivation.clp.hazards.map((h) =>
          <div key={h.code}>
                {h.code} {h.text}
              </div>
          )}
            {derivation.clp.allergenLine && <div>EUH208 {derivation.clp.allergenLine}</div>}
          </div>
        </div>
      }

      <div style={{ marginTop: 'auto', fontSize: small }}>
        {address.lines[0]}, {address.lines[address.lines.length - 2]}. Tel {BUSINESS.phone}.
      </div>
    </>);

}