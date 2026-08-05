import { BUSINESS, addressForMarket } from './identity';
import { ingredientById, materialCitation } from './material-index';
import { Derivation, WhyLine } from './derive';
import {
  ARTEFACT_NOT_PRODUCED,
  IngredientMaterial,
  Market,
  MixtureSpec,
  Product,
  formatDate,
  round } from
'./model';

/**
 * The finished-product safety data sheet. Sixteen sections in the order REACH
 * Annex II fixes, built from the same derivation that produces the label so the
 * two can never disagree.
 *
 * Every section declares how it was filled. Derived sections carry the same why
 * lines as the label. Sections that genuinely cannot be derived say so rather
 * than being quietly filled in.
 */

export type SdsSectionKind = 'derived' | 'workspace' | 'needs-you';

export type SdsField = {
  label: string;
  value: string;
  why?: WhyLine;
  /** True when the value is not on file. Rendered as a stated gap, never blank. */
  missing?: boolean;
};

export type SdsConstituent = {
  name: string;
  cas: string | null;
  pct: number;
};

export type SdsComponentRow = {
  name: string;
  cas: string | null;
  ec: string | null;
  range: string;
  classification: string;
  /**
   * The supplier document this row's classification was read from, or nothing.
   *
   * OPTIONAL, and SdsDocument renders the "Source:" line only when it is set. A maker's own
   * material may carry no document reference at all, and section 3 of a safety data sheet is
   * the last place in this application where a citation may be invented to fill a gap.
   */
  source?: string;
  note?: string;
  constituents?: SdsConstituent[];
};

export type SdsSection = {
  number: number;
  title: string;
  kind: SdsSectionKind;
  intro?: string;
  fields?: SdsField[];
  lines?: string[];
  components?: SdsComponentRow[];
  /** For needs-you sections: exactly what the app is waiting for. */
  prompt?: string;
};

export type SdsDocumentModel = {
  productName: string;
  supplierName: string;
  version: string;
  revisionDate: string;
  market: Market;
  sections: SdsSection[];
  /** Sections still waiting on a competent person. */
  outstanding: number;
};

/**
 * CAS numbers for the declarable fragrance allergens, from the Annex III entries.
 * Held here because they are properties of the substance, not of any one supplier.
 */
const ALLERGEN_CAS: Record<string, string> = {
  linalool: '78-70-6',
  limonene: '5989-27-5',
  citronellol: '106-22-9',
  geraniol: '106-24-1',
  eugenol: '97-53-0',
  coumarin: '91-64-5',
  citral: '5392-40-5',
  'alpha-isomethyl ionone': '127-51-5',
  'benzyl salicylate': '118-58-1',
  'hexyl cinnamal': '101-86-0',
  'benzyl benzoate': '120-51-4',
  isoeugenol: '97-54-1',
  farnesol: '4602-84-0',
  'benzyl alcohol': '100-51-6',
  cinnamal: '104-55-2',
  'amyl cinnamal': '122-40-7'
};

/**
 * Physical data taken from the supplier sheet for the material it belongs to.
 * Where an ingredient is absent here the app has no value on file and says so.
 */
const PHYSICAL_DATA: Record<string, {flashPointC?: number;densityGMl?: number;}> = {
  'ing-alcohol': { flashPointC: 12, densityGMl: 0.79 },
  'ing-dpg': { flashPointC: 124, densityGMl: 1.02 },
  'ing-crw45': { flashPointC: 232, densityGMl: 0.9 },
  'ing-soy-c3': { flashPointC: 246, densityGMl: 0.9 }
};

/** The concentration bands an SDS declares rather than an exact figure. */
export function concentrationBand(pct: number): string {
  if (pct <= 0) return '—';
  if (pct < 1) return '< 1 %';
  if (pct < 5) return '1 – 5 %';
  if (pct < 10) return '5 – 10 %';
  if (pct < 25) return '10 – 25 %';
  if (pct < 50) return '25 – 50 %';
  return '≥ 50 %';
}

