import { NavLink, useParams } from 'react-router-dom';
import { PageHeader } from '../components/AppShell';
import { AccountTab } from '../components/settings/AccountTab';
import {
  Callout,
  Card,
  Field,
  Input,
  Pill,
  SectionTitle,
  Select } from
'../components/ui/Primitives';
import { ARTEFACT_LABELS, CATEGORIES, STOCK } from '../lib/categories';
import { ADDRESSES, BUSINESS, COMPETENT_PERSON } from '../lib/identity';
import { useAuth } from '../lib/auth';
import { useEntitlement } from '../lib/entitlement';
import { regimeById } from '../lib/regimes';
import { useProducts } from '../lib/product-store';
import { useWorkspace } from '../lib/workspace';

/**
 * BILLING IS NOT A TAB HERE ANY MORE. It is a page of its own at /billing, because it is now
 * where a purchase happens rather than a read-only summary with links to somewhere else, and
 * because Stripe returns a customer to /billing/success — a checkout return landing inside a
 * settings tab would be a strange place to be told a payment worked. /settings/billing
 * redirects there, so an old bookmark still arrives in the right place.
 */
const TABS = [
{
  id: 'identity',
  label: 'Identity',
  title: 'Identity',
  description:
  'Everything here is printed. It appears on every label and in sections 1 and 15 of every safety data sheet. It is not stored yet, so what you see below is exactly what is being printed.'
},
{
  id: 'team',
  label: 'Team',
  title: 'Team and review',
  description:
  'Who can work in this workspace, and who signs off a safety data sheet before it is issued. One account, one person, for now.'
},
{
  id: 'account',
  label: 'Account',
  title: 'Your account',
  description:
  'Your sign-in, your password and what you agreed to. Nothing here changes a label.'
},
{
  id: 'preferences',
  label: 'Preferences',
  title: 'Preferences',
  // Was "…Which categories are switched on, and what the export defaults to." The second
  // half named a setting that does not exist: the two export fields below are not stored
  // anywhere and nothing reads them. A tab description is the first sentence somebody reads
  // on the screen, so it may not promise a control the screen does not have.
  description:
  'Small, reversible choices. Which categories are switched on when you create a product.'
}] as
const;

/**
 * Product settings are ordered by consequence: what prints first, small
 * reversible choices last. Identity is not really a preference, which is why it
 * leads and why saving it says what it will invalidate.
 *
 * Account and Billing sit together in the middle because they are about the
 * person and their plan rather than the product, and someone looking for one
 * usually wants the other.
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
        {active.id === 'account' && <AccountTab />}
        {active.id === 'preferences' && <PreferencesTab />}
      </div>
    </main>);

}

/* -------------------------------------------------------------- identity */

/**
 * The printed identity — WHICH IS NOT STORED ANYWHERE, AND NOW SAYS SO.
 *
 * Every field on this tab used to be an editable input, prefilled with the details of Hearth
 * and Hollow Ltd, above a "Save identity" button that raised a toast reading "Identity saved.
 * 14 outputs now carry the previous details and need versioning." Nothing was saved and
 * nothing was versioned. A maker who corrected their telephone number here — a number CLP
 * requires on the label, which is why the hint below says an email address will not do —
 * would have been told it was saved, and would have gone on believing their label carried it.
 *
 * There is no table for any of it. The account data schema creates accounts, account_members,
 * specifications and products; `accounts` has a `data` jsonb column that is the obvious home
 * for this, but the browser is granted SELECT on accounts and nothing else, because a client
 * that could write to accounts could rename or re-brand a workspace. So the fields are shown,
 * disabled, carrying the placeholders that are actually being printed — and the page says
 * plainly that this is not editable yet, rather than collecting an edit it will throw away.
 */
