import { useState } from 'react';
import { NavLink, useParams } from 'react-router-dom';
import { CheckIcon, PhoneIcon, PlusIcon } from 'lucide-react';
import { toast } from 'sonner';
import { PageHeader } from '../components/AppShell';
import {
  Button,
  Callout,
  Card,
  Field,
  Input,
  Pill,
  SectionTitle,
  Select } from
'../components/ui/Primitives';
import {
  ADDRESSES,
  ARTEFACT_LABELS,
  BILLING,
  BUSINESS,
  CATEGORIES,
  COMPETENT_PERSON,
  INVOICES,
  PLANS,
  STOCK,
  TEAM,
  planById } from
'../lib/products';
import { TeamMember, formatDate } from '../lib/model';
import { regimeById } from '../lib/regimes';
import { useProducts, useWorkspace } from '../lib/workspace';

const TABS = [
{
  id: 'identity',
  label: 'Identity',
  title: 'Identity',
  description:
  'Everything here is printed. It appears on every label and in sections 1 and 15 of every safety data sheet, so changing it moves your outputs.'
},
{
  id: 'team',
  label: 'Team',
  title: 'Team and review',
  description:
  'Who can work in this workspace, and who signs off a safety data sheet before it is issued.'
},
{
  id: 'billing',
  label: 'Billing',
  title: 'Plan and billing',
  description:
  'Priced by the number of products you hold. Reading supplier documents is never metered.'
},
{
  id: 'preferences',
  label: 'Preferences',
  title: 'Preferences',
  description:
  'Small, reversible choices. Which categories are switched on, and what the export defaults to.'
}] as
const;

/**
 * Ordered by consequence: what prints first, small reversible choices last.
 * Identity is not really a preference, which is why it leads and why saving it
 * says what it will invalidate.
 */
export function Settings() {
  const { tab } = useParams();
  const active = (TABS.find((entry) => entry.id === tab) ?? TABS[0]) as (typeof TABS)[number];

  return (
    <main className="flex-1 pb-24 xl:pb-0">
      <PageHeader eyebrow="Settings" title={active.title} description={active.description} />

      <div className="border-b border-paper-line px-6 lg:px-10">
        <nav className="flex flex-wrap items-center gap-1" aria-label="Settings sections">
          {TABS.map((entry) =>
          <NavLink
            key={entry.id}
            to={`/settings/${entry.id}`}
            className={({ isActive }) =>
            `-mb-px border-b-2 px-3 py-2.5 text-sm transition-colors ${
            isActive || entry.id === 'identity' && !tab ?
            'border-teal font-medium text-ink' :
            'border-transparent text-ink-secondary hover:text-ink'}`

            }>
            
              {entry.label}
            </NavLink>
          )}
        </nav>
      </div>

      <div className="space-y-8 px-6 py-8 lg:px-10">
        {active.id === 'identity' && <IdentityTab />}
        {active.id === 'team' && <TeamTab />}
        {active.id === 'billing' && <BillingTab />}
        {active.id === 'preferences' && <PreferencesTab />}
      </div>
    </main>);

}

/* -------------------------------------------------------------- identity */