function allergenCas(name: string): string | null {
  return ALLERGEN_CAS[name.trim().toLowerCase()] ?? null;
}

type Portion = {ingredient: IngredientMaterial;pct: number;};

/** Flattens any spec into ingredient portions of the finished product. */
function portions(product: Product): Portion[] {
  const spec = product.spec;
  const result: Portion[] = [];

  if (spec.kind === 'mixture') {
    const mixture = spec as MixtureSpec;
    const fragrance = ingredientById(mixture.fragranceId);
    const base = ingredientById(mixture.baseId);
    const dye = ingredientById(mixture.dyeId);
    if (fragrance) result.push({ ingredient: fragrance, pct: mixture.load });
    if (base) result.push({ ingredient: base, pct: round(100 - mixture.load, 2) });
    if (dye) result.push({ ingredient: dye, pct: 0.4 });
  }

  return result.sort((a, b) => b.pct - a.pct);
}

function componentRows(product: Product): SdsComponentRow[] {
  return portions(product).
  filter((portion) => portion.ingredient.hazards.length > 0).
  map((portion) => {
    const { ingredient, pct } = portion;
    const isMixture = ingredient.role === 'Fragrance oil';
    const constituents = ingredient.allergens.
    map((allergen) => ({
      name: allergen.name,
      cas: allergenCas(allergen.name),
      pct: round(allergen.pct * pct / 100, 4)
    })).
    filter((constituent) => constituent.pct >= 0.1).
    sort((a, b) => b.pct - a.pct);

    return {
      name: ingredient.name,
      cas: ingredient.cas ?? null,
      ec: null,
      range: concentrationBand(pct),
      classification: ingredient.hazards.
      map((hazard) => `${hazard.hazardClass}, ${hazard.code}`).
      join('; '),
      source: materialCitation(ingredient),
      note: isMixture ?
      'A fragrance mixture. No single CAS or EC number exists; the declarable constituents are listed beneath.' :
      ingredient.cas ?
      undefined :
      'No CAS number on the supplier sheet.',
      constituents: constituents.length ? constituents : undefined
    };
  });
}

function physicalFields(product: Product): SdsField[] {
  const spec = product.spec;
  const solid = spec.kind === 'mixture' && spec.netUnit === 'g';
  const relevant = portions(product).
  map((portion) => ({ portion, data: PHYSICAL_DATA[portion.ingredient.id] })).
  filter((entry) => entry.data);

  const flash = relevant.
  filter((entry) => entry.data?.flashPointC != null).
  sort((a, b) => a.data!.flashPointC! - b.data!.flashPointC!)[0];

  const density = relevant.find((entry) => entry.data?.densityGMl != null);

  return [
  {
    label: 'Physical state',
    value: solid ? 'Solid' : 'Liquid',
    why: {
      lead: solid ?
      'The base is a wax and the product is supplied by weight, so the mixture is a solid at ambient temperature.' :
      'The base is a liquid carrier and the product is supplied by volume.',
      source: 'Composition on file'
    }
  },
  {
    label: 'Colour',
    value:
    spec.kind === 'mixture' && spec.dyeId ?
    'Coloured, per the dye on file' :
    'Off-white to pale straw, undyed',
    why: {
      lead: 'Taken from the dye recorded in the composition.',
      source: 'Composition on file'
    }
  },
  {
    label: 'Odour',
    value: 'Characteristic of the fragrance',
    why: {
      lead: 'The fragrance load determines the odour of the finished product.',
      source: 'Composition on file'
    }
  },
  flash ?
  {
    label: 'Flash point',
    value: `${flash.data!.flashPointC} °C, closed cup`,
    why: {
      lead: `The lowest flash point of any component is ${flash.data!.flashPointC} °C, from ${flash.portion.ingredient.name}.`,
      meta: 'The mixture is assigned the lowest component flash point unless measured data for the finished product is available.',
      source: materialCitation(flash.portion.ingredient)
    }
  } :
  {
    label: 'Flash point',
    value: 'No value on file',
    missing: true
  },
  density ?
  {
    label: 'Relative density',
    value: `${density.data!.densityGMl} g/ml at 20 °C`,
    why: {
      lead: `Taken from ${density.portion.ingredient.name}, the principal component by weight.`,
      source: materialCitation(density.portion.ingredient)
    }
  } :
  { label: 'Relative density', value: 'No value on file', missing: true },
  { label: 'Water solubility', value: 'Insoluble', why: { lead: 'Oil and wax based composition.', source: 'Composition on file' } },
  { label: 'pH', value: 'Not applicable, non-aqueous', why: { lead: 'The mixture contains no water phase.', source: 'Composition on file' } }];

}

