import { ingredientById, componentById, packagingById } from './catalog';
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

export type Derivation = {
  summary: Array<{label: string;value: string;}>;
  groups: DerivedGroup[];
  proximity: ProximityNote[];
  clp?: ClpResult;
  cosmetic?: CosmeticResult;
  device?: DeviceResult;
};

/** The register date the app reasons from. */
export const TODAY = new Date('2026-07-30T00:00:00Z');

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
  const fragrance = ingredientById(spec.fragranceId);
  const base = ingredientById(spec.baseId);
  const dye = ingredientById(spec.dyeId);

  const components: Array<{ingredient: IngredientMaterial;pct: number;}> = [];
  if (fragrance) components.push({ ingredient: fragrance, pct: spec.load });
  if (base) {
    components.push({
      ingredient: base,
      pct: round(100 - spec.load - (dye && dye.id !== 'ing-no-dye' ? 0.5 : 0))
    });
  }
  if (dye && dye.id !== 'ing-no-dye') components.push({ ingredient: dye, pct: 0.5 });

  const hazardMap = new Map<string, DerivedItem>();
  const pictograms = new Set<ClpResult['pictograms'][number]>();
  const proximity: ProximityNote[] = [];
  let signalWord: ClpResult['signalWord'] = null;

  for (const { ingredient, pct } of components) {
    for (const hazard of ingredient.hazards) {
      const threshold = hazard.scl ?? hazard.gcl;
      const thresholdType =
      hazard.scl != null ? 'Specific concentration limit' : 'Generic concentration limit';

      const why: WhyLine = {
        lead: `${ingredient.name} is present at ${round(pct)} percent of the finished product.`,
        meta: `${hazard.hazardClass} threshold crossed at ${threshold} percent. ${thresholdType}${
        hazard.scl != null ? ', taken from the supplier document' : ', from CLP Annex I'}.${
        hazard.derivation ? ` ${hazard.derivation}` : ''}`,
        source: `${ingredient.supplier}, ${ingredient.document.kind.toLowerCase()} ${ingredient.document.version}`
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

  const contributions: Array<{name: string;concentration: number;source: string;}> = [];
  if (fragrance) {
    for (const allergen of fragrance.allergens) {
      const conc = round(allergen.pct * spec.load / 100, 4);
      if (conc >= EUH208_THRESHOLD) {
        contributions.push({
          name: allergen.name,
          concentration: conc,
          source: `${fragrance.supplier}, allergen declaration ${fragrance.document.version}`
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
    items: hazards,
    emptyText: 'No hazard statements are required at this fragrance load.'
  },
  { id: 'precautions', title: 'Precautionary statements', regimeId: 'clp', items: precautions },
  {
    id: 'allergens',
    title: 'Allergen line',
    regimeId: 'clp',
    items: allergenItems,
    emptyText: 'No allergen sits at or above 0.1 percent in the finished product.'
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
    { label: 'Signal word', value: signalWord ?? 'None required' },
    { label: 'Fragrance load', value: `${spec.load} %` },
    { label: 'Statements', value: String(hazards.length) }],

    groups,
    proximity,
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
  const flat: Array<{ingredient: IngredientMaterial;pct: number;phase: string;}> = [];
  for (const phase of spec.phases) {
    for (const item of phase.items) {
      const ingredient = ingredientById(item.materialId);
      if (ingredient) flat.push({ ingredient, pct: item.pct, phase: phase.name });
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
        source: `${item.ingredient.supplier}, ${item.ingredient.document.kind.toLowerCase()} ${item.ingredient.document.version}`
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
        source: `${item.ingredient.supplier}, ${item.ingredient.document.kind.toLowerCase()} ${item.ingredient.document.version}`
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
            source: `${item.ingredient.supplier}, allergen declaration ${item.ingredient.document.version}`
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
  const pao = `${spec.paoMonths}M`;
  const warnings = [
  'Avoid contact with the eyes. If contact occurs, rinse with water.',
  'Discontinue use if irritation occurs.',
  'Keep out of reach of children.'];


  const groups: DerivedGroup[] = [
  { id: 'inci', title: 'Ingredient list, INCI', regimeId: 'cpr', items: inciItems },
  {
    id: 'allergens',
    title: 'Declarable allergens',
    regimeId: 'cpr',
    items: allergenItems,
    emptyText: 'No declarable allergen reaches the threshold for this application.'
  },
  {
    id: 'durability',
    title: 'Period after opening',
    regimeId: 'cpr',
    items: [
    {
      code: pao,
      text: `Use within ${spec.paoMonths} months of opening.`,
      why: [
      {
        lead: `A period after opening is shown because the product has a minimum durability of more than 30 months.`,
        meta: `${spec.paoMonths} months, set by the stability data in the product information file. Shown with the open jar symbol.`,
        source: 'Cosmetic product safety report, stability and challenge testing'
      }]

    }]

  },
  {
    id: 'precautions',
    title: 'Precautions for use',
    regimeId: 'cpr',
    items: warnings.map((text) => ({
      text,
      why: [
      {
        lead: 'Standard precaution for a leave-on facial product carried on the label and the carton.',
        source: 'Cosmetic product safety report, section on warnings'
      }]

    }))
  }];


  return {
    summary: [
    { label: 'Formula total', value: `${total} %` },
    { label: 'Ingredients declared', value: String(inciNames.length) },
    { label: 'Period after opening', value: pao }],

    groups,
    proximity,
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

function daysUntil(iso: string): number | null {
  if (!iso || iso === '—') return null;
  const target = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(target.getTime())) return null;
  return Math.round((target.getTime() - TODAY.getTime()) / 86400000);
}

export function deriveBom(spec: BomSpec, product?: Product): Derivation {
  const proximity: ProximityNote[] = [];
  const declarationSigned = product?.obligations['ce-doc-signed'] ?? false;

  const standards = Array.from(
    new Set(
      spec.items.flatMap((item) => componentById(item.materialId)?.standards ?? [])
    )
  ).sort();

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
      'A component declaration is missing, so the declaration cannot yet be signed.',
      source: 'HH-DOC-WW100-01, issued 8 June 2026'
    }]

  },
  ...standards.map((standard) => ({
    code: 'Standard',
    text: standard,
    why: [
    {
      lead: `Applied through the components that carry it in their own declarations.`,
      meta: 'Listed on the declaration of conformity as a harmonised standard applied in full.',
      source: 'Component declarations of conformity'
    }]

  }))];


  const componentItems: DerivedItem[] = spec.items.map((item) => {
    const component = componentById(item.materialId);
    if (!component) {
      return { text: 'Unknown component', why: [{ lead: 'This component is no longer in the register.' }], tone: 'warn' as const };
    }
    const days = daysUntil(component.certificateExpiry);
    const missing = component.rohsStatus === 'Not declared';
    if (days != null && days > 0 && days <= 90) {
      proximity.push({
        code: 'Certificate',
        message: `${component.name} has evidence expiring in ${days} days, on ${component.certificateExpiry}. The declaration for ${spec.model} stops being supportable on that date unless a current document is on file.`
      });
    }
    return {
      code: component.rohsStatus === 'Compliant' ? 'RoHS' : component.rohsStatus === 'Not declared' ? 'Missing' : 'Exempt',
      text: `${component.name} — ${component.rohsStatus.toLowerCase()}`,
      tone: missing ? 'warn' : 'default',
      why: [
      {
        lead: missing ?
        `${component.supplier} has provided no material declaration for part ${component.partNumber}.` :
        `${component.supplier} declares part ${component.partNumber} compliant${component.rohsExemption ? ` under ${component.rohsExemption}` : ''}.`,
        meta: missing ?
        'Assessed under EN IEC 63000, which requires a declaration or test evidence for every homogeneous material.' :
        `${component.document.kind} version ${component.document.version}, dated ${component.document.date}${component.certificateExpiry !== '—' ? `, valid to ${component.certificateExpiry}` : ''}.`,
        source: missing ? 'No document on file' : component.document.reference
      }]

    };
  });

  const declaredCount = spec.items.filter(
    (item) => componentById(item.materialId)?.rohsStatus !== 'Not declared'
  ).length;

  const groups: DerivedGroup[] = [
  { id: 'declaration', title: 'Declaration and standards', regimeId: 'ce', items: declarationItems },
  { id: 'components', title: 'Component material declarations', regimeId: 'rohs', items: componentItems },
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
    { label: 'Declarations', value: `${declaredCount} of ${spec.items.length}` }],

    groups,
    proximity,
    device: {
      model: spec.model,
      ratings: `${spec.ratings.voltage} ⎓ ${spec.ratings.current}, ${spec.ratings.power}`,
      standards,
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
  const capacity = packaging?.capacityMl ?? 100;
  const rules: GeometryRule[] = [];

  if (product.regimes.includes('clp')) {
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

  if (product.regimes.includes('cpr')) {
    rules.push({
      label: 'Minimum legible type',
      value: `${MIN_FONT_PT} pt`,
      source: 'Cosmetic Products Regulation, indelible, easily legible and visible marking',
      ok: true
    });
    rules.push({
      label: 'Printable area on pack',
      value: packaging ?
      `${packaging.labelAreaMm.width} × ${packaging.labelAreaMm.height} mm` :
      'Not recorded',
      source: packaging ? `${packaging.supplier} technical drawing` : 'No packaging on file',
      ok: packaging ? widthMm <= packaging.labelAreaMm.width : false
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