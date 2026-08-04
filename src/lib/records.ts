import { supabase } from './supabase';
import { ArtefactType } from './model';

/**
 * THE LOG. What happened, and when.
 *
 * WHAT THIS REPLACES. `src/pages/Records.tsx` was an 82-line shell saying "Not built yet",
 * and before that it was ten invented production runs by three people who do not exist, with
 * a recall search sitting on top of them. That header is worth keeping in mind while reading
 * this file, because it names the failure this module has to not repeat:
 *
 *   "A recall search is the most consequential screen in this application… It answered from
 *   an array of invented runs, which means it could return 'no run used a lot or serial
 *   matching that' to a real maker searching a real lot number — a false negative, on a
 *   recall, rendered as a confident sentence."
 *
 * So every recall answer in this file carries `totalBatchRecords` beside it, counted by the
 * database over the same rows the search ran against. "Nothing matched" and "there was
 * nothing to match against" are different sentences and the screen is given what it needs to
 * tell them apart. That is the single most important line in this module.
 *
 * ONE TABLE, A TYPED KIND, APPEND-ONLY. `batchlabel.record_events` spans batch production,
 * label print and export, and compliance events. It is append-only twice over — `authenticated`
 * is granted SELECT and INSERT and nothing else, and a BEFORE UPDATE OR DELETE trigger
 * refuses any session carrying a JWT. There is therefore no `updateRecordEvent` here and
 * there must never be one: a wrong entry is corrected by writing another entry, which is what
 * a log is. Read the header of
 * supabase/migrations/20260804130000_materials_records_identity.sql (in the www repo); it is
 * the interface this file is written against.
 *
 * occurred_at AND recorded_at ARE BOTH READ AND THEY ARE NOT THE SAME. occurred_at is when the
 * units were made — a maker writes up Tuesday's batch on Friday — and recorded_at is when we
 * learned of it, set by the database. The screen shows the second only when it differs from
 * the first by more than a working day, because a log that silently reported Friday as the
 * production date would be wrong about the one field a recall works backwards from.
 *
 * WHAT DOES NOT GENERATE A LABEL. Batchlabel does not produce artwork yet — the app-server
 * generation functions are not written and both export controls in the artefact designer say
 * so. `batchlabel.artefacts.is_placeholder` DEFAULTS TO TRUE for exactly that reason, and
 * `recordArtefactVersion` below sets it to true explicitly rather than letting the default
 * carry it, so that the claim is made in code where it can be read. Every screen that renders
 * one of these rows must say what it is: a record that the maker applied a version of THEIR
 * label, stamped with a fingerprint of what the composition was at the time. It is not a file
 * we made. `storage_path` is left null, which is the storage-layer statement of the same fact.
 *
 * THE DIMENSIONS ARE NOT STORED, AND THAT IS DELIBERATE. `width_mm` and `height_mm` are
 * nullable on the table and this file never sends them. The only numbers available to send are
 * `artefactsFor`'s in lib/products.ts — 52 × 74 and friends — which are shipped constants, not
 * measurements of anybody's label. A number on a compliance record that came from a constant
 * is the exact defect class this codebase keeps finding, so the columns stay null until
 * something measures them.
 */

/* ------------------------------------------------------------------ types */

/**
 * The kinds the database will accept, and nothing else.
 *
 * Kept in the same order as `record_events_kind_check` so the two lists can be diffed by eye.
 * A kind that is not in the CHECK is a 23514 at insert time, so this union is the app's half
 * of a constraint rather than a convenience.
 */
export const RECORD_EVENT_KINDS = [
'batch.produced',
'artefact.produced',
'artefact.printed',
'artefact.exported',
'compliance.ufi_assigned',
'compliance.pcn_submitted',
'compliance.npis_submitted',
'compliance.declaration_signed',
'compliance.sds_section_reviewed',
'compliance.evidence_recorded',
'material.version_adopted',
'identity.updated',
'note'] as const;

export type RecordEventKind = (typeof RECORD_EVENT_KINDS)[number];

/** The four headings the log is filtered by. Not stored — derived from the kind. */
export type RecordEventGroup = 'production' | 'outputs' | 'compliance' | 'other';

export const EVENT_GROUP: Record<RecordEventKind, RecordEventGroup> = {
  'batch.produced': 'production',
  'artefact.produced': 'outputs',
  'artefact.printed': 'outputs',
  'artefact.exported': 'outputs',
  'compliance.ufi_assigned': 'compliance',
  'compliance.pcn_submitted': 'compliance',
  'compliance.npis_submitted': 'compliance',
  'compliance.declaration_signed': 'compliance',
  'compliance.sds_section_reviewed': 'compliance',
  'compliance.evidence_recorded': 'compliance',
  'material.version_adopted': 'other',
  'identity.updated': 'other',
  note: 'other'
};

/** What each kind is called on screen. One source, so a filter and a row cannot disagree. */
export const EVENT_LABELS: Record<RecordEventKind, string> = {
  'batch.produced': 'Batch produced',
  'artefact.produced': 'Label version recorded',
  'artefact.printed': 'Label printed',
  'artefact.exported': 'Label exported',
  'compliance.ufi_assigned': 'UFI assigned',
  'compliance.pcn_submitted': 'Poison centre notification',
  'compliance.npis_submitted': 'NPIS notification',
  'compliance.declaration_signed': 'Declaration signed',
  'compliance.sds_section_reviewed': 'Safety data sheet section reviewed',
  'compliance.evidence_recorded': 'Evidence recorded',
  'material.version_adopted': 'Material version adopted',
  'identity.updated': 'Business identity changed',
  note: 'Note'
};

export const GROUP_LABELS: Record<RecordEventGroup, string> = {
  production: 'Production',
  outputs: 'Outputs',
  compliance: 'Compliance',
  other: 'Everything else'
};

