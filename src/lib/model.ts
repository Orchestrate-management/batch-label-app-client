/**
 * The spine. Four layers, none of which mention fragrance:
 * material -> specification -> artefact -> record, governed by regimes.
 */

export type Market = 'GB' | 'EU';

export type CategoryId = 'home-fragrance' | 'cosmetics' | 'electronics';

export type RegimeId = 'clp' | 'en15494' | 'cpr' | 'ce' | 'rohs' | 'weee' | 'gpsr';

/**
 * WHAT A MATERIAL CAN BE, AND WHY 'component' IS NOT ONE OF THEM.
 *
 * Rhys: components are "not going to be a priority for a long time, better to just get rid of
 * it". The COMPONENTS array in lib/catalog.ts, the RoHS status it carried, the conformity
 * document store on the materials screen and the "<component> has no material declaration"
 * pipeline branch all went with it. The database says the same thing and says it harder:
 * `materials_class_check` and `reference_materials_class_check` list two values, so the row
 * cannot come back through a side door either.
 *
 * A bill of materials still EXISTS as a specification shape — BomSpec below — because the
 * electronics category is still a category. What it no longer has is materials to point at,
 * and deriveBom now says that plainly instead of reading conformity facts off a constant.
 */
export type MaterialClass = 'ingredient' | 'packaging';

/**
 * Whose record this is: the maker's own, or the catalogue Batchlabel ships.
 *
 * THE PRECEDENCE RULE, which every screen showing a material has to be able to state: the
 * maker's own row wins, unconditionally, whenever both describe the same thing. It is decided
 * once, in the `batchlabel.resolved_materials` view, and never re-implemented here — see
 * lib/materials.ts, which reads that view rather than merging two lists in the browser.
 */
export type MaterialSource = 'account' | 'reference';

/**
 * Where a REFERENCE material's classification came from. Not null in the database, on purpose.
 *
 * 'illustrative-example' means made up to show the shape. It exists so that importing the old
 * invented catalogue is possible only by declaring what it is — and a screen rendering one has
 * to label it, which is what `ReferenceProvenanceNote` on the materials screen does.
 */
export type MaterialProvenance =
'supplier-document' |
'regulatory-source' |
'illustrative-example';

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

/**
 * The supplier document a reference material's data was read from.
 *
 * `latestVersion` / `latestDate` were removed with the screens that rendered them. They said a
 * newer version had been published and the one in use was behind — a claim about a supplier's
 * publishing that nothing in this application checks, and one that read as compliance work
 * outstanding on a real product.
 */
export type SupplierDocument = {
  kind: DocumentKind;
  reference: string;
  version: string;
  date: string;
  expires?: string;
};

export type Allergen = {
  /**
   * The child row's own id, on a material the account owns.
   *
   * Carried so that a remove control has something to delete. It used to be absent, and the
   * consequence was a control that could not act — a bin icon beside a hazard statement with
   * nothing behind it is the same defect as a Resolve link to a screen that cannot resolve.
   * Undefined on a reference material, whose figures live in an immutable version document
   * and cannot be removed by anybody.
   */
  rowId?: string;
  name: string;
  /** Percentage present in the raw material at 100 percent. */
  pct: number;
};

export type HazardAt100 = {
  /** The child row's own id, on a material the account owns. See Allergen.rowId. */
  rowId?: string;
  code: string;
  statement: string;
  hazardClass: string;
  /**
   * Generic concentration limit, as a percentage of the material in the finished mixture.
   *
   * OPTIONAL, BECAUSE A SUPPLIER DOES NOT ALWAYS STATE ONE. `material_hazards.gcl` is nullable
   * for that reason, and the column comment says what a reader must do with the null: "a null
   * must be rendered as unknown and never as zero". Zero would transfer the hazard at every
   * load; a hundred would transfer it at none. Both are answers, and we do not have one — so
   * the derivation reports the hazard as undecidable rather than deciding it.
   */
  gcl?: number;
  /** Specific concentration limit given by the supplier, where stated. */
  scl?: number;
  pictogram?: 'GHS07' | 'GHS09' | 'GHS02';
  signal?: 'Warning' | 'Danger';
  derivation?: string;
};

export type IfraLimit = {
  /** The child row's own id, on a material the account owns. See Allergen.rowId. */
  rowId?: string;
  category: string;
  description: string;
  max: number;
};

/**
 * The part a material plays in a composition.
 *
 * A STRING, NOT A CLOSED UNION, since materials became the maker's own rows. `role` is a free
 * text column on batchlabel.materials, so a closed union here would be a type asserting
 * something about data this app does not control — and the first maker to type "Fragrance
 * concentrate" would have their row silently mistyped rather than rejected. INGREDIENT_ROLES
 * is what the picker offers; a stored value outside it still renders.
 */
