import {
  IngredientMaterial,
  Material,
  MaterialClass,
  PackagingMaterial } from
'./model';

/**
 * THE MATERIALS REGISTER, HELD ONCE, LOOKED UP SYNCHRONOUSLY.
 *
 * WHAT THIS REPLACES. `src/lib/catalog.ts`: 739 lines of INGREDIENTS, PACKAGING and
 * COMPONENTS compiled into the bundle. Fourteen fragrance oils, waxes and plant oils with
 * hazard classifications, specific concentration limits, allergen percentages and IFRA
 * maxima, every one of them invented, every one of them rendered as fact — the classification
 * on the specification screen, the hazard statements on the label, sections 3 and 9 of the
 * safety data sheet. It is deleted. Materials now come from `batchlabel.materials` and
 * `batchlabel.reference_materials`, and lib/materials.ts is what reads them.
 *
 * WHY A MODULE-LEVEL INDEX AT ALL, given that products.ts opens with a long argument against
 * exactly this shape. The two are not the same thing and the difference is worth stating,
 * because the next person to read both will otherwise assume one of them is wrong.
 *
 *   products.ts's `let runtime: Product[] = PRODUCTS` was a module-level array SEEDED WITH
 *   INVENTED DATA and MUTATED BY WRITES. It was the source of truth, it was the same six
 *   products for every account, and a write went into it instead of into a database.
 *
 *   This is a CACHE of a read, seeded with nothing, written only by the provider that made
 *   the read, and discarded whenever the account it is an answer about changes. It holds no
 *   authority: every write goes to Supabase through lib/materials.ts and the index is
 *   refreshed from the answer.
 *
 * It exists because the derivation is synchronous and has to stay that way.
 * `deriveMixture(spec)` is called during render, from three screens, and it resolves three
 * material ids off the composition. Threading a materials map through derive → sds → regimes
 * → pipeline → every call site would be a wide change to files four other agents are editing
 * this evening; making the derivation async would put a promise inside a label preview that
 * redraws on every keystroke.
 *
 * THE RULE THAT MATTERS, and the reason `status` is exported rather than kept private:
 *
 *   A LOOKUP MISS IS NOT AN ANSWER. `ingredientById` returning undefined means one of three
 *   things — the register has not loaded, the read failed, or the material genuinely is not
 *   there — and only the third is a fact about the composition. Rendering "No hazard
 *   statements are required at this fragrance load" over the first two is a compliance claim
 *   about somebody's candle that this software never established, which is the exact defect
 *   class this whole round of work exists to remove. Callers ask `materialsSettled()` before
 *   they treat an empty derivation as an answer, and `derive` reports `unresolved` so a screen
 *   can name the material it could not find.
 */

export type MaterialIndexStatus =
/** Nobody has asked yet. Not an empty register. */
'unloaded' |
/** The read is in flight. Not an empty register either. */
'loading' |
/** The read came back. An empty list here IS the answer. */
'ready' |
/** The read failed. We know nothing, and we must not imply we do. */
'error' |
/** The account's rows are withheld (suspended), or there is no account to read for. */
'unavailable';

export type MaterialIndex = {
  status: MaterialIndexStatus;
  /** The account these materials belong to, so a stale answer cannot be read as a fresh one. */
  accountId: string | null;
  materials: Material[];
};

const EMPTY: MaterialIndex = { status: 'unloaded', accountId: null, materials: [] };

let current: MaterialIndex = EMPTY;
let byId = new Map<string, Material>();

/**
 * Publishes an answer. Called by MaterialsProvider and by tests, and by nothing else.
 *
 * Replaces wholesale rather than merging: a partial update would leave a material that has
 * been archived in another tab still resolving, and a resolved material is one a label is
 * printed from.
 */
export function publishMaterials(accountId: string | null, materials: Material[]): void {
  current = { status: 'ready', accountId, materials };
  byId = new Map(materials.map((material) => [material.id, material]));
}

