import { NOT_CONFIGURED_MESSAGE, domainClient } from './domain';
import {
  Allergen,
  CategoryId,
  DocumentKind,
  HazardAt100,
  IfraLimit,
  IngredientMaterial,
  Material,
  MaterialClass,
  MaterialProvenance,
  PackagingMaterial,
  SupplierDocument } from
'./model';

/**
 * MATERIALS, READ FROM AND WRITTEN TO SUPABASE.
 *
 * The register is a HYBRID and the rule between the two halves is the whole design:
 *
 *   THE MAKER'S OWN ROW WINS. Unconditionally. Not "unless ours is newer", not a merge of
 *   the two. The reasons are in the migration header
 *   (supabase/migrations/20260804130000_materials_records_identity.sql, in the www repo) and
 *   they are worth repeating on the screen, which `Materials.tsx` does: the safety data sheet
 *   for the drum in their workshop is the document a regulator will ask them for, ours is a
 *   guess about a supplier we never contacted, and every conditional variant of the rule
 *   reintroduces the failure the rule exists to prevent — a classification changing under a
 *   maker without them doing anything.
 *
 *   AND WE CANNOT MOVE A SHARED ROW UNDER THEM ANYWAY. `reference_material_versions` refuses
 *   UPDATE and DELETE from every role, including service_role and the table owner, with no
 *   auth.uid() escape. A correction is a NEW VERSION. That is not a policy this file has to
 *   uphold; it is a trigger, and this file could not violate it if it tried.
 *
 * PRECEDENCE IS NOT RE-IMPLEMENTED HERE. `batchlabel.resolved_materials` is the view that
 * applies it, and this module reads that view rather than fetching both halves and merging
 * them in the browser. Two implementations of "which one wins" is how the app and a future
 * server route come to different answers about what is on somebody's label.
 *
 * THE CATALOGUE SHIPS EMPTY, and that is deliberate rather than unfinished.
 * `src/lib/catalog.ts` held fourteen invented ingredients and seven invented packs, and their
 * hazard classifications, specific concentration limits and allergen percentages were
 * rendered as fact on labels and safety data sheets. Nothing is seeded in its place: a
 * reference row requires a `provenance`, two of the three values require a named document,
 * and the third — 'illustrative-example' — must be labelled as an example wherever it renders.
 *
 * WHY EVERY WRITE HERE IS ONE ROW. There is no transaction across PostgREST calls, and this
 * repository has already paid for that once (see createProduct's long note on the
 * specification it can orphan). So the screens are built so that no control ever needs two
 * inserts: adding a material writes the material, adding a hazard writes one hazard, and each
 * of them either lands or does not. A form that collected a material and its six hazards and
 * then half-saved would leave a material carrying an incomplete classification — which reads
 * exactly like a complete one.
 */

/* --------------------------------------------------------- failure shapes */

export type MaterialWriteFailure =
'not_configured' |
'no_account' |
'account_ambiguous' |
'duplicate' |
'refused' |
'constraint' |
'reached_nothing' |
'failed';

export type MaterialWriteResult<T> =
{ok: true;value: T;} |
{ok: false;reason: MaterialWriteFailure;message: string;};

export type MaterialsReadResult =
{ok: true;materials: Material[];} |
{ok: false;message: string;};

/*
 * The domain-scoped client and the not-connected sentence both come from lib/domain.ts.
 * Identity, consent and billing stay in `public`; every domain table lives in `batchlabel`.
 * PostgREST serves only the schemas listed in `[api] schemas` in supabase/config.toml, so a
 * 404 from any read below is that list before it is anything else.
 */

const READ_FAILED_MESSAGE =
'We could not read your materials just now. This is us, not you — nothing has been lost, and ' +
'nothing of yours has been changed.';

const NO_ACCOUNT_READ_MESSAGE =
'We could not tell which account this workspace belongs to, so it is showing no materials ' +
'rather than the wrong account\'s. Nothing has been lost.';

const NO_ACCOUNT_MESSAGE =
'There is no account to save this into yet — your signup was not finished, so nothing has ' +
'been saved. Finish setting up your account and this will work.';

const ACCOUNT_AMBIGUOUS_MESSAGE =
'You are a member of more than one account, and this screen cannot yet ask you which one this ' +
'belongs to — so nothing has been saved, and trying again will not change that. Get in touch ' +
'and we will point this workspace at the right account.';

const POLICY_REFUSAL_MESSAGE =
'That was refused, so nothing has been saved and nothing has changed. Waiting will not clear ' +
'it and trying again will not either — get in touch and we will tell you why and put it right.';

const GENERIC_WRITE_FAILURE =
'We could not save that just now. Nothing has changed — please try again in a moment.';

/**
 * Said when an UPDATE or DELETE ran, raised nothing, and reached no row.
 *
 * The same trap products.ts documents at length: a statement excluded by an RLS `using`
 * clause matches nothing and reports success. Every write below asks for the row back and
 * reads an empty result as the refusal it is, rather than telling somebody their edit saved.
 */
