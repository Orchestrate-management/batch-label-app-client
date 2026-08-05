import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * THE LOG, AND THE ONE ANSWER IT MUST NEVER GIVE.
 *
 * The screen this module replaced was withdrawn for a single defect, written down in its own
 * header: a recall search over invented runs "could return 'no run used a lot or serial
 * matching that' to a real maker searching a real lot number — a false negative, on a recall,
 * rendered as a confident sentence."
 *
 * Every test below about `totalBatchRecords` is that defect. A search that matched nothing and
 * a search that had nothing to search are two different answers, and a search that FAILED is a
 * third that may borrow neither. The type makes the first two distinguishable and the third
 * impossible to confuse with either; these tests are what keep it that way, including the one
 * that matters most — a failed COUNT must fail the whole answer rather than defaulting to
 * nought, because a nought supplied by a dropped request produces "you have recorded no
 * batches" for an account holding forty.
 *
 * The rest is the ordinary bar this repo holds a data layer to: a write that can fail has a
 * test for the failure, an empty read has a test that it is not an error, and the difference
 * between "the database refused this" and "we lost the answer" is asserted rather than assumed
 * — on an append-only table that difference decides whether the honest advice is "try again"
 * or "look first, because a second attempt would leave two".
 */

type Result = {data?: unknown;error?: unknown;count?: unknown;};
type Responder = Result | ((context: Context) => Result);

type Context = {
  table: string;
  filters: Array<[string, string, unknown]>;
  payload: unknown;
  options: unknown;
};

const db = vi.hoisted(() => {
  const state = {
    /** Keyed `select:table`, `insert:table`, `count:table`, `rpc:name`. */
    responses: new Map<string, Responder[]>(),
    calls: [] as Array<{key: string;context: Context;}>,
    schemas: [] as string[]
  };

  const take = (key: string, context: Context): Result => {
    state.calls.push({ key, context });
    const queue = state.responses.get(key);
    if (!queue || queue.length === 0) return { data: null, error: null };
    const next = queue.length === 1 ? queue[0] : queue.shift() as Responder;
    return typeof next === 'function' ? next(context) : next;
  };

  const chain = (key: string, context: Context) => {
    const q: Record<string, unknown> = {};
    const self = () => q;
    const filter = (operator: string) => (column: string, value: unknown) => {
      context.filters.push([operator, column, value]);
      return q;
    };
    Object.assign(q, {
      select: (_columns?: unknown, options?: unknown) => {
        if (options) context.options = options;
        return q;
      },
      order: self,
      limit: self,
      is: filter('is'),
      eq: filter('eq'),
      in: filter('in'),
      ilike: filter('ilike'),
      single: async () => take(key, context),
      maybeSingle: async () => take(key, context),
      then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
      Promise.resolve(take(key, context)).then(resolve, reject)
    });
    return q;
  };

  const client = {
    schema(name: string) {
      state.schemas.push(name);
      return client;
    },
    rpc(name: string, args: unknown) {
      const context: Context = { table: name, filters: [], payload: args, options: null };
      return {
        then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
        Promise.resolve(take(`rpc:${name}`, context)).then(resolve, reject)
      };
    },
    from(table: string) {
      return {
        select: (_columns?: unknown, options?: unknown) => {
          const context: Context = { table, filters: [], payload: null, options: options ?? null };
          // A head request asks for the number and no rows. It is a different question from
          // the same table and it gets a different key, because the whole point of the count
          // is that it is not the list.
          const head = Boolean((options as {head?: boolean;} | null)?.head);
          return chain(head ? `count:${table}` : `select:${table}`, context);
        },
        insert: (payload: unknown) =>
        chain(`insert:${table}`, { table, filters: [], payload, options: null })
      };
    }
  };

  return { state, client };
});

vi.mock('./supabase', () => ({ supabase: db.client }));

