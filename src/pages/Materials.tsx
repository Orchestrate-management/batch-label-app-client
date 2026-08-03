import React, { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeftIcon,
  CheckIcon,
  PencilIcon,
  PlusIcon,
  UploadIcon } from
'lucide-react';
import { NewProductDialog } from '../components/NewProductDialog';
import { useEntitlement } from '../lib/entitlement';
import { toast } from 'sonner';
import { PageHeader } from '../components/AppShell';
import {
  Button,
  Callout,
  Card,
  Input,
  Pill,
  SectionTitle } from
'../components/ui/Primitives';
import {
  COMPONENTS,
  INGREDIENTS,
  MATERIALS,
  MATERIAL_CLASSES,
  PACKAGING,
  materialById } from
'../lib/catalog';
import {
  ComponentMaterial,
  DocumentKind,
  IngredientMaterial,
  Material,
  MaterialClass,
  PackagingMaterial,
  formatDate } from
'../lib/model';



const DOCUMENT_FOR_CLASS: Record<MaterialClass, DocumentKind> = {
  ingredient: 'Safety data sheet',
  packaging: 'Technical drawing',
  component: 'Declaration of conformity'
};

/**
 * The materials register, and WHOSE MATERIALS IT HOLDS.
 *
 * It holds Batchlabel's. Every material on this screen is shipped reference data (lib/
 * catalog.ts), and the page used to be written as though it were the account's procurement
 * record: "Everything you buy, held with the supplier document it was read from", 14
 * ingredients counted in a tab, a safety data sheet version and date "on file", a certificate
 * "valid to", and a warning that a supplier had published a newer sheet than the one being
 * used. A maker signing in for the first time — with a virgin account, by construction — met a
 * fully populated register of purchases they had never made, and an empty state that could
 * never render.
 *
 * The catalogue itself stays: it is load-bearing for every classification, and shipping a
 * reference library is a legitimate thing to do. What changes is that the screen now says
 * whose it is, and stops asserting the things only an account could know — what was received,
 * what is on file, and what a supplier has published since.
 *
 * The two account-shaped sections below (the document inbox and the conformity store) say they
 * are not built, which they are not.
 */
export function Materials() {
  const { materialClass, materialId } = useParams();
  const navigate = useNavigate();
  const [importing, setImporting] = useState<MaterialClass | null>(null);

  const activeClass = materialClass as MaterialClass ?? 'ingredient';

  if (materialId) {
    const material = materialById(materialId);
    if (material) return <MaterialDetail material={material} />;
  }

  if (importing) return <ImportFlow materialClass={importing} onClose={() => setImporting(null)} />;

  const counts: Record<MaterialClass, number> = {
    ingredient: INGREDIENTS.length,
    packaging: PACKAGING.length,
    component: COMPONENTS.length
  };

  const definition = MATERIAL_CLASSES.find((c) => c.id === activeClass) ?? MATERIAL_CLASSES[0];
  const items = MATERIALS.filter((item) => item.class === activeClass);

  return (
    <main className="flex-1 pb-24 xl:pb-0">
      <PageHeader
        eyebrow="Products · reference library"
        title="Materials"
        description="The materials Batchlabel ships with, each one classified from the supplier document its data was read from. These are ours, not yours: nothing here was bought, received or uploaded by your account, and holding your own materials is not built yet."
        actions={
        /* Not "Add from a document". Reading one is a walkthrough of an unbuilt feature —
           it parses nothing, saves nothing, and says so when you reach the end — and a
           primary button promising to add a material sat directly under a description
           saying you cannot yet hold one. */
        <Button variant="secondary" onClick={() => setImporting(activeClass)}>
            <UploadIcon className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />
            See how a document is read
          </Button>
        } />
      

      <DocumentInbox />

      <div className="space-y-4 px-6 py-8 lg:px-10">
        <nav
          aria-label="Material classes"
          className="flex flex-wrap items-center gap-1 border-b border-paper-line">
          
          {MATERIAL_CLASSES.map((entry) => {
            const active = entry.id === activeClass;
            return (
              <button
                key={entry.id}
                type="button"
                onClick={() => navigate(`/materials/${entry.id}`)}
                aria-current={active ? 'page' : undefined}
                className={`-mb-px flex items-center gap-2 border-b-2 px-3 py-2.5 text-sm transition-colors ${
                active ?
                'border-teal font-medium text-ink' :
                'border-transparent text-ink-secondary hover:text-ink'}`
                }>
                
                {entry.label}
                <span className="tabular text-2xs text-ink-tertiary">{counts[entry.id]}</span>
              </button>);

          })}
        </nav>

        <section aria-label={definition.label} className="space-y-4">
          <p className="max-w-prose text-2xs leading-relaxed text-ink-tertiary">
            {definition.documentRule}
          </p>

          {/* No empty state. There is nothing to be empty: the library ships in the bundle,
              so `items.length === 0` was unreachable code whose copy — "No ingredients yet.
              Drop a safety data sheet here" — described an account's own register and a
              feature that does not exist. */}
          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              {activeClass === 'ingredient' &&
              <IngredientTable items={items as IngredientMaterial[]} onOpen={navigate} />
              }
              {activeClass === 'packaging' &&
              <PackagingTable items={items as PackagingMaterial[]} onOpen={navigate} />
              }
              {activeClass === 'component' &&
              <ComponentTable items={items as ComponentMaterial[]} onOpen={navigate} />
              }
            </div>
          </Card>

          {activeClass === 'component' && <ConformityStore />}
        </section>
      </div>
    </main>);

}

