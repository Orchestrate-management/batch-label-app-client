import { supabase } from './supabase';
import { ARTEFACT_LABELS, CategoryPack, categoryById, categoryForKind } from './categories';
import {
  ARTEFACT_NOT_PRODUCED,
  ARTEFACT_NO_PRINT_DATE,
  ArtefactInstance,
  BomSpec,
  CategoryId,
  Market,
  MixtureSpec,
  PhasedSpec,
  Product,
  RegimeId,
  Spec } from
'./model';

/**
 * Products and specifications, read from and written to Supabase.
 *
 * WHAT THIS FILE USED TO BE. `let runtime: Product[] = PRODUCTS`, a module-level array seeded
 * with six invented products, mutated by createProduct and read through useSyncExternalStore.
 * It reset on reload, and every account saw the same six. The founder's sentence — "when a
 * user signs in for the first time, they are in a virgin account with no products… if they
 * add a product or any other detail then that actually is created" — is a description of
 * exactly the two things that array got wrong.
 *
 * THE CONTRACT IT WRITES AGAINST is the header of
 * supabase/migrations/20260803120000_account_data_schema.sql. Read that; it is the interface.
 * The three things it decides that this file cannot un-decide:
 *
 *   1. EVERYTHING KEYS ON account_id, NEVER user_id. There is not a `user_id` anywhere in
 *      this module and there must never be one. Team support is deferred, not cancelled;
 *      today one member per account means the two columns would hold the same value, and
 *      that is precisely why the right one has to be written now rather than backfilled onto
 *      live customer data later.
 *
 *   2. THE ACCOUNT ID IS SENT WHEN WE KNOW IT, AND OMITTED WHEN WE DO NOT. This file used to
 *      state the opposite as an absolute — "never, not even one it read back from the
 *      entitlement" — which contradicted the schema this file is written against. The
 *      migration header says, of current_account_id(): "NULL when none or ambiguous… Prefer
 *      passing entitlements.account_id explicitly." Both rules agree today, because only
 *      `batchlabel` is seeded in public.brands and every user therefore has exactly one
 *      account; they stop agreeing the day a sibling Orchestrate brand ships and one person
 *      holds an account on each. current_account_id() then refuses to guess and returns NULL
 *      — correctly, it must not file a maker's product in the wrong workspace — and an app
 *      that can only ever omit the column would leave that customer unable to create a
 *      product on EITHER brand, permanently. The database now says which of the two null
 *      cases it is (hint `account_ambiguous`), so at least the screen can stop telling them
 *      to wait; sending the id is what actually lets them work.
 *
 *      Sending it weakens no isolation. The INSERT policy on both tables is
 *      `with check (public.is_member_of(account_id))`, so an id that is not yours is refused
 *      by the database, and `entitlements.account_id` is itself resolved by the database for
 *      THIS deployment's brand (membership.ts filters on BRAND_SLUG) rather than chosen here.
 *      When the entitlement has not resolved one, the column is omitted and the default —
 *      current_account_id() — still decides, exactly as before.
 *
 *      NOTHING IN THIS FILE EVER TAKES AN ACCOUNT ID FROM A FORM, a URL or a props chain that
 *      a screen could influence. It comes from the entitlement read and nowhere else.
 *
 *   3. TWO TABLES, NOT ONE. A specification is the composition (the recipe: fragrance, base,
 *      dye, load — the four inputs every expensive derivation reads); a product is the SKU
 *      (that composition in one pack size and packaging). The UFI belongs to the composition
 *      and there is deliberately no ufi column on products. Only products are metered.
 *
 * WHAT IS NOT PERSISTED, AND IS NOT PRETENDED TO BE. Artefacts and production records have no
 * tables — the migration says so outright — so `artefacts` below is DERIVED from the category
 * pack on every read, and every artefact a real account holds reads "Not yet produced" with
 * no printed date, because none has been produced. Nothing here invents a version number or a
 * print date, and there is no drift, because drift is a difference from a printed artefact
 * and nothing has been printed.
 */

/* ------------------------------------------------------------------ types */

/**
 * Why a write did not happen, in terms a screen can render.
 *
 * Errors are values rather than exceptions, for the same reason billing.ts gives: every one
 * of these is an ordinary state of a form, and a screen that has to try/catch to find out
 * whether the customer is at their plan limit will sooner or later render a stack trace.
 */
