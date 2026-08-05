import React, { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeftIcon, PlusIcon, Trash2Icon } from 'lucide-react';
import { toast } from 'sonner';
import { PageHeader } from '../components/AppShell';
import { NoAccountNotice } from '../components/NoAccountNotice';
import {
  Button,
  Callout,
  Card,
  EmptyState,
  Field,
  Input,
  Pill,
  SectionTitle,
  Select,
  Skeleton } from
'../components/ui/Primitives';
import { MATERIAL_CLASSES, materialOrigin } from '../lib/material-index';
import {
  DOCUMENT_KINDS,
  addAllergen,
  addDocument,
  addHazard,
  addIfraLimit,
  archiveMaterial,
  createMaterial,
  overrideReferenceMaterial,
  removeChildRow } from
'../lib/materials';
import { useMaterials } from '../lib/materials-store';
import {
  DocumentKind,
  INGREDIENT_ROLES,
  IngredientMaterial,
  Material,
  MaterialClass,
  PackagingMaterial,
  formatDate } from
'../lib/model';

/**
 * THE MATERIALS REGISTER.
 *
 * WHAT THIS SCREEN USED TO BE. A browser of `src/lib/catalog.ts` — fourteen ingredients,
 * seven packs and five electronic components, all invented, all shipped in the bundle, all
 * rendered as classified materials with hazard statements, specific concentration limits,
 * allergen percentages and RoHS declarations. It had a document inbox that said "not built
 * yet", a conformity store that said "not built yet", and an import walkthrough whose Save
 * button toasted "Saving a material is not built yet". A maker could look at it and could
 * change nothing about it.
 *
 * WHAT IT IS NOW. The account's own materials, read from `batchlabel.materials` and written
 * back to it, plus whatever Batchlabel publishes in `batchlabel.reference_materials` — which
 * is nothing today, and the screen says so rather than filling the gap.
 *
 * THE OVERRIDE RULE IS ON THE SCREEN, not just in the database. Rhys's ruling asked for the
 * hybrid and for a written answer to two questions: which wins when both exist, and what
 * happens to a maker who has built products on a shared row when we later update it. The
 * answers are "yours, unconditionally" and "nothing, because a published reference version
 * cannot be updated — a correction is a new version". Both are stated in `OverrideRule` below,
 * in the place the maker is standing when the question occurs to them.
 *
 * WHAT IS STILL HONESTLY MISSING, and says so where it would otherwise be assumed:
 *   - No file can be uploaded. There is no storage bucket; `material_documents.storage_path`
 *     stays null, which the column defines as "no file is held". The document form records
 *     what a document IS and says in words that we are not holding it.
 *   - Reading a supplier document is not built. The old walkthrough of that unbuilt feature
 *     — with an invented safety data sheet on the right and eight fields to "confirm" — is
 *     deleted rather than relabelled. Adding a material is typing it in.
 */

/* ------------------------------------------------------------- the rule */

function OverrideRule({ compact = false }: {compact?: boolean;}) {
  return (
    <Callout tone="info" title="Your material always wins">
      <p className="max-w-prose leading-relaxed">
        Where you hold a material and Batchlabel also publishes one for the same thing, yours
        is the one used — always, with no exceptions and no merging of the two. The safety
        data sheet for the drum in your workshop is the document you would be asked for; ours
        is a reading of a document from a supplier we have never spoken to.
      </p>
      {!compact &&
      <p className="mt-2 max-w-prose leading-relaxed">
          And we cannot move a shared material under you. Once a version of one of ours is
          published it can never be changed or removed, by us or by anybody — a correction is a
          new version, and a product classified from the old one stays classified from the old
          one until you move it yourself.
        </p>
      }
    </Callout>);

}

/* ------------------------------------------------------------- the list */