/**
 * Evidence for the components above, so it belongs beside them rather than in
 * settings. A declaration is material data, not configuration.
 *
 * NOTHING IS STORED HERE YET. This table used to list five documents belonging to a business
 * that does not exist — a declaration of conformity for a wax warmer, a cosmetic product
 * safety report, a WEEE producer registration with a registration number on it. A WEEE
 * registration number is printed on a device label and is a claim to a regulator; a signed
 * declaration of conformity is the document that makes a product legal to sell. Showing
 * either as "held" when the account holds neither is the most expensive kind of wrong this
 * application can be.
 *
 * There is no documents table in the account data schema, so the honest version of this
 * section is the sentence below. The fixtures are in lib/fixtures.ts, for the tests.
 */
function ConformityStore() {
  return (
    <div className="pt-4">
      <SectionTitle className="mb-1">Conformity document store</SectionTitle>
      <p className="mb-3 max-w-prose text-2xs leading-relaxed text-ink-tertiary">
        The evidence behind the components above. A declaration cannot be signed while any
        component it covers is unsupported.
      </p>
      <Callout tone="info" title="Not built yet">
        <p className="max-w-prose leading-relaxed">
          You cannot upload or hold a declaration of conformity, a test report or a producer
          registration here yet, and nothing of yours is stored. Keep them where you keep them
          now. We would rather say so than list documents you do not have.
        </p>
      </Callout>
    </div>);

}

/**
 * The document inbox, which does not exist.
 *
 * This rendered "3 documents received, none read yet" — with supplier names, dates and a
 * Review button — from a constant shipped in the bundle. Every account saw the same three,
 * including an account that had received nothing and could not receive anything, because
 * there is no document store and no way to send one.
 *
 * Replaced rather than hidden. A maker who reads "documents received" and finds none has
 * lost nothing; a maker who reads it and believes it has been told their supplier sent
 * something they now need to act on.
 */
function DocumentInbox() {
  return (
    <section aria-labelledby="inbox-heading" className="mb-8">
      <SectionTitle className="mb-3">
        <span id="inbox-heading">Document inbox</span>
      </SectionTitle>
      <Callout tone="info" title="Not built yet">
        <p className="max-w-prose leading-relaxed">
          There is nowhere to send a supplier document yet, and nothing of yours is stored.
          Keep your safety data sheets where you keep them now. We would rather say so than
          show you an inbox with somebody else&rsquo;s documents in it.
        </p>
      </Callout>
    </section>);

}

const headRow =
'border-b border-paper-line bg-paper-panel/60 text-2xs uppercase tracking-[0.1em] text-ink-tertiary';
const cell = 'px-5 py-3.5 text-ink-secondary';
const rowClass = 'cursor-pointer border-b border-paper-line last:border-0 hover:bg-teal-tint';

function IngredientTable({
  items,
  onOpen



}: {items: IngredientMaterial[];onOpen: (to: string) => void;}) {
  return (
    <table className="w-full min-w-[900px] text-left text-sm">
      <thead>
        <tr className={headRow}>
          <th scope="col" className="px-5 py-3 font-medium">Name</th>
          <th scope="col" className="px-5 py-3 font-medium">Supplier</th>
          {/* "Read from", not "Document": the version and date say which supplier document
              this library's data was taken from, and not that a document is held for you. */}
          <th scope="col" className="px-5 py-3 font-medium">Read from</th>
          <th scope="col" className="px-5 py-3 font-medium">Hazards at 100 percent</th>
          <th scope="col" className="px-5 py-3 font-medium">Allergens</th>
          <th scope="col" className="px-5 py-3 font-medium">INCI</th>
        </tr>
      </thead>
      <tbody>
        {items.map((item) =>
        <tr
          key={item.id}
          className={rowClass}
          onClick={() => onOpen(`/materials/ingredient/${item.id}`)}>
          
            <td className="px-5 py-3.5">
              <span className="font-medium text-ink">{item.name}</span>
              <span className="tabular ml-2 text-2xs text-ink-tertiary">{item.supplierCode}</span>
            </td>
            <td className={cell}>{item.supplier}</td>
            <td className="px-5 py-3.5">
              <span className="tabular text-ink-secondary">
                {item.document.kind}, v{item.document.version}, {formatDate(item.document.date)}
              </span>
            </td>
            <td className={cell}>
              {item.hazards.length ? item.hazards.map((h) => h.code).join(', ') : 'Not classified'}
            </td>
            <td className={cell}>{item.allergens.length ? `${item.allergens.length} declared` : '—'}</td>
            <td className={cell}>{item.inci ?? '—'}</td>
          </tr>
        )}
      </tbody>
    </table>);

}

