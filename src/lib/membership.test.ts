import { describe, expect, it } from 'vitest';
import {
  entitlementMessage,
  mapEntitlement,
  planLabel,
  readMembershipRow,
  type MembershipRow } from
'./membership';

/**
 * What a row in brand_memberships means.
 *
 * This mapping decides whether someone can produce the artefact they came here
 * to produce, so both directions of getting it wrong are expensive: too strict
 * and a paying customer is locked out mid-batch, too loose and the paid output
 * is free. The rules are stated once, here, and asserted here.
 */

function row(overrides: Partial<MembershipRow> = {}): MembershipRow {
  return {
    brandSlug: 'batchlabel',
    membershipStatus: 'active',
    businessName: 'Hearth & Hollow',
    plan: 'free',
    planStatus: null,
    ...overrides
  };
}

describe('a read that did not succeed', () => {
  /**
   * The important one. `unknown` is not `free`. Telling a customer with a live
   * subscription that they are on the free plan because a request timed out is
   * how you get a cancellation email.
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
});

describe('no membership row yet', () => {
  it('reads as mid-signup rather than as a failure', () => {
    // Real, and hits people at the worst moment: an OAuth signup lands here
    // before the provisioning call has finished writing the row.
    const entitlement = mapEntitlement(null);
    expect(entitlement.status).toBe('no_membership');
    expect(entitlement.active).toBe(false);
    expect(planLabel(entitlement)).toBe('Not set up');
  });
});

describe('the free plan', () => {
  it('is not active', () => {
    const entitlement = mapEntitlement(row({ plan: 'free' }));
    expect(entitlement.status).toBe('free');
    expect(entitlement.active).toBe(false);
  });

  it('treats an empty plan as free', () => {
    expect(mapEntitlement(row({ plan: null })).status).toBe('free');
  });

  it('still carries the business name', () => {
    // The sidebar shows it whatever the plan says.
    expect(mapEntitlement(row({ plan: 'free' })).businessName).toBe('Hearth & Hollow');
  });
});

describe('a paid plan', () => {
  it.each(['active', 'trialing'])('is active when Stripe says %s', (planStatus) => {
    const entitlement = mapEntitlement(row({ plan: 'studio', planStatus }));
    expect(entitlement.status).toBe('active');
    expect(entitlement.active).toBe(true);
    expect(planLabel(entitlement)).toBe('Studio');
  });

  it('is active when there is no Stripe status at all', () => {
    // plan defaults to 'free' and no client can write the column, so a non-free
    // value with no subscription behind it was granted server-side on purpose —
    // a comped account or a migration, not a broken row.
    expect(mapEntitlement(row({ plan: 'house', planStatus: null })).active).toBe(true);
  });

  it('ignores case and stray whitespace', () => {
    // Neither column is constrained, and both are written by a webhook.
    const entitlement = mapEntitlement(row({ plan: ' Studio ', planStatus: '  ACTIVE ' }));
    expect(entitlement.status).toBe('active');
    expect(entitlement.plan).toBe('studio');
  });
});

describe('a payment that failed', () => {
  it.each(['past_due', 'unpaid'])('keeps access while Stripe retries (%s)', (planStatus) => {
    // Deliberate. Stripe retries for days; cutting a maker off mid-batch over a
    // card that expired yesterday is worse for them and for us than a loud
    // banner. Access ends at `canceled`, not before.
    const entitlement = mapEntitlement(row({ plan: 'studio', planStatus }));
    expect(entitlement.status).toBe('past_due');
    expect(entitlement.active).toBe(true);
  });

  it('says what to do about it', () => {
    expect(entitlementMessage(mapEntitlement(row({ plan: 'studio', planStatus: 'past_due' })))).
    toContain('Update your card');
  });
});

describe('a plan that ended', () => {
  it.each(['canceled', 'cancelled', 'incomplete_expired'])(
    'switches paid features off (%s)',
    (planStatus) => {
      // Both spellings: Stripe emits the American one, and a hand-written row or
      // a future column could carry the British one.
      const entitlement = mapEntitlement(row({ plan: 'studio', planStatus }));
      expect(entitlement.status).toBe('cancelled');
      expect(entitlement.active).toBe(false);
    }
  );

  it('reassures rather than threatens', () => {
    const message = entitlementMessage(mapEntitlement(row({ plan: 'studio', planStatus: 'canceled' })));
    expect(message).toContain('Your work is safe');
  });
});

describe('a membership that is not in good standing', () => {
  it.each(['suspended', 'left'])('overrides the plan entirely (%s)', (membershipStatus) => {
    const entitlement = mapEntitlement(
      row({ membershipStatus, plan: 'house', planStatus: 'active' })
    );
    expect(entitlement.status).toBe('suspended');
    expect(entitlement.active).toBe(false);
  });

  it('does not treat a blank membership status as suspended', () => {
    // The column is NOT NULL with a default, but a `select *` fallback against a
    // changed schema could still hand us nothing here.
    expect(mapEntitlement(row({ membershipStatus: null, plan: 'studio' })).active).toBe(true);
  });
});

describe('a status we do not recognise', () => {
  it('withholds access without accusing anyone', () => {
    // Stripe adds statuses. `paused` was not in the original set.
    const entitlement = mapEntitlement(row({ plan: 'studio', planStatus: 'paused' }));
    expect(entitlement.status).toBe('unknown');
    expect(entitlement.active).toBe(false);
  });
});

describe('reading the raw row', () => {
  /**
   * The marketing side owns this schema and is adding fields to it. Anything
   * missing has to read as absent rather than throwing — a column that is not
   * there yet must not take the whole app down.
   */
  it('tolerates an empty object', () => {
    expect(readMembershipRow({})).toEqual({
      brandSlug: null,
      membershipStatus: null,
      businessName: null,
      plan: null,
      planStatus: null
    });
  });

  it.each([[null], [undefined], ['not an object'], [42]])(
    'tolerates %s where a row was expected',
    (raw) => {
      expect(() => readMembershipRow(raw)).not.toThrow();
      expect(readMembershipRow(raw).plan).toBeNull();
    }
  );

  it('ignores values of the wrong type instead of coercing them', () => {
    const parsed = readMembershipRow({ plan: 42, business_name: {}, plan_status: true });
    expect(parsed.plan).toBeNull();
    expect(parsed.businessName).toBeNull();
    expect(parsed.planStatus).toBeNull();
  });

  it('treats a blank string as absent', () => {
    expect(readMembershipRow({ business_name: '   ' }).businessName).toBeNull();
  });

  it('trims what it keeps', () => {
    expect(readMembershipRow({ business_name: ' Hearth & Hollow ' }).businessName).toBe(
      'Hearth & Hollow'
    );
  });

  it('maps a real row through to an entitlement', () => {
    const entitlement = mapEntitlement(
      readMembershipRow({
        brand_slug: 'batchlabel',
        status: 'active',
        business_name: 'Hearth & Hollow',
        plan: 'studio',
        plan_status: 'active'
      })
    );
    expect(entitlement).toEqual({
      status: 'active',
      active: true,
      plan: 'studio',
      planStatus: 'active',
      businessName: 'Hearth & Hollow'
    });
  });
});