import {
  EVENT_GROUP,
  artefactCurrency,
  classifyRecordError,
  fetchProducedArtefacts,
  fetchRecordLog,
  insertEvent,
  isRecordEventKind,
  logCompositionChanged,
  logProductCreated,
  recallByArtefact,
  recallByLot,
  recordArtefactVersion,
  recordBatchProduced,
  unitsAcross,
  type ProducedArtefact } from
'./records';

const ACCOUNT = '11111111-1111-4111-8111-111111111111';

function respond(key: string, ...responses: Responder[]) {
  db.state.responses.set(key, responses);
}

function callsFor(key: string) {
  return db.state.calls.filter((call) => call.key === key);
}

function eventRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'event-1',
    kind: 'batch.produced',
    occurred_at: '2026-08-01T09:00:00.000Z',
    recorded_at: '2026-08-01T09:00:01.000Z',
    product_id: 'product-1',
    specification_id: 'spec-1',
    artefact_id: null,
    material_id: null,
    batch_code: 'BF-2026-014',
    units: 120,
    identity_kind: 'batch',
    serial_from: null,
    serial_to: null,
    obligation_id: null,
    reference: null,
    summary: 'Batch BF-2026-014 of Black Fig',
    detail: {},
    ...overrides
  };
}

function artefactRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'artefact-1',
    product_id: 'product-1',
    artefact_type: 'unit-label',
    version: 3,
    produced_at: '2026-07-30T10:00:00.000Z',
    printed_at: null,
    specification_hash: 'hash-abc',
    is_placeholder: true,
    notes: null,
    ...overrides
  };
}

beforeEach(() => {
  db.state.responses.clear();
  db.state.calls.length = 0;
  db.state.schemas.length = 0;
});

/* ------------------------------------------------------------------ read */