const REACHED_NOTHING_MESSAGE =
'Nothing was saved. This is no longer a material this account can change, so the edit did not ' +
'reach it — nothing has been altered, and trying again will not help.';

const ACCOUNT_MISSING_HINT = 'account_missing';
const ACCOUNT_AMBIGUOUS_HINT = 'account_ambiguous';
const UNIQUE_VIOLATION = '23505';
const CHECK_VIOLATION = '23514';
const NOT_NULL_VIOLATION = '23502';
const POLICY_REFUSAL = '42501';

type Postgrestish = {code?: string | null;hint?: string | null;message?: string | null;};

/**
 * Turns a PostgREST error into a sentence a form can say.
 *
 * DUPLICATES ARE NAMED RATHER THAN GENERALISED, because there are three unique constraints a
 * maker can actually hit here and they mean different things: two materials with one short
 * code, two hazard rows with one H-code on one material, and two live overrides of the same
 * reference material. The last is the one that would make "which wins" a question again, and
 * `materials_account_override_uidx` is what stops it; the message says so rather than
 * offering a retry that will fail identically.
 */
export function classifyMaterialError(
error: Postgrestish | null,
context: 'material' | 'hazard' | 'allergen' | 'ifra' | 'document' | 'override' = 'material')
: {reason: MaterialWriteFailure;message: string;} {
  const hint = error?.hint ?? '';
  const code = error?.code ?? '';

  if (hint === ACCOUNT_MISSING_HINT) return { reason: 'no_account', message: NO_ACCOUNT_MESSAGE };
  if (hint === ACCOUNT_AMBIGUOUS_HINT) {
    return { reason: 'account_ambiguous', message: ACCOUNT_AMBIGUOUS_MESSAGE };
  }
  if (code === UNIQUE_VIOLATION) {
    return {
      reason: 'duplicate',
      message:
      context === 'hazard' ?
      'That hazard code is already on this material. Remove the existing one first if the ' +
      'statement or the limits have changed.' :
      context === 'allergen' ?
      'That allergen is already listed on this material.' :
      context === 'ifra' ?
      'That IFRA category is already listed on this material.' :
      context === 'override' ?
      'You already hold your own version of this material, so nothing has been added. Open ' +
      'yours and edit it instead.' :
      'You already have a material with that short code. Give this one a different code, or ' +
      'leave the code blank.'
    };
  }
  if (code === CHECK_VIOLATION || code === NOT_NULL_VIOLATION) {
    return {
      reason: 'constraint',
      message:
      'The database refused that, so nothing has been saved. A name cannot be blank, a ' +
      'percentage has to be above 0 and at or below 100, and capacity and label area belong ' +
      'to packaging rather than to an ingredient.'
    };
  }
  if (code === POLICY_REFUSAL) return { reason: 'refused', message: POLICY_REFUSAL_MESSAGE };
  return { reason: 'failed', message: GENERIC_WRITE_FAILURE };
}

/* ------------------------------------------------------------ row shapes */

type Json = Record<string, unknown>;

export type ResolvedMaterialRow = {
  account_id: string | null;
  source: string | null;
  material_id: string | null;
  reference_material_id: string | null;
  reference_version_id: string | null;
  reference_version: number | null;
  provenance: string | null;
  slug: string | null;
  material_class: string | null;
  name: string | null;
  supplier: string | null;
  supplier_code: string | null;
  role: string | null;
  categories: string[] | null;
  overrides_reference: boolean | null;
};

export type MaterialRow = {
  id: string;
  account_id: string | null;
  slug: string | null;
  material_class: string | null;
  name: string | null;
  supplier: string | null;
  supplier_code: string | null;
  role: string | null;
  categories: string[] | null;
  inci: string | null;
  inci_function: string | null;
  cas: string | null;
  format: string | null;
  capacity_ml: number | string | null;
  label_area_width_mm: number | string | null;
  label_area_height_mm: number | string | null;
  food_contact: boolean | null;
  child_resistant: boolean | null;
  overrides_reference_id: string | null;
  notes: string | null;
  archived_at: string | null;
  created_at: string | null;
  updated_at: string | null;
};

export type MaterialHazardRow = {
  id: string;
  material_id: string;
  code: string | null;
  statement: string | null;
  hazard_class: string | null;
  gcl: number | string | null;
  scl: number | string | null;
  pictogram: string | null;
  signal: string | null;
  derivation: string | null;
};

export type MaterialAllergenRow = {
  id: string;
  material_id: string;
  name: string | null;
  pct: number | string | null;
};

export type MaterialIfraRow = {
  id: string;
  material_id: string;
  category: string | null;
  description: string | null;
  max_pct: number | string | null;
};

export type MaterialDocumentRow = {
  id: string;
  material_id: string;
  document_kind: string | null;
  reference: string | null;
  version: string | null;
  document_date: string | null;
  expires_at: string | null;
  received_at: string | null;
  storage_path: string | null;
  file_name: string | null;
  notes: string | null;
};

