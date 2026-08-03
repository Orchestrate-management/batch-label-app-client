import { describe, expect, it } from 'vitest';
import {
  allowanceLabel,
  createIsCertainToFail,
  entitlementMessage,
  mapEntitlement,
  mayModify,
  periodLine,
  planLabel,
  readEntitlementRow,
  type EntitlementRow } from
'./membership';

/**
 * What a row of `public.entitlements` means to this app.
 *
 * The important property, and the reason most of these tests exist: THE DATABASE DECIDES
 * WHETHER SOMEBODY IS ENTITLED. `public.entitlement_is_active()` is the single definition of
 * that, and this module copies its answer out of the `active` column and labels it. So the
 * cases below deliberately feed combinations where a plausible local rule would disagree with
 * the column — an `unpaid` subscription, a paid plan with no Stripe status, a status nobody
 * has heard of — and assert that the column wins every time. Each of those three is a real
 * disagreement this app used to have with the database, in the direction that gave away the
 * paid product.
 */

function row(overrides: Partial<EntitlementRow> = {}): EntitlementRow {
  return {
    brand: 'batchlabel',
    accountId: 'acct-1111',
    membershipStatus: 'active',
    businessName: 'Hearth & Hollow',
    plan: 'free',
    planStatus: null,
    active: false,
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
    trialEnd: null,
    skuLimit: 3,
    skuCount: null,
    skuUnlimited: false,
    editorSeatLimit: 1,
    canModify: null,
    ...overrides
  };
}

describe('the database decides `active`', () => {
  it('does not entitle an `unpaid` subscription the view refused to entitle', () => {
    // This app used to treat `unpaid` as a grace period and keep access on. The view does
    // not: Stripe has given up retrying by then. One of the three disagreements the cutover
    // removed, and the one that gave the paid product away for free.
    const entitlement = mapEntitlement(row({ plan: 'studio', planStatus: 'unpaid', active: false }));
    expect(entitlement.active).toBe(false);
    expect(entitlement.status).toBe('lapsed');
  });

  it('does not entitle a paid plan with no Stripe status', () => {
    // The old rule read a null status on a paid plan as a comped account and switched
    // everything on. entitlement_is_active requires a status in its allow-list, so it does
    // not — and a comped account is granted by writing plan_status, not by guessing.
    expect(mapEntitlement(row({ plan: 'studio', planStatus: null, active: false })).active).toBe(false);
  });

  it('does not entitle an expired period', () => {
    // current_period_end was never even selected before, so expiry could not revoke anything.
    // It is the view's business now: one day of grace, then false.
    const entitlement = mapEntitlement(
      row({ plan: 'maker', planStatus: 'active', currentPeriodEnd: '2020-01-01T00:00:00Z', active: false })
    );
    expect(entitlement.active).toBe(false);
  });

  it('entitles a status this app has never heard of, when the column says so', () => {
    // The other direction, and the one a "tighten it up" change would break. If Stripe adds
    // a status and the view's allow-list is updated, this app must not lock a paying
    // customer out because a string is unfamiliar. It labels, it does not adjudicate.
    const entitlement = mapEntitlement(row({ plan: 'consultant', planStatus: 'something_new', active: true }));
    expect(entitlement.active).toBe(true);
    expect(entitlement.status).toBe('active');
  });

  it('entitles past_due, and says so without withholding anything', () => {
    const entitlement = mapEntitlement(row({ plan: 'maker', planStatus: 'past_due', active: true }));
    expect(entitlement.active).toBe(true);
    expect(entitlement.status).toBe('past_due');
    expect(entitlementMessage(entitlement)).toContain('Update your card');
  });
});

describe('a read that did not succeed', () => {
  /**
   * The important one. `unknown` is not `free`. Telling a customer with a live subscription
   * that they are on the free plan because a request timed out is how you get a cancellation
   * email.
   */
  it('is unknown, not free', () => {
    const entitlement = mapEntitlement(null, true);
    expect(entitlement.status).toBe('unknown');
    expect(entitlement.active).toBe(false);
    expect(entitlement.plan).toBeNull();
  });

  it('does not claim anything about the account', () => {
    expect(entitlementMessage(mapEntitlement(null, true))).toBe(
      'We could not check your plan just now.'
    );
  });

  it('reads a missing `active` column as unknown rather than as a grant', () => {
    // A schema old enough to have no `active` column leaves nothing to fall back on now that
    // the local rule is deleted. Withhold and blame ourselves — inventing an entitlement
    // here would hand out the paid product on a schema error.
    const entitlement = mapEntitlement(row({ plan: 'studio', planStatus: 'active', active: null }));
    expect(entitlement.status).toBe('unknown');
    expect(entitlement.active).toBe(false);
  });
});

