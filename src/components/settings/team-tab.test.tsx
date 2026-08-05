import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * THE TEAM TAB, AND THE ONE RULE IT IS BUILT AROUND.
 *
 * NOTHING HERE RENDERS A BUTTON THAT DIES AT THE DATABASE. Every refusal these tables can make
 * is predictable from what the screen has already read, so each of them is spent on a control
 * that is absent or disabled with the reason attached rather than on a request that comes back
 * 42501 or, worse, zero rows and no error at all.
 *
 * The four that matter, each with a case below:
 *
 *   a viewer            sees the members and no controls, and is told who to ask.
 *   an admin            may act on peers and on people below them, and NOT on the owner, whose
 *                       row an UPDATE would match zero times with no error raised.
 *   the owner's own row never offers a role change, because an account must always have exactly
 *                       one active owner and a deferred constraint trigger refuses the
 *                       transaction that would leave it without one.
 *   a full plan         says so before an address is typed, and says the two things that
 *                       actually fix it.
 */

const state = vi.hoisted(() => ({
  role: 'owner' as string | null,
  accounts: [] as Array<Record<string, unknown>>,
  accountId: 'acct-1' as string | null,
  members: { ok: true, value: [] as Array<Record<string, unknown>> } as Record<string, unknown>,
  invites: { ok: true, value: [] as Array<Record<string, unknown>> } as Record<string, unknown>,
  seatLimit: 3 as number | null,
  seatsInUse: 1 as number | null,
  sent: [] as Array<Record<string, unknown>>,
  sendResult: { ok: true } as Record<string, unknown>,
  roleChanges: [] as Array<[string, string, string]>,
  statusChanges: [] as Array<[string, string, string]>,
  revoked: [] as string[],
  writeResult: { ok: true, value: undefined } as Record<string, unknown>,
  selected: [] as string[]
}));

vi.mock('../../lib/active-account', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/active-account')>();
  const { DEFAULT_MATRIX, mayAct, permissionReason, roleLabel } = await import('../../lib/permissions');
  const value = () => ({
    status: 'ready' as const,
    accounts: state.accounts,
    accountId: state.accountId,
    role: state.role,
    roleName: roleLabel(state.role),
    matrix: DEFAULT_MATRIX,
    can: (capability: never) => mayAct(state.role, capability),
    reason: (capability: never) => permissionReason(state.role, capability),
    select: (id: string) => state.selected.push(id),
    refresh: () => {}
  });
  return {
    ...actual,
    useActiveAccount: value,
    useOptionalActiveAccount: value,
    useCan: () => ({
      role: state.role,
      roleName: roleLabel(state.role),
      can: (capability: never) => mayAct(state.role, capability),
      reason: (capability: never) => permissionReason(state.role, capability)
    })
  };
});

vi.mock('../../lib/auth', () => ({
  useAuth: () => ({ user: { id: 'u-1', email: 'owner@example.com' } })
}));

vi.mock('../../lib/entitlement', () => ({
  useEntitlement: () => ({
    businessName: 'Hearth and Hollow',
    editorSeatLimit: state.seatLimit,
    seatsInUse: state.seatsInUse
  })
}));

vi.mock('../../lib/team', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/team')>();
  return {
    ...actual,
    fetchMembers: async () => state.members,
    fetchInvites: async () => state.invites,
    sendInvite: async (input: Record<string, unknown>) => {
      state.sent.push(input);
      return state.sendResult;
    },
    changeMemberRole: async (accountId: string, userId: string, role: string) => {
      state.roleChanges.push([accountId, userId, role]);
      return state.writeResult;
    },
    setMemberStatus: async (accountId: string, userId: string, status: string) => {
      state.statusChanges.push([accountId, userId, status]);
      return state.writeResult;
    },
    revokeInvite: async (id: string) => {
      state.revoked.push(id);
      return state.writeResult;
    }
  };
});

import { TeamTab } from './TeamTab';

function member(overrides: Record<string, unknown> = {}) {
  return {
    userId: 'u-1',
    role: 'owner',
    status: 'active',
    joinedAt: '2026-01-01',
    email: null,
    ...overrides
  };
}

