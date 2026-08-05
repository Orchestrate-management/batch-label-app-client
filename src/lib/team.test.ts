import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * WHO IS IN AN ACCOUNT, AND EVERY WAY THAT READ OR WRITE CAN GO WRONG.
 *
 * The fake below is the smallest thing that can tell the failures apart, and telling them apart
 * is the whole subject: a read that failed and an account with nobody in it look identical to a
 * screen, and so do a write that was refused and a write that reached no row. This repo has
 * shipped both confusions before, which is why every one of them has a case here.
 */

const db = vi.hoisted(() => {
  const state = {
    rpc: [] as Array<[string, unknown]>,
    rpcResults: {} as Record<string, {data: unknown;error: unknown;}>,
    reads: {} as Record<string, {data: unknown;error: unknown;}>,
    filters: [] as Array<[string, string, unknown]>,
    updates: [] as Array<[string, Record<string, unknown>]>,
    updateResult: { data: [{ user_id: 'u-2' }] as unknown, error: null as unknown },
    session: 'token-abc' as string | null,
    fetches: [] as Array<[string, RequestInit | undefined]>,
    fetchResponse: null as unknown
  };

  const read = (table: string) => state.reads[table] ?? { data: [], error: null };

  const supabase = {
    auth: {
      getSession: async () => ({
        data: { session: state.session ? { access_token: state.session } : null }
      })
    },
    async rpc(name: string, args: unknown) {
      state.rpc.push([name, args]);
      return state.rpcResults[name] ?? { data: null, error: null };
    },
    from(table: string) {
      return {
        select() {
          const q: Record<string, unknown> = {};
          const chain = () => q;
          Object.assign(q, {
            order: chain,
            eq: (column: string, value: unknown) => {
              state.filters.push([table, column, value]);
              return q;
            },
            then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
            Promise.resolve(read(table)).then(resolve, reject)
          });
          return q;
        },
        update(payload: Record<string, unknown>) {
          const q: Record<string, unknown> = {};
          const settle = () => {
            state.updates.push([table, payload]);
            return state.updateResult;
          };
          Object.assign(q, {
            eq: (column: string, value: unknown) => {
              state.filters.push([table, column, value]);
              return q;
            },
            select: () => Promise.resolve(settle()),
            then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
            Promise.resolve(settle()).then(resolve, reject)
          });
          return q;
        }
      };
    }
  };

  return { state, supabase };
});

vi.mock('./supabase', () => ({ supabase: db.supabase, isSupabaseConfigured: true }));

import {
  INVITE_ENDPOINT,
  acceptInvite,
  changeMemberRole,
  describeMemberFailure,
  fetchAccountEntitlement,
  fetchInvites,
  fetchMembers,
  fetchMyAccounts,
  fetchPermissionMatrix,
  revokeInvite,
  seatState,
  sendInvite,
  setMemberStatus } from
'./team';

beforeEach(() => {
  db.state.rpc = [];
  db.state.rpcResults = {};
  db.state.reads = {};
  db.state.filters = [];
  db.state.updates = [];
  db.state.updateResult = { data: [{ user_id: 'u-2' }], error: null };
  db.state.session = 'token-abc';
  db.state.fetches = [];
  db.state.fetchResponse = null;
  vi.unstubAllGlobals();
});

function stubFetch(response: {status: number;ok?: boolean;body?: unknown;} | 'throw') {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      db.state.fetches.push([String(url), init]);
      if (response === 'throw') throw new TypeError('network');
      return {
        ok: response.ok ?? (response.status >= 200 && response.status < 300),
        status: response.status,
        json: async () => response.body ?? null
      };
    })
  );
}

/* ------------------------------------------------------------- accounts */

