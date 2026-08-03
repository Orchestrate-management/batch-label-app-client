import { ArtefactStock, ArtefactType, CategoryId, RegimeId } from './model';

/**
 * Category packs, artefact labels and stock presets.
 *
 * WHY THIS IS NO LONGER IN products.ts. That file used to hold two unrelated things: the
 * category packs (which are product-of-the-app configuration, identical for every customer,
 * and compiled into the bundle) and a module-level array of six invented products (which was
 * customer data, and was the same six for everybody). Splitting them is what makes it
 * possible to say "a new account sees nothing" and mean it: everything in THIS file is
 * shipped configuration and is meant to be on screen for a brand new account, and nothing in
 * it describes a product anybody makes.
 *
 * `products.ts` now talks to Supabase and holds no data of its own.
 */

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

/**
 * The category a `kind` belongs to.
 *
 * The database stores `specifications.kind` and `specifications.category_id` separately —
 * kind because the derivation switches on it, category_id because the app's screens do — and
 * a row read back may carry either. This resolves a stored category_id that is not one of
 * ours (a row written by a later version of the app, say) back to something renderable
 * rather than throwing on a screen.
 */
export function categoryForKind(kind: CategoryPack['specKind']): CategoryPack {
  return CATEGORIES.find((c) => c.specKind === kind) ?? CATEGORIES[0];
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

/* --------------------------------------------------------- stock presets */

/**
 * Label stock a maker can print onto. Sheet sizes and Avery part numbers are facts about
 * stationery, not about any account, so these are shipped rather than stored.
 */
export const STOCK: ArtefactStock[] = [
{ id: 'ls-1', name: 'Base label 52 × 74', artefactType: 'unit-label', widthMm: 52, heightMm: 74, perSheet: 10, sheet: 'A4' },
{ id: 'ls-2', name: 'Avery L7169, 99.1 × 67.7', artefactType: 'unit-label', widthMm: 99.1, heightMm: 67.7, perSheet: 8, sheet: 'A4' },
{ id: 'ls-3', name: 'Dropper bottle wrap 44 × 62', artefactType: 'unit-label', widthMm: 44, heightMm: 62, perSheet: 12, sheet: 'A4' },
{ id: 'ls-4', name: 'Carton panel 88 × 58', artefactType: 'carton', widthMm: 88, heightMm: 58, perSheet: 8, sheet: 'A4' },
{ id: 'ls-5', name: 'Device carton panel 100 × 70', artefactType: 'carton', widthMm: 100, heightMm: 70, perSheet: 6, sheet: 'A4' },
{ id: 'ls-6', name: 'Rating plate 40 × 25', artefactType: 'rating-plate', widthMm: 40, heightMm: 25, perSheet: 24, sheet: 'A4' },
{ id: 'ls-7', name: 'Leaflet A6, 105 × 148', artefactType: 'leaflet', widthMm: 105, heightMm: 148, perSheet: 4, sheet: 'A4' },
{ id: 'ls-8', name: 'Listing block 96 × 60', artefactType: 'listing', widthMm: 96, heightMm: 60, perSheet: 1, sheet: 'Screen' }];
