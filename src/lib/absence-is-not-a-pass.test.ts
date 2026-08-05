import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { geometryRules, geometryVerdict, derive } from './derive';
import { FIXTURE_MATERIALS } from './fixtures';
import { publishMaterialStatus, publishMaterials, resetMaterials } from './material-index';
import { Product, RecordedEvidence } from './model';
import { queueAcross, queueFor, stagesFor } from './pipeline';
import { REGIMES, obligationOutcome, obligationState } from './regimes';

/**
 * ABSENCE IS NOT A PASS.
 *
 * Three states keep collapsing into two in this codebase, always in the reassuring direction:
 *
 *   NOT CHECKED    no check exists, or the one that exists could not run
 *   NOT FOUND      the check ran, and the thing it needed was not there
 *   CHECKED, PASSED
 *
 * Every case below is one place where the third rendering was given to one of the first two.
 * They are unit-level on purpose — the screens have their own files — because the fix for
 * each was to give the thing BEHIND the screen the ability to answer, rather than to reword
 * the screen over the same missing mechanism.
 */

function evidence(id: string): RecordedEvidence {
  return { id, recordedAt: '2026-01-04', reference: 'REF-1', summary: 'Recorded in a test' };
}

/**
 * A complete, GB-only, CLP-only mixture with nothing left to do.
 *
 * SHAPED SO THAT THE QUEUE IS GENUINELY EMPTY once the register answers, because an empty
 * queue is the state the defect hides in. Every slot is filled, the one recordable obligation
 * has an evidence entry, and it holds no artefacts — so nothing is stale, no safety data
 * sheet section is awaiting a competent person, and `clp-artefact-current` is not-tracked
 * rather than a finding.
 */
function settledProduct(overrides: Partial<Product['spec']> = {}): Product {
  return {
    id: 'p-1',
    name: 'Ash and Amber',
    sku: 'AA-001',
    categoryId: 'home-fragrance',
    markets: ['GB'],
    regimes: ['clp'],
    identifiers: {},
    spec: {
      kind: 'mixture',
      productType: 'Container candle',
      baseId: 'ing-crw45',
      fragranceId: 'ing-black-fig',
      load: 8,
      dyeId: '',
      additive: 'None',
      netQuantity: 220,
      netUnit: 'g',
      packagingId: 'pkg-tumbler-250',
      ...overrides
    } as Product['spec'],
    artefacts: [],
    evidence: { obligations: { 'clp-pcn-gb': evidence('clp-pcn-gb') }, sdsSections: {} }
  };
}

function queue(product: Product) {
  return queueFor(product, derive(product.spec, product, 'GB'), 'GB');
}

beforeEach(() => resetMaterials());
afterEach(() => resetMaterials());

/**
 * FINDING 4, AT THE LEVEL WHERE IT ACTUALLY LIVED.
 *
 * The queue was `stagesFor(...).flatMap((stage) => stage.issues.map(...))`. Every input to
 * that line is honest: with the register unanswered the classification stage raises no issues
 * and says `checked: false`, `clp-classification` is not-tracked rather than outstanding, and
 * work queues exclude not-tracked because a queue is a list of things we ESTABLISHED are
 * undone. The flatMap dropped `checked` on the floor, and Studio rendered the empty result as
 * "Every composition is settled, every material is classified, and nothing is waiting on you."
 *
 * So the queue has to carry both halves. These tests are about the SECOND half being there at
 * all; if it is not, no amount of rewording on the screen can be true.
 */
describe('a work queue built while a check could not run', () => {
  it('is empty of issues either way, which is why the issues alone cannot be trusted', () => {
    publishMaterialStatus('error', 'acct-1');
    const failed = queue(settledProduct());
    publishMaterials('acct-1', FIXTURE_MATERIALS);
    const answered = queue(settledProduct());

    // Identical. This is the defect: a failed register read and a clean bill of health are
    // indistinguishable from the issue list.
    expect(failed.issues).toHaveLength(0);
    expect(answered.issues).toHaveLength(0);
  });

  it('says which check did not run, and says nothing when they all did', () => {
    publishMaterialStatus('error', 'acct-1');
    expect(queue(settledProduct()).blocked).toEqual(['your materials register could not be read']);

    publishMaterials('acct-1', FIXTURE_MATERIALS);
    expect(queue(settledProduct()).blocked).toEqual([]);
  });

  it('tells a read still in flight apart from a read that failed', () => {
    publishMaterialStatus('loading', 'acct-1');
    expect(queue(settledProduct()).blocked[0]).toMatch(/has not finished loading/);
    publishMaterialStatus('error', 'acct-1');
    expect(queue(settledProduct()).blocked[0]).toMatch(/could not be read/);
  });

  /**
   * The stage that has no check AT ALL does not report a blockage, and that distinction is the
   * whole reason `blockedBy` is not just `!checked`. Documents is `checked: false` forever
   * because Batchlabel watches no supplier documents; saying so once in the copy is honest and
   * never changes. Classification is `checked: false` only while a read is outstanding, which
   * is a transient hole a maker is entitled to be told about. Conflating them would put a
   * permanent "some checks did not run" banner on every screen, which teaches people to ignore
   * it — and an ignored warning is the same as no warning.
   */
  it('does not report the documents stage, which has no check to block', () => {
    publishMaterials('acct-1', FIXTURE_MATERIALS);
    const documents = stagesFor(settledProduct(), derive(settledProduct().spec, settledProduct(), 'GB'), 'GB').
    find((stage) => stage.id === 'documents');
    expect(documents?.checked).toBe(false);
    expect(documents?.blockedBy).toBeUndefined();
  });

  it('pools the blockages across products without repeating one', () => {
    publishMaterialStatus('error', 'acct-1');
    const across = queueAcross([queue(settledProduct()), queue(settledProduct())]);
    expect(across.blocked).toHaveLength(1);
  });
});