describe('the accounts a person is in', () => {
  it('reads them from my_accounts(), which takes no argument and is therefore not a probe', async () => {
    db.state.rpcResults.my_accounts = {
      data: [
      {
        account_id: 'acct-1',
        brand: 'batchlabel',
        account_name: 'Hearth and Hollow',
        role: 'owner',
        role_rank: 40,
        role_label: 'Owner',
        is_owner: true,
        joined_at: '2026-01-01T00:00:00Z'
      }],

      error: null
    };

    const result = await fetchMyAccounts();

    expect(db.state.rpc).toEqual([['my_accounts', undefined]]);
    expect(result.ok).toBe(true);
    expect(result.accounts).toEqual([
    {
      accountId: 'acct-1',
      brand: 'batchlabel',
      accountName: 'Hearth and Hollow',
      role: 'owner',
      roleRank: 40,
      roleLabel: 'Owner',
      isOwner: true,
      joinedAt: '2026-01-01T00:00:00Z'
    }]
    );
  });

  it('drops a row with no account id or no role rather than rendering a broken one', async () => {
    db.state.rpcResults.my_accounts = {
      data: [{ account_id: 'acct-1' }, { role: 'owner' }, { account_id: 'acct-2', role: 'viewer' }],
      error: null
    };
    const result = await fetchMyAccounts();
    expect(result.accounts.map((entry) => entry.accountId)).toEqual(['acct-2']);
  });

  it('separates a read that FAILED from an account list that is empty', async () => {
    // The distinction the whole app turns on. Empty means signup did not finish, and every
    // screen says so with a next step attached. A failure means we could not look, and telling
    // a paying customer their account is gone is the sentence this repo keeps having to remove.
    db.state.rpcResults.my_accounts = { data: null, error: { code: '08006' } };
    const failed = await fetchMyAccounts();
    expect(failed.ok).toBe(false);
    expect(failed.missing).toBe(false);
    expect(failed.message).toBeTruthy();

    db.state.rpcResults.my_accounts = { data: [], error: null };
    const empty = await fetchMyAccounts();
    expect(empty.ok).toBe(true);
    expect(empty.accounts).toEqual([]);
    expect(empty.message).toBeNull();
  });

  it('names a database that has no my_accounts() at all as its own state, not as zero accounts', async () => {
    // PGRST202 is what PostgREST answers for a function it does not publish, which is the
    // ordinary condition of an environment the day this app deploys ahead of its migrations.
    // Reading it as "you are in no accounts" would black out every screen for everybody.
    db.state.rpcResults.my_accounts = { data: null, error: { code: 'PGRST202' } };
    const result = await fetchMyAccounts();
    expect(result.ok).toBe(false);
    expect(result.missing).toBe(true);
    // And it says nothing to the customer, because nothing has gone wrong for them.
    expect(result.message).toBeNull();
  });
});

describe('the entitlement for one account', () => {
  it('asks by account id rather than by who owns it', async () => {
    db.state.rpcResults.account_entitlement = {
      data: [{ account_id: 'acct-1', plan: 'studio', seats_in_use: 2, caller_role: 'editor' }],
      error: null
    };
    const result = await fetchAccountEntitlement('acct-1');
    expect(db.state.rpc).toEqual([['account_entitlement', { p_account_id: 'acct-1' }]]);
    expect(result.ok).toBe(true);
    expect(result.row).toMatchObject({ caller_role: 'editor', seats_in_use: 2 });
  });

  it('reads no rows as no row rather than as a failure', async () => {
    // Zero rows is what a stranger gets, and it is a real answer: the is_member_of guard on the
    // function refused them. It is not the same as the read breaking.
    db.state.rpcResults.account_entitlement = { data: [], error: null };
    const result = await fetchAccountEntitlement('acct-1');
    expect(result.ok).toBe(true);
    expect(result.row).toBeNull();
  });

  it('flags a database without the function so the caller can fall back to the view', async () => {
    db.state.rpcResults.account_entitlement = { data: null, error: { code: 'PGRST202' } };
    const result = await fetchAccountEntitlement('acct-1');
    expect(result.ok).toBe(false);
    expect(result.missing).toBe(true);
  });
});

