import {
  ArtefactStock,
  ArtefactType,
  Attention,
  CategoryId,
  ConformityDocument,
  Product,
  ProductionRecord,
  RegimeId,
  Spec,
  SupplierAddress,
  TeamMember } from
'./model';

/* --------------------------------------------------------- category packs */

export type CategoryPack = {
  id: CategoryId;
  name: string;
  short: string;
  blurb: string;
  specKind: 'mixture' | 'phased' | 'bom';
  productTypes: string[];
  regimes: RegimeId[];
  artefacts: ArtefactType[];
  recordIdentity: 'batch' | 'serial-range';
  surface: 'warm' | 'neutral';
  strings: {
    specTitle: string;
    specHelp: string;
    derivationTitle: string;
    derivationHelp: string;
    quantityNoun: string;
    recordNoun: string;
    lotNoun: string;
  };
};

export const CATEGORIES: CategoryPack[] = [
{
  id: 'home-fragrance',
  name: 'Home fragrance',
  short: 'Fragrance',
  blurb: 'Container candles, wax melts, reed diffusers and room sprays.',
  specKind: 'mixture',
  productTypes: ['Container candle', 'Wax melt', 'Reed diffuser', 'Room spray'],
  regimes: ['clp', 'en15494', 'gpsr'],
  artefacts: ['unit-label', 'listing'],
  recordIdentity: 'batch',
  surface: 'warm',
  strings: {
    specTitle: 'Recipe',
    specHelp:
    'Change the recipe on the left. The classification recalculates on every change, and the artefact on the right redraws at actual size.',
    derivationTitle: 'Classification',
    derivationHelp:
    'Calculated from the recipe. Every element expands to show the component, its concentration and the threshold that was crossed.',
    quantityNoun: 'Net quantity',
    recordNoun: 'Batch',
    lotNoun: 'Fragrance oil lot'
  }
},
{
  id: 'cosmetics',
  name: 'Cosmetics',
  short: 'Cosmetics',
  blurb: 'Face oils, balms and body creams, formulated by phase.',
  specKind: 'phased',
  productTypes: ['Face oil', 'Balm', 'Body cream'],
  regimes: ['cpr', 'gpsr'],
  artefacts: ['unit-label', 'carton', 'listing'],
  recordIdentity: 'batch',
  surface: 'warm',
  strings: {
    specTitle: 'Formula',
    specHelp:
    'Build the formula by phase. Percentages must total 100. The ingredient list and the allergen declaration derive from what you enter.',
    derivationTitle: 'Label derivation',
    derivationHelp:
    'Derived from the formula. Every element expands to show the ingredient, its percentage and the rule that placed it there.',
    quantityNoun: 'Nominal content',
    recordNoun: 'Batch',
    lotNoun: 'Ingredient lot'
  }
},
{
  id: 'electronics',
  name: 'Electronics',
  short: 'Devices',
  blurb: 'Mains and USB powered devices, evidenced by a conformity file.',
  specKind: 'bom',
  productTypes: ['Wax warmer', 'Diffuser, ultrasonic', 'Lamp'],
  regimes: ['ce', 'rohs', 'weee', 'gpsr'],
  artefacts: ['rating-plate', 'carton', 'leaflet', 'listing'],
  recordIdentity: 'serial-range',
  surface: 'neutral',
  strings: {
    specTitle: 'Bill of materials',
    specHelp:
    'A device has no formulation. The specification is its bill of materials, and the evidence is a conformity file rather than a calculation.',
    derivationTitle: 'Conformity file',
    derivationHelp:
    'Assembled from component declarations and test reports. Every item expands to show the document, its date and what it covers.',
    quantityNoun: 'Unit weight',
    recordNoun: 'Production run',
    lotNoun: 'Component lot'
  }
}];


export function categoryById(id: CategoryId): CategoryPack {
  return CATEGORIES.find((c) => c.id === id) ?? CATEGORIES[0];
}

export const ARTEFACT_LABELS: Record<ArtefactType, string> = {
  'unit-label': 'Unit label',
  carton: 'Carton',
  leaflet: 'Leaflet',
  listing: 'Online listing',
  'rating-plate': 'Rating plate',
  sds: 'Safety data sheet'
};

/** The label surfaces, as distinct from the safety data sheet. */
export function isLabelSurface(type: ArtefactType): boolean {
  return type !== 'sds';
}

/* -------------------------------------------------------------- products */

