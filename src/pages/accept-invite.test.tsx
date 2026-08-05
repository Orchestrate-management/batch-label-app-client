import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * REDEEMING AN INVITATION, AND THE FIVE ANSWERS IT MAY GIVE.
 *
 * The two properties worth holding in place with a test:
 *
 *   IT RUNS ONCE. React mounts effects twice under StrictMode, and `accept_account_invite`
 *   stamps `accepted_at` inside the transaction that takes the row `for update` — so a second
 *   call finds its own success and answers `invalid`. The database is safe either way; the
 *   SCREEN is not, because the customer would watch a successful join turn into "this
 *   invitation cannot be used".
 *
 *   IT DOES NOT UN-COLLAPSE `invalid`. The database has already folded unknown, revoked and
 *   already-used into one word so that a token holder is not told they were removed, or that
 *   somebody else used their link. A screen that guessed between them would undo that.
 */

const state = vi.hoisted(() => ({
  result: { outcome: 'accepted', accountId: 'acct-1', role: 'editor' } as Record<string, unknown>,
  calls: [] as string[],
  selected: [] as string[],
  refreshes: 0,
  email: 'ada@example.com' as string | null
}));

vi.mock('../lib/team', () => ({
  acceptInvite: async (token: string) => {
    state.calls.push(token);
    return state.result;
  }
}));

vi.mock('../lib/active-account', () => ({
  useActiveAccount: () => ({
    select: (id: string) => state.selected.push(id),
    refresh: () => {
      state.refreshes += 1;
    }
  })
}));

vi.mock('../lib/auth', () => ({
  useAuth: () => ({ user: state.email ? { id: 'u-1', email: state.email } : null })
}));

import { AcceptInvite } from './AcceptInvite';

function mount(token = 'tok-123') {
  return render(
    <MemoryRouter initialEntries={[`/invite/${token}`]}>
      <Routes>
        <Route path="/invite/:token" element={<AcceptInvite />} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  state.result = { outcome: 'accepted', accountId: 'acct-1', role: 'editor' };
  state.calls = [];
  state.selected = [];
  state.refreshes = 0;
  state.email = 'ada@example.com';
});

describe('a good invitation', () => {
  it('joins, names the role, and takes the workspace as the active one', async () => {
    mount();
    expect(await screen.findByRole('heading', { name: /You have joined/i })).toBeTruthy();
    expect(screen.getByText(/joined as read only|joined as editor/i)).toBeTruthy();
    expect(state.selected).toEqual(['acct-1']);
    // The account list was read before this membership existed, so it has to be taken again
    // before the new id can be selected: `select` validates against that list.
    expect(state.refreshes).toBe(1);
  });

  it('redeems the token exactly once', async () => {
    const view = mount();
    await screen.findByRole('heading', { name: /You have joined/i });
    view.rerender(
      <MemoryRouter initialEntries={['/invite/tok-123']}>
        <Routes>
          <Route path="/invite/:token" element={<AcceptInvite />} />
        </Routes>
      </MemoryRouter>
    );
    await waitFor(() => expect(state.calls).toHaveLength(1));
  });
});

describe('an invitation that cannot be used', () => {
  it('says one thing for unknown, withdrawn and already used, and names none of them', async () => {
    state.result = { outcome: 'invalid', accountId: null, role: null };
    mount();
    expect(await screen.findByText(/This invitation cannot be used/i)).toBeTruthy();
    const body = screen.getByRole('alert').textContent ?? '';
    expect(body).toMatch(/may already have been used, or it may have been withdrawn/i);
    // It must not tell the holder which, because two of the three are facts about an account
    // they may have no business knowing.
    expect(body).not.toMatch(/removed/i);
    expect(body).not.toMatch(/somebody else/i);
  });

  it('keeps expiry separate, because reaching it means already holding a real token', async () => {
    state.result = { outcome: 'expired', accountId: null, role: null };
    mount();
    expect(await screen.findByText(/has expired/i)).toBeTruthy();
    expect(screen.getByRole('alert')).toHaveTextContent(/seven days/i);
  });

  it('names the address somebody is signed in as when the link was for another one', async () => {
    // This comparison is what makes a forwarded or intercepted link useless: the RPC checks the
    // caller's own verified email before it accepts anything.
    state.result = { outcome: 'wrong_recipient', accountId: null, role: null };
    mount();
    expect(await screen.findByText(/for a different address/i)).toBeTruthy();
    expect(screen.getByRole('alert')).toHaveTextContent('ada@example.com');
  });

  it('still explains itself when it does not know what address they are signed in as', async () => {
    state.result = { outcome: 'wrong_recipient', accountId: null, role: null };
    state.email = null;
    mount();
    expect(await screen.findByRole('alert')).toHaveTextContent(/sent to a different address/i);
  });

  it('says a full account is the account’s problem and that nobody was removed', async () => {
    state.result = { outcome: 'no_seat', accountId: null, role: null };
    mount();
    expect(await screen.findByText(/no seat free/i)).toBeTruthy();
    expect(screen.getByRole('alert')).toHaveTextContent(/Nobody has been removed/i);
  });

  it('blames us, not the token, when the call itself failed', async () => {
    // "This invitation cannot be used" over a dropped connection sends somebody back for a new
    // link that would have worked the first time.
    state.result = { outcome: 'failed', accountId: null, role: null };
    mount();
    expect(await screen.findByText(/could not check this invitation/i)).toBeTruthy();
    expect(screen.getByRole('alert')).toHaveTextContent(/nothing has changed/i);
  });

  it('never selects an account it was not given one for', async () => {
    state.result = { outcome: 'invalid', accountId: null, role: null };
    mount();
    await screen.findByRole('alert');
    expect(state.selected).toEqual([]);
  });
});

describe('a link with no token in it', () => {
  it('is refused without asking the database anything', async () => {
    mount('%20');
    expect(await screen.findByText(/cannot be used/i)).toBeTruthy();
    expect(state.calls).toEqual([]);
  });
});