describe('the live permission matrix', () => {
  it('reads both tables and hands back what the database says', async () => {
    db.state.reads.account_roles = {
      data: [{ role: 'viewer', rank: 10, consumes_seat: false, label: 'Read only' }],
      error: null
    };
    db.state.reads.account_capabilities = {
      data: [{ capability: 'read', min_rank: 10 }],
      error: null
    };
    const matrix = await fetchPermissionMatrix();
    expect(matrix).toEqual({
      roles: [{ role: 'viewer', rank: 10, consumesSeat: false, label: 'Read only' }],
      capabilities: [{ capability: 'read', minRank: 10 }]
    });
  });

  it('refuses half a matrix rather than merging it with the compiled copy', async () => {
    // Half a ladder answers questions confidently and wrongly. Returning null sends the caller
    // to the compiled matrix whole, which is at least internally consistent.
    db.state.reads.account_roles = { data: [{ role: 'viewer', rank: 10 }], error: null };
    db.state.reads.account_capabilities = { data: [], error: null };
    expect(await fetchPermissionMatrix()).toBeNull();
  });

  it('returns null when either read failed', async () => {
    db.state.reads.account_roles = { data: null, error: { code: '42P01' } };
    db.state.reads.account_capabilities = { data: [{ capability: 'read', min_rank: 10 }], error: null };
    expect(await fetchPermissionMatrix()).toBeNull();
  });
});

/* --------------------------------------------------------------- people */

describe('the member list', () => {
  it('scopes the read to the account and orders by when people joined', async () => {
    db.state.reads.account_members = {
      data: [{ user_id: 'u-1', role: 'owner', status: 'active', created_at: '2026-01-01' }],
      error: null
    };
    db.state.reads.account_invite_list = { data: [], error: null };

    const result = await fetchMembers('acct-1');

    expect(db.state.filters).toContainEqual(['account_members', 'account_id', 'acct-1']);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual([
      { userId: 'u-1', role: 'owner', status: 'active', joinedAt: '2026-01-01', email: null }]
      );
    }
  });

  it('names a member from the invitation they accepted, which is the only address it can see', async () => {
    // public.profiles publishes `auth.uid() = id`, so the browser can only ever read its own
    // email. account_invite_list carries the invited address alongside accepted_by and is
    // readable only by a manager, which is where every other name on this screen comes from.
    db.state.reads.account_members = {
      data: [
      { user_id: 'u-1', role: 'owner', status: 'active', created_at: '2026-01-01' },
      { user_id: 'u-2', role: 'editor', status: 'active', created_at: '2026-02-01' }],

      error: null
    };
    db.state.reads.account_invite_list = {
      data: [
      {
        id: 'inv-1',
        email: 'ada@example.com',
        role: 'editor',
        status: 'accepted',
        accepted_by: 'u-2'
      }],

      error: null
    };

    const result = await fetchMembers('acct-1');
    expect(result.ok && result.value.map((entry) => entry.email)).toEqual([null, 'ada@example.com']);
  });

  it('still lists the members when the invitation read is refused, which is a viewer normally', async () => {
    // An editor or a viewer is refused the invite list by policy. That is correct and is not an
    // error to report: the team screen must not be an email harvest for the least privileged
    // member. What it must not do is lose the member list along with it.
    db.state.reads.account_members = {
      data: [{ user_id: 'u-1', role: 'viewer', status: 'active', created_at: '2026-01-01' }],
      error: null
    };
    db.state.reads.account_invite_list = { data: null, error: { code: '42501' } };

    const result = await fetchMembers('acct-1');
    expect(result.ok).toBe(true);
    expect(result.ok && result.value).toHaveLength(1);
  });

  it('reports a failed member read as a failure rather than as an empty account', async () => {
    db.state.reads.account_members = { data: null, error: { code: '08006' } };
    const result = await fetchMembers('acct-1');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/this is us/i);
  });
});

