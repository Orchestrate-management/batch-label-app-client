import { describeDomainFailure } from './domain-schema';
import { NOT_CONFIGURED_MESSAGE, domainClient } from './domain';
import type { PrintedBusiness, PrintedMarket } from './identity';
import type { CategoryId } from './model';

/**
 * Everything the Settings screen reads and writes.
 *
 * FOUR TABLES, ALL IN THE `batchlabel` SCHEMA, all reached through
 * `supabase.schema('batchlabel')` for the reason products.ts explains: the domain moved out of
 * `public` so a sibling Orchestrate brand can have its own `products` meaning stock, and a
 * client that quietly went back to `public` would read an empty decoy table and report the
 * account as blank. Consent, billing and identity stay in `public` and are not touched here.
 *
 *   business_identity      one row per account. PK is account_id, NO DEFAULT — the id must be
 *                          sent. Only registered_name is NOT NULL; every other column carries
 *                          `check (x is null or btrim(x) <> '')`, so an empty string is
 *                          REFUSED rather than stored. That constraint is the whole reason
 *                          `optional()` below exists: a blank box must become NULL, because
 *                          an empty string prints as a blank line under a heading on a safety
 *                          data sheet.
 *   supplier_addresses     one row per (account_id, market). `lines` is constrained to 3–6
 *                          entries, none blank, because the renderer indexes lines[0] and
 *                          lines[length - 2].
 *   workspace_preferences  one row per account. PK is account_id, no default either.
 *   account_data_requests  INSERT and SELECT only, on purpose. A maker may ask for an export
 *                          or an erasure and may watch the status; they may not set it. So
 *                          the only sentence a screen may render off a successful insert is
 *                          "we have recorded your request".
 *
 * WHAT EVERY WRITE IN HERE DOES THAT MATTERS. It ends in `.select(...)` and checks a row came
 * back. PostgREST answers a write that changed nothing with a 204 and no error, and supabase-js
 * reports that as success — which is how a write refused by an RLS predicate gets shown to a
 * maker as a save. No function here reports a save it did not see the row for.
 */

/* The domain-scoped client and the not-connected sentence both come from lib/domain.ts. */
export { NOT_CONFIGURED_MESSAGE } from './domain';

/**
 * WHY EVERY FUNCTION HERE TAKES AN ACCOUNT ID AND NONE OF THEM DEFAULTS ONE.
 *
 * `business_identity` and `workspace_preferences` key on `account_id` as a PRIMARY KEY with no
 * `current_account_id()` default, so an omitted id is a null violation rather than a sensible
 * fallback. The id to send is the one the entitlement already resolved for this brand, and
 * sending it weakens nothing: the INSERT policy is `with check (public.is_member_of(account_id))`.
 * Not knowing it yet is the caller's state to describe — see `settings-store.tsx` — because it
 * is neither a failure nor an empty account.
 */

const UNKNOWN_SAVE_MESSAGE =
'We could not confirm that saved. Reload the page and check before changing it again.';

export type DataResult<T> =
{ok: true;value: T;} |
{ok: false;message: string;};

function failed(message: string): DataResult<never> {
  return { ok: false, message };
}

/* ------------------------------------------------------------------ shapes */

export interface BusinessIdentityInput {
  registeredName: string;
  tradingName: string;
  telephone: string;
  email: string;
  website: string;
  vatNumber: string;
}

export interface BusinessIdentity extends PrintedBusiness {
  updatedAt: string | null;
}

export interface SupplierAddressRecord {
  id: string;
  market: PrintedMarket;
  lines: string[];
  updatedAt: string | null;
}

export interface WorkspacePreferences {
  enabledCategories: CategoryId[];
  defaultMarket: 'GB' | 'EU' | null;
  defaultExport: string | null;
}

export type DataRequestKind = 'export' | 'erasure';
export type DataRequestStatus = 'requested' | 'in_progress' | 'completed' | 'refused';

export interface DataRequest {
  id: string;
  kind: DataRequestKind;
  status: DataRequestStatus;
  requestedAt: string;
  completedAt: string | null;
  note: string | null;
}

const IDENTITY_COLUMNS =
'account_id, registered_name, trading_name, telephone, email, website, vat_number, updated_at';
const ADDRESS_COLUMNS = 'id, market, lines, updated_at';
const PREFERENCES_COLUMNS = 'account_id, enabled_categories, default_market, default_export';
const REQUEST_COLUMNS = 'id, kind, status, requested_at, completed_at, note';

/* -------------------------------------------------------------- validation */