function PackagingTable({
  items,
  onOpen



}: {items: PackagingMaterial[];onOpen: (to: string) => void;}) {
  return (
    <table className="w-full min-w-[900px] text-left text-sm">
      <thead>
        <tr className={headRow}>
          <th scope="col" className="px-5 py-3 font-medium">Name</th>
          <th scope="col" className="px-5 py-3 font-medium">Supplier</th>
          <th scope="col" className="px-5 py-3 font-medium">Format</th>
          <th scope="col" className="px-5 py-3 font-medium">Capacity</th>
          <th scope="col" className="px-5 py-3 font-medium">Label area</th>
          <th scope="col" className="px-5 py-3 font-medium">Status</th>
        </tr>
      </thead>
      <tbody>
        {items.map((item) =>
        <tr
          key={item.id}
          className={rowClass}
          onClick={() => onOpen(`/materials/packaging/${item.id}`)}>
          
            <td className="px-5 py-3.5">
              <span className="font-medium text-ink">{item.name}</span>
              <span className="tabular ml-2 text-2xs text-ink-tertiary">{item.supplierCode}</span>
            </td>
            <td className={cell}>{item.supplier}</td>
            <td className={cell}>{item.format}</td>
            <td className={`tabular ${cell}`}>{item.capacityMl} ml</td>
            <td className={`tabular ${cell}`}>
              {item.labelAreaMm.width} × {item.labelAreaMm.height} mm
            </td>
            <td className="px-5 py-3.5">
              <div className="flex flex-wrap gap-1.5">
                <Pill tone="quiet">{item.foodContact ? 'Food contact' : 'Not food contact'}</Pill>
                {item.childResistant && <Pill tone="quiet">Child resistant</Pill>}
              </div>
            </td>
          </tr>
        )}
      </tbody>
    </table>);

}

function ComponentTable({
  items,
  onOpen



}: {items: ComponentMaterial[];onOpen: (to: string) => void;}) {
  return (
    <table className="w-full min-w-[900px] text-left text-sm">
      <thead>
        <tr className={headRow}>
          <th scope="col" className="px-5 py-3 font-medium">Name</th>
          <th scope="col" className="px-5 py-3 font-medium">Supplier</th>
          <th scope="col" className="px-5 py-3 font-medium">Part number</th>
          <th scope="col" className="px-5 py-3 font-medium">RoHS</th>
          <th scope="col" className="px-5 py-3 font-medium">Standards</th>
          {/* The supplier's own certificate validity, from the document this data was read
              from — not evidence held for this account, which holds none. */}
          <th scope="col" className="px-5 py-3 font-medium">Supplier certificate to</th>
        </tr>
      </thead>
      <tbody>
        {items.map((item) =>
        <tr
          key={item.id}
          className={rowClass}
          onClick={() => onOpen(`/materials/component/${item.id}`)}>
          
            <td className="px-5 py-3.5">
              <span className="font-medium text-ink">{item.name}</span>
            </td>
            <td className={cell}>{item.supplier}</td>
            <td className={`tabular ${cell}`}>{item.partNumber}</td>
            <td className="px-5 py-3.5">
              <Pill tone={item.rohsStatus === 'Not declared' ? 'warn' : 'good'}>
                {item.rohsStatus}
              </Pill>
            </td>
            <td className={cell}>{item.standards.length ? item.standards.join(', ') : '—'}</td>
            <td className={`tabular ${cell}`}>{formatDate(item.certificateExpiry)}</td>
          </tr>
        )}
      </tbody>
    </table>);

}

/* --------------------------------------------------------------- detail */

function MaterialDetail({ material }: {material: Material;}) {
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  const entitlement = useEntitlement();
  // Same gate as Studio and Products: a suspended account's insert is refused by the policy,
  // so the button that starts one is not offered. The dialog carries the same check as a
  // backstop, and says why.
  const suspended = !entitlement.loading && entitlement.status === 'suspended';
  return (
    <main className="flex-1 pb-24 xl:pb-0">
      <PageHeader
        eyebrow={`Reference library · ${material.class === 'ingredient' ? material.role : material.class === 'packaging' ? 'Packaging' : 'Component'}`}
        title={material.name}
        description={`${material.supplier}, ${material.supplierCode}. Batchlabel's data for this material was read from ${material.document.kind.toLowerCase()} version ${material.document.version}, dated ${formatDate(material.document.date)}. Nothing is stored for your account.`}
        actions={
        <>
            <Button variant="quiet" onClick={() => navigate(`/materials/${material.class}`)}>
              <ArrowLeftIcon className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />
              Register
            </Button>
            {material.class === 'ingredient' && material.role === 'Fragrance oil' && !suspended &&
          <Button variant="primary" onClick={() => setCreating(true)}>
                <PlusIcon className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />
                Make something with this
              </Button>
          }
          </>
        } />
      

      {creating &&
      <NewProductDialog fragranceId={material.id} onClose={() => setCreating(false)} />
      }
      <div className="space-y-6 px-6 py-8 lg:px-10">
        {/* "A newer document exists" is gone, with the two fields that drove it. It said a
            supplier had published a newer version than the one in use and that
            "classifications, percentages and declarations may have changed" — a warning about
            a real product's compliance, produced by a constant in the bundle, having checked
            nothing. Its Import button then admitted that reading a document is not built. */}

        {material.class === 'component' && material.rohsStatus === 'Not declared' &&
        <Callout tone="warn" title="No declaration on file">
            This component cannot be included in a signed declaration of conformity until{' '}
            {material.supplier} provides a declaration or test evidence. Ask for a declaration
            covering EN IEC 63000:2018.
          </Callout>
        }

        {material.class === 'ingredient' && <IngredientDetail material={material} />}
        {material.class === 'packaging' && <PackagingDetail material={material} />}
        {material.class === 'component' && <ComponentDetail material={material} />}

        <DocumentSource material={material} />
      </div>
    </main>);

}