describe('no membership row yet', () => {
  it('reads as mid-signup rather than as a failure', () => {
    // Real, and hits people at the worst moment: an OAuth signup lands here before the
    // provisioning call has finished writing the row.
    const entitlement = mapEntitlement(null);
    expect(entitlement.status).toBe('no_membership');
    expect(entitlement.active).toBe(false);
    expect(planLabel(entitlement)).toBe('Not set up');
  });
});

describe('the free plan', () => {
  it('is not active', () => {
    const entitlement = mapEntitlement(row({ plan: 'free', active: false }));
    expect(entitlement.status).toBe('free');
    expect(entitlement.active).toBe(false);
  });

  it('treats an empty plan as free', () => {
    expect(mapEntitlement(row({ plan: null, active: false })).status).toBe('free');
  });

  it('still carries the business name', () => {
    // The sidebar shows it whatever the plan says.
    expect(mapEntitlement(row({ plan: 'free' })).businessName).toBe('Hearth & Hollow');
  });
});

describe('a plan that lapsed', () => {
  it.each(['canceled', 'cancelled', 'incomplete_expired', 'paused'])(
    'is lapsed rather than cancelled (%s)',
    (planStatus) => {
      const entitlement = mapEntitlement(row({ plan: 'studio', planStatus, active: false }));
      expect(entitlement.status).toBe('lapsed');
      expect(entitlement.active).toBe(false);
    }
  );

  it('is never told it is worse off than somebody who never paid', () => {
    // Ruling R9. The sentence may not imply a penalty, a lockout or a countdown.
    const message = entitlementMessage(mapEntitlement(row({ plan: 'studio', planStatus: 'canceled' })));
    expect(message).toContain('everything the free plan can');
    expect(message).toContain('nothing has been deleted');
  });
});

describe('a membership that is not in good standing', () => {
  it.each(['suspended', 'left'])('overrides the plan entirely (%s)', (membershipStatus) => {
    // The view already refuses to entitle these. The separate LABEL exists because "we
    // paused your account" and "your subscription ended" need different words — somebody
    // suspended may well still be paying.
    const entitlement = mapEntitlement(
      row({ membershipStatus, plan: 'consultant', planStatus: 'active', active: false })
    );
    expect(entitlement.status).toBe('suspended');
    expect(entitlement.active).toBe(false);
  });

  it('does not treat a blank membership status as suspended', () => {
    expect(mapEntitlement(row({ membershipStatus: null, plan: 'studio', active: true })).status).toBe(
      'active'
    );
  });
});

describe('the allowance, which answers a different question from `active`', () => {
  it('reports a finite limit', () => {
    const entitlement = mapEntitlement(row({ plan: 'maker', active: true, skuLimit: 45, skuUnlimited: false }));
    expect(entitlement.skuLimit).toBe(45);
    expect(entitlement.skuUnlimited).toBe(false);
    expect(allowanceLabel(entitlement)).toBe('45 SKUs');
  });

  it('reports unlimited without ever holding a number', () => {
    // The sentinel is int4 max and the whole point of the sku_unlimited column is that no
    // client holds it. Nothing in this repo may render "2,147,483,647 SKUs".
    const entitlement = mapEntitlement(
      row({ plan: 'consultant', active: true, skuLimit: 2147483647, skuUnlimited: true })
    );
    expect(entitlement.skuUnlimited).toBe(true);
    expect(entitlement.skuLimit).toBeNull();
    expect(allowanceLabel(entitlement)).toBe('Unlimited SKUs');
  });

  it('refuses to state a limit when it cannot tell unlimited from a number', () => {
    // No sku_unlimited column means we cannot know whether sku_limit is an allowance or the
    // sentinel, and a guess either way is a number on a customer's screen that we made up.
    const entitlement = mapEntitlement(row({ plan: 'maker', active: true, skuLimit: 45, skuUnlimited: null }));
    expect(entitlement.skuLimit).toBeNull();
    expect(entitlement.skuUnlimited).toBe(false);
    expect(allowanceLabel(entitlement)).toBe('Allowance unavailable');
  });

  it('carries the editor seat allowance through', () => {
    expect(mapEntitlement(row({ editorSeatLimit: 3 })).editorSeatLimit).toBe(3);
  });

  it('does not let an allowance decide entitlement', () => {
    // WHETHER and HOW MUCH are two columns and two questions. An account at zero SKUs of
    // allowance is still entitled if the view says so.
    expect(mapEntitlement(row({ plan: 'maker', active: true, skuLimit: 0 })).active).toBe(true);
  });
});