describe('fetchRecordLog', () => {
  it('refuses a null account rather than reading unfiltered', async () => {
    const result = await fetchRecordLog(null);

    expect(result.ok).toBe(false);
    // The message must not be the read-failure one. Nothing failed; we simply do not know
    // which account this workspace is, and an unfiltered read is how one brand's deployment
    // lays out another brand's log.
    expect(result.ok === false && result.message).toContain('could not tell which account');
    expect(db.state.calls).toHaveLength(0);
  });

  it('reads through the batchlabel schema and never public', async () => {
    respond('select:record_events', { data: [], error: null });

    await fetchRecordLog(ACCOUNT);

    expect(db.state.schemas.length).toBeGreaterThan(0);
    expect(new Set(db.state.schemas)).toEqual(new Set(['batchlabel']));
  });

  it('reports an empty log as an empty log and not as a failure', async () => {
    respond('select:record_events', { data: [], error: null });

    const result = await fetchRecordLog(ACCOUNT);

    expect(result).toEqual({ ok: true, events: [], truncated: false });
  });

  it('reports a failed read as a failure and never as an empty log', async () => {
    respond('select:record_events', { data: null, error: { code: '08006' } });

    const result = await fetchRecordLog(ACCOUNT);

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.message).toContain('could not read your records');
  });

  it('joins lots and label versions onto the events', async () => {
    respond('select:record_events', { data: [eventRow()], error: null });
    respond('select:record_event_lots', {
      data: [
      {
        id: 'lot-1',
        record_event_id: 'event-1',
        material_id: null,
        material_ref: 'Fragrance oil',
        lot: 'LOT-88213',
        quantity: 220,
        unit: 'g'
      }],

      error: null
    });
    respond('select:record_event_artefacts', {
      data: [{ record_event_id: 'event-1', artefact_id: 'artefact-1' }],
      error: null
    });
    respond('select:artefacts', { data: [artefactRow()], error: null });

    const result = await fetchRecordLog(ACCOUNT);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.events).toHaveLength(1);
    expect(result.events[0].lots.map((lot) => lot.lot)).toEqual(['LOT-88213']);
    expect(result.events[0].artefacts.map((artefact) => artefact.version)).toEqual([3]);
    expect(result.events[0].units).toBe(120);
  });

  it('fails the whole read when the lots could not be read', async () => {
    // A batch rendered with an empty lot list does not LOOK broken — it looks like a run
    // recorded without lots, which is an ordinary thing. So a dropped request here would
    // quietly turn a traceable run into an untraceable one on screen.
    respond('select:record_events', { data: [eventRow()], error: null });
    respond('select:record_event_lots', { data: null, error: { code: '08006' } });
    respond('select:record_event_artefacts', { data: [], error: null });

    const result = await fetchRecordLog(ACCOUNT);

    expect(result.ok).toBe(false);
  });

  it('keeps an entry whose kind this build does not know, as a note', async () => {
    respond('select:record_events', {
      data: [eventRow({ kind: 'compliance.something_newer', summary: 'A thing happened' })],
      error: null
    });

    const result = await fetchRecordLog(ACCOUNT);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Dropping it would put a silent hole in a compliance log because an older tab met a
    // newer deploy. The summary is NOT NULL in the database, so the line stays readable.
    expect(result.events).toHaveLength(1);
    expect(result.events[0].kind).toBe('note');
    expect(result.events[0].summary).toBe('A thing happened');
  });

  it('does not claim there is more below a log that is exactly a page long', async () => {
    const page = Array.from({ length: 200 }, (_, index) => eventRow({ id: `event-${index}` }));
    respond('select:record_events', { data: page, error: null });
    respond('select:record_event_lots', { data: [], error: null });
    respond('select:record_event_artefacts', { data: [], error: null });

    const result = await fetchRecordLog(ACCOUNT);

    // An account holding exactly 200 entries has no 201st. Reporting one from the length
    // alone would be a claim about their data that nothing established.
    expect(result.ok && result.truncated).toBe(false);
    expect(result.ok && result.events).toHaveLength(200);
  });

  it('says there is more only when a row beyond the page actually came back', async () => {
    const page = Array.from({ length: 201 }, (_, index) => eventRow({ id: `event-${index}` }));
    respond('select:record_events', { data: page, error: null });
    respond('select:record_event_lots', { data: [], error: null });
    respond('select:record_event_artefacts', { data: [], error: null });

    const result = await fetchRecordLog(ACCOUNT);

    expect(result.ok && result.truncated).toBe(true);
    // And the extra row is not shown: it was asked for to answer the question, not to render.
    expect(result.ok && result.events).toHaveLength(200);
  });

  it('filters by group, product and batch code, matching the code case-insensitively', async () => {
    respond('select:record_events', { data: [], error: null });

    await fetchRecordLog(ACCOUNT, {
      group: 'production',
      productId: 'product-1',
      batchCode: 'bf-2026-014'
    });

    const [call] = callsFor('select:record_events');
    expect(call.context.filters).toContainEqual(['eq', 'account_id', ACCOUNT]);
    expect(call.context.filters).toContainEqual(['eq', 'product_id', 'product-1']);
    // ilike with no wildcard is an exact, case-insensitive match. A `%` here would make
    // BF-2026-01 match BF-2026-014, which on a recall is the wrong batch withdrawn.
    expect(call.context.filters).toContainEqual(['ilike', 'batch_code', 'bf-2026-014']);
    const kinds = call.context.filters.find(([operator, column]) => operator === 'in' && column === 'kind');
    expect(kinds?.[2]).toEqual(['batch.produced']);
  });
});