export type WriteFailure =
'sku_limit' |
'duplicate_sku' |
'no_account' |
'account_ambiguous' |
'not_configured' |
'partial_save' |
'unknown' |
'failed';

export type WriteResult<T> =
{ok: true;value: T;} |
{ok: false;reason: WriteFailure;message: string;};

export type ReadResult =
{ok: true;products: Product[];} |
{ok: false;message: string;};

export type NewProductInput = {
  name: string;
  sku: string;
  categoryId: CategoryId;
  productType: string;
  /** Optional starting material, when the product was begun from a sheet. */
  fragranceId?: string;
};

/* --------------------------------------------------------- error mapping */

/**
 * The stable token the SKU trigger raises, and the ONLY thing this app matches on.
 *
 * The trigger sets `hint = 'sku_limit_reached'` and says, in a comment beside it, "Match the
 * hint, never the sentence: the sentence is customer-facing copy and will be rewritten." So
 * the sentence is never read here — the app writes its own, from the allowance the billing
 * work already resolves, and a rewording of the database message can never silently turn a
 * limit into a generic failure.
 */
const SKU_LIMIT_HINT = 'sku_limit_reached';

/**
 * The two tokens section 7c of the migration raises, and the reason it exists.
 *
 * THE OBVIOUS BRANCH WAS WRONG, and this file used to carry it. A null account_id does NOT
 * arrive as a not-null violation: PostgreSQL evaluates the RLS WITH CHECK before it checks
 * table constraints, `is_member_of(null)` is false, so the policy refuses the row first and
 * the NOT NULL is never reached. 23502 is UNREACHABLE from a browser on specifications and
 * products, and the sentence this app kept for it had therefore never once been shown. That
 * was measured against a real server, on both branches, and the migration header states it as
 * contract item 5: "Match on the HINT, never on 23502 and never on the sentence."
 *
 * The bare 42501 that RLS produces cannot carry the explanation either — it is the same code
 * a genuine cross-account attempt returns, and it must stay uninformative. So the database
 * answers the question ahead of RLS instead, with a BEFORE INSERT trigger that can still tell
 * the two null cases apart:
 *
 *   account_missing    no active membership. TRANSIENT — it resolves when signup completes,
 *                      which is the ONE place "still being set up" is a true sentence.
 *   account_ambiguous  two or more. PERMANENT until the app sends an account_id. Telling this
 *                      customer to wait is a promise nothing will ever keep.
 */
const ACCOUNT_MISSING_HINT = 'account_missing';
const ACCOUNT_AMBIGUOUS_HINT = 'account_ambiguous';

/** Postgres unique violation: the account already holds a live product with this SKU code. */
const UNIQUE_VIOLATION = '23505';

const GENERIC_WRITE_FAILURE =
'We could not save that just now. Nothing has changed — please try again in a moment.';

/**
 * Said when there is no account yet — hint `account_missing`, and nothing else.
 *
 * This is the only failure in the file where waiting genuinely helps, because the only way to
 * reach it is a signup that has not finished: RequireAuth gates on a session, so somebody who
 * signed in with Google and then closed the tab on the setup step reaches this app in full,
 * with no account behind them. So it says the true thing and points at the step that actually
 * fixes it, rather than at a retry that will keep failing until that step is done.
 */
const NO_ACCOUNT_MESSAGE =
'There is no account to save this into yet — your signup was not finished, so nothing has been ' +
'saved. Finish setting up your account and this will work. If you think it is already set up, ' +
'get in touch and we will sort it out.';

/**
 * Said when the database could not tell WHICH account — hint `account_ambiguous`.
 *
 * Deliberately offers no retry and mentions no waiting. The database has already established
 * that nothing is coming: the row will be refused identically every time until this app sends
 * an explicit account id, and the app cannot pick one, because picking between two of a
 * person's businesses is how a maker's product gets filed in the wrong workspace silently.
 * "Try again in a moment" here is the exact failure section 7c was written to prevent.
 */
const ACCOUNT_AMBIGUOUS_MESSAGE =
'You are a member of more than one account, and this screen cannot yet ask you which one this ' +
'belongs to — so nothing has been saved, and trying again will not change that. Get in touch ' +
'and we will point this workspace at the right account.';

/**
 * Said when we genuinely do not know whether the write landed.
 *
 * The one thing it must not say is "nothing has changed", which is what the generic failure
 * says and what this path used to borrow. A lost response over a committed insert is the whole
 * reason the recovery lookup exists; when the lookup ITSELF cannot answer, the honest report is
 * that the outcome is unknown — and the advice has to be "look before you retry", because a
 * blind retry on a 3-SKU plan spends a second slot on one intended product.
 */
