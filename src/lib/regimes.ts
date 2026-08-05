import { ArtefactType, Market, Product, RecordedEvidence, RegimeId, formatDate } from './model';
// `catalog.ts` is deleted. Ingredients are the maker's own rows now, published into the
// synchronous index by MaterialsProvider — and `materialsSettled` is the reason a regime can
// tell "the register has not answered yet" apart from "the register says no".
import { ingredientById, materialsSettled } from './material-index';

/**
 * A regime contributes exactly three things and nothing else: the artefact
 * blocks it requires, the obligations it adds to the compliance checklist,
 * and the derivations it runs. Adding a category is mostly adding regimes.
 */

export type ArtefactBlock = {
  key: string;
  label: string;
  regimeId: RegimeId | 'workspace';
  mandatory: boolean;
  artefactTypes: ArtefactType[];
  note?: string;
};

/**
 * Met, outstanding, or not tracked at all.
 *
 * The third state is the one that was missing, and its absence was a defect rather than an
 * omission. `products.obligations` is written by nothing — createProduct inserts `{}` and no
 * screen ever sets a key — so every obligation evaluated to "outstanding" forever, on every
 * product of every account. That is survivable when the sentence is honest about who owes
 * what. It is not survivable when the sentence asserts an event: "the composition changed
 * after the label was printed" is a statement about a print that never happened, rendered
 * under the maker's own product name on the first screen after sign-in.
 *
 * An obligation whose evidence Batchlabel cannot hold or observe is NOT_TRACKED. It still
 * appears — a real legal duty does not stop existing because we cannot see it — but it says
 * plainly that we are not the one checking, which is the difference between informing
 * somebody and inventing a finding about their business.
 */
export type ObligationState = 'met' | 'outstanding' | 'not-tracked';

export type Obligation = {
  id: string;
  regimeId: RegimeId;
  label: string;
  /**
   * Said when the obligation is MET.
   *
   * For everything that is discharged by a maker recording evidence, this is a sentence about
   * OUR RECORD and not about their business — "You recorded …" — because a log entry is the
   * only thing this software observed. The date is appended by the caller from the event.
   */
  doneText: string;
  /**
   * Said when the obligation is OUTSTANDING.
   *
   * THE ENTIRE CLASS OF DEFECT THE SURVEY FOUND LIVED IN THIS FIELD. Fifteen of these read as
   * findings about the maker's business — "No product information file has been assembled for
   * this product", "A test report is missing or has passed its validity date" — rendered under
   * their own product name, on the first screen after sign-in, by code that had checked
   * nothing. There was no document store, no test report anywhere in the repository, and the
   * flag they were reading was written by nobody.
   *
   * Every one of them now says what is true: that Batchlabel has no record of it. That is a
   * fact about our log, it is one this app can establish, and there is now a control that
   * changes it. Where a duty genuinely cannot be recorded or observed at all, the obligation
   * is NOT_TRACKED instead and says so in `untrackedText`.
   */
  missingText: string;
  /**
   * Said when the obligation is NOT_TRACKED. Names what Batchlabel does not do, and what the
   * maker must therefore do themselves. Never asserts a state we have not observed.
   */
  untrackedText?: string;
  /**
   * Whether a maker can discharge this by recording evidence in the log.
   *
   * False for the ones that are derived from the composition (`clp-classification`) — those
   * have an answer without being told — and for everything NOT_TRACKED.
   * A screen offers the "Record this" control exactly when this is true, which is what stops
   * a Resolve link pointing at a screen with nothing on it that can help.
   */
  recordable?: boolean;
  /** Route that fixes it, with :id replaced by the product id. */
  to: string;
  /** When set, the obligation only applies to products sold into this market. */
  market?: Market;
};

export type Regime = {
  id: RegimeId;
  name: string;
  short: string;
  reference: string;
  summary: string;
  blocks: ArtefactBlock[];
  obligations: Obligation[];
};

