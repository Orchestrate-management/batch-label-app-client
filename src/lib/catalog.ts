import {
  ComponentMaterial,
  IngredientMaterial,
  Material,
  MaterialClass,
  PackagingMaterial } from
'./model';

/* ------------------------------------------------------------ ingredients */

export const INGREDIENTS: IngredientMaterial[] = [
{
  id: 'ing-black-fig',
  class: 'ingredient',
  role: 'Fragrance oil',
  name: 'Black Fig and Cassis',
  supplier: 'Aurelia Fragrances',
  supplierCode: 'FO-4471',
  categories: ['home-fragrance', 'cosmetics'],
  inci: 'Parfum',
  inciFunction: 'Perfuming',
  document: {
    kind: 'Safety data sheet',
    reference: 'aurelia-fo-4471-sds',
    version: '4.2',
    date: '2025-11-14',
    latestVersion: '4.3',
    latestDate: '2026-06-02'
  },
  hazards: [
  {
    code: 'H317',
    statement: 'May cause an allergic skin reaction.',
    hazardClass: 'Skin Sens. 1',
    gcl: 1,
    scl: 0.4,
    pictogram: 'GHS07',
    signal: 'Warning'
  },
  {
    code: 'H319',
    statement: 'Causes serious eye irritation.',
    hazardClass: 'Eye Irrit. 2',
    gcl: 10,
    pictogram: 'GHS07',
    signal: 'Warning'
  },
  {
    code: 'H411',
    statement: 'Toxic to aquatic life with long lasting effects.',
    hazardClass: 'Aquatic Chronic 2',
    gcl: 25,
    pictogram: 'GHS09'
  },
  {
    code: 'H412',
    statement: 'Harmful to aquatic life with long lasting effects.',
    hazardClass: 'Aquatic Chronic 3',
    gcl: 2.5,
    derivation: 'Summation method, Aquatic Chronic 2 counted at ten times its concentration.'
  }],

  allergens: [
  { name: 'linalool', pct: 3.1 },
  { name: 'limonene', pct: 6.4 },
  { name: 'citronellol', pct: 1.2 },
  { name: 'geraniol', pct: 0.6 },
  { name: 'eugenol', pct: 0.2 }],

  ifra: [
  { category: 'Category 12', description: 'Non-skin contact, candles and diffusers', max: 100 },
  { category: 'Category 5A', description: 'Body lotion and face oil, leave-on', max: 1.4 },
  { category: 'Category 9', description: 'Rinse-off, soaps', max: 6.2 }],

  notes: 'Supplier gives a specific concentration limit of 0.4 percent for skin sensitisation.'
},
{
  id: 'ing-smoked-vetiver',
  class: 'ingredient',
  role: 'Fragrance oil',
  name: 'Smoked Vetiver',
  supplier: 'Halden Aromatics',
  supplierCode: 'FO-2210',
  categories: ['home-fragrance'],
  inci: 'Parfum',
  inciFunction: 'Perfuming',
  document: {
    kind: 'Safety data sheet',
    reference: 'halden-fo-2210-sds',
    version: '2.1',
    date: '2026-01-09'
  },
  hazards: [
  {
    code: 'H317',
    statement: 'May cause an allergic skin reaction.',
    hazardClass: 'Skin Sens. 1',
    gcl: 1,
    pictogram: 'GHS07',
    signal: 'Warning'
  },
  {
    code: 'H411',
    statement: 'Toxic to aquatic life with long lasting effects.',
    hazardClass: 'Aquatic Chronic 2',
    gcl: 25,
    pictogram: 'GHS09'
  },
  {
    code: 'H412',
    statement: 'Harmful to aquatic life with long lasting effects.',
    hazardClass: 'Aquatic Chronic 3',
    gcl: 2.5,
    derivation: 'Summation method, Aquatic Chronic 2 counted at ten times its concentration.'
  }],

  allergens: [
  { name: 'eugenol', pct: 1.9 },
  { name: 'linalool', pct: 1.4 },
  { name: 'limonene', pct: 0.5 },
  { name: 'citronellol', pct: 0.3 }],

  ifra: [
  { category: 'Category 12', description: 'Non-skin contact, candles and diffusers', max: 100 },
  { category: 'Category 9', description: 'Rinse-off, soaps', max: 3.8 }]

},
{
  id: 'ing-bergamot-sea-salt',
  class: 'ingredient',
  role: 'Fragrance oil',
  name: 'Bergamot and Sea Salt',
  supplier: 'Coastwise Perfumery',
  supplierCode: 'FO-8802',
  categories: ['home-fragrance'],
  inci: 'Parfum',
  inciFunction: 'Perfuming',
  document: {
    kind: 'Safety data sheet',
    reference: 'coastwise-fo-8802-sds',
    version: '3.0',
    date: '2025-08-21',
    latestVersion: '3.2',
    latestDate: '2026-05-19'
  },
  hazards: [
  {
    code: 'H317',
    statement: 'May cause an allergic skin reaction.',
    hazardClass: 'Skin Sens. 1B',
    gcl: 1,
    scl: 0.8,
    pictogram: 'GHS07',
    signal: 'Warning'
  },
  {
    code: 'H319',
    statement: 'Causes serious eye irritation.',
    hazardClass: 'Eye Irrit. 2',
    gcl: 10,
    pictogram: 'GHS07',
    signal: 'Warning'
  },
  {
    code: 'H412',
    statement: 'Harmful to aquatic life with long lasting effects.',
    hazardClass: 'Aquatic Chronic 3',
    gcl: 2.5
  }],

  allergens: [
  { name: 'limonene', pct: 12.4 },
  { name: 'linalool', pct: 4.8 },
  { name: 'geraniol', pct: 0.9 },
  { name: 'citronellol', pct: 0.4 }],

  ifra: [
  { category: 'Category 12', description: 'Non-skin contact, candles and diffusers', max: 100 },
  { category: 'Category 9', description: 'Rinse-off, soaps', max: 4.4 }]

},
{
  id: 'ing-wild-damson',
  class: 'ingredient',
  role: 'Fragrance oil',
  name: 'Wild Damson and Bay',
  supplier: 'Nightjar Fragrance Co.',
  supplierCode: 'FO-1330',
  categories: ['home-fragrance'],
  inci: 'Parfum',
  inciFunction: 'Perfuming',
  document: {
    kind: 'Safety data sheet',
    reference: 'nightjar-fo-1330-sds',
    version: '1.4',
    date: '2026-03-02'
  },
  hazards: [
  {
    code: 'H317',
    statement: 'May cause an allergic skin reaction.',
    hazardClass: 'Skin Sens. 1',
    gcl: 1,
    pictogram: 'GHS07',
    signal: 'Warning'
  },
  {
    code: 'H412',
    statement: 'Harmful to aquatic life with long lasting effects.',
    hazardClass: 'Aquatic Chronic 3',
    gcl: 2.5
  }],

  allergens: [
  { name: 'linalool', pct: 2.2 },
  { name: 'limonene', pct: 1.1 },
  { name: 'eugenol', pct: 0.8 }],

  ifra: [
  { category: 'Category 12', description: 'Non-skin contact, candles and diffusers', max: 100 }]

},
{
  id: 'ing-crw45',
  class: 'ingredient',
  role: 'Wax',
  name: 'Coconut and rapeseed wax CRW-45',
  supplier: 'Kerax',
  supplierCode: 'CRW-45',
  categories: ['home-fragrance'],
  document: {
    kind: 'Safety data sheet',
    reference: 'kerax-crw45-sds',
    version: '5.0',
    date: '2025-04-30'
  },
  hazards: [],
  allergens: [],
  ifra: [],
  notes: 'Not classified as hazardous.'
},
{
  id: 'ing-soy-c3',
  class: 'ingredient',
  role: 'Wax',
  name: 'Soy container wax C-3',
  supplier: 'Ecowax Supplies',
  supplierCode: 'C-3',
  categories: ['home-fragrance'],
  document: {
    kind: 'Safety data sheet',
    reference: 'ecowax-c3-sds',
    version: '2.6',
    date: '2025-02-11'
  },
  hazards: [],
  allergens: [],
  ifra: [],
  notes: 'Not classified as hazardous.'
},
{
  id: 'ing-dpg',
  class: 'ingredient',
  role: 'Carrier',
  name: 'Diffuser base, dipropylene glycol',
  supplier: 'Halden Aromatics',
  supplierCode: 'DPG-99',
  categories: ['home-fragrance'],
  document: {
    kind: 'Safety data sheet',
    reference: 'halden-dpg99-sds',
    version: '3.3',
    date: '2025-10-06'
  },
  hazards: [],
  allergens: [],
  ifra: [],
  notes: 'Not classified as hazardous.'
},
{
  id: 'ing-alcohol',
  class: 'ingredient',
  role: 'Carrier',
  name: "Perfumer's alcohol, denatured 96 percent",
  supplier: 'Mercia Solvents',
  supplierCode: 'PA-96',
  categories: ['home-fragrance'],
  document: {
    kind: 'Safety data sheet',
    reference: 'mercia-pa96-sds',
    version: '7.1',
    date: '2026-02-18'
  },
  hazards: [
  {
    code: 'H226',
    statement: 'Flammable liquid and vapour.',
    hazardClass: 'Flam. Liq. 3',
    gcl: 25,
    pictogram: 'GHS02',
    signal: 'Warning'
  },
  {
    code: 'H319',
    statement: 'Causes serious eye irritation.',
    hazardClass: 'Eye Irrit. 2',
    gcl: 50,
    pictogram: 'GHS07',
    signal: 'Warning'
  }],

  allergens: [],
  ifra: []
},
{
  id: 'ing-no-dye',
  class: 'ingredient',
  role: 'Dye',
  name: 'No dye',
  supplier: '—',
  supplierCode: '—',
  categories: ['home-fragrance'],
  document: { kind: 'Safety data sheet', reference: '—', version: '—', date: '—' },
  hazards: [],
  allergens: [],
  ifra: []
},
{
  id: 'ing-dye-terracotta',
  class: 'ingredient',
  role: 'Dye',
  name: 'Wax dye chip, terracotta',
  supplier: 'Kerax',
  supplierCode: 'DYE-TC',
  categories: ['home-fragrance'],
  document: {
    kind: 'Safety data sheet',
    reference: 'kerax-dyetc-sds',
    version: '1.2',
    date: '2025-09-01'
  },
  hazards: [],
  allergens: [],
  ifra: [],
  notes: 'Not classified below 1 percent in wax.'
},
{
  id: 'ing-rosehip',
  class: 'ingredient',
  role: 'Plant oil',
  name: 'Rosehip seed oil, cold pressed',
  supplier: 'Verdant Botanicals',
  supplierCode: 'BOT-RH01',
  categories: ['cosmetics'],
  inci: 'Rosa Canina Fruit Oil',
  inciFunction: 'Skin conditioning',
  cas: '84696-47-9',
  document: {
    kind: 'INCI and allergen certificate',
    reference: 'verdant-rh01-inci',
    version: '2.0',
    date: '2026-02-04'
  },
  hazards: [],
  allergens: [],
  ifra: []
},
{
  id: 'ing-meadowfoam',
  class: 'ingredient',
  role: 'Plant oil',
  name: 'Meadowfoam seed oil',
  supplier: 'Verdant Botanicals',
  supplierCode: 'BOT-MF02',
  categories: ['cosmetics'],
  inci: 'Limnanthes Alba Seed Oil',
  inciFunction: 'Skin conditioning',
  cas: '153065-40-8',
  document: {
    kind: 'INCI and allergen certificate',
    reference: 'verdant-mf02-inci',
    version: '1.3',
    date: '2025-12-12'
  },
  hazards: [],
  allergens: [],
  ifra: []
},
{
  id: 'ing-jojoba',
  class: 'ingredient',
  role: 'Plant oil',
  name: 'Jojoba oil, golden',
  supplier: 'Verdant Botanicals',
  supplierCode: 'BOT-JJ04',
  categories: ['cosmetics'],
  inci: 'Simmondsia Chinensis Seed Oil',
  inciFunction: 'Skin conditioning',
  cas: '90045-98-0',
  document: {
    kind: 'INCI and allergen certificate',
    reference: 'verdant-jj04-inci',
    version: '1.1',
    date: '2025-07-08',
    latestVersion: '1.2',
    latestDate: '2026-06-22'
  },
  hazards: [],
  allergens: [],
  ifra: []
},
{
  id: 'ing-tocopherol',
  class: 'ingredient',
  role: 'Antioxidant',
  name: 'Natural vitamin E, mixed tocopherols',
  supplier: 'Mercia Solvents',
  supplierCode: 'TOC-70',
  categories: ['cosmetics'],
  inci: 'Tocopherol',
  inciFunction: 'Antioxidant',
  cas: '1406-18-4',
  document: {
    kind: 'INCI and allergen certificate',
    reference: 'mercia-toc70-inci',
    version: '3.1',
    date: '2026-01-27'
  },
  hazards: [],
  allergens: [],
  ifra: []
}];


