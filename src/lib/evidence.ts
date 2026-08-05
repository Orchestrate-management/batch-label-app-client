import { NOT_CONFIGURED_MESSAGE, domainClient } from './domain';
import { ArtefactType, Product, RecordedEvidence } from './model';
import { SDS_REVIEW_KIND, WriteFailure, WriteResult, classifyWriteError } from './products';

/**
 * The write path into the append-only log, and the one into `batchlabel.artefacts`.
 *
 * WHY THIS FILE EXISTS AT ALL. Fifteen obligations in lib/regimes.ts were permanently
 * outstanding on every product of every account, because the only thing that could have
 * discharged them was `products.obligations` — a jsonb column written by nobody. Their
 * "Resolve" links pointed at screens with no control on them that could change anything. The
 * survey called it right: the screens were written before the thing behind them existed.
 *
 * WHAT IT DOES AND DOES NOT CLAIM. Batchlabel does not hold a product information file, has
 * never seen a shop listing, cannot inspect a signed declaration of conformity and does not
 * submit poison centre notifications. Nothing here changes that. What these writes record is
 * the MAKER'S OWN statement that they did the thing, when they did it, and what it references —
 * one row in an append-only log — so that every sentence the app builds afterwards is about our
 * record and never about their business. "You have not recorded this" is a fact this software
 * can establish. "No product information file has been assembled" is not, and was being said.
 *
 * THE LOG IS APPEND-ONLY IN THREE SEPARATE WAYS and none of them is a convention this file is
 * expected to honour by good behaviour: `authenticated` is granted SELECT and INSERT and no
 * more, `record_events` has no UPDATE or DELETE policy, and a trigger raises for any session
 * carrying a JWT that tries either. A correction is therefore a NEW event, which is what a log
 * is; there is no edit here and there must not be one. The reader takes the most recent event
 * per obligation (see `evidenceByProduct` in products.ts), so a correction supersedes without
 * anything being destroyed.
 *
 * ERRORS ARE VALUES, matching lib/products.ts and lib/billing.ts. Every failure below is an
 * ordinary state of a form, and a screen that has to try/catch to find out whether a save
 * landed will sooner or later render a stack trace at somebody.
 */

/* ------------------------------------------------------------------ read */

/** The kind written when a maker records evidence against a named obligation. */
const EVIDENCE_KIND = 'compliance.evidence_recorded';

/**
 * Kinds for the four duties whose event has a name of its own in the schema's `kind` enum.
 *
 * The obligation id is written either way — that is the indexed column the work queue filters
 * on — so nothing depends on this mapping being complete. It exists because the Records screen
 * renders the log as a chronological history, and "Poison centre notification submitted" is a
 * better line in that history than "Evidence recorded". A duty missing from here writes the
 * generic kind and is not lost.
 */
const KIND_BY_OBLIGATION: Record<string, string> = {
  'clp-ufi': 'compliance.ufi_assigned',
  'clp-pcn-eu': 'compliance.pcn_submitted',
  'clp-pcn-gb': 'compliance.npis_submitted',
  'ce-doc-signed': 'compliance.declaration_signed'
};

export function eventKindFor(obligationId: string): string {
  return KIND_BY_OBLIGATION[obligationId] ?? EVIDENCE_KIND;
}

/* ----------------------------------------------------------------- write */

const NO_ACCOUNT_MESSAGE =
'There is no account to record this against yet, so nothing has been saved. Finish setting up ' +
'your account and this will work.';

const REFUSED_MESSAGE =
'That was refused, so nothing has been recorded and nothing has changed. Waiting will not clear ' +
'it and trying again will not either — get in touch and we will tell you why and put it right.';

const NOTHING_RETURNED_MESSAGE =
'The database accepted that without telling us what it stored, so we cannot show you the entry ' +
'and will not claim it is there. Reload this page: if the record is listed, it saved.';

const RECORD_EVENT_COLUMNS = 'id, kind, product_id, occurred_at, obligation_id, reference, summary';

type EvidenceInput = {
  accountId: string | null;
  product: Product;
  /** The obligation id from lib/regimes.ts, or null for a safety data sheet section review. */
  obligationId: string | null;
  /** The sentence the log shows. NOT NULL and non-blank in the schema. */
  summary: string;
  /** A document number, a submission reference, a person's name. Optional. */
  reference?: string | null;
  /**
   * WHEN IT HAPPENED, which is not when it was entered.
   *
   * `occurred_at` and `recorded_at` are separate columns for exactly this: a maker writing up
   * last Tuesday's signing on Friday must not have the log claim it was signed on Friday. This
   * value goes to `occurred_at`; the database sets `recorded_at` itself and this file may not.
   */
  occurredAt?: string;
};