export function Materials() {
  const { materialClass, materialId } = useParams();
  const navigate = useNavigate();
  const { status, materials, error, refresh } = useMaterials();
  const [adding, setAdding] = useState(false);

  const activeClass: MaterialClass = materialClass === 'packaging' ? 'packaging' : 'ingredient';

  if (materialId) {
    const material = materials.find((entry) => entry.id === materialId);
    // A material id that resolves to nothing means different things in each state, and the
    // detail screen is the wrong place to guess between them — so it is only rendered when
    // there is genuinely something to render, and everything else falls through to the list,
    // which already says which state it is in.
    if (material) return <MaterialDetail material={material} />;
    if (status === 'ready') return <MaterialNotFound materialClass={activeClass} />;
  }

  const items = materials.filter((material) => material.class === activeClass);
  const own = items.filter((material) => material.source === 'account');
  const definition = MATERIAL_CLASSES.find((entry) => entry.id === activeClass) ?? MATERIAL_CLASSES[0];

  const counts: Record<MaterialClass, number> = {
    ingredient: materials.filter((material) => material.class === 'ingredient').length,
    packaging: materials.filter((material) => material.class === 'packaging').length
  };

  return (
    <main className="flex-1 pb-24 xl:pb-0">
      <PageHeader
        eyebrow="Products · materials"
        title="Materials"
        description="Everything you buy, held with what its supplier document says about it. Your own materials are the ones a classification is calculated from; where Batchlabel publishes a material for the same thing, yours wins."
        actions={
        status === 'ready' ?
        <Button variant="primary" onClick={() => setAdding(true)}>
              <PlusIcon className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />
              Add a material
            </Button> :
        null
        } />


      {adding &&
      <NewMaterialDialog
        materialClass={activeClass}
        onClose={() => setAdding(false)}
        onCreated={(id) => {
          setAdding(false);
          navigate(`/materials/${activeClass}/${id}`);
        }} />

      }

      <div className="space-y-6 px-6 py-8 lg:px-10">
        <OverrideRule />

        {status === 'loading' &&
        <Card className="space-y-3 px-5 py-5">
            <Skeleton className="h-4 w-48" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-2/3" />
          </Card>
        }

        {/* A failed read and an empty register are different sentences, and this is the
            screen where confusing them costs the most: "you have no materials" to somebody
            holding forty of them reads as data loss. */}
        {status === 'error' &&
        <Callout tone="warn" title="We could not read your materials">
            <p className="max-w-prose leading-relaxed">{error}</p>
            <Button variant="secondary" size="sm" className="mt-3" onClick={refresh}>
              Try again
            </Button>
          </Callout>
        }

        {status === 'no-account' && <NoAccountNotice />}

        {status === 'unavailable' &&
        <Callout tone="warn" title="Your materials are not available">
            <p className="max-w-prose leading-relaxed">
              This account is suspended, so its materials are not being shown. Nothing has been
              deleted and nothing has changed — get in touch and we will sort it out.
            </p>
          </Callout>
        }

        {status === 'ready' &&
        <>
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
                {definition.blurb} {definition.documentRule}
              </p>

              {items.length === 0 ?
            <EmptyState
              title={`No ${definition.label.toLowerCase()} yet`}
              body={
              `You have not added any ${activeClass === 'ingredient' ? 'ingredients' : 'packaging'} yet, and Batchlabel does not publish any. ` +
              'That is not a gap in the read — the register is genuinely empty, and it is where every account starts. ' +
              'Add what you actually buy, with what its supplier document says, and the classification follows from it.'
              }
              action={
              <Button variant="primary" onClick={() => setAdding(true)}>
                      <PlusIcon className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />
                      Add a material
                    </Button>
              } /> :


            <Card className="overflow-hidden">
                  <div className="overflow-x-auto">
                    {activeClass === 'ingredient' ?
                <IngredientTable
                  items={items as IngredientMaterial[]}
                  onOpen={(id) => navigate(`/materials/ingredient/${id}`)} /> :


                <PackagingTable
                  items={items as PackagingMaterial[]}
                  onOpen={(id) => navigate(`/materials/packaging/${id}`)} />

                }
                  </div>
                </Card>
            }

              {/* Said once, at the foot of the list, rather than implied by an empty table.
                  The catalogue is empty on purpose: the one that used to ship was invented,
                  and a reference row now has to declare where its figures came from. */}
              <p className="max-w-prose text-2xs leading-relaxed text-ink-tertiary">
                {own.length} of these {own.length === 1 ? 'is' : 'are'} yours.{' '}
                {items.length - own.length === 0 ?
              'Batchlabel publishes no reference materials yet — we would rather ship none than ship figures we made up.' :
              `${items.length - own.length} come from Batchlabel's reference catalogue, and you can hold your own version of any of them.`}
              </p>
            </section>
          </>
        }
      </div>
    </main>);

}

function MaterialNotFound({ materialClass }: {materialClass: MaterialClass;}) {
  return (
    <main className="flex-1 pb-24 xl:pb-0">
      <PageHeader eyebrow="Materials" title="No such material" description="" />
      <div className="px-6 py-8 lg:px-10">
        <EmptyState
          title="That material is not in your register"
          body="It may have been archived, or the link may be out of date. Archiving keeps every product that used a material working — the material simply stops appearing in pickers and here."
          action={
          <Link to={`/materials/${materialClass}`}>
              <Button variant="secondary">Back to materials</Button>
            </Link>
          } />

      </div>
    </main>);

}

/* ------------------------------------------------------------- tables */

const headRow =
'border-b border-paper-line bg-paper-panel/60 text-2xs uppercase tracking-[0.1em] text-ink-tertiary';
const cell = 'px-5 py-3.5 text-ink-secondary';
const rowClass = 'cursor-pointer border-b border-paper-line last:border-0 hover:bg-teal-tint';

/**
 * Whose row this is, on every line of every table.
 *
 * Not decoration. A hazard classification read off the maker's own supplier document and one
 * published by us are different kinds of fact, and the second one may be an illustrative
 * example — which the provenance column in the database exists to force us to admit.
 */
function SourcePill({ material }: {material: Material;}) {
  if (material.source === 'account') {
    return (
      <Pill tone="good">{material.overridesReferenceId ? 'Yours, replacing ours' : 'Yours'}</Pill>);

  }
  if (material.provenance === 'illustrative-example') {
    return <Pill tone="warn">Batchlabel example</Pill>;
  }
  return <Pill tone="quiet">Batchlabel</Pill>;
}

/**
 * What a material's figures were read from, or the admission that nothing was recorded.
 *
 * "Not recorded" is deliberately not "—". An em dash reads as a field the screen could not
 * fill; this is a field the maker has not filled, and it is the field that says whether a
 * classification can be traced back to anything.
 */