function mount() {
  return render(
    <MemoryRouter>
      <TeamTab />
    </MemoryRouter>
  );
}

beforeEach(() => {
  state.role = 'owner';
  state.accountId = 'acct-1';
  state.accounts = [
  { accountId: 'acct-1', accountName: 'Hearth and Hollow', role: 'owner', roleLabel: 'Owner', brand: 'batchlabel', isOwner: true }];

  state.members = { ok: true, value: [member(), member({ userId: 'u-2', role: 'editor', email: 'ada@example.com' })] };
  state.invites = { ok: true, value: [] };
  state.seatLimit = 3;
  state.seatsInUse = 2;
  state.sent = [];
  state.sendResult = { ok: true };
  state.roleChanges = [];
  state.statusChanges = [];
  state.revoked = [];
  state.writeResult = { ok: true, value: undefined };
  state.selected = [];
});

describe('the placeholder this replaced', () => {
  it('is gone, every word of it', async () => {
    // The register rule: a row about something not built is DELETED when it ships, never
    // softened. These three were the whole of the old tab, and every one of them is now false.
    mount();
    await screen.findByText('ada@example.com');
    expect(screen.queryByText(/Inviting people is not built yet/i)).toBeNull();
    expect(screen.queryByText(/One account, one person, for now/i)).toBeNull();
    expect(screen.queryByText(/There is nothing to switch on today/i)).toBeNull();
  });

  it('shows the real role rather than a hardcoded Owner pill', async () => {
    state.role = 'editor';
    state.members = { ok: true, value: [member({ userId: 'u-1', role: 'editor' })] };
    mount();
    await waitFor(() => expect(screen.getAllByText('Editor').length).toBeGreaterThan(0));
    expect(screen.queryByText('Owner')).toBeNull();
  });
});

describe('seats', () => {
  it('states what is used against what the plan allows', async () => {
    mount();
    const seats = await screen.findByText(/editor seats in use/i);
    expect(seats.textContent?.replace(/\s+/g, ' ')).toMatch(/2 of 3 editor seats in use/);
  });

  it('says a full plan is full, and says the two things that fix it', async () => {
    state.seatsInUse = 3;
    mount();
    expect(await screen.findByText(/Every editor seat is taken/i)).toBeTruthy();
    expect(screen.getByText(/You can still add somebody read-only/i)).toBeTruthy();
    expect(screen.getByRole('link', { name: /change the plan/i })).toBeTruthy();
  });

  it('says an over-limit account keeps everybody, because a downgrade strips nobody', async () => {
    // editor_seat_limit follows the plan down inside the same UPDATE that writes the plan, so
    // headcount over the ceiling arrives within one webhook and is a normal steady state. The
    // ruling is block new consumption, strip nobody, and the copy has to say so out loud or the
    // owner will start removing people to fit.
    state.seatLimit = 1;
    state.seatsInUse = 3;
    mount();
    expect(await screen.findByText(/allows fewer seats than are in use/i)).toBeTruthy();
    expect(screen.getByText(/Nobody has been removed and nobody will be/i)).toBeTruthy();
  });

  it('says the number is unknown rather than printing a plausible one', async () => {
    // A "1 of 1" printed off a read that failed is the sentence somebody plans a hire around.
    state.seatLimit = null;
    state.seatsInUse = null;
    mount();
    expect(await screen.findByText(/could not read this account/i)).toBeTruthy();
  });
});

describe('a viewer', () => {
  beforeEach(() => {
    state.role = 'viewer';
  });

  it('gets no invite form, no role picker and no remove button', async () => {
    mount();
    await screen.findByText(/Adding people is not yours to do/i);
    expect(screen.queryByRole('button', { name: /send invitation/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /^remove$/i })).toBeNull();
    expect(screen.queryByRole('combobox')).toBeNull();
  });

  it('is told what they are and who can change it, rather than left to guess', async () => {
    mount();
    const notice = await screen.findByText(/read only on this account/i);
    expect(notice).toBeTruthy();
  });

  it('still sees who is in the account, because reading is what a viewer is for', async () => {
    mount();
    await waitFor(() => expect(screen.getAllByText(/Editor|Owner/).length).toBeGreaterThan(0));
  });
});

