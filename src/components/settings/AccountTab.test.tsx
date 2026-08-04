import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

/**
 * The account screen, in jsdom.
 *
 * What is worth testing here is not the layout but the branches a maker can be
 * dropped into: a Google-only account that has no password to change, a wrong
 * current password, and a consent toggle that must put itself back if the write
 * fails. Each is a state someone hits on a bad day, which is exactly when a
 * silent failure is most expensive.
 */

const changePassword = vi.fn();
const sendSetPasswordLink = vi.fn();
const fetchConsentPreferences = vi.fn();
const updateConsentPreference = vi.fn();
const signOut = vi.fn();
const changeEmail = vi.fn();

let currentUser: unknown = {
  id: 'user-1',
  email: 'maker@example.com',
  identities: [{ provider: 'email' }]
};

let entitlement = {
  loading: false,
  businessName: 'Willow & Wick',
  status: 'active',
  active: true,
  plan: 'maker',
  planStatus: 'active',
  refresh: vi.fn()
};

const settings = {
  status: 'ready',
  accountId: 'acct-1111',
  identity: null,
  addresses: [],
  preferences: null,
  requests: [],
  error: null,
  reload: vi.fn(),
  saveIdentity: vi.fn(),
  saveAddress: vi.fn(),
  savePreferences: vi.fn(),
  requestData: vi.fn().mockResolvedValue({ error: null })
};

async function renderTab() {
  vi.resetModules();

  vi.doMock('../../lib/auth', () => ({
    useAuth: () => ({
      user: currentUser,
      session: {},
      loading: false,
      configured: true,
      signOut
    })
  }));
  vi.doMock('../../lib/entitlement', () => ({ useEntitlement: () => entitlement }));
  vi.doMock('../../lib/account', async () => {
    const actual = await vi.importActual<typeof import('../../lib/account')>('../../lib/account');
    return { ...actual, changePassword, sendSetPasswordLink, changeEmail };
  });
  vi.doMock('../../lib/consent-preferences', () => ({
    fetchConsentPreferences,
    updateConsentPreference
  }));
  // The data-rights card reads the settings store. Stubbed here rather than provided, because
  // this file is about passwords and consent; the card's own behaviour — what it records, and
  // what it refuses to claim — is tested in account-data-rights.test.tsx against the real one.
  vi.doMock('../../lib/settings-store', () => ({ useSettings: () => settings }));

  const { AccountTab } = await import('./AccountTab');
  // AccountTab links to /billing with a router Link now — billing moved into this app, so
  // it is internal navigation rather than a hop to www — and Link needs router context.
  const result = render(
    <MemoryRouter>
      <AccountTab />
    </MemoryRouter>
  );
  // The consent read is fired on mount. Settle it here so every test starts from
  // a resolved screen rather than racing a promise it never mentions.
  await waitFor(() =>
  expect(screen.queryByText(/checking your preferences/i)).not.toBeInTheDocument()
  );
  return result;
}

beforeEach(() => {
  currentUser = { id: 'user-1', email: 'maker@example.com', identities: [{ provider: 'email' }] };
  entitlement = {
    loading: false,
    businessName: 'Willow & Wick',
    status: 'active',
    active: true,
    plan: 'maker',
    planStatus: 'active',
    refresh: vi.fn()
  };
  changePassword.mockReset().mockResolvedValue({ error: null, otherSessionsRemain: false });
  sendSetPasswordLink.mockReset().mockResolvedValue({ error: null });
  changeEmail.mockReset().mockResolvedValue({ error: null, pending: 'new@example.com' });
  fetchConsentPreferences.
  mockReset().
  mockResolvedValue({ marketingEmail: false, advertising: true });
  updateConsentPreference.mockReset().mockResolvedValue({ error: null });
  signOut.mockReset();
});