export type ReferenceVersionRow = {
  id: string;
  reference_material_id: string;
  version: number | null;
  provenance: string | null;
  document_kind: string | null;
  document_reference: string | null;
  document_version: string | null;
  document_date: string | null;
  document_expires: string | null;
  payload: Json | null;
  notes: string | null;
};

const RESOLVED_COLUMNS =
'account_id, source, material_id, reference_material_id, reference_version_id, reference_version, provenance, slug, material_class, name, supplier, supplier_code, role, categories, overrides_reference';

const MATERIAL_COLUMNS =
'id, account_id, slug, material_class, name, supplier, supplier_code, role, categories, inci, inci_function, cas, format, capacity_ml, label_area_width_mm, label_area_height_mm, food_contact, child_resistant, overrides_reference_id, notes, archived_at, created_at, updated_at';

const HAZARD_COLUMNS =
'id, material_id, code, statement, hazard_class, gcl, scl, pictogram, signal, derivation';
const ALLERGEN_COLUMNS = 'id, material_id, name, pct';
const IFRA_COLUMNS = 'id, material_id, category, description, max_pct';
const DOCUMENT_COLUMNS =
'id, material_id, document_kind, reference, version, document_date, expires_at, received_at, storage_path, file_name, notes';
const REFERENCE_VERSION_COLUMNS =
'id, reference_material_id, version, provenance, document_kind, document_reference, document_version, document_date, document_expires, payload, notes';

/* -------------------------------------------------------------- coercion */

/**
 * Tolerant readers, for the same reason products.ts gives: a column this build has not heard
 * of, or one whose type moved, degrades to a sensible absence rather than throwing inside a
 * render. `numOrUndefined` returns undefined rather than 0 — a zero capacity or a zero
 * concentration limit is a number, and a number is a claim.
 */
function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

function numOrUndefined(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

const KNOWN_CATEGORIES: CategoryId[] = ['home-fragrance', 'cosmetics', 'electronics'];

function categories(value: unknown): CategoryId[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is CategoryId =>
  KNOWN_CATEGORIES.includes(entry as CategoryId)
  );
}

function materialClass(value: unknown): MaterialClass {
  return value === 'packaging' ? 'packaging' : 'ingredient';
}

const KNOWN_PICTOGRAMS = ['GHS07', 'GHS09', 'GHS02'] as const;

function pictogram(value: unknown): HazardAt100['pictogram'] {
  return KNOWN_PICTOGRAMS.includes(value as (typeof KNOWN_PICTOGRAMS)[number]) ?
  value as HazardAt100['pictogram'] :
  undefined;
}

function signal(value: unknown): HazardAt100['signal'] {
  return value === 'Warning' || value === 'Danger' ? value : undefined;
}

export const DOCUMENT_KINDS: DocumentKind[] = [
'Safety data sheet',
'INCI and allergen certificate',
'Technical drawing'];


function provenance(value: unknown): MaterialProvenance | undefined {
  return value === 'supplier-document' ||
  value === 'regulatory-source' ||
  value === 'illustrative-example' ?
  value :
  undefined;
}

/* --------------------------------------------------------------- mapping */

function hazardFromRow(row: MaterialHazardRow): HazardAt100 | null {
  const code = str(row.code);
  const statement = str(row.statement);
  const hazardClass = str(row.hazard_class);
  // A hazard row is NOT NULL on all three in the database, so a row missing one came from
  // somewhere else. Dropping it beats rendering a blank statement beside an H-code.
  if (!code || !statement || !hazardClass) return null;
  return {
    rowId: row.id || undefined,
    code,
    statement,
    hazardClass,
    gcl: numOrUndefined(row.gcl),
    scl: numOrUndefined(row.scl),
    pictogram: pictogram(row.pictogram),
    signal: signal(row.signal),
    derivation: str(row.derivation)
  };
}

function allergenFromRow(row: MaterialAllergenRow): Allergen | null {
  const name = str(row.name);
  const pct = numOrUndefined(row.pct);
  if (!name || pct == null) return null;
  return { rowId: row.id || undefined, name, pct };
}

function ifraFromRow(row: MaterialIfraRow): IfraLimit | null {
  const category = str(row.category);
  const max = numOrUndefined(row.max_pct);
  if (!category || max == null) return null;
  return { rowId: row.id || undefined, category, description: str(row.description) ?? '', max };
}

/**
 * The document a material's figures were read from, from the rows this account holds.
 *
 * NEWEST BY document_date, and undefined when the account holds none. `storage_path` null
 * means the maker typed the reference and no file is held, which travels separately as
 * `documentFileHeld` — the materials screen renders those as two different sentences,
 * because "we hold your safety data sheet" and "you told us its number" are two different
 * claims and only one of them is ever true today.
 */