export function isRecordEventKind(value: unknown): value is RecordEventKind {
  return RECORD_EVENT_KINDS.includes(value as RecordEventKind);
}

/** A traceable supplier lot consumed by one production run. */
export type RecordLot = {
  id: string;
  /** The maker's own material row, when the lot was recorded against one. */
  materialId: string | null;
  /** The material as written down, for anything not yet a row. Never both blank. */
  materialRef: string;
  lot: string;
  quantity: number | null;
  unit: string;
};

/** One label version, as recorded. See the header: this is not a file we generated. */
export type ProducedArtefact = {
  id: string;
  productId: string;
  artefactType: ArtefactType;
  version: number;
  producedAt: string;
  printedAt: string | null;
  /** What `artefact_source_fingerprint` returned when this version was recorded. */
  specificationHash: string;
  /** True when nothing generated a file behind this row. True for everything today. */
  isPlaceholder: boolean;
  notes: string;
};

export type RecordEvent = {
  id: string;
  kind: RecordEventKind;
  /** When it happened. What a recall works backwards from. */
  occurredAt: string;
  /** When we learned of it. Set by the database, never by this app. */
  recordedAt: string;
  productId: string | null;
  specificationId: string | null;
  artefactId: string | null;
  materialId: string | null;
  batchCode: string;
  units: number | null;
  identityKind: 'batch' | 'serial-range' | null;
  serialFrom: string;
  serialTo: string;
  obligationId: string;
  reference: string;
  summary: string;
  detail: Record<string, unknown>;
  /** Joined, not embedded. See `fetchRecordLog`. */
  lots: RecordLot[];
  /** The label versions applied to this run, joined through record_event_artefacts. */
  artefacts: ProducedArtefact[];
};

/* ------------------------------------------------------- results and copy */

export type RecordFailure =
'not_configured' |
'no_account' |
'account_ambiguous' |
'refused' |
'invalid' |
'partial_save' |
'unknown' |
'failed';

export type RecordWriteResult<T> =
{ok: true;value: T;} |
{ok: false;reason: RecordFailure;message: string;};

export type LogReadResult =
{ok: true;events: RecordEvent[];/** True when the read stopped at the page limit. */truncated: boolean;} |
{ok: false;message: string;};

export type ArtefactReadResult =
{ok: true;artefacts: ProducedArtefact[];} |
{ok: false;message: string;};

/**
 * A recall answer, and the number that stops it being a false negative.
 *
 * `totalBatchRecords` is counted by the database over the whole log, not over the matches.
 * An empty `matches` with a total of nought means the account has recorded no batches at all;
 * an empty `matches` with a total of forty means forty batches were searched and none used
 * this lot. Those are opposite instructions to give somebody on the morning of a recall, and
 * the screen may not merge them into one sentence.
 */
export type RecallResult =
{ok: true;matches: RecordEvent[];totalBatchRecords: number;} |
{ok: false;message: string;};

const NOT_CONFIGURED_MESSAGE =
'This app is not connected to its database, so nothing can be saved. This is us, not you.';

const NO_ACCOUNT_READ_MESSAGE =
'We could not tell which account this workspace belongs to, so the log is showing nothing ' +
'rather than the wrong account’s. Nothing has been lost.';

const READ_FAILURE_MESSAGE =
'We could not read your records just now. This is us, not you — nothing has been lost, ' +
'and nothing below has been filled in from a guess.';

const RECALL_FAILURE_MESSAGE =
'The search did not run, so this is not an answer — it is a failure. Do not read it as ' +
'"nothing matched". Try again, and if it keeps failing get in touch before you act on it.';

/**
 * Said when the database refused the write, with no diagnosis attached.
 *
 * Same shape and same reasoning as lib/products.ts POLICY_REFUSAL_MESSAGE: a 42501 is what a
 * cross-account attempt, a suspended membership and a null account all arrive as, it names
 * none of them on purpose, and dressing it up as one of the three would be a guess. No retry
 * is offered because whatever put the row out of reach is still true a second later.
 */
const REFUSED_MESSAGE =
'That was refused, so nothing has been written to your log and nothing has changed. Waiting ' +
'will not clear it and trying again will not either — get in touch and we will tell you why.';

const NO_ACCOUNT_WRITE_MESSAGE =
'There is no account to write this into yet — your signup was not finished, so nothing has ' +
'been recorded. Finish setting up your account and this will work.';

const ACCOUNT_AMBIGUOUS_MESSAGE =
'You are a member of more than one account, and this screen cannot yet ask you which one this ' +
'belongs to — so nothing has been recorded, and trying again will not change that. Get in ' +
'touch and we will point this workspace at the right account.';

const GENERIC_WRITE_FAILURE =
'We could not write that to your log just now. Nothing has been recorded — please try again ' +
'in a moment.';

/**
 * Said when we do not know whether the entry landed.
 *
 * The log is append-only, so the ordinary repair — write it, check, delete the duplicate — is
 * not available from a browser that holds no DELETE. A blind retry therefore risks two entries
 * for one batch, which on a recall means double-counting units. So the advice is to look
 * first, exactly as lib/products.ts gives for a lost create.
 */
const UNKNOWN_OUTCOME_MESSAGE =
'We lost the connection before the database told us whether that was recorded, so we do not ' +
'know whether it was. Check your log before recording it again — entries cannot be deleted, ' +
'so a second attempt would leave two.';

/**
 * Said when the label version was written and its log entry was not.
 *
 * Never "nothing has changed": something did. The version row exists, is visible, and can be
 * attached to a batch record; only the chronological line is missing, and the log cannot be
 * repaired by rewriting because it is append-only. The honest instruction is therefore to
 * record a note rather than to press the same button again.
 */
const ARTEFACT_PARTIAL_MESSAGE =
'The label version was saved, but its entry in the log was not, so the version exists and the ' +
'log does not mention it. Nothing here can be rewritten — recording the version again would ' +
'create a second one, so add a note to the log instead if you need the date on the record.';