describe('an admin', () => {
  beforeEach(() => {
    state.role = 'admin';
    state.members = {
      ok: true,
      value: [
      member({ userId: 'u-owner', role: 'owner' }),
      member({ userId: 'u-1', role: 'admin' }),
      member({ userId: 'u-2', role: 'editor', email: 'ada@example.com' })]

    };
  });

  it('may change a role below their own and the change is scoped to this account', async () => {
    const user = userEvent.setup();
    mount();
    const picker = await screen.findByLabelText('Role for ada@example.com');
    await user.selectOptions(picker, 'viewer');
    await waitFor(() => expect(state.roleChanges).toEqual([['acct-1', 'u-2', 'viewer']]));
  });

  it('is never offered owner in the picker, because ownership moves through a transfer', async () => {
    mount();
    const picker = await screen.findByLabelText('Role for ada@example.com');
    const options = within(picker as HTMLElement).getAllByRole('option').map((o) => o.textContent);
    expect(options.join(' ')).not.toMatch(/^Owner$/m);
    expect(options.some((label) => label?.trim() === 'Owner')).toBe(false);
  });

  it('gets no controls at all on the owner’s row, whose UPDATE would match zero rows', async () => {
    mount();
    await screen.findByLabelText('Role for ada@example.com');
    // One picker for the editor, one for the admin peer, one on the invite form. None for the
    // owner: their row carries a sentence instead.
    expect(screen.queryByLabelText('Role for The account owner')).toBeNull();
    expect(screen.getAllByRole('combobox')).toHaveLength(3);
    expect(screen.getByText(/always has an owner/i)).toBeTruthy();
  });

  it('reports a change that reached no row as not saved', async () => {
    const user = userEvent.setup();
    state.writeResult = { ok: false, message: 'Nothing changed. That person is not somebody this account lets you change.' };
    mount();
    const picker = await screen.findByLabelText('Role for ada@example.com');
    await user.selectOptions(picker, 'viewer');
    expect(await screen.findByRole('alert')).toHaveTextContent(/nothing changed/i);
  });
});

describe('removing somebody', () => {
  beforeEach(() => {
    state.members = {
      ok: true,
      value: [member(), member({ userId: 'u-2', role: 'editor', email: 'ada@example.com' })]
    };
  });

  it('asks first, and says what removal does and does not do', async () => {
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole('button', { name: /^remove$/i }));
    expect(screen.getByText(/very next action/i)).toBeTruthy();
    expect(screen.getByText(/The record that they were here is kept/i)).toBeTruthy();
    expect(state.statusChanges).toEqual([]);
  });

  it('removes by status rather than by deleting', async () => {
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole('button', { name: /^remove$/i }));
    await user.click(screen.getByRole('button', { name: /yes, remove them/i }));
    await waitFor(() => expect(state.statusChanges).toEqual([['acct-1', 'u-2', 'removed']]));
  });
});