export const REGIMES: Regime[] = [
{
  id: 'clp',
  name: 'Classification, labelling and packaging',
  short: 'CLP',
  reference: 'Regulation (EC) No 1272/2008, as retained in GB law',
  summary:
  'Classifies a mixture from the concentration of its hazardous components and fixes the label elements that follow.',
  blocks: [
  { key: 'identifier', label: 'Product identifier', regimeId: 'clp', mandatory: true, artefactTypes: ['unit-label'] },
  { key: 'supplier', label: 'Supplier name and address', regimeId: 'clp', mandatory: true, artefactTypes: ['unit-label'] },
  { key: 'telephone', label: 'Telephone number', regimeId: 'clp', mandatory: true, artefactTypes: ['unit-label'], note: 'An email address does not satisfy this' },
  { key: 'quantity', label: 'Nominal quantity', regimeId: 'clp', mandatory: true, artefactTypes: ['unit-label'] },
  { key: 'pictograms', label: 'Hazard pictograms', regimeId: 'clp', mandatory: true, artefactTypes: ['unit-label', 'listing'] },
  { key: 'signalWord', label: 'Signal word', regimeId: 'clp', mandatory: true, artefactTypes: ['unit-label', 'listing'] },
  { key: 'hazard', label: 'Hazard statements', regimeId: 'clp', mandatory: true, artefactTypes: ['unit-label', 'listing'] },
  { key: 'precautionary', label: 'Precautionary statements', regimeId: 'clp', mandatory: true, artefactTypes: ['unit-label', 'listing'] },
  { key: 'allergen', label: 'Allergen line, EUH208', regimeId: 'clp', mandatory: true, artefactTypes: ['unit-label'] },
  { key: 'ufi', label: 'UFI', regimeId: 'clp', mandatory: true, artefactTypes: ['unit-label'], note: 'Batchlabel does not generate one. Get it from the ECHA UFI generator' },
  { key: 'batch', label: 'Batch number', regimeId: 'clp', mandatory: true, artefactTypes: ['unit-label'] }],

  obligations: [
  {
    id: 'clp-classification',
    regimeId: 'clp',
    label: 'Classification complete',
    // Not "from a document on file". No document of the maker's is held — there is no storage
    // bucket — and what this actually checks is that the fragrance oil on the composition
    // carries hazard rows in the register.
    doneText: 'The fragrance oil on this composition carries a hazard classification.',
    missingText:
    'The fragrance oil on this composition carries no hazard classification, so nothing has ' +
    'been derived from it.',
    untrackedText:
    'Your materials register has not loaded, so this has not been checked. It is not a ' +
    'finding about your product.',
    to: '/products/:id'
  },
  {
    /**
     * THE ONE OBLIGATION THAT STOPPED BEING UNTRACKABLE, and the reason the artefacts table
     * was worth wiring up. `batchlabel.artefacts` stores the composition fingerprint at the
     * moment a print was recorded, so "does what you printed still match the recipe" is now a
     * comparison of two md5s rather than a guess. See `artefactCurrency` below: the state comes
     * from the artefact rows and no evidence entry can set it, because a maker asserting their
     * label is current would be exactly the claim this app is supposed to be checking.
     */
    id: 'clp-artefact-current',
    regimeId: 'clp',
    label: 'Label recorded and still matching the composition',
    doneText: 'The label you last recorded printing was printed from the composition on file now.',
    missingText:
    'The composition, the pack, a pinned material or your printed business details changed after the last label print you recorded. Reprint, then record the new print.',
    untrackedText:
    'You have not recorded printing a label for this product, so Batchlabel cannot tell whether what is on your jars matches the composition on file. Record a print on the label designer and it will start checking.',
    to: '/products/:id/artefacts/unit-label'
  },
  {
    id: 'clp-ufi',
    regimeId: 'clp',
    label: 'UFI assigned',
    doneText: 'A UFI obtained from the ECHA UFI generator is on file for this composition.',
    missingText:
    'Batchlabel does not generate a UFI. Get one from the ECHA UFI generator for this composition and put it on the label yourself. The poison centre notification cannot be made without it.',
    untrackedText:
    'Batchlabel does not generate a UFI and does not yet hold the one you were issued. Get one from the ECHA UFI generator for this composition and put it on the label yourself — the poison centre notification cannot be made without it.',
    to: '/products/:id/artefacts/unit-label'
  },
  {
    id: 'clp-pcn-eu',
    regimeId: 'clp',
    label: 'Poison centre notification, EU and Northern Ireland',
    doneText: 'You recorded submitting this through the ECHA submission portal.',
    missingText:
    'Batchlabel has no record that you have submitted this. It does not submit notifications for you and never sees the portal — submit through ECHA before placing this product on the EU or Northern Ireland market, then record it here with the submission number.',
    recordable: true,
    to: '/products/:id',
    market: 'EU'
  },
  {
    id: 'clp-pcn-gb',
    regimeId: 'clp',
    label: 'GB notification to the National Poisons Information Service',
    doneText: 'You recorded submitting this to the National Poisons Information Service.',
    missingText:
    'Batchlabel has no record that you have submitted this. It does not submit to the NPIS for you — submit before placing this product on the GB market, then record it here.',
    recordable: true,
    to: '/products/:id',
    market: 'GB'
  }]

},
{
  id: 'en15494',
  name: 'Candle safety standard',
  short: 'EN 15494',
  reference: 'EN 15494:2019, candle fire safety labels',
  summary: 'Fixes the safety symbols and wording that must appear on candles and wax melts.',
  blocks: [
  {
    key: 'candleSafety',
    label: 'Candle safety symbols and text',
    regimeId: 'en15494',
    mandatory: true,
    artefactTypes: ['unit-label']
  }],

  obligations: [
  {
    id: 'en15494-safety-text',
    regimeId: 'en15494',
    label: 'Candle safety symbols and wording present',
    doneText: 'The three safety symbols and the required wording are on the label.',
    missingText: 'The safety symbols or wording are missing from the current label version.',
    untrackedText:
    'Batchlabel renders the candle safety block on every label it produces, but it does not store what you actually printed, so it cannot confirm the wording on your product. Check the printed label carries it.',
    to: '/products/:id/artefacts/unit-label'
  }]

},
{
  id: 'gpsr',
  name: 'General product safety',
  short: 'GPSR',
  reference: 'Regulation (EU) 2023/988 and the GB General Product Safety Regulations',
  summary:
  'Requires traceability, an economic operator in the market, and safety information shown before purchase.',
  blocks: [
  {
    key: 'onlineHazard',
    label: 'Hazard information shown before purchase',
    regimeId: 'gpsr',
    mandatory: true,
    artefactTypes: ['listing']
  },
  {
    key: 'traceability',
    label: 'Traceability block',
    regimeId: 'gpsr',
    mandatory: true,
    artefactTypes: ['listing']
  }],

  obligations: [
  {
    id: 'gpsr-traceability',
    regimeId: 'gpsr',
    label: 'Traceability records kept',
    doneText: 'Production records identify the product, the maker and the run.',
    missingText: 'Production records do not identify the run.',
    /*
     * STILL NOT_TRACKED, AND THE SENTENCE HAS BEEN REWRITTEN TWICE.
     *
     * It first read "Batchlabel does not hold production records", which stopped being true the
     * day `batchlabel.record_events` shipped. It was then reworded to say no production run is
     * written into it — which stopped being true the day the records screen's batch form
     * shipped. Both were the same mistake: a compliance sentence describing the software's
     * capabilities, which change under it.
     *
     * So this describes THE DUTY and what we can see of it, which does not move. A maker can
     * record a batch here, and doing so is worth doing. What no record here can establish is
     * that the code on the jars in a customer's hand matches the run that filled them: the
     * label is applied at fill time, this app never sees it, and the print records it holds
     * carry a fingerprint of the composition rather than the artwork. Deriving "met" from the
     * existence of a batch row would be exactly the invented finding this whole rail removed,
     * pointed the other way.
     */
    untrackedText:
    'Batchlabel holds the batch records you enter, and the recall search reads them. What it cannot see is the code actually printed on your jars, so it cannot confirm that a batch on a shelf is traceable to the run that filled it. That link is yours to keep.',
    to: '/records'
  },
  {
    id: 'gpsr-eu-responsible-person',
    regimeId: 'gpsr',
    label: 'Economic operator in the EU',
    doneText: 'You recorded an EU based economic operator for this product.',
    missingText:
    'Batchlabel has no record of an EU based economic operator for this product. One has to be named and reachable before it is placed on the EU market — record who it is and where.',
    recordable: true,
    to: '/products/:id',
    market: 'EU'
  },
  {
    id: 'gpsr-online-disclosure',
    regimeId: 'gpsr',
    label: 'Safety information shown online before purchase',
    doneText: 'Signal word, pictograms and hazard statements appear on the listing.',
    missingText: 'The product page does not show the safety information before purchase.',
    untrackedText:
    'Batchlabel never sees your shop listing, so it cannot check what appears on it. Make sure the safety information is shown to a buyer before they purchase.',
    to: '/products/:id/artefacts/listing'
  }]

}];