const NO_FINGERPRINT_MESSAGE =
'We could not read what this product’s label would be produced from, so there is nothing ' +
'honest to stamp this version with and nothing has been saved. A version recorded without it ' +
'could never be told apart from a later one.';

/* --------------------------------------------------------- error mapping */

/** The hints public.require_account_id() raises. Same two tokens lib/products.ts matches. */
const ACCOUNT_MISSING_HINT = 'account_missing';
const ACCOUNT_AMBIGUOUS_HINT = 'account_ambiguous';
/** The hint batchlabel.refuse_record_rewrite() raises. Unreachable on an INSERT; see below. */
const APPEND_ONLY_HINT = 'record_append_only';

const POLICY_REFUSAL = '42501';
const CHECK_VIOLATION = '23514';
const NOT_NULL_VIOLATION = '23502';
const FOREIGN_KEY_VIOLATION = '23503';

type Postgrestish = {code?: string | null;hint?: string | null;message?: string | null;};

/**
 * Classifies a write failure into something the batch form can say out loud.
 *
 * HINTS BEFORE CODES, for the reason lib/products.ts gives: the hints are tokens the database
 * raises on purpose and every code here is shared with something else.
 *
 * THE CONSTRAINT VIOLATIONS GET THEIR OWN REASON AND IT IS NOT "try again". A 23514 on this
 * table means a blank batch code, a blank summary, units at or below nought, or a serial range
 * missing an end — every one of them a property of what was typed, so a retry with the same
 * form fails identically. `invalid` tells the screen to put the maker back in the form rather
 * than offering a button that cannot work. The form validates all four before it submits, so
 * reaching this is a bug in the form; the message says so rather than blaming the maker.
 *
 * 23503 is here for one case: a product id, or an artefact id, that is not this account's or
 * no longer exists. It is a refusal, and it is reported as one.
 *
 * `record_append_only` cannot fire on an INSERT — the trigger is BEFORE UPDATE OR DELETE — and
 * is matched anyway, because the alternative is that the day somebody adds an update path the
 * failure arrives as "please try again in a moment" on a statement no retry can change.
 */
export function classifyRecordError(error: Postgrestish | null)
: {
  reason: RecordFailure;
  message: string;
} {
  const hint = error?.hint ?? '';
  const code = error?.code ?? '';

  if (hint === ACCOUNT_MISSING_HINT) {
    return { reason: 'no_account', message: NO_ACCOUNT_WRITE_MESSAGE };
  }
  if (hint === ACCOUNT_AMBIGUOUS_HINT) {
    return { reason: 'account_ambiguous', message: ACCOUNT_AMBIGUOUS_MESSAGE };
  }
  if (hint === APPEND_ONLY_HINT) {
    return {
      reason: 'refused',
      message:
      'The log cannot be changed once it is written. Nothing has been altered — correct it ' +
      'by adding another entry, which is what a log is for.'
    };
  }
  if (code === CHECK_VIOLATION || code === NOT_NULL_VIOLATION) {
    return {
      reason: 'invalid',
      message:
      'The database would not accept that entry, so nothing has been recorded. A batch record ' +
      'needs a batch code and a description, and any unit count has to be more than nought. ' +
      'This form should have caught that before asking the database — tell us if you cannot ' +
      'get past it.'
    };
  }
  if (code === FOREIGN_KEY_VIOLATION || code === POLICY_REFUSAL) {
    return { reason: 'refused', message: REFUSED_MESSAGE };
  }
  return { reason: 'failed', message: GENERIC_WRITE_FAILURE };
}

/**
 * Whether the database definitely refused, as opposed to the answer being lost in transit.
 *
 * Same decision, and the same stakes, as `isDefiniteRefusal` in lib/products.ts: a transport
 * failure carries no Postgres code, and MUST NOT be reported as "nothing was recorded",
 * because the statement it lost the answer to may well have committed. On an append-only
 * table that difference decides whether the honest advice is "try again" or "look first".
 */
function isDefiniteRefusal(error: Postgrestish | null): boolean {
  if (!error) return false;
  if ([ACCOUNT_MISSING_HINT, ACCOUNT_AMBIGUOUS_HINT, APPEND_ONLY_HINT].includes(error.hint ?? '')) {
    return true;
  }
  return [
  CHECK_VIOLATION,
  NOT_NULL_VIOLATION,
  FOREIGN_KEY_VIOLATION,
  POLICY_REFUSAL,
  '23505'].
  includes(error.code ?? '');
}

/* -------------------------------------------------------------- plumbing */

/**
 * The Postgres schema holding the Batchlabel domain.
 *
 * Duplicated from lib/products.ts rather than imported, and it is the same constant for the
 * same reason: the domain tables live in `batchlabel` so a sibling Orchestrate brand can have
 * its own `products` meaning stock. A client that quietly went back to `public` would read a
 * table that is not there and report an empty log, which on this screen is a false negative on
 * a recall.
 */
const DOMAIN_SCHEMA = 'batchlabel';

const domainClient = () => (supabase ? supabase.schema(DOMAIN_SCHEMA) : null);

const EVENT_COLUMNS =
'id, kind, occurred_at, recorded_at, product_id, specification_id, artefact_id, material_id, ' +
'batch_code, units, identity_kind, serial_from, serial_to, obligation_id, reference, summary, detail';

const LOT_COLUMNS = 'id, record_event_id, material_id, material_ref, lot, quantity, unit';

const ARTEFACT_COLUMNS =
'id, product_id, artefact_type, version, produced_at, printed_at, specification_hash, ' +
'is_placeholder, notes';

