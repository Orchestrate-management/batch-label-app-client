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
  productTypes: string[];
  regimes: RegimeId[];
  artefacts: ArtefactType[];
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
  productTypes: ['Container candle', 'Wax melt', 'Reed diffuser', 'Room spray'],
  regimes: ['clp', 'en15494', 'gpsr'],
  artefacts: ['unit-label', 'listing'],
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
}];


/**
 * The one pack there is.
 *
 * Kept as a lookup rather than a bare constant because a product row carries a `category_id`
 * read back from the database, and a row written by some other version of the app must resolve
 * to something renderable rather than throwing on a screen.
 */
export function categoryById(id: CategoryId): CategoryPack {
  return CATEGORIES.find((c) => c.id === id) ?? CATEGORIES[0];
}

export const ARTEFACT_LABELS: Record<ArtefactType, string> = {
  'unit-label': 'Unit label',
  listing: 'Online listing',
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
{ id: 'ls-3', name: 'Jar wrap 44 × 62', artefactType: 'unit-label', widthMm: 44, heightMm: 62, perSheet: 12, sheet: 'A4' },
{ id: 'ls-8', name: 'Listing block 96 × 60', artefactType: 'listing', widthMm: 96, heightMm: 60, perSheet: 1, sheet: 'Screen' }];
