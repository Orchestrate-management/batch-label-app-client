import {
  ingredientById,
  materialCitation,
  materialsSettled,
  packagingById } from
'./material-index';
import {
  IngredientMaterial,
  Market,
  MixtureSpec,
  Product,
  RegimeId,
  Spec,
  round } from
'./model';

/**
 * The derivation engine. One shape of result for every regime, so the panel
 * that shows the working does not care which regulation produced it.
 */

export type WhyLine = {
  lead: string;
  meta?: string;
  source?: string;
};

export type DerivedItem = {
  code?: string;
  text: string;
  why: WhyLine[];
  tone?: 'default' | 'warn';
};

export type DerivedGroup = {
  id: string;
  title: string;
  regimeId: RegimeId;
  items: DerivedItem[];
  emptyText?: string;
};

export type ProximityNote = {
  code: string;
  message: string;
};

export type ClpResult = {
  signalWord: 'Warning' | 'Danger' | null;
  pictograms: Array<'GHS07' | 'GHS09' | 'GHS02'>;
  hazards: Array<{code: string;text: string;}>;
  precautions: Array<{code: string;text: string;}>;
  allergenLine: string | null;
  supplementary: Array<{code: string;text: string;}>;
};

/**
 * A material the composition names and the register could not produce.
 *
 * WHY THIS IS A FIELD RATHER THAN A SILENT SKIP, and it is the single most important line in
 * this file. Materials used to be a constant compiled into the bundle, so every id on every
 * composition resolved by construction and the "not found" branch was unreachable. They are
 * rows now, and an id that resolves to nothing contributes nothing — so a mixture whose
 * fragrance oil the register cannot produce derives NO HAZARD STATEMENTS and the group
 * underneath it reads "No hazard statements are required at this fragrance load".
 *
 * ARCHIVING NO LONGER CAUSES THAT, and it is worth saying because it did. `fetchMaterials`
 * reads archived rows and `materialById` answers for them; only the pickers and the register
 * lists filter. So the ids that land here are genuinely absent — a stale link, or a material
 * belonging to another account — and nothing that renders this field may offer archiving as
 * the explanation.
 *
 * That sentence would be a compliance claim about a real candle, produced by a lookup miss.
 * It is the exact defect this round of work exists to remove, and it is worse than the ones
 * already removed, because it removes warnings rather than adding them.
 */
export type UnresolvedMaterial = {
  /** Which part of the composition asked for it: 'Fragrance oil', 'Base', 'Phase item'. */
  slot: string;
  id: string;
};

export type Derivation = {
  summary: Array<{label: string;value: string;}>;
  groups: DerivedGroup[];
  proximity: ProximityNote[];
  /**
   * True when the register has not settled — not loaded, still loading, or the read failed.
   *
   * A pending derivation is not a derivation. Every screen rendering one has to say so, and
   * none of them may present an empty result as an answer. See lib/material-index.ts.
   */
  pending: boolean;
  /** Materials the composition names that the register did not produce. */
  unresolved: UnresolvedMaterial[];
  clp?: ClpResult;
};

/**
 * Whether the hazard group may say "nothing is required", or has to say "we could not tell".
 *
 * One helper, so every group reasoning about an empty hazard list comes to the same
 * conclusion about the same silence.
 */
function emptyHazardText(pending: boolean, unresolved: UnresolvedMaterial[], settled: string): string {
  if (pending) {
    return 'Your materials register has not loaded, so nothing has been classified yet. This ' +
    'is not a finding about your composition.';
  }
  if (unresolved.length) {
    return `Nothing could be classified: ${unresolved.
    map((entry) => `${entry.slot.toLowerCase()} "${entry.id}"`).
    join(', ')} ${unresolved.length === 1 ? 'is' : 'are'} not in your materials register. ` +
    'This is a gap in the register, not a statement that the product is unclassified.';
  }
  return settled;
}

/*
 * `today()` and `daysUntil()` LIVED HERE AND ARE GONE WITH THEIR ONLY CALLER.
 *
 * They powered one thing: a countdown to a certificate expiry date carried in the shipped
 * component catalogue. The catalogue is deleted, so there is no date to count down to, and a
 * date-arithmetic helper kept "for when it comes back" is how the next invented countdown
 * gets written. The lesson they were rewritten for is worth keeping, though: the constant
 * `new Date('2026-07-30')` they started life with made "expires in 45 days" wrong by one day
 * for every day the build stayed deployed. A number of days is a claim about today.
 */

