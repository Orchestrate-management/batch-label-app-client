import React, { useState } from 'react';
import { NavLink, useParams } from 'react-router-dom';
import { PageHeader } from '../components/AppShell';
import { AccountTab } from '../components/settings/AccountTab';
import {
  Button,
  Callout,
  Card,
  Field,
  FormError,
  FormStatus,
  Input,
  Pill,
  SectionTitle,
  Skeleton } from
'../components/ui/Primitives';
import { ARTEFACT_LABELS, CATEGORIES, STOCK } from '../lib/categories';
import { ADDRESS_BLOCKS, COMPETENT_PERSON, type PrintedMarket } from '../lib/identity';
import { useAuth } from '../lib/auth';
import { useEntitlement } from '../lib/entitlement';
import { readSkuCount, skuCountBeside } from '../lib/membership';
import { regimeById } from '../lib/regimes';
import { useProducts } from '../lib/product-store';
import { useSettings, type SettingsValue } from '../lib/settings-store';
import { readAddressLines, type BusinessIdentityInput } from '../lib/settings-data';
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
  'Everything here is printed. It appears on every label and in sections 1 and 15 of every safety data sheet, so what is stored here is what your documents say.'
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
  'Your sign-in, your password, what you agreed to, and how to get your data out or have it erased.'
},
{
  id: 'preferences',
  label: 'Preferences',
  title: 'Preferences',
  description:
  'Small, reversible choices. Which categories are switched on when you create a product.'
}] as
const;

/**
 * Product settings are ordered by consequence: what prints first, small
 * reversible choices last. Identity is not really a preference, which is why it
 * leads and why saving it says what it changes.
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

/* ------------------------------------------------- shared status rendering */

/**
 * The four states in which no control on this page may claim a save, said in four different
 * sentences.
 *
 * They are separate because they are separate problems with separate fixes, and the one thing
 * this repo keeps getting wrong is collapsing them: "we could not read your settings" printed
 * over an account that simply has none, or a retry button offered for a state a retry cannot
 * move. Returns null when the store is ready, which is the caller's cue to draw its form.
 */
function SettingsUnavailable({ settings }: {settings: SettingsValue;}) {
  if (settings.status === 'ready') return null;

  if (settings.status === 'loading') {
    return (
      <Card className="space-y-3 px-5 py-5" aria-busy="true">
        <p className="text-sm text-ink-secondary">Reading your settings…</p>
        <Skeleton className="h-4 w-48" />
        <Skeleton className="h-4 w-64" />
      </Card>);

  }

  if (settings.status === 'unconfigured') {
    return (
      <Callout tone="warn" title="Not connected to the database">
        <p className="max-w-prose leading-relaxed">
          This copy of the app has no database connection, so nothing on this page can be read
          or saved. This is us, not you.
        </p>
      </Callout>);

  }

  if (settings.status === 'no-account') {
    return (
      <Callout tone="warn" title="We do not know which workspace this is">
        <p className="max-w-prose leading-relaxed">
          Your sign-in worked, but we have not resolved an account for it, so there is nothing
          to read these settings from and nowhere to save them to. Reload the page, and get in
          touch if it keeps happening.
        </p>
      </Callout>);

  }

  return (
    <Callout tone="warn" title="We could not read your settings">
      <p className="max-w-prose leading-relaxed">
        {settings.error ?? 'This is us, not you — nothing has been lost.'}
      </p>
      <div className="mt-3">
        <Button variant="secondary" onClick={settings.reload}>
          Try again
        </Button>
      </div>
    </Callout>);

}

/* -------------------------------------------------------------- identity */

/**
 * The printed identity — WHICH IS NOW STORED, AND WHICH SAYS WHAT IT IS STILL MISSING.
 *
 * WHAT THIS TAB USED TO BE. Six disabled inputs bound to a module of bracketed placeholders,
 * under a callout explaining that there was nowhere to store any of it. Before that it was six
 * editable inputs prefilled with the details of a business that does not exist, above a "Save
 * identity" button that raised "Identity saved. 14 outputs now carry the previous details and
 * need versioning." Nothing was saved and nothing was versioned.
 *
 * `batchlabel.business_identity` and `batchlabel.supplier_addresses` exist now, so the fields
 * are real fields, the button writes, and the row is read back and redrawn from. What has NOT
 * changed is the discipline about what is claimed: a save says the row was written, and
 * nothing on this screen says a document was reissued, because no document is produced yet.
 */