function documentCell(material: Material): string {
  if (!material.document) return 'No document recorded';
  const { kind, version, date } = material.document;
  return [kind, version ? `v${version}` : '', date ? formatDate(date) : ''].
  filter(Boolean).
  join(', ');
}

function IngredientTable({
  items,
  onOpen



}: {items: IngredientMaterial[];onOpen: (id: string) => void;}) {
  return (
    <table className="w-full min-w-[900px] text-left text-sm">
      <thead>
        <tr className={headRow}>
          <th scope="col" className="px-5 py-3 font-medium">Name</th>
          <th scope="col" className="px-5 py-3 font-medium">Source</th>
          <th scope="col" className="px-5 py-3 font-medium">Supplier</th>
          <th scope="col" className="px-5 py-3 font-medium">Read from</th>
          <th scope="col" className="px-5 py-3 font-medium">Hazards at 100 percent</th>
          <th scope="col" className="px-5 py-3 font-medium">Allergens</th>
        </tr>
      </thead>
      <tbody>
        {items.map((item) =>
        <tr key={item.id} className={rowClass} onClick={() => onOpen(item.id)}>
            <td className="px-5 py-3.5">
              <span className="font-medium text-ink">{item.name}</span>
              {item.supplierCode &&
            <span className="tabular ml-2 text-2xs text-ink-tertiary">{item.supplierCode}</span>
            }
              <span className="block text-2xs text-ink-tertiary">{item.role}</span>
            </td>
            <td className="px-5 py-3.5"><SourcePill material={item} /></td>
            <td className={cell}>{item.supplier ?? 'Not recorded'}</td>
            <td className={cell}>{documentCell(item)}</td>
            {/* "Not classified" would be a finding. An ingredient with no hazard rows is one
                nobody has entered hazards for, which is a different thing from one a supplier
                has classified as non-hazardous — and only the maker knows which. */}
            <td className={cell}>
              {item.hazards.length ?
            item.hazards.map((hazard) => hazard.code).join(', ') :
            'None entered'}
            </td>
            <td className={cell}>
              {item.allergens.length ? `${item.allergens.length} declared` : 'None entered'}
            </td>
          </tr>
        )}
      </tbody>
    </table>);

}

function PackagingTable({
  items,
  onOpen



}: {items: PackagingMaterial[];onOpen: (id: string) => void;}) {
  return (
    <table className="w-full min-w-[900px] text-left text-sm">
      <thead>
        <tr className={headRow}>
          <th scope="col" className="px-5 py-3 font-medium">Name</th>
          <th scope="col" className="px-5 py-3 font-medium">Source</th>
          <th scope="col" className="px-5 py-3 font-medium">Supplier</th>
          <th scope="col" className="px-5 py-3 font-medium">Format</th>
          <th scope="col" className="px-5 py-3 font-medium">Capacity</th>
          <th scope="col" className="px-5 py-3 font-medium">Label area</th>
        </tr>
      </thead>
      <tbody>
        {items.map((item) =>
        <tr key={item.id} className={rowClass} onClick={() => onOpen(item.id)}>
            <td className="px-5 py-3.5">
              <span className="font-medium text-ink">{item.name}</span>
              {item.supplierCode &&
            <span className="tabular ml-2 text-2xs text-ink-tertiary">{item.supplierCode}</span>
            }
            </td>
            <td className="px-5 py-3.5"><SourcePill material={item} /></td>
            <td className={cell}>{item.supplier ?? 'Not recorded'}</td>
            <td className={cell}>{item.format ?? 'Not recorded'}</td>
            {/* Capacity decides the minimum label size under CLP Annex I Table 1.3, so an
                unrecorded one may not render as a number. */}
            <td className={`tabular ${cell}`}>
              {item.capacityMl != null ? `${item.capacityMl} ml` : 'Not recorded'}
            </td>
            <td className={`tabular ${cell}`}>
              {item.labelAreaMm ?
            `${item.labelAreaMm.width} × ${item.labelAreaMm.height} mm` :
            'Not recorded'}
            </td>
          </tr>
        )}
      </tbody>
    </table>);

}

/* ------------------------------------------------------------- detail */