export function buildSds(product: Product, derivation: Derivation, market: Market): SdsDocumentModel {
  const address = addressForMarket(market);
  const clp = derivation.clp;
  const rows = componentRows(product);
  const sdsArtefact = product.artefacts.find((artefact) => artefact.type === 'sds');
  // Null until a sheet has actually been recorded as produced, and then a real revision.
  //
  // "Revision Not yet produced, issued —." on the face of a sixteen-section safety data sheet
  // somebody may hand to a regulator is worse than an absent line, and a revision history is a
  // regulatory claim. That case is still guarded. What changed is that the other branch is now
  // reachable: `batchlabel.artefacts` holds a version and a date, so a produced sheet states a
  // real one.
  //
  // THE DATE IS FORMATTED. `printedOn` is a timestamptz off the row, so this printed
  // "issued 2026-07-01T09:00:00.000Z." — a machine timestamp, in the one section of the
  // document a person reads for provenance.
  const revisionLine =
  sdsArtefact && sdsArtefact.version !== ARTEFACT_NOT_PRODUCED ?
  `Revision ${sdsArtefact.version}, issued ${formatDate(sdsArtefact.printedOn)}.` :
  null;

  const sections: SdsSection[] = [
  {
    number: 1,
    title: 'Identification of the substance or mixture and of the company',
    kind: 'workspace',
    fields: [
    { label: 'Product identifier', value: product.name },
    { label: 'Product code', value: product.sku },
    {
      label: 'Relevant identified uses',
      value: `Consumer ${product.spec.productType.toLowerCase()}. No uses are advised against.`
    },
    { label: 'Supplier', value: `${BUSINESS.tradingName}, ${address.lines.join(', ')}` },
    { label: 'Telephone', value: BUSINESS.phone },
    { label: 'Email', value: BUSINESS.email },
    {
      label: 'Emergency telephone',
      value: market === 'GB' ? 'NHS 111, or 999 in an emergency' : '112, general emergency number'
    }]

  },
  {
    number: 2,
    title: 'Hazards identification',
    kind: 'derived',
    intro: 'The classification of the finished mixture, and the label elements that follow from it.',
    fields: [
    {
      label: 'Classification',
      value: clp?.hazards.length ?
      clp.hazards.map((hazard) => `${hazard.code}`).join(', ') :
      'Not classified as hazardous',
      why: {
        lead: 'Classified from the concentration of each hazardous component in the finished mixture.',
        meta: 'The same calculation produces the label. The two cannot disagree.',
        source: 'CLP Regulation (EC) No 1272/2008, Annex I'
      }
    },
    {
      label: 'Signal word',
      value: clp?.signalWord ?? 'None required',
      why: {
        lead: clp?.signalWord ?
        `${clp.signalWord} is the most severe signal word required by any statement on this mixture.` :
        'No component reaches a threshold that requires a signal word.',
        source: 'CLP Annex I'
      }
    },
    {
      label: 'Pictograms',
      value: clp?.pictograms.length ? clp.pictograms.join(', ') : 'None required'
    },
    ...(clp?.hazards ?? []).map((hazard) => ({
      label: hazard.code,
      value: hazard.text
    })),
    ...(clp?.allergenLine ?
    [{ label: 'EUH208', value: clp.allergenLine }] :
    [])]

  },
  {
    number: 3,
    title: 'Composition and information on ingredients',
    kind: 'derived',
    // SdsDocument.tsx prints `intro` onto the face of the A4 sheet, so this sentence is
    // handed to customers and to Trading Standards. It used to say "assembled from the
    // supplier safety data sheets on file" — an assertion, on a legal document, that this
    // account holds supplier SDSs it has never uploaded and cannot upload, two sections above
    // section 16 saying the opposite. Same wording as section 16 now.
    intro:
    'Hazardous components of the mixture, assembled from the materials in your own register as you recorded them. Batchlabel holds no copy of any supplier document. Concentrations are declared as bands.',
    components: rows
  },
  {
    number: 4,
    title: 'First aid measures',
    kind: 'needs-you',
    prompt:
    'Standard first aid measures for the hazards identified are proposed below. A competent person must confirm they are appropriate for this product before the sheet is issued.',
    lines: [
    'Inhalation: move to fresh air. Get medical advice if symptoms persist.',
    'Skin contact: wash with plenty of soap and water. If irritation or rash occurs, get medical advice.',
    'Eye contact: rinse cautiously with water for several minutes. Remove contact lenses if present and easy to do. Continue rinsing.',
    'Ingestion: rinse mouth. Do not induce vomiting. Get medical advice.']

  },
  {
    number: 5,
    title: 'Firefighting measures',
    kind: 'derived',
    lines: [
    'Suitable extinguishing media: dry chemical, carbon dioxide, foam or water spray.',
    'Unsuitable extinguishing media: water jet.',
    'Combustion may produce carbon monoxide, carbon dioxide and irritating organic vapours.',
    'Wear self-contained breathing apparatus and full protective clothing.']

  },
  {
    number: 6,
    title: 'Accidental release measures',
    kind: 'derived',
    lines: [
    'Avoid contact with skin and eyes. Ensure adequate ventilation.',
    'Contain the spill and absorb with inert material. Collect into a suitable closed container.',
    clp?.hazards.some((hazard) => hazard.code.startsWith('H41')) ?
    'Do not allow the product to enter drains or watercourses. The mixture is classified for aquatic hazard.' :
    'Do not allow large quantities to enter drains or watercourses.']

  },
  {
    number: 7,
    title: 'Handling and storage',
    kind: 'derived',
    lines: [
    'Handle in a well ventilated area. Avoid prolonged skin contact.',
    'Store in the original closed container, away from heat and direct sunlight.',
    'Keep out of reach of children.']

  },
  {
    number: 8,
    title: 'Exposure controls and personal protection',
    kind: 'needs-you',
    prompt:
    'No workplace exposure limit has been recorded for any component. Confirm whether one applies to your production process.',
    lines: [
    'No occupational exposure limits assigned for the components on file.',
    'Wear protective gloves when handling the concentrate.',
    'Ensure adequate ventilation during manufacture.']

  },
  {
    number: 9,
    title: 'Physical and chemical properties',
    kind: 'derived',
    fields: physicalFields(product)
  },
  {
    number: 10,
    title: 'Stability and reactivity',
    kind: 'derived',
    lines: [
    'Stable under the recommended storage and handling conditions.',
    'Avoid heat, flames and other ignition sources.',
    'Incompatible with strong oxidising agents.',
    'Hazardous decomposition products: carbon monoxide and carbon dioxide on combustion.']

  },
  {
    number: 11,
    title: 'Toxicological information',
    kind: 'needs-you',
    prompt:
    'No toxicological study data for the finished mixture is on file. The entries below are read across from the component sheets and must be reviewed.',
    lines: rows.length ?
    rows.map(
      (row) =>
      `${row.name}: classified ${row.classification}. Read across from the classification recorded for this material.`
    ) :
    ['No hazardous component is present above a threshold requiring classification.']
  },
  {
    number: 12,
    title: 'Ecological information',
    kind: 'derived',
    fields: [
    {
      label: 'Aquatic toxicity',
      value: clp?.hazards.some((hazard) => hazard.code.startsWith('H41')) ?
      clp.hazards.filter((hazard) => hazard.code.startsWith('H41')).map((hazard) => `${hazard.code}, ${hazard.text}`).join('; ') :
      'Not classified for aquatic hazard',
      why: {
        lead: 'Derived by the summation method from the aquatic classification of each component.',
        source: 'CLP Annex I, section 4.1'
      }
    },
    { label: 'Persistence and degradability', value: 'No data available for the mixture', missing: true },
    { label: 'PBT and vPvB assessment', value: 'The mixture contains no component assessed as PBT or vPvB.' }]

  },
  {
    number: 13,
    title: 'Disposal considerations',
    kind: 'needs-you',
    prompt:
    'The waste code depends on how and where you dispose of the product. Record your disposal route so this section can be completed.',
    lines: [
    'Dispose of contents and container in accordance with local regulations.',
    'Do not empty into drains.',
    'European Waste Catalogue code: not yet assigned.']

  },
  {
    number: 14,
    title: 'Transport information',
    kind: 'derived',
    fields: [
    {
      label: 'UN number',
      value: 'Not classified as dangerous for transport',
      why: {
        lead:
        'No component reaches a concentration that classifies the finished mixture for carriage under ADR, IMDG or IATA.',
        meta: 'Re-checked whenever the composition changes.',
        source: 'ADR 2025, part 2'
      }
    },
    { label: 'Environmental hazards', value: clp?.hazards.some((h) => h.code.startsWith('H41')) ? 'Marine pollutant when carried in bulk' : 'None' }]

  },
  {
    number: 15,
    title: 'Regulatory information',
    kind: 'workspace',
    lines: [
    market === 'GB' ?
    'Regulation (EC) No 1272/2008 on classification, labelling and packaging, as retained in GB law.' :
    'Regulation (EC) No 1272/2008 on classification, labelling and packaging.',
    'Regulation (EC) No 1907/2006 (REACH), Annex II as amended by Regulation (EU) 2020/878.',
    product.identifiers.ufi ?
    `Unique formula identifier: ${product.identifiers.ufi}` :
    'No unique formula identifier is on file for this mixture. Batchlabel does not generate one.',
    'No chemical safety assessment has been carried out for this mixture.']

  },
  {
    number: 16,
    title: 'Other information',
    kind: 'workspace',
    lines: [
    ...(revisionLine ? [revisionLine] : []),
    'Full text of the hazard statements appears in section 2.',
    // WHERE THE DATA ACTUALLY CAME FROM. This said "assembled from the supplier documents on
    // file", printed at A4 on a document a maker would hand to a customer or a regulator.
    // There is no document store, no account holds a supplier document, and every
    // classification in the sheet came from Batchlabel's shipped reference library — which is
    // what the materials register was rewritten to say plainly, and the same sentence had to
    // survive onto the artefact itself.
    //
    // IT HAS NOW MOVED AGAIN, IN THE OTHER DIRECTION, and leaving it would have been the same
    // fault mirrored: the shipped library is deleted and the classification comes from the
    // maker's OWN materials, so crediting it to Batchlabel's reference data would understate
    // whose figures they are on the one document a regulator reads. What has not changed is
    // the second half — no supplier document of theirs is held, because there is still
    // nowhere to put one.
    'This sheet was assembled from the materials in your own register, as you recorded them. Batchlabel holds no copy of any supplier document — there is nowhere to upload one — so nothing here has been checked against a document we hold. It is a draft for review by a competent person and is not issued until signed.']

  }];


  return {
    productName: product.name,
    supplierName: BUSINESS.tradingName,
    version: sdsArtefact?.version ?? 'v1',
    revisionDate: sdsArtefact?.printedOn ?? '—',
    market,
    sections,
    outstanding: sections.filter((section) => section.kind === 'needs-you').length
  };
}