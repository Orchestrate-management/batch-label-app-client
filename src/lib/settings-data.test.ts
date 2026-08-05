import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The four tables behind the Settings screen, exercised against the shapes supabase-js actually
 * hands back.
 *
 * THE FAILURE THIS FILE EXISTS FOR is the one a type check cannot see: PostgREST answers a
 * write that changed no rows with a 204 and NO ERROR. supabase-js reports that as success. So a
 * write refused by a row level security predicate — the shape of "this is not your account" —
 * arrives at the browser looking exactly like a save, and a maker who corrected the telephone
 * number that prints on their labels under CLP Article 17 would be told it was saved and would
 * go on believing their labels carry it.
 *
 * Every write here therefore ends in `.select()` and checks a row came back, and every test
 * below that pushes `data: null` with `error: null` is checking that we did not call it a save.
 *
 * The second thing being pinned is the schema. The domain moved out of `public` so a sibling
 * Orchestrate brand can hold its own `products`; a client that quietly went back would read an
 * empty decoy table and report an account as blank, which is a silent, plausible, wrong answer.
 */

const db = vi.hoisted(() => {
  const state = {
    /** Keyed by table, so one test can fail a read while another table succeeds. */
    reads: {} as Record<string, {data: unknown;error: unknown;}>,
    writes: {} as Record<string, {data: unknown;error: unknown;}>,
    payloads: [] as Array<[string, Record<string, unknown>, unknown]>,
    filters: [] as Array<[string, string, unknown]>,
    /** Which Postgres schema each call went through. */
    schemas: [] as string[],
    /** Which methods a write chained, so `.select()` cannot quietly be dropped. */
    chained: [] as string[]
  };

  const result = (table: string, kind: 'reads' | 'writes') =>
  state[kind][table] ?? { data: null, error: null };

  const query = (table: string, kind: 'reads' | 'writes') => {
    const q: Record<string, unknown> = {};
    Object.assign(q, {
      select: () => {
        state.chained.push(`${table}.select`);
        return q;
      },
      order: () => q,
      eq: (column: string, value: unknown) => {
        state.filters.push([table, column, value]);
        return q;
      },
      single: async () => result(table, kind),
      maybeSingle: async () => result(table, kind),
      then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
      Promise.resolve(result(table, kind)).then(resolve, reject)
    });
    return q;
  };

  const client: Record<string, unknown> = {
    schema(name: string) {
      state.schemas.push(name);
      return client;
    },
    from(table: string) {
      return {
        // A bare `.from(t).select(...)` is a READ; the same `.select()` after an insert or an
        // upsert is the thing that makes the write return its row, and both are recorded.
        select: () => {
          state.chained.push(`${table}.select`);
          return query(table, 'reads');
        },
        insert: (payload: Record<string, unknown>) => {
          state.payloads.push([table, payload, null]);
          return query(table, 'writes');
        },
        upsert: (payload: Record<string, unknown>, options: unknown) => {
          state.payloads.push([table, payload, options]);
          return query(table, 'writes');
        }
      };
    }
  };

  return { state, client };
});

vi.mock('./supabase', () => ({
  supabase: db.client,
  isSupabaseConfigured: true
}));

import {
  createDataRequest,
  describeWriteFailure,
  fetchBusinessIdentity,
  fetchDataRequests,
  fetchSupplierAddresses,
  fetchWorkspacePreferences,
  optional,
  readAddressLines,
  saveBusinessIdentity,
  saveSupplierAddress,
  saveWorkspacePreferences,
  validateIdentity } from
'./settings-data';

const ACCOUNT = '11111111-1111-1111-1111-111111111111';

const IDENTITY_ROW = {
  account_id: ACCOUNT,
  registered_name: 'Willow and Wick Ltd',
  trading_name: 'Willow & Wick',
  telephone: '01273 000000',
  email: null,
  website: null,
  vat_number: 'GB123456789',
  updated_at: '2026-08-04T10:00:00Z'
};