function MaterialDetail({ material }: {material: Material;}) {
  const navigate = useNavigate();
  const { accountId, reload } = useMaterials();
  const [busy, setBusy] = useState(false);

  const own = material.source === 'account';

  const takeOver = async () => {
    setBusy(true);
    const result = await overrideReferenceMaterial(material, accountId);
    setBusy(false);
    if (!result.ok) {
      toast('Nothing was saved', { description: result.message });
      return;
    }
    await reload();
    toast('Your own version has been created', {
      description:
      'It is empty of classification on purpose — enter what your supplier’s document says. ' +
      'It is already the one used everywhere ours was.'
    });
    navigate(`/materials/${material.class}/${result.value}`);
  };

  const archive = async () => {
    if (!own) return;
    setBusy(true);
    const result = await archiveMaterial(material.id);
    setBusy(false);
    if (!result.ok) {
      toast('Nothing was archived', { description: result.message });
      return;
    }
    await reload();
    toast('Archived', {
      description:
      'It has stopped appearing in pickers. Products already built on it keep working and keep ' +
      'naming it.'
    });
    navigate(`/materials/${material.class}`);
  };

  return (
    <main className="flex-1 pb-24 xl:pb-0">
      <PageHeader
        eyebrow={`Materials · ${material.class === 'ingredient' ? material.role : 'Packaging'}`}
        title={material.name}
        description={[
        material.supplier ?? 'No supplier recorded',
        material.supplierCode,
        materialOrigin(material)].
        filter(Boolean).
        join(' · ')}
        actions={
        <>
            <Button variant="quiet" onClick={() => navigate(`/materials/${material.class}`)}>
              <ArrowLeftIcon className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />
              Register
            </Button>
            {!own &&
          <Button variant="primary" disabled={busy} onClick={takeOver}>
                Hold my own version
              </Button>
          }
            {own &&
          <Button variant="secondary" disabled={busy} onClick={archive}>
                Archive
              </Button>
          }
          </>
        } />


      <div className="space-y-6 px-6 py-8 lg:px-10">
        {!own &&
        <>
            <OverrideRule compact />
            {material.provenance === 'illustrative-example' &&
          <Callout tone="warn" title="These figures are an example, not a classification">
                <p className="max-w-prose leading-relaxed">
                  This material is published as an illustrative example: it shows the shape of
                  the data rather than what any real supplier says. Do not classify a product
                  from it. Hold your own version and enter what your document says.
                </p>
              </Callout>
          }
          </>
        }

        {material.class === 'ingredient' ?
        <IngredientDetail material={material} editable={own} /> :
        <PackagingDetail material={material} />
        }

        <DocumentSection material={material} editable={own} />
      </div>
    </main>);

}

/* ------------------------------------------- ingredient detail and edits */

function IngredientDetail({
  material,
  editable



}: {material: IngredientMaterial;editable: boolean;}) {
  const { accountId, reload } = useMaterials();

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Card className="px-5 py-5">
        <SectionTitle className="mb-3">Hazard classification at 100 percent</SectionTitle>
        {material.hazards.length === 0 ?
        <p className="max-w-prose text-sm leading-relaxed text-ink-secondary">
            {/* NOT "not classified as hazardous". Nobody has said that. */}
            No hazard statements have been entered for this material, so it contributes nothing
            to any classification. If the supplier&rsquo;s safety data sheet section 2 lists
            none, that is worth entering as a note below rather than left as a blank.
          </p> :

        <ul className="space-y-3">
            {material.hazards.map((hazard) =>
          <li
            key={hazard.code}
            className="flex items-start justify-between gap-3 border-b border-paper-line pb-3 last:border-0 last:pb-0">

                <div className="min-w-0">
                  <p className="text-sm text-ink">
                    <span className="tabular font-medium">{hazard.code}</span> {hazard.statement}
                  </p>
                  <p className="tabular mt-1 text-2xs text-ink-tertiary">
                    {hazard.hazardClass}
                    {/* A missing limit is stated, not defaulted. See HazardAt100.gcl. */}
                    {hazard.gcl != null ?
                ` · generic limit ${hazard.gcl} percent` :
                ' · no generic limit recorded, so this hazard cannot be placed'}
                    {hazard.scl != null ? ` · supplier specific limit ${hazard.scl} percent` : ''}
                  </p>
                </div>
                {/* Offered only when there is a row to delete. A reference material's
                    figures live in an immutable version and cannot be removed by anybody,
                    including us — so no control for it is drawn. */}
                {editable && hazard.rowId &&
            <RemoveButton
              label={`Remove ${hazard.code}`}
              rowId={hazard.rowId}
              table="material_hazards"
              onDone={reload} />

            }
              </li>
          )}
          </ul>
        }
        {editable && <AddHazardForm materialId={material.id} accountId={accountId} onSaved={reload} />}
      </Card>

      <Card className="px-5 py-5">
        <SectionTitle className="mb-3">Declared allergens</SectionTitle>
        {material.allergens.length === 0 ?
        <p className="text-sm text-ink-secondary">None entered.</p> :

        <table className="w-full text-left text-sm">
            <tbody>
              {material.allergens.map((allergen) =>
            <tr key={allergen.name} className="border-b border-paper-line last:border-0">
                  <td className="py-2 text-ink">{allergen.name}</td>
                  <td className="tabular py-2 text-right text-ink-secondary">{allergen.pct} %</td>
                  <td className="w-10 py-2 text-right">
                    {editable && allergen.rowId &&
                <RemoveButton
                  label={`Remove ${allergen.name}`}
                  rowId={allergen.rowId}
                  table="material_allergens"
                  onDone={reload} />

                }
                  </td>
                </tr>
            )}
            </tbody>
          </table>
        }
        {editable &&
        <AddAllergenForm materialId={material.id} accountId={accountId} onSaved={reload} />
        }
      </Card>

      <Card className="px-5 py-5">
        <SectionTitle className="mb-3">Chemical identity</SectionTitle>
        <dl className="space-y-2 text-sm">
          <Row term="CAS" value={material.cas ?? 'Not recorded'} />
        </dl>
      </Card>

      <Card className="px-5 py-5">
        <SectionTitle className="mb-3">IFRA limits</SectionTitle>
        {material.ifra.length === 0 ?
        <p className="max-w-prose text-sm leading-relaxed text-ink-secondary">
            No IFRA category limits entered. Nothing checks the fragrance load against a maximum
            until one is.
          </p> :

        <table className="w-full text-left text-sm">
            <tbody>
              {material.ifra.map((limit) =>
            <tr key={limit.category} className="border-b border-paper-line last:border-0">
                  <td className="py-2">
                    <span className="text-ink">{limit.category}</span>
                    {limit.description &&
                <span className="block text-2xs text-ink-tertiary">{limit.description}</span>
                }
                  </td>
                  <td className="tabular py-2 text-right text-ink-secondary">{limit.max} %</td>
                  <td className="w-10 py-2 text-right">
                    {editable && limit.rowId &&
                <RemoveButton
                  label={`Remove ${limit.category}`}
                  rowId={limit.rowId}
                  table="material_ifra_limits"
                  onDone={reload} />

                }
                  </td>
                </tr>
            )}
            </tbody>
          </table>
        }
        {editable && <AddIfraForm materialId={material.id} accountId={accountId} onSaved={reload} />}
      </Card>

      {material.notes &&
      <Card className="px-5 py-5 lg:col-span-2">
          <SectionTitle className="mb-2">Notes</SectionTitle>
          <p className="max-w-prose text-sm leading-relaxed text-ink-secondary">{material.notes}</p>
        </Card>
      }
    </div>);

}