describe('can_modify, which does not exist yet', () => {
  it('fails open when the column is absent', () => {
    // R8. The column ships with the SKU enforcement trigger. Until then its absence must
    // never remove an ability — including from a paying Consultant, silently, with no error.
    const entitlement = mapEntitlement(row({ plan: 'consultant', active: true, canModify: null }));
    expect(entitlement.canModify).toBeNull();
    expect(mayModify(entitlement)).toBe(true);
  });

  it('fails open on a read that failed', () => {
    expect(mayModify(mapEntitlement(null, true))).toBe(true);
  });

  it('denies only when the column is actually false', () => {
    expect(mayModify(mapEntitlement(row({ canModify: false })))).toBe(false);
    expect(mayModify(mapEntitlement(row({ canModify: true })))).toBe(true);
  });
});

/**
 * Whether to offer a create button, which is a NARROWER question than "can this account
 * create a product" and must stay narrower.
 *
 * The expensive direction is a false positive: hiding the control from somebody whose create
 * would have worked takes away a thing they can genuinely do, on the strength of one read of
 * ours going wrong. So the two named states are the two the DATABASE has already settled, and
 * everything else — including every state we are unsure about — keeps the button and lets the
 * write answer.
 */
describe('the create button, and the two states that make it a waste of typing', () => {
  it('hides it for a suspended account, whose insert the policy refuses', () => {
    expect(createIsCertainToFail(mapEntitlement(row({ membershipStatus: 'suspended' })))).toBe(
      true
    );
  });

  it('hides it for a signup that never finished, which has no account to insert into', () => {
    // No row for this brand at all. There is nothing for account_id to be, and nothing for
    // the database's own current_account_id() default to resolve. Finishing signup is the
    // fix; pressing a button is not.
    const unfinished = mapEntitlement(null);
    expect(unfinished.status).toBe('no_membership');
    expect(createIsCertainToFail(unfinished)).toBe(true);
  });

  it('KEEPS it when our own entitlement read failed', () => {
    // THE ONE THAT MATTERS. `createProduct` omits account_id when it has none, and
    // current_account_id() resolves it server-side — so for a maker holding one account the
    // create would have worked. A blipped read must not cost them a product.
    const unreadable = mapEntitlement(null, true);
    expect(unreadable.status).toBe('unknown');
    expect(createIsCertainToFail(unreadable)).toBe(false);
  });

  it('keeps it on every money state, because none of them withholds a create', () => {
    // §6.1: no new, keep everything old fully working. The SKU allowance is what governs a
    // create, and SkuLimitNotice states that separately, before anything is typed.
    expect(createIsCertainToFail(mapEntitlement(row({ plan: 'free' })))).toBe(false);
    expect(createIsCertainToFail(mapEntitlement(row({ plan: 'studio', active: false }))))
      .toBe(false);
    expect(
      createIsCertainToFail(mapEntitlement(row({ plan: 'studio', planStatus: 'past_due' })))
    ).toBe(false);
    expect(createIsCertainToFail(mapEntitlement(row({ plan: 'studio', active: true })))).toBe(
      false
    );
  });

  it('keeps it for a membership whose account this brand could not single out', () => {
    // `account_ambiguous` is a write hint, not a status: it comes back from the attempt, with
    // a true sentence and correctly no retry. We cannot see it in advance, so we do not guess.
    expect(createIsCertainToFail(mapEntitlement(row({ accountId: null })))).toBe(false);
  });
});

describe('what happens next, and when', () => {
  it('says a scheduled cancellation ends the plan, not that it renews', () => {
    // Same date, opposite meaning. cancel_at_period_end is still `active`: they paid up to
    // that date and everything stays on until it.
    const line = periodLine(
      mapEntitlement(
        row({ plan: 'maker', active: true, currentPeriodEnd: '2026-09-14T00:00:00Z', cancelAtPeriodEnd: true })
      )
    );
    expect(line).toContain('ends on 14 September 2026');
    expect(line).not.toContain('Renews');
  });

  it('says when an active plan renews', () => {
    expect(
      periodLine(mapEntitlement(row({ plan: 'maker', active: true, currentPeriodEnd: '2026-09-14T00:00:00Z' })))
    ).toBe('Renews on 14 September 2026.');
  });

  it('prefers the trial end while a trial is running', () => {
    expect(
      periodLine(
        mapEntitlement(
          row({ plan: 'maker', active: true, currentPeriodEnd: '2026-09-14T00:00:00Z', trialEnd: '2026-08-20T00:00:00Z' })
        )
      )
    ).toBe('Your trial ends on 20 August 2026.');
  });

  it('says nothing at all when there is no date', () => {
    expect(periodLine(mapEntitlement(row({ plan: 'free' })))).toBeNull();
  });

  it('ignores a timestamp it cannot parse rather than printing one', () => {
    expect(periodLine(mapEntitlement(row({ plan: 'maker', active: true, currentPeriodEnd: 'soon' })))).toBeNull();
  });
});

