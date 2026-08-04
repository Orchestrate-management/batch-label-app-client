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

/**
 * What `version` and `printedOn` hold when nothing has been produced.
 *
 * They are named here rather than written out at each site because two different files have to
 * be able to ASK whether an artefact has been produced: products.ts sets them, and sds.ts must
 * not print "Revision Not yet produced, issued —." onto the face of a sixteen-section safety
 * data sheet somebody may hand to a regulator.
 */
export const ARTEFACT_NOT_PRODUCED = 'Not yet produced';
export const ARTEFACT_NO_PRINT_DATE = '—';

/**
 * Where an artefact stands against the composition it was produced from. FOUR STATES, and the
 * two that are not `current`/`out-of-date` are the whole reason this replaced a boolean.
 *
 * `current: boolean` could not tell the difference between "we checked and it matches", "we
 * checked and it does not", "nothing has ever been produced so there is nothing to check" and
 * "we could not get an answer". Every reader had to pick one of two pills for four facts, and
 * the pick that shipped was the worst one: every unproduced artefact was `current: true`, so
 * the specification screen painted a green "Current" pill on every row of a list whose every
 * row also said "Not yet produced".
 *
 *   not-produced  no artefact row exists for this surface. NOT a claim about currency.
 *   current       a produced artefact exists and batchlabel.artefact_source_fingerprint still
 *                 returns the hash stored on it. This is the only state that may be called up
 *                 to date, and it is a database answer rather than an assumption.
 *   out-of-date   a produced artefact exists and the fingerprint has moved. The composition,
 *                 the pack, a pinned material or the printed business identity changed after
 *                 it was produced.
 *   unknown       an artefact exists and we could not compute the fingerprint — the RPC failed
 *                 or returned null. Must never render as either of the two answers.
 */
export type ArtefactCurrency = 'not-produced' | 'current' | 'out-of-date' | 'unknown';

export type ArtefactInstance = {
  type: ArtefactType;
  label: string;
  widthMm: number;
  heightMm: number;
  version: string;
  printedOn: string;
  currency: ArtefactCurrency;
  /**
   * TRUE when Batchlabel did not generate the file, which today is every row there is.
   *
   * `batchlabel.artefacts.is_placeholder` defaults TRUE precisely so that a stub which writes
   * a row is marked as a stub without having to remember to. A screen must read this before
   * calling anything produced: what these rows record is that the MAKER printed something and
   * which composition it was printed from, not that this app produced a file.
   */
  isPlaceholder: boolean;
  driftNote?: string;
};

/* --------------------------------------------------------------- record */

/**
 * One line of the append-only log, as a screen needs it.
 *
 * Every field here came from batchlabel.record_events. `recordedAt` is `occurred_at` — when
 * the maker says the thing happened — and not `recorded_at`, which is when we learned of it;
 * a batch written up on Friday must not claim to have been made on Friday, and the same
 * applies to signing a declaration.
 */
export type RecordedEvidence = {
  id: string;
  /** `occurred_at`: when the maker says it happened. */
  recordedAt: string;
  /** A document number, a submission reference, a person's name. Optional by design. */
  reference: string | null;
  summary: string;
};

/**
 * What the account has RECORDED about a product. Not what is true of it.
 *
 * THE DISTINCTION IS THE ENTIRE POINT. Batchlabel does not hold a product information file,
 * has never seen a shop listing and cannot inspect a signed declaration. What it can hold is
 * the maker's own entry in an append-only log saying they did it and when. So every sentence
 * built from this must be about our record — "you have not recorded this" — and never about
 * their business — "no product information file has been assembled".
 */
export type ProductEvidence = {
  /** Keyed by obligation id; see src/lib/regimes.ts. */
  obligations: Record<string, RecordedEvidence>;
  /** Keyed by safety data sheet section number, 1 to 16. */
  sdsSections: Record<number, RecordedEvidence>;
};

export const NO_EVIDENCE: ProductEvidence = { obligations: {}, sdsSections: {} };

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
  /**
   * What the maker has recorded against this product in the append-only log.
   *
   * THIS REPLACED `obligations: Record<string, boolean>`, which was read from the
   * `products.obligations` jsonb column — a column written by nothing. createProduct inserted
   * no key and no screen ever set one, so every obligation evaluated to "outstanding" forever
   * on every product of every account, and fifteen of them said so in the voice of a finding
   * about the maker's business. The column is no longer read; `batchlabel.record_events`,
   * filtered on its typed `obligation_id`, is the source, and it has a write path.
   */
  evidence: ProductEvidence;
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