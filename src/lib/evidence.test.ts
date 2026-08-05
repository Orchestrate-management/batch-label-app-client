import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A stand-in for the log and the artefacts table, chained the way supabase-js chains.
 *
 * It exists for the two write paths that decide whether a screen may claim something. Both are
 * non-atomic pairs, and in both the half that lands matters: an evidence entry the database
 * accepted but did not hand back would appear on screen as a discharged compliance duty with no
 * row behind it, and a print record whose fingerprint we guessed would report "Current" forever.
 * Neither can be reasoned about from a type check — they need the shapes supabase-js actually
 * returns, including the accepted-but-empty one and the one with no Postgres code in it.
 */
const db = vi.hoisted(() => {
  const state = {
    eventInsert: { data: null as unknown, error: null as unknown },
    artefactInsert: { data: null as unknown, error: null as unknown },
    versionLookup: { data: null as unknown, error: null as unknown },
    fingerprint: 'hash-a' as unknown,
    fingerprintError: null as unknown,
    inserts: [] as Array<[string, Record<string, unknown>]>,
    rpcCalls: [] as Array<[string, Record<string, unknown>]>,
    schemas: [] as string[]
  };

  const chainable = (result: () => {data: unknown;error: unknown;}) => {
    const q: Record<string, unknown> = {};
    const chain = () => q;
    Object.assign(q, {
      select: chain,
      eq: chain,
      order: chain,
      limit: chain,
      is: chain,
      single: async () => result(),
      maybeSingle: async () => result(),
      then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
      Promise.resolve(result()).then(resolve, reject)
    });
    return q;
  };

  const supabase = {
    schema(name: string) {
      state.schemas.push(name);
      return supabase;
    },
    async rpc(name: string, args: Record<string, unknown>) {
      state.rpcCalls.push([name, args]);
      if (state.fingerprintError) return { data: null, error: state.fingerprintError };
      return { data: state.fingerprint, error: null };
    },
    from(table: string) {
      return {
        insert(payload: Record<string, unknown>) {
          state.inserts.push([table, payload]);
          return chainable(() =>
          table === 'artefacts' ? state.artefactInsert : state.eventInsert
          );
        },
        select: () => chainable(() => state.versionLookup)
      };
    }
  };

  return { state, supabase };
});

vi.mock('./supabase', () => ({ supabase: db.supabase, isSupabaseConfigured: true }));

import { recordArtefactPrinted, recordEvidence, recordSdsSectionReviewed } from './evidence';
import { Product } from './model';

const product: Product = {
  id: 'prod-1',
  specificationId: 'spec-1',
  name: 'Black Fig and Cassis',
  sku: 'CC-BFC-220',
  categoryId: 'home-fragrance',
  markets: ['GB'],
  regimes: ['clp'],
  spec: {
    kind: 'mixture',
    productType: 'Container candle',
    baseId: 'ing-crw45',
    fragranceId: 'ing-black-fig',
    load: 8,
    dyeId: '',
    additive: '',
    netQuantity: 220,
    netUnit: 'g',
    packagingId: 'pkg-tumbler-250'
  },
  artefacts: [],
  identifiers: {},
  evidence: { obligations: {}, sdsSections: {} }
};

/**
 * The payload sent to one table, or a failure naming the table that got nothing.
 *
 * Better than `find(...)!`: when a write path stops writing, the test says which insert is
 * missing rather than throwing on a property of undefined three lines later.
 */
function insertInto(table: string): Record<string, unknown> {
  const found = db.state.inserts.find(([name]) => name === table);
  if (!found) throw new Error(`nothing was inserted into ${table}`);
  return found[1];
}

const storedEvent = (over: Record<string, unknown> = {}) => ({
  data: {
    id: 'ev-1',
    kind: 'compliance.evidence_recorded',
    product_id: 'prod-1',
    occurred_at: '2026-07-01T12:00:00.000Z',
    obligation_id: 'cpr-pif',
    reference: 'PIF-1',
    summary: 'Assembled the product information file.',
    ...over
  },
  error: null
});

beforeEach(() => {
  db.state.eventInsert = storedEvent();
  db.state.artefactInsert = { data: { id: 'art-1', version: 1 }, error: null };
  db.state.versionLookup = { data: null, error: null };
  db.state.fingerprint = 'hash-a';
  db.state.fingerprintError = null;
  db.state.inserts = [];
  db.state.rpcCalls = [];
  db.state.schemas = [];
});