describe('reading the raw row', () => {
  /**
   * The marketing side owns this view and adds columns to it — `can_modify` and `sku_count`
   * arrived with the account data schema, and `account_id` changed from a user id to a real
   * accounts.id in the same migration. Anything missing has to read as absent rather than
   * throwing, and absent must never read as zero or as false.
   */
  it('tolerates an empty object', () => {
    expect(readEntitlementRow({})).toEqual({
      brand: null,
      accountId: null,
      membershipStatus: null,
      businessName: null,
      plan: null,
      planStatus: null,
      active: null,
      currentPeriodEnd: null,
      cancelAtPeriodEnd: null,
      trialEnd: null,
      skuLimit: null,
      skuCount: null,
      skuUnlimited: null,
      editorSeatLimit: null,
      canModify: null
    });
  });

  it('reads sku_count as a number, and a missing one as unknown rather than zero', () => {
    // Zero is a claim — "this account holds no products" — and the billing page renders it
    // next to an allowance. The view is built to yield null when no account resolves, and
    // this reader has to carry that through rather than defaulting it.
    expect(readEntitlementRow({ sku_count: 3 }).skuCount).toBe(3);
    expect(readEntitlementRow({}).skuCount).toBeNull();
    expect(readEntitlementRow({ sku_count: null }).skuCount).toBeNull();
    expect(readEntitlementRow({ sku_count: '3' }).skuCount).toBeNull();
  });

  it('reads account_id, which is an account and not the user id', () => {
    // The column used to be `m.user_id as account_id`. It resolves to accounts.id now, and
    // this is the value a write may be told to land in — so it is read, never derived.
    expect(readEntitlementRow({ account_id: 'acct-1111' }).accountId).toBe('acct-1111');
    expect(readEntitlementRow({}).accountId).toBeNull();
  });

  it.each([[null], [undefined], ['not an object'], [42]])(
    'tolerates %s where a row was expected',
    (raw) => {
      expect(() => readEntitlementRow(raw)).not.toThrow();
      expect(readEntitlementRow(raw).plan).toBeNull();
    }
  );

  it('ignores values of the wrong type instead of coercing them', () => {
    const parsed = readEntitlementRow({ plan: 42, business_name: {}, active: 'yes', sku_limit: '45' });
    expect(parsed.plan).toBeNull();
    expect(parsed.businessName).toBeNull();
    // 'yes' is not a boolean, and coercing it would be this app deciding entitlement from a
    // string it does not understand.
    expect(parsed.active).toBeNull();
    expect(parsed.skuLimit).toBeNull();
  });

  it('treats a blank string as absent', () => {
    expect(readEntitlementRow({ business_name: '   ' }).businessName).toBeNull();
  });

  it('trims what it keeps', () => {
    expect(readEntitlementRow({ business_name: ' Hearth & Hollow ' }).businessName).toBe(
      'Hearth & Hollow'
    );
  });

  it('maps a real view row through to an entitlement', () => {
    const entitlement = mapEntitlement(
      readEntitlementRow({
        user_id: '00000000-0000-0000-0000-000000000000',
        brand: 'batchlabel',
        plan: 'studio',
        status: 'active',
        membership_status: 'active',
        active: true,
        current_period_end: '2026-09-14T00:00:00Z',
        cancel_at_period_end: false,
        trial_end: null,
        updated_at: '2026-08-01T00:00:00Z',
        account_id: 'aaaaaaaa-0000-0000-0000-00000000000a',
        business_name: 'Hearth & Hollow',
        sku_limit: 180,
        sku_count: 12,
        editor_seat_limit: 3,
        sku_unlimited: false
      })
    );
    expect(entitlement).toEqual({
      status: 'active',
      active: true,
      // Deliberately not the user_id in the same row: the view's account_id is an accounts.id
      // now, and anything that treats the two as interchangeable writes to the wrong place.
      accountId: 'aaaaaaaa-0000-0000-0000-00000000000a',
      plan: 'studio',
      planStatus: 'active',
      businessName: 'Hearth & Hollow',
      skuLimit: 180,
      skuUnlimited: false,
      skuCount: 12,
      editorSeatLimit: 3,
      canModify: null,
      currentPeriodEnd: '2026-09-14T00:00:00Z',
      cancelAtPeriodEnd: false,
      trialEnd: null
    });
    expect(planLabel(entitlement)).toBe('Studio');
  });

  it('ignores case and stray whitespace in the plan slug', () => {
    // Written by a webhook into an unconstrained column.
    expect(mapEntitlement(row({ plan: ' Studio ', active: true })).plan).toBe('studio');
  });
});
