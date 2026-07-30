import React, { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeftIcon,
  CheckIcon,
  FileTextIcon,
  PencilIcon,
  PlusIcon,
  RefreshCwIcon,
  UploadIcon } from
'lucide-react';
import { NewProductDialog } from '../components/NewProductDialog';
import { toast } from 'sonner';
import { PageHeader } from '../components/AppShell';
import {
  Button,
  Callout,
  Card,
  EmptyState,
  Input,
  Pill,
  SectionTitle } from
'../components/ui/Primitives';
import {
  COMPONENTS,
  INBOX,
  INGREDIENTS,
  MATERIALS,
  MATERIAL_CLASSES,
  PACKAGING,
  documentHistory,
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
import { CONFORMITY_DOCUMENTS } from '../lib/products';


const DOCUMENT_FOR_CLASS: Record<MaterialClass, DocumentKind> = {
  ingredient: 'Safety data sheet',
  packaging: 'Technical drawing',
  component: 'Declaration of conformity'
};

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
        eyebrow="Products · materials"
        title="Materials"
        description="Everything you buy, held with the supplier document it was read from. Nothing can be classified until a sheet has been read."
        actions={
        <Button variant="primary" onClick={() => setImporting(activeClass)}>
            <UploadIcon className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />
            Add from a document
          </Button>
        } />
      

      <DocumentInbox onOpen={(id) => navigate(`/materials/ingredient/${id}`)} />

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

          {items.length === 0 ?
          <EmptyState
            icon={<UploadIcon className="h-5 w-5" strokeWidth={1.25} aria-hidden="true" />}
            title={`No ${definition.label.toLowerCase()} yet`}
            body={definition.emptyBody}
            action={
            <Button variant="secondary" onClick={() => setImporting(activeClass)}>
                  Choose a document
                </Button>
            } /> :


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
          }

          {activeClass === 'component' && <ConformityStore />}
        </section>
      </div>
    </main>);

}

/**
 * Evidence for the components above, so it belongs beside them rather than in
 * settings. A declaration is material data, not configuration.
 */