/**
 * Records one piece of evidence against one obligation, or one safety data sheet section.
 *
 * `account_id` is supplied from the entitlement when we have it and omitted when we do not,
 * exactly as lib/products.ts argues at length: supplied, the INSERT policy checks it; omitted,
 * `current_account_id()` decides. No caller may pass an id from a form, a URL or a props chain.
 *
 * `.select()` IS NOT DECORATION. An INSERT refused by a `with check` clause raises, but an
 * insert that lands still has to hand back the row for the screen to render — and a write that
 * reports success while returning nothing is how a screen ends up listing an entry that is not
 * in the database. This returns the stored row or it returns a failure.
 */
export async function recordEvidence(input: EvidenceInput): Promise<WriteResult<RecordedEvidence>> {
  const client = domainClient();
  if (!client) return { ok: false, reason: 'not_configured', message: NOT_CONFIGURED_MESSAGE };

  const summary = input.summary.trim();
  if (!summary) {
    // The schema refuses a blank summary (`btrim(summary) <> ''`) and it is right to: a log
    // line nobody can read is not a record of anything. Caught here so the maker gets a
    // sentence about their form rather than a constraint violation.
    return {
      ok: false,
      reason: 'refused',
      message: 'Write a line saying what you did — the log entry is what somebody reads later.'
    };
  }

  const account = input.accountId ? { account_id: input.accountId } : {};
  const kind = input.obligationId ? eventKindFor(input.obligationId) : SDS_REVIEW_KIND;

  const { data, error } = await client.
  from('record_events').
  insert({
    ...account,
    kind,
    product_id: input.product.id,
    // The composition this evidence was recorded against, so the log can still say which
    // recipe was in force even after the specification has moved on.
    specification_id: input.product.specificationId ?? null,
    obligation_id: input.obligationId,
    reference: input.reference?.trim() || null,
    summary,
    occurred_at: input.occurredAt || new Date().toISOString()
  }).
  select(RECORD_EVENT_COLUMNS).
  single();

  if (error) return { ok: false, ...classifyEvidenceError(error) };

  if (!data) {
    // Accepted, nothing returned. Not treated as success: the screen would list an entry it
    // cannot show a timestamp for, and the maker would believe a duty is discharged on the
    // strength of a row we never saw.
    return { ok: false, reason: 'unknown', message: NOTHING_RETURNED_MESSAGE };
  }

  const row = data as {
    id: string;
    occurred_at: string | null;
    reference: string | null;
    summary: string | null;
  };

  return {
    ok: true,
    value: {
      id: row.id,
      recordedAt: row.occurred_at ?? '',
      reference: row.reference,
      summary: row.summary ?? summary
    }
  };
}

/** Records that a competent person has reviewed one section of the safety data sheet. */
export function recordSdsSectionReviewed(input: {
  accountId: string | null;
  product: Product;
  section: number;
  summary: string;
  reviewer?: string | null;
  occurredAt?: string;
}): Promise<WriteResult<RecordedEvidence>> {
  return recordEvidence({
    accountId: input.accountId,
    product: input.product,
    obligationId: null,
    // The section number goes in `reference`, which is what `evidenceByProduct` reads it back
    // out of. A review with no section attached reviews nothing a screen can point at.
    reference: String(input.section),
    summary: input.reviewer?.trim() ?
    `${input.summary.trim()} Reviewed by ${input.reviewer.trim()}.` :
    input.summary,
    occurredAt: input.occurredAt
  });
}

/* -------------------------------------------------------------- artefact */

export type RecordedPrint = {
  artefactId: string;
  version: number;
  /** True when the log line failed even though the artefact version was stored. */
  logMissing: boolean;
};

const NO_FINGERPRINT_MESSAGE =
'We could not read what this label would be produced from, so nothing has been recorded. A ' +
'print record is only worth having if it says which composition was printed, and we will not ' +
'store one that does not.';

const PRINT_LOG_MISSING_MESSAGE =
'The label version was stored, but the line in your records log was not written. The version is ' +
'there and the drift check will use it; the history will not show this print until you record ' +
'another one.';

/**
 * Records that the maker printed a surface, and what composition it was printed from.
 *
 * THIS IS NOT AN EXPORT AND IT DOES NOT CLAIM TO BE ONE. Batchlabel generates no file — the
 * exporter is not written, and the two export buttons on the designer say so. What a maker
 * does today is print from their own process, and the fact worth keeping is which recipe was in
 * force when they did. So `is_placeholder` is left at its default of TRUE, which is the
 * schema's own way of saying "no file of ours exists behind this row", and every screen reads
 * that column before calling anything produced.
 *
 * WHAT IT BUYS, and the reason it is worth a table rather than a toast. `specification_hash`
 * is `batchlabel.artefact_source_fingerprint(product_id)` at the moment of the print — an md5
 * over the composition, the pack, the state of every material the composition and pack name, and
 * the printed business identity. An
 * artefact is current exactly when that function returns the same value now. That single
 * comparison is what turns "Current" from a hardcoded `true` into an answer, gives
 * `clp-artefact-current` something to read, and lets the app tell a maker which labels stopped
 * matching the day they corrected their address.
 *
 * THE FINGERPRINT IS FETCHED FIRST AND A FAILURE STOPS THE WRITE. A print record whose hash we
 * guessed is worse than no print record: it would report "Current" forever, or "Out of date"
 * immediately, and both are statements about a maker's labels.
 */
