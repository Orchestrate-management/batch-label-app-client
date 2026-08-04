import {
  Attention,
  ConformityDocument,
  DocumentRevision,
  IngredientMaterial,
  InboxDocument,
  Material,
  PackagingMaterial,
  Product,
  ProductionRecord,
  TeamMember } from
'./model';

/**
 * DEMO DATA. NOTHING IN THE APP MAY IMPORT THIS FILE.
 *
 * =============================================================================
 * This is the six-product workspace of Hearth and Hollow Ltd, a business that does not
 * exist. It used to live in src/lib/products.ts, where a module-level `let runtime: Product[]
 * = PRODUCTS` seeded it into the running app. Every signed-in customer — every one, on their
 * very first visit — opened Batchlabel and found four candles, a face oil and a wax warmer
 * already in it, along with ten production runs they had never made and two "your label is
 * out of date" warnings about a fragrance load somebody else had changed in July.
 *
 * The founder's sentence is the whole reason this file exists as a separate module: "when a
 * user signs in for the first time, they are in a virgin account with no products". A new
 * account now starts empty because there is no code path from this file into a rendered
 * screen, which is a stronger guarantee than a rule anybody has to remember.
 *
 * WHAT MAY IMPORT IT: test files (`*.test.ts`, `*.test.tsx`) and nothing else. That is
 * asserted, not asked for — see fixtures.guard.test.ts, which reads every module under src/
 * and fails if a non-test file imports this one. If you are here because that test failed,
 * the answer is almost never to add an exemption: whatever you were about to render from
 * here is customer data, and it belongs in Supabase.
 *
 * WHY IT IS KEPT AT ALL. These products are the only non-trivial specifications in the
 * repository — a phased cosmetic formula, a bill of materials with an undeclared component,
 * a mixture that crosses a supplier specific concentration limit — and the derivation,
 * regime and safety data sheet tests need something with real shape to derive from. Deleting
 * them would cost real coverage; keeping them anywhere reachable would cost a customer's
 * trust on their first screen.
 * =============================================================================
 */

/* -------------------------------------------------------------- products */

/**
 * No product carries a UFI, and none marks `clp-ufi` or a poison centre
 * notification as done. Batchlabel generates no UFI, and a notification dossier
 * is keyed on one, so seeding either would be the app asserting compliance work
 * that neither it nor the maker has any way of doing here. `obligationSatisfied`
 * enforces the UFI half whatever this file says; the rest is kept honest here.
 */
