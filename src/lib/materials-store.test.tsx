import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';

/**
 * THE PROVIDER THAT FILLS THE REGISTER EVERY CLASSIFICATION IS DERIVED FROM.
 *
 * It publishes to TWO places and both matter, which is the whole reason it needs its own suite
 * rather than being covered incidentally by the screens that use it.
 *
 *   its context value, which is what wakes a subscriber up
 *   the module-level index in lib/material-index.ts, which is what `derive`, `stagesFor`,
 *   `buildSds` and `obligationState` actually read during render
 *
 * Three properties are defended here, and none of them is visible in a type.
 *
 * ONE. THE INDEX IS CLEARED WHEN THE USER CHANGES, INCLUDING TO NONE. A session can be replaced
 * in place with no signed-out frame between — a cross-tab sign-in over the shared
 * .batchlabel.xyz cookie, or an auth callback landing in a tab that is already signed in — and
 * a register that survives that is one maker's fragrance oils classifying another maker's
 * candle. It is the same lesson the entitlement and settings stores each learned separately.
 *
 * TWO. A FAILED READ IS NOT AN EMPTY REGISTER. `status: 'error'` publishes 'error' to the
 * index, not an empty ready state, so the derivations say "has not loaded" rather than
 * "no hazard statements are required". An empty account and a dropped request must never share
 * a sentence, and here they must not share an index state either.
 *
 * THREE. A SUSPENDED ACCOUNT READS NOTHING AND IS NOT CALLED EMPTY. Billing is live and a
 * suspended membership answers reads with no rows; 'unavailable' is what keeps that from
 * rendering as a register the maker has emptied.
 */

const auth = vi.hoisted(() => ({ user: { id: 'user-a' } as {id: string;} | null }));

vi.mock('./auth', () => ({
  useAuth: () => ({ user: auth.user, loading: false })
}));

const entitlement = vi.hoisted(() => ({
  value: {
    accountId: 'acct-a' as string | null,
    loading: false,
    status: 'active' as string
  }
}));

vi.mock('./entitlement', () => ({
  useEntitlement: () => entitlement.value
}));

const read = vi.hoisted(() => ({ fetchMaterials: vi.fn() }));

vi.mock('./materials', () => ({
  fetchMaterials: (...args: unknown[]) => read.fetchMaterials(...args)
}));

vi.mock('./supabase', () => ({ supabase: {}, isSupabaseConfigured: true }));

import type { Material } from './model';
import {
  allMaterials,
  materialIndex,
  materialsSettled,
  materialsStatus,
  resetMaterials } from
'./material-index';
import { MaterialsProvider, useMaterials } from './materials-store';

const OIL = {
  id: 'mat-1',
  rowId: 'mat-1',
  class: 'ingredient',
  name: 'Black Fig and Cassis',
  supplier: 'A supplier',
  role: 'Fragrance oil',
  source: 'account',
  hazards: [],
  allergens: [],
  ifra: []
} as unknown as Material;

function Probe() {
  const { status, materials, error, accountId } = useMaterials();
  return (
    <div>
      <span data-testid="status">{status}</span>
      <span data-testid="count">{materials.length}</span>
      <span data-testid="error">{error ?? '—'}</span>
      <span data-testid="account">{accountId ?? '—'}</span>
    </div>
  );
}

function draw() {
  return render(
    <MaterialsProvider>
      <Probe />
    </MaterialsProvider>
  );
}

const statusText = () => screen.getByTestId('status').textContent;

beforeEach(() => {
  resetMaterials();
  auth.user = { id: 'user-a' };
  entitlement.value = { accountId: 'acct-a', loading: false, status: 'active' };
  read.fetchMaterials.mockReset();
  read.fetchMaterials.mockResolvedValue({ ok: true, materials: [OIL] });
});

describe('reading an account register', () => {
  it('publishes the rows to the context and to the index the derivations read', async () => {
    draw();
    await waitFor(() => expect(statusText()).toBe('ready'));

    expect(screen.getByTestId('count').textContent).toBe('1');
    expect(screen.getByTestId('account').textContent).toBe('acct-a');
    // The half that a screen test would not notice: the module index, which is what
    // `derive` and `obligationState` read during render.
    expect(allMaterials()).toHaveLength(1);
    expect(materialsStatus()).toBe('ready');
  });

  it('asks for the account the entitlement resolved, and for no other', async () => {
    draw();
    await waitFor(() => expect(statusText()).toBe('ready'));
    expect(read.fetchMaterials).toHaveBeenCalledWith('acct-a');
  });

  it('does not read at all until the entitlement has resolved an account', async () => {
    entitlement.value = { accountId: null, loading: true, status: 'active' };
    draw();
    await waitFor(() => expect(statusText()).toBe('loading'));
    // Not "no materials" — nothing has been asked yet, and the index has to say so or every
    // classification on screen ticks green against a register nobody requested. 'unloaded' is
    // the index's word for that, distinct from 'loading' (a read in flight) and reached because
    // the store does not publish anything before it knows which account to ask about. What both
    // share, and all any derivation needs, is that `materialsSettled()` is false.
    expect(read.fetchMaterials).not.toHaveBeenCalled();
    expect(materialsStatus()).toBe('unloaded');
    expect(materialsSettled()).toBe(false);
  });
});

