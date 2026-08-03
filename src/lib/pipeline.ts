import { INBOX, ingredientById, materialById } from './catalog';
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
  settled: boolean;
  /** Shown when settled, so the stage always says something. */
  summary: string;
  issues: StageIssue[];
};

/** The materials a product's composition actually draws on. */
export function materialIdsFor(product: Product): string[] {
  const spec = product.spec;
  if (spec.kind === 'mixture') {
    return [spec.fragranceId, spec.baseId, spec.dyeId].filter(
      (id) => id && id !== 'ing-no-dye'
    );
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
  const ids = materialIdsFor(product);
  const materials = ids.map((id) => materialById(id)).filter(Boolean);

  /* ------------------------------------------------------------ documents */
  const revised = materials.filter(
    (material) => material && material.document.latestVersion
  );
  const waiting = INBOX.filter(
    (item) => item.matchedMaterialId && ids.includes(item.matchedMaterialId)
  );
  const documentIssues: StageIssue[] = [
  ...revised.map((material) => ({
    label: `${material!.name}, newer sheet published`,
    detail: `Version ${material!.document.latestVersion} was published on ${material!.document.latestDate}. The classification still uses ${material!.document.version}.`,
    to: `/materials/${material!.class}/${material!.id}`
  })),
  ...waiting.map((item) => ({
    label: `${item.fileName} waiting in the inbox`,
    detail: item.note,
    to: '/materials/ingredient'
  }))];


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
  if (product.spec.kind === 'bom') {
    const undeclared = product.spec.items.filter(
      (item) => materialById(item.materialId)?.class === 'component' &&
      (materialById(item.materialId) as {rohsStatus?: string;}).rohsStatus === 'Not declared'
    );
    for (const item of undeclared) {
      compositionIssues.push({
        label: `${materialById(item.materialId)?.name} has no material declaration`,
        detail: 'The declaration of conformity cannot be signed while a component is undeclared.',
        to: '/materials/component'
      });
    }
  }

  /* -------------------------------------------------------- classification */
  const missingClassification = ids.
  map((id) => ingredientById(id)).
  filter((ingredient) => ingredient && ingredient.hazards.length === 0 && ingredient.role === 'Fragrance oil');
  const classificationIssues: StageIssue[] = missingClassification.map((ingredient) => ({
    label: `${ingredient!.name} has no hazard data`,
    detail: 'The sheet on file carries no classification, so this component contributes nothing.',
    to: `/materials/ingredient/${ingredient!.id}`
  }));

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
    settled: documentIssues.length === 0,
    summary: `${materials.length} materials, every sheet current`,
    issues: documentIssues
  },
  {
    id: 'composition',
    label: 'Composition',
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
    settled: classificationIssues.length === 0,
    summary: derivation.summary.map((entry) => entry.value).join(' · '),
    issues: classificationIssues
  },
  {
    id: 'outputs',
    label: 'Outputs',
    settled: outputIssues.length === 0,
    summary: `${product.artefacts.length} outputs, all current`,
    issues: outputIssues
  }];

}

export function outstandingFor(product: Product, derivation: Derivation, market: Market) {
  return stagesFor(product, derivation, market).flatMap((stage) =>
  stage.issues.map((issue) => ({ ...issue, stage }))
  );
}