describe('the invitation list', () => {
  it('reads the VIEW and never the table', async () => {
    // PostgREST issues `select *`, and against a column-granted table that is a blanket 42501
    // for everybody including the admin entitled to read the row. The view is every column
    // except token_hash, so `select *` on it succeeds.
    db.state.reads.account_invite_list = {
      data: [
      {
        id: 'inv-1',
        email: 'ada@example.com',
        role: 'editor',
        status: 'pending',
        created_at: '2026-08-01',
        expires_at: '2026-08-08',
        accepted_at: null,
        accepted_by: null
      }],

      error: null
    };
    const result = await fetchInvites('acct-1');
    expect(db.state.filters).toContainEqual(['account_invite_list', 'account_id', 'acct-1']);
    expect(result.ok && result.value[0]).toMatchObject({ status: 'pending', email: 'ada@example.com' });
  });

  it('reads a status word it has never heard of as unknown, never as pending', async () => {
    // Calling a revoked invitation pending would show a seat as reserved that is not, and would
    // offer a Withdraw button for something already withdrawn.
    db.state.reads.account_invite_list = {
      data: [{ id: 'inv-1', email: 'a@b.c', role: 'editor', status: 'quarantined' }],
      error: null
    };
    const result = await fetchInvites('acct-1');
    expect(result.ok && result.value[0].status).toBe('unknown');
  });
});

/* ---------------------------------------------------------------- seats */

describe('the seat picture', () => {
  it('counts what is used against what the plan allows', () => {
    expect(seatState(3, 1)).toEqual({ limit: 3, inUse: 1, full: false, remaining: 2, over: false });
    expect(seatState(3, 3)).toEqual({ limit: 3, inUse: 3, full: true, remaining: 0, over: false });
  });

  it('treats over-limit as a normal steady state and never as an error', () => {
    // editor_seat_limit follows the plan DOWN inside the same UPDATE that writes the plan, so a
    // downgrade puts an account over its ceiling within one webhook. Block new consumption,
    // strip nobody. `remaining` is clamped so no screen can offer a negative number of seats.
    expect(seatState(1, 3)).toEqual({ limit: 1, inUse: 3, full: true, remaining: 0, over: true });
  });

  it('does NOT read unknown as full, so a failed read never hides the only useful control', () => {
    // One honest refusal from the database beats hiding the invite form on a number we could not
    // read. The ceiling is enforced at commit whatever this said.
    expect(seatState(null, 2).full).toBe(false);
    expect(seatState(3, null).full).toBe(false);
    expect(seatState(null, null).remaining).toBeNull();
  });
});

/* --------------------------------------------------------------- writes */

describe('changing what somebody may do', () => {
  it('sends the role and scopes the statement to the account as well as the person', async () => {
    const result = await changeMemberRole('acct-1', 'u-2', 'admin');
    expect(result.ok).toBe(true);
    expect(db.state.updates).toEqual([['account_members', { role: 'admin' }]]);
    expect(db.state.filters).toContainEqual(['account_members', 'account_id', 'acct-1']);
    expect(db.state.filters).toContainEqual(['account_members', 'user_id', 'u-2']);
  });

  it('sends nothing but the role, because the column grant is (role, status) and nothing else', () => {
    // account_id and user_id are unreachable to the browser by COLUMN PRIVILEGE, which is
    // checked before row level security is consulted. A payload carrying either would be a
    // 42501 for a reason no screen could explain.
    expect(db.state.updates.every(([, payload]) => !('account_id' in payload))).toBe(true);
  });

  it('reads a statement that reached no row as a refusal, never as a save', async () => {
    // On this table it has a sharper cause than usual: the UPDATE policy compares ranks in its
    // USING clause, so a row ABOVE your own rank is INVISIBLE to your update. An admin trying to
    // demote the owner gets no error and no row, and reading that as success would tell somebody
    // they had removed the owner of the business.
    db.state.updateResult = { data: [], error: null };
    const result = await changeMemberRole('acct-1', 'u-2', 'admin');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/nothing changed/i);
  });

  it('removes by status rather than by deleting, so the record of who was here survives', async () => {
    const result = await setMemberStatus('acct-1', 'u-2', 'removed');
    expect(result.ok).toBe(true);
    expect(db.state.updates).toEqual([['account_members', { status: 'removed' }]]);
  });

  it('withdraws an invitation by stamping revoked_at, which is the only column it may write', async () => {
    db.state.updateResult = { data: [{ id: 'inv-1' }], error: null };
    const result = await revokeInvite('inv-1');
    expect(result.ok).toBe(true);
    const [[table, payload]] = db.state.updates;
    expect(table).toBe('account_invites');
    expect(Object.keys(payload)).toEqual(['revoked_at']);
  });

  it('reads a withdrawal that reached nothing as a refusal too', async () => {
    db.state.updateResult = { data: [], error: null };
    const result = await revokeInvite('inv-1');
    expect(result.ok).toBe(false);
  });
});