beforeEach(() => {
  db.state.reads = {};
  db.state.writes = {};
  db.state.payloads = [];
  db.state.filters = [];
  db.state.schemas = [];
  db.state.chained = [];
});

/* ------------------------------------------------------------- validation */

describe('the blank box, which the database refuses outright', () => {
  it('turns an untouched field into null rather than an empty string', () => {
    // `check (x is null or btrim(x) <> '')`. Without this a maker clearing their VAT number
    // gets a constraint violation instead of a save — and an empty string that DID land would
    // print as a blank line under a heading on a safety data sheet.
    expect(optional('')).toBeNull();
    expect(optional('   ')).toBeNull();
    expect(optional('  GB123  ')).toBe('GB123');
  });

  it('requires only the registered name, because that is all the table requires', () => {
    const base = {
      registeredName: '',
      tradingName: '',
      telephone: '',
      email: '',
      website: '',
      vatNumber: ''
    };
    expect(validateIdentity(base)).toMatch(/registered business name/i);
    // Telephone is NOT required to save. Requiring it would stop a maker recording their own
    // business name until they had typed a number; which absences block a PRINT is the
    // screen's sentence to say, not this function's.
    expect(validateIdentity({ ...base, registeredName: 'Acme Ltd' })).toBeNull();
  });
});

describe('address lines, whose shape the renderer depends on', () => {
  it('drops the blank lines a textarea collects by accident', () => {
    const { lines, error } = readAddressLines('Acme Ltd\n\n1 Test Street\n \nLewes BN7 2QA\n');
    expect(lines).toEqual(['Acme Ltd', '1 Test Street', 'Lewes BN7 2QA']);
    expect(error).toBeNull();
  });

  it('refuses fewer than three and more than six, matching the CHECK', () => {
    expect(readAddressLines('Acme Ltd\nLewes').error).toMatch(/at least three/i);
    expect(readAddressLines('a\nb\nc\nd\ne\nf\ng').error).toMatch(/at most six/i);
  });
});

/* ------------------------------------------------------------------ reads */

describe('reading the printed identity', () => {
  it('goes through the batchlabel schema, not public', () => {
    db.state.reads.business_identity = { data: IDENTITY_ROW, error: null };
    return fetchBusinessIdentity(ACCOUNT).then(() => {
      expect(db.state.schemas).toContain('batchlabel');
      expect(db.state.schemas).not.toContain('public');
    });
  });

  it('is scoped to the account it was asked for', async () => {
    db.state.reads.business_identity = { data: IDENTITY_ROW, error: null };
    await fetchBusinessIdentity(ACCOUNT);
    expect(db.state.filters).toContainEqual(['business_identity', 'account_id', ACCOUNT]);
  });

  it('reads no row as "never saved", which is not a failure', async () => {
    db.state.reads.business_identity = { data: null, error: null };
    const result = await fetchBusinessIdentity(ACCOUNT);
    expect(result).toEqual({ ok: true, value: null });
  });

  it('reads a failure as a failure, and says nothing has been lost', async () => {
    // The house rule this file is here to hold: an empty state means empty, a failure means
    // failure, and they never share a sentence. Rendered as "you have told us nothing", a
    // failed read looks to a maker exactly like their supplier block having been wiped.
    db.state.reads.business_identity = { data: null, error: { message: 'boom' } };
    const result = await fetchBusinessIdentity(ACCOUNT);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.message).toMatch(/nothing has been lost/i);
  });

  it('maps the row into what the renderer prints', async () => {
    db.state.reads.business_identity = { data: IDENTITY_ROW, error: null };
    const result = await fetchBusinessIdentity(ACCOUNT);
    expect(result.ok && result.value).toEqual({
      registeredName: 'Willow and Wick Ltd',
      tradingName: 'Willow & Wick',
      telephone: '01273 000000',
      email: null,
      website: null,
      vatNumber: 'GB123456789',
      updatedAt: '2026-08-04T10:00:00Z'
    });
  });

  it('reads no address blocks as none stored, not as an error', async () => {
    db.state.reads.supplier_addresses = { data: [], error: null };
    const result = await fetchSupplierAddresses(ACCOUNT);
    expect(result).toEqual({ ok: true, value: [] });
  });
});