export function regimeById(id: RegimeId): Regime {
  return REGIMES.find((r) => r.id === id) ?? REGIMES[0];
}

export function regimesFor(product: Product): Regime[] {
  return product.regimes.map(regimeById);
}

/** Blocks the product's regimes require on a given artefact, plus the optional branding block. */
export function blocksFor(product: Product, artefactType: ArtefactType): ArtefactBlock[] {
  const blocks: ArtefactBlock[] = [];
  for (const regime of regimesFor(product)) {
    for (const block of regime.blocks) {
      if (!block.artefactTypes.includes(artefactType)) continue;
      if (blocks.some((b) => b.key === block.key)) continue;
      blocks.push(block);
    }
  }
  if (artefactType !== 'listing') {
    blocks.push({
      key: 'branding',
      label: 'Your branding block',
      regimeId: 'workspace',
      mandatory: false,
      artefactTypes: [artefactType],
      note: 'Optional'
    });
  }
  return blocks;
}

/** Every obligation the product's regimes place on it, filtered to its markets. */
export function obligationsFor(product: Product): Obligation[] {
  const result: Obligation[] = [];
  for (const regime of regimesFor(product)) {
    for (const obligation of regime.obligations) {
      if (obligation.market && !product.markets.includes(obligation.market)) continue;
      result.push(obligation);
    }
  }
  return result;
}

