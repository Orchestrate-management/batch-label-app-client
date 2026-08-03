import { ArtefactInstance, Market, Product } from '../../lib/model';
import { Derivation } from '../../lib/derive';
import { BUSINESS, addressForMarket } from '../../lib/identity';
import { packagingById } from '../../lib/catalog';
import { CandleSafetySymbols, CeMark, PaoSymbol, Pictogram, WeeeBin } from './Symbols';
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
  const { product, artefact } = props;
  if (artefact.type === 'listing') return <ListingBlock {...props} />;
  if (product.categoryId === 'electronics') {
    if (artefact.type === 'rating-plate') return <RatingPlate {...props} />;
    if (artefact.type === 'leaflet') return <DeviceLeaflet {...props} />;
    return <DeviceCarton {...props} />;
  }
  if (product.categoryId === 'cosmetics') return <CosmeticLabel {...props} />;
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

/* ------------------------------------------------------ cosmetics, CPR */

function CosmeticLabel({ product, derivation, market, options }: RenderProps) {
  const cosmetic = derivation.cosmetic;
  const address = addressForMarket(market);
  const body = pt(options.fontPt);
  const small = pt(Math.max(options.fontPt - 0.5, 4));
  if (!cosmetic) return null;

  return (
    <>
      {on(options, 'branding') && options.showBranding &&
      <div
        style={{
          fontSize: pt(options.fontPt + 1.5),
          fontWeight: 700,
          letterSpacing: '0.2mm',
          textTransform: 'uppercase'
        }}>
        
          {BUSINESS.tradingName}
        </div>
      }

      {on(options, 'identifier') &&
      <div>
          <div style={{ fontSize: pt(options.fontPt + 1.5), fontWeight: 700 }}>{product.name}</div>
          <div style={{ fontSize: small }}>{cosmetic.functionLine}</div>
        </div>
      }

      {on(options, 'inci') &&
      <div style={{ fontSize: body }}>
          <span style={{ fontWeight: 700 }}>Ingredients: </span>
          {cosmetic.inciLine}
        </div>
      }

      {on(options, 'cosmeticWarnings') &&
      <div style={{ fontSize: small }}>{cosmetic.warnings.join(' ')}</div>
      }

      <div
        style={{
          marginTop: 'auto',
          display: 'flex',
          alignItems: 'flex-end',
          justifyContent: 'space-between',
          gap: '2mm'
        }}>
        
        <div style={{ fontSize: small, flex: 1, minWidth: 0 }}>
          {on(options, 'responsiblePerson') && <div>{address.lines.join(', ')}</div>}
          {on(options, 'batch') && <div>Batch {options.identityCode}</div>}
        </div>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: '1.5mm', flex: 'none' }}>
          {on(options, 'pao') &&
          <PaoSymbol sizeMm={Math.max(options.pictogramMm * 0.8, 6)} months={Number(cosmetic.pao.replace('M', ''))} />
          }
          {on(options, 'nominalContent') &&
          <span style={{ fontSize: pt(options.fontPt + 1), fontWeight: 700 }}>
              {product.spec.netQuantity} {product.spec.netUnit} ℮
            </span>
          }
        </div>
      </div>
    </>);

}

/* ------------------------------------ electronics, CE, RoHS and WEEE */

function RatingPlate({ product, derivation, market, options }: RenderProps) {
  const device = derivation.device;
  const address = addressForMarket(market);
  const small = pt(Math.max(options.fontPt - 1, 4));
  if (!device) return null;

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1mm' }}>
        <div style={{ minWidth: 0 }}>
          {on(options, 'model') &&
          <div style={{ fontSize: pt(options.fontPt), fontWeight: 700 }}>
              {BUSINESS.tradingName} {device.model}
            </div>
          }
          {on(options, 'ratings') && <div style={{ fontSize: small }}>{device.ratings}</div>}
          <div style={{ fontSize: small }}>Indoor use only</div>
        </div>
        <div style={{ display: 'flex', gap: '1mm', alignItems: 'flex-start', flex: 'none' }}>
          {on(options, 'ceMark') && <CeMark heightMm={5} />}
          {on(options, 'weeeBin') && <WeeeBin heightMm={5} />}
        </div>
      </div>

      <div style={{ marginTop: 'auto', fontSize: small }}>
        {on(options, 'importer') && <div>{address.lines.slice(0, 2).join(', ')}</div>}
        <div>
          {product.identifiers.weeeRegistration} · Serial {options.identityCode}
        </div>
      </div>
    </>);

}