/* ----------------------------------------------------------------- writes */

describe('saving the supplier block', () => {
  it('sends the account id, because the primary key has no default', async () => {
    db.state.writes.business_identity = { data: IDENTITY_ROW, error: null };
    await saveBusinessIdentity(ACCOUNT, {
      registeredName: '  Willow and Wick Ltd  ',
      tradingName: 'Willow & Wick',
      telephone: '01273 000000',
      email: '',
      website: '   ',
      vatNumber: 'GB123456789'
    });

    const [table, payload, options] = db.state.payloads[0];
    expect(table).toBe('business_identity');
    expect(payload.account_id).toBe(ACCOUNT);
    expect(payload.registered_name).toBe('Willow and Wick Ltd');
    // The two boxes left alone go as NULL. An empty string is refused by the CHECK, and one
    // that got through would print as a blank line under a heading.
    expect(payload.email).toBeNull();
    expect(payload.website).toBeNull();
    expect(options).toEqual({ onConflict: 'account_id' });
  });

  it('asks for the row back, so a refusal cannot look like a save', async () => {
    db.state.writes.business_identity = { data: IDENTITY_ROW, error: null };
    await saveBusinessIdentity(ACCOUNT, {
      registeredName: 'Acme Ltd',
      tradingName: '',
      telephone: '',
      email: '',
      website: '',
      vatNumber: ''
    });
    expect(db.state.chained).toContain('business_identity.select');
  });

  /**
   * THE ONE THAT MATTERS. No error and no row is what an RLS refusal looks like over PostgREST.
   * Reported as a save, it tells a maker their printed telephone number is stored when it is not.
   */
  it('refuses to call a write with no row back a save', async () => {
    db.state.writes.business_identity = { data: null, error: null };
    const result = await saveBusinessIdentity(ACCOUNT, {
      registeredName: 'Acme Ltd',
      tradingName: '',
      telephone: '',
      email: '',
      website: '',
      vatNumber: ''
    });
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.message).toMatch(/could not confirm/i);
  });

  it('stops a nameless save before the network', async () => {
    const result = await saveBusinessIdentity(ACCOUNT, {
      registeredName: '   ',
      tradingName: 'Something',
      telephone: '',
      email: '',
      website: '',
      vatNumber: ''
    });
    expect(result.ok).toBe(false);
    expect(db.state.payloads).toHaveLength(0);
  });

  it('hands back the row the database returned, not the input it was given', async () => {
    db.state.writes.business_identity = { data: IDENTITY_ROW, error: null };
    const result = await saveBusinessIdentity(ACCOUNT, {
      registeredName: 'Typed differently',
      tradingName: '',
      telephone: '',
      email: '',
      website: '',
      vatNumber: ''
    });
    expect(result.ok && result.value.registeredName).toBe('Willow and Wick Ltd');
  });
});