/* -------------------------------------------------------------- packaging */

export const PACKAGING: PackagingMaterial[] = [
{
  id: 'pkg-tumbler-250',
  class: 'packaging',
  name: 'Amber glass tumbler, 250 ml',
  supplier: 'Bellhurst Glass',
  supplierCode: 'GT-250A',
  categories: ['home-fragrance'],
  format: 'Tumbler with tin lid',
  capacityMl: 250,
  labelAreaMm: { width: 72, height: 60 },
  foodContact: false,
  childResistant: false,
  document: {
    kind: 'Technical drawing',
    reference: 'bellhurst-gt250a-drawing',
    version: '2',
    date: '2025-06-18'
  }
},
{
  id: 'pkg-diffuser-100',
  class: 'packaging',
  name: 'Clear glass diffuser bottle, 100 ml',
  supplier: 'Bellhurst Glass',
  supplierCode: 'DB-100C',
  categories: ['home-fragrance'],
  format: 'Bottle with reeds and collar',
  capacityMl: 100,
  labelAreaMm: { width: 58, height: 78 },
  foodContact: false,
  childResistant: false,
  document: {
    kind: 'Technical drawing',
    reference: 'bellhurst-db100c-drawing',
    version: '1',
    date: '2025-03-09'
  }
},
{
  id: 'pkg-spray-100',
  class: 'packaging',
  name: 'Frosted glass bottle, 100 ml, fine mist pump',
  supplier: 'Corbel Packaging',
  supplierCode: 'SP-100F',
  categories: ['home-fragrance'],
  format: 'Bottle with pump',
  capacityMl: 100,
  labelAreaMm: { width: 60, height: 80 },
  foodContact: false,
  childResistant: false,
  document: {
    kind: 'Technical drawing',
    reference: 'corbel-sp100f-drawing',
    version: '3',
    date: '2026-01-15'
  }
},
{
  id: 'pkg-clamshell',
  class: 'packaging',
  name: 'Wax melt clamshell, six segment',
  supplier: 'Corbel Packaging',
  supplierCode: 'CS-6',
  categories: ['home-fragrance'],
  format: 'Clamshell',
  capacityMl: 90,
  labelAreaMm: { width: 80, height: 40 },
  foodContact: false,
  childResistant: false,
  document: {
    kind: 'Technical drawing',
    reference: 'corbel-cs6-drawing',
    version: '1',
    date: '2024-11-21'
  }
},
{
  id: 'pkg-dropper-30',
  class: 'packaging',
  name: 'Amber dropper bottle, 30 ml',
  supplier: 'Corbel Packaging',
  supplierCode: 'DR-30A',
  categories: ['cosmetics'],
  format: 'Bottle with pipette',
  capacityMl: 30,
  labelAreaMm: { width: 44, height: 62 },
  foodContact: false,
  childResistant: false,
  document: {
    kind: 'Technical drawing',
    reference: 'corbel-dr30a-drawing',
    version: '2',
    date: '2026-04-02'
  }
},
{
  id: 'pkg-carton-30',
  class: 'packaging',
  name: 'Folding carton, 35 × 35 × 95 mm',
  supplier: 'Marsh Print',
  supplierCode: 'FC-3595',
  categories: ['cosmetics', 'electronics'],
  format: 'Folding carton',
  capacityMl: 116,
  labelAreaMm: { width: 90, height: 60 },
  foodContact: false,
  childResistant: false,
  document: {
    kind: 'Technical drawing',
    reference: 'marsh-fc3595-drawing',
    version: '1',
    date: '2026-03-30'
  }
},
{
  id: 'pkg-device-box',
  class: 'packaging',
  name: 'Device carton, 120 × 90 × 70 mm',
  supplier: 'Marsh Print',
  supplierCode: 'DC-1209',
  categories: ['electronics'],
  format: 'Corrugated carton with insert',
  capacityMl: 756,
  labelAreaMm: { width: 110, height: 80 },
  foodContact: false,
  childResistant: false,
  document: {
    kind: 'Technical drawing',
    reference: 'marsh-dc1209-drawing',
    version: '2',
    date: '2026-05-11'
  }
}];