function PackagingDetail({ material }: {material: PackagingMaterial;}) {
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Card className="px-5 py-5">
        <SectionTitle className="mb-3">Dimensions</SectionTitle>
        <dl className="space-y-2 text-sm">
          <Row term="Format" value={material.format ?? 'Not recorded'} />
          <Row
            term="Capacity"
            value={material.capacityMl != null ? `${material.capacityMl} ml` : 'Not recorded'} />

          <Row
            term="Printable area"
            value={
            material.labelAreaMm ?
            `${material.labelAreaMm.width} × ${material.labelAreaMm.height} mm` :
            'Not recorded'
            } />

        </dl>
        <p className="mt-4 max-w-prose text-2xs leading-relaxed text-ink-tertiary">
          Capacity sets the minimum label and pictogram size under CLP Annex I, Table 1.3.
          Without it that minimum cannot be worked out, and the designer says so rather than
          assuming a size. Printable area is checked against the artefact in the designer.
        </p>
      </Card>
      <Card className="px-5 py-5">
        <SectionTitle className="mb-3">Declarations</SectionTitle>
        <dl className="space-y-2 text-sm">
          {/* Three states, not two. "Not declared" is the supplier having said nothing, which
              is not the same as their having said no. */}
          <Row
            term="Food contact"
            value={
            material.foodContact == null ?
            'Not recorded' :
            material.foodContact ?
            'Declared suitable' :
            'Declared not suitable'
            } />

          <Row
            term="Child resistant"
            value={
            material.childResistant == null ?
            'Not recorded' :
            material.childResistant ?
            'Yes' :
            'No'
            } />

        </dl>
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

/**
 * Removes one child row, and says so if it did not.
 *
 * A DELETE excluded by an RLS `using` clause matches nothing and reports success — the same
 * trap saveComposition documents — so `removeChildRow` asks for the row back and this button
 * surfaces the refusal rather than quietly leaving the line on screen with no explanation.
 */
function RemoveButton({
  label,
  rowId,
  table,
  onDone




}: {label: string;rowId: string;table: 'material_hazards' | 'material_allergens' | 'material_ifra_limits';onDone: () => Promise<void>;}) {
  const [busy, setBusy] = useState(false);
  return (
    <Button
      size="sm"
      variant="quiet"
      aria-label={label}
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        const result = await removeChildRow(table, rowId);
        if (!result.ok) {
          setBusy(false);
          toast('Nothing was removed', { description: result.message });
          return;
        }
        await onDone();
        setBusy(false);
      }}>

      <Trash2Icon className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />
    </Button>);

}

/* ------------------------------------------------------- the documents */

/**
 * The supplier document, and the sentence that keeps it honest.
 *
 * `material_documents.storage_path` is null for every row this app writes, because there is
 * no storage bucket — creating one is an operator step and the migration declined to guess at
 * its SQL. So this section records what a document IS and says, in the same breath, that we
 * are not holding it. The distinction is not pedantry: sections 3 and 16 of a safety data
 * sheet turn on whether a supplier document is held, and this screen is where the claim
 * would start.
 */
function DocumentSection({
  material,
  editable



}: {material: Material;editable: boolean;}) {
  const { accountId, reload } = useMaterials();

  return (
    <Card className="px-5 py-5">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <SectionTitle>Source document</SectionTitle>
        {material.documentFileHeld ?
        <Pill tone="good">File held</Pill> :
        <Pill tone="quiet">No file held</Pill>
        }
      </div>

      {material.document ?
      <p className="mt-3 max-w-prose text-[0.8125rem] leading-relaxed text-ink-secondary">
          {material.source === 'account' ? 'You recorded' : 'Batchlabel read'} this material from{' '}
          {material.supplier ? `${material.supplier}’s ` : ''}
          {material.document.kind.toLowerCase()}
          {material.document.version ? ` version ${material.document.version}` : ''}
          {material.document.date ? `, dated ${formatDate(material.document.date)}` : ''}.{' '}
          {material.source === 'account' ?
        'Batchlabel holds no copy of the file itself — there is nowhere to upload one yet, so what is stored is the reference you typed.' :
        'Batchlabel holds no copy of it for you and does not check whether a newer version has been published.'}
        </p> :

      <p className="mt-3 max-w-prose text-[0.8125rem] leading-relaxed text-ink-secondary">
          No document has been recorded for this material. Anything derived from it will cite
          nothing, which is the honest outcome — a classification with no traceable source is
          better than an invented citation.
        </p>
      }

      {editable && <AddDocumentForm materialId={material.id} accountId={accountId} onSaved={reload} />}
    </Card>);

}