describe('recording evidence against an obligation', () => {
  it('writes one row to the log and hands back what was stored', async () => {
    const result = await recordEvidence({
      accountId: 'acct-1',
      product,
      obligationId: 'cpr-pif',
      summary: 'Assembled the product information file.',
      reference: 'PIF-1',
      occurredAt: '2026-07-01T12:00:00.000Z'
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.recordedAt).toBe('2026-07-01T12:00:00.000Z');

    const [[table, payload]] = db.state.inserts;
    expect(table).toBe('record_events');
    expect(payload.obligation_id).toBe('cpr-pif');
    expect(payload.product_id).toBe('prod-1');
    // The composition in force, so the log can still say which recipe this was recorded
    // against after the specification has moved on.
    expect(payload.specification_id).toBe('spec-1');
  });

  it('sends the date the maker gave, not the date they typed it in', async () => {
    // `occurred_at` and `recorded_at` are separate columns precisely for this: somebody
    // writing up last month's submission today must not have the log claim it happened today.
    // The database sets recorded_at itself and this app may not send one.
    await recordEvidence({
      accountId: 'acct-1',
      product,
      obligationId: 'cpr-pif',
      summary: 'Done.',
      occurredAt: '2026-03-04T12:00:00.000Z'
    });

    const [[, payload]] = db.state.inserts;
    expect(payload.occurred_at).toBe('2026-03-04T12:00:00.000Z');
    expect(payload).not.toHaveProperty('recorded_at');
  });

  it('gives a duty with a kind of its own that kind, and everything else the generic one', async () => {
    // The obligation id is written either way — that is the indexed column the work queue
    // filters on — so nothing depends on the mapping. It is for the Records screen, where
    // "Poison centre notification submitted" is a better line of history than "Evidence
    // recorded".
    await recordEvidence({ accountId: 'a', product, obligationId: 'clp-pcn-eu', summary: 'Sent.' });
    await recordEvidence({ accountId: 'a', product, obligationId: 'cpr-gmp', summary: 'Done.' });

    expect(db.state.inserts[0][1].kind).toBe('compliance.pcn_submitted');
    expect(db.state.inserts[1][1].kind).toBe('compliance.evidence_recorded');
  });

  it('refuses a blank line before the database has to', async () => {
    // The schema refuses it too (`btrim(summary) <> ''`), and is right to: a log line nobody
    // can read is not a record of anything. Caught here so the maker gets a sentence about
    // their form rather than a constraint violation.
    const result = await recordEvidence({
      accountId: 'acct-1',
      product,
      obligationId: 'cpr-pif',
      summary: '   '
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('refused');
    expect(db.state.inserts).toEqual([]);
  });

  it('does not report success when the insert returned no row', async () => {
    // Accepted, nothing handed back. Treating it as a success lists an entry with no
    // timestamp behind it, and the maker believes a duty is discharged on the strength of a
    // row we never saw.
    db.state.eventInsert = { data: null, error: null };
    const result = await recordEvidence({
      accountId: 'acct-1',
      product,
      obligationId: 'cpr-pif',
      summary: 'Done.'
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('unknown');
  });

  it('offers no retry on a refusal, because a retry returns the same refusal', async () => {
    db.state.eventInsert = { data: null, error: { code: '42501', message: 'refused' } };
    const result = await recordEvidence({
      accountId: 'acct-1',
      product,
      obligationId: 'cpr-pif',
      summary: 'Done.'
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('refused');
      expect(result.message).not.toMatch(/try again/i);
    }
  });

  it('omits the account id when the entitlement has not resolved one', async () => {
    // Supplied, the INSERT policy checks it; omitted, current_account_id() decides. Sending a
    // null would be neither.
    await recordEvidence({ accountId: null, product, obligationId: 'cpr-pif', summary: 'Done.' });
    expect(db.state.inserts[0][1]).not.toHaveProperty('account_id');
  });

  it('goes through the batchlabel schema, never public', async () => {
    await recordEvidence({ accountId: 'a', product, obligationId: 'cpr-pif', summary: 'Done.' });
    expect([...new Set(db.state.schemas)]).toEqual(['batchlabel']);
  });
});

describe('recording a safety data sheet section as reviewed', () => {
  it('puts the section number where the reader looks for it', async () => {
    await recordSdsSectionReviewed({
      accountId: 'acct-1',
      product,
      section: 4,
      summary: 'First aid wording confirmed.',
      reviewer: 'A. Chemist'
    });

    const [[, payload]] = db.state.inserts;
    expect(payload.kind).toBe('compliance.sds_section_reviewed');
    expect(payload.reference).toBe('4');
    expect(payload.obligation_id).toBeNull();
    expect(String(payload.summary)).toContain('A. Chemist');
  });
});

describe('recording a print', () => {
  it('stores the fingerprint the database computed, alongside the version', async () => {
    const result = await recordArtefactPrinted({
      accountId: 'acct-1',
      product,
      artefactType: 'unit-label',
      widthMm: 52,
      heightMm: 74,
      occurredAt: '2026-07-01T12:00:00.000Z'
    });

    expect(result.ok).toBe(true);
    expect(db.state.rpcCalls[0][0]).toBe('artefact_source_fingerprint');

    const artefact = insertInto('artefacts');
    expect(artefact.specification_hash).toBe('hash-a');
    expect(artefact.version).toBe(1);
    expect(artefact.printed_at).toBe('2026-07-01T12:00:00.000Z');
  });

  it('marks every row it writes a placeholder, because no file was generated', async () => {
    // `is_placeholder` defaults TRUE in the schema so a stub is marked as one without having
    // to remember to. It is sent explicitly anyway: this is the only place in the app that
    // writes the column, and a reader should not have to open a migration to learn that
    // Batchlabel produces no file.
    await recordArtefactPrinted({
      accountId: 'acct-1',
      product,
      artefactType: 'unit-label',
      widthMm: 52,
      heightMm: 74
    });
    const artefact = insertInto('artefacts');
    expect(artefact.is_placeholder).toBe(true);
  });

  it('writes nothing at all when the fingerprint cannot be computed', async () => {
    // A print record whose hash we guessed is worse than no print record: it reports "Current"
    // forever, or "Out of date" immediately, and both are statements about a maker's labels.
    db.state.fingerprintError = { message: 'rpc down' };
    const result = await recordArtefactPrinted({
      accountId: 'acct-1',
      product,
      artefactType: 'unit-label',
      widthMm: 52,
      heightMm: 74
    });

    expect(result.ok).toBe(false);
    expect(db.state.inserts).toEqual([]);
  });

  it('writes nothing when the fingerprint came back empty rather than absent', async () => {
    db.state.fingerprint = '   ';
    const result = await recordArtefactPrinted({
      accountId: 'acct-1',
      product,
      artefactType: 'unit-label',
      widthMm: 52,
      heightMm: 74
    });
    expect(result.ok).toBe(false);
    expect(db.state.inserts).toEqual([]);
  });

  it('takes the next version after the highest one held', async () => {
    db.state.versionLookup = { data: { version: 3 }, error: null };
    db.state.artefactInsert = { data: { id: 'art-4', version: 4 }, error: null };

    const result = await recordArtefactPrinted({
      accountId: 'acct-1',
      product,
      artefactType: 'unit-label',
      widthMm: 52,
      heightMm: 74
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.version).toBe(4);
    const artefact = insertInto('artefacts');
    expect(artefact.version).toBe(4);
  });

  it('reports the half that landed when the log line fails', async () => {
    // The artefact row is the fact that makes the drift check work, so it is not undone
    // because a narrative line failed. What must not happen is silence: the version IS stored,
    // and a message saying nothing was recorded would be false in the direction that makes
    // somebody record it twice.
    db.state.eventInsert = { data: null, error: { message: 'log down' } };
    const result = await recordArtefactPrinted({
      accountId: 'acct-1',
      product,
      artefactType: 'unit-label',
      widthMm: 52,
      heightMm: 74
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('partial_save');
      expect(result.message).toMatch(/version was stored/i);
      expect(result.message).not.toMatch(/nothing has changed/i);
    }
    expect(db.state.inserts.some(([table]) => table === 'artefacts')).toBe(true);
  });

  it('logs the print as an artefact.printed event tied to the row it wrote', async () => {
    await recordArtefactPrinted({
      accountId: 'acct-1',
      product,
      artefactType: 'unit-label',
      widthMm: 52,
      heightMm: 74
    });

    const event = insertInto('record_events');
    expect(event.kind).toBe('artefact.printed');
    expect(event.artefact_id).toBe('art-1');
    expect(event.product_id).toBe('prod-1');
  });

  it('stores no dimension it was not given, rather than storing a zero', async () => {
    // The column refuses a non-positive number, and a zero-width label is not a thing.
    await recordArtefactPrinted({
      accountId: 'acct-1',
      product,
      artefactType: 'unit-label',
      widthMm: 0,
      heightMm: 0
    });
    const artefact = insertInto('artefacts');
    expect(artefact.width_mm).toBeNull();
    expect(artefact.height_mm).toBeNull();
  });
});