describe('fetchProducedArtefacts', () => {
  it('refuses a null account', async () => {
    const result = await fetchProducedArtefacts(null, 'product-1');
    expect(result.ok).toBe(false);
    expect(db.state.calls).toHaveLength(0);
  });

  it('reads a version as a placeholder unless the column says otherwise', async () => {
    respond('select:artefacts', {
      data: [artefactRow({ is_placeholder: false }), artefactRow({ id: 'a2', is_placeholder: null })],
      error: null
    });

    const result = await fetchProducedArtefacts(ACCOUNT, 'product-1');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.artefacts[0].isPlaceholder).toBe(false);
    // Anything other than an explicit false is read as "we did not generate this". Erring in
    // that direction cannot make a false claim about a compliance document.
    expect(result.artefacts[1].isPlaceholder).toBe(true);
  });

  it('reports a failed read rather than an empty version list', async () => {
    respond('select:artefacts', { data: null, error: { code: '08006' } });
    const result = await fetchProducedArtefacts(ACCOUNT, 'product-1');
    expect(result.ok).toBe(false);
  });
});

/* ---------------------------------------------------------------- recall */

describe('recall', () => {
  it('separates "no batch names this lot" from "there are no batches"', async () => {
    respond('select:record_event_lots', { data: [], error: null });
    respond('count:record_events', { count: 40, error: null });

    const searched = await recallByLot(ACCOUNT, 'LOT-88213');

    expect(searched).toEqual({ ok: true, matches: [], totalBatchRecords: 40 });

    db.state.calls.length = 0;
    respond('select:record_event_lots', { data: [], error: null });
    respond('count:record_events', { count: 0, error: null });

    const nothingToSearch = await recallByLot(ACCOUNT, 'LOT-88213');

    // Same empty match list. Different answer entirely — and the screen renders two different
    // sentences off this number, which is the whole reason it is carried.
    expect(nothingToSearch).toEqual({ ok: true, matches: [], totalBatchRecords: 0 });
  });

  it('fails the answer when the count could not be read, rather than defaulting to nought', async () => {
    respond('select:record_event_lots', { data: [], error: null });
    respond('count:record_events', { count: null, error: { code: '08006' } });

    const result = await recallByLot(ACCOUNT, 'LOT-88213');

    // A nought here would render as "you have recorded no batches" to an account holding
    // forty. This is the single most consequential branch in the module.
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.message).toContain('not an answer');
  });

  it('says a failed search is a failure and not an answer of no', async () => {
    respond('select:record_event_lots', { data: null, error: { code: '08006' } });

    const result = await recallByLot(ACCOUNT, 'LOT-88213');

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.message).toContain('not read it as');
  });

  it('matches a lot exactly and case-insensitively, with no wildcard', async () => {
    respond('select:record_event_lots', { data: [], error: null });
    respond('count:record_events', { count: 1, error: null });

    await recallByLot(ACCOUNT, '  lot-88213 ');

    const [call] = callsFor('select:record_event_lots');
    expect(call.context.filters).toContainEqual(['ilike', 'lot', 'lot-88213']);
    expect(call.context.filters).toContainEqual(['eq', 'account_id', ACCOUNT]);
  });

  it('returns the runs a lot went into, newest first, with their lots and versions', async () => {
    respond('select:record_event_lots',
    { data: [{ record_event_id: 'event-1' }, { record_event_id: 'event-1' }], error: null },
    { data: [{ id: 'lot-1', record_event_id: 'event-1', material_ref: 'Wax', lot: 'LOT-1', quantity: null, unit: null }], error: null }
    );
    respond('count:record_events', { count: 3, error: null });
    respond('select:record_events', { data: [eventRow()], error: null });
    respond('select:record_event_artefacts', { data: [], error: null });

    const result = await recallByLot(ACCOUNT, 'LOT-1');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.matches.map((match) => match.batchCode)).toEqual(['BF-2026-014']);
    expect(result.totalBatchRecords).toBe(3);
    // Two link rows, one event. A duplicate id must not become a duplicate batch — on a
    // recall that is one run counted twice and the unit total doubled.
    const [eventsCall] = callsFor('select:record_events');
    expect(eventsCall.context.filters).toContainEqual(['in', 'id', ['event-1']]);
  });

  it('answers "which batches carry this label version" through the artefact link table', async () => {
    respond('select:record_event_artefacts',
    { data: [{ record_event_id: 'event-1' }], error: null },
    { data: [], error: null }
    );
    respond('count:record_events', { count: 5, error: null });
    respond('select:record_events', { data: [eventRow()], error: null });
    respond('select:record_event_lots', { data: [], error: null });

    const result = await recallByArtefact(ACCOUNT, 'artefact-1');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.matches).toHaveLength(1);
    expect(result.totalBatchRecords).toBe(5);
    const [linkCall] = callsFor('select:record_event_artefacts');
    expect(linkCall.context.filters).toContainEqual(['eq', 'artefact_id', 'artefact-1']);
  });

  it('refuses a null account on both searches', async () => {
    expect((await recallByLot(null, 'LOT-1')).ok).toBe(false);
    expect((await recallByArtefact(null, 'artefact-1')).ok).toBe(false);
    expect(db.state.calls).toHaveLength(0);
  });

  it('treats a blank lot as nothing asked rather than as a search of everything', async () => {
    const result = await recallByLot(ACCOUNT, '   ');
    expect(result).toEqual({ ok: true, matches: [], totalBatchRecords: 0 });
    expect(db.state.calls).toHaveLength(0);
  });
});