const P_LIBRARY: Record<string, string> = {
  P101: 'If medical advice is needed, have product container or label at hand.',
  P102: 'Keep out of reach of children.',
  P210: 'Keep away from heat, hot surfaces, sparks, open flames and other ignition sources. No smoking.',
  P233: 'Keep container tightly closed.',
  P261: 'Avoid breathing spray.',
  P264: 'Wash hands thoroughly after handling.',
  P273: 'Avoid release to the environment.',
  P280: 'Wear protective gloves.',
  'P305+P351+P338':
  'IF IN EYES: Rinse cautiously with water for several minutes. Remove contact lenses, if present and easy to do. Continue rinsing.',
  'P302+P352': 'IF ON SKIN: Wash with plenty of water.',
  'P333+P313': 'If skin irritation or rash occurs: Get medical advice.',
  'P337+P313': 'If eye irritation persists: Get medical advice.',
  P501: 'Dispose of contents and container in accordance with local regulations.'
};

/** EUH208 is declared for sensitising fragrance allergens at or above 0.1 percent in a mixture. */
export const EUH208_THRESHOLD = 0.1;

/* --------------------------------------------------- mixture, CLP regime */

export function deriveMixture(spec: MixtureSpec): Derivation {
  const pending = !materialsSettled();
  const fragrance = ingredientById(spec.fragranceId);
  const base = ingredientById(spec.baseId);
  const dye = ingredientById(spec.dyeId);

  // An id that was SET and did not resolve. An unset slot is a composition the maker has not
  // finished, which the pipeline already reports; an id that resolves to nothing is a
  // classification quietly missing an input, which nothing reported until now.
  const unresolved: UnresolvedMaterial[] = [];
  if (spec.fragranceId && !fragrance) unresolved.push({ slot: 'Fragrance oil', id: spec.fragranceId });
  if (spec.baseId && !base) unresolved.push({ slot: 'Base', id: spec.baseId });
  if (spec.dyeId && !dye) unresolved.push({ slot: 'Dye', id: spec.dyeId });

  const components: Array<{ingredient: IngredientMaterial;pct: number;}> = [];
  if (fragrance) components.push({ ingredient: fragrance, pct: spec.load });
  if (base) {
    components.push({
      ingredient: base,
      pct: round(100 - spec.load - (dye ? 0.5 : 0))
    });
  }
  if (dye) components.push({ ingredient: dye, pct: 0.5 });

  const hazardMap = new Map<string, DerivedItem>();
  const pictograms = new Set<ClpResult['pictograms'][number]>();
  const proximity: ProximityNote[] = [];
  /**
   * Hazards that cannot be placed, because the material carries no concentration limit.
   *
   * `material_hazards.gcl` is nullable — a supplier does not always state one — and the column
   * comment gives the rule: "a null must be rendered as unknown and never as zero". Zero
   * transfers the hazard at every load; a hundred transfers it at none. Both are decisions,
   * and we do not have the number to make one. These are shown in the working, and they are
   * deliberately NOT in `clp.hazards`: an undecided hazard must not print on a label as
   * though it had been decided, and must not vanish either.
   */
  const undecidable: DerivedItem[] = [];
  let signalWord: ClpResult['signalWord'] = null;

  for (const { ingredient, pct } of components) {
    for (const hazard of ingredient.hazards) {
      const threshold = hazard.scl ?? hazard.gcl;
      const thresholdType =
      hazard.scl != null ? 'Specific concentration limit' : 'Generic concentration limit';

      if (threshold == null) {
        undecidable.push({
          code: hazard.code,
          tone: 'warn',
          text: `${hazard.statement} — not placed, because no concentration limit is recorded.`,
          why: [
          {
            lead: `${ingredient.name} carries ${hazard.code} (${hazard.hazardClass}) at 100 percent and is present at ${round(pct)} percent of the finished product.`,
            meta:
            'No generic or specific concentration limit is recorded for it, so whether the ' +
            'hazard transfers to the mixture cannot be worked out. Add the limit from the ' +
            'supplier\'s safety data sheet, section 3, and this will resolve either way.',
            source: materialCitation(ingredient)
          }]

        });
        continue;
      }

      const why: WhyLine = {
        lead: `${ingredient.name} is present at ${round(pct)} percent of the finished product.`,
        meta: `${hazard.hazardClass} threshold crossed at ${threshold} percent. ${thresholdType}${
        hazard.scl != null ? ', taken from the supplier document' : ', from CLP Annex I'}.${
        hazard.derivation ? ` ${hazard.derivation}` : ''}`,
        source: materialCitation(ingredient)
      };

      if (pct >= threshold) {
        const existing = hazardMap.get(hazard.code);
        if (existing) existing.why.push(why);else
        hazardMap.set(hazard.code, { code: hazard.code, text: hazard.statement, why: [why] });
        if (hazard.pictogram) pictograms.add(hazard.pictogram);
        if (hazard.signal === 'Danger') signalWord = 'Danger';else
        if (hazard.signal === 'Warning' && signalWord !== 'Danger') signalWord = 'Warning';
      }

      if (ingredient.role === 'Fragrance oil') {
        const distance = Math.abs(pct - threshold) / threshold;
        if (distance <= 0.25 && threshold < 100) {
          proximity.push({
            code: hazard.code,
            message:
            pct >= threshold ?
            `${ingredient.name} sits at ${round(pct)} percent, just above the ${threshold} percent cut-off for ${hazard.hazardClass}. Dropping the fragrance load below ${threshold} percent removes ${hazard.code} from the label.` :
            `${ingredient.name} sits at ${round(pct)} percent, just below the ${threshold} percent cut-off for ${hazard.hazardClass}. Raising the fragrance load to ${threshold} percent adds ${hazard.code} to the label.`
          });
        }
      }
    }
  }

  // Aquatic Chronic 2 supersedes Chronic 3 on the label.
  if (hazardMap.has('H411')) hazardMap.delete('H412');
  const hazards = Array.from(hazardMap.values()).sort((a, b) =>
  (a.code ?? '').localeCompare(b.code ?? '')
  );

  const precautions: DerivedItem[] = [];
  const addP = (code: string, reason: string) => {
    if (precautions.some((p) => p.code === code)) return;
    precautions.push({ code, text: P_LIBRARY[code], why: [{ lead: reason }] });
  };
  addP('P101', 'General, consumer supply.');
  addP('P102', 'General, consumer supply.');
  if (hazardMap.has('H226')) {
    addP('P210', 'Required by H226 (Flam. Liq. 3).');
    addP('P233', 'Required by H226 (Flam. Liq. 3).');
  }
  if (spec.productType === 'Room spray') addP('P261', 'Aerosolised consumer product.');
  if (hazardMap.has('H317')) {
    addP('P261', 'Required by H317 (Skin Sens. 1).');
    addP('P280', 'Required by H317 (Skin Sens. 1).');
    addP('P302+P352', 'Required by H317 (Skin Sens. 1).');
    addP('P333+P313', 'Required by H317 (Skin Sens. 1).');
  }
  if (hazardMap.has('H319')) {
    addP('P264', 'Required by H319 (Eye Irrit. 2).');
    addP('P305+P351+P338', 'Required by H319 (Eye Irrit. 2).');
    addP('P337+P313', 'Required by H319 (Eye Irrit. 2).');
  }
  if (hazardMap.has('H411') || hazardMap.has('H412')) {
    addP('P273', 'Required by the aquatic hazard classification.');
  }
  addP('P501', 'Disposal, required for the aquatic hazard classification.');

  const contributions: Array<{name: string;concentration: number;source?: string;}> = [];
  if (fragrance) {
    for (const allergen of fragrance.allergens) {
      const conc = round(allergen.pct * spec.load / 100, 4);
      if (conc >= EUH208_THRESHOLD) {
        contributions.push({
          name: allergen.name,
          concentration: conc,
          source: materialCitation(fragrance)
        });
      } else if (conc >= EUH208_THRESHOLD * 0.75) {
        proximity.push({
          code: 'EUH208',
          message: `${allergen.name} sits at ${conc} percent, just below the ${EUH208_THRESHOLD} percent declaration threshold. Raising the fragrance load to ${round(EUH208_THRESHOLD * 100 / allergen.pct, 2)} percent adds ${allergen.name} to the EUH208 line.`
        });
      }
    }
  }
  contributions.sort((a, b) => b.concentration - a.concentration);

  const allergenText = contributions.length ?
  hazardMap.has('H317') ?
  `Contains ${contributions.map((c) => c.name).join(', ')}.` :
  `Contains ${contributions.map((c) => c.name).join(', ')}. May produce an allergic reaction.` :
  null;

  const allergenItems: DerivedItem[] = allergenText ?
  [
  {
    code: 'EUH208',
    text: allergenText,
    why: contributions.map((c) => ({
      lead: `${c.name} is present at ${c.concentration} percent of the finished product.`,
      meta: `Declaration threshold ${EUH208_THRESHOLD} percent. Generic concentration limit.`,
      source: c.source
    }))
  }] :

  [];

  const supplementary: DerivedItem[] = [];
  if (spec.productType === 'Container candle' || spec.productType === 'Wax melt') {
    supplementary.push({
      code: 'EN 15494',
      text:
      spec.productType === 'Container candle' ?
      'Never leave a burning candle unattended. Keep away from children and pets. Always leave at least 10 cm between burning candles.' :
      'Use only in a suitable wax warmer. Keep away from children and pets. Never add water to the warmer.',
      why: [
      {
        lead: 'Candle safety symbols and wording required for candles and wax melts sold to consumers.',
        source: 'EN 15494:2019'
      }]

    });
  }
  if (spec.productType === 'Reed diffuser') {
    supplementary.push({
      code: 'Safety wording',
      text: 'Keep away from children and pets. Do not allow the liquid to contact polished or painted surfaces.',
      why: [
      {
        lead: 'Industry safety wording for reed diffusers, recommended alongside the CLP elements.',
        source: 'UK Cosmetic and Home Fragrance Association guidance'
      }]

    });
  }

  const groups: DerivedGroup[] = [
  {
    id: 'hazards',
    title: 'Hazard statements',
    regimeId: 'clp',
    // The undecidable ones ride with the placed ones so the maker sees both in one list, and
    // they are excluded from `clp.hazards` below so neither prints on a label.
    items: [...hazards, ...undecidable],
    emptyText: emptyHazardText(
      pending,
      unresolved,
      'No hazard statements are required at this fragrance load.'
    )
  },
  { id: 'precautions', title: 'Precautionary statements', regimeId: 'clp', items: precautions },
  {
    id: 'allergens',
    title: 'Allergen line',
    regimeId: 'clp',
    items: allergenItems,
    emptyText: emptyHazardText(
      pending,
      unresolved,
      'No allergen sits at or above 0.1 percent in the finished product.'
    )
  }];

  if (supplementary.length) {
    groups.push({
      id: 'supplementary',
      title: 'Supplementary statements',
      regimeId: spec.productType === 'Reed diffuser' ? 'gpsr' : 'en15494',
      items: supplementary
    });
  }

  return {
    summary: [
    // NOT "None required" WHEN NOTHING WAS LOOKED AT. A signal word is the loudest thing on a
    // CLP label and its absence is a positive statement — this product needs no Warning. It
    // may only be said when the register settled and every material on the composition
    // resolved; otherwise the honest summary is that we have not worked it out.
    {
      label: 'Signal word',
      value: signalWord ?? (pending || unresolved.length ? 'Not worked out' : 'None required')
    },
    { label: 'Fragrance load', value: `${spec.load} %` },
    { label: 'Statements', value: String(hazards.length) }],

    groups,
    proximity,
    pending,
    unresolved,
    clp: {
      signalWord,
      pictograms: Array.from(pictograms).sort(),
      hazards: hazards.map((h) => ({ code: h.code as string, text: h.text })),
      precautions: precautions.map((p) => ({ code: p.code as string, text: p.text })),
      allergenLine: allergenText,
      supplementary: supplementary.map((s) => ({ code: s.code as string, text: s.text }))
    }
  };
}