describe('saving an address block', () => {
  const lines = ['Willow and Wick Ltd', '1 Test Street', 'Lewes BN7 2QA'];

  it('upserts on the account and market pair', async () => {
    db.state.writes.supplier_addresses = {
      data: { id: 'a1', market: 'GB', lines, updated_at: null },
      error: null
    };
    await saveSupplierAddress(ACCOUNT, {
      market: 'GB',
      label: 'Great Britain',
      role: 'Supplier and manufacturer',
      lines,
      isDefault: true
    });
    const [table, payload, options] = db.state.payloads[0];
    expect(table).toBe('supplier_addresses');
    expect(payload.market).toBe('GB');
    expect(options).toEqual({ onConflict: 'account_id,market' });
  });

  it('refuses a shape the column would refuse, before the network', async () => {
    const short = await saveSupplierAddress(ACCOUNT, {
      market: 'GB',
      label: 'Great Britain',
      role: 'Supplier and manufacturer',
      lines: ['One', 'Two'],
      isDefault: true
    });
    expect(short.ok).toBe(false);
    expect(db.state.payloads).toHaveLength(0);

    const blank = await saveSupplierAddress(ACCOUNT, {
      market: 'GB',
      label: 'Great Britain',
      role: 'Supplier and manufacturer',
      lines: ['One', '  ', 'Three'],
      isDefault: true
    });
    expect(blank.ok).toBe(false);
    expect(blank.ok === false && blank.message).toMatch(/blank line/i);
    expect(db.state.payloads).toHaveLength(0);
  });

  it('does not call a write with no row back a save', async () => {
    db.state.writes.supplier_addresses = { data: null, error: null };
    const result = await saveSupplierAddress(ACCOUNT, {
      market: 'GB',
      label: 'Great Britain',
      role: 'Supplier and manufacturer',
      lines,
      isDefault: true
    });
    expect(result.ok).toBe(false);
  });
});

describe('saving preferences', () => {
  it('sends the whole row, so an upsert cannot reset a column to its default', async () => {
    db.state.writes.workspace_preferences = {
      data: {
        account_id: ACCOUNT,
        enabled_categories: ['home-fragrance'],
        default_market: 'GB',
        default_export: null
      },
      error: null
    };
    await saveWorkspacePreferences(ACCOUNT, {
      enabledCategories: ['home-fragrance'],
      defaultMarket: 'GB',
      defaultExport: null
    });
    const [, payload] = db.state.payloads[0];
    expect(payload).toMatchObject({
      account_id: ACCOUNT,
      enabled_categories: ['home-fragrance'],
      default_market: 'GB',
      default_export: null
    });
  });

  it('refuses an empty category list rather than sending a write the CHECK will reject', async () => {
    const result = await saveWorkspacePreferences(ACCOUNT, {
      enabledCategories: [],
      defaultMarket: null,
      defaultExport: null
    });
    expect(result.ok).toBe(false);
    expect(db.state.payloads).toHaveLength(0);
  });

  it('reads no preferences row as "never set", not as a failure', async () => {
    db.state.reads.workspace_preferences = { data: null, error: null };
    expect(await fetchWorkspacePreferences(ACCOUNT)).toEqual({ ok: true, value: null });
  });
});

/* ----------------------------------------------------------- data requests */

describe('recording a data export or erasure request', () => {
  it('inserts a request and nothing else', async () => {
    db.state.writes.account_data_requests = {
      data: {
        id: 'r1',
        kind: 'erasure',
        status: 'requested',
        requested_at: '2026-08-05T09:00:00Z',
        completed_at: null,
        note: null
      },
      error: null
    };
    const result = await createDataRequest(ACCOUNT, 'erasure');

    const [table, payload] = db.state.payloads[0];
    expect(table).toBe('account_data_requests');
    expect(payload).toEqual({ account_id: ACCOUNT, kind: 'erasure' });
    // The status is the server's to set and this app holds no UPDATE. Sending one would be a
    // browser claiming an outcome it cannot produce.
    expect(payload).not.toHaveProperty('status');
    expect(payload).not.toHaveProperty('completed_at');
    expect(result.ok && result.value.status).toBe('requested');
  });

  it('tells the maker to email us rather than claiming a request we cannot see', async () => {
    db.state.writes.account_data_requests = { data: null, error: null };
    const result = await createDataRequest(ACCOUNT, 'export');
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.message).toMatch(/hello@batchlabel\.xyz/);
  });

  it('reads an account with no requests as none, not as an error', async () => {
    db.state.reads.account_data_requests = { data: [], error: null };
    expect(await fetchDataRequests(ACCOUNT)).toEqual({ ok: true, value: [] });
  });
});

/* ------------------------------------------------------------- error voice */