describe('unitsAcross', () => {
  it('counts only the runs that stated a number', async () => {
    respond('select:record_event_lots', { data: [{ record_event_id: 'event-1' }, { record_event_id: 'event-2' }], error: null });
    respond('count:record_events', { count: 2, error: null });
    respond('select:record_events', {
      data: [eventRow({ units: 120 }), eventRow({ id: 'event-2', units: null })],
      error: null
    });
    respond('select:record_event_artefacts', { data: [], error: null });

    const result = await recallByLot(ACCOUNT, 'LOT-1');
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // 120 across one of two runs. The screen says the real figure is higher rather than
    // printing 120 as the total affected.
    expect(unitsAcross(result.matches)).toEqual({ total: 120, stated: 1 });
  });
});

/* ----------------------------------------------------------------- write */

describe('recordBatchProduced', () => {
  const input = {
    accountId: ACCOUNT,
    productId: 'product-1',
    productName: 'Black Fig',
    batchCode: ' BF-2026-014 ',
    occurredAt: '2026-08-01T09:00:00.000Z',
    units: 120,
    lots: [
    { materialRef: 'Fragrance oil', lot: ' LOT-88213 ', quantity: 220, unit: 'g' },
    { materialRef: 'Wax', lot: '   ', quantity: null, unit: '' }],

    artefactIds: ['artefact-1'],
    note: 'Second pour'
  };

  it('writes the event, its lots and its versions through the one atomic function', async () => {
    respond('rpc:record_batch_produced', { data: 'event-9', error: null });

    const result = await recordBatchProduced(input);

    expect(result).toEqual({ ok: true, value: 'event-9' });
    const [call] = callsFor('rpc:record_batch_produced');
    const args = call.context.payload as Record<string, unknown>;
    expect(args.p_account_id).toBe(ACCOUNT);
    expect(args.p_batch_code).toBe('BF-2026-014');
    // The summary records what the product was CALLED ON THE DAY. Renaming a product later
    // must not rewrite what the log says happened.
    expect(args.p_summary).toBe('Batch BF-2026-014 of Black Fig');
    expect(args.p_artefact_ids).toEqual(['artefact-1']);
    // A row with no lot number is not traceability, so it is dropped rather than stored as a
    // blank the CHECK would refuse anyway.
    expect(args.p_lots).toEqual([
    { material_id: null, material_ref: 'Fragrance oil', lot: 'LOT-88213', quantity: 220, unit: 'g' }]
    );
    expect(args.p_detail).toEqual({ note: 'Second pour' });
  });

  it('reports a refusal as a refusal, with no retry offered', async () => {
    respond('rpc:record_batch_produced', { data: null, error: { code: '42501' } });

    const result = await recordBatchProduced(input);

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toBe('refused');
    expect(result.ok === false && result.message).toContain('nothing has changed');
  });

  it('reports a lost answer as unknown, and tells the maker to look before recording again', async () => {
    // No Postgres code at all: a dropped socket, a proxy 5xx, an aborted fetch. The statement
    // may well have committed, and the log cannot be de-duplicated by anybody afterwards.
    respond('rpc:record_batch_produced', { data: null, error: { message: 'Failed to fetch' } });

    const result = await recordBatchProduced(input);

    expect(result.ok === false && result.reason).toBe('unknown');
    expect(result.ok === false && result.message).toContain('Check your log');
    expect(result.ok === false && result.message).not.toContain('Nothing has been recorded');
  });

  it('does not report success when the function handed back no id', async () => {
    respond('rpc:record_batch_produced', { data: null, error: null });

    const result = await recordBatchProduced(input);

    expect(result.ok === false && result.reason).toBe('unknown');
  });

  it('names a constraint violation as something to fix rather than something to retry', async () => {
    respond('rpc:record_batch_produced', { data: null, error: { code: '23514' } });

    const result = await recordBatchProduced(input);

    expect(result.ok === false && result.reason).toBe('invalid');
    expect(result.ok === false && result.message).not.toContain('try again in a moment');
  });

  it('names an unfinished signup rather than blaming the connection', async () => {
    respond('rpc:record_batch_produced', { data: null, error: { code: 'P0001', hint: 'account_missing' } });

    const result = await recordBatchProduced(input);

    expect(result.ok === false && result.reason).toBe('no_account');
    expect(result.ok === false && result.message).toContain('signup was not finished');
  });
});