/**
 * Which supplier document this library's data was read from.
 *
 * It was "Every sheet ever received, and what each revision moved" — a timeline with "received"
 * dates, an "On file" pill and a "Waiting in the inbox" pill, read from a shipped constant. No
 * revision history exists, nothing records one, and no account has received anything, so the
 * timeline and the empty list it was reduced to are both gone: what is left is the one fact
 * this file actually holds, said once, about Batchlabel's data rather than about the reader's.
 */
function DocumentSource({ material }: {material: Material;}) {
  return (
    <Card className="px-5 py-5">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <SectionTitle>Source document</SectionTitle>
        <p className="text-2xs text-ink-tertiary">
          {material.document.kind} · {material.supplier}
        </p>
      </div>

      <p className="mt-3 max-w-prose text-[0.8125rem] leading-relaxed text-ink-secondary">
        The classification above was read from {material.supplier}&rsquo;s{' '}
        {material.document.kind.toLowerCase()} version {material.document.version}, dated{' '}
        {formatDate(material.document.date)}. Batchlabel holds no copy of it for you, keeps no
        revision history, and does not check whether a newer version has been published.
      </p>
    </Card>);

}

function IngredientDetail({ material }: {material: IngredientMaterial;}) {
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Card className="px-5 py-5">
        <SectionTitle className="mb-3">Hazard classification at 100 percent</SectionTitle>
        {material.hazards.length === 0 ?
        <p className="text-sm text-ink-secondary">Not classified as hazardous.</p> :

        <ul className="space-y-3">
            {material.hazards.map((hazard) =>
          <li key={hazard.code} className="border-b border-paper-line pb-3 last:border-0 last:pb-0">
                <p className="text-sm text-ink">
                  <span className="tabular font-medium">{hazard.code}</span> {hazard.statement}
                </p>
                <p className="tabular mt-1 text-2xs text-ink-tertiary">
                  {hazard.hazardClass} · generic limit {hazard.gcl} percent
                  {hazard.scl != null ? ` · supplier specific limit ${hazard.scl} percent` : ''}
                </p>
              </li>
          )}
          </ul>
        }
      </Card>

      <Card className="px-5 py-5">
        <SectionTitle className="mb-3">Declared allergens</SectionTitle>
        {material.allergens.length === 0 ?
        <p className="text-sm text-ink-secondary">None declared.</p> :

        <table className="w-full text-left text-sm">
            <tbody>
              {material.allergens.map((allergen) =>
            <tr key={allergen.name} className="border-b border-paper-line last:border-0">
                  <td className="py-2 text-ink">{allergen.name}</td>
                  <td className="tabular py-2 text-right text-ink-secondary">{allergen.pct} %</td>
                </tr>
            )}
            </tbody>
          </table>
        }
      </Card>

      <Card className="px-5 py-5">
        <SectionTitle className="mb-3">Cosmetic identity</SectionTitle>
        <dl className="space-y-2 text-sm">
          <Row term="INCI name" value={material.inci ?? 'Not applicable'} />
          <Row term="Function" value={material.inciFunction ?? '—'} />
          <Row term="CAS" value={material.cas ?? '—'} />
        </dl>
        <p className="mt-4 text-2xs leading-relaxed text-ink-tertiary">
          The INCI name is used when this material appears in a cosmetic formula. A fragrance oil
          appears as Parfum, with its declarable allergens listed after it.
        </p>
      </Card>

      <Card className="px-5 py-5">
        <SectionTitle className="mb-3">IFRA and concentration limits</SectionTitle>
        {material.ifra.length === 0 ?
        <p className="text-sm text-ink-secondary">No IFRA categories on file.</p> :

        <table className="w-full text-left text-sm">
            <tbody>
              {material.ifra.map((limit) =>
            <tr key={limit.category} className="border-b border-paper-line last:border-0">
                  <td className="py-2">
                    <span className="text-ink">{limit.category}</span>
                    <span className="block text-2xs text-ink-tertiary">{limit.description}</span>
                  </td>
                  <td className="tabular py-2 text-right text-ink-secondary">{limit.max} %</td>
                </tr>
            )}
            </tbody>
          </table>
        }
        {material.hazards.some((h) => h.scl != null) ?
        <ul className="mt-4 space-y-2 text-[0.8125rem] text-ink-secondary">
            {material.hazards.
          filter((h) => h.scl != null).
          map((hazard) =>
          <li key={hazard.code} className="tabular">
                  {hazard.code}, {hazard.hazardClass}: {hazard.scl} percent, given by the supplier in
                  place of the generic {hazard.gcl} percent limit.
                </li>
          )}
          </ul> :

        <p className="mt-4 text-[0.8125rem] text-ink-secondary">
            No specific concentration limits given. Generic limits apply.
          </p>
        }
      </Card>
    </div>);

}

