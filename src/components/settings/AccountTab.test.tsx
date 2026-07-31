import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

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
    return { ...actual, changePassword, sendSetPasswordLink };
  });
  vi.doMock('../../lib/consent-preferences', () => ({
    fetchConsentPreferences,
    updateConsentPreference
  }));

  const { AccountTab } = await import('./AccountTab');
  const result = render(<AccountTab />);
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
  fetchConsentPreferences.
  mockReset().
  mockResolvedValue({ marketingEmail: false, advertising: true });
  updateConsentPreference.mockReset().mockResolvedValue({ error: null });
  signOut.mockReset();
});

describe('password', () => {
  it('asks for the current password and sends all three to changePassword', async () => {
    const user = userEvent.setup();
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
    const user = userEvent.setup();
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
    const user = userEvent.setup();
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

  it('shows no password form for a Google-only account', async () => {
    currentUser = {
      id: 'user-1',
      email: 'maker@example.com',
      identities: [{ provider: 'google' }]
    };
    await renderTab();

    expect(screen.queryByLabelText(/current password/i)).not.toBeInTheDocument();
    expect(screen.getByText(/you signed up with google/i)).toBeInTheDocument();
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
    const user = userEvent.setup();
    await renderTab();

    await user.click(screen.getByRole('button', { name: /email me a link to set a password/i }));

    await waitFor(() => expect(sendSetPasswordLink).toHaveBeenCalledWith('maker@example.com'));
    expect(await screen.findByRole('status')).toHaveTextContent(/on its way/i);
  });
});

describe('consent', () => {
  it('writes marketing email through the consent module', async () => {
    const user = userEvent.setup();
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

  it('puts the box back and says so when the write fails', async () => {
    updateConsentPreference.mockResolvedValue({ error: 'We could not save that just now.' });
    const user = userEvent.setup();
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
    const user = userEvent.setup();
    await renderTab();

    await user.click(screen.getByRole('button', { name: /^sign out$/i }));

    expect(signOut).toHaveBeenCalled();
  });
});