const BASE_PRODUCTS: Product[] = [
{
  id: 'p-black-fig',
  name: 'Black Fig and Cassis',
  sku: 'CC-BFC-220',
  categoryId: 'home-fragrance',
  markets: ['GB', 'EU'],
  regimes: ['clp', 'en15494', 'gpsr'],
  identifiers: { ufi: 'H8YP-K02M-J00X-7RTQ' },
  spec: {
    kind: 'mixture',
    productType: 'Container candle',
    baseId: 'ing-crw45',
    fragranceId: 'ing-black-fig',
    load: 8,
    dyeId: 'ing-no-dye',
    additive: 'None',
    netQuantity: 220,
    netUnit: 'g',
    packagingId: 'pkg-tumbler-250'
  },
  artefacts: [
  {
    type: 'unit-label',
    label: 'Unit label',
    widthMm: 52,
    heightMm: 74,
    version: 'v4',
    printedOn: '2026-05-12',
    current: false,
    driftNote:
    'Fragrance load raised from 7 percent to 8 percent on 22 July. Label v4 was printed at 7 percent.'
  },
  {
    type: 'listing',
    label: 'Online listing',
    widthMm: 96,
    heightMm: 60,
    version: 'v2',
    printedOn: '2026-05-12',
    current: false,
    driftNote: 'The listing still shows the classification calculated at 7 percent.'
  }],

  obligations: {
    'clp-classification': true,
    'clp-artefact-current': false,
    'clp-ufi': true,
    'clp-pcn-eu': false,
    'clp-pcn-gb': true,
    'en15494-safety-text': true,
    'gpsr-traceability': true,
    'gpsr-eu-responsible-person': false,
    'gpsr-online-disclosure': false
  }
},
{
  id: 'p-smoked-vetiver',
  name: 'Smoked Vetiver',
  sku: 'RD-SMV-100',
  categoryId: 'home-fragrance',
  markets: ['GB'],
  regimes: ['clp', 'gpsr'],
  identifiers: { ufi: 'V210-N0K4-T00A-2FQD' },
  spec: {
    kind: 'mixture',
    productType: 'Reed diffuser',
    baseId: 'ing-dpg',
    fragranceId: 'ing-smoked-vetiver',
    load: 22,
    dyeId: 'ing-no-dye',
    additive: 'None',
    netQuantity: 100,
    netUnit: 'ml',
    packagingId: 'pkg-diffuser-100'
  },
  artefacts: [
  {
    type: 'unit-label',
    label: 'Unit label',
    widthMm: 52,
    heightMm: 74,
    version: 'v2',
    printedOn: '2026-06-30',
    current: true
  },
  {
    type: 'listing',
    label: 'Online listing',
    widthMm: 96,
    heightMm: 60,
    version: 'v2',
    printedOn: '2026-06-30',
    current: true
  }],

  obligations: {
    'clp-classification': true,
    'clp-artefact-current': true,
    'clp-ufi': true,
    'clp-pcn-gb': true,
    'gpsr-traceability': true,
    'gpsr-online-disclosure': true
  }
},
{
  id: 'p-bergamot-sea-salt',
  name: 'Bergamot and Sea Salt',
  sku: 'RS-BSS-100',
  categoryId: 'home-fragrance',
  markets: ['GB', 'EU'],
  regimes: ['clp', 'gpsr'],
  identifiers: { ufi: 'JG00-R0FT-800P-M14V' },
  spec: {
    kind: 'mixture',
    productType: 'Room spray',
    baseId: 'ing-alcohol',
    fragranceId: 'ing-bergamot-sea-salt',
    load: 12,
    dyeId: 'ing-no-dye',
    additive: 'Solubiliser, 1 percent',
    netQuantity: 100,
    netUnit: 'ml',
    packagingId: 'pkg-spray-100'
  },
  artefacts: [
  {
    type: 'unit-label',
    label: 'Unit label',
    widthMm: 52,
    heightMm: 74,
    version: 'v3',
    printedOn: '2026-07-02',
    current: true
  },
  {
    type: 'listing',
    label: 'Online listing',
    widthMm: 96,
    heightMm: 60,
    version: 'v1',
    printedOn: '2026-07-02',
    current: true
  }],

  obligations: {
    'clp-classification': true,
    'clp-artefact-current': true,
    'clp-ufi': true,
    'clp-pcn-eu': true,
    'clp-pcn-gb': true,
    'gpsr-traceability': true,
    'gpsr-eu-responsible-person': true,
    'gpsr-online-disclosure': false
  }
},
{
  id: 'p-wild-damson',
  name: 'Wild Damson and Bay',
  sku: 'WM-WDB-070',
  categoryId: 'home-fragrance',
  markets: ['GB'],
  regimes: ['clp', 'en15494', 'gpsr'],
  identifiers: {},
  spec: {
    kind: 'mixture',
    productType: 'Wax melt',
    baseId: 'ing-soy-c3',
    fragranceId: 'ing-wild-damson',
    load: 6.5,
    dyeId: 'ing-dye-terracotta',
    additive: 'None',
    netQuantity: 70,
    netUnit: 'g',
    packagingId: 'pkg-clamshell'
  },
  artefacts: [
  {
    type: 'unit-label',
    label: 'Unit label',
    widthMm: 52,
    heightMm: 74,
    version: 'v1',
    printedOn: '2026-04-18',
    current: true
  },
  {
    type: 'listing',
    label: 'Online listing',
    widthMm: 96,
    heightMm: 60,
    version: 'v1',
    printedOn: '2026-04-18',
    current: true
  }],

  obligations: {
    'clp-classification': true,
    'clp-artefact-current': true,
    'clp-ufi': false,
    'clp-pcn-gb': false,
    'en15494-safety-text': true,
    'gpsr-traceability': true,
    'gpsr-online-disclosure': true
  }
},
{
  id: 'p-rosehip-face-oil',
  name: 'Rosehip and Meadowfoam Face Oil',
  sku: 'CO-RMF-030',
  categoryId: 'cosmetics',
  markets: ['GB', 'EU'],
  regimes: ['cpr', 'gpsr'],
  identifiers: {},
  spec: {
    kind: 'phased',
    productType: 'Face oil',
    application: 'Leave-on',
    paoMonths: 12,
    netQuantity: 30,
    netUnit: 'ml',
    packagingId: 'pkg-dropper-30',
    phases: [
    {
      name: 'Oil phase',
      items: [
      { materialId: 'ing-rosehip', pct: 45 },
      { materialId: 'ing-meadowfoam', pct: 34.6 },
      { materialId: 'ing-jojoba', pct: 18.4 }]

    },
    {
      name: 'Cool down',
      items: [
      { materialId: 'ing-tocopherol', pct: 1.2 },
      { materialId: 'ing-black-fig', pct: 0.8 }]

    }]

  },
  artefacts: [
  {
    type: 'unit-label',
    label: 'Unit label',
    widthMm: 44,
    heightMm: 62,
    version: 'v2',
    printedOn: '2026-07-06',
    current: true
  },
  {
    type: 'carton',
    label: 'Carton',
    widthMm: 88,
    heightMm: 58,
    version: 'v1',
    printedOn: '2026-06-14',
    current: false,
    driftNote:
    'Jojoba raised from 17.9 percent to 18.4 percent on 12 July, which changed the ingredient order. Carton v1 was printed before that change.'
  },
  {
    type: 'listing',
    label: 'Online listing',
    widthMm: 96,
    heightMm: 60,
    version: 'v2',
    printedOn: '2026-07-06',
    current: true
  }],

  obligations: {
    'cpr-pif': true,
    'cpr-safety-assessment': true,
    'cpr-cpnp': false,
    'cpr-responsible-person': true,
    'cpr-pao': true,
    'cpr-claims': false,
    'cpr-gmp': true,
    'gpsr-traceability': true,
    'gpsr-eu-responsible-person': true,
    'gpsr-online-disclosure': true
  }
},
{
  id: 'p-warmer',
  name: 'Aurelia Warmer WW-100',
  sku: 'EL-WW-100',
  categoryId: 'electronics',
  markets: ['GB', 'EU'],
  regimes: ['ce', 'rohs', 'weee', 'gpsr'],
  identifiers: {
    model: 'WW-100',
    modelYear: '2026',
    weeeRegistration: 'WEE/AB1234CD'
  },
  spec: {
    kind: 'bom',
    productType: 'Wax warmer',
    model: 'WW-100',
    ratings: { voltage: '5 V DC', current: '2 A', power: '10 W' },
    netQuantity: 420,
    netUnit: 'g',
    packagingId: 'pkg-device-box',
    items: [
    { materialId: 'cmp-power-board', quantity: 1, position: 'Base assembly' },
    { materialId: 'cmp-heater', quantity: 1, position: 'Heat plate' },
    { materialId: 'cmp-cable', quantity: 1, position: 'Supply lead' },
    { materialId: 'cmp-housing', quantity: 1, position: 'Enclosure' },
    { materialId: 'cmp-led', quantity: 1, position: 'Indicator' }]

  },
  artefacts: [
  {
    type: 'rating-plate',
    label: 'Rating plate',
    widthMm: 40,
    heightMm: 25,
    version: 'v1',
    printedOn: '2026-06-08',
    current: true
  },
  {
    type: 'carton',
    label: 'Carton',
    widthMm: 100,
    heightMm: 70,
    version: 'v1',
    printedOn: '2026-06-08',
    current: true
  },
  {
    type: 'leaflet',
    label: 'Leaflet',
    widthMm: 105,
    heightMm: 148,
    version: 'v1',
    printedOn: '2026-06-08',
    current: true
  },
  {
    type: 'listing',
    label: 'Online listing',
    widthMm: 96,
    heightMm: 60,
    version: 'v1',
    printedOn: '2026-06-08',
    current: true
  }],

  obligations: {
    'ce-doc-signed': false,
    'ce-standards': true,
    'ce-test-reports': false,
    'rohs-component-declarations': false,
    'rohs-en63000': true,
    'weee-registration': true,
    'weee-marking': true,
    'gpsr-traceability': true,
    'gpsr-eu-responsible-person': true,
    'gpsr-online-disclosure': false
  }
}];