function documentFromRows(rows: MaterialDocumentRow[]): {
  document?: SupplierDocument;
  fileHeld: boolean;
} {
  if (!rows.length) return { fileHeld: false };
  const sorted = [...rows].sort((a, b) =>
  (b.document_date ?? b.received_at ?? '').localeCompare(a.document_date ?? a.received_at ?? '')
  );
  const row = sorted[0];
  const kind = str(row.document_kind);
  if (!kind) return { fileHeld: Boolean(str(row.storage_path)) };
  return {
    document: {
      kind: kind as DocumentKind,
      reference: str(row.reference) ?? '',
      version: str(row.version) ?? '',
      date: str(row.document_date) ?? '',
      expires: str(row.expires_at)
    },
    fileHeld: Boolean(str(row.storage_path))
  };
}

type Children = {
  hazards: Map<string, HazardAt100[]>;
  allergens: Map<string, Allergen[]>;
  ifra: Map<string, IfraLimit[]>;
  documents: Map<string, MaterialDocumentRow[]>;
};

function accountMaterialFromRow(row: MaterialRow, children: Children): Material {
  const documents = documentFromRows(children.documents.get(row.id) ?? []);

  const base = {
    id: row.id,
    source: 'account' as const,
    overridesReferenceId: str(row.overrides_reference_id),
    slug: str(row.slug),
    name: str(row.name) ?? 'Untitled material',
    supplier: str(row.supplier),
    supplierCode: str(row.supplier_code),
    categories: categories(row.categories),
    notes: str(row.notes),
    editable: true,
    document: documents.document,
    documentFileHeld: documents.fileHeld
  };

  if (materialClass(row.material_class) === 'packaging') {
    const width = numOrUndefined(row.label_area_width_mm);
    const height = numOrUndefined(row.label_area_height_mm);
    const packaging: PackagingMaterial = {
      ...base,
      class: 'packaging',
      format: str(row.format),
      capacityMl: numOrUndefined(row.capacity_ml),
      // Both or neither. Half a printable area cannot be checked against an artefact, and a
      // rule that reports "ok" from one dimension is worse than one that reports nothing.
      labelAreaMm: width != null && height != null ? { width, height } : undefined,
      foodContact: row.food_contact ?? undefined,
      childResistant: row.child_resistant ?? undefined
    };
    return packaging;
  }

  const ingredient: IngredientMaterial = {
    ...base,
    class: 'ingredient',
    role: str(row.role) ?? 'Other',
    inci: str(row.inci),
    inciFunction: str(row.inci_function),
    cas: str(row.cas),
    hazards: children.hazards.get(row.id) ?? [],
    allergens: children.allergens.get(row.id) ?? [],
    ifra: children.ifra.get(row.id) ?? []
  };
  return ingredient;
}

/**
 * A reference material, from the view row and the immutable version its figures live in.
 *
 * KEYED ON THE SLUG rather than on the reference material's uuid. A specification stores one
 * string per composition slot, and the slug is the id the app has always used
 * ('ing-crw45') — so a specification written before this change still resolves, and one
 * written after it stays readable if the row is ever re-imported with a new uuid.
 *
 * A REFERENCE ROW WITH NO PUBLISHED VERSION CARRIES NO CLASSIFICATION AT ALL, and is returned
 * that way rather than skipped: the catalogue can say "we list this material and have not
 * published its figures yet", and that is a true sentence. What it must never do is render as
 * a material with an empty hazard list, which reads as "not classified as hazardous".
 */
