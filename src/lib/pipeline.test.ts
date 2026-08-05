import { afterEach, describe, expect, it } from 'vitest';
import { categoryById } from './categories';
import { publishMaterialStatus, publishMaterials, resetMaterials } from './material-index';
import { FIXTURE_MATERIALS } from './fixtures';
import { derive } from './derive';
import { Product } from './model';
import { Stage, StageId, stagesFor } from './pipeline';
import { artefactsFor, blankSpec } from './products';
import { obligationsFor } from './regimes';

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

function freshProduct(categoryId: 'home-fragrance'): Product {
  const category = categoryById(categoryId);
  const spec = blankSpec(category.productTypes[0]);
  return {
    id: 'prod-1',
    specificationId: 'spec-1',
    name: 'First product',
    sku: 'FP-001',
    categoryId,
    markets: ['GB'],
    regimes: category.regimes,
    spec,
    artefacts: artefactsFor(category),
    identifiers: {},
    evidence: { obligations: {}, sdsSections: {} }
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
    // Every obligation ticked is the closest a product gets to a settled Outputs stage, and
    // that is the exact state that used to render "4 outputs, all current". Ticking obligations
    // records no PRINT, so the summary may not start counting produced artefacts from it.
    const product = freshProduct('home-fragrance');
    const ticked: Product = {
      ...product,
      evidence: {
        obligations: Object.fromEntries(
          obligationsFor(product).map((obligation) => [
          obligation.id,
          {
            id: `ev-${obligation.id}`,
            recordedAt: '2026-07-01T00:00:00.000Z',
            reference: null,
            summary: 'Recorded in a test.'
          }]
          )
        ),
        sdsSections: {}
      }
    };
    const outputs = stageOf(ticked, 'outputs');

    expect(outputs.summary).not.toMatch(/all current/i);
    // Still "no print recorded", because ticking every obligation records no print — and the
    // summary must not start counting produced artefacts on the strength of unrelated evidence.
    expect(outputs.summary).toMatch(/no print recorded yet/i);
  });

  it('agrees with what the artefacts themselves say', () => {
    const product = freshProduct('home-fragrance');
    // The summary and the artefact rows have one truth between them: nothing is produced.
    for (const artefact of product.artefacts) {
      expect(artefact.version).toBe('Not yet produced');
      expect(artefact.printedOn).toBe('—');
    }
    expect(stageOf(product, 'outputs').summary).toContain('no print recorded yet');
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
 * The safety data sheet row that no amount of work could clear.
 *
 * `sds.outstanding` was always 4. Sections 4, 8, 11 and 13 are hardcoded `kind: 'needs-you'`
 * in lib/sds.ts, so every mixture and every phased product carried "4 sections of the safety
 * data sheet need a competent person" from the moment it was created, forever — and its
 * Resolve link went to a screen that listed the same four and offered no control to sign any
 * of them off. A permanent row in a work queue teaches a maker to stop reading the queue.
 */
describe('the safety data sheet sections needing a competent person', () => {
  const sdsIssue = (product: Product) =>
  stageOf(product, 'outputs').issues.find((issue) => /safety data sheet/i.test(issue.label));

  const reviewed = (product: Product, sections: number[]): Product => ({
    ...product,
    evidence: {
      ...product.evidence,
      sdsSections: Object.fromEntries(
        sections.map((number) => [
        number,
        {
          id: `ev-sds-${number}`,
          recordedAt: '2026-07-01T00:00:00.000Z',
          reference: String(number),
          summary: `Section ${number} reviewed.`
        }]
        )
      )
    }
  });

  it('is raised on a brand new mixture, and names the sections', () => {
    const issue = sdsIssue(freshProduct('home-fragrance'));
    expect(issue?.label).toMatch(/4 sections/);
    expect(issue?.detail).toMatch(/first aid/i);
  });

  it('counts down as reviews are recorded', () => {
    const product = freshProduct('home-fragrance');
    expect(sdsIssue(reviewed(product, [4]))?.label).toMatch(/3 sections/);
    expect(sdsIssue(reviewed(product, [4, 8]))?.label).toMatch(/2 sections/);
    expect(sdsIssue(reviewed(product, [4, 8, 11]))?.label).toMatch(/1 section /);
  });

  it('leaves the queue entirely once every section has been reviewed', () => {
    // The whole point. Before the review events existed there was no state of the world in
    // which this row disappeared.
    const cleared = reviewed(freshProduct('home-fragrance'), [4, 8, 11, 13]);
    expect(sdsIssue(cleared)).toBeUndefined();
  });

  it('sends the maker to a screen that can actually clear it', () => {
    expect(sdsIssue(freshProduct('home-fragrance'))?.to).toBe('/products/prod-1');
  });
});

/**
 * The gaps `blankSpec` used to fill in silently.
 *
 * A new product no longer arrives holding a paraffin wax, a 250 ml tumbler and 100 g of
 * something nobody weighed. Every one of those is a label element or a component of the
 * classification, so an empty one has to be visible work rather than a quiet blank on a form.
 */
describe('the composition stage on a brand new product', () => {
  const labels = (product: Product) =>
  stageOf(product, 'composition').issues.map((issue) => issue.label);

  it('names every field the create form did not ask about', () => {
    const found = labels(freshProduct('home-fragrance'));
    expect(found).toContain('No base wax or carrier chosen yet');
    expect(found).toContain('No fragrance chosen yet');
    expect(found).toContain('No net quantity set');
    expect(found).toContain('No packaging chosen yet');
    expect(stageOf(freshProduct('home-fragrance'), 'composition').settled).toBe(false);
  });

  it('settles once the maker has answered them', () => {
    const product = freshProduct('home-fragrance');
    if (product.spec.kind !== 'mixture') throw new Error('expected a mixture');
    const filled: Product = {
      ...product,
      spec: {
        ...product.spec,
        baseId: 'ing-crw45',
        fragranceId: 'ing-black-fig',
        load: 8,
        netQuantity: 220,
        packagingId: 'pkg-tumbler-250'
      }
    };
    expect(stageOf(filled, 'composition').issues).toEqual([]);
    expect(stageOf(filled, 'composition').settled).toBe(true);
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
 * "Out of date" is a claim about a print that happened, and only about one.
 */
describe('the outputs stage on artefacts nobody has produced', () => {
  it('calls nothing stale, whatever state the surfaces are in', () => {
    const product = freshProduct('home-fragrance');
    for (const currency of ['not-produced', 'unknown'] as const) {
      const shaped: Product = {
        ...product,
        artefacts: product.artefacts.map((artefact) => ({ ...artefact, currency }))
      };
      expect(
        stageOf(shaped, 'outputs').issues.some((issue) => /no longer match/i.test(issue.label))
      ).toBe(false);
    }
  });

  it('raises it exactly when a recorded print has stopped matching', () => {
    const product = freshProduct('home-fragrance');
    const drifted: Product = {
      ...product,
      artefacts: product.artefacts.map((artefact) =>
      artefact.type === 'unit-label' ?
      { ...artefact, version: 'v1', currency: 'out-of-date' as const } :
      artefact
      )
    };
    expect(
      stageOf(drifted, 'outputs').issues.some((i) => /no longer match/i.test(i.label))
    ).toBe(true);
    expect(stageOf(drifted, 'outputs').summary).toMatch(/1 with a recorded print/);
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