function IdentityTab() {
  const { status, products } = useProducts();
  const entitlement = useEntitlement();

  /**
   * How many products the ACCOUNT holds, from the database's own count.
   *
   * This sentence is a claim about the account, not a label on a list this tab drew, so it may
   * not be counted from `products.length` — `fetchProducts` drops a product whose
   * specification did not come back, and Billing removed exactly this fallback for exactly
   * this reason. The output total went with it: it was `products.length` again, one layer of
   * arithmetic further from the truth, and there is nothing to count it from that the database
   * has established.
   *
   * Null is unknown, and unknown is said by leaving the number out rather than by printing a
   * plausible one.
   *
   * AND ZERO IS TREATED AS UNKNOWN HERE, WHICH IS NOT TRUE OF ZERO EVERYWHERE. The paragraph
   * this feeds only renders when the list on screen is non-empty, so a count of nought is not
   * a fact about the account — it is this sentence contradicting the screen it is printed on,
   * and "it affects every output on all 0 products this account holds" is a sentence nobody
   * can act on. It was reachable for the whole of a maker's first session: the count is read
   * once when the provider mounts, so it stayed at the value it had before they created
   * anything. The dialog now asks for a re-read on every create (see NewProductDialog), and
   * this is the backstop for the frame between the write and the answer — and for any other
   * way the two sources come apart. The number is never invented; the clause simply falls back
   * to the wording that names no number at all.
   */
  const skuCount = entitlement.skuCount;
  const scope =
  skuCount === null || skuCount === 0 ?
  'It affects every output on every product this account holds.' :
  `It affects every output on all ${skuCount} ${skuCount === 1 ? 'product' : 'products'} this account holds.`;

  return (
    <>
      <Callout tone="warn" title="Not editable yet">
        <p className="max-w-prose leading-relaxed">
          Your printed identity is not stored yet, so nothing on this tab can be saved. The
          placeholders below are exactly what is being drawn onto your label previews and into
          sections 1 and 15 of your safety data sheet — that is what an unfilled supplier block
          looks like, rather than a setting somebody has entered.
        </p>
        {status === 'ready' && products.length > 0 &&
        <p className="mt-2 max-w-prose leading-relaxed">
            {scope} Identity is printed rather than configured, so when it becomes editable,
            changing it will move all of them.
          </p>
        }
      </Callout>

      <section aria-labelledby="business-heading">
        <SectionTitle className="mb-1">
          <span id="business-heading">Supplier block</span>
        </SectionTitle>
        <p className="mb-3 max-w-prose text-2xs leading-relaxed text-ink-tertiary">
          Printed on every label, and repeated in section 1 of every safety data sheet.
        </p>
        <Card className="grid gap-5 px-5 py-5 md:grid-cols-2">
          <Field label="Registered name" hint="Used on invoices and in section 1">
            <Input disabled value={BUSINESS.name} readOnly />
          </Field>
          <Field label="Trading name" hint="The name printed on labels">
            <Input disabled value={BUSINESS.tradingName} readOnly />
          </Field>
          <Field
            label="Telephone number"
            hint="CLP requires a telephone number for the supplier. An email address does not satisfy it, so this is printed.">

            <Input className="tabular" disabled value={BUSINESS.phone} readOnly />
          </Field>
          <Field label="Email" hint="For your records. Never printed on a label.">
            <Input disabled value={BUSINESS.email} readOnly />
          </Field>
        </Card>
      </section>

      <section aria-labelledby="addresses-heading">
        <SectionTitle className="mb-1">
          <span id="addresses-heading">Address blocks by market</span>
        </SectionTitle>
        <p className="mb-3 max-w-prose text-2xs leading-relaxed text-ink-tertiary">
          Chosen automatically by the market a product is sold into. Which block is used is
          real; what is in it is not stored yet.
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
              <address className="mt-3 not-italic text-sm leading-relaxed text-ink-tertiary">
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
          <Field
            label="VAT number"
            hint="Printed in section 15. The VAT number Stripe uses for the reverse charge is separate, is real, and lives in the billing portal.">

            <Input className="tabular" disabled value={BUSINESS.vatNumber} readOnly />
          </Field>
          <Field
            label="Emergency telephone"
            hint="Leave as the national service unless you hold a dedicated poisons line.">

            <Select disabled defaultValue="national">
              <option value="national">National poisons service</option>
              <option value="own">A number we operate</option>
            </Select>
          </Field>
        </Card>
      </section>
    </>);

}

/* ------------------------------------------------------------------ team */