function referenceMaterialFromRow(
row: ResolvedMaterialRow,
version: ReferenceVersionRow | undefined)
: Material {
  const payload = (version?.payload ?? {}) as Json;
  const documentKind = str(version?.document_kind);
  const base = {
    id: str(row.slug) ?? str(row.reference_material_id) ?? '',
    source: 'reference' as const,
    referenceMaterialId: str(row.reference_material_id),
    provenance: provenance(version?.provenance ?? row.provenance),
    referenceVersionId: str(row.reference_version_id),
    referenceVersion: row.reference_version ?? undefined,
    slug: str(row.slug),
    name: str(row.name) ?? 'Untitled material',
    supplier: str(row.supplier),
    supplierCode: str(row.supplier_code),
    categories: categories(row.categories),
    notes: str(version?.notes),
    editable: false,
    document: documentKind ?
    {
      kind: documentKind as DocumentKind,
      reference: str(version?.document_reference) ?? '',
      version: str(version?.document_version) ?? '',
      date: str(version?.document_date) ?? '',
      expires: str(version?.document_expires)
    } :
    undefined,
    // Never. A reference document is one WE read, not one this account holds — the whole
    // distinction sections 3 and 16 of the safety data sheet turn on.
    documentFileHeld: false
  };

  if (materialClass(row.material_class) === 'packaging') {
    const width = numOrUndefined((payload.labelAreaMm as Json | undefined)?.width);
    const height = numOrUndefined((payload.labelAreaMm as Json | undefined)?.height);
    const packaging: PackagingMaterial = {
      ...base,
      class: 'packaging',
      format: str(payload.format),
      capacityMl: numOrUndefined(payload.capacityMl),
      labelAreaMm: width != null && height != null ? { width, height } : undefined,
      foodContact: typeof payload.foodContact === 'boolean' ? payload.foodContact : undefined,
      childResistant:
      typeof payload.childResistant === 'boolean' ? payload.childResistant : undefined
    };
    return packaging;
  }

  const hazards = Array.isArray(payload.hazards) ?
  (payload.hazards as Json[]).
  map((entry) =>
  hazardFromRow({
    id: '',
    material_id: '',
    code: (entry.code ?? null) as string | null,
    statement: (entry.statement ?? null) as string | null,
    hazard_class: (entry.hazardClass ?? entry.hazard_class ?? null) as string | null,
    gcl: (entry.gcl ?? null) as number | null,
    scl: (entry.scl ?? null) as number | null,
    pictogram: (entry.pictogram ?? null) as string | null,
    signal: (entry.signal ?? null) as string | null,
    derivation: (entry.derivation ?? null) as string | null
  })
  ).
  filter((hazard): hazard is HazardAt100 => hazard !== null) :
  [];

  const allergens = Array.isArray(payload.allergens) ?
  (payload.allergens as Json[]).
  map((entry) => ({
    name: str(entry.name) ?? '',
    pct: numOrUndefined(entry.pct) ?? 0
  })).
  filter((allergen) => allergen.name !== '' && allergen.pct > 0) :
  [];

  const ifra = Array.isArray(payload.ifra) ?
  (payload.ifra as Json[]).
  map((entry) => ({
    category: str(entry.category) ?? '',
    description: str(entry.description) ?? '',
    max: numOrUndefined(entry.max ?? entry.max_pct) ?? 0
  })).
  filter((limit) => limit.category !== '' && limit.max > 0) :
  [];

  const ingredient: IngredientMaterial = {
    ...base,
    class: 'ingredient',
    role: str(row.role) ?? 'Other',
    inci: str(payload.inci),
    inciFunction: str(payload.inciFunction),
    cas: str(payload.cas),
    hazards,
    allergens,
    ifra
  };
  return ingredient;
}

/* ------------------------------------------------------------------ read */

/**
 * Every material this account can use: its own, plus ours where it has not replaced one.
 *
 * SIX READS, NOT ONE EMBEDDED SELECT, and the reason is the one products.ts gives for its
 * two: every child table hangs off materials by a COMPOSITE (material_id, account_id) foreign
 * key — the device that makes a cross-account child a storage error rather than a policy
 * question — and relying on PostgREST's relationship detection over a composite key would put
 * the whole register behind a join heuristic. Five of the six are fired in parallel and the
 * sixth only when the reference catalogue actually returned something, which today it never
 * does.
 *
 * A NULL ACCOUNT ID MEANS DO NOT READ. Item 6 of the account_id contract, and the same
 * refusal fetchProducts makes: dropping the predicate does not narrow the query, it widens it
 * to everything RLS allows, which for somebody holding a sibling-brand account is that other
 * workspace's rows rendered under this brand's heading.
 */