function PackagingDetail({ material }: {material: PackagingMaterial;}) {
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Card className="px-5 py-5">
        <SectionTitle className="mb-3">Dimensions</SectionTitle>
        <dl className="space-y-2 text-sm">
          <Row term="Format" value={material.format} />
          <Row term="Capacity" value={`${material.capacityMl} ml`} />
          <Row
            term="Printable area"
            value={`${material.labelAreaMm.width} × ${material.labelAreaMm.height} mm`} />
          
        </dl>
        <p className="mt-4 max-w-prose text-2xs leading-relaxed text-ink-tertiary">
          Capacity sets the minimum label and pictogram size under CLP Annex I, Table 1.3. Printable
          area is checked against the artefact size in the designer.
        </p>
      </Card>
      <Card className="px-5 py-5">
        <SectionTitle className="mb-3">Status</SectionTitle>
        <dl className="space-y-2 text-sm">
          <Row term="Food contact" value={material.foodContact ? 'Declared' : 'Not declared'} />
          <Row term="Child resistant" value={material.childResistant ? 'Yes' : 'No'} />
          <Row term="Read from" value={`${material.document.kind}, v${material.document.version}`} />
        </dl>
      </Card>
    </div>);

}

function ComponentDetail({ material }: {material: ComponentMaterial;}) {
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Card className="px-5 py-5">
        <SectionTitle className="mb-3">Conformity evidence</SectionTitle>
        <dl className="space-y-2 text-sm">
          <Row term="Part number" value={material.partNumber} />
          <Row term="RoHS status" value={material.rohsStatus} />
          <Row term="Exemption claimed" value={material.rohsExemption ?? 'None'} />
          <Row term="Read from" value={`${material.document.kind} ${material.document.version}`} />
          <Row term="Document issued" value={formatDate(material.document.date)} />
          <Row
            term="Supplier certificate to"
            value={formatDate(material.certificateExpiry)} />


        </dl>
      </Card>
      <Card className="px-5 py-5">
        <SectionTitle className="mb-3">Standards carried</SectionTitle>
        {material.standards.length === 0 ?
        <p className="text-sm text-ink-secondary">
            None. This component contributes no standards to the declaration of conformity.
          </p> :

        <ul className="space-y-2 text-sm text-ink-secondary">
            {material.standards.map((standard) =>
          <li key={standard} className="tabular border-b border-paper-line pb-2 last:border-0">
                {standard}
              </li>
          )}
          </ul>
        }
        {material.notes &&
        <p className="mt-4 max-w-prose text-[0.8125rem] leading-relaxed text-ink-tertiary">
            {material.notes}
          </p>
        }
      </Card>
    </div>);

}

function Row({ term, value }: {term: string;value: string;}) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-paper-line pb-2 last:border-0 last:pb-0">
      <dt className="text-ink-secondary">{term}</dt>
      <dd className="tabular max-w-[60%] text-right text-ink">{value}</dd>
    </div>);

}

/* ------------------------------------------------------- document import */

type ParsedField = {
  key: string;
  label: string;
  value: string;
  status: 'confirmed' | 'unconfirmed' | 'missing';
  sourceSection: string;
  /**
   * How sure the parser is of the value it read. A low confidence field is
   * marked as such rather than presented as fact.
   */
  confidence?: 'high' | 'low';
  uncertainty?: string;
};