/**
 * ONE COMPOSITION SHAPE, so this is a rename rather than a dispatch.
 *
 * It used to pick between a mixture, a phased cosmetic formula and a bill of materials. Kept
 * as the name every screen calls, because what a screen wants is "derive this composition" and
 * not "derive this mixture".
 */
export function derive(spec: Spec, _product?: Product, _market: Market = 'GB'): Derivation {
  return deriveMixture(spec);
}

/* ------------------------------------------------------------- geometry */

/** Minimum label and pictogram dimensions from CLP Annex I, Table 1.3, by package capacity. */
export function clpMinimumDimensions(capacityMl: number): {
  labelW: number;
  labelH: number;
  pictogram: number;
  band: string;
} {
  if (capacityMl <= 3000)
  return { labelW: 52, labelH: 74, pictogram: 10, band: 'Up to and including 3 litres' };
  if (capacityMl <= 50000)
  return { labelW: 74, labelH: 105, pictogram: 23, band: 'Over 3 litres, up to 50 litres' };
  if (capacityMl <= 500000)
  return { labelW: 105, labelH: 148, pictogram: 32, band: 'Over 50 litres, up to 500 litres' };
  return { labelW: 148, labelH: 210, pictogram: 46, band: 'Over 500 litres' };
}

export const MIN_FONT_PT = 6;
export const MIN_LINE_SPACING = 1.15;