/**
 * The safety data sheet is the second output of the same derivation, so every
 * product that is a mixture carries one alongside its label surfaces. A device
 * is an article rather than a mixture and has no sheet to issue.
 */
function withSafetyDataSheet(product: Product): Product {
  if (product.spec.kind === 'bom') return product;
  if (product.artefacts.some((artefact) => artefact.type === 'sds')) return product;
  const staleLabel = product.artefacts.find((artefact) => !artefact.current);
  return {
    ...product,
    artefacts: [
    ...product.artefacts,
    {
      type: 'sds',
      label: 'Safety data sheet',
      widthMm: 210,
      heightMm: 297,
      version: staleLabel ? 'v3' : 'v2',
      printedOn: staleLabel ? '2026-05-12' : '2026-06-30',
      current: !staleLabel,
      driftNote: staleLabel ? staleLabel.driftNote : undefined
    }]

  };
}

export const PRODUCTS: Product[] = BASE_PRODUCTS.map(withSafetyDataSheet);

/* ------------------------------------------------- the live product list */

/**
 * Products can be created at runtime, so screens read the live list rather
 * than the seed constant. A product is the one thing a user creates; outputs
 * are always derived and can never be made by hand.
 */
let runtime: Product[] = PRODUCTS;
const listeners = new Set<() => void>();