const UNKNOWN_OUTCOME_MESSAGE =
'We lost the connection before the database told us whether that saved, so we do not know ' +
'whether it did. Check your products list before trying again — if it is there, it saved.';

/**
 * Said when half of a two-table save committed and half did not.
 *
 * Never "nothing has changed": something did. It names which half, because the half that
 * saved is the composition — the recipe every derivation reads — and the half that did not is
 * the pack. A maker who walks away from this message and reloads finds a product they never
 * approved, so the message has to be the one that keeps them here for one more click.
 */
const PARTIAL_SAVE_MESSAGE =
'Only part of that saved. The composition was stored; the pack size and packaging were not, so ' +
'this product is now the new recipe in the old pack. Press save again to finish it.';

const DUPLICATE_SKU_MESSAGE =
'You already have a product with that code. Product codes have to be unique, so give this one ' +
'a different code.';

const NOT_CONFIGURED_MESSAGE =
'This app is not connected to its database, so nothing can be saved. This is us, not you.';

/**
 * The limit message itself is NOT produced here.
 *
 * `sku_limit` carries no sentence of its own because the honest one names the allowance, and
 * the allowance is the billing work's to state — see components/SkuLimitNotice.tsx, which
 * reads it from the entitlement the database resolved. A message invented here would be a
 * second copy of a number that has one source.
 */
const SKU_LIMIT_MESSAGE = 'This account is already holding as many products as its plan allows.';

type Postgrestish = {code?: string | null;hint?: string | null;message?: string | null;};

/**
 * Classifies a PostgREST error into something a form can say out loud.
 *
 * HINTS BEFORE CODES, because the hints are the tokens the database raises on purpose for
 * this app to read, and every code that matters here is shared with something else. All three
 * hints arrive on the same P0001, so branching on the code first would collapse the meter, the
 * missing account and the ambiguous account into one indistinguishable failure.
 *
 * There is deliberately no `accountIdSupplied` option any more. It existed to qualify a 23502
 * branch, and that branch was unreachable — see the note on the hints above.
 */
export function classifyWriteError(error: Postgrestish | null)
: {
  reason: WriteFailure;
  message: string;
} {
  const hint = error?.hint ?? '';
  const code = error?.code ?? '';

  if (hint === SKU_LIMIT_HINT) return { reason: 'sku_limit', message: SKU_LIMIT_MESSAGE };
  if (hint === ACCOUNT_MISSING_HINT) return { reason: 'no_account', message: NO_ACCOUNT_MESSAGE };
  if (hint === ACCOUNT_AMBIGUOUS_HINT) {
    return { reason: 'account_ambiguous', message: ACCOUNT_AMBIGUOUS_MESSAGE };
  }
  if (code === UNIQUE_VIOLATION) return { reason: 'duplicate_sku', message: DUPLICATE_SKU_MESSAGE };
  return { reason: 'failed', message: GENERIC_WRITE_FAILURE };
}

/**
 * Errors that mean the database REFUSED this statement, so nothing committed.
 *
 * Used for one decision only: whether it is safe to archive the specification a refused
 * product insert left behind. A transport failure — a dropped socket, a proxy 5xx, an aborted
 * fetch — carries no Postgres code at all, and MUST NOT be treated as a refusal, because the
 * insert it lost the answer to may well have committed.
 *
 * 42501 is here because that is what a row level security WITH CHECK violation arrives as; it
 * is as definite a refusal as a constraint. 23502 stays even though account_id can no longer
 * reach it — on these tables it would now mean a genuinely null non-account column, which is
 * still a refusal.
 *
 * The three raised hints are refusals too. Only the meter's can fire on the product insert
 * today, because both inserts carry the same account object and the specification therefore
 * fails first — but a refusal token that is missing from this list is a specification silently
 * left behind, and the next one added should not have to remember this file.
 */
const DEFINITE_REFUSAL_CODES = ['23502', '23503', '23505', '23514', '42501'];
const DEFINITE_REFUSAL_HINTS = [SKU_LIMIT_HINT, ACCOUNT_MISSING_HINT, ACCOUNT_AMBIGUOUS_HINT];

