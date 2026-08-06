import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * WHICH OF THE TWO SOURCES ANSWERS "what does this account allow", AND WHEN.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE FINDING THIS FILE EXISTS TO HOLD IN PLACE
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * `public.entitlements` is keyed by OWNERSHIP: it selects from brand_memberships, is
 * security_invoker, and resolves the account by a lateral join on `owner_user_id`. An ACTIVE
 * INVITED MEMBER therefore selects ZERO ROWS from it and the app renders "your account is still
 * being set up" at somebody sitting in a workspace they were invited into. Measured on a live
 * chain before this change; seats would have shipped broken for exactly the people they are
 * sold to.
 *
 * `public.account_entitlement(uuid)` is keyed on the ACCOUNT and guarded by a trailing
 * `is_member_of`. It is the read the app makes now.
 *
 * The fallback is on `missing` ALONE. A read that failed for any other reason is reported as a
 * failure rather than retried against a second source, because asking a different question after
 * the first one broke is how "we could not check your plan" turns into "you are on the free
 * plan", which reads as an accusation and is the kind of thing people cancel over.
 */

const db = vi.hoisted(() => ({
  rpc: [] as Array<[string, unknown]>,
  rpcResult: { data: null as unknown, error: null as unknown },
  viewResult: { data: null as unknown, error: null as unknown },
  viewReads: 0
}));

vi.mock('./supabase', () => ({
  isSupabaseConfigured: true,
  supabase: {
    async rpc(name: string, args: unknown) {
      db.rpc.push([name, args]);
      return db.rpcResult;
    },
    from() {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => {
              db.viewReads += 1;
              return db.viewResult;
            }
          })
        })
      };
    }
  }
}));

import { fetchEntitlementForAccount } from './membership';
import { readEntitlement } from './entitlement';

beforeEach(() => {
  db.rpc = [];
  db.rpcResult = { data: null, error: null };
  db.viewResult = { data: null, error: null };
  db.viewReads = 0;
});

describe('the account-keyed read', () => {
  it('hands back the caller’s own role and the account’s seat usage, which the view never carried', async () => {
    db.rpcResult = {
      data: [
      {
        brand: 'batchlabel',
        account_id: 'acct-1',
        plan: 'studio',
        plan_status: 'active',
        active: true,
        membership_status: 'active',
        sku_limit: 180,
        sku_unlimited: false,
        sku_count: 12,
        can_modify: true,
        editor_seat_limit: 3,
        seats_in_use: 2,
        caller_role: 'editor'
      }],

      error: null
    };

    const result = await fetchEntitlementForAccount('acct-1');

    expect(db.rpc).toEqual([['account_entitlement', { p_account_id: 'acct-1' }]]);
    expect(result.failed).toBe(false);
    expect(result.missing).toBe(false);
    expect(result.row).toMatchObject({
      accountId: 'acct-1',
      seatsInUse: 2,
      callerRole: 'editor',
      // `plan_status` rather than the view's `status`, and the parser reads both so it does not
      // have to know which source it was handed.
      planStatus: 'active'
    });
  });

  it('reads zero rows as no row rather than as a failure', async () => {
    // Zero rows is the answer a stranger gets: the is_member_of guard refused them. Reporting it
    // as a failed read would offer a Try again button against a state a retry cannot move.
    db.rpcResult = { data: [], error: null };
    const result = await fetchEntitlementForAccount('acct-1');
    expect(result.failed).toBe(false);
    expect(result.row).toBeNull();
  });
});

describe('choosing a source', () => {
  it('asks the account-keyed function when there is an account', async () => {
    db.rpcResult = { data: [{ account_id: 'acct-1', active: true }], error: null };
    const result = await readEntitlement('acct-1');
    expect(db.rpc).toHaveLength(1);
    expect(db.viewReads).toBe(0);
    expect(result.row?.accountId).toBe('acct-1');
  });

  it('falls back to the view ONLY when the function is not published at all', async () => {
    // PGRST202 is what an environment whose migrations stop before 20260805120000 answers, which
    // is the ordinary condition of the window between this app deploying and its migrations
    // landing. In that database every account is one owner, so the view is the right answer.
    db.rpcResult = { data: null, error: { code: 'PGRST202' } };
    db.viewResult = { data: { account_id: 'acct-legacy', active: true }, error: null };

    const result = await readEntitlement('acct-1');

    expect(db.viewReads).toBe(1);
    expect(result.failed).toBe(false);
    expect(result.row?.accountId).toBe('acct-legacy');
  });

  it('does NOT fall back on an ordinary failure, so one blip cannot become a plan downgrade', async () => {
    db.rpcResult = { data: null, error: { code: '08006' } };
    db.viewResult = { data: { account_id: 'acct-1', active: true }, error: null };

    const result = await readEntitlement('acct-1');

    expect(db.viewReads).toBe(0);
    expect(result.failed).toBe(true);
    expect(result.row).toBeNull();
  });

  it('reads the view when there is no account to name, which is the pre-migration shape', async () => {
    db.viewResult = { data: { account_id: 'acct-legacy', active: true }, error: null };
    const result = await readEntitlement(null);
    expect(db.rpc).toEqual([]);
    expect(db.viewReads).toBe(1);
    expect(result.row?.accountId).toBe('acct-legacy');
  });
});