export type GeometryRule = {
  label: string;
  value: string;
  source: string;
  /**
   * The verdict, or NO VERDICT. Undefined is a rule that was not evaluated — the pack has no
   * capacity, so CLP Annex I Table 1.3 has no band to check against — and it is deliberately
   * distinct from `false`, which is a rule that ran and failed.
   */
  ok?: boolean;
};

/** Passed every rule, failed one, or was never checked against any. */
export type GeometryVerdict = 'pass' | 'fail' | 'unchecked';

/**
 * What the surface as a whole may claim, given the rules above it.
 *
 * THE ONE PLACE THIS QUESTION IS ANSWERED, and it exists because the designer answered it
 * inline with `rules.every((rule) => rule.ok !== false)` — which reads a rule with NO VERDICT
 * as a rule that passed, and painted the "This surface" pill green over it. That is the
 * guaranteed state of every new product: `blankSpec` no longer seeds a packaging id, so the
 * only CLP rule on the card is the one that says the minimum label size cannot be worked out.
 * A green pill over "Cannot be worked out yet" tells a maker their label clears a check that
 * was never performed.
 *
 * A FAILURE IS ESTABLISHED WHATEVER ELSE DID NOT RUN — a rule that ran and failed is a fact,
 * and it outranks the rest. A PASS IS NOT: it requires every rule to have returned a verdict,
 * because "all the checks I managed to do passed" is not what a green tick says to anybody.
 */