describe('password', () => {
  /*
   * 15 s, and only this one.
   *
   * It is the heaviest test in the suite: it renders the whole settings tab with its
   * providers, drives three password fields, and then waits on a mock. Alone it finishes in
   * about two seconds; under the full suite's parallel jsdom environments it lands at ~6 s
   * and was tripping the 5 s default about half the time.
   *
   * Raising the global timeout would have hidden every other slow test behind the same
   * change. Both streams that met this flake put it down to machine contention and moved on,
   * which is how a test that fails half the time in CI becomes something everybody learns to
   * re-run. Naming the one test and saying why is the honest version.
   */
  it('asks for the current password and sends all three to changePassword', { timeout: 15_000 }, async () => {
    // delay: null — userEvent simulates human typing speed by default, and these tests type
    // 55 characters across three fields. That put this one at 5113 ms against a 5000 ms
    // budget: passing alone, failing whenever the machine was busy. A test that close to its
    // limit fails intermittently in CI for ever, which is worse than a slow one. Removing the
    // artificial delay changes no assertion — the event sequence is identical, only the
    // waiting between keystrokes goes.
    const user = userEvent.setup({ delay: null });
    await renderTab();

    await user.type(screen.getByLabelText(/current password/i), 'the-old-one');
    await user.type(screen.getByLabelText(/^new password/i), 'a-brand-new-passphrase');
    await user.type(screen.getByLabelText(/confirm new password/i), 'a-brand-new-passphrase');
    await user.click(screen.getByRole('button', { name: /change password/i }));

    await waitFor(() =>
    expect(changePassword).toHaveBeenCalledWith({
      email: 'maker@example.com',
      currentPassword: 'the-old-one',
      newPassword: 'a-brand-new-passphrase',
      confirmPassword: 'a-brand-new-passphrase'
    })
    );
  });

  it('says what happened to the maker`s other devices', async () => {
    const user = userEvent.setup({ delay: null });
    await renderTab();

    await user.type(screen.getByLabelText(/current password/i), 'the-old-one');
    await user.type(screen.getByLabelText(/^new password/i), 'a-brand-new-passphrase');
    await user.type(screen.getByLabelText(/confirm new password/i), 'a-brand-new-passphrase');
    await user.click(screen.getByRole('button', { name: /change password/i }));

    expect(await screen.findByText(/every other browser and device has been signed out/i)).
    toBeInTheDocument();
  });

  it('announces a wrong current password and moves focus to it', async () => {
    changePassword.mockResolvedValue({
      error: 'That is not your current password.',
      field: 'current'
    });
    const user = userEvent.setup({ delay: null });
    await renderTab();

    await user.type(screen.getByLabelText(/current password/i), 'wrong');
    await user.type(screen.getByLabelText(/^new password/i), 'a-brand-new-passphrase');
    await user.type(screen.getByLabelText(/confirm new password/i), 'a-brand-new-passphrase');
    await user.click(screen.getByRole('button', { name: /change password/i }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('That is not your current password.');

    const currentBox = screen.getByLabelText(/current password/i);
    expect(currentBox).toHaveFocus();
    expect(currentBox).toHaveAttribute('aria-invalid', 'true');
    expect(currentBox).toHaveAttribute('aria-describedby', expect.stringContaining('password-error'));
  });

  it('offers a reset route for someone who cannot supply the current password', async () => {
    await renderTab();

    expect(screen.getByRole('link', { name: /do not know your current password/i })).
    toHaveAttribute('href', 'https://www.batchlabel.xyz/forgot-password');
  });

  it('leads with the set-password card for a Google-only account', async () => {
    currentUser = {
      id: 'user-1',
      email: 'maker@example.com',
      identities: [{ provider: 'google' }]
    };
    await renderTab();

    expect(screen.queryByLabelText(/current password/i)).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /email me a link to set a password/i })
    ).toBeInTheDocument();
  });

  it('emails a set-password link to a Google-only maker', async () => {
    currentUser = {
      id: 'user-1',
      email: 'maker@example.com',
      identities: [{ provider: 'google' }]
    };
    const user = userEvent.setup({ delay: null });
    await renderTab();

    await user.click(screen.getByRole('button', { name: /email me a link to set a password/i }));

    await waitFor(() => expect(sendSetPasswordLink).toHaveBeenCalledWith('maker@example.com'));
    expect(await screen.findByRole('status')).toHaveTextContent(/on its way/i);
  });

  /**
   * The stranding bug. Setting a password through `updateUser` does not add an
   * `email` identity, so a maker who used the set-password link still reports
   * Google only for ever. When the identity list was a gate, that meant they
   * could never reach the form to change the password they now had.
   */
  it('never traps a Google-only maker away from the change form', async () => {
    currentUser = {
      id: 'user-1',
      email: 'maker@example.com',
      identities: [{ provider: 'google' }]
    };
    const user = userEvent.setup({ delay: null });
    await renderTab();

    await user.click(screen.getByRole('button', { name: /already have a password/i }));

    expect(screen.getByLabelText(/current password/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^change password$/i })).toBeInTheDocument();
  });

  it('never traps an email maker away from adding a password', async () => {
    const user = userEvent.setup({ delay: null });
    await renderTab();

    await user.click(screen.getByRole('button', { name: /add one instead/i }));

    expect(
      screen.getByRole('button', { name: /email me a link to set a password/i })
    ).toBeInTheDocument();
  });

  it('keeps the send button mounted so a lost email can be resent', async () => {
    currentUser = {
      id: 'user-1',
      email: 'maker@example.com',
      identities: [{ provider: 'google' }]
    };
    const user = userEvent.setup({ delay: null });
    await renderTab();

    const send = screen.getByRole('button', { name: /email me a link to set a password/i });
    await user.click(send);

    // Replacing the button with its own confirmation dropped keyboard focus to
    // the body and left no way to ask again — which is the most likely next
    // action, because the reason to come back here is that it did not arrive.
    const again = await screen.findByRole('button', { name: /send another link/i });
    expect(again).toBeInTheDocument();

    await user.click(again);
    await waitFor(() => expect(sendSetPasswordLink).toHaveBeenCalledTimes(2));
  });

  it('announces success, not just displays it', async () => {
    const user = userEvent.setup({ delay: null });
    await renderTab();

    await user.type(screen.getByLabelText(/current password/i), 'the-old-one');
    await user.type(screen.getByLabelText(/^new password/i), 'a-brand-new-passphrase');
    await user.type(screen.getByLabelText(/confirm new password/i), 'a-brand-new-passphrase');
    await user.click(screen.getByRole('button', { name: /^change password$/i }));

    // A confirmation a screen reader never hears is a form that appears to have
    // done nothing.
    const status = await screen.findByRole('status');
    expect(status).toHaveTextContent(/password changed/i);
    expect(status).toHaveTextContent(/every other browser and device has been signed out/i);
  });
});