const FIELDS_BY_DOCUMENT: Record<DocumentKind, ParsedField[]> = {
  'Safety data sheet': [
  { key: 'name', label: 'Product name', value: 'Amber and Tonka', status: 'unconfirmed', sourceSection: 'Section 1.1' },
  { key: 'supplier', label: 'Supplier', value: 'Aurelia Fragrances', status: 'unconfirmed', sourceSection: 'Section 1.3' },
  { key: 'code', label: 'Supplier code', value: 'FO-5194', status: 'unconfirmed', sourceSection: 'Section 1.1' },
  { key: 'version', label: 'Document version', value: '1.0', status: 'unconfirmed', sourceSection: 'Header' },
  { key: 'date', label: 'Revision date', value: '2026-07-11', status: 'unconfirmed', sourceSection: 'Header' },
  { key: 'hazards', label: 'Hazard statements', value: 'H317, H319, H412', status: 'unconfirmed', sourceSection: 'Section 2.2' },
  { key: 'scl', label: 'Specific concentration limits', value: '', status: 'missing', sourceSection: 'Section 3.2' },
  {
    key: 'allergens',
    label: 'Declared allergens',
    value: 'coumarin 2.4 %, linalool 1.9 %, eugenol 0.4 %',
    status: 'unconfirmed',
    sourceSection: 'Allergen annex',
    confidence: 'low',
    uncertainty:
    'Read from a table with merged cells. The eugenol figure may be 0.4 or 0.6 percent — check it against the annex.'
  }],

  'INCI and allergen certificate': [
  { key: 'name', label: 'Material name', value: 'Sweet almond oil', status: 'unconfirmed', sourceSection: 'Header' },
  { key: 'inci', label: 'INCI name', value: 'Prunus Amygdalus Dulcis Oil', status: 'unconfirmed', sourceSection: 'Identity' },
  { key: 'function', label: 'Function', value: 'Skin conditioning', status: 'unconfirmed', sourceSection: 'Identity' },
  { key: 'cas', label: 'CAS number', value: '8007-69-0', status: 'unconfirmed', sourceSection: 'Identity' },
  { key: 'allergens', label: 'Declarable allergens', value: 'None above the reporting limit', status: 'unconfirmed', sourceSection: 'Allergen statement' },
  { key: 'origin', label: 'Country of origin', value: '', status: 'missing', sourceSection: 'Not stated' }],

  'Technical drawing': [
  { key: 'name', label: 'Item name', value: 'Amber glass jar, 180 ml', status: 'unconfirmed', sourceSection: 'Title block' },
  { key: 'code', label: 'Supplier code', value: 'GJ-180A', status: 'unconfirmed', sourceSection: 'Title block' },
  { key: 'capacity', label: 'Brim capacity', value: '180 ml', status: 'unconfirmed', sourceSection: 'Dimensions' },
  { key: 'label', label: 'Printable area', value: '68 × 54 mm', status: 'unconfirmed', sourceSection: 'Decoration area' },
  { key: 'material', label: 'Material', value: 'Soda lime glass', status: 'unconfirmed', sourceSection: 'Notes' },
  { key: 'foodContact', label: 'Food contact declaration', value: '', status: 'missing', sourceSection: 'Not stated' }],

  'Declaration of conformity': [
  { key: 'name', label: 'Component name', value: 'Silicone USB-C cable, 1.2 m', status: 'unconfirmed', sourceSection: 'Header' },
  { key: 'part', label: 'Part number', value: 'SC-1200-BLK', status: 'unconfirmed', sourceSection: 'Product identification' },
  { key: 'supplier', label: 'Supplier', value: 'Harrow Cable Co.', status: 'unconfirmed', sourceSection: 'Manufacturer' },
  { key: 'directives', label: 'Directives covered', value: '2011/65/EU, 2014/30/EU', status: 'unconfirmed', sourceSection: 'Declaration' },
  { key: 'standards', label: 'Standards applied', value: 'EN IEC 63000:2018', status: 'unconfirmed', sourceSection: 'Standards' },
  { key: 'signature', label: 'Signature and date', value: '', status: 'missing', sourceSection: 'Not present' }],

  'Test report': [
  { key: 'name', label: 'Item tested', value: 'PTC heating element, 10 W', status: 'unconfirmed', sourceSection: 'Header' },
  { key: 'lab', label: 'Laboratory', value: 'Southgate Test House', status: 'unconfirmed', sourceSection: 'Header' },
  { key: 'standard', label: 'Standard', value: 'EN IEC 62368-1:2020', status: 'unconfirmed', sourceSection: 'Scope' },
  { key: 'date', label: 'Test date', value: '2024-09-30', status: 'unconfirmed', sourceSection: 'Summary' },
  { key: 'result', label: 'Result', value: 'Pass', status: 'unconfirmed', sourceSection: 'Summary' },
  { key: 'validity', label: 'Validity period', value: '', status: 'missing', sourceSection: 'Not stated' }]

};