/* ------------------------------------------------------------- forms */

/**
 * Every form below writes ONE ROW and reports exactly what happened.
 *
 * No form here collects a material and its children together. Two inserts cannot be made
 * atomic across PostgREST, and a half-saved material carrying two of its five hazard
 * statements is indistinguishable on screen from a complete one — which is the whole failure
 * mode this application keeps finding. So the material is created first, and each hazard,
 * allergen, limit and document is its own save, each of which either lands or says why not.
 */
function useOneRowForm(onSaved: () => Promise<void> | void) {
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const submit = async (
  run: () => Promise<{ok: true;} | {ok: false;message: string;}>,
  done: () => void) =>
  {
    setBusy(true);
    setFailure(null);
    const result = await run();
    setBusy(false);
    if (!result.ok) {
      setFailure(result.message);
      return;
    }
    await onSaved();
    done();
  };

  return { busy, failure, submit };
}

function FormFailure({ message }: {message: string | null;}) {
  if (!message) return null;
  return (
    <p className="mt-2 max-w-prose text-2xs leading-relaxed text-clay-dark" role="alert">
      {message}
    </p>);

}

function AddHazardForm({
  materialId,
  accountId,
  onSaved



}: {materialId: string;accountId: string | null;onSaved: () => Promise<void>;}) {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState('');
  const [statement, setStatement] = useState('');
  const [hazardClass, setHazardClass] = useState('');
  const [gcl, setGcl] = useState('');
  const [scl, setScl] = useState('');
  const [signal, setSignal] = useState('');
  const [pictogram, setPictogram] = useState('');
  const { busy, failure, submit } = useOneRowForm(onSaved);

  if (!open) {
    return (
      <Button variant="secondary" size="sm" className="mt-4" onClick={() => setOpen(true)}>
        <PlusIcon className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />
        Add a hazard statement
      </Button>);

  }

  const ready = code.trim() !== '' && statement.trim() !== '' && hazardClass.trim() !== '';

  return (
    <form
      className="mt-4 space-y-3 rounded-control border border-paper-line p-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (!ready) return;
        void submit(
          () =>
          addHazard(
            materialId,
            {
              code,
              statement,
              hazardClass,
              gcl: gcl.trim() === '' ? undefined : Number(gcl),
              scl: scl.trim() === '' ? undefined : Number(scl),
              signal: signal === 'Warning' || signal === 'Danger' ? signal : undefined,
              pictogram:
              pictogram === 'GHS02' || pictogram === 'GHS07' || pictogram === 'GHS09' ?
              pictogram :
              undefined
            },
            accountId
          ),
          () => {
            setOpen(false);
            setCode('');
            setStatement('');
            setHazardClass('');
            setGcl('');
            setScl('');
            setSignal('');
            setPictogram('');
          }
        );
      }}>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Hazard code">
          <Input value={code} placeholder="H317" onChange={(event) => setCode(event.target.value)} />
        </Field>
        <Field label="Hazard class">
          <Input
            value={hazardClass}
            placeholder="Skin Sens. 1"
            onChange={(event) => setHazardClass(event.target.value)} />

        </Field>
      </div>
      <Field label="Statement">
        <Input
          value={statement}
          placeholder="May cause an allergic skin reaction."
          onChange={(event) => setStatement(event.target.value)} />

      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field
          label="Generic concentration limit"
          hint="Percent in the finished mixture. Leave blank if the sheet gives none.">

          <Input
            type="number"
            step="0.0001"
            className="tabular"
            value={gcl}
            onChange={(event) => setGcl(event.target.value)} />

        </Field>
        <Field label="Specific concentration limit" hint="Percent, where the supplier gives one">
          <Input
            type="number"
            step="0.0001"
            className="tabular"
            value={scl}
            onChange={(event) => setScl(event.target.value)} />

        </Field>
        <Field label="Signal word">
          <Select value={signal} onChange={(event) => setSignal(event.target.value)}>
            <option value="">None</option>
            <option value="Warning">Warning</option>
            <option value="Danger">Danger</option>
          </Select>
        </Field>
        <Field label="Pictogram">
          <Select value={pictogram} onChange={(event) => setPictogram(event.target.value)}>
            <option value="">None</option>
            <option value="GHS02">GHS02, flame</option>
            <option value="GHS07">GHS07, exclamation mark</option>
            <option value="GHS09">GHS09, environment</option>
          </Select>
        </Field>
      </div>
      <p className="max-w-prose text-2xs leading-relaxed text-ink-tertiary">
        Without a concentration limit this hazard is shown in the working and left off the
        label, because whether it transfers to a mixture cannot be worked out from nothing.
      </p>
      <FormFailure message={failure} />
      <div className="flex gap-2">
        <Button type="submit" variant="primary" size="sm" disabled={!ready || busy}>
          {busy ? 'Saving…' : 'Save hazard'}
        </Button>
        <Button type="button" variant="quiet" size="sm" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>);

}