/**
 * FINDING 5. Two screens answered "how much is outstanding on this product" with two
 * different functions, and disagreed by three CLP Article 17 label elements.
 *
 * `outstandingObligations` is the regime checklist alone: it never looks at the pipeline
 * stages, so no base wax, no packaging and no net quantity counted as zero and the products
 * table painted a green "Complete" over a product that cannot legally be labelled — while
 * Studio, in the same session, listed the three.
 *
 * The fix is one function, so the assertion is that one function exists and covers both.
 */
describe('what is outstanding on a product, asked once', () => {
  it('counts the composition gaps the obligation checklist has never looked at', () => {
    publishMaterials('acct-1', FIXTURE_MATERIALS);
    const bare = settledProduct({ baseId: '', packagingId: '', netQuantity: 0 } as never);

    const labels = queue(bare).issues.map((issue) => issue.label);
    expect(labels).toContain('No base wax or carrier chosen yet');
    expect(labels).toContain('No packaging chosen yet');
    expect(labels).toContain('No net quantity set');
  });

  it('still includes every outstanding obligation, so nothing was traded away', () => {
    publishMaterials('acct-1', FIXTURE_MATERIALS);
    // No evidence for the GB poison centre notification this time: a recordable obligation the
    // maker genuinely owes, which reaches the queue through the outputs stage.
    const owing: Product = { ...settledProduct(), evidence: { obligations: {}, sdsSections: {} } };
    expect(queue(owing).issues.map((issue) => issue.label)).toContain(
      'GB notification to the National Poisons Information Service'
    );
  });
});

/**
 * FINDING 6. `rules.every((rule) => rule.ok !== false)` reads a rule with NO VERDICT as a rule
 * that passed. derive.ts is explicit that undefined means unchecked — the comment beside the
 * rule says so in as many words — and the pill went green over it anyway.
 *
 * This is now the state of every new product: `blankSpec` no longer seeds a packaging id, so
 * there is no capacity, so CLP Annex I Table 1.3 has no band and the only rule on the card is
 * the one that declines to state a minimum.
 */
describe('the verdict on a surface', () => {
  it('is unchecked when the only rule was never evaluated', () => {
    publishMaterials('acct-1', FIXTURE_MATERIALS);
    const noPack = settledProduct({ packagingId: '' } as never);
    const rules = geometryRules(noPack, 52, 74);

    expect(rules).toHaveLength(1);
    expect(rules[0].ok).toBeUndefined();
    // The expression that used to paint this pill green.
    expect(rules.every((rule) => rule.ok !== false)).toBe(true);
    expect(geometryVerdict(rules)).toBe('unchecked');
  });

  it('is a pass only when every rule returned a verdict', () => {
    expect(geometryVerdict([{ label: 'a', value: '1', source: 's', ok: true }])).toBe('pass');
    expect(
      geometryVerdict([
      { label: 'a', value: '1', source: 's', ok: true },
      { label: 'b', value: '2', source: 's' }]
      )
    ).toBe('unchecked');
  });

  /**
   * A failure OUTRANKS an unrun check, and that is not the same asymmetry pointing the other
   * way. A rule that ran and failed is a fact about this surface; the checks that did not run
   * cannot take it back.
   */
  it('is a failure even when something else went unchecked', () => {
    expect(
      geometryVerdict([
      { label: 'a', value: '1', source: 's', ok: false },
      { label: 'b', value: '2', source: 's' }]
      )
    ).toBe('fail');
  });

  it('is unchecked, not a pass, when there are no rules at all', () => {
    expect(geometryVerdict([])).toBe('unchecked');
  });
});

/**
 * FINDING 7. `ingredientById` returns undefined for two unrelated facts, and
 * `classificationComplete` returned `false` for both — so a lookup miss and a genuinely
 * unclassified oil printed the same sentence: "The fragrance oil on this composition carries
 * no hazard classification, so nothing has been derived from it."
 *
 * `derive` and `pipeline` both get this right and say the register has no live material with
 * that id, which is how one panel came to assert a fact about an oil while the panel beside it
 * correctly said the oil could not be found.
 *
 * Four causes, four sentences. The state stays one of met | outstanding | not-tracked.
 */
