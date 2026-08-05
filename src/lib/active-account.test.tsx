import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * WHICH ACCOUNT THE APP IS ACTING IN, AND THE FOUR STATES THAT ARE NOT "ready".
 *
 * The case worth reading first is `choose`. A person in two accounts is the one the whole
 * account_id contract exists for: `public.current_account_id()` returns NULL for them, fourteen
 * tables turn that into P0001 with hint = 'account_ambiguous', and the sentence the database
 * raises says in those words that choosing the account is the app's job. These tests are that
 * job being done, and the property that matters most is the negative one: an id this person is
 * not a member of is NEVER substituted with whichever account sorted first.
 */

const team = vi.hoisted(() => ({
  accounts: {
    ok: true,
    accounts: [] as Array<Record<string, unknown>>,
    missing: false,
    message: null as string | null
  },
  matrix: null as unknown,
  calls: 0
}));

const auth = vi.hoisted(() => ({ userId: 'user-1' as string | null, configured: true }));
const sink = vi.hoisted(() => ({ reports: [] as string[] }));

vi.mock('./team', () => ({
  fetchMyAccounts: async () => {
    team.calls += 1;
    return team.accounts;
  },
  fetchPermissionMatrix: async () => team.matrix
}));

vi.mock('./auth', () => ({
  useAuth: () => ({
    user: auth.userId ? { id: auth.userId } : null,
    configured: auth.configured
  })
}));

vi.mock('./report-error', () => ({
  reportError: (error: unknown) => {
    sink.reports.push(String((error as Error).message ?? error));
    return { reference: 'AAAA-BBBB' };
  }
}));

import { ActiveAccountProvider, useActiveAccount, useCan } from './active-account';

function Probe() {
  const value = useActiveAccount();
  return (
    <div>
      <p data-testid="status">{value.status}</p>
      <p data-testid="account">{value.accountId ?? 'none'}</p>
      <p data-testid="role">{value.role ?? 'none'}</p>
      <p data-testid="write">{String(value.can('write_data'))}</p>
      <p data-testid="members">{String(value.can('manage_members'))}</p>
      {value.accounts.map((entry) =>
      <button key={entry.accountId} onClick={() => value.select(entry.accountId)}>
          pick {entry.accountId}
        </button>
      )}
    </div>);

}

function mount() {
  return render(
    <ActiveAccountProvider>
      <Probe />
    </ActiveAccountProvider>
  );
}

function account(overrides: Record<string, unknown> = {}) {
  return {
    accountId: 'acct-1',
    brand: 'batchlabel',
    accountName: 'Hearth and Hollow',
    role: 'owner',
    roleRank: 40,
    roleLabel: 'Owner',
    isOwner: true,
    joinedAt: '2026-01-01',
    ...overrides
  };
}

beforeEach(() => {
  team.accounts = { ok: true, accounts: [account()], missing: false, message: null };
  team.matrix = null;
  team.calls = 0;
  auth.userId = 'user-1';
  auth.configured = true;
  sink.reports = [];
  window.localStorage.clear();
  window.history.replaceState({}, '', '/');
});

describe('one account', () => {
  it('is selected with no question asked, which is every customer today', async () => {
    mount();
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('ready'));
    expect(screen.getByTestId('account')).toHaveTextContent('acct-1');
    expect(screen.getByTestId('role')).toHaveTextContent('owner');
  });

  it('answers the capability questions from the role the database gave', async () => {
    team.accounts = { ok: true, accounts: [account({ role: 'viewer', roleRank: 10 })], missing: false, message: null };
    mount();
    await waitFor(() => expect(screen.getByTestId('role')).toHaveTextContent('viewer'));
    expect(screen.getByTestId('write')).toHaveTextContent('false');
    expect(screen.getByTestId('members')).toHaveTextContent('false');
  });

  it('gives an editor writes and no member management', async () => {
    team.accounts = { ok: true, accounts: [account({ role: 'editor', roleRank: 20 })], missing: false, message: null };
    mount();
    await waitFor(() => expect(screen.getByTestId('role')).toHaveTextContent('editor'));
    expect(screen.getByTestId('write')).toHaveTextContent('true');
    expect(screen.getByTestId('members')).toHaveTextContent('false');
  });
});

describe('no account at all', () => {
  it('says so, rather than reporting a failure', async () => {
    // Signup did not finish. Every screen already says that with its own next step attached, so
    // this state exists to be distinguishable from a read that broke.
    team.accounts = { ok: true, accounts: [], missing: false, message: null };
    mount();
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('none'));
    expect(screen.getByTestId('account')).toHaveTextContent('none');
  });
});

describe('a read that failed', () => {
  it('is its own state and still lets every control render', async () => {
    // Failing open. A blipped read must not turn an owner's account read-only, and the database
    // refuses anything the app gets wrong regardless.
    team.accounts = { ok: false, accounts: [], missing: false, message: 'no' };
    mount();
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('error'));
    expect(screen.getByTestId('write')).toHaveTextContent('true');
    expect(screen.getByTestId('members')).toHaveTextContent('true');
  });
});

describe('a database that predates the matrix', () => {
  it('is `legacy`, so the entitlements view keeps answering and nothing goes read-only', async () => {
    // This app deploys independently of the migrations in the www repo and usually lands first.
    // PGRST202 for my_accounts is the ordinary condition of that window, not a fault.
    team.accounts = { ok: false, accounts: [], missing: true, message: null };
    mount();
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('legacy'));
    expect(screen.getByTestId('role')).toHaveTextContent('none');
    expect(screen.getByTestId('write')).toHaveTextContent('true');
  });
});