function AddAllergenForm({
  materialId,
  accountId,
  onSaved



}: {materialId: string;accountId: string | null;onSaved: () => Promise<void>;}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [pct, setPct] = useState('');
  const { busy, failure, submit } = useOneRowForm(onSaved);

  if (!open) {
    return (
      <Button variant="secondary" size="sm" className="mt-4" onClick={() => setOpen(true)}>
        <PlusIcon className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />
        Add an allergen
      </Button>);

  }

  const value = Number(pct);
  const ready = name.trim() !== '' && pct.trim() !== '' && value > 0 && value <= 100;

  return (
    <form
      className="mt-4 space-y-3 rounded-control border border-paper-line p-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (!ready) return;
        void submit(
          () => addAllergen(materialId, { name, pct: value }, accountId),
          () => {
            setOpen(false);
            setName('');
            setPct('');
          }
        );
      }}>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Allergen">
          <Input
            value={name}
            placeholder="linalool"
            onChange={(event) => setName(event.target.value)} />

        </Field>
        <Field label="Percent in this material" hint="At 100 percent, not in the finished product">
          <Input
            type="number"
            step="0.0001"
            className="tabular"
            value={pct}
            onChange={(event) => setPct(event.target.value)} />

        </Field>
      </div>
      <FormFailure message={failure} />
      <div className="flex gap-2">
        <Button type="submit" variant="primary" size="sm" disabled={!ready || busy}>
          {busy ? 'Saving…' : 'Save allergen'}
        </Button>
        <Button type="button" variant="quiet" size="sm" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>);

}

function AddIfraForm({
  materialId,
  accountId,
  onSaved



}: {materialId: string;accountId: string | null;onSaved: () => Promise<void>;}) {
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState('');
  const [description, setDescription] = useState('');
  const [max, setMax] = useState('');
  const { busy, failure, submit } = useOneRowForm(onSaved);

  if (!open) {
    return (
      <Button variant="secondary" size="sm" className="mt-4" onClick={() => setOpen(true)}>
        <PlusIcon className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />
        Add an IFRA limit
      </Button>);

  }

  const value = Number(max);
  const ready = category.trim() !== '' && max.trim() !== '' && value > 0 && value <= 100;

  return (
    <form
      className="mt-4 space-y-3 rounded-control border border-paper-line p-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (!ready) return;
        void submit(
          () => addIfraLimit(materialId, { category, description, max: value }, accountId),
          () => {
            setOpen(false);
            setCategory('');
            setDescription('');
            setMax('');
          }
        );
      }}>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="IFRA category">
          <Input
            value={category}
            placeholder="Category 12"
            onChange={(event) => setCategory(event.target.value)} />

        </Field>
        <Field label="Maximum percent">
          <Input
            type="number"
            step="0.0001"
            className="tabular"
            value={max}
            onChange={(event) => setMax(event.target.value)} />

        </Field>
      </div>
      <Field label="What the category covers" hint="Optional">
        <Input
          value={description}
          placeholder="Non-skin contact, candles and diffusers"
          onChange={(event) => setDescription(event.target.value)} />

      </Field>
      <FormFailure message={failure} />
      <div className="flex gap-2">
        <Button type="submit" variant="primary" size="sm" disabled={!ready || busy}>
          {busy ? 'Saving…' : 'Save limit'}
        </Button>
        <Button type="button" variant="quiet" size="sm" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>);

}

function AddDocumentForm({
  materialId,
  accountId,
  onSaved



}: {materialId: string;accountId: string | null;onSaved: () => Promise<void>;}) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<DocumentKind>('Safety data sheet');
  const [reference, setReference] = useState('');
  const [version, setVersion] = useState('');
  const [date, setDate] = useState('');
  const { busy, failure, submit } = useOneRowForm(onSaved);

  if (!open) {
    return (
      <Button variant="secondary" size="sm" className="mt-4" onClick={() => setOpen(true)}>
        <PlusIcon className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />
        Record a document
      </Button>);

  }

  return (
    <form
      className="mt-4 space-y-3 rounded-control border border-paper-line p-4"
      onSubmit={(event) => {
        event.preventDefault();
        void submit(
          () =>
          addDocument(
            materialId,
            { documentKind: kind, reference, version, documentDate: date },
            accountId
          ),
          () => {
            setOpen(false);
            setReference('');
            setVersion('');
            setDate('');
          }
        );
      }}>

      <Callout tone="info" title="No file is uploaded">
        <p className="max-w-prose leading-relaxed">
          There is nowhere to store the file itself yet, so this records what the document is
          and where it came from — not the document. Keep the PDF where you keep it now.
        </p>
      </Callout>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Kind">
          <Select value={kind} onChange={(event) => setKind(event.target.value as DocumentKind)}>
            {DOCUMENT_KINDS.map((entry) =>
            <option key={entry} value={entry}>
                {entry}
              </option>
            )}
          </Select>
        </Field>
        <Field label="Version">
          <Input
            value={version}
            placeholder="4.2"
            onChange={(event) => setVersion(event.target.value)} />

        </Field>
        <Field label="Reference">
          <Input
            value={reference}
            placeholder="Supplier's document number"
            onChange={(event) => setReference(event.target.value)} />

        </Field>
        <Field label="Document date">
          <Input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
        </Field>
      </div>
      <FormFailure message={failure} />
      <div className="flex gap-2">
        <Button type="submit" variant="primary" size="sm" disabled={busy}>
          {busy ? 'Saving…' : 'Save document'}
        </Button>
        <Button type="button" variant="quiet" size="sm" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>);

}