export function obligationRoute(obligation: Obligation, productId: string): string {
  return obligation.to.replace(':id', productId);
}

/**
 * Obligations Batchlabel has no way to observe, whatever is stored against the product.
 *
 * This was previously called UNSATISFIABLE and held only `clp-ufi`, and it meant "always
 * render as outstanding". That was right for the UFI by accident: its copy already said
 * plainly that Batchlabel does not generate one, so a permanent "outstanding" read as
 * information rather than as a finding.
 *
 * It was wrong for everything else. `products.obligations` is written by nothing, so EVERY
 * obligation was outstanding forever, and four of them assert events the software has never
 * observed — a label printed, a composition changed since, a production run recorded, a shop
 * listing inspected. Rendered under the maker's own product name on the first screen after
 * sign-in, that is not a reminder. It is an invented finding about their business.
 *
 * These now resolve to 'not-tracked' and say what Batchlabel does not do. The duty is real
 * and still shown; the claim to have checked it is what goes.
 *
 * Delete an id from here the day the mechanism behind it exists — and delete the
 * untrackedText with it, so the two can never drift apart.
 */
const NOT_TRACKED: ReadonlySet<string> = new Set([
  // Needs sight of what was actually PRINTED, not of the fact that a print happened. The
  // artefact rows carry a version, a date and a fingerprint of the composition; they do not
  // carry the artwork, so nothing here can confirm a symbol or a mark is on the label.
  'en15494-safety-text',
  // Needs a UFI, which Batchlabel does not generate and does not yet hold.
  'clp-ufi',
  // Needs sight of the code printed on the jar, which no batch record in the log carries. The
  // log holds runs now; it does not hold what was applied to the pack at fill time.
  'gpsr-traceability',
  // Needs sight of the shop listing, which Batchlabel will never have.
  'gpsr-online-disclosure'
]);