function IdentityTab() {
  const settings = useSettings();
  const unavailable = <SettingsUnavailable settings={settings} />;

  return (
    <>
      <PrintedScope />
      {settings.status === 'ready' ?
      <>
          <IdentityGaps settings={settings} />
          <IdentityForm key={settings.accountId ?? 'none'} settings={settings} />
          <AddressBlocks settings={settings} />
          <RegulatorySection settings={settings} />
        </> :

      unavailable
      }
    </>);

}

/**
 * How far this edit reaches, counted by the database rather than by this screen.
 *
 * The sentence is a claim about the ACCOUNT, so it may not be counted from `products.length` —
 * `fetchProducts` drops a product whose specification did not come back. `readSkuCount` names
 * the third state (a write of ours moved the count and the re-read has not landed) and
 * `skuCountBeside` refuses a count lower than the list that has already been drawn, because an
 * account cannot hold fewer products than we just read out of it. Null is unknown, and unknown
 * is said by leaving the number out rather than by printing a plausible one.
 */
function PrintedScope() {
  const { status, products } = useProducts();
  const entitlement = useEntitlement();

  const stated = skuCountBeside(
    readSkuCount(entitlement.skuCount, entitlement.skuCountStale),
    products.length
  );

  if (status !== 'ready' || products.length === 0) return null;

  const scope =
  stated === null ?
  'every product this account holds' :
  `all ${stated} ${stated === 1 ? 'product' : 'products'} this account holds`;

  return (
    <Callout title="This is printed, not configured">
      <p className="max-w-prose leading-relaxed">
        There is one supplier block per account and every document draws it as it stands, so a
        change here moves what is printed for {scope} the moment it is saved. Nothing you have
        already exported changes, because nothing is exported yet.
      </p>
    </Callout>);

}

const MARKETS: PrintedMarket[] = ['GB', 'EU'];

/**
 * What we do not hold, listed plainly. NOT A COMPLIANCE VERDICT.
 *
 * This checks that a value is present and nothing else. It does not inspect the value, it has
 * no idea whether the address is real, and the absence of this callout is not a statement that
 * a label is compliant — which is why the wording names the placeholder that will print rather
 * than naming a rule that has been satisfied. The one regulatory sentence in it is a statement
 * of what CLP Article 17 asks for, not a finding about this account.
 */
function IdentityGaps({ settings }: {settings: SettingsValue;}) {
  const stored = new Set(settings.addresses.map((address) => address.market));
  const gaps: string[] = [];
  if (!settings.identity) gaps.push('your registered business name');
  if (!settings.identity?.telephone) gaps.push('a telephone number');
  for (const market of MARKETS) {
    if (!stored.has(market)) gaps.push(`the ${ADDRESS_BLOCKS[market].label} address block`);
  }

  if (gaps.length === 0) return null;

  return (
    <Callout tone="warn" title="Some of what prints is still a placeholder">
      <p className="max-w-prose leading-relaxed">
        We are not holding {gaps.join(', ').replace(/, ([^,]*)$/, ' or $1')}. Wherever one of
        those belongs, a label preview and sections 1 and 15 of a safety data sheet print a
        bracketed placeholder — that is what an unfilled supplier block looks like, rather than
        a setting somebody has entered.
      </p>
      <p className="mt-2 max-w-prose leading-relaxed">
        CLP Article 17 asks a label to carry the supplier&rsquo;s name, address and telephone
        number. This checks only that we hold something for each; it does not check that what
        you entered is right, and nothing here has reviewed your label.
      </p>
    </Callout>);

}

const EMPTY_IDENTITY: BusinessIdentityInput = {
  registeredName: '',
  tradingName: '',
  telephone: '',
  email: '',
  website: '',
  vatNumber: ''
};