describe('consent', () => {
  it('writes marketing email through the consent module', async () => {
    const user = userEvent.setup({ delay: null });
    await renderTab();

    const box = await screen.findByRole('checkbox', { name: /marketing emails/i });
    expect(box).not.toBeChecked();

    await user.click(box);

    await waitFor(() =>
    expect(updateConsentPreference).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'marketing_emails' }),
      true
    )
    );
    expect(box).toBeChecked();
  });

  /**
   * The box used to disable itself while saving, which blurs it and drops
   * keyboard focus to the body — a keyboard user's reward for ticking a box was
   * being thrown to the top of the document. The write is guarded in the
   * handler instead.
   */
  it('keeps focus on the checkbox while the write is in flight', async () => {
    let release: (value: {error: null;}) => void = () => undefined;
    updateConsentPreference.mockReturnValue(new Promise((resolve) => {release = resolve;}));
    const user = userEvent.setup({ delay: null });
    await renderTab();

    const box = await screen.findByRole('checkbox', { name: /marketing emails/i });
    await user.click(box);

    expect(box).toHaveFocus();
    expect(box).not.toBeDisabled();

    release({ error: null });
    await waitFor(() => expect(box).toBeChecked());
    expect(box).toHaveFocus();
  });

  it('puts the box back and says so when the write fails', async () => {
    updateConsentPreference.mockResolvedValue({ error: 'We could not save that just now.' });
    const user = userEvent.setup({ delay: null });
    await renderTab();

    const box = await screen.findByRole('checkbox', { name: /marketing emails/i });
    await user.click(box);

    // An optimistic tick that stays ticked after a failed write is a lie about
    // what we have on file.
    await waitFor(() => expect(box).not.toBeChecked());
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not save/i);
  });

  it('shows advertising as a state with a link out, never as a second toggle', async () => {
    await renderTab();

    expect(await screen.findByText(/advertising and retargeting/i)).toBeInTheDocument();
    // Exactly one checkbox on the screen: marketing email. Advertising is the
    // cookie banner's question and must not be asked again here.
    expect(screen.getAllByRole('checkbox')).toHaveLength(1);
    expect(screen.getByRole('link', { name: /change in cookie settings/i })).toHaveAttribute(
      'href',
      'https://www.batchlabel.xyz/cookie-policy?cookie-settings=1'
    );
  });

  it('does not invent a preference when the read fails', async () => {
    fetchConsentPreferences.mockResolvedValue(null);
    await renderTab();

    expect(await screen.findByText(/could not read your preferences/i)).toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });
});

