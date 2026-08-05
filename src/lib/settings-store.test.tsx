import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/**
 * THE PROVIDER THAT DECIDES WHAT A LABEL PRINTS.
 *
 * Two properties are worth defending here and neither is visible in a type.
 *
 * ONE. A save has to reach `lib/identity.ts`, because that module — not this store — is what
 * the label renderer and sections 1 and 15 of the safety data sheet read. A store that held the
 * identity correctly and never pushed it would leave a maker who had just saved their business
 * name looking at "[Your registered business name]" on their own label.
 *
 * TWO. It has to be CLEARED when the account changes, including the change to none. The
 * entitlement provider learned this the hard way: a session can be replaced in place with no
 * signed-out frame between — a cross-tab sign-in over the shared .batchlabel.xyz cookie, or an
 * auth callback landing in a tab that is already signed in — and a value that survives that is
 * one maker's registered address printed under another maker's product name, in section 15,
 * which is a legal statement about who supplied the product.
 *
 * The third is the house rule: a failed read may not be rendered as an account that has told us
 * nothing, because that is what an unfilled supplier block looks like and the two must never
 * share a sentence.
 */

const entitlement = vi.hoisted(() => ({
  value: { accountId: 'acct-a' as string | null, loading: false }
}));

vi.mock('./entitlement', () => ({
  useEntitlement: () => entitlement.value
}));

const data = vi.hoisted(() => ({
  identity: { ok: true, value: null } as unknown,
  addresses: { ok: true, value: [] } as unknown,
  preferences: { ok: true, value: null } as unknown,
  requests: { ok: true, value: [] } as unknown,
  saveIdentity: vi.fn(),
  saveAddress: vi.fn(),
  savePreferences: vi.fn(),
  createRequest: vi.fn()
}));

vi.mock('./settings-data', () => ({
  fetchBusinessIdentity: async () => data.identity,
  fetchSupplierAddresses: async () => data.addresses,
  fetchWorkspacePreferences: async () => data.preferences,
  fetchDataRequests: async () => data.requests,
  saveBusinessIdentity: (...args: unknown[]) => data.saveIdentity(...args),
  saveSupplierAddress: (...args: unknown[]) => data.saveAddress(...args),
  saveWorkspacePreferences: (...args: unknown[]) => data.savePreferences(...args),
  createDataRequest: (...args: unknown[]) => data.createRequest(...args)
}));

vi.mock('./supabase', () => ({ supabase: {}, isSupabaseConfigured: true }));

import { BUSINESS, addressForMarket, hasPrintedAddress, setPrintedIdentity } from './identity';
import { SettingsProvider, useSettings } from './settings-store';

const WILLOW = {
  registeredName: 'Willow and Wick Ltd',
  tradingName: 'Willow & Wick',
  telephone: '01273 000000',
  email: null,
  website: null,
  vatNumber: null,
  updatedAt: null
};

function Probe() {
  const settings = useSettings();
  return (
    <div>
      <p>status:{settings.status}</p>
      <p>name:{settings.identity?.registeredName ?? 'none'}</p>
      <p>printed:{BUSINESS.name}</p>
      <p>error:{settings.error ?? 'none'}</p>
      <p>requests:{settings.requests.length}</p>
      <p>categories:{settings.preferences?.enabledCategories.join(',') ?? 'none'}</p>
      <button onClick={() => void settings.saveAddress('GB', ['Acme Ltd', '1 Test St', 'Lewes'])}>
        save address
      </button>
      <button
        onClick={() =>
        void settings.savePreferences({
          enabledCategories: ['home-fragrance'],
          defaultMarket: null,
          defaultExport: null
        })
        }>

        save preferences
      </button>
      <button onClick={() => void settings.requestData('erasure')}>request erasure</button>
      <button
        onClick={() =>
        void settings.saveIdentity({
          registeredName: 'Willow and Wick Ltd',
          tradingName: 'Willow & Wick',
          telephone: '01273 000000',
          email: '',
          website: '',
          vatNumber: ''
        })
        }>

        save
      </button>
    </div>);

}

