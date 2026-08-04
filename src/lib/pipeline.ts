import { materialById, materialsSettled } from './material-index';
import { Derivation } from './derive';
import { Market, Product } from './model';
import { outstandingObligations } from './regimes';
import { buildSds } from './sds';

/**
 * Where a product has got to, stated once. The product screen shows this as a
 * pipeline; Studio shows the same facts as a workspace list. Neither
 * paraphrases the other.
 */

export type StageId = 'documents' | 'composition' | 'classification' | 'outputs';

export type StageIssue = {
  label: string;
  detail: string;
  to: string;
};

export type Stage = {
  id: StageId;
  label: string;
  /**
   * Whether anything actually looked at this stage.
   *
   * THE THIRD STATE, and the reason it had to exist. `settled` is derived from
   * `issues.length === 0`, which quietly turns "we found nothing wrong" and "we did not look"
   * into the same green tick. Documents is the second of those: nothing watches supplier
   * documents, so the stage raises no issues and rendered as settled — a tick, and the words
   * "Documents settled", to an account that holds no documents and has nowhere to put one.
   *
   * A stage that ran no check is neither settled nor unsettled, and ProductPipeline renders it
   * as neither: no tick, no issue count, and a line that says what has not been built.
   */
  checked: boolean;
  /** Shown when settled, so the stage always says something. */
  summary: string;
  issues: StageIssue[];
  settled: boolean;
};

/** The materials a product's composition actually draws on. */
export function materialIdsFor(product: Product): string[] {
  const spec = product.spec;
  if (spec.kind === 'mixture') {
    // 'ing-no-dye' was a sentinel row in the deleted catalogue — a material called "No dye"
    // that every caller had to know to skip by id. An unset slot is now an empty string.
    return [spec.fragranceId, spec.baseId, spec.dyeId].filter((id) => Boolean(id));
  }
  if (spec.kind === 'phased') {
    return spec.phases.flatMap((phase) => phase.items.map((item) => item.materialId));
  }
  return spec.items.map((item) => item.materialId);
}