/** Publishes a non-answer: loading, failed, or withheld. Empties the map with it. */
export function publishMaterialStatus(
status: Exclude<MaterialIndexStatus, 'ready'>,
accountId: string | null = null)
: void {
  current = { status, accountId, materials: [] };
  byId = new Map();
}

/** Back to nothing at all. Sign-out, and the start of every test. */
export function resetMaterials(): void {
  current = EMPTY;
  byId = new Map();
}

export function materialIndex(): MaterialIndex {
  return current;
}

export function materialsStatus(): MaterialIndexStatus {
  return current.status;
}

/**
 * Whether an empty answer may be read as "there is nothing".
 *
 * The one question every consumer of a lookup miss has to ask. False means we have not
 * established anything, and a screen that says "not classified", "no hazards required" or
 * "nothing outstanding" on the back of it is asserting something nobody checked.
 */
export function materialsSettled(): boolean {
  return current.status === 'ready';
}

export function allMaterials(): Material[] {
  return current.materials;
}

export function materialById(id: string): Material | undefined {
  if (!id) return undefined;
  return byId.get(id);
}

export function ingredientById(id: string): IngredientMaterial | undefined {
  const material = materialById(id);
  return material?.class === 'ingredient' ? material : undefined;
}

export function packagingById(id: string): PackagingMaterial | undefined {
  const material = materialById(id);
  return material?.class === 'packaging' ? material : undefined;
}

export function materialsOfClass(materialClass: MaterialClass): Material[] {
  return current.materials.filter((material) => material.class === materialClass);
}

export function ingredientsWithRole(role: string): IngredientMaterial[] {
  return current.materials.filter(
    (material): material is IngredientMaterial =>
    material.class === 'ingredient' && material.role === role
  );
}

/**
 * What a derived line may cite as its source, or nothing.
 *
 * RETURNS UNDEFINED RATHER THAN A SENTENCE WHEN NO DOCUMENT IS RECORDED, and every caller
 * assigns it straight to `WhyLine.source`, which DerivationPanel renders only when it is set.
 * That optionality was put there for exactly this: a classification a maker typed in from a
 * sheet on their bench, with no document reference entered, has no citation — and "Source:
 * Aurelia Fragrances, safety data sheet 4.2" invented to fill the gap is the single most
 * expensive sentence this application could produce, because it is the line a maker would
 * repeat to a regulator.
 */
export function materialCitation(material: Material): string | undefined {
  const parts: string[] = [];
  if (material.supplier) parts.push(material.supplier);
  if (material.document) {
    const { kind, version, date } = material.document;
    const document = [kind.toLowerCase(), version ? `version ${version}` : '', date].
    filter(Boolean).
    join(' ');
    parts.push(document);
  }
  if (!parts.length) return undefined;
  // A material with a supplier and no document says only who supplies it, which is not a
  // citation. Nothing rather than half of one.
  if (!material.document) return undefined;
  return parts.join(', ');
}

/**
 * How a material's figures should be described on screen, in one clause.
 *
 * Used wherever a value is rendered as fact, so the maker can always tell whose fact it is.
 */
export function materialOrigin(material: Material): string {
  if (material.source === 'account') {
    return material.overridesReferenceId ?
    'Your record, standing in place of ours' :
    'Your own record';
  }
  if (material.provenance === 'illustrative-example') {
    return 'Batchlabel example, not a real classification';
  }
  return 'Batchlabel reference data';
}

/** The label a class gets on screen. Two of them now, and there is no third. */
export const MATERIAL_CLASSES: Array<{
  id: MaterialClass;
  label: string;
  blurb: string;
  documentRule: string;
}> = [
{
  id: 'ingredient',
  label: 'Ingredients',
  blurb:
  'Anything that goes into the mixture. Classified at 100 percent, before any load is applied.',
  documentRule: 'A safety data sheet from your supplier.'
},
{
  id: 'packaging',
  label: 'Packaging',
  blurb: 'Containers and cartons. Capacity and available label area drive label geometry.',
  documentRule: 'A technical drawing or dimension sheet.'
}];