/* ------------------------------------------------------- new material */

/**
 * Adds one material. The only control on this screen that creates something.
 *
 * IT ASKS FOR IDENTITY AND NOTHING ELSE. No hazards, no allergens, no limits — those are
 * added on the material afterwards, one row at a time, for the reason given at the top of the
 * forms section. The consequence is worth saying on the screen, and is: a material saved here
 * carries no classification yet, and nothing derived from it will claim one.
 */
function NewMaterialDialog({
  materialClass,
  onClose,
  onCreated




}: {materialClass: MaterialClass;onClose: () => void;onCreated: (id: string) => void;}) {
  const { accountId, reload } = useMaterials();
  const [name, setName] = useState('');
  const [role, setRole] = useState<string>(materialClass === 'ingredient' ? 'Fragrance oil' : '');
  const [supplier, setSupplier] = useState('');
  const [supplierCode, setSupplierCode] = useState('');
  const [cas, setCas] = useState('');
  const [format, setFormat] = useState('');
  const [capacity, setCapacity] = useState('');
  const [areaWidth, setAreaWidth] = useState('');
  const [areaHeight, setAreaHeight] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const ready = name.trim() !== '';

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!ready) return;
    setBusy(true);
    setFailure(null);
    const result = await createMaterial(
      {
        materialClass,
        name,
        role: materialClass === 'ingredient' ? role : undefined,
        supplier,
        supplierCode,
        categories: ['home-fragrance'],
        cas,
        format,
        capacityMl: capacity.trim() === '' ? undefined : Number(capacity),
        labelAreaWidthMm: areaWidth.trim() === '' ? undefined : Number(areaWidth),
        labelAreaHeightMm: areaHeight.trim() === '' ? undefined : Number(areaHeight)
      },
      accountId
    );
    setBusy(false);
    if (!result.ok) {
      setFailure(result.message);
      return;
    }
    await reload();
    onCreated(result.value);
  };

  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-ink/20 p-4 sm:p-8">
      <Card className="w-full max-w-2xl px-6 py-6">
        <SectionTitle className="mb-1">
          Add {materialClass === 'ingredient' ? 'an ingredient' : 'a pack'}
        </SectionTitle>
        <p className="mb-4 max-w-prose text-2xs leading-relaxed text-ink-tertiary">
          This records what the material is. Its classification — hazard statements, allergens,
          IFRA limits — is entered on the material once it exists, so nothing here claims a
          classification it does not have.
        </p>
        <form className="space-y-4" onSubmit={save}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Name">
              <Input
                autoFocus
                value={name}
                placeholder={
                materialClass === 'ingredient' ?
                'Coconut and rapeseed wax' :
                'Amber glass tumbler, 250 ml'
                }
                onChange={(event) => setName(event.target.value)} />

            </Field>
            {materialClass === 'ingredient' ?
            <Field label="Role" hint="What it does in a composition">
                <Select value={role} onChange={(event) => setRole(event.target.value)}>
                  {INGREDIENT_ROLES.map((entry) =>
                <option key={entry} value={entry}>
                      {entry}
                    </option>
                )}
                </Select>
              </Field> :

            <Field label="Format" hint="Optional">
                <Input
                value={format}
                placeholder="Tumbler with tin lid"
                onChange={(event) => setFormat(event.target.value)} />

              </Field>
            }
            <Field label="Supplier" hint="Optional">
              <Input value={supplier} onChange={(event) => setSupplier(event.target.value)} />
            </Field>
            <Field label="Supplier code" hint="Optional">
              <Input
                value={supplierCode}
                onChange={(event) => setSupplierCode(event.target.value)} />

            </Field>
          </div>

          {materialClass === 'ingredient' &&
          <div className="grid gap-3 sm:grid-cols-2">
              <Field label="CAS number" hint="Optional">
                <Input value={cas} onChange={(event) => setCas(event.target.value)} />
              </Field>
            </div>
          }

          {materialClass === 'packaging' &&
          <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Capacity" hint="Millilitres. Sets the CLP minimum label size.">
                <Input
                type="number"
                step="0.01"
                className="tabular"
                value={capacity}
                onChange={(event) => setCapacity(event.target.value)} />

              </Field>
              <Field label="Label area width" hint="Millimetres">
                <Input
                type="number"
                step="0.01"
                className="tabular"
                value={areaWidth}
                onChange={(event) => setAreaWidth(event.target.value)} />

              </Field>
              <Field label="Label area height" hint="Millimetres">
                <Input
                type="number"
                step="0.01"
                className="tabular"
                value={areaHeight}
                onChange={(event) => setAreaHeight(event.target.value)} />

              </Field>
            </div>
          }

          <FormFailure message={failure} />

          <div className="flex justify-end gap-2">
            <Button type="button" variant="quiet" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={!ready || busy}>
              {busy ? 'Saving…' : 'Save material'}
            </Button>
          </div>
        </form>
      </Card>
    </div>);

}