/**
 * A box the maker left alone becomes NULL, never ''.
 *
 * The table refuses an empty string outright, so this is not politeness — without it a maker
 * who clears their VAT number gets a constraint violation instead of a save. Absent and empty
 * are the same state and the database is the one insisting on it.
 */
export function optional(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * The one thing a browser may refuse locally, because the table refuses it too.
 *
 * Deliberately short. Telephone is NOT required to save — requiring it would stop a maker
 * recording their own business name until they had typed a number, and which absences block a
 * PRINT is the screen's sentence to say, not this function's.
 */
export function validateIdentity(input: BusinessIdentityInput): string | null {
  if (input.registeredName.trim() === '') {
    return 'Please enter your registered business name.';
  }
  return null;
}

/**
 * Address lines, checked against the shape the column actually enforces.
 *
 * 3 to 6 entries and none of them blank — `cardinality(lines) between 3 and 6 and
 * all_lines_present(lines)`. Checked here as well so the maker gets a sentence rather than a
 * Postgres constraint name, and blank lines in the middle are dropped rather than counted,
 * because a textarea collects them by accident every time.
 */
export function readAddressLines(text: string): {lines: string[];error: string | null;} {
  const lines = text.
  split('\n').
  map((line) => line.trim()).
  filter((line) => line !== '');

  if (lines.length < 3) {
    return { lines, error: 'An address block needs at least three lines.' };
  }
  if (lines.length > 6) {
    return { lines, error: 'An address block can hold at most six lines.' };
  }
  return { lines, error: null };
}

/* ------------------------------------------------------------------- reads */

function toIdentity(row: Record<string, unknown>): BusinessIdentity {
  return {
    registeredName: String(row.registered_name ?? ''),
    tradingName: (row.trading_name as string | null) ?? null,
    telephone: (row.telephone as string | null) ?? null,
    email: (row.email as string | null) ?? null,
    website: (row.website as string | null) ?? null,
    vatNumber: (row.vat_number as string | null) ?? null,
    updatedAt: (row.updated_at as string | null) ?? null
  };
}

function toAddress(row: Record<string, unknown>): SupplierAddressRecord {
  return {
    id: String(row.id ?? ''),
    market: row.market as PrintedMarket,
    lines: Array.isArray(row.lines) ? (row.lines as string[]) : [],
    updatedAt: (row.updated_at as string | null) ?? null
  };
}

/**
 * The account's printed identity, or null when it has never been saved.
 *
 * NULL IS NOT AN ERROR AND MUST NOT BE RENDERED AS ONE. A new account has no row, which is
 * exactly the state the bracketed placeholders describe. A read that fails returns `ok: false`
 * with its own sentence, and the two never share one.
 */
export async function fetchBusinessIdentity(
accountId: string)
: Promise<DataResult<BusinessIdentity | null>> {
  const client = domainClient();
  if (!client) return failed(NOT_CONFIGURED_MESSAGE);

  const { data, error } = await client.
  from('business_identity').
  select(IDENTITY_COLUMNS).
  eq('account_id', accountId).
  maybeSingle();

  if (error) {
    return failed(
      'We could not read your printed identity just now. This is us, not you — nothing has been lost.'
    );
  }
  return { ok: true, value: data ? toIdentity(data as Record<string, unknown>) : null };
}

/** The account's stored address blocks. An empty list means none stored, not a failure. */
export async function fetchSupplierAddresses(
accountId: string)
: Promise<DataResult<SupplierAddressRecord[]>> {
  const client = domainClient();
  if (!client) return failed(NOT_CONFIGURED_MESSAGE);

  const { data, error } = await client.
  from('supplier_addresses').
  select(ADDRESS_COLUMNS).
  eq('account_id', accountId).
  order('market', { ascending: true });

  if (error) {
    return failed(
      'We could not read your address blocks just now. This is us, not you — nothing has been lost.'
    );
  }
  return {
    ok: true,
    value: (data ?? []).map((row) => toAddress(row as Record<string, unknown>))
  };
}

/* ------------------------------------------------------------------ writes */

/**
 * Saves the supplier block.
 *
 * An upsert on the primary key, because "have I saved this before" is a question the database
 * can answer and a browser cannot: an insert-then-update dance has a window in which two tabs
 * both decide there is no row.
 *
 * The account id is sent explicitly. It has to be — `business_identity.account_id` is a
 * primary key with no `current_account_id()` default — and sending it weakens nothing, because
 * the INSERT policy is `with check (public.is_member_of(account_id))` and the composite
 * foreign key `(account_id, brand_slug) -> accounts(id, brand_slug)` refuses an id from
 * another brand even to the table owner.
 */
export async function saveBusinessIdentity(
accountId: string,
input: BusinessIdentityInput)
: Promise<DataResult<BusinessIdentity>> {
  const client = domainClient();
  if (!client) return failed(NOT_CONFIGURED_MESSAGE);

  const invalid = validateIdentity(input);
  if (invalid) return failed(invalid);

  const { data, error } = await client.
  from('business_identity').
  upsert(
    {
      account_id: accountId,
      registered_name: input.registeredName.trim(),
      trading_name: optional(input.tradingName),
      telephone: optional(input.telephone),
      email: optional(input.email),
      website: optional(input.website),
      vat_number: optional(input.vatNumber),
      updated_at: new Date().toISOString()
    },
    { onConflict: 'account_id' }
  ).
  select(IDENTITY_COLUMNS).
  maybeSingle();

  if (error) return failed(describeWriteFailure(error));
  // No row back from a write that reported no error is the RLS-refusal shape. Reporting it as
  // a save is the single worst thing this file could do: the maker leaves believing their
  // telephone number is on their labels.
  if (!data) return failed(UNKNOWN_SAVE_MESSAGE);

  return { ok: true, value: toIdentity(data as Record<string, unknown>) };
}

/**
 * Saves one market's address block.
 *
 * `label` and `role` are sent from `ADDRESS_BLOCKS` rather than from the form, because they
 * are what the block MEANS — which block a product prints is decided by its market and this
 * role — and a maker renaming "Responsible person and economic operator" would change where
 * the block prints rather than what it says.
 */
export async function saveSupplierAddress(
accountId: string,
input: {market: PrintedMarket;label: string;role: string;lines: string[];isDefault: boolean;})
: Promise<DataResult<SupplierAddressRecord>> {
  const client = domainClient();
  if (!client) return failed(NOT_CONFIGURED_MESSAGE);

  if (input.lines.length < 3 || input.lines.length > 6) {
    return failed('An address block needs between three and six lines.');
  }
  if (input.lines.some((line) => line.trim() === '')) {
    return failed('An address block cannot contain a blank line.');
  }

  const { data, error } = await client.
  from('supplier_addresses').
  upsert(
    {
      account_id: accountId,
      market: input.market,
      label: input.label,
      role: input.role,
      lines: input.lines,
      is_default: input.isDefault,
      updated_at: new Date().toISOString()
    },
    { onConflict: 'account_id,market' }
  ).
  select(ADDRESS_COLUMNS).
  maybeSingle();

  if (error) return failed(describeWriteFailure(error));
  if (!data) return failed(UNKNOWN_SAVE_MESSAGE);

  return { ok: true, value: toAddress(data as Record<string, unknown>) };
}

/* ------------------------------------------------------------- preferences */

function toPreferences(row: Record<string, unknown>): WorkspacePreferences {
  const raw = Array.isArray(row.enabled_categories) ? (row.enabled_categories as string[]) : [];
  return {
    enabledCategories: raw as CategoryId[],
    defaultMarket: (row.default_market as 'GB' | 'EU' | null) ?? null,
    defaultExport: (row.default_export as string | null) ?? null
  };
}

/** Null means no row: this account has never changed a preference. Not a failure. */
export async function fetchWorkspacePreferences(
accountId: string)
: Promise<DataResult<WorkspacePreferences | null>> {
  const client = domainClient();
  if (!client) return failed(NOT_CONFIGURED_MESSAGE);

  const { data, error } = await client.
  from('workspace_preferences').
  select(PREFERENCES_COLUMNS).
  eq('account_id', accountId).
  maybeSingle();

  if (error) {
    return failed('We could not read your preferences just now. This is us, not you.');
  }
  return { ok: true, value: data ? toPreferences(data as Record<string, unknown>) : null };
}

/**
 * Saves the whole preferences row.
 *
 * Whole rather than patched, because an upsert with a missing column would reset it to the
 * column default on first write — and `enabled_categories` defaults to home-fragrance alone,
 * so a maker saving a default market would silently lose two categories.
 *
 * `enabled_categories` may not be empty: the column is `check (cardinality(...) > 0)`, and the
 * reason is that an empty list is indistinguishable from "never set" on the read side while
 * meaning the opposite on the create-product screen.
 */
export async function saveWorkspacePreferences(
accountId: string,
input: WorkspacePreferences)
: Promise<DataResult<WorkspacePreferences>> {
  const client = domainClient();
  if (!client) return failed(NOT_CONFIGURED_MESSAGE);

  if (input.enabledCategories.length === 0) {
    return failed('Leave at least one category switched on — you cannot create a product without one.');
  }

  const { data, error } = await client.
  from('workspace_preferences').
  upsert(
    {
      account_id: accountId,
      enabled_categories: input.enabledCategories,
      default_market: input.defaultMarket,
      default_export: input.defaultExport,
      updated_at: new Date().toISOString()
    },
    { onConflict: 'account_id' }
  ).
  select(PREFERENCES_COLUMNS).
  maybeSingle();

  if (error) return failed(describeWriteFailure(error));
  if (!data) return failed(UNKNOWN_SAVE_MESSAGE);

  return { ok: true, value: toPreferences(data as Record<string, unknown>) };
}

/* ----------------------------------------------------------- data requests */

function toRequest(row: Record<string, unknown>): DataRequest {
  return {
    id: String(row.id ?? ''),
    kind: row.kind as DataRequestKind,
    status: row.status as DataRequestStatus,
    requestedAt: String(row.requested_at ?? ''),
    completedAt: (row.completed_at as string | null) ?? null,
    note: (row.note as string | null) ?? null
  };
}

export async function fetchDataRequests(
accountId: string)
: Promise<DataResult<DataRequest[]>> {
  const client = domainClient();
  if (!client) return failed(NOT_CONFIGURED_MESSAGE);

  const { data, error } = await client.
  from('account_data_requests').
  select(REQUEST_COLUMNS).
  eq('account_id', accountId).
  order('requested_at', { ascending: false });

  if (error) {
    return failed('We could not read your requests just now. This is us, not you.');
  }
  return { ok: true, value: (data ?? []).map((row) => toRequest(row as Record<string, unknown>)) };
}

/**
 * Records a request for an export or an erasure. IT DOES NOT PERFORM ONE.
 *
 * The grant is the design: `authenticated` holds INSERT and SELECT on this table and nothing
 * else, so a maker cannot mark their own erasure complete, and this app holds no route that
 * could delete an account even if somebody wired a button to it. That is deliberate — a
 * browser session must not be able to destroy an account — and it means the only honest thing
 * the screen may say off a successful insert is that the request is recorded.
 */
export async function createDataRequest(
accountId: string,
kind: DataRequestKind)
: Promise<DataResult<DataRequest>> {
  const client = domainClient();
  if (!client) return failed(NOT_CONFIGURED_MESSAGE);

  const { data, error } = await client.
  from('account_data_requests').
  insert({ account_id: accountId, kind }).
  select(REQUEST_COLUMNS).
  maybeSingle();

  if (error) return failed(describeWriteFailure(error));
  if (!data) {
    return failed(
      'We could not confirm that your request was recorded. Please email hello@batchlabel.xyz so it is not lost.'
    );
  }
  return { ok: true, value: toRequest(data as Record<string, unknown>) };
}

/* ------------------------------------------------------------ error voice */

type Postgrestish = {code?: string | null;message?: string | null;};

/**
 * A Postgres failure, said out loud.
 *
 * Named constraints get their own sentence because the maker can act on them; everything else
 * gets one that admits we do not know, rather than guessing at a cause. What none of them do
 * is repeat the Postgres message — "new row for relation \"business_identity\" violates check
 * constraint \"business_identity_blank_check\"" tells a candle maker nothing at all.
 */
export function describeWriteFailure(error: Postgrestish | null): string {
  const message = error?.message ?? '';

  if (message.includes('business_identity_name_check')) {
    return 'Please enter your registered business name.';
  }
  if (message.includes('business_identity_blank_check')) {
    return 'One of those boxes holds only spaces. Clear it, or fill it in.';
  }
  if (message.includes('supplier_addresses_lines_check')) {
    return 'An address block needs between three and six lines, none of them blank.';
  }
  if (message.includes('workspace_preferences_categories_check')) {
    return 'Leave at least one category switched on.';
  }
  if (error?.code === '42501' || message.includes('row-level security')) {
    return 'This account did not accept that change. Reload the page and try again.';
  }
  // The last branch, and the one case where "just now" and "please try again" are both false.
  // PostgREST refusing the whole schema (PGRST106) is not a moment passing — it is every
  // request in the app, permanently, until somebody changes a project setting. See
  // lib/domain-schema.ts, which is what NOTICES; this is only the sentence, and it matters
  // here because a Save button is sitting right beside it inviting the retry.
  return describeDomainFailure(error, 'We could not save that just now. Please try again.');
}