export function allProducts(): Product[] {
  return runtime;
}

export function subscribeProducts(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function productById(id: string): Product | undefined {
  return runtime.find((p) => p.id === id);
}

export type NewProductInput = {
  name: string;
  sku: string;
  categoryId: CategoryId;
  productType: string;
  /** Optional starting material, when the product was begun from a sheet. */
  fragranceId?: string;
};

function blankSpec(category: CategoryPack, productType: string, fragranceId?: string): Spec {
  if (category.specKind === 'mixture') {
    return {
      kind: 'mixture',
      productType,
      baseId: productType === 'Reed diffuser' ? 'ing-dpg' : productType === 'Room spray' ? 'ing-alcohol' : 'ing-crw45',
      fragranceId: fragranceId ?? '',
      load: 0,
      dyeId: 'ing-no-dye',
      additive: 'None',
      netQuantity: 100,
      netUnit: productType === 'Container candle' || productType === 'Wax melt' ? 'g' : 'ml',
      packagingId:
      productType === 'Reed diffuser' ?
      'pkg-diffuser-100' :
      productType === 'Room spray' ?
      'pkg-spray-100' :
      productType === 'Wax melt' ?
      'pkg-clamshell' :
      'pkg-tumbler-250'
    };
  }
  if (category.specKind === 'phased') {
    return {
      kind: 'phased',
      productType,
      phases: [
      { name: 'Oil phase', items: [] },
      { name: 'Cool down', items: [] }],

      application: 'Leave-on',
      paoMonths: 12,
      netQuantity: 30,
      netUnit: 'ml',
      packagingId: 'pkg-dropper-30'
    };
  }
  return {
    kind: 'bom',
    productType,
    model: 'Not yet assigned',
    items: [],
    ratings: { voltage: '5 V', current: '2 A', power: '10 W' },
    netQuantity: 400,
    netUnit: 'g',
    packagingId: 'pkg-device-box'
  };
}

/** Creates a product at the very start of its pipeline and returns it. */
export function createProduct(input: NewProductInput): Product {
  const category = categoryById(input.categoryId);
  const id = `p-${input.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}-${runtime.length}`;

  const product: Product = {
    id,
    name: input.name,
    sku: input.sku,
    categoryId: input.categoryId,
    markets: ['GB'],
    regimes: category.regimes,
    identifiers: {},
    spec: blankSpec(category, input.productType, input.fragranceId),
    artefacts: category.artefacts.map((type) => ({
      type,
      label: ARTEFACT_LABELS[type],
      widthMm: type === 'listing' ? 96 : type === 'carton' ? 88 : type === 'rating-plate' ? 40 : 52,
      heightMm: type === 'listing' ? 60 : type === 'carton' ? 58 : type === 'rating-plate' ? 25 : 74,
      version: 'Not yet produced',
      printedOn: '—',
      current: true
    })),
    obligations: {}
  };

  const withSheet = withSafetyDataSheet(product);
  runtime = [...runtime, withSheet];
  listeners.forEach((listener) => listener());
  return withSheet;
}

/* ----------------------------------------------------------------- drift */

/**
 * One canonical statement per drift event: what changed, which outputs it
 * moved, and what they now say. Every screen reuses this verbatim, so no two
 * places paraphrase the same fact.
 */
export type Drift = {
  changed: string;
  moved: string;
  nowSays: string;
  sentence: string;
};

const DRIFT: Record<string, Omit<Drift, 'sentence'>> = {
  'p-black-fig': {
    changed: 'The fragrance load was raised from 7 percent to 8 percent on 22 July.',
    moved: 'The unit label, the online listing and the safety data sheet were all printed at 7 percent.',
    nowSays:
    'At 8 percent the mixture crosses the supplier specific limit of 0.4 percent for skin sensitisation, so H317 is now required.'
  },
  'p-rosehip-face-oil': {
    changed:
    'Meadowfoam seed oil was raised from 11.2 percent to 12.4 percent on 19 July, moving it above rosehip oil.',
    moved: 'The carton and the safety data sheet were both assembled from the previous order.',
    nowSays:
    'Meadowfoam now precedes rosehip in the ingredient list, and section 3 of the sheet reorders with it.'
  }
};

export function driftFor(product: Product): Drift | null {
  const entry = DRIFT[product.id];
  if (!entry) return null;
  return { ...entry, sentence: `${entry.changed} ${entry.moved} ${entry.nowSays}` };
}

/* --------------------------------------------------------------- records */

export const RECORDS: ProductionRecord[] = [
{
  code: 'BFC-2607-014',
  productId: 'p-black-fig',
  date: '2026-07-26',
  units: 48,
  identity: { kind: 'batch', code: 'BFC-2607-014' },
  lots: [
  { materialId: 'ing-black-fig', lot: 'AUR-24118-B' },
  { materialId: 'ing-crw45', lot: 'KER-CRW-2609' }],

  specVersion: 'r7',
  artefactVersions: [
  { type: 'unit-label', version: 'v4' },
  { type: 'listing', version: 'v2' }],

  madeBy: 'Nadia',
  notes: 'Cure 14 days before dispatch.'
},
{
  code: 'BSS-2407-009',
  productId: 'p-bergamot-sea-salt',
  date: '2026-07-24',
  units: 60,
  identity: { kind: 'batch', code: 'BSS-2407-009' },
  lots: [
  { materialId: 'ing-bergamot-sea-salt', lot: 'CWP-8802-17' },
  { materialId: 'ing-alcohol', lot: 'MER-PA96-114' }],

  specVersion: 'r3',
  artefactVersions: [
  { type: 'unit-label', version: 'v3' },
  { type: 'listing', version: 'v1' }],

  madeBy: 'Nadia'
},
{
  code: 'SMV-2107-021',
  productId: 'p-smoked-vetiver',
  date: '2026-07-21',
  units: 36,
  identity: { kind: 'batch', code: 'SMV-2107-021' },
  lots: [
  { materialId: 'ing-smoked-vetiver', lot: 'HAL-2210-04' },
  { materialId: 'ing-dpg', lot: 'HAL-DPG-771' }],

  specVersion: 'r2',
  artefactVersions: [
  { type: 'unit-label', version: 'v2' },
  { type: 'listing', version: 'v2' }],

  madeBy: 'Tom'
},
{
  code: 'WW100-2007-002',
  productId: 'p-warmer',
  date: '2026-07-20',
  units: 400,
  identity: { kind: 'serial-range', code: 'WW100-26', from: 'WW100-26-0001', to: 'WW100-26-0400' },
  lots: [
  { materialId: 'cmp-power-board', lot: 'LE-PB52-2622' },
  { materialId: 'cmp-heater', lot: 'LE-PTC10-2618' },
  { materialId: 'cmp-cable', lot: 'HC-SC12-2611' },
  { materialId: 'cmp-housing', lot: 'WM-CH20-2609' }],

  specVersion: 'b2',
  artefactVersions: [
  { type: 'rating-plate', version: 'v1' },
  { type: 'carton', version: 'v1' },
  { type: 'leaflet', version: 'v1' }],

  madeBy: 'Tom',
  notes: 'Assembled and flash tested in house, 400 units, no failures.'
},
{
  code: 'RMF-2907-004',
  productId: 'p-rosehip-face-oil',
  date: '2026-07-29',
  units: 90,
  identity: { kind: 'batch', code: 'RMF-2907-004' },
  lots: [
  { materialId: 'ing-rosehip', lot: 'VER-RH01-2607' },
  { materialId: 'ing-meadowfoam', lot: 'VER-MF02-2605' },
  { materialId: 'ing-jojoba', lot: 'VER-JJ04-2603' },
  { materialId: 'ing-black-fig', lot: 'AUR-24118-B' }],

  specVersion: 'f4',
  artefactVersions: [
  { type: 'unit-label', version: 'v2' },
  { type: 'carton', version: 'v1' },
  { type: 'listing', version: 'v2' }],

  madeBy: 'Priya',
  notes: 'Filled under nitrogen. Held 48 hours before labelling.'
},
{
  code: 'WDB-1807-006',
  productId: 'p-wild-damson',
  date: '2026-07-18',
  units: 120,
  identity: { kind: 'batch', code: 'WDB-1807-006' },
  lots: [
  { materialId: 'ing-wild-damson', lot: 'NJF-1330-09' },
  { materialId: 'ing-soy-c3', lot: 'ECO-C3-2604' }],

  specVersion: 'r1',
  artefactVersions: [
  { type: 'unit-label', version: 'v1' },
  { type: 'listing', version: 'v1' }],

  madeBy: 'Tom'
},
{
  code: 'BFC-1407-013',
  productId: 'p-black-fig',
  date: '2026-07-14',
  units: 42,
  identity: { kind: 'batch', code: 'BFC-1407-013' },
  lots: [
  { materialId: 'ing-black-fig', lot: 'AUR-24118-B' },
  { materialId: 'ing-crw45', lot: 'KER-CRW-2609' }],

  specVersion: 'r6',
  artefactVersions: [
  { type: 'unit-label', version: 'v4' },
  { type: 'listing', version: 'v2' }],

  madeBy: 'Nadia'
},
{
  code: 'BSS-0907-008',
  productId: 'p-bergamot-sea-salt',
  date: '2026-07-09',
  units: 54,
  identity: { kind: 'batch', code: 'BSS-0907-008' },
  lots: [
  { materialId: 'ing-bergamot-sea-salt', lot: 'CWP-8802-16' },
  { materialId: 'ing-alcohol', lot: 'MER-PA96-112' }],

  specVersion: 'r3',
  artefactVersions: [
  { type: 'unit-label', version: 'v3' },
  { type: 'listing', version: 'v1' }],

  madeBy: 'Nadia'
},
{
  code: 'WW100-0207-001',
  productId: 'p-warmer',
  date: '2026-07-02',
  units: 150,
  identity: { kind: 'serial-range', code: 'WW100-26', from: 'WW100-26-0401', to: 'WW100-26-0550' },
  lots: [
  { materialId: 'cmp-power-board', lot: 'LE-PB52-2618' },
  { materialId: 'cmp-heater', lot: 'LE-PTC10-2612' },
  { materialId: 'cmp-cable', lot: 'HC-SC12-2606' },
  { materialId: 'cmp-housing', lot: 'WM-CH20-2604' }],

  specVersion: 'b1',
  artefactVersions: [
  { type: 'rating-plate', version: 'v1' },
  { type: 'carton', version: 'v1' },
  { type: 'leaflet', version: 'v1' }],

  madeBy: 'Tom'
},
{
  code: 'SMV-0207-020',
  productId: 'p-smoked-vetiver',
  date: '2026-07-02',
  units: 30,
  identity: { kind: 'batch', code: 'SMV-0207-020' },
  lots: [
  { materialId: 'ing-smoked-vetiver', lot: 'HAL-2210-03' },
  { materialId: 'ing-dpg', lot: 'HAL-DPG-768' }],

  specVersion: 'r2',
  artefactVersions: [
  { type: 'unit-label', version: 'v2' },
  { type: 'listing', version: 'v2' }],

  madeBy: 'Tom'
}];


export function recordByCode(code: string): ProductionRecord | undefined {
  return RECORDS.find((r) => r.code === code);
}

/* ------------------------------------------------------------- attention */

export const ATTENTION: Attention[] = [
{
  id: 'att-1',
  productId: 'p-black-fig',
  categoryId: 'home-fragrance',
  regimeId: 'clp',
  severity: 'blocking',
  label: 'Classification changed since last print',
  detail:
  'Fragrance load raised to 8 percent on 22 July. Label v4 was printed at 7 percent and no longer matches the specification.',
  to: '/products/p-black-fig'
},
{
  id: 'att-2',
  productId: 'p-warmer',
  materialId: 'cmp-cable',
  categoryId: 'electronics',
  regimeId: 'rohs',
  severity: 'blocking',
  label: 'Component without a declaration',
  detail:
  'Silicone USB-C cable, 1.2 m has no declaration of conformity on file. The declaration for WW-100 cannot be signed until it is.',
  to: '/materials/component/cmp-cable'
},
{
  id: 'att-3',
  productId: 'p-warmer',
  materialId: 'cmp-heater',
  categoryId: 'electronics',
  regimeId: 'ce',
  severity: 'review',
  label: 'Test report expires in 62 days',
  detail:
  'The PTC heating element report from Linfield Electronics expires on 30 September 2026. Book a retest or request a current report.',
  to: '/materials/component/cmp-heater'
},
{
  id: 'att-4',
  productId: 'p-rosehip-face-oil',
  categoryId: 'cosmetics',
  regimeId: 'cpr',
  severity: 'blocking',
  label: 'Ingredient order changed since the carton was printed',
  detail:
  'Jojoba raised to 18.4 percent on 12 July. The INCI order on carton v1 no longer matches the formula.',
  to: '/products/p-rosehip-face-oil'
},
{
  id: 'att-5',
  materialId: 'ing-black-fig',
  productId: 'p-black-fig',
  categoryId: 'home-fragrance',
  regimeId: 'clp',
  severity: 'review',
  label: 'Revised safety data sheet',
  detail:
  'Aurelia Fragrances published version 4.3 of the Black Fig and Cassis data sheet on 2 June. Version 4.2 is on file.',
  to: '/materials/ingredient/ing-black-fig'
},
{
  id: 'att-6',
  materialId: 'ing-jojoba',
  productId: 'p-rosehip-face-oil',
  categoryId: 'cosmetics',
  regimeId: 'cpr',
  severity: 'review',
  label: 'Revised INCI certificate',
  detail:
  'Verdant Botanicals published version 1.2 of the jojoba certificate on 22 June. Version 1.1 is on file.',
  to: '/materials/ingredient/ing-jojoba'
}];


/* ------------------------------------------------------------- workspace */

export const BUSINESS = {
  name: 'Hearth and Hollow Ltd',
  tradingName: 'Hearth & Hollow',
  phone: '+44 1273 555 018',
  email: 'hello@hearthandhollow.co.uk',
  website: 'hearthandhollow.co.uk'
};

/**
 * The sheet is issued as a draft pending competent review, so the account has
 * to record who that reviewer is. This is the one billing-adjacent field that
 * is load-bearing for the product's promise.
 */
export const COMPETENT_PERSON = {
  kind: 'external' as 'internal' | 'external',
  name: 'Dr Ruth Kelder',
  organisation: 'Kelder Compliance BV',
  email: 'r.kelder@keldercompliance.nl',
  reviewed: 4,
  awaiting: 2
};

/* --------------------------------------------------------------- billing */

export type Plan = {
  id: string;
  name: string;
  productLimit: number;
  monthly: number;
  blurb: string;
};

export const PLANS: Plan[] = [
{
  id: 'maker',
  name: 'Maker',
  productLimit: 3,
  monthly: 24,
  blurb: 'For a single range. Unlimited documents read.'
},
{
  id: 'studio',
  name: 'Studio',
  productLimit: 10,
  monthly: 58,
  blurb: 'For a growing range across more than one category. Unlimited documents read.'
},
{
  id: 'house',
  name: 'House',
  productLimit: 40,
  monthly: 140,
  blurb: 'For established makers with several lines and a review workflow.'
}];


export const BILLING = {
  planId: 'studio',
  renews: '2026-08-14',
  card: { brand: 'Visa', last4: '4417', expires: '09/29' },
  billingEmail: 'accounts@hearthandhollow.co.uk',
  vatNumber: 'GB 418 2296 05'
};

export type Invoice = {
  id: string;
  number: string;
  date: string;
  amount: number;
  status: 'Paid' | 'Due';
};

export const INVOICES: Invoice[] = [
{ id: 'inv-6', number: 'HH-0026', date: '2026-07-14', amount: 58, status: 'Paid' },
{ id: 'inv-5', number: 'HH-0025', date: '2026-06-14', amount: 58, status: 'Paid' },
{ id: 'inv-4', number: 'HH-0024', date: '2026-05-14', amount: 58, status: 'Paid' },
{ id: 'inv-3', number: 'HH-0023', date: '2026-04-14', amount: 24, status: 'Paid' },
{ id: 'inv-2', number: 'HH-0022', date: '2026-03-14', amount: 24, status: 'Paid' }];


export function planById(id: string): Plan {
  return PLANS.find((plan) => plan.id === id) ?? PLANS[0];
}

export const ADDRESSES: SupplierAddress[] = [
{
  id: 'addr-gb',
  market: 'GB',
  label: 'Great Britain',
  role: 'Supplier and manufacturer',
  lines: ['Hearth and Hollow Ltd', 'Unit 4, Bellhurst Yard', 'Lewes BN7 2QA', 'United Kingdom'],
  isDefault: true
},
{
  id: 'addr-eu',
  market: 'EU',
  label: 'European Union and Northern Ireland',
  role: 'Responsible person and economic operator',
  lines: [
  'Kelder Compliance BV',
  'Responsible person for Hearth and Hollow Ltd',
  'Havenstraat 12, 3016 CN Rotterdam',
  'Netherlands']

}];


export function addressForMarket(market: 'GB' | 'EU'): SupplierAddress {
  return ADDRESSES.find((a) => a.market === market) ?? ADDRESSES[0];
}

export const STOCK: ArtefactStock[] = [
{ id: 'ls-1', name: 'Base label 52 × 74', artefactType: 'unit-label', widthMm: 52, heightMm: 74, perSheet: 10, sheet: 'A4' },
{ id: 'ls-2', name: 'Avery L7169, 99.1 × 67.7', artefactType: 'unit-label', widthMm: 99.1, heightMm: 67.7, perSheet: 8, sheet: 'A4' },
{ id: 'ls-3', name: 'Dropper bottle wrap 44 × 62', artefactType: 'unit-label', widthMm: 44, heightMm: 62, perSheet: 12, sheet: 'A4' },
{ id: 'ls-4', name: 'Carton panel 88 × 58', artefactType: 'carton', widthMm: 88, heightMm: 58, perSheet: 8, sheet: 'A4' },
{ id: 'ls-5', name: 'Device carton panel 100 × 70', artefactType: 'carton', widthMm: 100, heightMm: 70, perSheet: 6, sheet: 'A4' },
{ id: 'ls-6', name: 'Rating plate 40 × 25', artefactType: 'rating-plate', widthMm: 40, heightMm: 25, perSheet: 24, sheet: 'A4' },
{ id: 'ls-7', name: 'Leaflet A6, 105 × 148', artefactType: 'leaflet', widthMm: 105, heightMm: 148, perSheet: 4, sheet: 'A4' },
{ id: 'ls-8', name: 'Listing block 96 × 60', artefactType: 'listing', widthMm: 96, heightMm: 60, perSheet: 1, sheet: 'Screen' }];


export const TEAM: TeamMember[] = [
{ name: 'Nadia Osei', email: 'nadia@hearthandhollow.co.uk', role: 'Owner', lastActive: 'Today' },
{ name: 'Tom Rivers', email: 'tom@hearthandhollow.co.uk', role: 'Maker', lastActive: 'Yesterday' },
{ name: 'Priya Shah', email: 'priya@kelder-compliance.eu', role: 'Read only', lastActive: '12 July' }];


export const CONFORMITY_DOCUMENTS: ConformityDocument[] = [
{
  id: 'doc-1',
  title: 'Declaration of conformity, WW-100',
  reference: 'HH-DOC-WW100-01',
  issued: '2026-06-08',
  owner: 'Draft, unsigned',
  productId: 'p-warmer'
},
{
  id: 'doc-2',
  title: 'EN IEC 63000 technical compilation, WW-100',
  reference: 'HH-TF-WW100-RoHS',
  issued: '2026-06-08',
  owner: 'Nadia Osei',
  productId: 'p-warmer'
},
{
  id: 'doc-3',
  title: 'Cosmetic product safety report, Rosehip and Meadowfoam Face Oil',
  reference: 'CPSR-RMF-2026',
  issued: '2026-05-30',
  owner: 'Dr Elin Marsh, chartered chemist',
  productId: 'p-rosehip-face-oil'
},
{
  id: 'doc-4',
  title: 'Product information file, Rosehip and Meadowfoam Face Oil',
  reference: 'PIF-RMF-2026',
  issued: '2026-06-02',
  owner: 'Kelder Compliance BV',
  productId: 'p-rosehip-face-oil'
},
{
  id: 'doc-5',
  title: 'WEEE producer registration',
  reference: 'WEE/AB1234CD',
  issued: '2026-01-05',
  expires: '2027-01-04',
  owner: 'Hearth and Hollow Ltd'
}];