import { materialById, materialsSettled, materialsStatus } from './material-index';
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
  /**
   * Why a check that EXISTS did not run, as a clause a screen can put in a sentence.
   *
   * THE DIFFERENCE BETWEEN THE TWO WAYS OF NOT BEING CHECKED, and the reason a boolean was not
   * enough. Documents is `checked: false` permanently because Batchlabel has no such check to
   * run; saying so once, in the copy, is honest and does not change. Classification is
   * `checked: false` only while the materials register has not answered — the check exists, its
   * input did not arrive, and that is a transient hole in a work queue that a maker is entitled
   * to be told about.
   *
   * Undefined therefore means "nothing was prevented from running". A stage with this set is
   * one whose empty issue list is silence rather than an all-clear, and `queueFor` collects
   * them so a screen cannot compose four honest stages into one false reassurance.
   */
  blockedBy?: string;
  /** Shown when settled, so the stage always says something. */
  summary: string;
  issues: StageIssue[];
  settled: boolean;
};

/**
 * Why the classification check could not run, or nothing.
 *
 * Names the actual register state rather than a generic "not loaded", because "we are still
 * reading it" and "we could not read it" call for different things from the maker.
 */
function registerBlockage(): string | undefined {
  switch (materialsStatus()) {
    case 'ready':
      return undefined;
    case 'error':
      return 'your materials register could not be read';
    case 'unavailable':
      return 'your materials register is not available on this account';
    default:
      return 'your materials register has not finished loading';
  }
}

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
  const to = `/products/${product.id}`;

  /**
   * THE GAPS `blankSpec` USED TO FILL IN SILENTLY.
   *
   * A new product no longer arrives holding a paraffin wax, a 250 ml tumbler and 100 g of
   * something nobody weighed, so those fields are genuinely empty until the maker sets them —
   * and an empty field that drives a label has to be visible work rather than a quiet blank.
   * Each of these is a CLP Article 17 element or a component of the classification the label
   * carries, which is why they are raised here and not merely left to look unfilled on a form.
   */
  if (product.spec.kind === 'mixture') {
    if (!product.spec.baseId) {
      compositionIssues.push({
        label: 'No base wax or carrier chosen yet',
        detail:
        'The base is most of what is in the pack, and its classification is part of the label. Nothing is assumed for you — pick the one you actually use.',
        to
      });
    }
    if (!product.spec.fragranceId) {
      compositionIssues.push({
        label: 'No fragrance chosen yet',
        detail:
        'Pick a fragrance oil from the materials register. Nothing can be classified until the composition has something hazardous in it.',
        to
      });
    } else if (product.spec.load === 0) {
      compositionIssues.push({
        label: 'Fragrance load is 0 percent',
        detail:
        'Set the load and the classification will follow. Both outputs redraw as you change it.',
        to
      });
    }
  }

  if (product.spec.kind !== 'bom') {
    if (product.spec.netQuantity <= 0) {
      compositionIssues.push({
        label: 'No net quantity set',
        detail:
        'The nominal quantity is a required label element. It is not filled in for you, because how much you put in the pack is not something this app can know.',
        to
      });
    }
    if (!product.spec.packagingId) {
      compositionIssues.push({
        label: 'No packaging chosen yet',
        detail:
        'The pack fixes the printable area and, under CLP, the minimum pictogram size the label is checked against. Both checks are waiting on it.',
        to
      });
    }
  }

  if (product.spec.kind === 'phased' && product.spec.paoMonths <= 0) {
    compositionIssues.push({
      label: 'No period after opening set',
      detail:
      'A cosmetic label carries a period after opening or a date of minimum durability. Nothing here has measured one, so it is yours to set and to justify.',
      to
    });
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
   *
   * The RoHS obligation itself did not disappear with them — it is recorded against the
   * product from the compliance-record control on the specification screen, where a control
   * that writes actually lives.
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
  //
  // `out-of-date` AND ONLY `out-of-date`. This read `!artefact.current` over a boolean that was
  // `true` for every unproduced surface, so the branch was unreachable on a real account and
  // would have fired on all four states the day it was not. `ArtefactCurrency` has four names
  // now: an artefact nobody produced is not stale, and one whose fingerprint we could not
  // compute is not stale either — it is unknown, and this queue is a list of things we have
  // established are wrong.
  const stale = product.artefacts.filter((artefact) => artefact.currency === 'out-of-date');
  const produced = product.artefacts.filter((artefact) => artefact.currency !== 'not-produced');
  const sds = product.artefacts.some((artefact) => artefact.type === 'sds') ?
  buildSds(product, derivation, market) :
  null;
  const outstanding = outstandingObligations(product);

  /**
   * Sections of the sheet still waiting on a competent person, MINUS the ones signed off.
   *
   * `sds.outstanding` was always 4. Sections 4, 8, 11 and 13 are hardcoded `kind: 'needs-you'`
   * in lib/sds.ts, so every mixture and every phased product carried this row from the moment
   * it was created, forever, and its Resolve link went to a screen that listed the same four
   * and offered no control to sign any of them off. It was a permanent line in a work queue
   * that no amount of work could clear.
   *
   * There is a control now, on the specification screen, and it writes a
   * `compliance.sds_section_reviewed` event per section. This counts what is left.
   */
  const sectionsAwaitingReview = sds ?
  sds.sections.
  filter((section) => section.kind === 'needs-you').
  filter((section) => !(section.number in product.evidence.sdsSections)) :
  [];

  const outputIssues: StageIssue[] = [
  ...(stale.length ?
  [
  {
    label: `${stale.length} recorded print${stale.length === 1 ? '' : 's'} no longer match${stale.length === 1 ? 'es' : ''} this composition`,
    detail:
    'The composition, the pack, a pinned material or your printed business details changed after these were printed. Reprint, then record the new print.',
    to: `/products/${product.id}`
  }] :

  []),
  ...(sectionsAwaitingReview.length ?
  [
  {
    label: `${sectionsAwaitingReview.length} section${sectionsAwaitingReview.length === 1 ? '' : 's'} of the safety data sheet ${sectionsAwaitingReview.length === 1 ? 'needs' : 'need'} a competent person`,
    detail: `${sectionsAwaitingReview.
    map((section) => section.title.toLowerCase()).
    join(', ')} cannot be derived from the composition. Record the review once somebody competent has confirmed the wording.`,
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
    // The check exists and its input did not arrive. Carried out of here so a queue built from
    // these stages can say so; see `queueFor`.
    blockedBy: registerBlockage(),
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
    // COUNTED, not asserted. This said "none produced yet" unconditionally, which was true
    // while nothing could be produced and would have gone on being said afterwards. `produced`
    // is the number of surfaces with a recorded print behind them, and the sentence still
    // refuses to call any of them generated — Batchlabel writes no file, and every one of
    // these rows carries `is_placeholder`.
    summary:
    produced.length === 0 ?
    `${product.artefacts.length} outputs, no print recorded yet` :
    `${product.artefacts.length} outputs, ${produced.length} with a recorded print`,
    issues: outputIssues
  }];

}

export type QueueIssue = StageIssue & {stage: Stage;};

/**
 * A work queue, and what it could not look at.
 *
 * THIS TYPE IS THE FIX FOR A DEFECT THAT NO INDIVIDUAL PART OF IT HAD. `outstandingFor` used
 * to return the issues alone:
 *
 *     return stagesFor(...).flatMap((stage) => stage.issues.map(...));
 *
 * Every step behind that line is honest. With the materials register unanswered, the
 * classification stage raises no issues and marks itself `checked: false`; `clp-classification`
 * resolves to `not-tracked` rather than to a finding; `outstandingObligations` excludes
 * not-tracked from a queue because a queue is a list of things we ESTABLISHED are undone. Each
 * of those is right on its own. Composed, they empty the queue — and Studio, the first screen
 * after sign-in, renders an empty queue as "Nothing outstanding. Every composition is settled,
 * every material is classified, and nothing is waiting on you." to an account whose materials
 * read had just FAILED.
 *
 * The flatMap is where the honesty was dropped: `checked` reached it and did not leave. So the
 * queue now carries both halves, and a screen has to hold the second to render the first.
 */
export type WorkQueue = {
  issues: QueueIssue[];
  /**
   * Clauses naming the checks that exist and did not run, deduplicated.
   *
   * EMPTY IS THE ONLY STATE THAT LICENSES AN ALL-CLEAR. Non-empty with no issues is silence,
   * not good news, and a screen that renders the two the same way is back where this started.
   */
  blocked: string[];
};

export function queueFor(product: Product, derivation: Derivation, market: Market): WorkQueue {
  const stages = stagesFor(product, derivation, market);
  return {
    issues: stages.flatMap((stage) => stage.issues.map((issue) => ({ ...issue, stage }))),
    blocked: Array.from(
      new Set(
        stages.
        map((stage) => stage.blockedBy).
        filter((clause): clause is string => Boolean(clause))
      )
    )
  };
}

/** Every issue across every product, plus everything none of them could check. */
export function queueAcross(entries: WorkQueue[]): WorkQueue {
  return {
    issues: entries.flatMap((entry) => entry.issues),
    blocked: Array.from(new Set(entries.flatMap((entry) => entry.blocked)))
  };
}