function IdentityTab() {
  const products = useProducts();
  const [dirty, setDirty] = useState(false);

  const affected = products.reduce((sum, product) => sum + product.artefacts.length, 0);

  return (
    <>
      {dirty &&
      <Callout tone="warn" title="This will move your outputs">
          Identity is printed, not configured. Saving invalidates the{' '}
          <span className="tabular">{affected}</span> outputs currently carrying the old details,
          and each will need versioning before the next run.
        </Callout>
      }

      <section aria-labelledby="business-heading">
        <SectionTitle className="mb-1">
          <span id="business-heading">Supplier block</span>
        </SectionTitle>
        <p className="mb-3 max-w-prose text-2xs leading-relaxed text-ink-tertiary">
          Printed on every label, and repeated in section 1 of every safety data sheet.
        </p>
        <Card className="grid gap-5 px-5 py-5 md:grid-cols-2">
          <Field label="Registered name" hint="Used on invoices and in section 1">
            <Input defaultValue={BUSINESS.name} onChange={() => setDirty(true)} />
          </Field>
          <Field label="Trading name" hint="The name printed on labels">
            <Input defaultValue={BUSINESS.tradingName} onChange={() => setDirty(true)} />
          </Field>
          <Field
            label="Telephone number"
            hint="CLP requires a telephone number for the supplier. An email address does not satisfy it, so this is printed.">
            
            <div className="relative">
              <PhoneIcon
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-tertiary"
                strokeWidth={1.25}
                aria-hidden="true" />
              
              <Input
                className="tabular pl-9"
                defaultValue={BUSINESS.phone}
                onChange={() => setDirty(true)} />
              
            </div>
          </Field>
          <Field label="Email" hint="For your records. Never printed on a label.">
            <Input defaultValue={BUSINESS.email} onChange={() => setDirty(true)} />
          </Field>
        </Card>
      </section>

      <section aria-labelledby="addresses-heading">
        <div className="mb-1 flex items-center justify-between">
          <SectionTitle>
            <span id="addresses-heading">Address blocks by market</span>
          </SectionTitle>
          <Button size="sm" variant="secondary" onClick={() => toast('Address block added')}>
            <PlusIcon className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />
            Add address block
          </Button>
        </div>
        <p className="mb-3 max-w-prose text-2xs leading-relaxed text-ink-tertiary">
          Chosen automatically by the market a product is sold into.
        </p>
        <div className="grid gap-4 md:grid-cols-2">
          {ADDRESSES.map((address) =>
          <Card key={address.id} className="px-5 py-5">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="font-display text-base font-medium text-ink">{address.label}</p>
                  <p className="mt-0.5 text-2xs text-ink-tertiary">{address.role}</p>
                </div>
                {address.isDefault && <Pill tone="good">Default</Pill>}
              </div>
              <address className="mt-3 not-italic text-sm leading-relaxed text-ink-secondary">
                {address.lines.map((line) =>
              <span key={line} className="block">
                    {line}
                  </span>
              )}
              </address>
              {address.market === 'EU' &&
            <Callout className="mt-4">
                  Used for products sold into the EU or Northern Ireland. It serves as the
                  responsible person for cosmetics, the economic operator under GPSR, and the
                  importer block on device labels.
                </Callout>
            }
            </Card>
          )}
        </div>
      </section>

      <section aria-labelledby="regulatory-heading">
        <SectionTitle className="mb-1">
          <span id="regulatory-heading">Regulatory references</span>
        </SectionTitle>
        <p className="mb-3 max-w-prose text-2xs leading-relaxed text-ink-tertiary">
          Printed in section 15 of every safety data sheet.
        </p>
        <Card className="grid gap-5 px-5 py-5 md:grid-cols-2">
          <Field label="VAT number">
            <Input className="tabular" defaultValue={BILLING.vatNumber} onChange={() => setDirty(true)} />
          </Field>
          <Field
            label="Emergency telephone"
            hint="Leave as the national service unless you hold a dedicated poisons line.">
            
            <Select defaultValue="national" onChange={() => setDirty(true)}>
              <option value="national">National poisons service</option>
              <option value="own">A number we operate</option>
            </Select>
          </Field>
        </Card>
      </section>

      <div className="flex items-center gap-3">
        <Button
          variant="primary"
          disabled={!dirty}
          onClick={() => {
            toast('Identity saved', {
              description: `${affected} outputs now carry the previous details and need versioning.`
            });
            setDirty(false);
          }}>
          
          Save identity
        </Button>
        {!dirty && <p className="text-2xs text-ink-tertiary">Nothing changed.</p>}
      </div>
    </>);

}

/* ------------------------------------------------------------------ team */

function TeamTab() {
  const [pendingRemoval, setPendingRemoval] = useState<TeamMember | null>(null);

  return (
    <>
      <section aria-labelledby="competent-heading">
        <SectionTitle className="mb-1">
          <span id="competent-heading">Competent person</span>
        </SectionTitle>
        <p className="mb-3 max-w-prose text-2xs leading-relaxed text-ink-tertiary">
          Every safety data sheet is produced as a draft. This is who reviews and signs it.
        </p>
        <Card className="px-5 py-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-ink">{COMPETENT_PERSON.name}</p>
              <p className="mt-0.5 text-2xs text-ink-tertiary">
                {COMPETENT_PERSON.organisation} · {COMPETENT_PERSON.email}
              </p>
            </div>
            <Pill tone={COMPETENT_PERSON.awaiting ? 'warn' : 'good'}>
              {COMPETENT_PERSON.awaiting ?
              `${COMPETENT_PERSON.awaiting} sheets awaiting review` :
              'Nothing awaiting review'}
            </Pill>
          </div>
          <p className="mt-4 max-w-prose text-[0.8125rem] leading-relaxed text-ink-secondary">
            {COMPETENT_PERSON.reviewed} sheets signed to date. The app assembles the document and
            shows its working; it never signs on their behalf.
          </p>
          <div className="mt-4">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => toast('Reviewer change requested')}>
              
              Change reviewer
            </Button>
          </div>
        </Card>
      </section>

      <section aria-labelledby="team-heading">
        <div className="mb-3 flex items-center justify-between">
          <SectionTitle>
            <span id="team-heading">Members</span>
          </SectionTitle>
          <Button size="sm" variant="secondary" onClick={() => toast('Invitation sent')}>
            <PlusIcon className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />
            Invite
          </Button>
        </div>
        <Card className="divide-y divide-paper-line">
          {TEAM.map((member) =>
          <div key={member.email} className="flex flex-wrap items-center gap-4 px-5 py-4">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-ink">{member.name}</p>
                <p className="text-2xs text-ink-tertiary">{member.email}</p>
              </div>
              <Pill tone="neutral">{member.role}</Pill>
              <span className="text-2xs text-ink-tertiary">Active {member.lastActive}</span>
              {member.role !== 'Owner' &&
            <Button size="sm" variant="quiet" onClick={() => setPendingRemoval(member)}>
                  Remove
                </Button>
            }
            </div>
          )}
        </Card>
      </section>

      {pendingRemoval &&
      <ConfirmDialog
        title={`Remove ${pendingRemoval.name}`}
        body={`${pendingRemoval.name} will lose access to materials, compositions and outputs. Production records they created stay in the register.`}
        confirmLabel="Remove"
        onCancel={() => setPendingRemoval(null)}
        onConfirm={() => {
          toast('Team member removed', {
            description: `${pendingRemoval.name} no longer has access.`
          });
          setPendingRemoval(null);
        }} />

      }
    </>);

}