/* ------------------------------------------------------------- components */

export const COMPONENTS: ComponentMaterial[] = [
{
  id: 'cmp-power-board',
  class: 'component',
  name: 'USB-C power board, 5 V 2 A',
  supplier: 'Linfield Electronics',
  supplierCode: 'LE-PB52',
  partNumber: 'PB-52-USBC',
  categories: ['electronics'],
  rohsStatus: 'Compliant with exemption',
  rohsExemption: 'Exemption 6(c), lead in copper alloy',
  standards: ['EN IEC 62368-1:2020', 'EN IEC 63000:2018'],
  certificateExpiry: '2027-03-04',
  document: {
    kind: 'Declaration of conformity',
    reference: 'linfield-pb52-doc',
    version: '2',
    date: '2026-03-04',
    expires: '2027-03-04'
  }
},
{
  id: 'cmp-heater',
  class: 'component',
  name: 'PTC heating element, 10 W',
  supplier: 'Linfield Electronics',
  supplierCode: 'LE-PTC10',
  partNumber: 'PTC-10-45C',
  categories: ['electronics'],
  rohsStatus: 'Compliant',
  standards: ['EN IEC 62368-1:2020'],
  certificateExpiry: '2026-09-30',
  document: {
    kind: 'Test report',
    reference: 'linfield-ptc10-report',
    version: '1',
    date: '2024-09-30',
    expires: '2026-09-30'
  },
  notes: 'Certificate expires within 60 days.'
},
{
  id: 'cmp-cable',
  class: 'component',
  name: 'Silicone USB-C cable, 1.2 m',
  supplier: 'Harrow Cable Co.',
  supplierCode: 'HC-SC12',
  partNumber: 'SC-1200-BLK',
  categories: ['electronics'],
  rohsStatus: 'Not declared',
  standards: [],
  certificateExpiry: '—',
  document: {
    kind: 'Declaration of conformity',
    reference: '—',
    version: '—',
    date: '—'
  },
  notes: 'No declaration on file. The supplier has been asked twice.'
},
{
  id: 'cmp-housing',
  class: 'component',
  name: 'Ceramic housing with ABS base',
  supplier: 'Wren Moulding',
  supplierCode: 'WM-CH20',
  partNumber: 'CH-20-STONE',
  categories: ['electronics'],
  rohsStatus: 'Compliant',
  standards: ['EN IEC 63000:2018'],
  certificateExpiry: '2028-01-19',
  document: {
    kind: 'Declaration of conformity',
    reference: 'wren-ch20-doc',
    version: '1',
    date: '2026-01-19',
    expires: '2028-01-19'
  }
},
{
  id: 'cmp-led',
  class: 'component',
  name: 'Warm white LED indicator',
  supplier: 'Linfield Electronics',
  supplierCode: 'LE-LED27',
  partNumber: 'LED-2700K',
  categories: ['electronics'],
  rohsStatus: 'Compliant',
  standards: ['EN IEC 55014-1:2021', 'EN IEC 63000:2018'],
  certificateExpiry: '2027-11-02',
  document: {
    kind: 'Declaration of conformity',
    reference: 'linfield-led27-doc',
    version: '3',
    date: '2025-11-02',
    expires: '2027-11-02'
  }
}];