describe('what a Postgres failure is turned into', () => {
  it('names the constraint a maker can act on, in words they can act on', () => {
    expect(
      describeWriteFailure({
        message: 'violates check constraint "business_identity_blank_check"'
      })
    ).toMatch(/only spaces/i);
    expect(
      describeWriteFailure({ message: 'violates check constraint "supplier_addresses_lines_check"' })
    ).toMatch(/three and six/i);
  });

  it('never repeats the Postgres message at a candle maker', () => {
    const said = describeWriteFailure({
      code: '23514',
      message: 'new row for relation "business_identity" violates check constraint "x"'
    });
    expect(said).not.toMatch(/relation|constraint|new row/i);
  });

  it('says a refusal is a refusal without guessing why', () => {
    expect(describeWriteFailure({ code: '42501', message: 'permission denied' })).toMatch(
      /did not accept that change/i
    );
  });
});

/* ---------------------------------------------------------- not connected */

describe('with no database connection at all', () => {
  it('says so instead of reporting an empty account', async () => {
    vi.resetModules();
    vi.doMock('./supabase', () => ({ supabase: null, isSupabaseConfigured: false }));
    const module = await import('./settings-data');

    const read = await module.fetchBusinessIdentity(ACCOUNT);
    const write = await module.saveBusinessIdentity(ACCOUNT, {
      registeredName: 'Acme Ltd',
      tradingName: '',
      telephone: '',
      email: '',
      website: '',
      vatNumber: ''
    });

    expect(read.ok).toBe(false);
    expect(read.ok === false && read.message).toMatch(/not connected/i);
    expect(write.ok).toBe(false);
    vi.doUnmock('./supabase');
    vi.resetModules();
  });
});

/* ------------------------------------------- the branches a bad day takes */

describe('a read or a write that the database refused outright', () => {
  it('says so for every table, and never as an empty account', async () => {
    db.state.reads.supplier_addresses = { data: null, error: { message: 'boom' } };
    db.state.reads.workspace_preferences = { data: null, error: { message: 'boom' } };
    db.state.reads.account_data_requests = { data: null, error: { message: 'boom' } };

    const addresses = await fetchSupplierAddresses(ACCOUNT);
    const preferences = await fetchWorkspacePreferences(ACCOUNT);
    const requests = await fetchDataRequests(ACCOUNT);

    expect(addresses.ok).toBe(false);
    expect(addresses.ok === false && addresses.message).toMatch(/nothing has been lost/i);
    expect(preferences.ok).toBe(false);
    expect(requests.ok).toBe(false);
    // None of the three may be the empty answer. "You have no address blocks" and "we could
    // not read your address blocks" are opposite instructions to somebody about to print.
    expect(addresses.ok === false && addresses.message).not.toMatch(/^$/);
  });

  it('turns a Postgres error on a write into a sentence, for each table', async () => {
    db.state.writes.business_identity = {
      data: null,
      error: { message: 'violates check constraint "business_identity_name_check"' }
    };
    db.state.writes.supplier_addresses = { data: null, error: { message: 'nope' } };
    db.state.writes.workspace_preferences = {
      data: null,
      error: { message: 'violates check constraint "workspace_preferences_categories_check"' }
    };
    db.state.writes.account_data_requests = { data: null, error: { code: '42501', message: 'denied' } };

    const identity = await saveBusinessIdentity(ACCOUNT, {
      registeredName: 'Acme Ltd',
      tradingName: '',
      telephone: '',
      email: '',
      website: '',
      vatNumber: ''
    });
    const address = await saveSupplierAddress(ACCOUNT, {
      market: 'EU',
      label: 'European Union and Northern Ireland',
      role: 'Responsible person and economic operator',
      lines: ['A', 'B', 'C'],
      isDefault: false
    });
    const preferences = await saveWorkspacePreferences(ACCOUNT, {
      enabledCategories: ['home-fragrance'],
      defaultMarket: null,
      defaultExport: null
    });
    const request = await createDataRequest(ACCOUNT, 'export');

    expect(identity.ok === false && identity.message).toMatch(/registered business name/i);
    expect(address.ok === false && address.message).toMatch(/could not save that just now/i);
    expect(preferences.ok === false && preferences.message).toMatch(/at least one category/i);
    expect(request.ok === false && request.message).toMatch(/did not accept that change/i);
  });

  it('reads a row-level-security refusal by its message as well as its code', () => {
    expect(
      describeWriteFailure({ message: 'new row violates row-level security policy' })
    ).toMatch(/did not accept that change/i);
    expect(describeWriteFailure(null)).toMatch(/could not save that just now/i);
    expect(describeWriteFailure({})).toMatch(/could not save that just now/i);
  });
});