export async function fetchMaterials(accountId: string | null): Promise<MaterialsReadResult> {
  const client = domainClient();
  if (!client) return { ok: false, message: NOT_CONFIGURED_MESSAGE };
  if (!accountId) return { ok: false, message: NO_ACCOUNT_READ_MESSAGE };

  const [resolved, own, hazards, allergens, ifra, documents] = await Promise.all([
  client.
  from('resolved_materials').
  select(RESOLVED_COLUMNS).
  eq('account_id', accountId).
  order('name', { ascending: true }),
  client.
  from('materials').
  select(MATERIAL_COLUMNS).
  eq('account_id', accountId).
  is('archived_at', null),
  client.from('material_hazards').select(HAZARD_COLUMNS).eq('account_id', accountId),
  client.from('material_allergens').select(ALLERGEN_COLUMNS).eq('account_id', accountId),
  client.from('material_ifra_limits').select(IFRA_COLUMNS).eq('account_id', accountId),
  client.from('material_documents').select(DOCUMENT_COLUMNS).eq('account_id', accountId)]
  );

  // ANY failure fails the whole read. A register missing its hazard rows is not a partial
  // answer — it is a set of materials that all read "not classified as hazardous", which is
  // the most dangerous sentence this screen can produce.
  if (
  resolved.error ||
  own.error ||
  hazards.error ||
  allergens.error ||
  ifra.error ||
  documents.error)
  {
    return { ok: false, message: READ_FAILED_MESSAGE };
  }

  const children: Children = {
    hazards: new Map(),
    allergens: new Map(),
    ifra: new Map(),
    documents: new Map()
  };

  for (const row of (hazards.data ?? []) as MaterialHazardRow[]) {
    const hazard = hazardFromRow(row);
    if (!hazard) continue;
    const list = children.hazards.get(row.material_id) ?? [];
    list.push(hazard);
    children.hazards.set(row.material_id, list);
  }
  for (const row of (allergens.data ?? []) as MaterialAllergenRow[]) {
    const allergen = allergenFromRow(row);
    if (!allergen) continue;
    const list = children.allergens.get(row.material_id) ?? [];
    list.push(allergen);
    children.allergens.set(row.material_id, list);
  }
  for (const row of (ifra.data ?? []) as MaterialIfraRow[]) {
    const limit = ifraFromRow(row);
    if (!limit) continue;
    const list = children.ifra.get(row.material_id) ?? [];
    list.push(limit);
    children.ifra.set(row.material_id, list);
  }
  for (const row of (documents.data ?? []) as MaterialDocumentRow[]) {
    const list = children.documents.get(row.material_id) ?? [];
    list.push(row);
    children.documents.set(row.material_id, list);
  }
  for (const list of children.allergens.values()) list.sort((a, b) => b.pct - a.pct);
  for (const list of children.hazards.values()) list.sort((a, b) => a.code.localeCompare(b.code));

  const ownRows = new Map(
    ((own.data ?? []) as MaterialRow[]).map((row) => [row.id, row])
  );

  const resolvedRows = (resolved.data ?? []) as ResolvedMaterialRow[];
  const referenceVersionIds = resolvedRows.
  filter((row) => row.source === 'reference' && row.reference_version_id).
  map((row) => row.reference_version_id as string);

  let versions = new Map<string, ReferenceVersionRow>();
  if (referenceVersionIds.length) {
    const published = await client.
    from('reference_material_versions').
    select(REFERENCE_VERSION_COLUMNS).
    in('id', referenceVersionIds);
    if (published.error) return { ok: false, message: READ_FAILED_MESSAGE };
    versions = new Map(
      ((published.data ?? []) as ReferenceVersionRow[]).map((row) => [row.id, row])
    );
  }

  const materials: Material[] = [];
  for (const row of resolvedRows) {
    if (row.source === 'account') {
      const full = row.material_id ? ownRows.get(row.material_id) : undefined;
      // The view said this row exists and the table read did not return it. That is a race
      // (archived between the two reads) rather than an error, and dropping it is right: the
      // view row alone carries no hazards, and a material with no hazards renders as one that
      // has been classified and found harmless.
      if (full) materials.push(accountMaterialFromRow(full, children));
      continue;
    }
    materials.push(
      referenceMaterialFromRow(
        row,
        row.reference_version_id ? versions.get(row.reference_version_id) : undefined
      )
    );
  }

  return { ok: true, materials };
}

/* ----------------------------------------------------------------- write */

export type NewMaterialInput = {
  materialClass: MaterialClass;
  name: string;
  role?: string;
  supplier?: string;
  supplierCode?: string;
  slug?: string;
  categories: CategoryId[];
  inci?: string;
  inciFunction?: string;
  cas?: string;
  format?: string;
  capacityMl?: number;
  labelAreaWidthMm?: number;
  labelAreaHeightMm?: number;
  foodContact?: boolean;
  childResistant?: boolean;
  notes?: string;
  /** Set when this material stands in place of one of ours. */
  overridesReferenceId?: string;
};

/** Blank strings become nulls. An empty string in a text column prints as a blank line. */
function textOrNull(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? '';
  return trimmed === '' ? null : trimmed;
}

function materialColumns(input: NewMaterialInput) {
  const packaging = input.materialClass === 'packaging';
  return {
    material_class: input.materialClass,
    name: input.name.trim(),
    role: textOrNull(input.role),
    supplier: textOrNull(input.supplier),
    supplier_code: textOrNull(input.supplierCode),
    slug: textOrNull(input.slug),
    categories: input.categories,
    inci: packaging ? null : textOrNull(input.inci),
    inci_function: packaging ? null : textOrNull(input.inciFunction),
    cas: packaging ? null : textOrNull(input.cas),
    // materials_packaging_check refuses geometry on an ingredient outright. Nulling it here
    // rather than sending it and catching the 23514 keeps the error path for real mistakes.
    format: packaging ? textOrNull(input.format) : null,
    capacity_ml: packaging ? input.capacityMl ?? null : null,
    label_area_width_mm: packaging ? input.labelAreaWidthMm ?? null : null,
    label_area_height_mm: packaging ? input.labelAreaHeightMm ?? null : null,
    food_contact: packaging ? input.foodContact ?? null : null,
    child_resistant: packaging ? input.childResistant ?? null : null,
    notes: textOrNull(input.notes),
    overrides_reference_id: input.overridesReferenceId ?? null
  };
}

/**
 * Creates one material in the caller's account. One row, one statement, one outcome.
 *
 * `accountId` is the entitlement's — the same rule products.ts states as its rule 2, quoted
 * here so a reader of this file alone still gets it: the id sent is the one the database
 * resolved for this deployment's brand, it is checked by the INSERT policy (`with check
 * (public.is_member_of(account_id))`), and it never comes from a form, a URL or a props chain.
 * Omitted when the entitlement resolved none, in which case the column default decides and
 * section 7c's trigger says which of the two null cases it was.
 */