describe('a read that failed', () => {
  it('is an error in both places, never an empty register in either', async () => {
    read.fetchMaterials.mockResolvedValue({ ok: false, message: 'We could not read your materials.' });
    draw();
    await waitFor(() => expect(statusText()).toBe('error'));

    expect(screen.getByTestId('error').textContent).toMatch(/could not read/i);
    // THE ASSERTION THIS FILE EXISTS FOR. 'ready' with an empty array here is what makes a
    // product screen say no hazard statements are required at this fragrance load.
    expect(materialsStatus()).toBe('error');
    expect(materialsStatus()).not.toBe('ready');
    expect(allMaterials()).toEqual([]);
  });
});

describe('an account that cannot be read from', () => {
  it('says unavailable for a suspended membership rather than empty', async () => {
    entitlement.value = { accountId: 'acct-a', loading: false, status: 'suspended' };
    draw();
    await waitFor(() => expect(statusText()).toBe('unavailable'));
    expect(read.fetchMaterials).not.toHaveBeenCalled();
    expect(materialsStatus()).toBe('unavailable');
  });

  it('says no-account for a signup that never finished', async () => {
    entitlement.value = { accountId: null, loading: false, status: 'active' };
    draw();
    await waitFor(() => expect(statusText()).toBe('no-account'));
    expect(read.fetchMaterials).not.toHaveBeenCalled();
  });
});

describe('the user changing underneath a mounted session', () => {
  it('drops the previous register instead of letting it stand for the new one', async () => {
    const view = draw();
    await waitFor(() => expect(allMaterials()).toHaveLength(1));

    // Signed out in place: no unmount, no signed-out frame. This is a cross-tab sign-out over
    // the shared cookie, and it is the shape the entitlement store was caught by first.
    auth.user = null;
    view.rerender(
      <MaterialsProvider>
        <Probe />
      </MaterialsProvider>
    );

    await waitFor(() => expect(allMaterials()).toEqual([]));
    // Reset, NOT 'loading'. A signed-out session has no read in flight, and the next signed-in
    // user must not inherit one row of the last one's register.
    expect(materialIndex().accountId).toBeNull();
  });

  it('does not show one account the register that was read for another', async () => {
    const view = draw();
    await waitFor(() => expect(statusText()).toBe('ready'));

    read.fetchMaterials.mockResolvedValue({ ok: true, materials: [] });
    auth.user = { id: 'user-b' };
    entitlement.value = { accountId: 'acct-b', loading: false, status: 'active' };
    view.rerender(
      <MaterialsProvider>
        <Probe />
      </MaterialsProvider>
    );

    await waitFor(() => expect(screen.getByTestId('account').textContent).toBe('acct-b'));
    await waitFor(() => expect(screen.getByTestId('count').textContent).toBe('0'));
    expect(allMaterials()).toEqual([]);
  });
});

describe('refresh and reload', () => {
  it('re-reads on refresh, and the second answer replaces the first everywhere', async () => {
    function WithRefresh() {
      const { status, materials, refresh } = useMaterials();
      return (
        <div>
          <span data-testid="status">{status}</span>
          <span data-testid="count">{materials.length}</span>
          <button onClick={refresh}>Try again</button>
        </div>
      );
    }

    read.fetchMaterials.mockResolvedValue({ ok: false, message: 'We could not read your materials.' });
    render(
      <MaterialsProvider>
        <WithRefresh />
      </MaterialsProvider>
    );
    await waitFor(() => expect(statusText()).toBe('error'));

    read.fetchMaterials.mockResolvedValue({ ok: true, materials: [OIL, { ...OIL, id: 'mat-2' }] });
    act(() => screen.getByText('Try again').click());

    await waitFor(() => expect(statusText()).toBe('ready'));
    expect(screen.getByTestId('count').textContent).toBe('2');
    expect(allMaterials()).toHaveLength(2);
    expect(materialsStatus()).toBe('ready');
  });
});