function DeviceCarton({ product, derivation, market, options }: RenderProps) {
  const device = derivation.device;
  const address = addressForMarket(market);
  const body = pt(options.fontPt);
  const small = pt(Math.max(options.fontPt - 0.5, 4));
  if (!device) return null;

  return (
    <>
      {on(options, 'branding') && options.showBranding &&
      <div style={{ fontSize: pt(options.fontPt + 2), fontWeight: 700, textTransform: 'uppercase' }}>
          {BUSINESS.tradingName}
        </div>
      }
      {on(options, 'model') &&
      <div style={{ fontSize: pt(options.fontPt + 1.5), fontWeight: 700 }}>
          {product.name}, model {device.model}
        </div>
      }
      <div style={{ fontSize: body }}>{device.ratings}</div>
      {on(options, 'rohsStatement') &&
      <div style={{ fontSize: small }}>
          Conforms to Directive 2011/65/EU on the restriction of hazardous substances.
        </div>
      }
      <div style={{ fontSize: small }}>Standards applied: {device.standards.join(', ')}</div>

      <div
        style={{
          marginTop: 'auto',
          display: 'flex',
          alignItems: 'flex-end',
          justifyContent: 'space-between',
          gap: '2mm'
        }}>
        
        <div style={{ fontSize: small, flex: 1, minWidth: 0 }}>
          {on(options, 'importer') && <div>{address.lines.join(', ')}</div>}
          <div>
            {product.identifiers.weeeRegistration} · Batch {options.identityCode}
          </div>
        </div>
        <div style={{ display: 'flex', gap: '1.5mm', flex: 'none' }}>
          {on(options, 'ceMark') && <CeMark heightMm={6} />}
          {on(options, 'weeeBin') && <WeeeBin heightMm={6} />}
        </div>
      </div>
    </>);

}

function DeviceLeaflet({ product, derivation, market, options }: RenderProps) {
  const device = derivation.device;
  const address = addressForMarket(market);
  const body = pt(options.fontPt);
  const small = pt(Math.max(options.fontPt - 0.5, 4));
  if (!device) return null;

  const instructions = [
  'Use indoors only, on a flat, heat resistant surface.',
  'Do not immerse the base in water or use with wet hands.',
  'Disconnect the supply lead before cleaning and when not in use.',
  'Do not use if the supply lead or housing is damaged.',
  'Keep out of reach of children and pets.'];


  return (
    <>
      <div style={{ fontSize: pt(options.fontPt + 2), fontWeight: 700 }}>
        {product.name}, model {device.model}
      </div>
      <div style={{ fontSize: body }}>{device.ratings}</div>

      {on(options, 'safetyInstructions') &&
      <div style={{ fontSize: body }}>
          <div style={{ fontWeight: 700, marginTop: '1mm' }}>Safety instructions</div>
          <ol style={{ margin: '1mm 0 0 4mm', padding: 0 }}>
            {instructions.map((line) =>
          <li key={line} style={{ marginBottom: '0.6mm' }}>
                {line}
              </li>
          )}
          </ol>
        </div>
      }

      <div style={{ fontSize: body, marginTop: '1.5mm' }}>
        <div style={{ fontWeight: 700 }}>Conformity</div>
        <div>
          This product conforms to the Low Voltage Directive 2014/35/EU and the EMC Directive
          2014/30/EU. Standards applied: {device.standards.join(', ')}.
        </div>
      </div>

      {on(options, 'rohsStatement') &&
      <div style={{ fontSize: small, marginTop: '1mm' }}>
          Conforms to Directive 2011/65/EU on the restriction of hazardous substances, assessed
          under EN IEC 63000:2018.
        </div>
      }

      <div style={{ display: 'flex', gap: '2mm', alignItems: 'flex-start', marginTop: '1.5mm' }}>
        {on(options, 'weeeBin') && <WeeeBin heightMm={8} />}
        <span style={{ fontSize: small }}>
          Do not dispose of this product with household waste. Take it to a collection point for
          waste electrical and electronic equipment. Producer registration{' '}
          {product.identifiers.weeeRegistration}.
        </span>
      </div>

      <div style={{ marginTop: 'auto', fontSize: small }}>
        {on(options, 'traceability') &&
        <div>
            {address.lines.join(', ')}. Tel {BUSINESS.phone}.
          </div>
        }
        <div>
          Model year {product.identifiers.modelYear} · Serial {options.identityCode}
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

      {derivation.cosmetic &&
      <div style={{ fontSize: body }}>
          <div style={{ fontWeight: 700 }}>Ingredients</div>
          <div>{derivation.cosmetic.inciLine}</div>
          <div style={{ marginTop: '1mm' }}>{derivation.cosmetic.warnings.join(' ')}</div>
        </div>
      }

      {derivation.device &&
      <div style={{ fontSize: body }}>
          <div style={{ fontWeight: 700 }}>
            Model {derivation.device.model}, {derivation.device.ratings}
          </div>
          <div>
            Indoor use only. Keep out of reach of children. Do not use if the supply lead is
            damaged.
          </div>
          <div style={{ display: 'flex', gap: '1.5mm', alignItems: 'center', marginTop: '1mm' }}>
            <CeMark heightMm={5} />
            <WeeeBin heightMm={5} />
            <span style={{ fontSize: small }}>
              Producer registration {product.identifiers.weeeRegistration}
            </span>
          </div>
        </div>
      }

      <div style={{ marginTop: 'auto', fontSize: small }}>
        {address.lines[0]}, {address.lines[address.lines.length - 2]}. Tel {BUSINESS.phone}.
      </div>
    </>);

}