/**
 * How many entries one read returns.
 *
 * A page rather than everything, because a maker who has been running for two years has
 * thousands and none of them are on screen at once.
 *
 * ONE MORE ROW IS ASKED FOR THAN IS RETURNED, and that extra row is the whole point. Reporting
 * `truncated` from `rows.length === LOG_PAGE` would tell an account holding EXACTLY 200 entries
 * that there are more below them, which is a claim about their data that nothing established —
 * the same defect in miniature that this whole screen exists to stop making. Asking for 201 and
 * showing 200 makes it a fact instead.
 *
 * The recall searches below do NOT page at all. They are filtered by the database and answer
 * over the whole log, which is the only way a recall answer is worth anything.
 */
const LOG_PAGE = 200;

/* -------------------------------------------------------------- coercion */

/** Tolerant, for the reason lib/products.ts is: a bad row must not throw inside a render. */
function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' && value.trim() !== '' ? value : fallback;
}

function nullableStr(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

function intOrNull(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

const KNOWN_ARTEFACT_TYPES: ArtefactType[] = [
'unit-label',
'carton',
'leaflet',
'listing',
'rating-plate',
'sds'];


function artefactType(value: unknown): ArtefactType {
  return KNOWN_ARTEFACT_TYPES.includes(value as ArtefactType) ?
  value as ArtefactType :
  'unit-label';
}

type EventRow = Record<string, unknown>;

/**
 * A row as the screen wants it.
 *
 * A row whose `kind` this build has never heard of is NOT dropped and NOT relabelled. It is
 * mapped to `note`, which is the kind whose whole content is its summary — and the summary is
 * NOT NULL and non-blank in the database, so the line stays readable. Dropping it would remove
 * an entry from a compliance log because a newer deploy wrote a kind an older tab does not
 * know, and a log with silent holes in it is not a log.
 */
function toEvent(row: EventRow, lots: RecordLot[], artefacts: ProducedArtefact[]): RecordEvent {
  const kind = isRecordEventKind(row.kind) ? row.kind : 'note';
  const identity = row.identity_kind;
  return {
    id: String(row.id),
    kind,
    occurredAt: str(row.occurred_at),
    recordedAt: str(row.recorded_at),
    productId: nullableStr(row.product_id),
    specificationId: nullableStr(row.specification_id),
    artefactId: nullableStr(row.artefact_id),
    materialId: nullableStr(row.material_id),
    batchCode: str(row.batch_code),
    units: intOrNull(row.units),
    identityKind: identity === 'batch' || identity === 'serial-range' ? identity : null,
    serialFrom: str(row.serial_from),
    serialTo: str(row.serial_to),
    obligationId: str(row.obligation_id),
    reference: str(row.reference),
    summary: str(row.summary, 'This entry has no description.'),
    detail: row.detail && typeof row.detail === 'object' ? row.detail as Record<string, unknown> : {},
    lots,
    artefacts
  };
}

function toLot(row: Record<string, unknown>): RecordLot {
  return {
    id: String(row.id),
    materialId: nullableStr(row.material_id),
    materialRef: str(row.material_ref),
    lot: str(row.lot),
    quantity: intOrNull(row.quantity),
    unit: str(row.unit)
  };
}

function toArtefact(row: Record<string, unknown>): ProducedArtefact {
  return {
    id: String(row.id),
    productId: str(row.product_id),
    artefactType: artefactType(row.artefact_type),
    version: intOrNull(row.version) ?? 1,
    producedAt: str(row.produced_at),
    printedAt: nullableStr(row.printed_at),
    specificationHash: str(row.specification_hash),
    // Absent, or anything other than an explicit false, is read as a placeholder. The column
    // is NOT NULL DEFAULT true; erring toward "we did not generate this" is the direction that
    // cannot make a false claim about a compliance document.
    isPlaceholder: row.is_placeholder !== false,
    notes: str(row.notes)
  };
}

/* ------------------------------------------------------------------ read */

export type LogFilter = {
  /** Restrict to one heading. Absent means every kind. */
  group?: RecordEventGroup;
  /** Restrict to one product. Absent means the whole account. */
  productId?: string;
  /** Restrict to one batch code, exactly and case-insensitively. */
  batchCode?: string;
};

/**
 * The account's log, newest first, with its lots and its label versions attached.
 *
 * FOUR READS, NOT AN EMBEDDED SELECT, and it is the same argument lib/products.ts makes about
 * products and specifications: every foreign key from the child tables back to `record_events`
 * is COMPOSITE — `(record_event_id, account_id)` references `(id, account_id)`, which is what
 * makes it impossible to hang a lot off another account's batch — and relying on PostgREST's
 * relationship detection over a composite key would put the compliance log behind a join
 * heuristic. Four round trips at a maker's volume is nothing.
 *
 * The account is filtered here as well as by RLS, for the reason item 6 of the account_id
 * contract gives: `is_member_of` returns every account the caller belongs to, which is not the
 * same as the account whose workspace this screen is rendering. A null id is refused outright
 * rather than falling back to an unfiltered read.
 */
export async function fetchRecordLog(
accountId: string | null,
filter: LogFilter = {})
: Promise<LogReadResult> {
  const client = domainClient();
  if (!client) return { ok: false, message: NOT_CONFIGURED_MESSAGE };
  if (!accountId) return { ok: false, message: NO_ACCOUNT_READ_MESSAGE };

  let query = client.
  from('record_events').
  select(EVENT_COLUMNS).
  eq('account_id', accountId).
  order('occurred_at', { ascending: false }).
  order('recorded_at', { ascending: false }).
  limit(LOG_PAGE + 1);

  if (filter.group) {
    const kinds = RECORD_EVENT_KINDS.filter((kind) => EVENT_GROUP[kind] === filter.group);
    query = query.in('kind', kinds);
  }
  if (filter.productId) query = query.eq('product_id', filter.productId);
  // `ilike` with no wildcard is an exact, case-insensitive match. A maker who writes BF-2026
  // on the tin and types bf-2026 into the box is looking for the same batch.
  if (filter.batchCode) query = query.ilike('batch_code', filter.batchCode);

  const { data, error } = await query;
  if (error) return { ok: false, message: READ_FAILURE_MESSAGE };

  const returned = (data ?? []) as unknown as EventRow[];
  const truncated = returned.length > LOG_PAGE;
  const rows = truncated ? returned.slice(0, LOG_PAGE) : returned;
  const children = await fetchChildren(accountId, rows.map((row) => String(row.id)));
  if (!children.ok) return { ok: false, message: children.message };

  return {
    ok: true,
    events: rows.map((row) =>
    toEvent(row, children.lots.get(String(row.id)) ?? [], children.artefacts.get(String(row.id)) ?? [])
    ),
    truncated
  };
}

type Children =
{ok: true;lots: Map<string, RecordLot[]>;artefacts: Map<string, ProducedArtefact[]>;} |
{ok: false;message: string;};

/**
 * The lots and the label versions belonging to a page of events.
 *
 * A FAILURE HERE FAILS THE WHOLE READ, and returning the events without them would be worse
 * than returning nothing. A batch record rendered with an empty lot list does not look
 * broken — it looks like a batch that was recorded without lots, which is a different and
 * perfectly ordinary thing — so a dropped request would quietly turn a traceable run into an
 * untraceable one on screen. The same argument covers the label versions: they are the recall
 * join, and a batch that appears to carry no label version is a batch a recall will not find.
 */
async function fetchChildren(accountId: string, eventIds: string[]): Promise<Children> {
  const empty: Children = { ok: true, lots: new Map(), artefacts: new Map() };
  if (eventIds.length === 0) return empty;

  const client = domainClient();
  if (!client) return { ok: false, message: NOT_CONFIGURED_MESSAGE };

  const [lotsResponse, linksResponse] = await Promise.all([
  client.from('record_event_lots').select(LOT_COLUMNS).eq('account_id', accountId).in('record_event_id', eventIds),
  client.from('record_event_artefacts').select('record_event_id, artefact_id').eq('account_id', accountId).in('record_event_id', eventIds)]
  );

  if (lotsResponse.error || linksResponse.error) return { ok: false, message: READ_FAILURE_MESSAGE };

  const lots = new Map<string, RecordLot[]>();
  for (const row of (lotsResponse.data ?? []) as unknown as Array<Record<string, unknown>>) {
    const key = String(row.record_event_id);
    const list = lots.get(key) ?? [];
    list.push(toLot(row));
    lots.set(key, list);
  }

  const links = (linksResponse.data ?? []) as unknown as Array<Record<string, unknown>>;
  const artefactIds = Array.from(new Set(links.map((row) => String(row.artefact_id))));

  const artefacts = new Map<string, ProducedArtefact[]>();
  if (artefactIds.length === 0) return { ok: true, lots, artefacts };

  const { data: artefactRows, error: artefactError } = await client.
  from('artefacts').
  select(ARTEFACT_COLUMNS).
  eq('account_id', accountId).
  in('id', artefactIds);

  if (artefactError) return { ok: false, message: READ_FAILURE_MESSAGE };

  const byId = new Map<string, ProducedArtefact>();
  for (const row of (artefactRows ?? []) as unknown as Array<Record<string, unknown>>) {
    byId.set(String(row.id), toArtefact(row));
  }
  for (const link of links) {
    const artefact = byId.get(String(link.artefact_id));
    if (!artefact) continue;
    const key = String(link.record_event_id);
    const list = artefacts.get(key) ?? [];
    list.push(artefact);
    artefacts.set(key, list);
  }

  return { ok: true, lots, artefacts };
}

/** Every label version recorded against one product, newest first. */
export async function fetchProducedArtefacts(
accountId: string | null,
productId: string)
: Promise<ArtefactReadResult> {
  const client = domainClient();
  if (!client) return { ok: false, message: NOT_CONFIGURED_MESSAGE };
  if (!accountId) return { ok: false, message: NO_ACCOUNT_READ_MESSAGE };

  const { data, error } = await client.
  from('artefacts').
  select(ARTEFACT_COLUMNS).
  eq('account_id', accountId).
  eq('product_id', productId).
  order('produced_at', { ascending: false });

  if (error) return { ok: false, message: READ_FAILURE_MESSAGE };
  return {
    ok: true,
    artefacts: ((data ?? []) as unknown as Array<Record<string, unknown>>).map(toArtefact)
  };
}

/**
 * What this product's label would be produced from, right now.
 *
 * Compare it with a recorded version's `specificationHash` and the answer is a fact rather
 * than a guess: equal means nothing that prints has moved since; different means the
 * composition, the pack, the pinned materials or the printed business identity has. Null means
 * we could not read it, and null must never be rendered as either answer — see
 * `artefactCurrency` below, which is the only thing allowed to turn this into a sentence.
 */
export async function currentSourceFingerprint(productId: string): Promise<string | null> {
  const client = domainClient();
  if (!client) return null;
  const { data, error } = await client.rpc('artefact_source_fingerprint', {
    p_product_id: productId
  });
  if (error) return null;
  return typeof data === 'string' && data.trim() !== '' ? data : null;
}

/**
 * Three answers, and the third is not a hedge.
 *
 * 'unknown' is what a failed fingerprint read produces, and the screen has to say so rather
 * than defaulting to either of the other two. "Still matches" on a read that did not happen is
 * a compliance claim nothing checked; "out of date" on the same read sends a maker to reprint
 * stock that was fine.
 */
export function artefactCurrency(
artefact: ProducedArtefact,
currentHash: string | null)
: 'current' | 'superseded' | 'unknown' {
  if (!currentHash || !artefact.specificationHash) return 'unknown';
  return artefact.specificationHash === currentHash ? 'current' : 'superseded';
}

/* ---------------------------------------------------------------- recall */

/**
 * How many batch records the account holds. The denominator of every recall answer.
 *
 * A HEAD request with an exact count: no rows come back, only the number, and the number is
 * counted by the database over the same table the search runs against rather than by counting
 * a list the client happens to be holding.
 */
async function countBatchRecords(accountId: string): Promise<number | null> {
  const client = domainClient();
  if (!client) return null;
  const { count, error } = await client.
  from('record_events').
  select('id', { count: 'exact', head: true }).
  eq('account_id', accountId).
  eq('kind', 'batch.produced');
  if (error) return null;
  return typeof count === 'number' ? count : null;
}

/**
 * THE RECALL ANSWER. Which batches carry the label version you have just found wrong.
 *
 * One join, exactly as the migration's header sets it out: record_event_artefacts names the
 * artefact, the event it belongs to is the production run, and the batch code and date come
 * off that. It searches the whole log rather than a page of it, and it counts the batches it
 * searched, because "none of your forty batches used this version" and "you have no batch
 * records" are the two answers this screen exists to keep apart.
 */
export async function recallByArtefact(
accountId: string | null,
artefactId: string)
: Promise<RecallResult> {
  const client = domainClient();
  if (!client) return { ok: false, message: NOT_CONFIGURED_MESSAGE };
  if (!accountId) return { ok: false, message: NO_ACCOUNT_READ_MESSAGE };

  const { data, error } = await client.
  from('record_event_artefacts').
  select('record_event_id').
  eq('account_id', accountId).
  eq('artefact_id', artefactId);

  if (error) return { ok: false, message: RECALL_FAILURE_MESSAGE };

  const eventIds = Array.from(
    new Set(
      ((data ?? []) as unknown as Array<Record<string, unknown>>).map((row) =>
      String(row.record_event_id)
      )
    )
  );
  return finishRecall(accountId, eventIds);
}

/**
 * The other direction: a drum found to be wrong, and every batch it went into.
 *
 * Matched case-insensitively and exactly. `lower(lot)` is indexed on the table for this, and
 * a wildcard search would be worse than useless here: LOT-12 must not match LOT-120, because
 * on a recall that is a batch withdrawn for no reason or, the other way round, one left on a
 * shelf.
 */
export async function recallByLot(
accountId: string | null,
lot: string)
: Promise<RecallResult> {
  const client = domainClient();
  if (!client) return { ok: false, message: NOT_CONFIGURED_MESSAGE };
  if (!accountId) return { ok: false, message: NO_ACCOUNT_READ_MESSAGE };

  const trimmed = lot.trim();
  if (!trimmed) return { ok: true, matches: [], totalBatchRecords: 0 };

  const { data, error } = await client.
  from('record_event_lots').
  select('record_event_id').
  eq('account_id', accountId).
  ilike('lot', trimmed);

  if (error) return { ok: false, message: RECALL_FAILURE_MESSAGE };

  const eventIds = Array.from(
    new Set(
      ((data ?? []) as unknown as Array<Record<string, unknown>>).map((row) =>
      String(row.record_event_id)
      )
    )
  );
  return finishRecall(accountId, eventIds);
}

/**
 * Turns a set of event ids into the runs themselves, with the denominator beside them.
 *
 * A FAILED COUNT FAILS THE WHOLE ANSWER rather than defaulting to nought. `totalBatchRecords`
 * is the only thing standing between "no batch used this lot" and "you have recorded no
 * batches", and a nought supplied by a dropped request would produce the second sentence for
 * an account holding forty runs. Refusing is the one safe direction on this screen.
 */
async function finishRecall(accountId: string, eventIds: string[]): Promise<RecallResult> {
  const total = await countBatchRecords(accountId);
  if (total === null) return { ok: false, message: RECALL_FAILURE_MESSAGE };
  if (eventIds.length === 0) return { ok: true, matches: [], totalBatchRecords: total };

  const client = domainClient();
  if (!client) return { ok: false, message: NOT_CONFIGURED_MESSAGE };

  const { data, error } = await client.
  from('record_events').
  select(EVENT_COLUMNS).
  eq('account_id', accountId).
  in('id', eventIds).
  order('occurred_at', { ascending: false });

  if (error) return { ok: false, message: RECALL_FAILURE_MESSAGE };

  const rows = (data ?? []) as unknown as EventRow[];
  const children = await fetchChildren(accountId, rows.map((row) => String(row.id)));
  if (!children.ok) return { ok: false, message: RECALL_FAILURE_MESSAGE };

  return {
    ok: true,
    matches: rows.map((row) =>
    toEvent(row, children.lots.get(String(row.id)) ?? [], children.artefacts.get(String(row.id)) ?? [])
    ),
    totalBatchRecords: total
  };
}

/** The units a set of runs accounts for, and how many of them said. */
export function unitsAcross(events: RecordEvent[]): {total: number;stated: number;} {
  let total = 0;
  let stated = 0;
  for (const event of events) {
    if (typeof event.units === 'number') {
      total += event.units;
      stated += 1;
    }
  }
  return { total, stated };
}

/* ----------------------------------------------------------------- write */

export type LotInput = {
  /** The maker's own material row, when there is one. */
  materialId?: string | null;
  /** What it was called, when there is not. The database requires one or the other. */
  materialRef?: string;
  lot: string;
  quantity?: number | null;
  unit?: string;
};

export type BatchInput = {
  accountId: string;
  productId: string;
  productName: string;
  batchCode: string;
  /** ISO. When the units were MADE, which is not when this form was filled in. */
  occurredAt: string;
  units?: number | null;
  lots?: LotInput[];
  artefactIds?: string[];
  note?: string;
};

/**
 * Writes one production record: the event, its input lots and the label versions applied.
 *
 * ONE RPC, NOT THREE INSERTS, and that is not a performance choice. `record_events` is
 * append-only and the browser holds no UPDATE and no DELETE, so a half-written record — the
 * event without its lots — cannot be repaired from here by anybody, ever. It would sit in the
 * log looking like a run that used no traceable inputs. `batchlabel.record_batch_produced` is
 * SECURITY INVOKER, so every policy and every foreign key applies to the caller exactly as
 * they would to three separate statements; all it adds is the transaction.
 *
 * THE SUMMARY IS BUILT HERE AND IT IS NOT DECORATION. `summary` is NOT NULL and CHECKed
 * non-blank precisely so that no entry can exist that a person cannot read, and it is what the
 * log line says. It names the batch and the product because those are the two things somebody
 * scanning the log a year later needs, and it takes the product name as an argument rather
 * than looking it up so that the sentence records what the product was called ON THE DAY —
 * renaming a product later must not rewrite history.
 */
export async function recordBatchProduced(input: BatchInput): Promise<RecordWriteResult<string>> {
  const client = domainClient();
  if (!client) return { ok: false, reason: 'not_configured', message: NOT_CONFIGURED_MESSAGE };

  const batchCode = input.batchCode.trim();
  const summary = `Batch ${batchCode} of ${input.productName.trim() || 'an unnamed product'}`;

  const lots = (input.lots ?? []).
  map((lot) => ({
    material_id: lot.materialId ?? null,
    material_ref: (lot.materialRef ?? '').trim(),
    lot: lot.lot.trim(),
    quantity: typeof lot.quantity === 'number' && Number.isFinite(lot.quantity) ? lot.quantity : null,
    unit: (lot.unit ?? '').trim()
  })).
  filter((lot) => lot.lot !== '');

  const { data, error } = await client.rpc('record_batch_produced', {
    p_account_id: input.accountId,
    p_product_id: input.productId,
    p_batch_code: batchCode,
    p_summary: summary,
    p_occurred_at: input.occurredAt,
    p_units: typeof input.units === 'number' && Number.isFinite(input.units) ? input.units : null,
    p_lots: lots,
    p_artefact_ids: input.artefactIds ?? [],
    p_detail: input.note?.trim() ? { note: input.note.trim() } : {}
  });

  if (error) {
    // A definite refusal is a known outcome — the database said no, so nothing committed and
    // the transaction took the lots and the links with it. Anything else is NOT known, and on
    // an append-only table the difference decides whether the honest advice is "try again" or
    // "look first, because a second attempt would leave two".
    if (isDefiniteRefusal(error)) return { ok: false, ...classifyRecordError(error) };
    return { ok: false, reason: 'unknown', message: UNKNOWN_OUTCOME_MESSAGE };
  }

  // The function returns the new event's id. A success that hands back nothing is not a
  // success we can prove, and the screen must not navigate to a record it cannot name.
  const id = typeof data === 'string' ? data : Array.isArray(data) ? String(data[0] ?? '') : '';
  if (!id) return { ok: false, reason: 'unknown', message: UNKNOWN_OUTCOME_MESSAGE };

  return { ok: true, value: id };
}

export type ArtefactVersionInput = {
  accountId: string;
  productId: string;
  productName: string;
  artefactType: ArtefactType;
  artefactLabel: string;
  notes?: string;
};

/**
 * Records that a version of this product's label went out, and what the composition was then.
 *
 * WHAT IT DOES NOT CLAIM. Batchlabel generates no artwork — the app-server functions are not
 * written — so `is_placeholder` is set to TRUE explicitly and `storage_path` is left null.
 * The row is a record that the maker applied a version of their own label, not a file we made,
 * and the screens that render it say so in those words. Setting `is_placeholder` false is the
 * claim that a real artefact exists, and whoever writes the generator makes it.
 *
 * THE FINGERPRINT IS FETCHED FIRST AND A FAILURE STOPS THE WRITE. `specification_hash` is NOT
 * NULL and CHECKed non-blank, and it is the whole reason a recorded version can later be told
 * apart from the one that replaced it. There is no placeholder value that would be honest
 * here, so the write is refused rather than stamped with a guess.
 *
 * THE VERSION NUMBER IS TAKEN FROM THE TABLE, NOT FROM A COUNTER. `unique (product_id,
 * artefact_type, version)` is what decides, and a collision — two tabs, or two people in one
 * account, recording at the same moment — is retried once against a freshly read maximum.
 * A second collision is reported rather than looped, because a loop on an append-only table
 * is how one intended record becomes six.
 */
export async function recordArtefactVersion(
input: ArtefactVersionInput)
: Promise<RecordWriteResult<ProducedArtefact>> {
  const client = domainClient();
  if (!client) return { ok: false, reason: 'not_configured', message: NOT_CONFIGURED_MESSAGE };

  const hash = await currentSourceFingerprint(input.productId);
  if (!hash) return { ok: false, reason: 'failed', message: NO_FINGERPRINT_MESSAGE };

  let attempt = 0;
  let lastError: Postgrestish | null = null;
  while (attempt < 2) {
    attempt += 1;

    const { data: existing, error: readError } = await client.
    from('artefacts').
    select('version').
    eq('account_id', input.accountId).
    eq('product_id', input.productId).
    eq('artefact_type', input.artefactType).
    order('version', { ascending: false }).
    limit(1);

    if (readError) return { ok: false, reason: 'failed', message: GENERIC_WRITE_FAILURE };

    const highest =
    intOrNull(((existing ?? []) as unknown as Array<Record<string, unknown>>)[0]?.version) ?? 0;

    const { data, error } = await client.
    from('artefacts').
    insert({
      account_id: input.accountId,
      product_id: input.productId,
      artefact_type: input.artefactType,
      version: highest + 1,
      specification_hash: hash,
      // Explicit, though the column defaults to it. The default is the safety net; this is the
      // statement. See the note at the top of this function.
      is_placeholder: true,
      notes: input.notes?.trim() || null
    }).
    select(ARTEFACT_COLUMNS).
    single();

    if (!error && data) {
      const artefact = toArtefact(data as unknown as Record<string, unknown>);
      const logged = await insertEvent({
        accountId: input.accountId,
        kind: 'artefact.produced',
        summary:
        `${input.artefactLabel} v${artefact.version} recorded for ${input.productName.trim() || 'an unnamed product'}`,
        productId: input.productId,
        artefactId: artefact.id
      });
      // The version row is committed. Whatever the log says now, half of this landed, so none
      // of the "nothing has changed" copy is available — and the log cannot be repaired by
      // rewriting, because it is append-only.
      if (!logged.ok) {
        return { ok: false, reason: 'partial_save', message: ARTEFACT_PARTIAL_MESSAGE };
      }
      return { ok: true, value: artefact };
    }

    lastError = error;
    // 23505 is the version race and only the version race: it is the one unique index on this
    // table that a concurrent write can collide with. Re-read and try once more.
    if (error?.code !== '23505') break;
  }

  if (isDefiniteRefusal(lastError)) return { ok: false, ...classifyRecordError(lastError) };
  return { ok: false, reason: 'unknown', message: UNKNOWN_OUTCOME_MESSAGE };
}

export type EventInput = {
  accountId: string;
  kind: RecordEventKind;
  summary: string;
  occurredAt?: string;
  productId?: string | null;
  specificationId?: string | null;
  artefactId?: string | null;
  materialId?: string | null;
  obligationId?: string | null;
  reference?: string | null;
  detail?: Record<string, unknown>;
};

/**
 * One entry, written straight to the log.
 *
 * Not for batch production — that is `recordBatchProduced`, which is atomic across three
 * tables. This is for the kinds that are one row: a note, a compliance event, an adopted
 * material version.
 */
export async function insertEvent(input: EventInput): Promise<RecordWriteResult<string>> {
  const client = domainClient();
  if (!client) return { ok: false, reason: 'not_configured', message: NOT_CONFIGURED_MESSAGE };

  const summary = input.summary.trim();
  if (!summary) {
    return {
      ok: false,
      reason: 'invalid',
      message:
      'An entry with nothing written on it is not a record of anything, so nothing has been ' +
      'added to your log. Describe what happened and it will save.'
    };
  }

  const { data, error } = await client.
  from('record_events').
  insert({
    account_id: input.accountId,
    kind: input.kind,
    summary,
    ...(input.occurredAt ? { occurred_at: input.occurredAt } : {}),
    ...(input.productId ? { product_id: input.productId } : {}),
    ...(input.specificationId ? { specification_id: input.specificationId } : {}),
    ...(input.artefactId ? { artefact_id: input.artefactId } : {}),
    ...(input.materialId ? { material_id: input.materialId } : {}),
    ...(input.obligationId ? { obligation_id: input.obligationId } : {}),
    ...(input.reference ? { reference: input.reference } : {}),
    ...(input.detail ? { detail: input.detail } : {})
  }).
  select('id').
  single();

  if (error || !data) {
    if (isDefiniteRefusal(error)) return { ok: false, ...classifyRecordError(error) };
    return { ok: false, reason: 'unknown', message: UNKNOWN_OUTCOME_MESSAGE };
  }

  return { ok: true, value: String((data as unknown as Record<string, unknown>).id) };
}

/**
 * Evidence that an obligation was discharged, filed against the obligation's own id.
 *
 * `obligation_id` is a typed, indexed column rather than a key in `detail` because it is what
 * a work queue filters on. The reference is the maker's — a submission number, a certificate
 * id, whatever the regulator gave them — and this app neither validates it nor claims it is
 * valid. Recording that somebody says they notified a poison centre is a true statement;
 * "notified" as a green tick derived from it would not be, and nothing here derives one.
 */
export async function recordObligationEvidence(input: {
  accountId: string;
  productId: string | null;
  obligationId: string;
  summary: string;
  reference?: string;
  kind?: Extract<RecordEventKind, `compliance.${string}`>;
  occurredAt?: string;
}): Promise<RecordWriteResult<string>> {
  return insertEvent({
    accountId: input.accountId,
    kind: input.kind ?? 'compliance.evidence_recorded',
    summary: input.summary,
    productId: input.productId,
    obligationId: input.obligationId,
    reference: input.reference?.trim() || null,
    occurredAt: input.occurredAt
  });
}

/* ------------------------------------------- the writes other files make */

/**
 * WHY THESE TWO EXIST, AND WHY THEY SWALLOW THEIR FAILURE.
 *
 * The brief for this log is "write events from the places they actually occur… rather than
 * adding a 'log it' button". Creating a product and changing a composition are two such
 * places, and the second matters to a recall directly: changing a composition is what makes a
 * label version already on a shelf out of date.
 *
 * They are best-effort, and the caller ignores the result. That is a real decision with a real
 * cost, so here is both halves of it. A product that saved has saved; failing the create
 * because its log line did not land would throw away the maker's work to protect a record OF
 * that work, which is the wrong way round. The cost is that the log can have a hole in it that
 * nothing on screen can see — so the Records screen says what the log is ("everything
 * Batchlabel has recorded") and never claims to be a complete account of everything that ever
 * happened, because it cannot establish that.
 *
 * The alternative — deriving these lines from `products.created_at` at render time — was
 * rejected: half a log read from a table and half derived from another one is a surface where
 * nobody can say what any given line is evidence of.
 */
export async function logProductCreated(
accountId: string | null,
product: {id: string;specificationId?: string;name: string;})
: Promise<void> {
  if (!accountId) return;
  await insertEvent({
    accountId,
    kind: 'note',
    summary: `${product.name} was created`,
    productId: product.id,
    specificationId: product.specificationId ?? null
  }).catch(() => undefined);
}

export async function logCompositionChanged(
accountId: string | null,
product: {id: string;specificationId?: string;name: string;})
: Promise<void> {
  if (!accountId) return;
  await insertEvent({
    accountId,
    kind: 'note',
    summary: `The composition of ${product.name} was changed`,
    productId: product.id,
    specificationId: product.specificationId ?? null
  }).catch(() => undefined);
}