describe('rows that arrive missing the columns we asked for', () => {
  it('reads an absent optional field as absent, never as an empty string on a label', async () => {
    db.state.reads.business_identity = { data: { registered_name: 'Acme Ltd' }, error: null };
    const result = await fetchBusinessIdentity(ACCOUNT);
    expect(result.ok && result.value).toEqual({
      registeredName: 'Acme Ltd',
      tradingName: null,
      telephone: null,
      email: null,
      website: null,
      vatNumber: null,
      updatedAt: null
    });
  });

  it('reads an address whose lines did not come back as no lines, not as a crash', async () => {
    db.state.reads.supplier_addresses = {
      data: [{ id: 'a1', market: 'GB' }],
      error: null
    };
    const result = await fetchSupplierAddresses(ACCOUNT);
    expect(result.ok && result.value[0].lines).toEqual([]);
    expect(result.ok && result.value[0].updatedAt).toBeNull();
  });

  it('reads a preferences row with no categories array as none set', async () => {
    db.state.reads.workspace_preferences = { data: { account_id: ACCOUNT }, error: null };
    const result = await fetchWorkspacePreferences(ACCOUNT);
    expect(result.ok && result.value).toEqual({
      enabledCategories: [],
      defaultMarket: null,
      defaultExport: null
    });
  });

  it('reads a null list as an empty list rather than throwing', async () => {
    db.state.reads.supplier_addresses = { data: null, error: null };
    db.state.reads.account_data_requests = { data: null, error: null };
    expect(await fetchSupplierAddresses(ACCOUNT)).toEqual({ ok: true, value: [] });
    expect(await fetchDataRequests(ACCOUNT)).toEqual({ ok: true, value: [] });
  });

  it('reads a request row with no note or completion as exactly that', async () => {
    db.state.reads.account_data_requests = {
      data: [{ id: 'r1', kind: 'export', status: 'requested', requested_at: '2026-08-05T09:00:00Z' }],
      error: null
    };
    const result = await fetchDataRequests(ACCOUNT);
    expect(result.ok && result.value[0]).toEqual({
      id: 'r1',
      kind: 'export',
      status: 'requested',
      requestedAt: '2026-08-05T09:00:00Z',
      completedAt: null,
      note: null
    });
  });
});

describe('with no database connection, on every path', () => {
  it('refuses each read and each write in the same voice', async () => {
    vi.resetModules();
    vi.doMock('./supabase', () => ({ supabase: null, isSupabaseConfigured: false }));
    const module = await import('./settings-data');

    const results = [
    await module.fetchSupplierAddresses(ACCOUNT),
    await module.fetchWorkspacePreferences(ACCOUNT),
    await module.fetchDataRequests(ACCOUNT),
    await module.saveSupplierAddress(ACCOUNT, {
      market: 'GB',
      label: 'Great Britain',
      role: 'Supplier and manufacturer',
      lines: ['A', 'B', 'C'],
      isDefault: true
    }),
    await module.saveWorkspacePreferences(ACCOUNT, {
      enabledCategories: ['home-fragrance'],
      defaultMarket: null,
      defaultExport: null
    }),
    await module.createDataRequest(ACCOUNT, 'export')];


    for (const result of results) {
      expect(result.ok).toBe(false);
      expect(result.ok === false && result.message).toMatch(/not connected/i);
    }
    vi.doUnmock('./supabase');
    vi.resetModules();
  });
});
