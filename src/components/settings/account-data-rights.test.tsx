import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AccountTab } from './AccountTab';
import { SettingsContext, type SettingsValue } from '../../lib/settings-store';

/**
 * THE TWO UK GDPR OBLIGATIONS, AND THE LINE THIS CARD MAY NOT CROSS.
 *
 * The privacy notice commits to both. The card used to answer them with an email address and
 * the sentence "There is no button for it yet", which was at least true.
 *
 * There is a button now, and what it does is INSERT one row into
 * `batchlabel.account_data_requests`. It does not export anything and it does not delete
 * anything. It cannot: `authenticated` holds INSERT and SELECT on that table and nothing else,
 * and there is no route from a browser session to a deleted account — deliberately, because a
 * signed-in tab on a borrowed laptop must not be able to destroy somebody's business records.
 *
 * So every assertion here is about the gap between what the button does and what a screen would
 * be tempted to say it did. "Your data has been deleted" off the back of an INSERT is the exact
 * defect class this pass exists to remove, and it is the one with the worst consequence in the
 * file: somebody who believes their account is gone stops checking it.
 */

vi.mock('../../lib/auth', () => ({
  useAuth: () => ({
    user: { id: 'user-1', email: 'maker@example.com', identities: [{ provider: 'email' }] },
    session: {},
    loading: false,
    configured: true,
    signOut: vi.fn()
  })
}));

vi.mock('../../lib/entitlement', () => ({
  useEntitlement: () => ({
    loading: false,
    businessName: 'Willow & Wick',
    status: 'active',
    active: true,
    plan: 'maker',
    planStatus: 'active',
    refresh: vi.fn()
  })
}));

vi.mock('../../lib/consent-preferences', () => ({
  fetchConsentPreferences: async () => ({ marketingEmail: false, advertising: false }),
  updateConsentPreference: async () => ({ error: null })
}));

function stubSettings(overrides: Partial<SettingsValue> = {}): SettingsValue {
  return {
    status: 'ready',
    accountId: 'acct-1111',
    identity: null,
    addresses: [],
    preferences: null,
    requests: [],
    error: null,
    reload: vi.fn(),
    saveIdentity: vi.fn().mockResolvedValue({ error: null, value: null }),
    saveAddress: vi.fn().mockResolvedValue({ error: null, value: null }),
    savePreferences: vi.fn().mockResolvedValue({ error: null }),
    requestData: vi.fn().mockResolvedValue({ error: null }),
    ...overrides
  };
}

/**
 * Rendered and then SETTLED. The consent section fires its read on mount; a test that asserted
 * before it landed would be racing a promise it never mentions, and every one below would carry
 * an act() warning that hides a real one when it appears.
 */
async function drawAccountTab(settings: SettingsValue) {
  render(
    <MemoryRouter>
      <SettingsContext.Provider value={settings}>
        <AccountTab />
      </SettingsContext.Provider>
    </MemoryRouter>
  );
  await waitFor(() =>
  expect(screen.queryByText(/checking your preferences/i)).not.toBeInTheDocument()
  );
}

describe('asking for a copy of your data', () => {
  it('records a request, and says that is what it did', async () => {
    const settings = stubSettings();
    await drawAccountTab(settings);

    await userEvent.click(screen.getByRole('button', { name: /Request a copy of my data/ }));

    await waitFor(() => expect(settings.requestData).toHaveBeenCalledWith('export'));
    expect(
      screen.getByText(/this records the request and we reply by email/i)
    ).toBeInTheDocument();
    // Not a download, not a file, not a link. Nothing produces one.
    expect(screen.queryByText(/download/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/your export is ready/i)).not.toBeInTheDocument();
  });

  it('does not offer a second request while one is open', async () => {
    await drawAccountTab(
      stubSettings({
        requests: [
        {
          id: 'r1',
          kind: 'export',
          status: 'requested',
          requestedAt: '2026-08-05T09:00:00Z',
          completedAt: null,
          note: null
        }]

      })
    );
    expect(screen.getByRole('button', { name: /Already requested/ })).toBeDisabled();
  });

  it('shows the recorded request with the status the DATABASE holds', async () => {
    await drawAccountTab(
      stubSettings({
        requests: [
        {
          id: 'r1',
          kind: 'export',
          status: 'in_progress',
          requestedAt: '2026-08-05T09:00:00Z',
          completedAt: null,
          note: null
        }]

      })
    );
    expect(screen.getByText('In progress')).toBeInTheDocument();
    expect(screen.getByText(/on 5 August 2026/)).toBeInTheDocument();
  });
});