function isDefiniteRefusal(error: Postgrestish | null): boolean {
  if (!error) return false;
  if (DEFINITE_REFUSAL_HINTS.includes(error.hint ?? '')) return true;
  return DEFINITE_REFUSAL_CODES.includes(error.code ?? '');
}

/* ------------------------------------------------------------ row shapes */

type Json = Record<string, unknown>;

export type SpecificationRow = {
  id: string;
  name: string | null;
  category_id: string | null;
  kind: string | null;
  product_type: string | null;
  fragrance_id: string | null;
  base_id: string | null;
  dye_id: string | null;
  load: number | string | null;
  additive: string | null;
  markets: string[] | null;
  regimes: string[] | null;
  ufi: string | null;
  data: Json | null;
};

export type ProductRow = {
  id: string;
  specification_id: string;
  name: string | null;
  sku: string | null;
  net_quantity: number | string | null;
  net_unit: string | null;
  packaging_id: string | null;
  identifiers: Json | null;
  obligations: Json | null;
  data: Json | null;
  created_at: string | null;
};

const SPECIFICATION_COLUMNS =
'id, name, category_id, kind, product_type, fragrance_id, base_id, dye_id, load, additive, markets, regimes, ufi, data';

const PRODUCT_COLUMNS =
'id, specification_id, name, sku, net_quantity, net_unit, packaging_id, identifiers, obligations, data, created_at';

/* -------------------------------------------------------------- coercion */

/**
 * Every reader below is tolerant, for the same reason membership.ts is: a column this app has
 * never heard of, or one whose type changed, must degrade to a sensible default rather than
 * throw inside a render. A screen that crashes on one malformed row loses the customer every
 * other row as well.
 */

function num(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  // PostgREST serialises `numeric` as a JSON number, but a client or a proxy that stringifies
  // it must not turn a 220 g candle into NaN on a label.
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' && value.trim() !== '' ? value : fallback;
}

function unit(value: unknown, fallback: 'g' | 'ml'): 'g' | 'ml' {
  return value === 'g' || value === 'ml' ? value : fallback;
}

const KNOWN_MARKETS: Market[] = ['GB', 'EU'];
const KNOWN_REGIMES: RegimeId[] = ['clp', 'en15494', 'cpr', 'ce', 'rohs', 'weee', 'gpsr'];

function markets(value: unknown): Market[] {
  const list = Array.isArray(value) ?
  value.filter((entry): entry is Market => KNOWN_MARKETS.includes(entry as Market)) :
  [];
  // The column is NOT NULL DEFAULT '{GB}', so an empty array here means a row written by
  // something else. A product sold nowhere renders no address block at all, which reads as a
  // rendering bug rather than as data; GB is the schema's own default.
  return list.length ? list : ['GB'];
}

function regimes(value: unknown, category: CategoryPack): RegimeId[] {
  const list = Array.isArray(value) ?
  value.filter((entry): entry is RegimeId => KNOWN_REGIMES.includes(entry as RegimeId)) :
  [];
  // Falling back to the category's regimes rather than to none: which rules apply is a fact
  // about what the product IS, and an empty list would tell a maker no regime applies to a
  // candle. The stored value wins whenever there is one.
  return list.length ? list : category.regimes;
}

function obligations(value: unknown): Record<string, boolean> {
  if (!value || typeof value !== 'object') return {};
  const out: Record<string, boolean> = {};
  for (const [key, entry] of Object.entries(value as Json)) {
    if (typeof entry === 'boolean') out[key] = entry;
  }
  return out;
}

function categoryFor(row: SpecificationRow): CategoryPack {
  const stored = str(row.category_id);
  const known = ['home-fragrance', 'cosmetics', 'electronics'].includes(stored);
  if (known) return categoryById(stored as CategoryId);
  // `kind` and `category_id` are separate columns, so a row can carry a category this build
  // does not know while still saying which shape its composition has. Resolving through the
  // kind keeps such a row renderable instead of silently becoming home fragrance.
  const kind = row.kind === 'phased' || row.kind === 'bom' ? row.kind : 'mixture';
  return categoryForKind(kind);
}

/* ------------------------------------------------------------- artefacts */

/**
 * The outputs a product has, derived from its category on every read.
 *
 * NOT STORED, AND NOT INVENTED. There is no artefacts table, so there is no version history
 * and no print date to report. Every artefact therefore says "Not yet produced" with no date,
 * and every one is `current` — a surface that has never been printed cannot be out of date
 * relative to the composition, and telling a maker their label is stale when they have never
 * had one is a false statement about their compliance, not a harmless placeholder.
 */