export async function recordArtefactPrinted(input: {
  accountId: string | null;
  product: Product;
  artefactType: ArtefactType;
  widthMm: number;
  heightMm: number;
  notes?: string | null;
  occurredAt?: string;
}): Promise<WriteResult<RecordedPrint>> {
  const client = domainClient();
  if (!client) return { ok: false, reason: 'not_configured', message: NOT_CONFIGURED_MESSAGE };

  const { data: hash, error: hashError } = await client.rpc('artefact_source_fingerprint', {
    p_product_id: input.product.id
  });

  if (hashError || typeof hash !== 'string' || hash.trim() === '') {
    return { ok: false, reason: 'failed', message: NO_FINGERPRINT_MESSAGE };
  }

  // The next version for this surface. Read rather than counted in the browser, and protected
  // by `unique (product_id, artefact_type, version)` underneath — two tabs recording a print
  // at once collide on the index rather than both claiming to be v3.
  const { data: highest, error: versionError } = await client.
  from('artefacts').
  select('version').
  eq('product_id', input.product.id).
  eq('artefact_type', input.artefactType).
  order('version', { ascending: false }).
  limit(1).
  maybeSingle();

  if (versionError) return { ok: false, ...classifyEvidenceError(versionError) };

  const held = (highest as {version?: number | string | null;} | null)?.version;
  const version = Number.isFinite(Number(held)) ? Number(held) + 1 : 1;

  const account = input.accountId ? { account_id: input.accountId } : {};
  const at = input.occurredAt || new Date().toISOString();

  const { data: artefact, error: artefactError } = await client.
  from('artefacts').
  insert({
    ...account,
    product_id: input.product.id,
    artefact_type: input.artefactType,
    version,
    width_mm: input.widthMm > 0 ? input.widthMm : null,
    height_mm: input.heightMm > 0 ? input.heightMm : null,
    produced_at: at,
    printed_at: at,
    specification_hash: hash,
    // Left explicit rather than relying on the default, because this is the one place in the
    // app that writes the column and a reader of this file should not have to open a migration
    // to find out whether a file exists behind these rows. It does not.
    is_placeholder: true,
    notes: input.notes?.trim() || null
  }).
  select('id, version').
  single();

  if (artefactError || !artefact) {
    return artefactError ?
    { ok: false, ...classifyEvidenceError(artefactError) } :
    { ok: false, reason: 'unknown', message: NOTHING_RETURNED_MESSAGE };
  }

  const stored = artefact as {id: string;version: number | string | null;};

  // The log line. Written second and deliberately not allowed to undo the first: the artefact
  // row is the fact that makes the drift check work, and deleting it because a narrative line
  // failed would throw away the useful half. The failure is reported rather than swallowed,
  // and it says which half landed — the same rule saveComposition follows for its own
  // non-atomic pair.
  const { error: logError } = await client.from('record_events').insert({
    ...account,
    kind: 'artefact.printed',
    product_id: input.product.id,
    specification_id: input.product.specificationId ?? null,
    artefact_id: stored.id,
    occurred_at: at,
    summary: `Printed ${input.artefactType} v${Number(stored.version) || version} for ${input.product.name}.`
  });

  if (logError) {
    return {
      ok: false,
      reason: 'partial_save',
      message: PRINT_LOG_MISSING_MESSAGE
    };
  }

  return {
    ok: true,
    value: { artefactId: stored.id, version: Number(stored.version) || version, logMissing: false }
  };
}

/* ------------------------------------------------------------ classifier */

type Postgrestish = {code?: string | null;hint?: string | null;message?: string | null;};

/**
 * The same classification products.ts makes, with two of its branches replaced.
 *
 * `sku_limit` and `duplicate_sku` cannot arise on these tables — nothing here is metered and
 * nothing here is unique per account — so their sentences would be wrong and confusing if they
 * ever appeared. Everything else is shared, including the rule that matters: match the HINT,
 * never the code and never the sentence.
 */
function classifyEvidenceError(error: Postgrestish | null): {
  reason: WriteFailure;
  message: string;
} {
  const classified = classifyWriteError(error);
  if (classified.reason === 'no_account') {
    return { reason: 'no_account', message: NO_ACCOUNT_MESSAGE };
  }
  if (classified.reason === 'refused') {
    return { reason: 'refused', message: REFUSED_MESSAGE };
  }
  return classified;
}