/* --------------------------------------------------------------- billing */

function BillingTab() {
  const products = useProducts();
  const plan = planById(BILLING.planId);
  const used = products.length;
  const pct = Math.min(100, Math.round(used / plan.productLimit * 100));

  return (
    <>
      <section aria-labelledby="usage-heading">
        <SectionTitle className="mb-3">
          <span id="usage-heading">Usage</span>
        </SectionTitle>
        <Card className="px-5 py-5">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <p className="text-sm text-ink">
              <span className="tabular font-medium">{used}</span> of{' '}
              <span className="tabular">{plan.productLimit}</span> products on {plan.name}
            </p>
            <p className="tabular text-2xs text-ink-tertiary">
              Renews {formatDate(BILLING.renews)}
            </p>
          </div>
          <div
            className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-paper-line"
            role="progressbar"
            aria-valuenow={used}
            aria-valuemin={0}
            aria-valuemax={plan.productLimit}
            aria-label="Products used">
            
            <div className="h-full rounded-full bg-teal" style={{ width: `${pct}%` }} />
          </div>
          <p className="mt-3 max-w-prose text-[0.8125rem] leading-relaxed text-ink-secondary">
            Reading supplier documents is never metered, on any plan. At the limit you can keep
            working on existing products but cannot create a new one until you move up a plan.
          </p>
        </Card>
      </section>

      <section aria-labelledby="plan-heading">
        <SectionTitle className="mb-3">
          <span id="plan-heading">Plan</span>
        </SectionTitle>
        <div className="grid gap-4 lg:grid-cols-3">
          {PLANS.map((option) => {
            const current = option.id === plan.id;
            return (
              <Card
                key={option.id}
                className={`px-5 py-5 ${current ? 'border-teal bg-teal-tint' : ''}`}>
                
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-display text-base font-medium text-ink">{option.name}</p>
                    <p className="tabular mt-0.5 text-2xs text-ink-tertiary">
                      £{option.monthly} a month · up to {option.productLimit} products
                    </p>
                  </div>
                  {current &&
                  <Pill tone="good">
                      <CheckIcon className="h-3 w-3" strokeWidth={1.5} aria-hidden="true" />
                      Current
                    </Pill>
                  }
                </div>
                <p className="mt-3 max-w-prose text-2xs leading-relaxed text-ink-secondary">
                  {option.blurb}
                </p>
                {!current &&
                <div className="mt-4">
                    <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => toast(`Moved to ${option.name}`)}>
                    
                      {option.productLimit > plan.productLimit ? 'Move up' : 'Move down'}
                    </Button>
                  </div>
                }
              </Card>);

          })}
        </div>
      </section>

      <section aria-labelledby="payment-heading">
        <SectionTitle className="mb-3">
          <span id="payment-heading">Payment</span>
        </SectionTitle>
        <Card className="grid gap-5 px-5 py-5 md:grid-cols-2">
          <div>
            <p className="mb-1.5 text-[0.8125rem] font-medium text-ink-secondary">Card on file</p>
            <p className="tabular text-sm text-ink">
              {BILLING.card.brand} ending {BILLING.card.last4}
            </p>
            <p className="tabular mt-0.5 text-2xs text-ink-tertiary">
              Expires {BILLING.card.expires}
            </p>
            <div className="mt-3">
              <Button size="sm" variant="secondary" onClick={() => toast('Card updated')}>
                Update card
              </Button>
            </div>
          </div>
          <Field label="Billing email" hint="Invoices and receipts go here.">
            <Input defaultValue={BILLING.billingEmail} />
          </Field>
        </Card>
      </section>

      <section aria-labelledby="invoices-heading">
        <SectionTitle className="mb-3">
          <span id="invoices-heading">Invoices</span>
        </SectionTitle>
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-left text-sm">
              <thead>
                <tr className="border-b border-paper-line bg-paper-panel/60 text-2xs uppercase tracking-[0.1em] text-ink-tertiary">
                  <th scope="col" className="px-5 py-3 font-medium">Invoice</th>
                  <th scope="col" className="px-5 py-3 font-medium">Date</th>
                  <th scope="col" className="px-5 py-3 font-medium">Amount</th>
                  <th scope="col" className="px-5 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {INVOICES.map((invoice) =>
                <tr key={invoice.id} className="border-b border-paper-line last:border-0">
                    <td className="tabular px-5 py-3.5 text-ink">{invoice.number}</td>
                    <td className="tabular px-5 py-3.5 text-ink-secondary">
                      {formatDate(invoice.date)}
                    </td>
                    <td className="tabular px-5 py-3.5 text-ink-secondary">£{invoice.amount}</td>
                    <td className="px-5 py-3.5">
                      <Pill tone={invoice.status === 'Paid' ? 'good' : 'warn'}>
                        {invoice.status}
                      </Pill>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      </section>
    </>);

}