/**
 * Who is in this workspace — WHICH IS EXACTLY ONE PERSON, AND THE SCHEMA MEANS IT.
 *
 * This tab used to list Nadia Osei, Tom Rivers and Priya Shah with roles and "last active"
 * times, an Invite button that raised "Invitation sent", and a Remove button behind a
 * confirmation dialog that removed nobody. None of the three existed, no invitation was sent,
 * and a maker who "removed" somebody was told they no longer had access to a workspace they
 * had never had access to.
 *
 * The account data schema states the position outright: account_members is READ ONLY to the
 * browser, "One row today: the owner. Invites are deferred." That is not an oversight to work
 * around — a client that could insert an account_members row could hand itself, or somebody
 * else, another account's data. So this tab shows the one real member, from the session, and
 * says what is coming without pretending any of it is here.
 *
 * The shape is deliberate all the same: the tables key on account_id rather than user_id
 * precisely so that seats become an invite flow and a count rather than a migration.
 */
function TeamTab() {
  const { user } = useAuth();
  const entitlement = useEntitlement();

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
          <p className="text-sm font-medium text-ink-tertiary">{COMPETENT_PERSON.name}</p>
          <p className="mt-3 max-w-prose text-[0.8125rem] leading-relaxed text-ink-secondary">
            Naming a reviewer is not built yet, so no sheet has been reviewed or signed. The app
            assembles the document and shows its working; it never signs on anybody's behalf,
            and it will not tell you a sheet has been reviewed when it has not.
          </p>
        </Card>
      </section>

      <section aria-labelledby="team-heading">
        <SectionTitle className="mb-1">
          <span id="team-heading">Members</span>
        </SectionTitle>
        <p className="mb-3 max-w-prose text-2xs leading-relaxed text-ink-tertiary">
          One account, one person, for now.
        </p>
        <Card className="divide-y divide-paper-line">
          <div className="flex flex-wrap items-center gap-4 px-5 py-4">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-ink">
                {entitlement.businessName ?? 'This account'}
              </p>
              <p className="text-2xs text-ink-tertiary">{user?.email ?? 'Signed in'}</p>
            </div>
            <Pill tone="neutral">Owner</Pill>
          </div>
        </Card>
        <Callout className="mt-4" title="Inviting people is not built yet">
          <p className="max-w-prose leading-relaxed">
            Your account is already the thing your products belong to rather than your login,
            which is the part that had to be right first — so adding a colleague later is an
            invitation and a seat count, not a rebuild. There is nothing to switch on today.
          </p>
        </Callout>
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
              className="h-4 w-4 flex-none accent-teal" />
            
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

      {/* TWO HALVES OF THIS CARD, AND ONLY ONE OF THEM IS A THING THE SOFTWARE DOES.
          The presets are real: the artefact designer reads STOCK and offers exactly these.
          The two fields underneath were uncontrolled `<Select defaultValue=…>` with no
          onChange and nowhere to write to — changing either did nothing, survived nothing,
          and looked identical to the category toggles above, which do work. That is the same
          fault the identity tab was fixed for, so it gets the identity tab's answer:
          disabled, and told plainly why, rather than collecting a choice to throw away. */}
      <section aria-labelledby="stock-heading">
        <SectionTitle className="mb-1">
          <span id="stock-heading">Stock presets and export defaults</span>
        </SectionTitle>
        <p className="mb-3 max-w-prose text-2xs leading-relaxed text-ink-tertiary">
          The presets are what the artefact designer offers when you choose a stock. The two
          defaults below are not stored yet, so they are shown the way the identity tab shows
          what it cannot save.
        </p>
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
            <Field
              label="Default export"
              hint="Not stored yet. Nothing produces an export for this to be the default of.">

              <Select disabled defaultValue="single">
                <option value="single">Single label PDF</option>
                <option value="sheet">Sheet layout PDF</option>
              </Select>
            </Field>
            <Field
              label="Default market"
              hint="Not stored yet. A product's market is chosen on its specification screen, per product.">

              <Select disabled defaultValue="GB">
                <option value="GB">Great Britain</option>
                <option value="EU">European Union and Northern Ireland</option>
              </Select>
            </Field>
          </div>
        </Card>
      </section>
    </>);

}