function draw() {
  return render(
    <SettingsProvider>
      <Probe />
    </SettingsProvider>
  );
}

beforeEach(() => {
  setPrintedIdentity(null);
  entitlement.value = { accountId: 'acct-a', loading: false };
  data.identity = { ok: true, value: null };
  data.addresses = { ok: true, value: [] };
  data.preferences = { ok: true, value: null };
  data.requests = { ok: true, value: [] };
  data.saveIdentity.mockReset().mockResolvedValue({ ok: true, value: WILLOW });
  data.saveAddress.mockReset().mockResolvedValue({
    ok: true,
    value: { id: 'a1', market: 'GB', lines: ['Acme Ltd', '1 Test St', 'Lewes'], updatedAt: null }
  });
  data.savePreferences.mockReset().mockResolvedValue({
    ok: true,
    value: { enabledCategories: ['home-fragrance'], defaultMarket: null, defaultExport: null }
  });
  data.createRequest.mockReset().mockResolvedValue({
    ok: true,
    value: {
      id: 'r1',
      kind: 'erasure',
      status: 'requested',
      requestedAt: '2026-08-05T09:00:00Z',
      completedAt: null,
      note: null
    }
  });
});

describe('what the label prints', () => {
  it('hands a loaded identity to the module every renderer imports', async () => {
    data.identity = { ok: true, value: WILLOW };
    data.addresses = {
      ok: true,
      value: [{ id: 'a1', market: 'GB', lines: ['Willow and Wick Ltd', '1 Test St', 'Lewes'], updatedAt: null }]
    };
    draw();

    await waitFor(() => expect(screen.getByText('status:ready')).toBeInTheDocument());
    expect(BUSINESS.name).toBe('Willow and Wick Ltd');
    expect(addressForMarket('GB').lines[0]).toBe('Willow and Wick Ltd');
  });

  it('hands a SAVED identity to it too, without waiting for a reload', async () => {
    draw();
    await waitFor(() => expect(screen.getByText('status:ready')).toBeInTheDocument());
    expect(BUSINESS.name).toBe('[Your registered business name]');

    await userEvent.click(screen.getByRole('button', { name: 'save' }));

    await waitFor(() => expect(BUSINESS.name).toBe('Willow and Wick Ltd'));
    expect(screen.getByText('printed:Willow and Wick Ltd')).toBeInTheDocument();
  });

  it('does not push a refused save into what prints', async () => {
    data.saveIdentity.mockResolvedValue({ ok: false, message: 'no' });
    draw();
    await waitFor(() => expect(screen.getByText('status:ready')).toBeInTheDocument());

    await userEvent.click(screen.getByRole('button', { name: 'save' }));

    await waitFor(() => expect(data.saveIdentity).toHaveBeenCalled());
    expect(BUSINESS.name).toBe('[Your registered business name]');
  });
});

describe('when the account changes', () => {
  it('clears what prints rather than carrying it into the next workspace', async () => {
    data.identity = { ok: true, value: WILLOW };
    const view = draw();
    await waitFor(() => expect(BUSINESS.name).toBe('Willow and Wick Ltd'));

    // The shape that has no signed-out frame in it: the id simply becomes somebody else's.
    entitlement.value = { accountId: null, loading: false };
    view.rerender(
      <SettingsProvider>
        <Probe />
      </SettingsProvider>
    );

    await waitFor(() => expect(BUSINESS.name).toBe('[Your registered business name]'));
    expect(screen.getByText('status:no-account')).toBeInTheDocument();
  });

  it('does not publish the previous account`s identity while the next read is in flight', async () => {
    data.identity = { ok: true, value: WILLOW };
    const view = draw();
    await waitFor(() => expect(screen.getByText('name:Willow and Wick Ltd')).toBeInTheDocument());

    entitlement.value = { accountId: 'acct-b', loading: false };
    data.identity = { ok: true, value: null };
    view.rerender(
      <SettingsProvider>
        <Probe />
      </SettingsProvider>
    );

    // Derived at render, not in an effect: there is no frame in which acct-a's row is
    // published as acct-b's.
    expect(screen.getByText('name:none')).toBeInTheDocument();
    expect(screen.getByText('status:loading')).toBeInTheDocument();

    // Let acct-b's read land, so the assertion above is "loading came first" rather than
    // "the test finished before anything happened".
    await waitFor(() => expect(screen.getByText('status:ready')).toBeInTheDocument());
    expect(screen.getByText('name:none')).toBeInTheDocument();
  });
});

