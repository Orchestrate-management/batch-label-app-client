import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { BillingReturn } from './BillingReturn';
import type { EntitlementValue } from '../lib/entitlement';
import { ACTIVATION_BACKOFF_MS } from '../lib/activation';
import { mapEntitlement, type EntitlementRow } from '../lib/membership';

/**
 * The screen a customer lands on straight after paying.
 *
 * The failure it exists to prevent: telling somebody their plan is active because Stripe
 * redirected them. It has not been written yet at that moment — `checkout.session.completed`
 * carries no line items, so the plan lands on the `customer.subscription.*` event that
 * follows. Claiming it early is a lie that resolves itself most of the time, which is what
 * makes it the kind of bug that ships.
 */

const entitlement = vi.fn<() => EntitlementValue>();
const refresh = vi.fn();

vi.mock('../lib/entitlement', () => ({
  useEntitlement: () => entitlement()
}));

function stateFor(row: Partial<EntitlementRow> | null, extra: Partial<EntitlementValue> = {}): EntitlementValue {
  const full: EntitlementRow | null = row === null ?
  null :
  {
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
    seatsInUse: null,
    callerRole: null,

    canModify: null,
    ...row
  };
  return {
    ...mapEntitlement(full),
    loading: false,
    skuCountStale: false,
    refresh,
    noteSkuCountChanged: vi.fn(),
    ...extra
  };
}

function renderReturn() {
  return render(
    <MemoryRouter initialEntries={['/billing/success?session_id=cs_test_123']}>
      <BillingReturn />
    </MemoryRouter>
  );
}

/** Runs the whole backoff schedule, as the page would over about thirty seconds. */
async function exhaustTheSchedule() {
  for (const delay of ACTIVATION_BACKOFF_MS) {
    await act(async () => {
      vi.advanceTimersByTime(delay);
    });
  }
}

beforeEach(() => {
  vi.useFakeTimers();
  refresh.mockReset();
  entitlement.mockReturnValue(stateFor({ plan: 'free' }));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('while the webhook is still catching up', () => {
  it('does not claim the plan is active', () => {
    renderReturn();
    expect(screen.queryByText('Your plan is active')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(/waiting for your subscription/);
  });

  it('re-reads on a backoff instead of once', async () => {
    renderReturn();
    expect(refresh).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(ACTIVATION_BACKOFF_MS[0]);
    });
    expect(refresh).toHaveBeenCalledTimes(1);

    await act(async () => {
      vi.advanceTimersByTime(ACTIVATION_BACKOFF_MS[1]);
    });
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('stops asking rather than spinning forever', async () => {
    renderReturn();
    await exhaustTheSchedule();
    const calls = refresh.mock.calls.length;
    expect(calls).toBe(ACTIVATION_BACKOFF_MS.length);

    await act(async () => {
      vi.advanceTimersByTime(60_000);
    });
    expect(refresh).toHaveBeenCalledTimes(calls);
    expect(screen.getByText('We cannot see a subscription yet')).toBeInTheDocument();
  });
});

describe('once the row says so', () => {
  it('names the plan and its allowance', () => {
    entitlement.mockReturnValue(
      stateFor({ plan: 'studio', planStatus: 'active', active: true, skuLimit: 180 })
    );
    renderReturn();
    expect(screen.getByText('Your plan is active')).toBeInTheDocument();
    expect(screen.getByText(/Your account is on Studio with 180 skus/i)).toBeInTheDocument();
  });

  it('stops polling the moment it is entitled', async () => {
    entitlement.mockReturnValue(stateFor({ plan: 'maker', planStatus: 'active', active: true }));
    renderReturn();
    await act(async () => {
      vi.advanceTimersByTime(60_000);
    });
    expect(refresh).not.toHaveBeenCalled();
  });

  it('says when the first period ends', () => {
    entitlement.mockReturnValue(
      stateFor({ plan: 'maker', planStatus: 'active', active: true, currentPeriodEnd: '2027-08-14T00:00:00Z' })
    );
    renderReturn();
    expect(screen.getByText('Renews on 14 August 2027.')).toBeInTheDocument();
  });
});

describe('the states that are not "not yet"', () => {
  it('blames itself when the entitlement could not be read', async () => {
    // A failed read, as opposed to a successful read that found no row. The two are
    // different admissions, and only the second should make somebody wonder about their card.
    entitlement.mockReturnValue({
      ...mapEntitlement(null, true),
      loading: false,
      skuCountStale: false,
      refresh,
      noteSkuCountChanged: vi.fn()
    });
    renderReturn();
    await exhaustTheSchedule();
    expect(screen.getByText('We could not check your plan')).toBeInTheDocument();
    expect(screen.getByText(/This is us, not you/)).toBeInTheDocument();
  });

  it('does not make a suspended account wait out a timer for an answer it already has', () => {
    entitlement.mockReturnValue(
      stateFor({ membershipStatus: 'suspended', plan: 'studio', planStatus: 'active' })
    );
    renderReturn();
    expect(screen.getByText('This account is suspended')).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe('the session id in the URL', () => {
  it('is never treated as evidence of anything', async () => {
    // It is a value anybody can type, and it is in the query string of this very render.
    // The page must reach "we cannot see a subscription", not "you are on a plan".
    renderReturn();
    await exhaustTheSchedule();
    expect(screen.queryByText('Your plan is active')).not.toBeInTheDocument();
    expect(screen.getByText('We cannot see a subscription yet')).toBeInTheDocument();
  });
});