/** The supplier block, editable, saved, and read back from the row that was written. */
function IdentityForm({ settings }: {settings: SettingsValue;}) {
  const [form, setForm] = useState<BusinessIdentityInput>(() =>
  settings.identity ?
  {
    registeredName: settings.identity.registeredName,
    tradingName: settings.identity.tradingName ?? '',
    telephone: settings.identity.telephone ?? '',
    email: settings.identity.email ?? '',
    website: settings.identity.website ?? '',
    vatNumber: settings.identity.vatNumber ?? ''
  } :
  EMPTY_IDENTITY
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const set = (field: keyof BusinessIdentityInput) => (value: string) => {
    setForm((previous) => ({ ...previous, [field]: value }));
    setSaved(false);
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setSaved(false);

    const result = await settings.saveIdentity(form);
    setBusy(false);

    if (result.error) {
      setError(result.error);
      return;
    }
    // Redrawn from the ROW, not from what was typed. The database trims, and a maker who typed
    // trailing spaces should see what is actually going to be printed.
    if (result.value) {
      setForm({
        registeredName: result.value.registeredName,
        tradingName: result.value.tradingName ?? '',
        telephone: result.value.telephone ?? '',
        email: result.value.email ?? '',
        website: result.value.website ?? '',
        vatNumber: result.value.vatNumber ?? ''
      });
    }
    setSaved(true);
  };

  return (
    <section aria-labelledby="business-heading">
      <SectionTitle className="mb-1">
        <span id="business-heading">Supplier block</span>
      </SectionTitle>
      <p className="mb-3 max-w-prose text-2xs leading-relaxed text-ink-tertiary">
        Printed on every label, and repeated in section 1 of every safety data sheet.
      </p>
      <Card className="px-5 py-5">
        <form onSubmit={handleSubmit} noValidate className="space-y-5">
          <div className="grid gap-5 md:grid-cols-2">
            {/* The only required box on the page, and the hint says so in words rather than
                with an asterisk — one required field does not need a key and a legend. */}
            <Field
              label="Registered name"
              hint="Required. Used on invoices and in section 1; everything else here is optional.">

              <Input
                required
                aria-required="true"
                value={form.registeredName}
                onChange={(event) => set('registeredName')(event.target.value)} />

            </Field>
            <Field
              label="Trading name"
              hint="The name printed on labels. Left blank, your registered name is printed.">

              <Input
                value={form.tradingName}
                onChange={(event) => set('tradingName')(event.target.value)} />

            </Field>
            <Field
              label="Telephone number"
              hint="CLP requires a telephone number for the supplier. An email address does not satisfy it, so this is printed.">

              <Input
                className="tabular"
                inputMode="tel"
                value={form.telephone}
                onChange={(event) => set('telephone')(event.target.value)} />

            </Field>
            <Field label="Email" hint="For your records. Never printed on a label.">
              <Input
                type="email"
                value={form.email}
                onChange={(event) => set('email')(event.target.value)} />

            </Field>
            <Field label="Website" hint="Shown on a safety data sheet where there is room.">
              <Input
                value={form.website}
                onChange={(event) => set('website')(event.target.value)} />

            </Field>
            <Field
              label="VAT number"
              hint="Printed in section 15. The VAT number Stripe uses for the reverse charge is separate, is real, and lives in the billing portal.">

              <Input
                className="tabular"
                value={form.vatNumber}
                onChange={(event) => set('vatNumber')(event.target.value)} />

            </Field>
          </div>

          {error && <FormError>{error}</FormError>}
          {saved &&
          <FormStatus>
              Saved. Every label preview and safety data sheet now draws these details.
            </FormStatus>
          }

          <Button type="submit" variant="primary" disabled={busy}>
            {busy ? 'Saving…' : 'Save supplier block'}
          </Button>
        </form>
      </Card>
    </section>);

}

/* ------------------------------------------------------------- addresses */

function AddressBlocks({ settings }: {settings: SettingsValue;}) {
  return (
    <section aria-labelledby="addresses-heading">
      <SectionTitle className="mb-1">
        <span id="addresses-heading">Address blocks by market</span>
      </SectionTitle>
      <p className="mb-3 max-w-prose text-2xs leading-relaxed text-ink-tertiary">
        Chosen automatically by the market a product is sold into. Three to six lines each — the
        renderer lays out a compressed address from the first and the second to last, so the
        shape matters as much as the words.
      </p>
      <div className="grid gap-4 lg:grid-cols-2">
        {MARKETS.map((market) =>
        <AddressBlock
          key={market}
          market={market}
          settings={settings}
          stored={settings.addresses.find((address) => address.market === market) ?? null} />

        )}
      </div>
    </section>);

}

function AddressBlock({
  market,
  settings,
  stored



}: {market: PrintedMarket;settings: SettingsValue;stored: {lines: string[];} | null;}) {
  const block = ADDRESS_BLOCKS[market];
  const [text, setText] = useState(() => (stored ? stored.lines.join('\n') : ''));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const fieldId = `address-${market.toLowerCase()}`;

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setSaved(false);

    const { lines, error: shapeError } = readAddressLines(text);
    if (shapeError) {
      setError(shapeError);
      return;
    }

    setBusy(true);
    const result = await settings.saveAddress(market, lines);
    setBusy(false);

    if (result.error) {
      setError(result.error);
      return;
    }
    if (result.value) setText(result.value.lines.join('\n'));
    setSaved(true);
  };

  return (
    <Card className="px-5 py-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-display text-base font-medium text-ink">{block.label}</p>
          <p className="mt-0.5 text-2xs text-ink-tertiary">{block.role}</p>
        </div>
        {stored ?
        block.isDefault ?
        <Pill tone="good">Default</Pill> :
        <Pill tone="neutral">Stored</Pill> :

        <Pill tone="quiet">Not filled in</Pill>
        }
      </div>

      <form onSubmit={handleSubmit} noValidate className="mt-4 space-y-3">
        <label
          htmlFor={fieldId}
          className="block text-[0.8125rem] font-medium text-ink-secondary">

          {block.label} address lines
        </label>
        <textarea
          id={fieldId}
          rows={5}
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            setSaved(false);
          }}
          placeholder={`One line each, three to six lines.\nName\nStreet\nTown and postcode`}
          className="w-full rounded-control border border-paper-line bg-paper px-3 py-2.5 text-sm leading-relaxed text-ink placeholder:text-ink-tertiary focus:border-teal focus:outline-none" />

        <p className="text-2xs leading-relaxed text-ink-tertiary">
          {market === 'EU' ?
          'Used for products sold into the EU or Northern Ireland. It is the responsible person for cosmetics, the economic operator under GPSR, and the importer block on device labels.' :
          'Used for products sold in Great Britain, as supplier and manufacturer.'}
        </p>

        {error && <FormError>{error}</FormError>}
        {saved && <FormStatus>Saved. This block is what {block.label} labels now print.</FormStatus>}

        <Button type="submit" variant="secondary" disabled={busy}>
          {busy ? 'Saving…' : stored ? 'Save changes' : 'Save this block'}
        </Button>
      </form>
    </Card>);

}