export function geometryVerdict(rules: GeometryRule[]): GeometryVerdict {
  if (rules.some((rule) => rule.ok === false)) return 'fail';
  if (rules.length === 0) return 'unchecked';
  if (rules.some((rule) => rule.ok === undefined)) return 'unchecked';
  return 'pass';
}

/** The size rules the active regimes place on an artefact. Each states its source. */
export function geometryRules(product: Product, widthMm: number, heightMm: number): GeometryRule[] {
  const packaging = packagingById(getPackagingId(product.spec));
  /**
   * The pack capacity, or nothing.
   *
   * IT USED TO FALL BACK TO 100 ml. That number decided the whole of CLP Annex I Table 1.3 —
   * the minimum label size and the minimum pictogram — and it was applied to any product whose
   * packaging did not resolve, which with a shipped catalogue meant none and with the maker's
   * own register means every product before they have chosen a pack. A label sized against an
   * invented capacity is a label that passes a check nobody performed. Absent now means the
   * rule says it cannot be worked out.
   */
  const capacity = packaging?.capacityMl;
  const rules: GeometryRule[] = [];

  if (product.regimes.includes('clp')) {
    if (capacity == null) {
      rules.push({
        label: 'Minimum label size',
        value: 'Cannot be worked out yet',
        source: packaging ?
        `CLP Annex I, Table 1.3 — no capacity recorded for ${packaging.name}` :
        'CLP Annex I, Table 1.3 — no packaging chosen for this product',
        // Deliberately UNSET rather than false. `ok: false` renders as a failed check, and
        // nothing has been checked; undefined renders as a rule with no verdict.
        ok: undefined
      });
    } else {
      const minimums = clpMinimumDimensions(capacity);
      const area = widthMm * heightMm;
      const minArea = minimums.labelW * minimums.labelH;
      rules.push({
        label: 'Minimum label size',
        value: `${minimums.labelW} × ${minimums.labelH} mm`,
        source: `CLP Annex I, Table 1.3, ${minimums.band.toLowerCase()}`,
        ok: area >= minArea && Math.min(widthMm, heightMm) >= minimums.labelW
      });
      rules.push({
        label: 'Minimum pictogram',
        value: `${minimums.pictogram} × ${minimums.pictogram} mm`,
        source: 'CLP Annex I, at least one fifteenth of the label surface',
        ok: true
      });
    }
  }

  return rules;
}

export function getPackagingId(spec: Spec): string {
  return spec.packagingId;
}

export function specSummary(spec: Spec): string {
  return `${spec.productType}, load ${spec.load} percent`;
}