describe('a read that failed', () => {
  it('is not rendered as an account that has told us nothing', async () => {
    data.identity = { ok: false, message: 'We could not read your printed identity just now.' };
    draw();

    await waitFor(() => expect(screen.getByText('status:error')).toBeInTheDocument());
    expect(screen.getByText(/error:We could not read your printed identity/)).toBeInTheDocument();
    // And nothing was pushed into what prints, so no label draws a placeholder that claims
    // the maker never filled it in.
    expect(BUSINESS.name).toBe('[Your registered business name]');
    expect(screen.getByText('name:none')).toBeInTheDocument();
  });

  it('reads an account with no row at all as ready and empty', async () => {
    draw();
    await waitFor(() => expect(screen.getByText('status:ready')).toBeInTheDocument());
    expect(screen.getByText('error:none')).toBeInTheDocument();
    expect(screen.getByText('name:none')).toBeInTheDocument();
  });

  it('lets a failed preferences read stand while the identity still loads', async () => {
    // Preferences are not printed. Letting their failure blank the supplier block would be
    // the tail wagging the dog.
    data.preferences = { ok: false, message: 'nope' };
    draw();
    await waitFor(() => expect(screen.getByText('status:ready')).toBeInTheDocument());
  });
});

describe('the other three writes', () => {
  it('puts a saved address block into what prints, straight away', async () => {
    draw();
    await waitFor(() => expect(screen.getByText('status:ready')).toBeInTheDocument());
    expect(hasPrintedAddress('GB')).toBe(false);

    await userEvent.click(screen.getByRole('button', { name: 'save address' }));

    await waitFor(() => expect(hasPrintedAddress('GB')).toBe(true));
    expect(addressForMarket('GB').lines[0]).toBe('Acme Ltd');
  });

  it('holds the preferences row the database returned, not the one that was sent', async () => {
    draw();
    await waitFor(() => expect(screen.getByText('status:ready')).toBeInTheDocument());

    await userEvent.click(screen.getByRole('button', { name: 'save preferences' }));

    await waitFor(() => expect(screen.getByText('categories:home-fragrance')).toBeInTheDocument());
  });

  it('shows a recorded request only once the row exists', async () => {
    draw();
    await waitFor(() => expect(screen.getByText('requests:0')).toBeInTheDocument());

    await userEvent.click(screen.getByRole('button', { name: 'request erasure' }));

    await waitFor(() => expect(screen.getByText('requests:1')).toBeInTheDocument());
  });

  it('adds nothing to the list when the insert was refused', async () => {
    data.createRequest.mockResolvedValue({ ok: false, message: 'no' });
    draw();
    await waitFor(() => expect(screen.getByText('requests:0')).toBeInTheDocument());

    await userEvent.click(screen.getByRole('button', { name: 'request erasure' }));

    await waitFor(() => expect(data.createRequest).toHaveBeenCalled());
    expect(screen.getByText('requests:0')).toBeInTheDocument();
  });

  it('refuses every write while no account is resolved, rather than guessing one', async () => {
    entitlement.value = { accountId: null, loading: false };
    draw();
    await waitFor(() => expect(screen.getByText('status:no-account')).toBeInTheDocument());

    await userEvent.click(screen.getByRole('button', { name: 'save' }));
    await userEvent.click(screen.getByRole('button', { name: 'save address' }));
    await userEvent.click(screen.getByRole('button', { name: 'save preferences' }));
    await userEvent.click(screen.getByRole('button', { name: 'request erasure' }));

    expect(data.saveIdentity).not.toHaveBeenCalled();
    expect(data.saveAddress).not.toHaveBeenCalled();
    expect(data.savePreferences).not.toHaveBeenCalled();
    expect(data.createRequest).not.toHaveBeenCalled();
  });
});
