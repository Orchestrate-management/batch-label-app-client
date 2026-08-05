import {
  ingredientById,
  materialCitation,
  materialsSettled,
  packagingById } from
'./material-index';
import {
  BomSpec,
  IngredientMaterial,
  Market,
  MixtureSpec,
  PhasedSpec,
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

export type CosmeticResult = {
  functionLine: string;
  inciNames: string[];
  inciLine: string;
  allergenNames: string[];
  pao: string;
  warnings: string[];
};

export type DeviceResult = {
  model: string;
  ratings: string;
  standards: string[];
  weeeRegistration: string;
  declarationSigned: boolean;
};

/**
 * A material the composition names and the register could not produce.
 *
 * WHY THIS IS A FIELD RATHER THAN A SILENT SKIP, and it is the single most important line in
 * this file. Materials used to be a constant compiled into the bundle, so every id on every
 * composition resolved by construction and the "not found" branch was unreachable. They are
 * rows now — the maker's own, archived when they choose — and an id that resolves to nothing
 * contributes nothing, so a mixture whose fragrance oil has been archived derives NO HAZARD
 * STATEMENTS and the group underneath it reads "No hazard statements are required at this
 * fragrance load".
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
  cosmetic?: CosmeticResult;
  device?: DeviceResult;
};

/**
 * Whether the hazard group may say "nothing is required", or has to say "we could not tell".
 *
 * One helper, used by both mixture and phased derivations, so the two cannot come to
 * different conclusions about the same silence.
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

/* ------------------------------------------- phased formula, CPR regime */

/** Declarable at 0.001 percent in a leave-on product, 0.01 percent in a rinse-off. */
export function cosmeticAllergenThreshold(application: PhasedSpec['application']): number {
  return application === 'Leave-on' ? 0.001 : 0.01;
}

export function derivePhased(spec: PhasedSpec): Derivation {
  const pending = !materialsSettled();
  const unresolved: UnresolvedMaterial[] = [];
  const flat: Array<{ingredient: IngredientMaterial;pct: number;phase: string;}> = [];
  for (const phase of spec.phases) {
    for (const item of phase.items) {
      const ingredient = ingredientById(item.materialId);
      if (ingredient) {
        flat.push({ ingredient, pct: item.pct, phase: phase.name });
        continue;
      }
      // A phase item naming a material the register cannot produce. It is left OUT of the
      // ingredient list rather than guessed at — an INCI list is a legal declaration and a
      // placeholder in it is worse than a gap — and named here so the screen can say which.
      if (item.materialId) unresolved.push({ slot: `Phase item, ${phase.name}`, id: item.materialId });
    }
  }

  const total = round(
    flat.reduce((sum, item) => sum + item.pct, 0),
    2
  );

  const ordered = flat.filter((i) => i.pct >= 1).sort((a, b) => b.pct - a.pct);
  const unordered = flat.filter((i) => i.pct < 1);
  const proximity: ProximityNote[] = [];

  const inciItems: DerivedItem[] = [];
  ordered.forEach((item, index) => {
    const next = ordered[index + 1];
    inciItems.push({
      text: item.ingredient.inci ?? item.ingredient.name,
      why: [
      {
        lead: `${item.ingredient.name} is present at ${item.pct} percent, in the ${item.phase.toLowerCase()}.`,
        meta: next ?
        `At or above 1 percent, so it is listed in descending order. It precedes ${next.ingredient.inci ?? next.ingredient.name} at ${next.pct} percent.` :
        'At or above 1 percent, so it is listed in descending order. It is the last ingredient above 1 percent.',
        source: materialCitation(item.ingredient)
      }]

    });
    if (next && Math.abs(item.pct - next.pct) < 0.5) {
      proximity.push({
        code: 'INCI order',
        message: `${item.ingredient.inci ?? item.ingredient.name} at ${item.pct} percent and ${next.ingredient.inci ?? next.ingredient.name} at ${next.pct} percent are within 0.5 points. Taking the first below ${next.pct} percent swaps their order on the label.`
      });
    }
  });
  unordered.forEach((item) => {
    inciItems.push({
      text: item.ingredient.inci ?? item.ingredient.name,
      why: [
      {
        lead: `${item.ingredient.name} is present at ${item.pct} percent, in the ${item.phase.toLowerCase()}.`,
        meta: `Below 1 percent, so it may appear in any order after ${ordered[ordered.length - 1]?.ingredient.inci ?? 'the last ordered ingredient'}.`,
        source: materialCitation(item.ingredient)
      }]

    });
  });

  const threshold = cosmeticAllergenThreshold(spec.application);
  const allergenItems: DerivedItem[] = [];
  for (const item of flat) {
    for (const allergen of item.ingredient.allergens) {
      const conc = round(allergen.pct * item.pct / 100, 5);
      const inciName = allergen.name.charAt(0).toUpperCase() + allergen.name.slice(1);
      if (conc >= threshold) {
        allergenItems.push({
          text: inciName,
          why: [
          {
            lead: `${allergen.name} is present at ${conc} percent of the finished product, from ${item.ingredient.name} at ${item.pct} percent.`,
            meta: `Declared because it is at or above ${threshold} percent in a ${spec.application.toLowerCase()} product.`,
            source: materialCitation(item.ingredient)
          }]

        });
      } else if (conc >= threshold * 0.75) {
        proximity.push({
          code: 'Allergen',
          message: `${allergen.name} sits at ${conc} percent, just below the ${threshold} percent declaration threshold for a ${spec.application.toLowerCase()} product. Raising ${item.ingredient.name} to ${round(threshold * 100 / allergen.pct, 3)} percent adds ${inciName} to the ingredient list.`
        });
      }
    }
  }
  allergenItems.sort((a, b) => a.text.localeCompare(b.text));

  const inciNames = [...inciItems.map((i) => i.text), ...allergenItems.map((a) => a.text)];
  /**
   * EMPTY WHEN NOTHING IS SET, and the empty string is what the label renderer checks.
   *
   * This was `${spec.paoMonths}M` unconditionally, over a `paoMonths` that `blankSpec` seeded
   * to 12 — so a brand new cosmetic printed "12M" beside an open-jar symbol on the preview, at
   * actual size, while the obligations list on the same screen read "Neither a period after
   * opening nor a date of minimum durability is shown". A period after opening is a legal
   * marking and nothing here has measured one. Zero is now unset, at the seed, on the label, in
   * the derivation and in `cpr-pao`, all reading this one field.
   */
  const pao = spec.paoMonths > 0 ? `${spec.paoMonths}M` : '';
  const warnings = [
  'Avoid contact with the eyes. If contact occurs, rinse with water.',
  'Discontinue use if irritation occurs.',
  'Keep out of reach of children.'];


  const groups: DerivedGroup[] = [
  {
    id: 'inci',
    title: 'Ingredient list, INCI',
    regimeId: 'cpr',
    items: inciItems,
    emptyText: emptyHazardText(
      pending,
      unresolved,
      'Nothing has been added to the phases yet, so there is no ingredient list to declare.'
    )
  },
  {
    id: 'allergens',
    title: 'Declarable allergens',
    regimeId: 'cpr',
    items: allergenItems,
    emptyText: emptyHazardText(
      pending,
      unresolved,
      'No declarable allergen reaches the threshold for this application.'
    )
  },
  /*
   * NO CPSR AND NO PIF CITATION IN EITHER GROUP BELOW, and that is the correction rather than
   * an omission. Both used to name a Cosmetic Product Safety Report and a Product Information
   * File as their source — "12 months, set by the stability data in the product information
   * file", "Source: Cosmetic product safety report, section on warnings" — while the
   * obligations list on the same screen read "No product information file has been assembled
   * for this product" and "No signed cosmetic product safety report is on file". Nothing holds
   * a CPSR, nothing has measured a durability, and the 12 is a constant in blankSpec. It is
   * the same citation-of-a-document-nobody-holds that was removed from the declaration of
   * conformity one function below, and `WhyLine.source` is optional precisely so that a line
   * with no honest source can carry none.
   */
  {
    id: 'durability',
    title: 'Period after opening',
    regimeId: 'cpr',
    // The group is EMPTY rather than absent when nothing is set, so the panel says the duty
    // exists and that this composition does not answer it — which is a different sentence from
    // the regime not applying.
    emptyText:
    'No period after opening is set on this composition, so the label prints no open jar figure. Nothing here has measured one; it is yours to set and to justify from your own stability data.',
    items: pao ?
    [
    {
      code: pao,
      text: `Use within ${spec.paoMonths} months of opening.`,
      why: [
      {
        lead: 'A period after opening is carried on the label, shown with the open jar symbol.',
        meta: `${spec.paoMonths} months, which is the value set on this composition. Nothing has measured it: there is no stability or challenge testing behind this number and no safety report holding one, so it is yours to set and to justify.`
      }]

    }] :

    []
  },
  {
    id: 'precautions',
    title: 'Precautions for use',
    regimeId: 'cpr',
    items: warnings.map((text) => ({
      text,
      why: [
      {
        // The application and the product type are read off the composition rather than
        // asserted. This said "a leave-on facial product" for every cosmetics product,
        // including rinse-off ones and ones that never go near a face.
        lead: `Standard precaution carried on the label for a ${spec.application.toLowerCase()} ${spec.productType.toLowerCase()}.`,
        meta: 'Batchlabel\'s standard wording for this kind of product. It is not drawn from a safety assessment of yours — none is held — and a competent person has to confirm it is the right set for this formula.'
      }]

    }))
  }];


  return {
    summary: [
    { label: 'Formula total', value: `${total} %` },
    { label: 'Ingredients declared', value: String(inciNames.length) },
    { label: 'Period after opening', value: pao || 'Not set' }],

    groups,
    proximity,
    pending,
    unresolved,
    cosmetic: {
      functionLine: spec.productType,
      inciNames,
      inciLine: inciNames.join(', '),
      allergenNames: allergenItems.map((a) => a.text),
      pao,
      warnings
    }
  };
}

export function phasedTotal(spec: PhasedSpec): number {
  return round(
    spec.phases.reduce(
      (sum, phase) => sum + phase.items.reduce((phaseSum, item) => phaseSum + item.pct, 0),
      0
    ),
    2
  );
}

/* --------------------------------- bill of materials, CE, RoHS and WEEE */

/**
 * A device's conformity file — WITH THE COMPONENT CATALOGUE REMOVED.
 *
 * WHAT WENT AND WHY. This function used to read `componentById(item.materialId)` off a
 * shipped COMPONENTS array and produce, under the maker's own model name: a RoHS status per
 * part ("compliant with exemption 6(c), lead in copper alloy"), a list of harmonised
 * standards said to be carried by their bill of materials, a count of "3 of 5 declarations",
 * and a countdown to a certificate expiry. Not one of those was a fact about the account.
 * They were five constants in the bundle, identical for every customer who picked the part,
 * and Rhys's ruling deleted the array they came from: components are "not going to be a
 * priority for a long time, better to just get rid of it". The database refuses the class
 * outright — `materials_class_check` lists 'ingredient' and 'packaging'.
 *
 * WHAT IS LEFT IS TRUE. A bill of materials still has lines on it, because a maker can still
 * type them; what no longer exists is anything that knows what those lines ARE. So the
 * component group states that, once, instead of classifying them — and the declaration row
 * keeps saying it is unsigned, which is the one thing about it that was always established.
 *
 * The electronics category is otherwise untouched: this is a materials change, not a decision
 * about whether Batchlabel serves device makers.
 */
export function deriveBom(spec: BomSpec, product?: Product): Derivation {
  const proximity: ProximityNote[] = [];
  // From the append-only log, not from a jsonb column nothing wrote. `ce-doc-signed` is the
  // maker's own recorded statement that they signed it — which is why the wording below says
  // signed and dated rather than claiming Batchlabel saw the document.
  const declarationSigned = Boolean(product?.evidence.obligations['ce-doc-signed']);

  const declarationItems: DerivedItem[] = [
  {
    code: 'DoC',
    text: declarationSigned ?
    'Declaration of conformity signed and dated.' :
    'Declaration of conformity drafted but not signed.',
    tone: declarationSigned ? 'default' : 'warn',
    why: [
    {
      lead: `Covers the Low Voltage Directive 2014/35/EU and the EMC Directive 2014/30/EU for model ${spec.model}.`,
      meta: declarationSigned ?
      'Signed by the manufacturer and held with the technical file.' :
      'Batchlabel holds no declaration of conformity for you and cannot sign one. This row ' +
      'is here because the duty is real, not because anything has been checked.'
      // NO `source`, AND THERE CANNOT BE ONE. This used to read "HH-DOC-WW100-01, issued 8
      // June 2026" — a reference number and an issue date for a declaration held on the
      // maker's own device, hardcoded, therefore identical for every account. A declaration
      // reference is the number a market surveillance officer asks for. WhyLine.source is
      // optional and DerivationPanel renders the "Source:" line only when it is set, so the
      // honest thing is to cite nothing.
    }]

  }];


  /**
   * The bill of materials, listed and NOT assessed.
   *
   * Each line renders as what the maker typed. There is no material behind it — component
   * materials are gone — so there is no RoHS status, no standards list and no certificate
   * date, and this says so once rather than leaving four columns of silence that read as
   * "nothing wrong here".
   */
  const componentItems: DerivedItem[] = spec.items.map((item) => ({
    text: item.materialId || 'Unnamed line',
    why: [
    {
      lead: `${item.quantity} at position ${item.position}, as entered on the bill of materials.`,
      meta:
      'Batchlabel holds no record of this part: component materials are not built, so nothing ' +
      'here has been checked for RoHS, for a declaration, or for a standard it carries.'
    }]

  }));

  const groups: DerivedGroup[] = [
  { id: 'declaration', title: 'Declaration and standards', regimeId: 'ce', items: declarationItems },
  {
    id: 'components',
    title: 'Bill of materials, as entered',
    regimeId: 'rohs',
    items: componentItems,
    emptyText: 'Nothing has been added to the bill of materials yet.'
  },
  {
    id: 'weee',
    title: 'Producer registration',
    regimeId: 'weee',
    items: [
    {
      code: 'WEEE',
      text: `Producer registration ${product?.identifiers.weeeRegistration ?? 'not recorded'}.`,
      tone: product?.identifiers.weeeRegistration ? 'default' : 'warn',
      why: [
      {
        lead: 'A registered producer identifier must appear with the crossed-out wheelie bin on the rating plate.',
        meta: 'Registered through a producer compliance scheme, renewed annually.',
        source: 'Directive 2012/19/EU and the UK WEEE Regulations 2013'
      }]

    }]

  }];


  return {
    summary: [
    { label: 'Model', value: spec.model },
    { label: 'Ratings', value: `${spec.ratings.voltage}, ${spec.ratings.current}` },
    // NOT "N of M declarations". That number came from reading a rohsStatus constant off the
    // shipped component catalogue; with the catalogue gone there is no numerator, and
    // inventing one — "0 of 5" — would be a finding about the maker's technical file that
    // nothing examined.
    { label: 'Bill of materials', value: `${spec.items.length} lines, none assessed` }],

    groups,
    proximity,
    // A device's conformity file does not read the materials register at all, so it is never
    // waiting on it and never missing anything from it.
    pending: false,
    unresolved: [],
    device: {
      model: spec.model,
      ratings: `${spec.ratings.voltage} ⎓ ${spec.ratings.current}, ${spec.ratings.power}`,
      standards: [],
      weeeRegistration: product?.identifiers.weeeRegistration ?? '',
      declarationSigned
    }
  };
}

export function derive(spec: Spec, product?: Product, _market: Market = 'GB'): Derivation {
  if (spec.kind === 'mixture') return deriveMixture(spec);
  if (spec.kind === 'phased') return derivePhased(spec);
  return deriveBom(spec, product);
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

export const CE_MARK_MIN_MM = 5;
export const MIN_FONT_PT = 6;
export const MIN_LINE_SPACING = 1.15;

export type GeometryRule = {
  label: string;
  value: string;
  source: string;
  ok?: boolean;
};

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

  if (product.regimes.includes('cpr')) {
    rules.push({
      label: 'Minimum legible type',
      value: `${MIN_FONT_PT} pt`,
      source: 'Cosmetic Products Regulation, indelible, easily legible and visible marking',
      ok: true
    });
    // Both dimensions or neither: half a printable area cannot be checked against an
    // artefact, and `ok: false` on a check that did not run reads as a failure the maker has
    // to fix rather than a figure they have not entered.
    const area = packaging?.labelAreaMm;
    rules.push({
      label: 'Printable area on pack',
      value: area ? `${area.width} × ${area.height} mm` : 'Not recorded',
      source: !packaging ?
      'No packaging chosen for this product' :
      area ?
      `${packaging.supplier ?? 'Your record'}, as recorded on the material` :
      `No printable area recorded for ${packaging.name}`,
      ok: area ? widthMm <= area.width : undefined
    });
  }

  if (product.regimes.includes('ce')) {
    rules.push({
      label: 'Minimum CE mark height',
      value: `${CE_MARK_MIN_MM} mm`,
      source: 'Regulation (EC) No 765/2008, proportions preserved when scaled',
      ok: true
    });
  }

  if (product.regimes.includes('weee')) {
    rules.push({
      label: 'Wheelie bin mark',
      value: 'Visible, legible and indelible',
      source: 'EN 50419',
      ok: true
    });
  }

  return rules;
}

export function getPackagingId(spec: Spec): string {
  return spec.packagingId;
}

export function specSummary(spec: Spec): string {
  if (spec.kind === 'mixture') return `${spec.productType}, load ${spec.load} percent`;
  if (spec.kind === 'phased') return `${spec.productType}, ${spec.phases.length} phases`;
  return `${spec.productType}, ${spec.items.length} components`;
}