/* ------------------------------------------------------------ regulatory */

function RegulatorySection({ settings }: {settings: SettingsValue;}) {
  return (
    <section aria-labelledby="regulatory-heading">
      <SectionTitle className="mb-1">
        <span id="regulatory-heading">Emergency telephone</span>
      </SectionTitle>
      <p className="mb-3 max-w-prose text-2xs leading-relaxed text-ink-tertiary">
        Printed in section 1.4 of every safety data sheet.
      </p>
      <Card className="px-5 py-5">
        <p className="max-w-prose text-[0.8125rem] leading-relaxed text-ink-secondary">
          Every sheet names the national poisons service. Recording a dedicated poisons line of
          your own is not built — there is no column for it and nothing would read one — so
          there is no control here rather than a control that keeps a number nothing prints.
        </p>
        {settings.identity?.telephone &&
        <p className="mt-3 max-w-prose text-2xs leading-relaxed text-ink-tertiary">
            Your supplier telephone number above is a different field. It prints on the label
            under CLP Article 17; this line is the emergency contact in section 1.4.
          </p>
        }
      </Card>
    </section>);

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
 * account_members is still READ ONLY to the browser and `account_invitations` was named as
 * deferred when the domain schema was built. That is not an oversight to work around — a
 * client that could insert an account_members row could hand itself, or somebody else, another
 * account's data. So this tab shows the one real member, from the session, and says what is
 * coming without pretending any of it is here.
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
          {/* THE SECOND SENTENCE USED TO READ "so no sheet has been reviewed or signed", AND
              THAT IS NOW FALSE ON THE NEXT SCREEN ALONG. A maker can record a section of a
              safety data sheet as reviewed from the specification screen — it writes a
              `compliance.sds_section_reviewed` line to their log — so this tab would have been
              denying, in the app's own voice, something the app itself had recorded. Two
              screens contradicting each other about a compliance fact is the exact failure this
              work exists to remove, and it arrived from two branches being written in
              parallel. What is still true, and all this card may now claim, is that no reviewer
              is NAMED (there is no `competent_persons` table) and that Batchlabel signs
              nothing. */}
          <p className="mt-3 max-w-prose text-[0.8125rem] leading-relaxed text-ink-secondary">
            Naming a reviewer is not built yet — there is no table for it — so nothing here
            attaches a person to a sheet. You can record a section as reviewed against a product,
            and that entry goes to your records log under your own account. Batchlabel assembles
            the document and shows its working; it never checks the wording, never signs on
            anybody's behalf, and will not tell you a sheet has been reviewed when it has not.
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

/**
 * THE TWO SELECTS THAT USED TO SIT HERE ARE GONE, AND THAT IS THE FIX.
 *
 * "Default export" and "Default market" were uncontrolled `<Select defaultValue=…>` with no
 * onChange and nowhere to write to; they were then disabled, with a note saying nothing stored
 * them. Both are now removable rather than fixable, and removing is the honest option:
 *
 *   - nothing in this app produces an export at all — both export controls in the artefact
 *     designer are stubs — so a default for one is a preference about a thing that does not
 *     happen;
 *   - a product's market is chosen on its own specification screen, and nothing reads a
 *     workspace default when a product is created. A select that saved a row nothing consults
 *     would still be a control that changes nothing, which is the same defect wearing a
 *     database row.
 *
 * The columns exist in `workspace_preferences` for whoever wires them up. An unread nullable
 * column asserts nothing; a select does.
 */
function PreferencesTab() {
  const { enabledCategories, toggleCategory } = useWorkspace();
  const settings = useSettings();
  const persisting = settings.status === 'ready';
  // Mid-read is its own state and not a failure. The boxes are shown disabled rather than
  // enabled-and-session-only, because a choice made here would be overwritten by the row that
  // is on its way — which is a control that accepts a choice and quietly discards it.
  const reading = settings.status === 'loading';

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

        {reading &&
        <Callout className="mb-3" title="Reading your preferences">
            <p className="max-w-prose leading-relaxed">
              These will be usable in a moment. Changing one now would be overwritten by what we
              are reading, so they are held until it lands.
            </p>
          </Callout>
        }

        {!persisting && !reading &&
        <Callout tone="warn" className="mb-3" title="These are not being saved right now">
            <p className="max-w-prose leading-relaxed">
              {settings.status === 'unconfigured' ?
            'This copy of the app has no database connection.' :
            settings.status === 'no-account' ?
            'We have not resolved which workspace this is.' :
            settings.error ?? 'We could not read your preferences.'}{' '}
              The boxes below still apply for this visit, and will stop applying when you close
              the tab.
            </p>
          </Callout>
        }

        <Card className="divide-y divide-paper-line">
          {CATEGORIES.map((category) =>
          <label
            key={category.id}
            className="flex cursor-pointer flex-wrap items-center gap-4 px-5 py-4">

              <input
              type="checkbox"
              checked={enabledCategories.includes(category.id)}
              disabled={reading}
              onChange={() => toggleCategory(category.id)}
              className="h-4 w-4 flex-none accent-teal disabled:opacity-50" />

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
        <p className="mt-3 max-w-prose text-2xs leading-relaxed text-ink-tertiary">
          The last category cannot be switched off — you would have nothing to create a product
          from.
        </p>
      </section>

      <section aria-labelledby="stock-heading">
        <SectionTitle className="mb-1">
          <span id="stock-heading">Stock presets</span>
        </SectionTitle>
        <p className="mb-3 max-w-prose text-2xs leading-relaxed text-ink-tertiary">
          What the artefact designer offers when you choose a stock. Shipped with the app rather
          than set here, and the same for everybody.
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
        </Card>
      </section>
    </>);

}
