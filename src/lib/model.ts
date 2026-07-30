/**
 * The spine. Four layers, none of which mention fragrance:
 * material -> specification -> artefact -> record, governed by regimes.
 */

export type Market = 'GB' | 'EU';

export type CategoryId = 'home-fragrance' | 'cosmetics' | 'electronics';

export type RegimeId = 'clp' | 'en15494' | 'cpr' | 'ce' | 'rohs' | 'weee' | 'gpsr';

export type MaterialClass = 'ingredient' | 'packaging' | 'component';

/**
 * The two outputs. 'sds' is the finished-product safety data sheet; everything
 * else is a variant of the label. Both come out of one derivation.
 */
export type ArtefactType =
'unit-label' |
'carton' |
'leaflet' |
'listing' |
'rating-plate' |
'sds';

/** A supplier document as it was received, kept so a revision can be explained. */
export type DocumentRevision = {
  version: string;
  date: string;
  received: string;
  summary: string;
  /** What this revision moved, in the canonical sentence. Empty when nothing moved. */
  moved: string[];
};

/** A document dropped in but not yet reconciled against a material. */
export type InboxDocument = {
  id: string;
  fileName: string;
  receivedOn: string;
  appearsToBe: DocumentKind;
  supplier: string;
  /** The material the app thinks this belongs to, and how sure it is. */
  matchedMaterialId?: string;
  matchConfidence: 'high' | 'low' | 'none';
  note: string;
};

export type DocumentKind =
'Safety data sheet' |
'INCI and allergen certificate' |
'Technical drawing' |
'Declaration of conformity' |
'Test report';

export type SupplierDocument = {
  kind: DocumentKind;
  reference: string;
  version: string;
  date: string;
  /** Set when the supplier has published a newer version than the one on file. */
  latestVersion?: string;
  latestDate?: string;
  expires?: string;
};

export type Allergen = {
  name: string;
  /** Percentage present in the raw material at 100 percent. */
  pct: number;
};

export type HazardAt100 = {
  code: string;
  statement: string;
  hazardClass: string;
  /** Generic concentration limit, as a percentage of the material in the finished mixture. */
  gcl: number;
  /** Specific concentration limit given by the supplier, where stated. */
  scl?: number;
  pictogram?: 'GHS07' | 'GHS09' | 'GHS02';
  signal?: 'Warning' | 'Danger';
  derivation?: string;
};

export type IfraLimit = {
  category: string;
  description: string;
  max: number;
};

export type IngredientRole =
'Fragrance oil' |
'Wax' |
'Carrier' |
'Dye' |
'Additive' |
'Plant oil' |
'Antioxidant';

type MaterialBase = {
  id: string;
  name: string;
  supplier: string;
  supplierCode: string;
  document: SupplierDocument;
  categories: CategoryId[];
  notes?: string;
};

export type IngredientMaterial = MaterialBase & {
  class: 'ingredient';
  role: IngredientRole;
  inci?: string;
  inciFunction?: string;
  cas?: string;
  hazards: HazardAt100[];
  allergens: Allergen[];
  ifra: IfraLimit[];
};

export type PackagingMaterial = MaterialBase & {
  class: 'packaging';
  format: string;
  capacityMl: number;
  labelAreaMm: {width: number;height: number;};
  foodContact: boolean;
  childResistant: boolean;
};

export type ComponentMaterial = MaterialBase & {
  class: 'component';
  partNumber: string;
  rohsStatus: 'Compliant' | 'Compliant with exemption' | 'Not declared';
  rohsExemption?: string;
  standards: string[];
  certificateExpiry: string;
};

export type Material = IngredientMaterial | PackagingMaterial | ComponentMaterial;

/* ---------------------------------------------------------------- specs */

export type MixtureSpec = {
  kind: 'mixture';
  productType: string;
  baseId: string;
  fragranceId: string;
  /** Fragrance load, as a percentage of the finished mixture. */
  load: number;
  dyeId: string;
  additive: string;
  netQuantity: number;
  netUnit: 'g' | 'ml';
  packagingId: string;
};

export type PhaseItem = {materialId: string;pct: number;};

export type PhasedSpec = {
  kind: 'phased';
  productType: string;
  phases: Array<{name: string;items: PhaseItem[];}>;
  application: 'Leave-on' | 'Rinse-off';
  paoMonths: number;
  netQuantity: number;
  netUnit: 'g' | 'ml';
  packagingId: string;
};

export type BomItem = {materialId: string;quantity: number;position: string;};

export type BomSpec = {
  kind: 'bom';
  productType: string;
  model: string;
  items: BomItem[];
  ratings: {voltage: string;current: string;power: string;};
  netQuantity: number;
  netUnit: 'g' | 'ml';
  packagingId: string;
};

export type Spec = MixtureSpec | PhasedSpec | BomSpec;

/* ------------------------------------------------------------ artefacts */

export type ArtefactInstance = {
  type: ArtefactType;
  label: string;
  widthMm: number;
  heightMm: number;
  version: string;
  printedOn: string;
  /** False when the specification changed after this artefact version was printed. */
  current: boolean;
  driftNote?: string;
};

/* -------------------------------------------------------------- product */

export type Product = {
  id: string;
  name: string;
  sku: string;
  categoryId: CategoryId;
  markets: Market[];
  regimes: RegimeId[];
  spec: Spec;
  artefacts: ArtefactInstance[];
  identifiers: {
    ufi?: string;
    model?: string;
    weeeRegistration?: string;
    modelYear?: string;
  };
  /** Keyed by obligation id. Missing means not satisfied. */
  obligations: Record<string, boolean>;
};

/* --------------------------------------------------------------- record */

export type RecordIdentity =
{kind: 'batch';code: string;} |
{kind: 'serial-range';code: string;from: string;to: string;};

export type ProductionRecord = {
  code: string;
  productId: string;
  date: string;
  units: number;
  identity: RecordIdentity;
  /** Every traceable input lot used on the day, by material. */
  lots: Array<{materialId: string;lot: string;}>;
  specVersion: string;
  artefactVersions: Array<{type: ArtefactType;version: string;}>;
  madeBy: string;
  notes?: string;
};

/* ------------------------------------------------------------ attention */

export type Attention = {
  id: string;
  productId?: string;
  materialId?: string;
  categoryId: CategoryId;
  regimeId: RegimeId;
  severity: 'blocking' | 'review';
  label: string;
  detail: string;
  to: string;
};

/* ------------------------------------------------------------ workspace */

export type SupplierAddress = {
  id: string;
  market: Market | 'NI';
  label: string;
  role: string;
  lines: string[];
  isDefault?: boolean;
};

export type ArtefactStock = {
  id: string;
  name: string;
  artefactType: ArtefactType;
  widthMm: number;
  heightMm: number;
  perSheet: number;
  sheet: string;
};

export type TeamMember = {
  name: string;
  email: string;
  role: 'Owner' | 'Maker' | 'Read only';
  lastActive: string;
};

export type ConformityDocument = {
  id: string;
  title: string;
  reference: string;
  issued: string;
  expires?: string;
  owner: string;
  productId?: string;
};

export function formatDate(iso?: string): string {
  if (!iso || iso === '—') return '—';
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;
  return parsed.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function round(value: number, dp = 3): number {
  return Math.round(value * 10 ** dp) / 10 ** dp;
}