const SOURCE_PAGES: Record<DocumentKind, {file: string;body: React.ReactNode;}> = {
  'Safety data sheet': {
    file: 'aurelia-fo-5194-sds-v1.0.pdf',
    body:
    <>
        <p className="font-display text-sm font-semibold">SAFETY DATA SHEET</p>
        <p className="mt-0.5 text-2xs text-ink-tertiary">
          According to Regulation (EC) No 1907/2006. Version 1.0. Revised 11 July 2026.
        </p>
        <p className="mt-4 font-medium">SECTION 1: Identification</p>
        <p>1.1 Product identifier: Amber and Tonka, FO-5194</p>
        <p>1.3 Supplier: Aurelia Fragrances, Cheltenham GL52 6RN</p>
        <p className="mt-3 font-medium">SECTION 2: Hazards identification</p>
        <p className="mt-1 bg-teal-selected px-1">
          2.2 Label elements: Warning. H317 May cause an allergic skin reaction. H319 Causes serious
          eye irritation. H412 Harmful to aquatic life with long lasting effects.
        </p>
        <p className="mt-3 text-ink-tertiary">
          No specific concentration limits are stated in this document.
        </p>
      </>

  },
  'INCI and allergen certificate': {
    file: 'verdant-almond-inci-v1.0.pdf',
    body:
    <>
        <p className="font-display text-sm font-semibold">INCI AND ALLERGEN CERTIFICATE</p>
        <p className="mt-0.5 text-2xs text-ink-tertiary">Verdant Botanicals. Issued 3 July 2026.</p>
        <p className="mt-4 font-medium">Identity</p>
        <p className="bg-teal-selected px-1">INCI: Prunus Amygdalus Dulcis Oil. CAS 8007-69-0.</p>
        <p>Function: skin conditioning.</p>
        <p className="mt-3 font-medium">Allergen statement</p>
        <p>None of the 26 substances listed in Annex III are present above the reporting limit.</p>
        <p className="mt-3 text-ink-tertiary">Country of origin is not stated on this certificate.</p>
      </>

  },
  'Technical drawing': {
    file: 'bellhurst-gj180a-drawing-rev2.pdf',
    body:
    <>
        <p className="font-display text-sm font-semibold">TECHNICAL DRAWING</p>
        <p className="mt-0.5 text-2xs text-ink-tertiary">Bellhurst Glass. Revision 2, 9 June 2026.</p>
        <p className="mt-4 font-medium">Title block</p>
        <p>Amber glass jar, 180 ml, code GJ-180A</p>
        <p className="mt-3 font-medium">Dimensions</p>
        <p>Height 95 mm, diameter 72 mm, brim capacity 180 ml, tolerance ± 2 ml</p>
        <p className="mt-1 bg-teal-selected px-1">Decoration area: 68 mm wide × 54 mm high</p>
        <p className="mt-3 text-ink-tertiary">No food contact declaration appears on this drawing.</p>
      </>

  },
  'Declaration of conformity': {
    file: 'harrow-sc1200-doc.pdf',
    body:
    <>
        <p className="font-display text-sm font-semibold">DECLARATION OF CONFORMITY</p>
        <p className="mt-0.5 text-2xs text-ink-tertiary">Harrow Cable Co. Undated draft.</p>
        <p className="mt-4 font-medium">Product identification</p>
        <p>Silicone USB-C cable, 1.2 m, part SC-1200-BLK</p>
        <p className="mt-3 font-medium">Declaration</p>
        <p className="bg-teal-selected px-1">
          The object of the declaration is in conformity with Directive 2011/65/EU and Directive
          2014/30/EU.
        </p>
        <p className="mt-3 font-medium">Standards applied</p>
        <p>EN IEC 63000:2018</p>
        <p className="mt-3 text-ink-tertiary">
          No signature, name or date appears at the foot of this document.
        </p>
      </>

  },
  'Test report': {
    file: 'southgate-ptc10-report.pdf',
    body:
    <>
        <p className="font-display text-sm font-semibold">TEST REPORT</p>
        <p className="mt-0.5 text-2xs text-ink-tertiary">Southgate Test House. Report 24-PTC-118.</p>
        <p className="mt-4 font-medium">Scope</p>
        <p className="bg-teal-selected px-1">EN IEC 62368-1:2020, heating element, 10 W</p>
        <p className="mt-3 font-medium">Summary</p>
        <p>Tested 30 September 2024. Result: pass.</p>
        <p className="mt-3 text-ink-tertiary">
          The report does not state a validity period. Two years is assumed by convention and must be
          confirmed with the laboratory.
        </p>
      </>

  }
};