describe('recordArtefactVersion', () => {
  const input = {
    accountId: ACCOUNT,
    productId: 'product-1',
    productName: 'Black Fig',
    artefactType: 'unit-label' as const,
    artefactLabel: 'Unit label'
  };

  it('refuses to write a version it cannot stamp, and writes nothing', async () => {
    respond('rpc:artefact_source_fingerprint', { data: null, error: null });

    const result = await recordArtefactVersion(input);

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.message).toContain('nothing honest to stamp');
    // No fingerprint means no way to tell this version from the one that replaces it, and
    // there is no placeholder value that would be honest. So nothing is written at all.
    expect(callsFor('insert:artefacts')).toHaveLength(0);
  });

  it('stamps the fingerprint, numbers from the table, marks it a placeholder and logs it', async () => {
    respond('rpc:artefact_source_fingerprint', { data: 'hash-abc', error: null });
    respond('select:artefacts', { data: [{ version: 2 }], error: null });
    respond('insert:artefacts', { data: artefactRow({ version: 3 }), error: null });
    respond('insert:record_events', { data: { id: 'event-2' }, error: null });

    const result = await recordArtefactVersion(input);

    expect(result.ok).toBe(true);
    const [insert] = callsFor('insert:artefacts');
    const payload = insert.context.payload as Record<string, unknown>;
    expect(payload.version).toBe(3);
    expect(payload.specification_hash).toBe('hash-abc');
    // Explicit, though the column defaults to it. Batchlabel generates no artwork, and a row
    // that claimed otherwise would be a false statement about a compliance document.
    expect(payload.is_placeholder).toBe(true);
    // No dimensions. The only numbers available are shipped constants, not measurements.
    expect(payload).not.toHaveProperty('width_mm');
    expect(payload).not.toHaveProperty('height_mm');

    const [logged] = callsFor('insert:record_events');
    const event = logged.context.payload as Record<string, unknown>;
    expect(event.kind).toBe('artefact.produced');
    expect(event.artefact_id).toBe('artefact-1');
    expect(event.summary).toBe('Unit label v3 recorded for Black Fig');
  });

  it('starts at version 1 when the product has none', async () => {
    respond('rpc:artefact_source_fingerprint', { data: 'hash-abc', error: null });
    respond('select:artefacts', { data: [], error: null });
    respond('insert:artefacts', { data: artefactRow({ version: 1 }), error: null });
    respond('insert:record_events', { data: { id: 'event-2' }, error: null });

    await recordArtefactVersion(input);

    const [insert] = callsFor('insert:artefacts');
    expect((insert.context.payload as Record<string, unknown>).version).toBe(1);
  });

  it('retries a version collision once against a freshly read maximum, then stops', async () => {
    respond('rpc:artefact_source_fingerprint', { data: 'hash-abc', error: null });
    respond('select:artefacts', { data: [{ version: 2 }], error: null }, { data: [{ version: 3 }], error: null });
    respond('insert:artefacts',
    { data: null, error: { code: '23505' } },
    { data: null, error: { code: '23505' } }
    );

    const result = await recordArtefactVersion(input);

    // Two attempts and no more. A loop on an append-only table is how one intended record
    // becomes six.
    expect(callsFor('insert:artefacts')).toHaveLength(2);
    expect(result.ok).toBe(false);
  });

  it('says the version saved and its log line did not, rather than "nothing changed"', async () => {
    respond('rpc:artefact_source_fingerprint', { data: 'hash-abc', error: null });
    respond('select:artefacts', { data: [], error: null });
    respond('insert:artefacts', { data: artefactRow({ version: 1 }), error: null });
    respond('insert:record_events', { data: null, error: { code: '08006' } });

    const result = await recordArtefactVersion(input);

    expect(result.ok === false && result.reason).toBe('partial_save');
    expect(result.ok === false && result.message).toContain('The label version was saved');
  });

  it('reports a failed version read as a failure rather than writing version 1 over the top', async () => {
    respond('rpc:artefact_source_fingerprint', { data: 'hash-abc', error: null });
    respond('select:artefacts', { data: null, error: { code: '08006' } });

    const result = await recordArtefactVersion(input);

    expect(result.ok).toBe(false);
    expect(callsFor('insert:artefacts')).toHaveLength(0);
  });
});

