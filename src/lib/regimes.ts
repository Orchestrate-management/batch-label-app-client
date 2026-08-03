import { ArtefactType, Market, Product, RegimeId } from './model';

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

export type Obligation = {
  id: string;
  regimeId: RegimeId;
  label: string;
  doneText: string;
  missingText: string;
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
  { key: 'identifier', label: 'Product identifier', regimeId: 'clp', mandatory: true, artefactTypes: ['unit-label', 'carton'] },
  { key: 'supplier', label: 'Supplier name and address', regimeId: 'clp', mandatory: true, artefactTypes: ['unit-label', 'carton'] },
  { key: 'telephone', label: 'Telephone number', regimeId: 'clp', mandatory: true, artefactTypes: ['unit-label', 'carton'], note: 'An email address does not satisfy this' },
  { key: 'quantity', label: 'Nominal quantity', regimeId: 'clp', mandatory: true, artefactTypes: ['unit-label', 'carton'] },
  { key: 'pictograms', label: 'Hazard pictograms', regimeId: 'clp', mandatory: true, artefactTypes: ['unit-label', 'carton', 'listing'] },
  { key: 'signalWord', label: 'Signal word', regimeId: 'clp', mandatory: true, artefactTypes: ['unit-label', 'carton', 'listing'] },
  { key: 'hazard', label: 'Hazard statements', regimeId: 'clp', mandatory: true, artefactTypes: ['unit-label', 'carton', 'listing'] },
  { key: 'precautionary', label: 'Precautionary statements', regimeId: 'clp', mandatory: true, artefactTypes: ['unit-label', 'carton', 'listing'] },
  { key: 'allergen', label: 'Allergen line, EUH208', regimeId: 'clp', mandatory: true, artefactTypes: ['unit-label', 'carton'] },
  { key: 'ufi', label: 'UFI', regimeId: 'clp', mandatory: true, artefactTypes: ['unit-label', 'carton'], note: 'Batchlabel does not generate one. Get it from the ECHA UFI generator' },
  { key: 'batch', label: 'Batch number', regimeId: 'clp', mandatory: true, artefactTypes: ['unit-label', 'carton'] }],

  obligations: [
  {
    id: 'clp-classification',
    regimeId: 'clp',
    label: 'Classification complete',
    doneText: 'Every component has a current classification from a document on file.',
    missingText: 'One or more components have no classification on file.',
    to: '/products/:id'
  },
  {
    id: 'clp-artefact-current',
    regimeId: 'clp',
    label: 'Label generated and current',
    doneText: 'The printed label matches the current composition.',
    missingText: 'The composition changed after the label was printed. Version the label.',
    to: '/products/:id'
  },
  {
    id: 'clp-ufi',
    regimeId: 'clp',
    label: 'UFI assigned',
    doneText: 'A UFI obtained from the ECHA UFI generator is on file for this composition.',
    missingText:
    'Batchlabel does not generate a UFI. Get one from the ECHA UFI generator for this composition and put it on the label yourself. The poison centre notification cannot be made without it.',
    to: '/products/:id/artefacts/unit-label'
  },
  {
    id: 'clp-pcn-eu',
    regimeId: 'clp',
    label: 'Poison centre notification, EU and Northern Ireland',
    doneText: 'Submitted through the ECHA submission portal.',
    missingText:
    'Not submitted. Required before this product can be placed on the EU or Northern Ireland market.',
    to: '/settings',
    market: 'EU'
  },
  {
    id: 'clp-pcn-gb',
    regimeId: 'clp',
    label: 'GB notification to the National Poisons Information Service',
    doneText: 'Submitted to the National Poisons Information Service.',
    missingText: 'Not submitted. Required for supply in Great Britain.',
    to: '/settings',
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
    artefactTypes: ['unit-label', 'carton']
  }],

  obligations: [
  {
    id: 'en15494-safety-text',
    regimeId: 'en15494',
    label: 'Candle safety symbols and wording present',
    doneText: 'The three safety symbols and the required wording are on the label.',
    missingText: 'The safety symbols or wording are missing from the current label version.',
    to: '/products/:id/artefacts/unit-label'
  }]

},
{
  id: 'cpr',
  name: 'Cosmetic products regulation',
  short: 'Cosmetics',
  reference: 'Regulation (EC) No 1223/2009, as retained in GB law',
  summary:
  'Governs the ingredient list, the declarable allergens, durability and the product information file.',
  blocks: [
  { key: 'identifier', label: 'Product identifier and function', regimeId: 'cpr', mandatory: true, artefactTypes: ['unit-label', 'carton'] },
  { key: 'nominalContent', label: 'Nominal content', regimeId: 'cpr', mandatory: true, artefactTypes: ['unit-label', 'carton'] },
  { key: 'inci', label: 'Ingredient list, INCI', regimeId: 'cpr', mandatory: true, artefactTypes: ['unit-label', 'carton'] },
  { key: 'pao', label: 'Period after opening', regimeId: 'cpr', mandatory: true, artefactTypes: ['unit-label', 'carton'] },
  { key: 'responsiblePerson', label: 'Responsible person address', regimeId: 'cpr', mandatory: true, artefactTypes: ['unit-label', 'carton'] },
  { key: 'cosmeticWarnings', label: 'Precautions for use', regimeId: 'cpr', mandatory: true, artefactTypes: ['unit-label', 'carton'] },
  { key: 'batch', label: 'Batch number', regimeId: 'cpr', mandatory: true, artefactTypes: ['unit-label', 'carton'] }],

  obligations: [
  {
    id: 'cpr-pif',
    regimeId: 'cpr',
    label: 'Product information file assembled',
    doneText: 'The file is held at the responsible person address and kept for ten years.',
    missingText: 'No product information file has been assembled for this product.',
    to: '/settings'
  },
  {
    id: 'cpr-safety-assessment',
    regimeId: 'cpr',
    label: 'Safety assessment signed',
    doneText: 'Signed by a qualified assessor and held in the product information file.',
    missingText: 'No signed cosmetic product safety report is on file.',
    to: '/settings'
  },
  {
    id: 'cpr-cpnp',
    regimeId: 'cpr',
    label: 'CPNP notification submitted',
    doneText: 'Notified through the Cosmetic Products Notification Portal.',
    missingText: 'Not notified. Required before the product is placed on the EU market.',
    to: '/settings',
    market: 'EU'
  },
  {
    id: 'cpr-responsible-person',
    regimeId: 'cpr',
    label: 'Responsible person named',
    doneText: 'Named on the label and in the product information file.',
    missingText: 'No responsible person is named for this market.',
    to: '/settings'
  },
  {
    id: 'cpr-pao',
    regimeId: 'cpr',
    label: 'Period after opening or minimum durability shown',
    doneText: 'The period after opening symbol and figure are on the label.',
    missingText: 'Neither a period after opening nor a date of minimum durability is shown.',
    to: '/products/:id/artefacts/unit-label'
  },
  {
    id: 'cpr-claims',
    regimeId: 'cpr',
    label: 'Claims substantiated',
    doneText: 'Evidence for every claim is held in the product information file.',
    missingText: 'One or more claims on the packaging have no evidence on file.',
    to: '/settings'
  },
  {
    id: 'cpr-gmp',
    regimeId: 'cpr',
    label: 'Good manufacturing practice reference',
    doneText: 'Production follows ISO 22716 and the reference is recorded.',
    missingText: 'No good manufacturing practice reference is recorded.',
    to: '/settings'
  }]

},
{
  id: 'ce',
  name: 'CE marking',
  short: 'CE',
  reference: 'Low Voltage Directive 2014/35/EU and EMC Directive 2014/30/EU',
  summary:
  'Requires a signed declaration of conformity, the standards applied, and the mark itself at a minimum height.',
  blocks: [
  { key: 'ceMark', label: 'CE mark', regimeId: 'ce', mandatory: true, artefactTypes: ['rating-plate', 'carton'], note: 'Minimum 5 mm high' },
  { key: 'model', label: 'Model and type reference', regimeId: 'ce', mandatory: true, artefactTypes: ['rating-plate', 'carton'] },
  { key: 'ratings', label: 'Electrical ratings', regimeId: 'ce', mandatory: true, artefactTypes: ['rating-plate'] },
  { key: 'importer', label: 'Manufacturer and importer block', regimeId: 'ce', mandatory: true, artefactTypes: ['rating-plate', 'carton', 'leaflet'] },
  { key: 'safetyInstructions', label: 'Safety instructions', regimeId: 'ce', mandatory: true, artefactTypes: ['leaflet'] }],

  obligations: [
  {
    id: 'ce-doc-signed',
    regimeId: 'ce',
    label: 'Declaration of conformity signed',
    doneText: 'Signed and dated, naming the directives applied.',
    missingText: 'The declaration of conformity has not been signed.',
    to: '/settings'
  },
  {
    id: 'ce-standards',
    regimeId: 'ce',
    label: 'Harmonised standards listed',
    doneText: 'EN IEC 62368-1, EN IEC 55014-1 and EN IEC 55014-2 are listed.',
    missingText: 'The standards applied have not been listed on the declaration.',
    to: '/products/:id'
  },
  {
    id: 'ce-test-reports',
    regimeId: 'ce',
    label: 'Test reports on file and in date',
    doneText: 'Every report is on file and within its validity period.',
    missingText: 'A test report is missing or has passed its validity date.',
    to: '/products/:id'
  }]

},
{
  id: 'rohs',
  name: 'Restriction of hazardous substances',
  short: 'RoHS',
  reference: 'Directive 2011/65/EU, assessed through EN IEC 63000',
  summary: 'Requires a material declaration for every component in the bill of materials.',
  blocks: [
  {
    key: 'rohsStatement',
    label: 'RoHS statement',
    regimeId: 'rohs',
    mandatory: false,
    artefactTypes: ['leaflet', 'carton']
  }],

  obligations: [
  {
    id: 'rohs-component-declarations',
    regimeId: 'rohs',
    label: 'Material declaration for every component',
    doneText: 'Every component in the bill of materials has a declaration on file.',
    missingText: 'One or more components have no material declaration on file.',
    to: '/materials/component'
  },
  {
    id: 'rohs-en63000',
    regimeId: 'rohs',
    label: 'Technical documentation to EN IEC 63000',
    doneText: 'The compilation is held with the technical file.',
    missingText: 'No EN IEC 63000 compilation has been assembled.',
    to: '/settings'
  }]

},
{
  id: 'weee',
  name: 'Waste electrical and electronic equipment',
  short: 'WEEE',
  reference: 'Directive 2012/19/EU and the UK WEEE Regulations 2013',
  summary: 'Requires producer registration and the crossed-out wheelie bin mark.',
  blocks: [
  {
    key: 'weeeBin',
    label: 'Crossed-out wheelie bin',
    regimeId: 'weee',
    mandatory: true,
    artefactTypes: ['rating-plate', 'carton', 'leaflet']
  }],

  obligations: [
  {
    id: 'weee-registration',
    regimeId: 'weee',
    label: 'Producer registration',
    doneText: 'Registered with a producer compliance scheme.',
    missingText: 'No producer registration number is recorded.',
    to: '/settings'
  },
  {
    id: 'weee-marking',
    regimeId: 'weee',
    label: 'Wheelie bin mark and producer identifier',
    doneText: 'Both appear on the rating plate.',
    missingText: 'The mark or the producer identifier is missing from the rating plate.',
    to: '/products/:id/artefacts/rating-plate'
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
    artefactTypes: ['listing', 'leaflet']
  }],

  obligations: [
  {
    id: 'gpsr-traceability',
    regimeId: 'gpsr',
    label: 'Traceability records kept',
    doneText: 'Production records identify the product, the maker and the run.',
    missingText: 'Production records do not identify the run.',
    to: '/records'
  },
  {
    id: 'gpsr-eu-responsible-person',
    regimeId: 'gpsr',
    label: 'Economic operator in the EU',
    doneText: 'An EU based responsible person is named and reachable.',
    missingText: 'No EU based economic operator is named for this product.',
    to: '/settings',
    market: 'EU'
  },
  {
    id: 'gpsr-online-disclosure',
    regimeId: 'gpsr',
    label: 'Safety information shown online before purchase',
    doneText: 'Signal word, pictograms and hazard statements appear on the listing.',
    missingText: 'The product page does not show the safety information before purchase.',
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
 * Obligations an account cannot honestly hold, whatever is stored against the
 * product. Nothing in Batchlabel generates a UFI and nothing records one, so a
 * satisfied `clp-ufi` could only ever have come from data someone typed in;
 * trusting it tells a maker a CLP obligation is met when it is not, and the
 * next thing they skip is the poison centre notification. Ignoring the stored
 * value is deliberate: showing outstanding work that is done costs an hour,
 * hiding work that is not done ships an illegal label.
 *
 * Delete an id from here the day the mechanism behind it exists.
 */
const UNSATISFIABLE: ReadonlySet<string> = new Set(['clp-ufi']);

/** The single answer to "is this obligation met", for every screen that asks. */
export function obligationSatisfied(product: Product, obligationId: string): boolean {
  if (UNSATISFIABLE.has(obligationId)) return false;
  return product.obligations[obligationId] === true;
}

/** Every obligation the product still owes. */
export function outstandingObligations(product: Product): Obligation[] {
  return obligationsFor(product).filter(
    (obligation) => !obligationSatisfied(product, obligation.id)
  );
}