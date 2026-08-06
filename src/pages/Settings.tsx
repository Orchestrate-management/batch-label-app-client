import React, { useState } from 'react';
import { NavLink, useParams } from 'react-router-dom';
import { PageHeader } from '../components/AppShell';
import { AccountTab } from '../components/settings/AccountTab';
import { ReadOnlyNotice } from '../components/ReadOnlyNotice';
import { TeamTab } from '../components/settings/TeamTab';
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
  Skeleton,
  TD,
  TH,
  THead,
  TR,
  Table,
  TableFrame } from
'../components/ui/Primitives';
import { ARTEFACT_LABELS, STOCK } from '../lib/categories';
import { ADDRESS_BLOCKS, type PrintedMarket } from '../lib/identity';
import { useCan } from '../lib/active-account';
import { useEntitlement } from '../lib/entitlement';
import { readSkuCount, skuCountBeside } from '../lib/membership';
import { useProducts } from '../lib/product-store';
import { useSettings, type SettingsValue } from '../lib/settings-store';
import { readAddressLines, type BusinessIdentityInput } from '../lib/settings-data';

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
  'Who can work in this workspace and what each of them may change, the seats your plan allows, and who signs off a safety data sheet before it is issued.'
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
  'The label stock the artefact designer offers. Shipped with the app, and the same for everybody.'
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

      {/*
        THE TAB STRIP IS STICKY AND SITS ON THE SUNKEN BAND.

        Identity and Preferences are both long enough to scroll, and the strip used
        to leave with them — so halfway down Identity there was no visible way back
        to Account without scrolling up. It now holds at the top of the content
        area, under the page header, which is where a tab strip has to be to still
        be a tab strip.

        Wrapped in `overflow-x-auto` with `whitespace-nowrap` rather than
        `flex-wrap`: four tabs wrapped onto two rows at 375px and the second row's
        underline collided with the container border, which read as a rendering
        fault. Scrolling one row is the honest behaviour on a phone.

        The selected tab keeps its 2px teal underline (8.55:1 on this ground) and
        gains a weight change, so it is identifiable without relying on the colour.
      */}
      <div className="sticky top-0 z-10 border-b border-paper-rule bg-paper-sunken/60 px-5 backdrop-blur-sm sm:px-6 lg:px-10">
        <nav
          className="page-shell flex items-center gap-1 overflow-x-auto whitespace-nowrap"
          aria-label="Settings sections">

          {TABS.map((entry) =>
          <NavLink
            key={entry.id}
            to={`/settings/${entry.id}`}
            className={({ isActive }) =>
            `-mb-px shrink-0 border-b-2 px-3.5 py-3 text-sm transition-colors ${
            isActive || entry.id === 'identity' && !tab ?
            'border-teal font-semibold text-ink' :
            'border-transparent text-ink-secondary hover:border-paper-rule hover:text-ink'}`

            }>

              {entry.label}
            </NavLink>
          )}
        </nav>
      </div>

      <div className="page-enter page-shell space-y-8 px-5 py-8 sm:px-6 lg:px-10">
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
      {/* WHAT PRINTS AS THE BUSINESS IS AN ADMIN'S TO CHANGE, NOT AN EDITOR'S, and that is the
          sharpest of the three capability placements the matrix makes. Before roles were
          enforced, a member with role 'viewer' could rewrite `business_identity.registered_name`
          — the legally responsible business named on every label the account produces — and the
          survey measured it doing exactly that. These tables sit at `manage_identity` rather
          than at `write_data` for that reason. */}
      <ReadOnlyNotice capability="manage_identity" title="This is not yours to change" />
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
  const mayEdit = useCan().can('manage_identity');
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

          <Button type="submit" variant="primary" disabled={busy || !mayEdit}>
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
  const mayEdit = useCan().can('manage_identity');
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
          /*
            THE `focus:outline-none` THAT USED TO BE ON THIS LINE IS DELETED, and it
            is the one place in the app that still had it.

            components/ui/Primitives.tsx carries a standing instruction above the
            shared input skin — "NO `focus:outline-none` HERE, AND NOTHING MAY PUT
            IT BACK" — because index.css gives every focusable thing a 2px teal ring
            and opting out leaves a 1px border colour change as the whole focus
            indicator. This textarea is not built from that skin, so it never
            inherited the rule, and it was the only control in the app a keyboard
            user could land on with no visible ring.

            It matters more here than almost anywhere: this box is the supplier
            address block that gets PRINTED ON THE LABEL. The border colour change
            stays as the second signal for a mouse user; the ring is back for
            everyone else.

            Everything else on this line is the shared field skin, so the address
            box now matches the fields above and below it instead of being a third
            of a shade off them.
          */
          className="w-full rounded-control border border-paper-edge bg-paper-raised px-3.5 py-2.5 text-sm leading-relaxed text-ink placeholder:text-ink-tertiary transition-colors hover:border-ink-tertiary focus:border-teal" />

        <p className="text-2xs leading-relaxed text-ink-tertiary">
          {market === 'EU' ?
          'Used for products sold into the EU or Northern Ireland. It is the economic operator under GPSR.' :
          'Used for products sold in Great Britain, as supplier and manufacturer.'}
        </p>

        {error && <FormError>{error}</FormError>}
        {saved && <FormStatus>Saved. This block is what {block.label} labels now print.</FormStatus>}

        <Button type="submit" variant="secondary" disabled={busy || !mayEdit}>
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
  return (
    <>
      <section aria-labelledby="stock-heading">
        <SectionTitle className="mb-1">
          <span id="stock-heading">Stock presets</span>
        </SectionTitle>
        <p className="mb-3 max-w-prose text-2xs leading-relaxed text-ink-tertiary">
          What the artefact designer offers when you choose a stock. Shipped with the app rather
          than set here, and the same for everybody.
        </p>
        {/* Two of these four columns are measurements a maker compares between
            presets when choosing a stock, so they are right aligned onto a common
            edge like every other numeric column in the app. */}
        <TableFrame label="Stock presets">
          <Table minWidth={560}>
            <THead>
              <tr>
                <TH>Preset</TH>
                <TH>Surface</TH>
                <TH align="right">Size</TH>
                <TH align="right">Per sheet</TH>
              </tr>
            </THead>
            <tbody>
              {STOCK.map((stock) =>
              <TR key={stock.id}>
                  <TD className="font-medium text-ink">{stock.name}</TD>
                  <TD>{ARTEFACT_LABELS[stock.artefactType]}</TD>
                  <TD align="right" className="tabular whitespace-nowrap">
                    {stock.widthMm} × {stock.heightMm} mm
                  </TD>
                  <TD align="right" className="tabular whitespace-nowrap">
                    {stock.perSheet} on {stock.sheet}
                  </TD>
                </TR>
              )}
            </tbody>
          </Table>
        </TableFrame>
      </section>
    </>);

}