describe('insertEvent', () => {
  it('refuses an entry with nothing written on it, without asking the database', async () => {
    const result = await insertEvent({ accountId: ACCOUNT, kind: 'note', summary: '   ' });

    expect(result.ok === false && result.reason).toBe('invalid');
    expect(callsFor('insert:record_events')).toHaveLength(0);
  });

  it('sends only the columns it was given', async () => {
    respond('insert:record_events', { data: { id: 'event-3' }, error: null });

    await insertEvent({
      accountId: ACCOUNT,
      kind: 'note',
      summary: 'Something happened',
      productId: 'product-1'
    });

    const [call] = callsFor('insert:record_events');
    const payload = call.context.payload as Record<string, unknown>;
    expect(payload).toEqual({
      account_id: ACCOUNT,
      kind: 'note',
      summary: 'Something happened',
      product_id: 'product-1'
    });
    // Never sent. `created_by` is pinned by a trigger and `recorded_at` is the database's
    // answer to "when did we learn of this" — a client clock has no business in either.
    expect(payload).not.toHaveProperty('created_by');
    expect(payload).not.toHaveProperty('recorded_at');
  });

  it('reports a refusal as a refusal and a lost answer as unknown', async () => {
    respond('insert:record_events', { data: null, error: { code: '42501' } });
    expect((await insertEvent({ accountId: ACCOUNT, kind: 'note', summary: 'x' })).ok).toBe(false);

    respond('insert:record_events', { data: null, error: { message: 'Failed to fetch' } });
    const lost = await insertEvent({ accountId: ACCOUNT, kind: 'note', summary: 'x' });
    expect(lost.ok === false && lost.reason).toBe('unknown');
  });
});

/*
 * `recordObligationEvidence` had a describe block here and no production caller. It has been
 * deleted rather than left as dead-but-tested code: lib/evidence.ts owns the compliance write,
 * and its own suite covers the obligation-to-event-kind mapping this one asserted. See the
 * comment where the function used to be in records.ts for why two writers on an append-only
 * table was a correctness problem and not a tidiness one.
 */