describe('the sentence a refused membership write says', () => {
  it('matches the HINT and never the database message, which is copy that will be rewritten', () => {
    expect(describeMemberFailure({ hint: 'seat_limit_reached', message: 'anything at all' })).
    toMatch(/editor seats/i);
    expect(describeMemberFailure({ hint: 'owner_floor' })).toMatch(/always has an owner/i);
    expect(describeMemberFailure({ hint: 'owner_mismatch' })).toMatch(/billed to/i);
  });

  it('says what to do about a full account rather than only that it is full', () => {
    const sentence = describeMemberFailure({ hint: 'seat_limit_reached' });
    expect(sentence).toMatch(/read-only seats are free and unlimited/i);
    expect(sentence).toMatch(/billing page/i);
  });

  it('offers no retry on a policy refusal, because a retry fails identically', () => {
    const sentence = describeMemberFailure({ code: '42501' });
    expect(sentence).toMatch(/waiting will not clear it/i);
  });

  it('names a second owner and an unknown role as themselves', () => {
    expect(describeMemberFailure({ code: '23505' })).toMatch(/only have one owner/i);
    expect(describeMemberFailure({ code: '23503' })).toMatch(/not a role this account recognises/i);
  });

  it('falls back to an honest generic rather than repeating a Postgres message', () => {
    const sentence = describeMemberFailure({ code: 'XX000', message: 'internal error 7' });
    expect(sentence).not.toContain('internal error 7');
    expect(sentence).toMatch(/nothing has changed/i);
  });
});

/* ---------------------------------------------------------- invitations */