export function artefactsFor(category: CategoryPack, kind: Spec['kind']): ArtefactInstance[] {
  const surfaces: ArtefactInstance[] = category.artefacts.map((type) => ({
    type,
    label: ARTEFACT_LABELS[type],
    widthMm: type === 'listing' ? 96 : type === 'carton' ? 88 : type === 'rating-plate' ? 40 : 52,
    heightMm: type === 'listing' ? 60 : type === 'carton' ? 58 : type === 'rating-plate' ? 25 : 74,
    version: ARTEFACT_NOT_PRODUCED,
    printedOn: ARTEFACT_NO_PRINT_DATE,
    current: true
  }));

  // The safety data sheet is the second output of the same derivation, so every product that
  // is a mixture carries one alongside its label surfaces. A device is an article rather than
  // a mixture and has no sheet to issue.
  if (kind === 'bom') return surfaces;
  return [
  ...surfaces,
  {
    type: 'sds',
    label: ARTEFACT_LABELS.sds,
    widthMm: 210,
    heightMm: 297,
    version: ARTEFACT_NOT_PRODUCED,
    printedOn: ARTEFACT_NO_PRINT_DATE,
    current: true
  }];

}

/* --------------------------------------------------------------- mapping */

/** The composition, assembled from the specification row and the product's pack fields. */
function toSpec(spec: SpecificationRow, product: ProductRow, category: CategoryPack): Spec {
  const data = (spec.data ?? {}) as Json;
  const productType = str(spec.product_type, category.productTypes[0]);
  const pack = {
    netQuantity: num(product.net_quantity, 0),
    netUnit: unit(product.net_unit, 'ml'),
    packagingId: str(product.packaging_id)
  };

  if (spec.kind === 'phased') {
    const phases = Array.isArray(data.phases) ?
    (data.phases as PhasedSpec['phases']).map((phase) => ({
      name: str(phase?.name, 'Phase'),
      items: Array.isArray(phase?.items) ?
      phase.items.map((item) => ({
        materialId: str(item?.materialId),
        pct: num(item?.pct, 0)
      })) :
      []
    })) :
    [];
    const phased: PhasedSpec = {
      kind: 'phased',
      productType,
      phases,
      application: data.application === 'Rinse-off' ? 'Rinse-off' : 'Leave-on',
      paoMonths: num(data.paoMonths, 12),
      ...pack
    };
    return phased;
  }

  if (spec.kind === 'bom') {
    const ratings = (data.ratings ?? {}) as Json;
    const bom: BomSpec = {
      kind: 'bom',
      productType,
      model: str(data.model, 'Not yet assigned'),
      items: Array.isArray(data.items) ?
      (data.items as BomSpec['items']).map((item) => ({
        materialId: str(item?.materialId),
        quantity: num(item?.quantity, 1),
        position: str(item?.position, 'Unplaced')
      })) :
      [],
      ratings: {
        voltage: str(ratings.voltage, '—'),
        current: str(ratings.current, '—'),
        power: str(ratings.power, '—')
      },
      ...pack
    };
    return bom;
  }

  const mixture: MixtureSpec = {
    kind: 'mixture',
    productType,
    baseId: str(spec.base_id),
    fragranceId: str(spec.fragrance_id),
    load: num(spec.load, 0),
    dyeId: str(spec.dye_id, 'ing-no-dye'),
    additive: str(spec.additive, 'None'),
    ...pack
  };
  return mixture;
}

/** One product row plus its specification row, as the screens expect a Product. */
export function toProduct(product: ProductRow, spec: SpecificationRow): Product {
  const category = categoryFor(spec);
  const composition = toSpec(spec, product, category);
  const identifiers = (product.identifiers ?? {}) as Json;

  return {
    id: product.id,
    specificationId: spec.id,
    name: str(product.name, 'Untitled product'),
    sku: str(product.sku),
    categoryId: category.id,
    markets: markets(spec.markets),
    regimes: regimes(spec.regimes, category),
    spec: composition,
    artefacts: artefactsFor(category, composition.kind),
    identifiers: {
      // The UFI is read from the SPECIFICATION, which is where CLP Annex VIII puts it and
      // where the schema put the column: one composition, one UFI, however many pack sizes.
      // Nothing in Batchlabel generates one, so in practice this is always absent — and
      // `obligationSatisfied` refuses to mark the UFI obligation done whatever is stored.
      ufi: str(spec.ufi) || undefined,
      model: str(identifiers.model) || undefined,
      weeeRegistration: str(identifiers.weee_registration ?? identifiers.weeeRegistration) || undefined,
      modelYear: str(identifiers.model_year ?? identifiers.modelYear) || undefined
    },
    obligations: obligations(product.obligations)
  };
}