export const MATERIALS: Material[] = [...INGREDIENTS, ...PACKAGING, ...COMPONENTS];

export function materialById(id: string): Material | undefined {
  return MATERIALS.find((m) => m.id === id);
}

/* --------------------------------------------------- the document layer */




export function ingredientById(id: string): IngredientMaterial | undefined {
  return INGREDIENTS.find((i) => i.id === id);
}

export function packagingById(id: string): PackagingMaterial | undefined {
  return PACKAGING.find((p) => p.id === id);
}

export function componentById(id: string): ComponentMaterial | undefined {
  return COMPONENTS.find((c) => c.id === id);
}

export const MATERIAL_CLASSES: Array<{
  id: MaterialClass;
  label: string;
  blurb: string;
  documentRule: string;
  emptyBody: string;
}> = [
{
  id: 'ingredient',
  label: 'Ingredients',
  blurb: 'Anything that goes into the mixture. Classified at 100 percent, before any load is applied.',
  documentRule: 'A safety data sheet, or for cosmetics an INCI and allergen certificate.',
  emptyBody:
  'Drop a safety data sheet or an INCI and allergen certificate here. The extracted fields appear beside the source page so you can confirm or correct each one before the record is saved.'
},
{
  id: 'packaging',
  label: 'Packaging',
  blurb: 'Containers and cartons. Capacity and available label area drive label geometry.',
  documentRule: 'A technical drawing or dimension sheet.',
  emptyBody:
  'Drop a technical drawing or dimension sheet here. Capacity and printable area are read from it and feed the minimum label size on every product that uses this packaging.'
},
{
  id: 'component',
  label: 'Components',
  blurb: 'Parts in a bill of materials, each carrying its own conformity evidence.',
  documentRule: 'A declaration of conformity or a test report.',
  emptyBody:
  'Drop a declaration of conformity or a test report here. Components without a declaration cannot be included in a signed declaration of conformity for the finished device.'
}];