describe('the lines other files write', () => {
  it('writes nothing when there is no account to file it under', async () => {
    await logProductCreated(null, { id: 'p', specificationId: 's', name: 'Black Fig' });
    await logCompositionChanged(null, { id: 'p', specificationId: 's', name: 'Black Fig' });

    expect(db.state.calls).toHaveLength(0);
  });

  it('writes a readable line for a create and for a composition change', async () => {
    respond('insert:record_events', { data: { id: 'event-6' }, error: null });

    await logProductCreated(ACCOUNT, { id: 'p', specificationId: 's', name: 'Black Fig' });
    await logCompositionChanged(ACCOUNT, { id: 'p', specificationId: 's', name: 'Black Fig' });

    const summaries = callsFor('insert:record_events').map(
      (call) => (call.context.payload as Record<string, unknown>).summary
    );
    expect(summaries).toEqual([
    'Black Fig was created',
    'The composition of Black Fig was changed']
    );
  });

  it('does not throw when the log line fails, because the write it records already landed', async () => {
    respond('insert:record_events', { data: null, error: { code: '42501' } });

    await expect(
      logProductCreated(ACCOUNT, { id: 'p', specificationId: 's', name: 'Black Fig' })
    ).resolves.toBeUndefined();
  });
});

/* ------------------------------------------------------------ classifying */

describe('classifyRecordError', () => {
  it('reads hints before codes', () => {
    expect(classifyRecordError({ code: 'P0001', hint: 'account_missing' }).reason).toBe('no_account');
    expect(classifyRecordError({ code: 'P0001', hint: 'account_ambiguous' }).reason).toBe(
      'account_ambiguous'
    );
    expect(classifyRecordError({ code: 'P0001', hint: 'record_append_only' }).reason).toBe('refused');
  });

  it('separates what to fix from what to retry from what to escalate', () => {
    expect(classifyRecordError({ code: '23514' }).reason).toBe('invalid');
    expect(classifyRecordError({ code: '23502' }).reason).toBe('invalid');
    expect(classifyRecordError({ code: '23503' }).reason).toBe('refused');
    expect(classifyRecordError({ code: '42501' }).reason).toBe('refused');
    expect(classifyRecordError({ message: 'Failed to fetch' }).reason).toBe('failed');
    expect(classifyRecordError(null).reason).toBe('failed');
  });

  it('never offers a retry on a refusal', () => {
    expect(classifyRecordError({ code: '42501' }).message).toContain('trying again will not');
  });
});

describe('artefactCurrency', () => {
  const artefact = { specificationHash: 'hash-abc' } as ProducedArtefact;

  it('will not guess when the fingerprint could not be read', () => {
    // "Still matches" on a read that never happened is a compliance claim nothing checked;
    // "out of date" on the same read sends somebody to reprint stock that was fine.
    expect(artefactCurrency(artefact, null)).toBe('unknown');
    expect(artefactCurrency({ specificationHash: '' } as ProducedArtefact, 'hash-abc')).toBe('unknown');
  });

  it('answers from the two fingerprints when it has both', () => {
    expect(artefactCurrency(artefact, 'hash-abc')).toBe('current');
    expect(artefactCurrency(artefact, 'hash-xyz')).toBe('superseded');
  });
});

describe('the kind vocabulary', () => {
  it('matches the database CHECK, so a filter and a row cannot disagree', () => {
    expect(isRecordEventKind('batch.produced')).toBe(true);
    expect(isRecordEventKind('batch.destroyed')).toBe(false);
    expect(EVENT_GROUP['batch.produced']).toBe('production');
    expect(EVENT_GROUP['compliance.pcn_submitted']).toBe('compliance');
    expect(EVENT_GROUP['artefact.printed']).toBe('outputs');
  });
});