/* ----------------------------------------------------------- preferences */

function PreferencesTab() {
  const { enabledCategories, toggleCategory } = useWorkspace();

  return (
    <>
      <section aria-labelledby="categories-heading">
        <SectionTitle className="mb-1">
          <span id="categories-heading">Categories</span>
        </SectionTitle>
        <p className="mb-3 max-w-prose text-2xs leading-relaxed text-ink-tertiary">
          Switching a category off hides it when creating a product. Existing products are
          untouched.
        </p>
        <Card className="divide-y divide-paper-line">
          {CATEGORIES.map((category) =>
          <label
            key={category.id}
            className="flex cursor-pointer flex-wrap items-center gap-4 px-5 py-4">
            
              <input
              type="checkbox"
              checked={enabledCategories.includes(category.id)}
              onChange={() => toggleCategory(category.id)}
              className="h-4 w-4 flex-none accent-[#1A6A62]" />
            
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-ink">{category.name}</p>
                <p className="mt-0.5 text-2xs text-ink-tertiary">{category.blurb}</p>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {category.regimes.map((regime) =>
              <Pill key={regime} tone="neutral">
                    {regimeById(regime).short}
                  </Pill>
              )}
              </div>
            </label>
          )}
        </Card>
      </section>

      <section aria-labelledby="stock-heading">
        <SectionTitle className="mb-3">
          <span id="stock-heading">Stock presets and export defaults</span>
        </SectionTitle>
        <Card className="px-5 py-5">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="text-2xs uppercase tracking-[0.1em] text-ink-tertiary">
                <th scope="col" className="pb-2 font-medium">Preset</th>
                <th scope="col" className="pb-2 font-medium">Surface</th>
                <th scope="col" className="pb-2 font-medium">Size</th>
                <th scope="col" className="pb-2 font-medium">Per sheet</th>
              </tr>
            </thead>
            <tbody>
              {STOCK.map((stock) =>
              <tr key={stock.id} className="border-t border-paper-line">
                  <td className="py-2.5 text-ink">{stock.name}</td>
                  <td className="py-2.5 text-ink-secondary">
                    {ARTEFACT_LABELS[stock.artefactType]}
                  </td>
                  <td className="tabular py-2.5 text-ink-secondary">
                    {stock.widthMm} × {stock.heightMm} mm
                  </td>
                  <td className="tabular py-2.5 text-ink-secondary">
                    {stock.perSheet} on {stock.sheet}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          <div className="mt-5 grid gap-5 md:grid-cols-2">
            <Field label="Default export">
              <Select defaultValue="single">
                <option value="single">Single label PDF</option>
                <option value="sheet">Sheet layout PDF</option>
              </Select>
            </Field>
            <Field label="Default market">
              <Select defaultValue="GB">
                <option value="GB">Great Britain</option>
                <option value="EU">European Union and Northern Ireland</option>
              </Select>
            </Field>
          </div>
        </Card>
      </section>
    </>);

}

/* ---------------------------------------------------------------- shared */

function ConfirmDialog({
  title,
  body,
  confirmLabel,
  onCancel,
  onConfirm






}: {title: string;body: string;confirmLabel: string;onCancel: () => void;onConfirm: () => void;}) {
  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-ink/20 px-6"
      role="dialog"
      aria-modal="true"
      aria-label={title}>
      
      <Card className="w-full max-w-md px-6 py-6">
        <h2 className="font-display text-lg font-medium text-ink">{title}</h2>
        <p className="mt-2 text-sm leading-relaxed text-ink-secondary">{body}</p>
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="quiet" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="danger" onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </div>
      </Card>
    </div>);

}