describe('asking us to erase the account', () => {
  it('will not fire on one press', async () => {
    const settings = stubSettings();
    await drawAccountTab(settings);

    await userEvent.click(screen.getByRole('button', { name: /^Request erasure$/ }));

    expect(settings.requestData).not.toHaveBeenCalled();
    expect(screen.getByLabelText(/Type ERASE to confirm/)).toBeInTheDocument();
  });

  it('records the request once the word is typed', async () => {
    const settings = stubSettings();
    await drawAccountTab(settings);

    await userEvent.click(screen.getByRole('button', { name: /^Request erasure$/ }));
    await userEvent.type(screen.getByLabelText(/Type ERASE to confirm/), 'ERASE');
    await userEvent.click(screen.getByRole('button', { name: /Record my erasure request/ }));

    await waitFor(() => expect(settings.requestData).toHaveBeenCalledWith('erasure'));
  });

  /**
   * The sentence that must never appear. An INSERT into a requests table is not an erasure, and
   * somebody who believes their account is gone stops checking it.
   */
  it('never says anything has been deleted', async () => {
    const settings = stubSettings();
    await drawAccountTab(settings);

    await userEvent.click(screen.getByRole('button', { name: /^Request erasure$/ }));
    await userEvent.type(screen.getByLabelText(/Type ERASE to confirm/), 'ERASE');
    await userEvent.click(screen.getByRole('button', { name: /Record my erasure request/ }));
    await waitFor(() => expect(settings.requestData).toHaveBeenCalled());

    expect(screen.queryByText(/has been deleted/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/account closed/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/permanently removed/i)).not.toBeInTheDocument();
    expect(screen.getByText(/cannot delete an account/i)).toBeInTheDocument();
  });

  it('says what will still be there afterwards', async () => {
    await drawAccountTab(stubSettings());
    expect(screen.getByText(/products stay exactly as they are until we do/i)).toBeInTheDocument();
  });
});

describe('when nothing can be recorded', () => {
  it('disables both buttons and gives a route that works', async () => {
    await drawAccountTab(stubSettings({ status: 'no-account', preferences: null }));

    expect(screen.getByRole('button', { name: /Request a copy of my data/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /^Request erasure$/ })).toBeDisabled();
    // A disabled button with no alternative is a dead end on a right somebody has in law.
    expect(screen.getByText(/privacy@batchlabel\.co\.uk/)).toBeInTheDocument();
  });

  it('says which of the reasons it is', async () => {
    await drawAccountTab(stubSettings({ status: 'unconfigured' }));
    expect(screen.getByText(/no database connection/i)).toBeInTheDocument();

    await drawAccountTab(stubSettings({ status: 'error', error: 'The read failed.' }));
    expect(screen.getByText(/The read failed\./)).toBeInTheDocument();
  });

  it('reports a refused insert as a failure rather than as a recorded request', async () => {
    const settings = stubSettings({
      requestData: vi.fn().mockResolvedValue({
        error: 'We could not confirm that your request was recorded.'
      })
    });
    await drawAccountTab(settings);

    await userEvent.click(screen.getByRole('button', { name: /Request a copy of my data/ }));

    expect(await screen.findByText(/could not confirm that your request/i)).toBeInTheDocument();
  });
});

describe('signing out on every device', () => {
  it('is offered as its own control, distinct from signing out here', async () => {
    await drawAccountTab(stubSettings());
    expect(screen.getByRole('button', { name: /^Sign out$/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Sign out on every device/ })).toBeInTheDocument();
    expect(screen.getByText(/including this one/i)).toBeInTheDocument();
  });
});