describe('more than one account', () => {
  beforeEach(() => {
    team.accounts = {
      ok: true,
      accounts: [
      account(),
      account({ accountId: 'acct-2', accountName: 'Second', role: 'editor', roleRank: 20, isOwner: false })],

      missing: false,
      message: null
    };
  });

  it('asks rather than guessing', async () => {
    mount();
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('choose'));
    expect(screen.getByTestId('account')).toHaveTextContent('none');
  });

  it('honours ?account= when it names an account this person is in', async () => {
    // A parameter is what makes a link to a workspace shareable and lets two tabs sit in two
    // accounts, which a stored preference cannot express.
    window.history.replaceState({}, '', '/?account=acct-2');
    mount();
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('ready'));
    expect(screen.getByTestId('account')).toHaveTextContent('acct-2');
    expect(screen.getByTestId('role')).toHaveTextContent('editor');
  });

  it('IGNORES an ?account= naming an account they are not in, and never substitutes another', async () => {
    // THE ASSERTION THIS FILE EXISTS FOR. Falling back to "whichever one sorted first" would
    // file a maker's product in a different business of theirs, silently, off a link somebody
    // sent them.
    window.history.replaceState({}, '', '/?account=acct-somebody-elses');
    mount();
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('choose'));
    expect(screen.getByTestId('account')).toHaveTextContent('none');
  });

  it('remembers the choice for next time, keyed by the person who made it', async () => {
    const user = userEvent.setup();
    const view = mount();
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('choose'));

    await user.click(screen.getByRole('button', { name: 'pick acct-2' }));
    await waitFor(() => expect(screen.getByTestId('account')).toHaveTextContent('acct-2'));

    view.unmount();
    mount();
    await waitFor(() => expect(screen.getByTestId('account')).toHaveTextContent('acct-2'));
  });

  it('does not carry one person’s remembered account into another person’s session', async () => {
    // Two people share a browser more often than anybody plans for, and an account id remembered
    // for one of them is a workspace the other cannot open.
    window.localStorage.setItem('batchlabel.active-account.user-2', 'acct-2');
    mount();
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('choose'));
  });

  it('drops a remembered account this person has since been removed from', async () => {
    window.localStorage.setItem('batchlabel.active-account.user-1', 'acct-9');
    mount();
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('choose'));
  });
});

describe('the matrix in force', () => {
  it('is the database’s copy when it could be read', async () => {
    // Moving write_data up to admin is one UPDATE in SQL. The app follows without a redeploy.
    team.matrix = {
      roles: [
      { role: 'editor', rank: 20, consumesSeat: true, label: 'Editor' },
      { role: 'admin', rank: 30, consumesSeat: true, label: 'Admin' }],

      capabilities: [{ capability: 'write_data', minRank: 30 }]
    };
    team.accounts = { ok: true, accounts: [account({ role: 'editor', roleRank: 20 })], missing: false, message: null };
    mount();
    await waitFor(() => expect(screen.getByTestId('role')).toHaveTextContent('editor'));
    expect(screen.getByTestId('write')).toHaveTextContent('false');
  });

  it('falls back to the compiled copy when the read failed, rather than deciding nothing', async () => {
    team.matrix = null;
    team.accounts = { ok: true, accounts: [account({ role: 'editor', roleRank: 20 })], missing: false, message: null };
    mount();
    await waitFor(() => expect(screen.getByTestId('write')).toHaveTextContent('true'));
    expect(sink.reports).toEqual([]);
  });

  it('files a report when the database disagrees with the compiled copy, and changes no decision', async () => {
    team.matrix = {
      roles: [
      { role: 'viewer', rank: 10, consumesSeat: false, label: 'Read only' },
      { role: 'editor', rank: 20, consumesSeat: true, label: 'Editor' },
      { role: 'admin', rank: 30, consumesSeat: true, label: 'Admin' },
      { role: 'owner', rank: 40, consumesSeat: true, label: 'Owner' }],

      capabilities: [
      { capability: 'read', minRank: 10 },
      { capability: 'write_data', minRank: 20 },
      { capability: 'manage_identity', minRank: 30 },
      { capability: 'manage_members', minRank: 40 },
      { capability: 'manage_billing', minRank: 40 },
      { capability: 'manage_account', minRank: 40 }]

    };
    team.accounts = { ok: true, accounts: [account({ role: 'admin', roleRank: 30 })], missing: false, message: null };
    mount();
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('ready'));
    await waitFor(() => expect(sink.reports).toHaveLength(1));
    expect(sink.reports[0]).toContain('manage_members');
    // The database's copy is what decided, which is the whole point of reporting rather than
    // correcting: an admin does not manage members in that database, and the app agrees.
    expect(screen.getByTestId('members')).toHaveTextContent('false');
  });
});

describe('useCan outside a provider', () => {
  it('fails open, so a screen mounted on its own in a test is not a read-only screen', async () => {
    function Bare() {
      const { can, role, roleName } = useCan();
      return (
        <p>
          {String(can('manage_billing'))} {role ?? 'none'} {roleName}
        </p>);

    }
    render(<Bare />);
    expect(screen.getByText(/true none Unknown/)).toBeTruthy();
  });
});

describe('signing out', () => {
  it('discards the accounts rather than leaving them for whoever signs in next', async () => {
    const view = mount();
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('ready'));
    view.unmount();

    auth.userId = null;
    mount();
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('loading'));
    expect(screen.getByTestId('account')).toHaveTextContent('none');
  });
});

describe('an unconfigured deployment', () => {
  it('says so rather than claiming the person is in no accounts', async () => {
    auth.configured = false;
    mount();
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('unconfigured'));
  });
});