/* ------------------------------------------------------------------ read */

/**
 * Every live product in the caller's account.
 *
 * TWO QUERIES, NOT AN EMBEDDED SELECT. PostgREST can embed a related resource, but the
 * foreign key from products to specifications is COMPOSITE — `(specification_id, account_id)`
 * references `(id, account_id)`, which is what makes it impossible to file a product against
 * another account's composition — and relying on embedding over a composite key would put a
 * hard dependency on a detail of PostgREST's relationship detection in the one query the
 * whole app depends on. Two round trips at a maker's volume is nothing; a products screen
 * that returns "could not read" because of a join heuristic is everything.
 *
 * WHAT RLS DOES AND DOES NOT DO, because this comment used to overstate it. Every policy on
 * both tables is `is_member_of(account_id)`, so a select returns rows from every account the
 * caller is a member of. That is not the same as one account, and the migration is explicit
 * that it must be: "those are two accounts and they must not see each other's products"
 * (section 1). With one account per user the two coincide, which is exactly why the gap is
 * easy to ship — a person holding an account on a sibling Orchestrate brand, or invited into
 * a colleague's account when invites land, would otherwise get both accounts' products merged
 * into one list with no column read back to tell them apart.
 *
 * So the account is filtered HERE as well, when we know it. `accountId` comes from the
 * entitlement, which the database resolved for this deployment's brand. Null means we do not
 * know it — the entitlement read has not landed or failed — and then the query is scoped by
 * RLS alone, which is the caller's own data and is what this app has always shown. That is
 * defence in depth over RLS, never a replacement for it: a wrong id here shows too little,
 * never somebody else's.
 *
 * Archived rows are excluded, matching the meter's own definition of live.
 */
export async function fetchProducts(accountId: string | null = null): Promise<ReadResult> {
  const client = supabase;
  if (!client) return { ok: false, message: NOT_CONFIGURED_MESSAGE };

  let productsQuery = client.
  from('products').
  select(PRODUCT_COLUMNS).
  is('archived_at', null);

  let specificationsQuery = client.
  from('specifications').
  select(SPECIFICATION_COLUMNS).
  is('archived_at', null);

  if (accountId) {
    productsQuery = productsQuery.eq('account_id', accountId);
    specificationsQuery = specificationsQuery.eq('account_id', accountId);
  }

  const [productsResponse, specificationsResponse] = await Promise.all([
  productsQuery.order('created_at', { ascending: true }),
  specificationsQuery]
  );

  if (productsResponse.error || specificationsResponse.error) {
    // Deliberately not the Postgres message. A read failure is us, and the screen says so
    // and offers a retry — what it must never do is render as "you have no products", which
    // is indistinguishable from a new account and reads as data loss.
    return {
      ok: false,
      message:
      'We could not read your products just now. This is us, not you — nothing has been lost.'
    };
  }

  const specifications = new Map<string, SpecificationRow>();
  for (const row of (specificationsResponse.data ?? []) as SpecificationRow[]) {
    specifications.set(row.id, row);
  }

  const products: Product[] = [];
  for (const row of (productsResponse.data ?? []) as ProductRow[]) {
    const spec = specifications.get(row.specification_id);
    // A product whose specification did not come back is a product we cannot describe: no
    // composition, so no classification, no label and no sheet. Dropping it silently would
    // be wrong, but so would rendering a blank row, and the composite foreign key means the
    // only way to reach this is a specification archived out from under a live product.
    if (spec) products.push(toProduct(row, spec));
  }

  return { ok: true, products };
}

/* ----------------------------------------------------------------- write */