export async function createMaterial(
input: NewMaterialInput,
accountId: string | null)
: Promise<MaterialWriteResult<string>> {
  const client = domainClient();
  if (!client) return { ok: false, reason: 'not_configured', message: NOT_CONFIGURED_MESSAGE };

  const account = accountId ? { account_id: accountId } : {};
  const { data, error } = await client.
  from('materials').
  insert({ ...account, ...materialColumns(input) }).
  select('id').
  single();

  if (error || !data) {
    return {
      ok: false,
      ...classifyMaterialError(error, input.overridesReferenceId ? 'override' : 'material')
    };
  }
  return { ok: true, value: (data as {id: string;}).id };
}

export async function updateMaterial(
materialId: string,
input: NewMaterialInput)
: Promise<MaterialWriteResult<void>> {
  const client = domainClient();
  if (!client) return { ok: false, reason: 'not_configured', message: NOT_CONFIGURED_MESSAGE };

  const columns = materialColumns(input);
  // The override link is not editable. Which of ours a row replaces is set once, at the
  // moment the maker chooses to replace it, and moving it afterwards would silently change
  // which reference material disappears from everybody's picker.
  const { overrides_reference_id, ...editable } = columns;
  void overrides_reference_id;

  const { data, error } = await client.
  from('materials').
  update(editable).
  eq('id', materialId).
  select('id');

  if (error) return { ok: false, ...classifyMaterialError(error) };
  // No error and no row: the `using` clause excluded it. See REACHED_NOTHING_MESSAGE.
  if (!data || data.length === 0) {
    return { ok: false, reason: 'reached_nothing', message: REACHED_NOTHING_MESSAGE };
  }
  return { ok: true, value: undefined };
}

/**
 * Archives a material. Soft, and it is soft for a reason worth stating.
 *
 * A specification stores the material id it was classified from. Deleting the row would make
 * that id resolve to nothing, and a composition whose fragrance oil resolves to nothing
 * derives NO HAZARD STATEMENTS — a label that silently loses its classification is the worst
 * outcome available here. Archiving keeps the row resolvable for anything already built on
 * it while removing it from the pickers.
 *
 * The screen says this out loud before it archives, because a maker pressing "archive" is
 * entitled to know that products keep working rather than to discover it.
 */
export async function archiveMaterial(materialId: string): Promise<MaterialWriteResult<void>> {
  const client = domainClient();
  if (!client) return { ok: false, reason: 'not_configured', message: NOT_CONFIGURED_MESSAGE };

  const { data, error } = await client.
  from('materials').
  update({ archived_at: new Date().toISOString() }).
  eq('id', materialId).
  select('id');

  if (error) return { ok: false, ...classifyMaterialError(error) };
  if (!data || data.length === 0) {
    return { ok: false, reason: 'reached_nothing', message: REACHED_NOTHING_MESSAGE };
  }
  return { ok: true, value: undefined };
}

/* ------------------------------------------------------------- children */

export type NewHazardInput = {
  code: string;
  statement: string;
  hazardClass: string;
  gcl?: number;
  scl?: number;
  pictogram?: HazardAt100['pictogram'];
  signal?: HazardAt100['signal'];
  derivation?: string;
};

export async function addHazard(
materialId: string,
input: NewHazardInput,
accountId: string | null)
: Promise<MaterialWriteResult<void>> {
  const client = domainClient();
  if (!client) return { ok: false, reason: 'not_configured', message: NOT_CONFIGURED_MESSAGE };

  const account = accountId ? { account_id: accountId } : {};
  const { data, error } = await client.
  from('material_hazards').
  insert({
    ...account,
    material_id: materialId,
    code: input.code.trim(),
    statement: input.statement.trim(),
    hazard_class: input.hazardClass.trim(),
    gcl: input.gcl ?? null,
    scl: input.scl ?? null,
    pictogram: input.pictogram ?? null,
    signal: input.signal ?? null,
    derivation: textOrNull(input.derivation)
  }).
  select('id').
  single();

  if (error || !data) return { ok: false, ...classifyMaterialError(error, 'hazard') };
  return { ok: true, value: undefined };
}

export async function addAllergen(
materialId: string,
input: Allergen,
accountId: string | null)
: Promise<MaterialWriteResult<void>> {
  const client = domainClient();
  if (!client) return { ok: false, reason: 'not_configured', message: NOT_CONFIGURED_MESSAGE };

  const account = accountId ? { account_id: accountId } : {};
  const { data, error } = await client.
  from('material_allergens').
  insert({
    ...account,
    material_id: materialId,
    name: input.name.trim(),
    pct: input.pct
  }).
  select('id').
  single();

  if (error || !data) return { ok: false, ...classifyMaterialError(error, 'allergen') };
  return { ok: true, value: undefined };
}