const BASE_PRODUCTS: Product[] = [
{
  id: 'p-black-fig',
  name: 'Black Fig and Cassis',
  sku: 'CC-BFC-220',
  categoryId: 'home-fragrance',
  markets: ['GB', 'EU'],
  regimes: ['clp', 'en15494', 'gpsr'],
  identifiers: {},
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
    'clp-ufi': false,
    'clp-pcn-eu': false,
    'clp-pcn-gb': false,
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
  identifiers: {},
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
    'clp-ufi': false,
    'clp-pcn-gb': false,
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
  identifiers: {},
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
    'clp-ufi': false,
    'clp-pcn-eu': false,
    'clp-pcn-gb': false,
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


/* ----------------------------------------------------------------- drift */

/**
 * One canonical statement per drift event: what changed, which outputs it
 * moved, and what they now say.
 *
 * Drift is a fixture in its entirety. It is a difference between a saved artefact version
 * and the current composition, and artefacts are not stored anywhere — the schema says so
 * outright ("ARTEFACTS AND RECORDS ARE NOT HERE"). So a real account has no drift to report,
 * and the app no longer has a `driftFor`: showing "your label was printed at 7 percent" to
 * somebody who has never printed a label is not a smaller version of the feature, it is a
 * false statement about their compliance.
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


/* ------------------------------------------------------------------ documents
 *
 * A supplier inbox and a document revision history, both invented.
 *
 * These lived in catalog.ts, which ships, and the guard below did not cover them because it
 * only watches imports of THIS file. That is how they survived a clean-account pass:
 * Materials opened on "3 documents received, none read yet", naming real suppliers and real
 * dates, for an account that had received nothing.
 *
 * The worse half was pipeline.ts, which matched an inbox entry against the maker's OWN
 * specification and then told them, under their own product name, that a newer sheet was
 * waiting and their allergen table had changed. An invented statement that a live
 * classification may be wrong is the most damaging sentence this product can produce, and it
 * was coming from a constant.
 *
 * Kept because the pipeline and materials tests need documents with real shape. Reachable
 * only from a test file, which the guard enforces.
 */

/**
 * Documents dropped in but not yet reconciled against a material. This is the
 * front door of the product: nothing can be classified until a sheet is read.
 */
export const INBOX: InboxDocument[] = [
{
  id: 'inb-1',
  fileName: 'Aurelia_BlackFigCassis_SDS_v4.2_EN.pdf',
  receivedOn: '2026-07-28',
  appearsToBe: 'Safety data sheet',
  supplier: 'Aurelia Fragrances',
  matchedMaterialId: 'ing-black-fig',
  matchConfidence: 'high',
  note: 'Newer than the version on file. Section 3 and the allergen table both changed.'
},
{
  id: 'inb-2',
  fileName: 'scan_20260727_114302.pdf',
  receivedOn: '2026-07-27',
  appearsToBe: 'Safety data sheet',
  supplier: 'Unidentified',
  matchConfidence: 'none',
  note: 'A photograph of a printed sheet. The supplier name and product identifier could not be read.'
},
{
  id: 'inb-3',
  fileName: 'Kestrel-silicone-cable-RoHS.pdf',
  receivedOn: '2026-07-24',
  appearsToBe: 'Declaration of conformity',
  supplier: 'Kestrel Components',
  matchedMaterialId: 'cmp-cable',
  matchConfidence: 'low',
  note: 'Part number on the document does not match the one on file. Confirm before it is accepted.'
}];

/**
 * Every sheet ever received for a material, and what each revision moved. A
 * revised sheet is the most common cause of a wrong label, so the app has to
 * be able to say exactly what it did.
 */
export const DOCUMENT_HISTORY: Record<string, DocumentRevision[]> = {
  'ing-black-fig': [
  {
    version: '4.2',
    date: '2026-07-15',
    received: '2026-07-28',
    summary:
    'Skin sensitisation specific concentration limit lowered from 0.6 percent to 0.4 percent. Linalool raised from 4.9 percent to 5.4 percent.',
    moved: [
    'Not yet accepted. Accepting it will re-run the classification for Black Fig and Cassis.']

  },
  {
    version: '4.1',
    date: '2025-11-02',
    received: '2025-11-06',
    summary: 'Aquatic chronic classification added. Allergen table unchanged.',
    moved: ['Added H412 to Black Fig and Cassis, and P273 with it.']
  },
  {
    version: '3.8',
    date: '2024-06-18',
    received: '2024-06-20',
    summary: 'First sheet received for this material.',
    moved: []
  }],

  'ing-smoked-vetiver': [
  {
    version: '2.4',
    date: '2026-02-11',
    received: '2026-02-14',
    summary: 'Coumarin content revised from 1.8 percent to 2.1 percent.',
    moved: ['No change to any output. Coumarin was already declared on the EUH208 line.']
  },
  {
    version: '2.1',
    date: '2024-09-30',
    received: '2024-10-03',
    summary: 'First sheet received for this material.',
    moved: []
  }],

  'ing-alcohol': [
  {
    version: '6.0',
    date: '2025-04-22',
    received: '2025-04-25',
    summary: 'Flash point restated as 12 °C closed cup. No classification change.',
    moved: ['Updated section 9 of every sheet that carries this carrier.']
  }]

};

export function documentHistory(materialId: string): DocumentRevision[] {
  return DOCUMENT_HISTORY[materialId] ?? [];
}

/* --------------------------------------------------- the invented catalogue */

/**
 * WHAT USED TO BE src/lib/catalog.ts, AND WHY IT IS IN THIS FILE NOW.
 *
 * Fourteen ingredients and seven packs, with hazard classifications, specific concentration
 * limits, allergen percentages and IFRA maxima — shipped in the bundle, read by the
 * derivation, and printed onto labels and safety data sheets as fact. Every figure in it was
 * invented. Rhys's ruling on the materials round says it plainly: "a shipped catalogue has to
 * be either genuinely real or obviously and honestly a starter set. Do not ship more invented
 * hazard classifications dressed as reference data."
 *
 * So the data did not get better; it changed jobs. It is test data now, in the one file
 * nothing that ships may import (fixtures.guard.test.ts enforces that, and it is the reason
 * this file exists). The derivation, safety data sheet and regime tests need materials with
 * real shape to reason about — a fragrance oil with a supplier specific concentration limit,
 * an allergen that sits just under the declaration threshold — and inventing a second set for
 * the tests would have been the same work for the same coverage.
 *
 * WHAT SHIPS INSTEAD: nothing. `batchlabel.reference_materials` is empty, and a row in it
 * requires a `provenance` — two of whose three values demand a named document, and whose
 * third means "made up to show the shape" and must be labelled as such wherever it renders.
 * These entries carry that third value, which is the truthful one for them.
 *
 * A TEST THAT WANTS THEM PUBLISHES THEM: `publishMaterials(accountId, FIXTURE_MATERIALS)`
 * from lib/material-index.ts. Nothing publishes them at import time, so a test that forgets
 * gets the empty register a real new account has — which is the state most of these tests
 * should be reasoning about anyway.
 */

export const FIXTURE_INGREDIENTS: IngredientMaterial[] =
[
{
  id: 'ing-black-fig',
  source: 'reference',
  provenance: 'illustrative-example',
  editable: false,
  class: 'ingredient',
  role: 'Fragrance oil',
  name: 'Black Fig and Cassis',
  supplier: 'Aurelia Fragrances',
  supplierCode: 'FO-4471',
  categories: ['home-fragrance', 'cosmetics'],
  inci: 'Parfum',
  inciFunction: 'Perfuming',
  document: {
    kind: 'Safety data sheet',
    reference: 'aurelia-fo-4471-sds',
    version: '4.2',
    date: '2025-11-14'
  },
  hazards: [
  {
    code: 'H317',
    statement: 'May cause an allergic skin reaction.',
    hazardClass: 'Skin Sens. 1',
    gcl: 1,
    scl: 0.4,
    pictogram: 'GHS07',
    signal: 'Warning'
  },
  {
    code: 'H319',
    statement: 'Causes serious eye irritation.',
    hazardClass: 'Eye Irrit. 2',
    gcl: 10,
    pictogram: 'GHS07',
    signal: 'Warning'
  },
  {
    code: 'H411',
    statement: 'Toxic to aquatic life with long lasting effects.',
    hazardClass: 'Aquatic Chronic 2',
    gcl: 25,
    pictogram: 'GHS09'
  },
  {
    code: 'H412',
    statement: 'Harmful to aquatic life with long lasting effects.',
    hazardClass: 'Aquatic Chronic 3',
    gcl: 2.5,
    derivation: 'Summation method, Aquatic Chronic 2 counted at ten times its concentration.'
  }],

  allergens: [
  { name: 'linalool', pct: 3.1 },
  { name: 'limonene', pct: 6.4 },
  { name: 'citronellol', pct: 1.2 },
  { name: 'geraniol', pct: 0.6 },
  { name: 'eugenol', pct: 0.2 }],

  ifra: [
  { category: 'Category 12', description: 'Non-skin contact, candles and diffusers', max: 100 },
  { category: 'Category 5A', description: 'Body lotion and face oil, leave-on', max: 1.4 },
  { category: 'Category 9', description: 'Rinse-off, soaps', max: 6.2 }],

  notes: 'Supplier gives a specific concentration limit of 0.4 percent for skin sensitisation.'
},
{
  id: 'ing-smoked-vetiver',
  source: 'reference',
  provenance: 'illustrative-example',
  editable: false,
  class: 'ingredient',
  role: 'Fragrance oil',
  name: 'Smoked Vetiver',
  supplier: 'Halden Aromatics',
  supplierCode: 'FO-2210',
  categories: ['home-fragrance'],
  inci: 'Parfum',
  inciFunction: 'Perfuming',
  document: {
    kind: 'Safety data sheet',
    reference: 'halden-fo-2210-sds',
    version: '2.1',
    date: '2026-01-09'
  },
  hazards: [
  {
    code: 'H317',
    statement: 'May cause an allergic skin reaction.',
    hazardClass: 'Skin Sens. 1',
    gcl: 1,
    pictogram: 'GHS07',
    signal: 'Warning'
  },
  {
    code: 'H411',
    statement: 'Toxic to aquatic life with long lasting effects.',
    hazardClass: 'Aquatic Chronic 2',
    gcl: 25,
    pictogram: 'GHS09'
  },
  {
    code: 'H412',
    statement: 'Harmful to aquatic life with long lasting effects.',
    hazardClass: 'Aquatic Chronic 3',
    gcl: 2.5,
    derivation: 'Summation method, Aquatic Chronic 2 counted at ten times its concentration.'
  }],

  allergens: [
  { name: 'eugenol', pct: 1.9 },
  { name: 'linalool', pct: 1.4 },
  { name: 'limonene', pct: 0.5 },
  { name: 'citronellol', pct: 0.3 }],

  ifra: [
  { category: 'Category 12', description: 'Non-skin contact, candles and diffusers', max: 100 },
  { category: 'Category 9', description: 'Rinse-off, soaps', max: 3.8 }]

},
{
  id: 'ing-bergamot-sea-salt',
  source: 'reference',
  provenance: 'illustrative-example',
  editable: false,
  class: 'ingredient',
  role: 'Fragrance oil',
  name: 'Bergamot and Sea Salt',
  supplier: 'Coastwise Perfumery',
  supplierCode: 'FO-8802',
  categories: ['home-fragrance'],
  inci: 'Parfum',
  inciFunction: 'Perfuming',
  document: {
    kind: 'Safety data sheet',
    reference: 'coastwise-fo-8802-sds',
    version: '3.0',
    date: '2025-08-21'
  },
  hazards: [
  {
    code: 'H317',
    statement: 'May cause an allergic skin reaction.',
    hazardClass: 'Skin Sens. 1B',
    gcl: 1,
    scl: 0.8,
    pictogram: 'GHS07',
    signal: 'Warning'
  },
  {
    code: 'H319',
    statement: 'Causes serious eye irritation.',
    hazardClass: 'Eye Irrit. 2',
    gcl: 10,
    pictogram: 'GHS07',
    signal: 'Warning'
  },
  {
    code: 'H412',
    statement: 'Harmful to aquatic life with long lasting effects.',
    hazardClass: 'Aquatic Chronic 3',
    gcl: 2.5
  }],

  allergens: [
  { name: 'limonene', pct: 12.4 },
  { name: 'linalool', pct: 4.8 },
  { name: 'geraniol', pct: 0.9 },
  { name: 'citronellol', pct: 0.4 }],

  ifra: [
  { category: 'Category 12', description: 'Non-skin contact, candles and diffusers', max: 100 },
  { category: 'Category 9', description: 'Rinse-off, soaps', max: 4.4 }]

},
{
  id: 'ing-wild-damson',
  source: 'reference',
  provenance: 'illustrative-example',
  editable: false,
  class: 'ingredient',
  role: 'Fragrance oil',
  name: 'Wild Damson and Bay',
  supplier: 'Nightjar Fragrance Co.',
  supplierCode: 'FO-1330',
  categories: ['home-fragrance'],
  inci: 'Parfum',
  inciFunction: 'Perfuming',
  document: {
    kind: 'Safety data sheet',
    reference: 'nightjar-fo-1330-sds',
    version: '1.4',
    date: '2026-03-02'
  },
  hazards: [
  {
    code: 'H317',
    statement: 'May cause an allergic skin reaction.',
    hazardClass: 'Skin Sens. 1',
    gcl: 1,
    pictogram: 'GHS07',
    signal: 'Warning'
  },
  {
    code: 'H412',
    statement: 'Harmful to aquatic life with long lasting effects.',
    hazardClass: 'Aquatic Chronic 3',
    gcl: 2.5
  }],

  allergens: [
  { name: 'linalool', pct: 2.2 },
  { name: 'limonene', pct: 1.1 },
  { name: 'eugenol', pct: 0.8 }],

  ifra: [
  { category: 'Category 12', description: 'Non-skin contact, candles and diffusers', max: 100 }]

},
{
  id: 'ing-crw45',
  source: 'reference',
  provenance: 'illustrative-example',
  editable: false,
  class: 'ingredient',
  role: 'Wax',
  name: 'Coconut and rapeseed wax CRW-45',
  supplier: 'Kerax',
  supplierCode: 'CRW-45',
  categories: ['home-fragrance'],
  document: {
    kind: 'Safety data sheet',
    reference: 'kerax-crw45-sds',
    version: '5.0',
    date: '2025-04-30'
  },
  hazards: [],
  allergens: [],
  ifra: [],
  notes: 'Not classified as hazardous.'
},
{
  id: 'ing-soy-c3',
  source: 'reference',
  provenance: 'illustrative-example',
  editable: false,
  class: 'ingredient',
  role: 'Wax',
  name: 'Soy container wax C-3',
  supplier: 'Ecowax Supplies',
  supplierCode: 'C-3',
  categories: ['home-fragrance'],
  document: {
    kind: 'Safety data sheet',
    reference: 'ecowax-c3-sds',
    version: '2.6',
    date: '2025-02-11'
  },
  hazards: [],
  allergens: [],
  ifra: [],
  notes: 'Not classified as hazardous.'
},
{
  id: 'ing-dpg',
  source: 'reference',
  provenance: 'illustrative-example',
  editable: false,
  class: 'ingredient',
  role: 'Carrier',
  name: 'Diffuser base, dipropylene glycol',
  supplier: 'Halden Aromatics',
  supplierCode: 'DPG-99',
  categories: ['home-fragrance'],
  document: {
    kind: 'Safety data sheet',
    reference: 'halden-dpg99-sds',
    version: '3.3',
    date: '2025-10-06'
  },
  hazards: [],
  allergens: [],
  ifra: [],
  notes: 'Not classified as hazardous.'
},
{
  id: 'ing-alcohol',
  source: 'reference',
  provenance: 'illustrative-example',
  editable: false,
  class: 'ingredient',
  role: 'Carrier',
  name: "Perfumer's alcohol, denatured 96 percent",
  supplier: 'Mercia Solvents',
  supplierCode: 'PA-96',
  categories: ['home-fragrance'],
  document: {
    kind: 'Safety data sheet',
    reference: 'mercia-pa96-sds',
    version: '7.1',
    date: '2026-02-18'
  },
  hazards: [
  {
    code: 'H226',
    statement: 'Flammable liquid and vapour.',
    hazardClass: 'Flam. Liq. 3',
    gcl: 25,
    pictogram: 'GHS02',
    signal: 'Warning'
  },
  {
    code: 'H319',
    statement: 'Causes serious eye irritation.',
    hazardClass: 'Eye Irrit. 2',
    gcl: 50,
    pictogram: 'GHS07',
    signal: 'Warning'
  }],

  allergens: [],
  ifra: []
},
{
  id: 'ing-no-dye',
  source: 'reference',
  provenance: 'illustrative-example',
  editable: false,
  class: 'ingredient',
  role: 'Dye',
  name: 'No dye',
  supplier: '—',
  supplierCode: '—',
  categories: ['home-fragrance'],
  document: { kind: 'Safety data sheet', reference: '—', version: '—', date: '—' },
  hazards: [],
  allergens: [],
  ifra: []
},
{
  id: 'ing-dye-terracotta',
  source: 'reference',
  provenance: 'illustrative-example',
  editable: false,
  class: 'ingredient',
  role: 'Dye',
  name: 'Wax dye chip, terracotta',
  supplier: 'Kerax',
  supplierCode: 'DYE-TC',
  categories: ['home-fragrance'],
  document: {
    kind: 'Safety data sheet',
    reference: 'kerax-dyetc-sds',
    version: '1.2',
    date: '2025-09-01'
  },
  hazards: [],
  allergens: [],
  ifra: [],
  notes: 'Not classified below 1 percent in wax.'
},
{
  id: 'ing-rosehip',
  source: 'reference',
  provenance: 'illustrative-example',
  editable: false,
  class: 'ingredient',
  role: 'Plant oil',
  name: 'Rosehip seed oil, cold pressed',
  supplier: 'Verdant Botanicals',
  supplierCode: 'BOT-RH01',
  categories: ['cosmetics'],
  inci: 'Rosa Canina Fruit Oil',
  inciFunction: 'Skin conditioning',
  cas: '84696-47-9',
  document: {
    kind: 'INCI and allergen certificate',
    reference: 'verdant-rh01-inci',
    version: '2.0',
    date: '2026-02-04'
  },
  hazards: [],
  allergens: [],
  ifra: []
},
{
  id: 'ing-meadowfoam',
  source: 'reference',
  provenance: 'illustrative-example',
  editable: false,
  class: 'ingredient',
  role: 'Plant oil',
  name: 'Meadowfoam seed oil',
  supplier: 'Verdant Botanicals',
  supplierCode: 'BOT-MF02',
  categories: ['cosmetics'],
  inci: 'Limnanthes Alba Seed Oil',
  inciFunction: 'Skin conditioning',
  cas: '153065-40-8',
  document: {
    kind: 'INCI and allergen certificate',
    reference: 'verdant-mf02-inci',
    version: '1.3',
    date: '2025-12-12'
  },
  hazards: [],
  allergens: [],
  ifra: []
},
{
  id: 'ing-jojoba',
  source: 'reference',
  provenance: 'illustrative-example',
  editable: false,
  class: 'ingredient',
  role: 'Plant oil',
  name: 'Jojoba oil, golden',
  supplier: 'Verdant Botanicals',
  supplierCode: 'BOT-JJ04',
  categories: ['cosmetics'],
  inci: 'Simmondsia Chinensis Seed Oil',
  inciFunction: 'Skin conditioning',
  cas: '90045-98-0',
  document: {
    kind: 'INCI and allergen certificate',
    reference: 'verdant-jj04-inci',
    version: '1.1',
    date: '2025-07-08'
  },
  hazards: [],
  allergens: [],
  ifra: []
},
{
  id: 'ing-tocopherol',
  source: 'reference',
  provenance: 'illustrative-example',
  editable: false,
  class: 'ingredient',
  role: 'Antioxidant',
  name: 'Natural vitamin E, mixed tocopherols',
  supplier: 'Mercia Solvents',
  supplierCode: 'TOC-70',
  categories: ['cosmetics'],
  inci: 'Tocopherol',
  inciFunction: 'Antioxidant',
  cas: '1406-18-4',
  document: {
    kind: 'INCI and allergen certificate',
    reference: 'mercia-toc70-inci',
    version: '3.1',
    date: '2026-01-27'
  },
  hazards: [],
  allergens: [],
  ifra: []
}];

export const FIXTURE_PACKAGING: PackagingMaterial[] =
[
{
  id: 'pkg-tumbler-250',
  source: 'reference',
  provenance: 'illustrative-example',
  editable: false,
  class: 'packaging',
  name: 'Amber glass tumbler, 250 ml',
  supplier: 'Bellhurst Glass',
  supplierCode: 'GT-250A',
  categories: ['home-fragrance'],
  format: 'Tumbler with tin lid',
  capacityMl: 250,
  labelAreaMm: { width: 72, height: 60 },
  foodContact: false,
  childResistant: false,
  document: {
    kind: 'Technical drawing',
    reference: 'bellhurst-gt250a-drawing',
    version: '2',
    date: '2025-06-18'
  }
},
{
  id: 'pkg-diffuser-100',
  source: 'reference',
  provenance: 'illustrative-example',
  editable: false,
  class: 'packaging',
  name: 'Clear glass diffuser bottle, 100 ml',
  supplier: 'Bellhurst Glass',
  supplierCode: 'DB-100C',
  categories: ['home-fragrance'],
  format: 'Bottle with reeds and collar',
  capacityMl: 100,
  labelAreaMm: { width: 58, height: 78 },
  foodContact: false,
  childResistant: false,
  document: {
    kind: 'Technical drawing',
    reference: 'bellhurst-db100c-drawing',
    version: '1',
    date: '2025-03-09'
  }
},
{
  id: 'pkg-spray-100',
  source: 'reference',
  provenance: 'illustrative-example',
  editable: false,
  class: 'packaging',
  name: 'Frosted glass bottle, 100 ml, fine mist pump',
  supplier: 'Corbel Packaging',
  supplierCode: 'SP-100F',
  categories: ['home-fragrance'],
  format: 'Bottle with pump',
  capacityMl: 100,
  labelAreaMm: { width: 60, height: 80 },
  foodContact: false,
  childResistant: false,
  document: {
    kind: 'Technical drawing',
    reference: 'corbel-sp100f-drawing',
    version: '3',
    date: '2026-01-15'
  }
},
{
  id: 'pkg-clamshell',
  source: 'reference',
  provenance: 'illustrative-example',
  editable: false,
  class: 'packaging',
  name: 'Wax melt clamshell, six segment',
  supplier: 'Corbel Packaging',
  supplierCode: 'CS-6',
  categories: ['home-fragrance'],
  format: 'Clamshell',
  capacityMl: 90,
  labelAreaMm: { width: 80, height: 40 },
  foodContact: false,
  childResistant: false,
  document: {
    kind: 'Technical drawing',
    reference: 'corbel-cs6-drawing',
    version: '1',
    date: '2024-11-21'
  }
},
{
  id: 'pkg-dropper-30',
  source: 'reference',
  provenance: 'illustrative-example',
  editable: false,
  class: 'packaging',
  name: 'Amber dropper bottle, 30 ml',
  supplier: 'Corbel Packaging',
  supplierCode: 'DR-30A',
  categories: ['cosmetics'],
  format: 'Bottle with pipette',
  capacityMl: 30,
  labelAreaMm: { width: 44, height: 62 },
  foodContact: false,
  childResistant: false,
  document: {
    kind: 'Technical drawing',
    reference: 'corbel-dr30a-drawing',
    version: '2',
    date: '2026-04-02'
  }
},
{
  id: 'pkg-carton-30',
  source: 'reference',
  provenance: 'illustrative-example',
  editable: false,
  class: 'packaging',
  name: 'Folding carton, 35 × 35 × 95 mm',
  supplier: 'Marsh Print',
  supplierCode: 'FC-3595',
  categories: ['cosmetics', 'electronics'],
  format: 'Folding carton',
  capacityMl: 116,
  labelAreaMm: { width: 90, height: 60 },
  foodContact: false,
  childResistant: false,
  document: {
    kind: 'Technical drawing',
    reference: 'marsh-fc3595-drawing',
    version: '1',
    date: '2026-03-30'
  }
},
{
  id: 'pkg-device-box',
  source: 'reference',
  provenance: 'illustrative-example',
  editable: false,
  class: 'packaging',
  name: 'Device carton, 120 × 90 × 70 mm',
  supplier: 'Marsh Print',
  supplierCode: 'DC-1209',
  categories: ['electronics'],
  format: 'Corrugated carton with insert',
  capacityMl: 756,
  labelAreaMm: { width: 110, height: 80 },
  foodContact: false,
  childResistant: false,
  document: {
    kind: 'Technical drawing',
    reference: 'marsh-dc1209-drawing',
    version: '2',
    date: '2026-05-11'
  }
}];

export const FIXTURE_MATERIALS: Material[] = [...FIXTURE_INGREDIENTS, ...FIXTURE_PACKAGING];
