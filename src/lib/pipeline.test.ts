import { afterEach, describe, expect, it } from 'vitest';
import { categoryById } from './categories';
import { publishMaterialStatus, publishMaterials, resetMaterials } from './material-index';
import { FIXTURE_MATERIALS } from './fixtures';
import { derive } from './derive';
import { Product } from './model';
import { Stage, StageId, stagesFor } from './pipeline';
import { artefactsFor, blankSpec } from './products';

/**
 * What each stage of the pipeline is allowed to claim.
 *
 * The stages render as ticks and one-line summaries, and a tick is read as "this has been
 * dealt with". Two of them were claiming that on work nothing had done:
 *
 *   DOCUMENTS ran no check at all. Removing the two invented supplier warnings emptied its
 *   issue list, and `settled` is derived from an empty issue list — so the stage that stopped
 *   looking inherited the same green tick as the ones that looked and found nothing. On a
 *   virgin account it read "Documents settled" to somebody who holds no documents and has
 *   nowhere to put one.
 *
 *   OUTPUTS said "N outputs, all current". Nothing stores artefacts: every one carries version
 *   "Not yet produced" and no print date, so "current" was describing the currency of
 *   documents that do not exist.
 *
 * The products here are built the way a real account's are — blankSpec plus artefactsFor —
 * rather than from fixtures, because the fixtures carry printed artefacts and would hide
 * exactly the case that matters.
 */

function freshProduct(categoryId: 'home-fragrance' | 'electronics'): Product {
  const category = categoryById(categoryId);
  const spec = blankSpec(category, category.productTypes[0]);
  return {
    id: 'prod-1',
    specificationId: 'spec-1',
    name: 'First product',
    sku: 'FP-001',
    categoryId,
    markets: ['GB'],
    regimes: category.regimes,
    spec,
    artefacts: artefactsFor(category, spec.kind),
    identifiers: {},
    obligations: {}
  };
}

function stages(product: Product): Stage[] {
  const derivation = derive(product.spec, product, 'GB');
  return stagesFor(product, derivation, 'GB');
}

function stageOf(product: Product, id: StageId): Stage {
  const stage = stages(product).find((entry) => entry.id === id);
  if (!stage) throw new Error(`no ${id} stage`);
  return stage;
}

describe('the Documents stage, which checks nothing', () => {
  it('is neither settled nor counted against the maker', () => {
    const documents = stageOf(freshProduct('home-fragrance'), 'documents');
    // Not checked, so not settled — and with no issues, so it raises no work either. Both
    // halves matter: a tick claims we looked, a clay count claims they owe something.
    expect(documents.checked).toBe(false);
    expect(documents.settled).toBe(false);
    expect(documents.issues).toEqual([]);
  });

  it('says plainly that nothing watches supplier documents', () => {
    const documents = stageOf(freshProduct('home-fragrance'), 'documents');
    expect(documents.summary).toMatch(/nothing watches supplier documents/i);
    // And claims nothing about currency, which is the reassurance it cannot support.
    expect(documents.summary).not.toMatch(/current|up to date|settled/i);
  });
});

describe('the Outputs stage, whose outputs have never been produced', () => {
  it('never says the outputs are current', () => {
    // Electronics with every obligation ticked is the only route to a settled Outputs stage,
    // because a mixture always carries four safety-data-sheet sections needing a competent
    // person. That is the exact state that used to render "4 outputs, all current".
    const product = freshProduct('electronics');
    const ticked: Product = {
      ...product,
      obligations: Object.fromEntries(
        stages(product).
        flatMap((stage) => stage.issues).
        map((issue) => [issue.label, true])
      )
    };
    const outputs = stageOf(ticked, 'outputs');

    expect(outputs.summary).not.toMatch(/all current/i);
    expect(outputs.summary).toMatch(/none produced yet/i);
  });

  it('agrees with what the artefacts themselves say', () => {
    const product = freshProduct('home-fragrance');
    // The summary and the artefact rows have one truth between them: nothing is produced.
    for (const artefact of product.artefacts) {
      expect(artefact.version).toBe('Not yet produced');
      expect(artefact.printedOn).toBe('—');
    }
    expect(stageOf(product, 'outputs').summary).toContain('none produced yet');
  });
});

describe('the stages that do check something', () => {
  it('are marked as checked, so a tick still means what it means', () => {
    // The register has to have answered before classification can be one of them; see below.
    publishMaterials('acct-1', FIXTURE_MATERIALS);
    const checked = stages(freshProduct('home-fragrance')).
    filter((stage) => stage.id !== 'documents');
    expect(checked).toHaveLength(3);
    for (const stage of checked) expect(stage.checked).toBe(true);
  });
});

/**
 * THE CLASSIFICATION STAGE CANNOT TICK BEFORE THE MATERIALS REGISTER HAS ANSWERED.
 *
 * `checked` exists because "we found nothing wrong" and "we did not look" used to render as
 * the same green tick, and materials moving out of the bundle and into Supabase created a new
 * way to not look: the read has not landed, or it failed. Every lookup misses, the derivation
 * produces nothing, the issue list is empty — and an empty issue list is what earns the tick.
 *
 * A maker watching their own product screen would see "Classification settled" for the few
 * hundred milliseconds before the register arrived, and would see it permanently if the read
 * failed. That is a compliance claim made by a pending request.
 */
describe('the classification stage while the materials register is unsettled', () => {
  afterEach(() => resetMaterials());

  it('is not checked and not settled before the register has loaded', () => {
    publishMaterialStatus('loading', 'acct-1');
    const stage = stages(freshProduct('home-fragrance')).find((s) => s.id === 'classification');
    expect(stage?.checked).toBe(false);
    expect(stage?.settled).toBe(false);
    expect(stage?.summary).toMatch(/has not loaded/i);
  });

  it('is not checked and not settled when the register could not be read', () => {
    publishMaterialStatus('error', 'acct-1');
    const stage = stages(freshProduct('home-fragrance')).find((s) => s.id === 'classification');
    expect(stage?.checked).toBe(false);
    expect(stage?.settled).toBe(false);
  });

  it('raises no issues from a register it has not read, either', () => {
    // The other direction, and it matters as much: a pending read must not manufacture
    // "material not in your register" rows for every slot on the composition.
    publishMaterialStatus('loading', 'acct-1');
    const stage = stages(freshProduct('home-fragrance')).find((s) => s.id === 'classification');
    expect(stage?.issues).toEqual([]);
  });
});

/**
 * A material a composition names and the register cannot produce.
 *
 * The dangerous case, and the one that did not exist while materials were a shipped constant:
 * archiving a material leaves every composition that used it pointing at an id that resolves
 * to nothing, and a derivation with no inputs produces no hazards — which renders as a product
 * that needs none.
 */
describe('a composition naming a material that is not in the register', () => {
  afterEach(() => resetMaterials());

  it('raises it as an issue rather than classifying around it', () => {
    publishMaterials('acct-1', FIXTURE_MATERIALS);
    const product = freshProduct('home-fragrance');
    const spec = { ...product.spec, fragranceId: 'ing-archived-last-year' };
    if (spec.kind !== 'mixture') throw new Error('expected a mixture');
    const withMissing = { ...product, spec };
    const stage = stagesFor(withMissing, derive(spec, withMissing, 'GB'), 'GB').
    find((entry) => entry.id === 'classification');

    expect(stage?.settled).toBe(false);
    expect(stage?.issues.map((issue) => issue.label).join(' ')).toMatch(/not in your materials register/i);
  });
});