export type IngredientRole = string;

export const INGREDIENT_ROLES = [
'Fragrance oil',
'Wax',
'Carrier',
'Dye',
'Additive',
'Plant oil',
'Antioxidant',
'Preservative',
'Emulsifier',
'Other'] as
const;

type MaterialBase = {
  /**
   * The account material's uuid, or — for a reference material — its catalogue slug.
   *
   * One id space, because a specification stores exactly one string per composition slot
   * (`specifications.fragrance_id` and friends) and a lookup has to be able to resolve it
   * without being told which half of the register it came from. `source` says which it was.
   */
  id: string;
  source: MaterialSource;
  /** Set on a reference material. Absent on the maker's own, whose provenance is themselves. */
  provenance?: MaterialProvenance;
  /** The reference material this own-row stands in place of, when it stands in for one. */
  overridesReferenceId?: string;
  /**
   * The catalogue row's own uuid, on a reference material.
   *
   * Carried separately from `id` because `id` is the slug — the string a specification stores
   * — and the override link is a foreign key to the uuid. A screen offering "hold my own
   * version of this" needs the second, and guessing it from the first is not possible.
   */
  referenceMaterialId?: string;
  /** The immutable reference version this row's figures were published in. */
  referenceVersionId?: string;
  referenceVersion?: number;
  /** The maker's own stable id for this material, where they set one. */
  slug?: string;
  name: string;
  supplier?: string;
  supplierCode?: string;
  /**
   * The document this material's figures were read from, WHERE ONE IS RECORDED.
   *
   * OPTIONAL, AND THAT IS THE CHANGE. It used to be required, because every material was a
   * shipped catalogue row with a document written into the bundle beside it. A maker's own
   * material may have no document at all — and a citation is the one thing that must never be
   * invented, so an absent document means every "Source:" line derived from it is omitted
   * rather than filled with a plausible one. See `materialCitation` in lib/material-index.ts.
   */
  document?: SupplierDocument;
  /**
   * Whether a FILE is actually held for that document, as opposed to the maker having typed
   * its reference and date. `material_documents.storage_path` null means no file is held, and
   * a screen may not render a document row as though something had been received.
   */
  documentFileHeld?: boolean;
  categories: CategoryId[];
  notes?: string;
  /** True when this material is the maker's own and can therefore be edited or archived. */
  editable: boolean;
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
  format?: string;
  /** Millilitres. Absent when the maker has not recorded one — never defaulted to a number. */
  capacityMl?: number;
  labelAreaMm?: {width: number;height: number;};
  foodContact?: boolean;
  childResistant?: boolean;
};

export type Material = IngredientMaterial | PackagingMaterial;

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

/**
 * What `version` and `printedOn` hold when nothing has been produced.
 *
 * There is no artefacts table, so on a real account every artefact carries these. They are
 * named here rather than written out at each site because two different files have to be able
 * to ASK whether an artefact has been produced: products.ts sets them, and sds.ts must not
 * print "Revision Not yet produced, issued —." onto the face of a sixteen-section safety data
 * sheet somebody may hand to a regulator.
 */
export const ARTEFACT_NOT_PRODUCED = 'Not yet produced';
export const ARTEFACT_NO_PRINT_DATE = '—';

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
  /**
   * The composition this SKU is a pack of — `specifications.id`.
   *
   * Optional because a fixture product has no database row behind it, and because the app
   * must be able to render a product it cannot write back. Every product read from Supabase
   * carries one, and a composition edit is refused rather than guessed without it: a
   * specification id is the only thing that says WHICH recipe to update, and a wrong guess
   * would rewrite a different product's classification.
   */
  specificationId?: string;
  name: string;
  sku: string;
  categoryId: CategoryId;
  markets: Market[];
  regimes: RegimeId[];
  spec: Spec;
  artefacts: ArtefactInstance[];
  identifiers: {
    /**
     * Nothing in Batchlabel generates a UFI, so this is never populated and is
     * never seeded with a plausible looking one: a maker who sees a UFI here
     * believes an obligation is met that is not, and skips the poison centre
     * notification that depends on it.
     *
     * For whoever builds the generator: under CLP Annex VIII a UFI belongs to
     * the composition, not to the thing you sell. Every pack size of the same
     * formulation shares one UFI. This field therefore has to move off Product,
     * which is 1:1 with a SKU, and onto whatever holds the composition.
     */
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