describe('sending an invitation', () => {
  it('posts to the marketing origin with a bearer token and sends no actor', async () => {
    // The server takes who is asking from the VERIFIED token and from nowhere else, exactly as
    // the billing endpoints do. An edited body cannot invite somebody into a stranger's account.
    stubFetch({ status: 200, body: { ok: true } });
    const result = await sendInvite({ accountId: 'acct-1', email: ' Ada@Example.com ', role: 'editor' });

    expect(result.ok).toBe(true);
    const [url, init] = db.state.fetches[0];
    expect(url).toContain(INVITE_ENDPOINT);
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer token-abc');
    const body = JSON.parse(String(init?.body));
    expect(body).toEqual({ account_id: 'acct-1', email: 'Ada@Example.com', role: 'editor' });
    expect(body).not.toHaveProperty('actor');
    expect(body).not.toHaveProperty('user_id');
  });

  it('never receives a token, because a token that transits a browser is a leaked token', async () => {
    // create_account_invite is service-role only and returns the plaintext exactly once, to the
    // server that emails it. A token in a browser is a token in a history entry, a network tab,
    // a screen share and a referrer.
    stubFetch({ status: 200, body: { ok: true } });
    const result = await sendInvite({ accountId: 'acct-1', email: 'a@b.c', role: 'viewer' });
    expect(result).toEqual({ ok: true });
    expect(JSON.stringify(result)).not.toContain('token');
  });

  it('names an endpoint that is not deployed rather than blaming the address', async () => {
    // The www route does not exist yet. Reporting that as "we could not send it, try again"
    // would have somebody retyping a colleague's email address at a 404 all afternoon.
    stubFetch({ status: 404 });
    const result = await sendInvite({ accountId: 'acct-1', email: 'a@b.c', role: 'editor' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('not_deployed');
      expect(result.message).toMatch(/not switched on/i);
      expect(result.message).toContain('hello@batchlabel.xyz');
    }
  });

  it('reads the seat ceiling off the hint and says what to do about it', async () => {
    stubFetch({ status: 409, body: { hint: 'seat_limit_reached', error: 'refused' } });
    const result = await sendInvite({ accountId: 'acct-1', email: 'a@b.c', role: 'editor' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('seat_limit');
      expect(result.message).toMatch(/read-only seats are free/i);
    }
  });

  it('asks for a refresh rather than a retry when the session has gone', async () => {
    db.state.session = null;
    const result = await sendInvite({ accountId: 'acct-1', email: 'a@b.c', role: 'editor' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('no_session');
    expect(db.state.fetches).toEqual([]);
  });

  it('passes the server’s own message through on a refusal, and invents nothing on a blank one', async () => {
    stubFetch({ status: 403, body: { error: 'You cannot invite somebody above your own role.' } });
    const named = await sendInvite({ accountId: 'acct-1', email: 'a@b.c', role: 'admin' });
    expect(named.ok === false && named.message).toBe('You cannot invite somebody above your own role.');

    stubFetch({ status: 500, body: null });
    const blank = await sendInvite({ accountId: 'acct-1', email: 'a@b.c', role: 'admin' });
    expect(blank.ok === false && blank.reason).toBe('failed');
  });

  it('treats a network failure as a failure and not as a refusal', async () => {
    stubFetch('throw');
    const result = await sendInvite({ accountId: 'acct-1', email: 'a@b.c', role: 'editor' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('failed');
  });
});

describe('accepting an invitation', () => {
  it('passes the token to the RPC and returns what it decided', async () => {
    db.state.rpcResults.accept_account_invite = {
      data: [{ outcome: 'accepted', joined_account_id: 'acct-1', joined_role: 'editor' }],
      error: null
    };
    const result = await acceptInvite('tok');
    expect(db.state.rpc).toEqual([['accept_account_invite', { p_token: 'tok' }]]);
    expect(result).toEqual({ outcome: 'accepted', accountId: 'acct-1', role: 'editor' });
  });

  it.each(['invalid', 'expired', 'wrong_recipient', 'no_seat'])(
    'carries the %s outcome through without collapsing it further',
    async (outcome) => {
      // The database has ALREADY collapsed unknown, revoked and already-used into `invalid`, so
      // that a token holder is not told they were removed or that somebody else used their link.
      // `expired` is deliberately not in that collapse, because reaching it means you already
      // hold a real token. This layer must not re-collapse either decision.
      db.state.rpcResults.accept_account_invite = {
        data: [{ outcome, joined_account_id: null, joined_role: null }],
        error: null
      };
      const result = await acceptInvite('tok');
      expect(result.outcome).toBe(outcome);
      expect(result.accountId).toBeNull();
    }
  );

  it('never reports an outcome word it has never heard of as accepted', async () => {
    // Sending somebody into an account they are not in would refuse every request afterwards
    // with no explanation anywhere.
    db.state.rpcResults.accept_account_invite = {
      data: [{ outcome: 'probably_fine', joined_account_id: 'acct-1' }],
      error: null
    };
    const result = await acceptInvite('tok');
    expect(result).toEqual({ outcome: 'failed', accountId: null, role: null });
  });

  it('reports a failed call as failed rather than as an invalid token', async () => {
    // "This invitation cannot be used" over a dropped connection sends somebody back to the
    // person who invited them for a new link that would have worked the first time.
    db.state.rpcResults.accept_account_invite = { data: null, error: { code: '08006' } };
    expect(await acceptInvite('tok')).toEqual({ outcome: 'failed', accountId: null, role: null });
  });
});