/**
 * `clp-artefact-current` LEFT THIS SET, and it is the only one that has.
 *
 * It was here because "nothing stores artefacts", which was true and is not any more:
 * `batchlabel.artefacts` holds a row per recorded print carrying the composition fingerprint
 * at that moment, and `batchlabel.artefact_source_fingerprint` recomputes it. Currency is
 * therefore a comparison of two database values rather than an assumption, which is exactly the
 * bar this file's own comment set — "delete an id from here the day the mechanism behind it
 * exists". Its `untrackedText` survives, because a product with no recorded print still has
 * nothing to compare and still must not be told its label has drifted.
 *
 * `clp-pcn-eu` and `clp-pcn-gb` also left, for a weaker but sufficient reason: Batchlabel still
 * does not submit them and still never sees the portal, but it can now hold the maker's own
 * statement that they submitted, with the reference. Their sentences say which of those two
 * things is being claimed.
 */

/**
 * Whether every component of the composition carries hazard data in the reference library.
 *
 * `clp-classification` used to read a flag nothing sets, so it rendered "one or more
 * components have no classification on file" on the same screen where the classification
 * stage showed a green tick and a full derivation. A screen that contradicts itself teaches
 * a maker to ignore both halves.
 *
 * It is derivable, and the pipeline already derives it (pipeline.ts:128-137). Same rule here,
 * so the two cannot disagree: a fragrance oil with no hazards in the reference data
 * contributes nothing to the mixture, and that is the only gap this obligation is about.
 */
function classificationComplete(product: Product): boolean {
  if (product.spec.kind !== 'mixture') return true;
  const fragranceId = product.spec.fragranceId;
  if (!fragranceId) return false;
  const fragrance = ingredientById(fragranceId);
  return Boolean(fragrance && fragrance.hazards.length > 0);
}

/**
 * The obligations answered by looking at the product rather than by being told.
 *
 * Exported so a test can assert the thing that matters structurally: EVERY obligation must be
 * derived, recordable, or not-tracked. An obligation in none of the three is one nothing can
 * ever satisfy — which is what fifteen of them were, permanently outstanding on every product
 * of every account, with Resolve links to screens that could not change them. That state is now
 * unreachable by construction rather than by everyone remembering.
 */
export const DERIVED_OBLIGATIONS: ReadonlySet<string> = new Set([
  'clp-classification',
  'clp-artefact-current'
]);

/**
 * Where the recorded label prints stand against the composition.
 *
 * Reads the LABEL surfaces only. A safety data sheet is not a label, and a listing is a shop
 * page rather than something on the product, so neither can discharge a CLP labelling duty;
 * `clp-artefact-current` is about what is on the jar.
 *
 * 'not-produced' when nothing has been recorded, and that is the state that becomes
 * 'not-tracked' rather than 'outstanding'. Telling a maker their label drifted when they have
 * never recorded printing one is a false statement about their compliance.
 */
function artefactCurrency(product: Product): 'current' | 'out-of-date' | 'unknown' | 'not-produced' {
  const labels = product.artefacts.filter((artefact) => artefact.type === 'unit-label');
  const produced = labels.filter((artefact) => artefact.currency !== 'not-produced');
  if (produced.length === 0) return 'not-produced';
  // One stale surface is enough: a product carrying a label that no longer describes it is out
  // of date however many other surfaces still match.
  if (produced.some((artefact) => artefact.currency === 'out-of-date')) return 'out-of-date';
  if (produced.some((artefact) => artefact.currency === 'unknown')) return 'unknown';
  return 'current';
}

/**
 * The single answer to "where does this obligation stand", for every screen that asks.
 *
 * THE LAST LINE USED TO BE `product.obligations[obligationId] === true`, over a jsonb column
 * written by nothing. That is what made fifteen obligations permanently outstanding and their
 * Resolve links inert. It now reads the append-only log, which has a write path — see
 * lib/evidence.ts — so "outstanding" means "you have not recorded this with us", and the
 * screens say exactly that.
 */