export async function addIfraLimit(
materialId: string,
input: IfraLimit,
accountId: string | null)
: Promise<MaterialWriteResult<void>> {
  const client = domainClient();
  if (!client) return { ok: false, reason: 'not_configured', message: NOT_CONFIGURED_MESSAGE };

  const account = accountId ? { account_id: accountId } : {};
  const { data, error } = await client.
  from('material_ifra_limits').
  insert({
    ...account,
    material_id: materialId,
    category: input.category.trim(),
    description: textOrNull(input.description),
    max_pct: input.max
  }).
  select('id').
  single();

  if (error || !data) return { ok: false, ...classifyMaterialError(error, 'ifra') };
  return { ok: true, value: undefined };
}

export type NewDocumentInput = {
  documentKind: DocumentKind;
  reference?: string;
  version?: string;
  documentDate?: string;
  expiresAt?: string;
  notes?: string;
};

/**
 * Records the supplier document a material's figures came off.
 *
 * NO FILE IS UPLOADED, AND NONE IS CLAIMED. There is no storage bucket — creating one is an
 * operator step the migration deliberately did not guess at — so `storage_path` is left null,
 * which the column comment defines as "no file is held". The screen that calls this says the
 * same thing in words, and `documentFileHeld` carries the fact to every other screen so that
 * none of them can render a reference number as a document received.
 */
export async function addDocument(
materialId: string,
input: NewDocumentInput,
accountId: string | null)
: Promise<MaterialWriteResult<void>> {
  const client = domainClient();
  if (!client) return { ok: false, reason: 'not_configured', message: NOT_CONFIGURED_MESSAGE };

  const account = accountId ? { account_id: accountId } : {};
  const { data, error } = await client.
  from('material_documents').
  insert({
    ...account,
    material_id: materialId,
    document_kind: input.documentKind,
    reference: textOrNull(input.reference),
    version: textOrNull(input.version),
    document_date: textOrNull(input.documentDate),
    expires_at: textOrNull(input.expiresAt),
    notes: textOrNull(input.notes),
    storage_path: null,
    file_name: null
  }).
  select('id').
  single();

  if (error || !data) return { ok: false, ...classifyMaterialError(error, 'document') };
  return { ok: true, value: undefined };
}

type ChildTable =
'material_hazards' |
'material_allergens' |
'material_ifra_limits' |
'material_documents';

/**
 * Removes one child row. A hard delete, unlike a material.
 *
 * Nothing points at a hazard row by id — a specification pins the MATERIAL — so removing one
 * cannot strand anything. What it does do is change a classification, which is why the
 * screens ask first and why removing one is a separate act from editing the material.
 */
export async function removeChildRow(
table: ChildTable,
id: string)
: Promise<MaterialWriteResult<void>> {
  const client = domainClient();
  if (!client) return { ok: false, reason: 'not_configured', message: NOT_CONFIGURED_MESSAGE };

  const { data, error } = await client.from(table).delete().eq('id', id).select('id');
  if (error) return { ok: false, ...classifyMaterialError(error) };
  if (!data || data.length === 0) {
    return { ok: false, reason: 'reached_nothing', message: REACHED_NOTHING_MESSAGE };
  }
  return { ok: true, value: undefined };
}

/**
 * Starts the maker's own version of one of ours.
 *
 * WHAT IS COPIED, AND WHAT IS DELIBERATELY NOT. Identity is copied — the name, the supplier,
 * the code, the class, the role — because that is what makes the new row recognisable as
 * standing in for ours. THE CLASSIFICATION IS NOT. Hazards, allergens and IFRA limits are
 * left empty, and the screen says why: the point of holding your own version is that your
 * supplier's document is the authority, and pre-filling it with our figures would produce a
 * row that says "yours" while carrying ours, which is the one thing the override rule exists
 * to prevent.
 *
 * The database allows exactly one live override of a reference material per account
 * (`materials_account_override_uidx`), so pressing this twice returns a duplicate rather than
 * making "which of my two rows wins" a question.
 */
export async function overrideReferenceMaterial(
reference: Material,
accountId: string | null)
: Promise<MaterialWriteResult<string>> {
  if (reference.source !== 'reference' || !reference.referenceMaterialId) {
    // Not a refusal by the database — a call that cannot mean anything. Reported rather than
    // sent, because sending it would insert a second unrelated material.
    return {
      ok: false,
      reason: 'failed',
      message:
      'That material is already yours, so there is nothing to stand in place of. Nothing has ' +
      'been saved.'
    };
  }
  return createMaterial(
    {
      materialClass: reference.class,
      name: reference.name,
      role: reference.class === 'ingredient' ? reference.role : undefined,
      supplier: reference.supplier,
      supplierCode: reference.supplierCode,
      categories: reference.categories,
      overridesReferenceId: reference.referenceMaterialId
    },
    accountId
  );
}