export function stagesFor(
product: Product,
derivation: Derivation,
market: Market)
: Stage[] {
  const registerSettled = materialsSettled();
  const ids = materialIdsFor(product);
  const materials = ids.map((id) => materialById(id)).filter(Boolean);

  /* ------------------------------------------------------------ documents */
  //
  // NO DOCUMENT ISSUES ARE RAISED, because nothing watches supplier documents yet.
  //
  // This used to produce two, and both were invented. One matched a seeded inbox against the
  // maker's own specification and told them a newer sheet was waiting and their allergen
  // table had changed. The other read `latestVersion` off the shipped materials catalogue and
  // told them "version 4.3 was published, the classification still uses 4.2". Neither had
  // checked anything: both were constants shipped in the bundle, and they rendered under the
  // customer's own product name as outstanding compliance work.
  //
  // Telling a maker their live classification may be wrong is the most consequential sentence
  // this product can produce. It has to come from having looked. When the watchers in the
  // spec are built, this is where their findings belong.
  const documentIssues: StageIssue[] = [];

  /* ---------------------------------------------------------- composition */
  const compositionIssues: StageIssue[] = [];
  if (product.spec.kind === 'mixture') {
    if (!product.spec.fragranceId) {
      compositionIssues.push({
        label: 'No fragrance chosen yet',
        detail:
        'Pick a fragrance oil from the materials register. Nothing can be classified until the composition has something hazardous in it.',
        to: `/products/${product.id}`
      });
    } else if (product.spec.load === 0) {
      compositionIssues.push({
        label: 'Fragrance load is 0 percent',
        detail:
        'Set the load and the classification will follow. Both outputs redraw as you change it.',
        to: `/products/${product.id}`
      });
    }
  }
  if (product.spec.kind === 'phased') {
    const total = product.spec.phases.reduce(
      (sum, phase) => sum + phase.items.reduce((inner, item) => inner + item.pct, 0),
      0
    );
    if (Math.abs(total - 100) > 0.01) {
      compositionIssues.push({
        label: 'Formula does not total 100 percent',
        detail: `The phases add to ${total.toFixed(2)} percent. Every derived figure depends on the total being exact.`,
        to: `/products/${product.id}`
      });
    }
  }
  /*
   * NO BILL-OF-MATERIALS ISSUES, AND THE BRANCH THAT RAISED THEM IS GONE.
   *
   * It read `rohsStatus === 'Not declared'` off the shipped COMPONENTS catalogue and raised
   * "<component> has no material declaration" with a Resolve link to /materials/component —
   * a page whose save button toasted "Saving a material is not built yet". So it was a
   * compliance finding about the maker's technical file, produced from a constant, pointing
   * at a screen that could not change it. Components are deleted (Rhys's ruling; the database
   * refuses the class), so there is nothing left to read and nothing left to claim.
   */

  /* -------------------------------------------------------- classification */
  //
  // TWO DIFFERENT GAPS, AND THEY ARE NOT THE SAME SENTENCE.
  //
  //   A material the register could not produce at all. `derive` reports these as
  //   `unresolved`, and they are the dangerous ones: the classification silently loses an
  //   input, and every group under it renders as "nothing required".
  //
  //   A fragrance oil that IS in the register and carries no hazard rows. That is a real gap
  //   in what the maker has entered, and the fix is on the material rather than on the
  //   product — so the link goes to the material.
  //
  // Neither may be reported before the register has settled. `checked` is what says so; it
  // exists because "we found nothing wrong" and "we did not look" used to render as the same
  // green tick.
  const classificationIssues: StageIssue[] = registerSettled ?
  [
  ...derivation.unresolved.map((entry) => ({
    label: `${entry.slot} is not in your materials register`,
    detail:
    `The composition names "${entry.id}" and the register has no live material with that id — ` +
    'it may have been archived. Nothing has been classified from it, so the label and the ' +
    'sheet are missing whatever it contributes. Pick a material that is in the register.',
    to: `/products/${product.id}`
  })),
  ...ids.
  map((id) => materialById(id)).
  filter(
    (material) =>
    material?.class === 'ingredient' &&
    material.role === 'Fragrance oil' &&
    material.hazards.length === 0
  ).
  map((material) => ({
    label: `${material!.name} carries no hazard data`,
    detail:
    'No hazard statements are recorded against this material, so it contributes nothing to ' +
    'the classification. Add what the supplier\'s safety data sheet says in section 2.',
    to: `/materials/${material!.class}/${material!.id}`
  }))] :

  [];

  /* ---------------------------------------------------------------- outputs */
  // Nothing stores artefacts, so nothing a real account holds is ever out of date: an output
  // that has never been produced cannot have drifted from the composition. The branch stays
  // because a fixture product in the test suite does carry stale artefacts, and because the
  // day artefacts are stored this is where "out of date" comes back.
  const stale = product.artefacts.filter((artefact) => !artefact.current);
  const sds = product.artefacts.some((artefact) => artefact.type === 'sds') ?
  buildSds(product, derivation, market) :
  null;
  const outstanding = outstandingObligations(product);

  const outputIssues: StageIssue[] = [
  ...(stale.length ?
  [
  {
    label: `${stale.length} output${stale.length === 1 ? '' : 's'} out of date`,
    detail: 'The composition changed after these were produced.',
    to: `/products/${product.id}`
  }] :

  []),
  ...(sds && sds.outstanding ?
  [
  {
    label: `${sds.outstanding} sections of the safety data sheet need a competent person`,
    detail:
    'First aid, exposure controls, toxicological information and disposal cannot be derived from the composition.',
    to: `/products/${product.id}`
  }] :

  []),
  ...outstanding.map((obligation) => ({
    label: obligation.label,
    detail: obligation.missingText,
    to: obligation.to.replace(':id', product.id)
  }))];


  return [
  {
    id: 'documents',
    label: 'Documents',
    // NOT CHECKED, and therefore not settled. Removing the two invented warnings emptied
    // `documentIssues`, and an empty issue list is exactly how the other three stages earn
    // their tick — so the stage that stopped checking anything became the one claiming to be
    // finished. There is no document store, nothing watches for a reissued supplier sheet,
    // and an account has nowhere to put one; "Documents settled" is a statement about work
    // this software has not done.
    checked: false,
    settled: false,
    // Not "every sheet current": nothing checks whether a supplier has reissued, so that
    // was a reassurance the product had not earned. Count what we know — the materials on
    // the composition — and claim nothing about their currency.
    summary: registerSettled ?
    `Nothing watches supplier documents yet. ${materials.length} ${materials.length === 1 ? 'material is' : 'materials are'} on this composition` :
    'Nothing watches supplier documents yet, and your materials register has not loaded',
    issues: documentIssues
  },
  {
    id: 'composition',
    label: 'Composition',
    checked: true,
    settled: compositionIssues.length === 0,
    summary:
    product.spec.kind === 'mixture' ?
    `${product.spec.productType}, ${product.spec.load} percent load` :
    product.spec.kind === 'phased' ?
    `${product.spec.phases.length} phases, totalling 100 percent` :
    `${product.spec.items.length} components`,
    issues: compositionIssues
  },
  {
    id: 'classification',
    label: 'Classification',
    // NOT ALWAYS TRUE ANY MORE. Materials are read from a database now, so there is a state
    // where nothing has been classified because nothing has loaded — and `settled` is derived
    // from `issues.length === 0`, which would turn that into a green tick.
    checked: registerSettled,
    settled: registerSettled && classificationIssues.length === 0,
    summary: registerSettled ?
    derivation.summary.map((entry) => entry.value).join(' · ') :
    'Your materials register has not loaded, so nothing has been classified yet',
    issues: classificationIssues
  },
  {
    id: 'outputs',
    label: 'Outputs',
    checked: true,
    settled: outputIssues.length === 0,
    // NOT "all current". `artefactsFor` gives every artefact version "Not yet produced" and
    // no print date, precisely because there is no artefacts table and nothing has been
    // produced — so "current" was describing the currency of documents that do not exist.
    // What IS settled here is the work the maker owed: the obligations are ticked and the
    // sheet has no section left needing a competent person.
    summary: `${product.artefacts.length} outputs, none produced yet`,
    issues: outputIssues
  }];

}

export function outstandingFor(product: Product, derivation: Derivation, market: Market) {
  return stagesFor(product, derivation, market).flatMap((stage) =>
  stage.issues.map((issue) => ({ ...issue, stage }))
  );
}