function ConformityStore() {
  return (
    <div className="pt-4">
      <SectionTitle className="mb-1">Conformity document store</SectionTitle>
      <p className="mb-3 max-w-prose text-2xs leading-relaxed text-ink-tertiary">
        The evidence behind the components above. A declaration cannot be signed while any
        component it covers is unsupported.
      </p>
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead>
              <tr className="border-b border-paper-line bg-paper-panel/60 text-2xs uppercase tracking-[0.1em] text-ink-tertiary">
                <th scope="col" className="px-5 py-3 font-medium">Document</th>
                <th scope="col" className="px-5 py-3 font-medium">Reference</th>
                <th scope="col" className="px-5 py-3 font-medium">Issued</th>
                <th scope="col" className="px-5 py-3 font-medium">Expires</th>
                <th scope="col" className="px-5 py-3 font-medium">Held by</th>
              </tr>
            </thead>
            <tbody>
              {CONFORMITY_DOCUMENTS.map((document) =>
              <tr key={document.id} className="border-b border-paper-line last:border-0">
                  <td className="px-5 py-3.5 text-ink">{document.title}</td>
                  <td className="tabular px-5 py-3.5 text-ink-secondary">{document.reference}</td>
                  <td className="tabular px-5 py-3.5 text-ink-secondary">
                    {formatDate(document.issued)}
                  </td>
                  <td className="tabular px-5 py-3.5 text-ink-secondary">
                    {document.expires ? formatDate(document.expires) : '—'}
                  </td>
                  <td className="px-5 py-3.5">
                    {document.owner === 'Draft, unsigned' ?
                  <Pill tone="warn">Draft, unsigned</Pill> :

                  <span className="text-ink-secondary">{document.owner}</span>
                  }
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>);

}

/**
 * The front door. Documents dropped in but not yet reconciled against a
 * material, each stating what it appears to be and how sure the match is.
 */
function DocumentInbox({ onOpen }: {onOpen: (materialId: string) => void;}) {
  if (INBOX.length === 0) return null;

  return (
    <section
      aria-labelledby="inbox-heading"
      className="border-b border-paper-line bg-paper-panel/40 px-6 py-6 lg:px-10">
      
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-3">
        <SectionTitle>
          <span id="inbox-heading">Inbox</span>
        </SectionTitle>
        <p className="text-2xs text-ink-tertiary">
          <span className="tabular">{INBOX.length}</span> documents received, none read yet
        </p>
      </div>

      <ul className="grid gap-3 lg:grid-cols-3">
        {INBOX.map((document) => {
          const material = document.matchedMaterialId ?
          materialById(document.matchedMaterialId) :
          undefined;
          return (
            <li key={document.id}>
              <Card className="flex h-full flex-col px-5 py-4">
                <div className="flex items-start justify-between gap-3">
                  <FileTextIcon
                    className="mt-0.5 h-4 w-4 flex-none text-ink-tertiary"
                    strokeWidth={1.25}
                    aria-hidden="true" />
                  
                  <p className="min-w-0 flex-1 break-all text-[0.8125rem] font-medium text-ink">
                    {document.fileName}
                  </p>
                </div>
                <p className="mt-2 text-2xs text-ink-tertiary">
                  {document.appearsToBe} · {document.supplier} · received{' '}
                  {formatDate(document.receivedOn)}
                </p>
                <p className="mt-2 max-w-prose flex-1 text-[0.8125rem] leading-relaxed text-ink-secondary">
                  {document.note}
                </p>
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                  <Pill tone={document.matchConfidence === 'high' ? 'good' : 'warn'}>
                    {document.matchConfidence === 'high' && material ?
                    `Matches ${material.name}` :
                    document.matchConfidence === 'low' && material ?
                    `Possibly ${material.name}` :
                    'No match found'}
                  </Pill>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() =>
                    document.matchedMaterialId ?
                    onOpen(document.matchedMaterialId) :
                    toast('Nothing to match against', {
                      description:
                      'The supplier and product identifier could not be read. Choose the material by hand.'
                    })
                    }>
                    
                    Review
                  </Button>
                </div>
              </Card>
            </li>);

        })}
      </ul>
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
          <th scope="col" className="px-5 py-3 font-medium">Document</th>
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
              <div className="flex flex-wrap items-center gap-2">
                <span className="tabular text-ink-secondary">
                  v{item.document.version}, {formatDate(item.document.date)}
                </span>
                {item.document.latestVersion &&
              <Pill tone="warn">v{item.document.latestVersion} available</Pill>
              }
              </div>
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
          <th scope="col" className="px-5 py-3 font-medium">Certificate expiry</th>
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
  return (
    <main className="flex-1 pb-24 xl:pb-0">
      <PageHeader
        eyebrow={material.class === 'ingredient' ? material.role : material.class === 'packaging' ? 'Packaging' : 'Component'}
        title={material.name}
        description={`${material.supplier}, ${material.supplierCode}. Read from ${material.document.kind.toLowerCase()} version ${material.document.version} dated ${formatDate(material.document.date)}.`}
        actions={
        <>
            <Button variant="quiet" onClick={() => navigate(`/materials/${material.class}`)}>
              <ArrowLeftIcon className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />
              Register
            </Button>
            {material.class === 'ingredient' && material.role === 'Fragrance oil' &&
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
        {material.document.latestVersion &&
        <Callout tone="warn" title="A newer document exists">
            {material.supplier} published version {material.document.latestVersion} on{' '}
            {formatDate(material.document.latestDate)}. Version {material.document.version} is on
            file. Classifications, percentages and declarations may have changed.
            <div className="mt-3">
              <Button
              size="sm"
              variant="secondary"
              onClick={() =>
              toast('Import started', {
                description: `Confirm the extracted fields to replace version ${material.document.version}.`
              })
              }>
              
                <RefreshCwIcon className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />
                Import version {material.document.latestVersion}
              </Button>
            </div>
          </Callout>
        }

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

        <DocumentHistory material={material} />
      </div>
    </main>);

}

/**
 * Every sheet ever received, and what each revision moved. A revised sheet is
 * the most common cause of a wrong label, so this has to be answerable.
 */
function DocumentHistory({ material }: {material: Material;}) {
  const revisions = documentHistory(material.id);

  return (
    <Card className="px-5 py-5">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <SectionTitle>Document history</SectionTitle>
        <p className="text-2xs text-ink-tertiary">
          {material.document.kind} · {material.supplier}
        </p>
      </div>

      {revisions.length === 0 ?
      <p className="mt-3 max-w-prose text-[0.8125rem] leading-relaxed text-ink-secondary">
          Only version {material.document.version} is on file, received{' '}
          {formatDate(material.document.date)}. Earlier revisions were not recorded.
        </p> :

      <ol className="mt-4 space-y-4">
          {revisions.map((revision, index) => {
          const onFile = revision.version === material.document.version;
          const pending = index === 0 && !onFile;
          return (
            <li key={revision.version} className="flex gap-4">
                <div className="flex flex-none flex-col items-center">
                  <span
                  className={`mt-1 h-2 w-2 rounded-full ${
                  pending ? 'bg-clay' : onFile ? 'bg-teal' : 'bg-paper-line'}`
                  }
                  aria-hidden="true" />
                
                  {index < revisions.length - 1 &&
                <span className="mt-1 w-px flex-1 bg-paper-line" aria-hidden="true" />
                }
                </div>
                <div className="min-w-0 flex-1 pb-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="tabular text-sm font-medium text-ink">
                      Version {revision.version}
                    </span>
                    <span className="tabular text-2xs text-ink-tertiary">
                      issued {formatDate(revision.date)} · received {formatDate(revision.received)}
                    </span>
                    {onFile && <Pill tone="good">On file</Pill>}
                    {pending && <Pill tone="warn">Waiting in the inbox</Pill>}
                  </div>
                  <p className="mt-1 max-w-prose text-[0.8125rem] leading-relaxed text-ink-secondary">
                    {revision.summary}
                  </p>
                  {revision.moved.length > 0 &&
                <ul className="mt-1.5 space-y-1">
                      {revision.moved.map((line) =>
                  <li
                    key={line}
                    className="max-w-prose text-2xs leading-relaxed text-ink-tertiary">
                    
                          {line}
                        </li>
                  )}
                    </ul>
                }
                </div>
              </li>);

        })}
        </ol>
      }
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
          <Row term="Document" value={`${material.document.kind}, v${material.document.version}`} />
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
          <Row term="Document" value={`${material.document.kind} ${material.document.version}`} />
          <Row term="Issued" value={formatDate(material.document.date)} />
          <Row term="Valid to" value={formatDate(material.certificateExpiry)} />
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
            onClick={() => {
              toast('Material saved', {
                description: `${fields[0]?.value} added to ${materialClass === 'ingredient' ? 'ingredients' : materialClass === 'packaging' ? 'packaging' : 'components'}.`
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
      

      <div className="grid gap-6 px-6 py-8 lg:px-10 xl:grid-cols-2">
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <SectionTitle>Extracted fields</SectionTitle>
            <span className="tabular text-2xs text-ink-tertiary">
              {confirmed} of {confirmable} confirmed
            </span>
          </div>

          {missing.length > 0 &&
          <Callout tone="warn" title="Not found in this document">
              {missing.map((field) => field.label).join(', ')}. Enter these by hand, or the record
              is saved without them and the gap is carried into every product that uses it.
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