export function obligationState(product: Product, obligationId: string): ObligationState {
  if (NOT_TRACKED.has(obligationId)) return 'not-tracked';

  if (obligationId === 'clp-classification') {
    /*
     * THE REGISTER HAS TO HAVE ANSWERED BEFORE THIS ONE CAN.
     *
     * `classificationComplete` resolves the fragrance oil out of the materials register.
     * Materials used to be a constant in the bundle, so the lookup could not fail and this
     * obligation was always answerable. They are rows read from Supabase now, and before that
     * read lands — or if it fails — the lookup misses and this obligation would report
     * OUTSTANDING: a compliance finding, in a work queue, under the maker's own product name,
     * produced by a read that had not finished.
     *
     * `not-tracked` is the state that already exists for exactly this — a duty that is real
     * and that we are not the ones checking — and its copy says so rather than implying the
     * maker owes work.
     */
    if (!materialsSettled()) return 'not-tracked';
    return classificationComplete(product) ? 'met' : 'outstanding';
  }

  if (obligationId === 'clp-artefact-current') {
    const currency = artefactCurrency(product);
    if (currency === 'current') return 'met';
    if (currency === 'out-of-date') return 'outstanding';
    // Nothing recorded, or a fingerprint we could not compute. Neither is a finding.
    return 'not-tracked';
  }

  return obligationId in product.evidence.obligations ? 'met' : 'outstanding';
}

/**
 * Where an obligation stands AND the sentence to show for it, in one answer.
 *
 * The three texts on an Obligation are per-state and a screen has to pick between them, which
 * is three chances to pick the wrong one — the specification screen and Studio each used to do
 * their own picking. This does it once, appends the date from the log entry when the state came
 * from something the maker recorded, and hands back the evidence so a screen can show the
 * reference beside it.
 */
export type ObligationOutcome = {
  state: ObligationState;
  text: string;
  /** Present only when `state` is 'met' and the answer came from the log. */
  evidence?: RecordedEvidence;
};

export function obligationOutcome(product: Product, obligation: Obligation): ObligationOutcome {
  const state = obligationState(product, obligation.id);

  if (state === 'not-tracked') {
    return {
      state,
      // Falling back to missingText would print a finding in the one state that exists to
      // avoid printing findings, so an obligation with no untrackedText says the plain thing
      // instead. Every id in NOT_TRACKED has one; this is the guard for the next one added.
      text:
      obligation.untrackedText ??
      'Batchlabel does not check this one, so it cannot tell you where it stands. It is still your duty.'
    };
  }

  if (state === 'outstanding') return { state, text: obligation.missingText };

  const evidence = product.evidence.obligations[obligation.id];
  if (!evidence) {
    // Derived rather than recorded — clp-classification, clp-artefact-current. The
    // doneText stands on its own for those, because the thing that satisfied them is on screen.
    return { state, text: obligation.doneText };
  }

  const when = evidence.recordedAt ? formatDate(evidence.recordedAt) : null;
  return {
    state,
    text: when ? `${obligation.doneText} Recorded as happening on ${when}.` : obligation.doneText,
    evidence
  };
}

/**
 * Kept for callers that only need the boolean.
 *
 * `not-tracked` is NOT satisfied — the duty may well be unmet — but it is not outstanding
 * work this app can claim to have found either. Anything rendering a work queue should ask
 * obligationState and skip 'not-tracked'; anything rendering a checklist should show all
 * three states.
 */
export function obligationSatisfied(product: Product, obligationId: string): boolean {
  return obligationState(product, obligationId) === 'met';
}

/** Every obligation the product still owes. */
export function outstandingObligations(product: Product): Obligation[] {
  // 'not-tracked' is excluded deliberately. This feeds work queues, and a queue is a list of
  // things we have established are undone. An obligation we cannot observe belongs on the
  // product's checklist, where it can say so, not in a count of the maker's outstanding work.
  return obligationsFor(product).filter(
    (obligation) => obligationState(product, obligation.id) === 'outstanding'
  );
}

/** Obligations that are real duties Batchlabel does not check. Shown, never counted. */
export function untrackedObligations(product: Product): Obligation[] {
  return obligationsFor(product).filter(
    (obligation) => obligationState(product, obligation.id) === 'not-tracked'
  );
}