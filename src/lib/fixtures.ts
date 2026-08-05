import {
  DocumentRevision,
  IngredientMaterial,
  InboxDocument,
  Material,
  PackagingMaterial,
  Product,
  ProductEvidence,
  TeamMember } from
'./model';

/**
 * DEMO DATA. NOTHING IN THE APP MAY IMPORT THIS FILE.
 *
 * =============================================================================
 * This is the six-product workspace of Hearth and Hollow Ltd, a business that does not
 * exist. It used to live in src/lib/products.ts, where a module-level `let runtime: Product[]
 * = PRODUCTS` seeded it into the running app. Every signed-in customer — every one, on their
 * very first visit — opened Batchlabel and found four candles already in it, along with ten
 * production runs they had never made and two "your label is out of date" warnings about a
 * fragrance load somebody else had changed in July.
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
 * repository — a mixture that crosses a supplier specific concentration limit, a diffuser at a
 * 22 percent load, a room spray on an alcohol base — and the derivation, regime and safety data
 * sheet tests need something with real shape to derive from. Deleting them would cost real
 * coverage; keeping them anywhere reachable would cost a customer's trust on their first
 * screen.
 * =============================================================================
 */

/* -------------------------------------------------------------- products */

/**
 * The fixtures' old `obligations: Record<string, boolean>` map, as evidence entries.
 *
 * `Product.obligations` was read from a jsonb column nothing ever wrote, so it was replaced by
 * `Product.evidence`, which comes from the append-only log and has a write path. These fixtures
 * predate that and express the same idea as booleans; converting them here keeps the four
 * non-trivial compositions the derivation and regime tests depend on, without teaching a new
 * reader that a boolean map is a shape the app still deals in.
 *
 * A `false` entry becomes NO entry, which is the point: the absence of evidence is how "not
 * recorded" is represented now, and there is deliberately no way to store a recorded negative.
 */
function evidenceFrom(satisfied: Record<string, boolean>): ProductEvidence {
  const obligations: ProductEvidence['obligations'] = {};
  for (const [id, done] of Object.entries(satisfied)) {
    if (!done) continue;
    obligations[id] = {
      id: `fixture-evidence-${id}`,
      recordedAt: '2026-06-30T00:00:00.000Z',
      reference: null,
      summary: `Fixture evidence for ${id}.`
    };
  }
  return { obligations, sdsSections: {} };
}

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
    currency: 'out-of-date',
    isPlaceholder: false,
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
    currency: 'out-of-date',
    isPlaceholder: false,
    driftNote: 'The listing still shows the classification calculated at 7 percent.'
  }],

  evidence: evidenceFrom({
    'clp-classification': true,
    'clp-artefact-current': false,
    'clp-ufi': false,
    'clp-pcn-eu': false,
    'clp-pcn-gb': false,
    'en15494-safety-text': true,
    'gpsr-traceability': true,
    'gpsr-eu-responsible-person': false,
    'gpsr-online-disclosure': false
  })
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
    currency: 'current',
    isPlaceholder: false
  },
  {
    type: 'listing',
    label: 'Online listing',
    widthMm: 96,
    heightMm: 60,
    version: 'v2',
    printedOn: '2026-06-30',
    currency: 'current',
    isPlaceholder: false
  }],

  evidence: evidenceFrom({
    'clp-classification': true,
    'clp-artefact-current': true,
    'clp-ufi': false,
    'clp-pcn-gb': false,
    'gpsr-traceability': true,
    'gpsr-online-disclosure': true
  })
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
    currency: 'current',
    isPlaceholder: false
  },
  {
    type: 'listing',
    label: 'Online listing',
    widthMm: 96,
    heightMm: 60,
    version: 'v1',
    printedOn: '2026-07-02',
    currency: 'current',
    isPlaceholder: false
  }],

  evidence: evidenceFrom({
    'clp-classification': true,
    'clp-artefact-current': true,
    'clp-ufi': false,
    'clp-pcn-eu': false,
    'clp-pcn-gb': false,
    'gpsr-traceability': true,
    'gpsr-eu-responsible-person': true,
    'gpsr-online-disclosure': false
  })
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
    currency: 'current',
    isPlaceholder: false
  },
  {
    type: 'listing',
    label: 'Online listing',
    widthMm: 96,
    heightMm: 60,
    version: 'v1',
    printedOn: '2026-04-18',
    currency: 'current',
    isPlaceholder: false
  }],

  evidence: evidenceFrom({
    'clp-classification': true,
    'clp-artefact-current': true,
    'clp-ufi': false,
    'clp-pcn-gb': false,
    'en15494-safety-text': true,
    'gpsr-traceability': true,
    'gpsr-online-disclosure': true
  })
}];



/**
 * The safety data sheet is the second output of the same derivation, so every product carries
 * one alongside its label surfaces.
 */
function withSafetyDataSheet(product: Product): Product {
  if (product.artefacts.some((artefact) => artefact.type === 'sds')) return product;
  const staleLabel = product.artefacts.find((artefact) => artefact.currency === 'out-of-date');
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
      currency: staleLabel ? 'out-of-date' : 'current',
      isPlaceholder: false,
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

/*
 * TWO FIXTURE LISTS WERE DELETED HERE, AND THEY ARE THE BRIEF'S OWN EXAMPLE.
 *
 * `RECORDS` was a list of invented production runs — batch codes, dates, unit counts, "made by
 * Tom" — and `ATTENTION` was a list of invented compliance findings against them: "Component
 * without a declaration", "Test report expires in 62 days", "The declaration for WW-100 cannot
 * be signed until it is". Nothing measured any of it, and two of the three Resolve links
 * pointed at `/materials/component/…`, a route that no longer exists because components do not.
 *
 * They were already orphaned by the time these four branches met: Records reads
 * `batchlabel.record_events` now, and the recall search counts over the table it searched.
 * Orphaned is exactly why they had to go rather than be left. A list of plausible findings
 * sitting in the repo under a real product's name is one import away from a screen, and the
 * whole defect class this work removed started with data that looked ready to render.
 *
 * `ProductionRecord` and `Attention` stay in model.ts. Records writes real production rows and
 * will want the first; the second is a shape without a producer, and whoever gives it one owns
 * proving it against something.
 */


/* ------------------------------------------------------------- workspace */

export const TEAM: TeamMember[] = [
{ name: 'Nadia Osei', email: 'nadia@hearthandhollow.co.uk', role: 'Owner', lastActive: 'Today' },
{ name: 'Tom Rivers', email: 'tom@hearthandhollow.co.uk', role: 'Maker', lastActive: 'Yesterday' },
{ name: 'Priya Shah', email: 'priya@kelder-compliance.eu', role: 'Read only', lastActive: '12 July' }];


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
  categories: ['home-fragrance'],
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
}];

export const FIXTURE_MATERIALS: Material[] = [...FIXTURE_INGREDIENTS, ...FIXTURE_PACKAGING];