function ImportFlow({
  materialClass,
  onClose



}: {materialClass: MaterialClass;onClose: () => void;}) {
  const [documentKind, setDocumentKind] = useState<DocumentKind>(DOCUMENT_FOR_CLASS[materialClass]);
  const [fields, setFields] = useState<ParsedField[]>(FIELDS_BY_DOCUMENT[documentKind]);
  const [editing, setEditing] = useState<string | null>(null);

  const alternatives: DocumentKind[] =
  materialClass === 'ingredient' ?
  ['Safety data sheet', 'INCI and allergen certificate'] :
  materialClass === 'component' ?
  ['Declaration of conformity', 'Test report'] :
  ['Technical drawing'];

  const switchKind = (kind: DocumentKind) => {
    setDocumentKind(kind);
    setFields(FIELDS_BY_DOCUMENT[kind]);
    setEditing(null);
  };

  const missing = fields.filter((f) => f.status === 'missing');
  const confirmed = fields.filter((f) => f.status === 'confirmed').length;
  const confirmable = fields.length - missing.length;

  const update = (key: string, patch: Partial<ParsedField>) =>
  setFields((prev) => prev.map((field) => field.key === key ? { ...field, ...patch } : field));

  const source = SOURCE_PAGES[documentKind];

  return (
    <main className="flex-1 pb-24 xl:pb-0">
      <PageHeader
        eyebrow={`${documentKind} import`}
        title={fields[0]?.value || 'New material'}
        description="Check each extracted field against the source page before saving. Anything the parser could not find is marked and must be entered by hand."
        actions={
        <>
            <Button variant="quiet" onClick={onClose}>
              Cancel
            </Button>
            <Button
            variant="primary"
            disabled={confirmed < confirmable}
            /* Materials are a shipped catalogue: there is no table behind this screen and no
               row is written. It used to say "Material saved. X added to ingredients", which
               was a claim that a supplier's hazard data was on file — the data every
               classification on the next screen is calculated from. */
            onClick={() => {
              toast('Saving a material is not built yet', {
                description: `Nothing has been added to your ${materialClass === 'ingredient' ? 'ingredients' : materialClass === 'packaging' ? 'packaging' : 'components'}, and no classification will change.`
              });
              onClose();
            }}>
            
              Save material
            </Button>
          </>
        }
        meta={
        alternatives.length > 1 ?
        <div className="flex flex-wrap gap-2">
              <span className="text-2xs text-ink-tertiary">Document type</span>
              {alternatives.map((kind) =>
          <button
            key={kind}
            type="button"
            onClick={() => switchKind(kind)}
            aria-pressed={documentKind === kind}
            className={`rounded-full border px-3 py-1 text-2xs transition-colors ${
            documentKind === kind ?
            'border-teal bg-teal-tint text-teal-hover' :
            'border-paper-line text-ink-secondary hover:bg-paper-panel'}`
            }>
            
                  {kind}
                </button>
          )}
            </div> :
        null
        } />
      

      <div className="px-6 pt-8 lg:px-10">
        {/* Said at the top rather than at the end. Every field below is a worked example
            shipped in the bundle: no file has been uploaded, nothing has been parsed, and
            "Save material" writes nothing. Without this the screen reads as a parser that
            has just been over a document of yours and is asking you to confirm what it
            found — and the fields it marks "missing" read as gaps in your own records. */}
        <Callout tone="info" title="An example, not your document">
          <p className="max-w-prose leading-relaxed">
            Reading a supplier document is not built yet. This is what it will look like, using
            an example document — nothing of yours has been uploaded or read, and saving adds
            nothing to your materials.
          </p>
        </Callout>
      </div>

      <div className="grid gap-6 px-6 py-8 lg:px-10 xl:grid-cols-2">
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <SectionTitle>Extracted fields</SectionTitle>
            <span className="tabular text-2xs text-ink-tertiary">
              {confirmed} of {confirmable} confirmed
            </span>
          </div>

          {/* The teaching point, in the example framing the rest of this screen now uses.
              It read "Enter these by hand, or the record is saved without them and the gap is
              carried into every product that uses it" — four lines under a callout saying
              nothing is uploaded, nothing is parsed and saving adds nothing. No record is
              saved and no product uses it, and a maker who read this one and not that one
              would take a gap in a worked example for a gap in their own materials. */}
          {missing.length > 0 &&
          <Callout tone="warn" title="Not found in this document">
              {missing.map((field) => field.label).join(', ')}. A real import would leave these
              blank, and the gap would follow the material into every product that used it.
            </Callout>
          }

          <Card className="divide-y divide-paper-line">
            {fields.map((field) =>
            <div key={field.key} className="px-5 py-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <p className="text-[0.8125rem] font-medium text-ink-secondary">{field.label}</p>
                    {editing === field.key ?
                  <Input
                    autoFocus
                    className="mt-2"
                    defaultValue={field.value}
                    onBlur={(event) => {
                      update(field.key, { value: event.target.value, status: 'confirmed' });
                      setEditing(null);
                    }} /> :


                  <p
                    className={`tabular mt-1 text-sm ${
                    field.status === 'missing' ? 'text-clay-dark' : 'text-ink'}`
                    }>
                    
                        {field.value || 'Not found in this document'}
                      </p>
                  }
                    <p className="mt-1 text-2xs text-ink-tertiary">
                      {field.sourceSection}
                      {field.status === 'confirmed' ? ', confirmed against the source page' : ''}
                    </p>
                    {field.confidence === 'low' && field.status !== 'confirmed' &&
                  <p className="mt-1.5 max-w-prose text-2xs leading-relaxed text-clay-dark">
                        {field.uncertainty}
                      </p>
                  }
                  </div>
                  <div className="flex flex-none items-center gap-2">
                    {field.status === 'confirmed' ?
                  <Pill tone="good">
                        <CheckIcon className="h-3 w-3" strokeWidth={1.5} aria-hidden="true" />
                        Confirmed
                      </Pill> :

                  <>
                        <Button
                      size="sm"
                      variant="quiet"
                      onClick={() => setEditing(field.key)}
                      aria-label={`Correct ${field.label}`}>
                      
                          <PencilIcon className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />
                          Correct
                        </Button>
                        {field.status !== 'missing' &&
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => update(field.key, { status: 'confirmed' })}>
                      
                            Confirm
                          </Button>
                    }
                      </>
                  }
                  </div>
                </div>
              </div>
            )}
          </Card>
        </div>

        <div>
          <SectionTitle className="mb-4">Source document</SectionTitle>
          <Card className="overflow-hidden bg-paper-panel">
            <div className="flex items-center justify-between border-b border-paper-line px-4 py-2.5 text-2xs text-ink-tertiary">
              <span>{source.file}</span>
              <span className="tabular">Page 1</span>
            </div>
            <div className="bg-white p-6 text-[0.7rem] leading-relaxed text-ink">{source.body}</div>
          </Card>
        </div>
      </div>
    </main>);

}