describe('inviting somebody', () => {
  it('sends the account, the address and the role, and nothing else', async () => {
    const user = userEvent.setup();
    mount();
    await user.type(await screen.findByLabelText(/email address/i), 'ada@example.com');
    await user.click(screen.getByRole('button', { name: /send invitation/i }));
    await waitFor(() =>
    expect(state.sent).toEqual([{ accountId: 'acct-1', email: 'ada@example.com', role: 'viewer' }])
    );
  });

  it('offers read only for free and marks which roles cost a seat', async () => {
    mount();
    const picker = await screen.findByLabelText(/what they can do/i);
    const options = within(picker as HTMLElement).getAllByRole('option').map((o) => o.textContent);
    expect(options.join(' ')).toMatch(/Read only \(free\)/);
    expect(options.join(' ')).toMatch(/Editor \(uses a seat\)/);
  });

  it('refuses a seat-consuming role at the ceiling BEFORE the address is typed', async () => {
    // The ceiling is enforced at commit by a deferred constraint trigger, so a request here would
    // come back refused carrying exactly the information this sentence already has.
    const user = userEvent.setup();
    state.seatsInUse = 3;
    mount();
    await user.selectOptions(await screen.findByLabelText(/what they can do/i), 'editor');
    expect(screen.getByText(/Every editor seat on this plan is taken/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /send invitation/i })).toBeDisabled();
  });

  it('still allows a read-only invitation at the ceiling, because those are free', async () => {
    const user = userEvent.setup();
    state.seatsInUse = 3;
    mount();
    await user.type(await screen.findByLabelText(/email address/i), 'ada@example.com');
    expect(screen.getByRole('button', { name: /send invitation/i })).not.toBeDisabled();
  });

  it('says an endpoint that is not deployed is not the person’s fault', async () => {
    const user = userEvent.setup();
    state.sendResult = {
      ok: false,
      reason: 'not_deployed',
      message: 'Invitations cannot be sent from here yet.'
    };
    mount();
    await user.type(await screen.findByLabelText(/email address/i), 'ada@example.com');
    await user.click(screen.getByRole('button', { name: /send invitation/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/cannot be sent from here yet/i);
  });

  it('confirms what was sent and that it now holds a seat', async () => {
    const user = userEvent.setup();
    mount();
    await user.type(await screen.findByLabelText(/email address/i), 'ada@example.com');
    await user.click(screen.getByRole('button', { name: /send invitation/i }));
    expect(await screen.findByRole('status')).toHaveTextContent(/holds a seat/i);
  });
});

describe('pending invitations', () => {
  beforeEach(() => {
    state.invites = {
      ok: true,
      value: [
      {
        id: 'inv-1',
        email: 'newcomer@example.com',
        role: 'editor',
        status: 'pending',
        createdAt: '2026-08-01',
        expiresAt: '2026-08-08',
        acceptedAt: null,
        acceptedBy: null
      },
      {
        id: 'inv-2',
        email: 'gone@example.com',
        role: 'editor',
        status: 'revoked',
        createdAt: '2026-07-01',
        expiresAt: '2026-07-08',
        acceptedAt: null,
        acceptedBy: null
      }]

    };
  });

  it('lists only the ones still waiting, and says a seat is held from the moment it is sent', async () => {
    mount();
    expect(await screen.findByText('newcomer@example.com')).toBeTruthy();
    expect(screen.queryByText('gone@example.com')).toBeNull();
    expect(screen.getByText(/holds a seat from the moment it is sent/i)).toBeTruthy();
  });

  it('withdraws one, which returns the reserved seat', async () => {
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole('button', { name: /withdraw/i }));
    await waitFor(() => expect(state.revoked).toEqual(['inv-1']));
  });
});

describe('reading who is in the account', () => {
  it('never renders an empty account over a read that failed', async () => {
    // The same class of false sentence as "you have no products", and on this screen it reads as
    // everybody having been removed.
    state.members = { ok: false, message: 'This is us, not you, and nothing has changed.' };
    mount();
    expect(await screen.findByRole('alert')).toHaveTextContent(/this is us, not you/i);
    expect(screen.getByRole('button', { name: /try again/i })).toBeTruthy();
  });

  it('says plainly why another member’s email is missing rather than leaving a blank', async () => {
    state.members = { ok: true, value: [member(), member({ userId: 'u-2', role: 'editor' })] };
    mount();
    expect(await screen.findByText(/only lets you read your own/i)).toBeTruthy();
  });
});

describe('more than one workspace', () => {
  it('offers a switcher, and only then', async () => {
    state.accounts = [
    { accountId: 'acct-1', accountName: 'Hearth and Hollow', role: 'owner', roleLabel: 'Owner', isOwner: true },
    { accountId: 'acct-2', accountName: 'Second Business', role: 'editor', roleLabel: 'Editor', isOwner: false }];

    const user = userEvent.setup();
    mount();
    expect(await screen.findByText(/Your workspaces/i)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: /work in this one/i }));
    expect(state.selected).toEqual(['acct-2']);
  });

  it('renders no switcher for the one-account customer, which is everybody today', async () => {
    mount();
    await screen.findByText(/Members/);
    expect(screen.queryByText(/Your workspaces/i)).toBeNull();
  });
});