describe('the rest of the account', () => {
  it('shows how the maker signs in', async () => {
    currentUser = {
      id: 'user-1',
      email: 'maker@example.com',
      identities: [{ provider: 'google' }, { provider: 'email' }]
    };
    await renderTab();

    expect(screen.getByText('Google')).toBeInTheDocument();
    expect(screen.getByText('Email and password')).toBeInTheDocument();
  });

  it('offers sign out, which the sidebar menu cannot do on a phone', async () => {
    const user = userEvent.setup({ delay: null });
    await renderTab();

    await user.click(screen.getByRole('button', { name: /^sign out$/i }));

    expect(signOut).toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------------ email */

describe('changing the sign-in address', () => {
  it('sends the request and reports an email, not a change', async () => {
    const user = userEvent.setup({ delay: null });
    await renderTab();

    await user.type(screen.getByLabelText(/Change your email address/i), 'new@example.com');
    await user.click(screen.getByRole('button', { name: /Send a confirmation link/i }));

    expect(changeEmail).toHaveBeenCalledWith({
      currentEmail: 'maker@example.com',
      nextEmail: 'new@example.com'
    });
    // The address has not moved. Anything on screen that reads as "changed" is a lie about
    // how this person gets back into their account.
    expect(await screen.findByText(/Nothing has changed yet/i)).toBeInTheDocument();
    expect(screen.queryByText(/email updated/i)).not.toBeInTheDocument();
  });

  it('says what a maker still signs in with while a change is waiting', async () => {
    currentUser = {
      id: 'user-1',
      email: 'maker@example.com',
      new_email: 'waiting@example.com',
      identities: [{ provider: 'email' }]
    };
    await renderTab();

    // Read off the session user rather than remembered from a form, so it survives a reload
    // and disappears by itself when the change completes.
    const notice = screen.getByText(/holding a request to move this account/i);
    expect(notice.textContent).toMatch(/waiting@example\.com/);
    expect(notice.textContent).toMatch(/You still sign in with maker@example\.com/);
  });

  it('does not claim an email was sent when the request was refused', async () => {
    changeEmail.mockResolvedValue({ error: 'That address cannot be used for this account.' });
    const user = userEvent.setup({ delay: null });
    await renderTab();

    await user.type(screen.getByLabelText(/Change your email address/i), 'taken@example.com');
    await user.click(screen.getByRole('button', { name: /Send a confirmation link/i }));

    expect(await screen.findByText(/cannot be used for this account/i)).toBeInTheDocument();
    expect(screen.queryByText(/Confirmation sent/i)).not.toBeInTheDocument();
  });
});