/** The composition a brand new product starts from: enough to be legal to store, no more. */
export function blankSpec(
category: CategoryPack,
productType: string,
fragranceId?: string)
: Spec {
  if (category.specKind === 'mixture') {
    return {
      kind: 'mixture',
      productType,
      baseId:
      productType === 'Reed diffuser' ?
      'ing-dpg' :
      productType === 'Room spray' ?
      'ing-alcohol' :
      'ing-crw45',
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

/** The shape-varying half of a composition, which is what `specifications.data` is for. */
function specData(spec: Spec): Json {
  if (spec.kind === 'phased') {
    return { phases: spec.phases, application: spec.application, paoMonths: spec.paoMonths };
  }
  if (spec.kind === 'bom') {
    return { model: spec.model, items: spec.items, ratings: spec.ratings };
  }
  return {};
}

/** The typed half. The four classification inputs get columns; everything else does not. */
function specColumns(spec: Spec) {
  return {
    product_type: spec.productType,
    fragrance_id: spec.kind === 'mixture' ? spec.fragranceId || null : null,
    base_id: spec.kind === 'mixture' ? spec.baseId || null : null,
    dye_id: spec.kind === 'mixture' ? spec.dyeId || null : null,
    load: spec.kind === 'mixture' ? spec.load : null,
    data: specData(spec)
  };
}

/** The pack. This is the entire difference between two products of one specification. */
function packColumns(spec: Spec) {
  return {
    net_quantity: spec.netQuantity > 0 ? spec.netQuantity : null,
    net_unit: spec.netUnit,
    packaging_id: spec.packagingId || null
  };
}

/**
 * Creates a product, and its composition, in the caller's account.
 *
 * `accountId` is the entitlement's, or null when the entitlement has not resolved one. See
 * rule 2 at the top of this file: supplied it is checked by the INSERT policy, omitted it is
 * decided by the column default. Nothing else may be passed here.
 *
 * TWO INSERTS, IN THIS ORDER, AND WHAT HAPPENS WHEN THE SECOND FAILS. A product cannot be
 * inserted before its specification, because it carries the foreign key. So a refused product
 * — most often the SKU meter refusing one over the plan allowance — leaves a specification
 * behind. The browser is granted no DELETE on specifications (deleting one cascades to its
 * products, which is not something a mis-click may do), so the row is ARCHIVED instead.
 *
 * BUT ONLY WHEN THE DATABASE ACTUALLY REFUSED IT. This used to archive on ANY failure of the
 * product insert, which included the one case where the product had been created: a timeout
 * or a proxy 5xx that loses the response after the row has committed. supabase-js hands those
 * back as an error with no Postgres code, so the old code archived the specification of a LIVE
 * product. The product then counted against sku_limit in the trigger and in the view's
 * sku_count, while `fetchProducts` dropped it for having no specification — invisible on every
 * screen, un-editable, un-deletable (no DELETE grant, no un-archive path), and on the 3-SKU
 * free plan a third of the allowance gone to one dropped response.
 *
 * So the failure path now ASKS. A product carrying this specification means the insert won and
 * the response was merely lost, and that product is returned as the success it is. Otherwise
 * the specification is archived only on a definite refusal — a Postgres code or the meter's
 * hint — and on anything else it is left alone: an orphaned composition is invisible, meters
 * nothing (only products are metered) and can be reclaimed, whereas an archived specification
 * under a live product cannot.
 *
 * AND IT SAYS SO. Declining to archive is an admission that the outcome is unknown, and the
 * sentence returned to the maker has to be the same admission. It used to be the generic
 * "Nothing has changed — please try again in a moment", which is a claim, and the wrong one:
 * a blind retry with the same code collides with the unique index and tells them somebody
 * already has it, while a retry with a new code leaves them holding two products and two SKU
 * slots for one intended product. So the unknown outcome gets its own reason and its own copy:
 * check the list first.
 */
export async function createProduct(
input: NewProductInput,
accountId: string | null = null)
: Promise<WriteResult<Product>> {
  const client = supabase;
  if (!client) return { ok: false, reason: 'not_configured', message: NOT_CONFIGURED_MESSAGE };

  const category = categoryById(input.categoryId);
  const spec = blankSpec(category, input.productType, input.fragranceId);
  const name = input.name.trim();
  const sku = input.sku.trim();
  const account = accountId ? { account_id: accountId } : {};

  const { data: specRow, error: specError } = await client.
  from('specifications').
  insert({
    ...account,
    name,
    category_id: category.id,
    kind: category.specKind,
    markets: ['GB'],
    regimes: category.regimes,
    ...specColumns(spec)
  }).
  select(SPECIFICATION_COLUMNS).
  single();

  if (specError || !specRow) return { ok: false, ...classifyWriteError(specError) };

  const specificationId = (specRow as SpecificationRow).id;

  const { data: productRow, error: productError } = await client.
  from('products').
  insert({
    ...account,
    specification_id: specificationId,
    name,
    sku: sku || null,
    ...packColumns(spec)
  }).
  select(PRODUCT_COLUMNS).
  single();

  if (productError || !productRow) {
    // Did it land anyway? Only the database can answer that, and the answer decides whether
    // the specification below us is an orphan or the composition of a live product.
    const { data: existing, error: lookupError } = await client.
    from('products').
    select(PRODUCT_COLUMNS).
    eq('specification_id', specificationId).
    is('archived_at', null).
    limit(1).
    maybeSingle();

    if (!lookupError && existing) {
      return { ok: true, value: toProduct(existing as ProductRow, specRow as SpecificationRow) };
    }

    const refused = isDefiniteRefusal(productError);

    // Archive only what the database told us it would not accept. A lookup that itself failed
    // proves nothing either way, so it leaves the row alone as well.
    if (refused && !lookupError) {
      await client.
      from('specifications').
      update({ archived_at: new Date().toISOString() }).
      eq('id', specificationId);
    }

    // A refusal is a known outcome: the database said no, so nothing committed and the reason
    // is worth stating. Everything else here is NOT known, and must not borrow the generic
    // failure's "nothing has changed".
    //
    // Two ways to land in the unknown case, and they are the same admission. The lookup itself
    // failed, so the question "did the product land?" was asked and not answered. Or the
    // product insert carried no Postgres code at all — a dropped socket, a proxy 5xx, an
    // aborted fetch — and the lookup found nothing, which rules out an insert that had already
    // committed but not one still in flight on a request this browser stopped waiting for.
    if (refused) return { ok: false, ...classifyWriteError(productError) };

    return { ok: false, reason: 'unknown', message: UNKNOWN_OUTCOME_MESSAGE };
  }

  return {
    ok: true,
    value: toProduct(productRow as ProductRow, specRow as SpecificationRow)
  };
}

/**
 * Saves an edited composition: the specification's own fields, and the pack fields that live
 * on the product.
 *
 * Two updates, because the edit spans the two tables the split created — the recipe is the
 * specification's, the net quantity and the packaging are the SKU's. Both are scoped by RLS
 * rather than by an account filter written here, and neither may reach a row this caller does
 * not own: `using` decides which rows may be updated and `with check` decides what they may
 * become, so there is no way to move a row into somebody else's account either.
 *
 * NO SKU METER RUNS HERE, and that is a property of the schema rather than of this call. The
 * enforcement trigger fires on INSERT and on un-archiving, and on nothing else, precisely so
 * that editing, re-deriving and exporting an existing SKU can never be blocked by a limit —
 * a maker over their allowance after a downgrade must still be able to correct a label for
 * stock already on a shelf.
 *
 * THE PAIR IS NOT ATOMIC, AND THE SECOND FAILURE IS NOT A NO-OP. Two round trips, no
 * transaction: PostgREST has no way to span them, and one SECURITY INVOKER RPC that took both
 * halves is the real fix. Until it exists, the failure that matters is the first update
 * committing and the second not — the recipe stored against the old pack, which is a
 * combination the maker never approved and which drives both the label and the sheet. Saying
 * "nothing has changed" there is false, and it is false in the direction that makes somebody
 * stop and walk away. So that case gets its own reason: it says which half landed, it asks for
 * one more press, and the screen reloads on it so what is on the page is what is stored.
 */
export async function saveComposition(
product: Product,
spec: Spec)
: Promise<WriteResult<void>> {
  const client = supabase;
  if (!client) return { ok: false, reason: 'not_configured', message: NOT_CONFIGURED_MESSAGE };
  if (!product.specificationId) {
    return { ok: false, reason: 'failed', message: GENERIC_WRITE_FAILURE };
  }

  const { error: specError } = await client.
  from('specifications').
  update(specColumns(spec)).
  eq('id', product.specificationId);

  if (specError) return { ok: false, ...classifyWriteError(specError) };

  const { error: productError } = await client.
  from('products').
  update(packColumns(spec)).
  eq('id', product.id);

  // The specification update above committed. Whatever this one says, half of the edit is
  // stored, so none of the "nothing has changed" copy is available to us here.
  if (productError) return { ok: false, reason: 'partial_save', message: PARTIAL_SAVE_MESSAGE };

  return { ok: true, value: undefined };
}