describe('the classification obligation, and the four reasons it can be unmet', () => {
  const obligation = REGIMES[0].obligations.find((entry) => entry.id === 'clp-classification');
  if (!obligation) throw new Error('clp-classification is no longer in the CLP regime');
  const outcome = (product: Product) => obligationOutcome(product, obligation);

  it('does not blame the oil when the register has not answered', () => {
    publishMaterialStatus('error', 'acct-1');
    const answer = outcome(settledProduct());
    expect(answer.state).toBe('not-tracked');
    expect(answer.text).toMatch(/not a finding about your product/i);
  });

  it('does not blame the oil when no oil has been chosen', () => {
    publishMaterials('acct-1', FIXTURE_MATERIALS);
    const answer = outcome(settledProduct({ fragranceId: '' } as never));
    expect(answer.state).toBe('outstanding');
    expect(answer.text).toMatch(/no fragrance oil is chosen/i);
    // The sentence it used to print, which asserts a property of an oil that is not there.
    expect(answer.text).not.toMatch(/carries no hazard classification/i);
  });

  it('says the material could not be found, rather than that it is unclassified', () => {
    publishMaterials('acct-1', FIXTURE_MATERIALS);
    const answer = outcome(settledProduct({ fragranceId: 'ing-not-in-register' } as never));
    expect(answer.state).toBe('outstanding');
    expect(answer.text).toMatch(/no ingredient with that id/i);
    expect(answer.text).not.toMatch(/carries no hazard classification/i);
  });

  /**
   * AND IT DOES NOT BLAME ARCHIVING, which is the one explanation that stopped being true when
   * this branch was merged with the material/product-link work.
   *
   * Both sentences were correct on their own branch. There, archiving dropped a material out of
   * `materialById`, so "it may have been archived" was a real cause of a lookup miss. The other
   * branch made the register read archived rows and answer for them — that is what makes "a
   * product built on it keeps working" true — and the moment the two met, the explanation named
   * a mechanism that can no longer produce this state. Offering it would teach the maker that
   * archiving loses things, which is the reverse of what archiving does.
   */
  it('does not offer archiving as the reason, because archiving cannot cause this', () => {
    publishMaterials('acct-1', FIXTURE_MATERIALS);
    const answer = outcome(settledProduct({ fragranceId: 'ing-not-in-register' } as never));
    expect(answer.text).not.toMatch(/may have been archived/i);
    // It says so outright, rather than staying silent and leaving the maker to guess.
    expect(answer.text).toMatch(/has not been archived/i);
  });

  /**
   * THE MECHANISM UNDER THAT SENTENCE, asserted directly so the wording cannot drift away from
   * it. An archived material still resolves, so it is never `unresolved` and never reaches any
   * of the copy above.
   */
  it('an archived material resolves and keeps classifying the product built on it', () => {
    const oil = FIXTURE_MATERIALS.find((material) => material.id === 'ing-black-fig');
    if (!oil) throw new Error('ing-black-fig is no longer in the fixtures');
    publishMaterials(
      'acct-1',
      FIXTURE_MATERIALS.map((material) =>
      material.id === 'ing-black-fig' ? { ...material, archived: true } : material
      )
    );
    const product = settledProduct();
    expect(derive(product.spec, product, 'GB').unresolved).toEqual([]);
    expect(outcome(product).state).toBe('met');
  });

  /**
   * AND IT SAYS THE SAME THING THE PANEL BESIDE IT SAYS. The specification screen renders this
   * row next to the classification stage, which reports the same missing material from
   * `derivation.unresolved`. Two sentences about one fact is how a maker learns to trust
   * neither.
   */
  it('agrees with the pipeline stage rendered beside it', () => {
    publishMaterials('acct-1', FIXTURE_MATERIALS);
    const ghost = settledProduct({ fragranceId: 'ing-not-in-register' } as never);
    const details = queue(ghost).issues.map((issue) => issue.detail);
    const stage = details.join(' ');
    expect(stage).toMatch(/no material with that id/i);
    expect(outcome(ghost).text).toMatch(/no ingredient with that id/i);

    /*
     * AND THE QUEUE DOES NOT ALSO SAY THE OTHER THING. Asserting that the true sentence is
     * present was not enough: the queue printed BOTH, because the outstanding-obligations
     * mapping in `pipeline.ts` took `obligation.missingText` directly instead of asking
     * `obligationOutcome`. So one work queue carried "the register has no material with that
     * id" and "the fragrance oil on this composition carries no hazard classification" about
     * the same absent oil, one after the other.
     */
    expect(stage).not.toMatch(/carries no hazard classification/i);
  });

  it('still reports a real gap in the register as a real gap', () => {
    publishMaterials('acct-1', FIXTURE_MATERIALS);
    // 'ing-crw45' is a wax: in the register, and carrying no hazard rows.
    const answer = outcome(settledProduct({ fragranceId: 'ing-crw45' } as never));
    expect(answer.state).toBe('outstanding');
    expect(answer.text).toMatch(/carries no hazard classification/i);
  });

  it('is met when the oil is there and carries hazards', () => {
    publishMaterials('acct-1', FIXTURE_MATERIALS);
    expect(obligationState(settledProduct(), 'clp-classification')).toBe('met');
    expect(outcome(settledProduct()).state).toBe('met');
  });
});
