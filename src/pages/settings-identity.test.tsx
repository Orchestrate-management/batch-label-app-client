import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { Settings } from './Settings';
import { SettingsContext, type SettingsValue } from '../lib/settings-store';

/**
 * THE TAB THAT PRINTS ON A LEGAL DOCUMENT.
 *
 * Its history is the reason this file is long. It began as six editable inputs prefilled with
 * the details of a business that does not exist, above a "Save identity" button that raised
 * "Identity saved. 14 outputs now carry the previous details and need versioning." Nothing was
 * saved, nothing was versioned, and a maker who corrected the telephone number that CLP
 * Article 17 requires on the label would have gone on believing their labels carried it. It was
 * then made honest by being disabled.
 *
 * It saves now. So the assertions are about the two things a saving screen can get wrong:
 *
 *   - claiming a save that did not happen, in any of the four states where one cannot;
 *   - claiming a compliance fact off the back of a save that did.
 *
 * The second is subtler and is the one this codebase keeps finding. A screen that knows the
 * supplier block is filled in knows exactly that, and nothing about whether the label is right.
 */

vi.mock('../lib/entitlement', () => ({
  useEntitlement: () => ({
    status: 'active',
    accountId: 'acct-1111',
    businessName: 'Test Ltd',
    plan: 'maker',
    skuLimit: 45,
    skuCount: 0,
    skuCountStale: false,
    skuUnlimited: false,
    canModify: true,
    loading: false,
    refresh: () => {}
  })
}));

vi.mock('../lib/auth', () => ({
  useAuth: () => ({ user: { id: 'user-a', email: 'maker@example.com' }, loading: false })
}));

vi.mock('../lib/meta-pixel', () => ({ metaInitiateCheckout: () => {} }));

vi.mock('../lib/product-store', () => ({
  useProducts: () => ({
    status: 'ready',
    products: [],
    error: null,
    refresh: () => {},
    reload: async () => {}
  })
}));

const SAVED = {
  registeredName: 'Willow and Wick Ltd',
  tradingName: 'Willow & Wick',
  telephone: '01273 000000',
  email: null,
  website: null,
  vatNumber: 'GB123456789',
  updatedAt: '2026-08-04T10:00:00Z'
};

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
    saveIdentity: vi.fn().mockResolvedValue({ error: null, value: SAVED }),
    saveAddress: vi.fn().mockResolvedValue({ error: null, value: null }),
    savePreferences: vi.fn().mockResolvedValue({ error: null }),
    requestData: vi.fn().mockResolvedValue({ error: null }),
    ...overrides
  };
}

function drawIdentityTab(settings: SettingsValue) {
  render(
    <MemoryRouter initialEntries={['/settings/identity']}>
      <SettingsContext.Provider value={settings}>
        <Routes>
          <Route path="/settings/:tab" element={<Settings />} />
        </Routes>
      </SettingsContext.Provider>
    </MemoryRouter>
  );
}

describe('the supplier block', () => {
  it('is editable, which it has not been until now', () => {
    drawIdentityTab(stubSettings());
    expect(screen.getByLabelText(/Registered name/)).toBeEnabled();
    expect(screen.getByLabelText(/Telephone number/)).toBeEnabled();
    expect(screen.getByRole('button', { name: /Save supplier block/ })).toBeEnabled();
  });

  it('draws the stored row rather than a placeholder', () => {
    drawIdentityTab(stubSettings({ identity: SAVED }));
    expect(screen.getByLabelText(/Registered name/)).toHaveValue('Willow and Wick Ltd');
    expect(screen.getByLabelText(/VAT number/)).toHaveValue('GB123456789');
  });

  it('sends every box to the store, and says so only after the row comes back', async () => {
    const settings = stubSettings();
    drawIdentityTab(settings);

    await userEvent.type(screen.getByLabelText(/Registered name/), 'Willow and Wick Ltd');
    await userEvent.type(screen.getByLabelText(/Telephone number/), '01273 000000');
    await userEvent.click(screen.getByRole('button', { name: /Save supplier block/ }));

    await waitFor(() => expect(settings.saveIdentity).toHaveBeenCalledTimes(1));
    expect(settings.saveIdentity).toHaveBeenCalledWith(
      expect.objectContaining({
        registeredName: 'Willow and Wick Ltd',
        telephone: '01273 000000'
      })
    );
    expect(await screen.findByText(/^Saved\./)).toBeInTheDocument();
  });

  it('redraws from the row the database returned, not from what was typed', async () => {
    const settings = stubSettings();
    drawIdentityTab(settings);

    await userEvent.type(screen.getByLabelText(/Registered name/), '  spaces around  ');
    await userEvent.click(screen.getByRole('button', { name: /Save supplier block/ }));

    // The database trims. A maker should see what is actually going to be printed.
    await waitFor(() =>
    expect(screen.getByLabelText(/Registered name/)).toHaveValue('Willow and Wick Ltd')
    );
  });

  /** The whole point of the rewrite: a refused write may not read as a save. */
  it('never says "Saved" when the write was refused', async () => {
    const settings = stubSettings({
      saveIdentity: vi.fn().mockResolvedValue({
        error: 'We could not confirm that saved.',
        value: null
      })
    });
    drawIdentityTab(settings);

    await userEvent.type(screen.getByLabelText(/Registered name/), 'Acme Ltd');
    await userEvent.click(screen.getByRole('button', { name: /Save supplier block/ }));

    expect(await screen.findByText(/could not confirm that saved/i)).toBeInTheDocument();
    expect(screen.queryByText(/^Saved\./)).not.toBeInTheDocument();
  });

  it('does not claim a document was reissued, because none is produced', async () => {
    const settings = stubSettings();
    drawIdentityTab(settings);
    await userEvent.type(screen.getByLabelText(/Registered name/), 'Acme Ltd');
    await userEvent.click(screen.getByRole('button', { name: /Save supplier block/ }));

    await screen.findByText(/^Saved\./);
    // The sentence this screen used to raise as a toast. Nothing versions anything.
    expect(screen.queryByText(/need versioning/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/outputs now carry/i)).not.toBeInTheDocument();
  });
});

describe('what is still a placeholder', () => {
  it('names each missing field rather than leaving it to be discovered on a label', () => {
    drawIdentityTab(stubSettings());
    const callout = screen.getByText(/We are not holding/);
    expect(callout.textContent).toMatch(/registered business name/);
    expect(callout.textContent).toMatch(/telephone number/);
    expect(callout.textContent).toMatch(/Great Britain address block/);
  });

  it('states the law as a requirement, never as a verdict about this account', () => {
    drawIdentityTab(stubSettings());
    const text = screen.getByText(/CLP Article 17/).textContent ?? '';
    expect(text).toMatch(/does not check that what you entered is right/i);
    expect(text).toMatch(/nothing here has reviewed your label/i);
    // Nothing on this screen may say a label is compliant, complete or approved.
    expect(screen.queryByText(/compliant/i)).not.toBeInTheDocument();
  });

  it('says nothing at all once all three are held', () => {
    drawIdentityTab(
      stubSettings({
        identity: SAVED,
        addresses: [
        { id: 'a1', market: 'GB', lines: ['Willow', 'Street', 'Lewes'], updatedAt: null },
        { id: 'a2', market: 'EU', lines: ['Rep', 'Street', 'Rotterdam'], updatedAt: null }]

      })
    );
    expect(screen.queryByText(/We are not holding/)).not.toBeInTheDocument();
  });
});

describe('the address blocks', () => {
  it('saves the lines a maker typed, as lines', async () => {
    const settings = stubSettings();
    drawIdentityTab(settings);

    await userEvent.type(
      screen.getByLabelText(/Great Britain address lines/),
      'Willow and Wick Ltd\n1 Test Street\nLewes BN7 2QA'
    );
    await userEvent.click(screen.getAllByRole('button', { name: /Save this block/ })[0]);

    await waitFor(() => expect(settings.saveAddress).toHaveBeenCalledTimes(1));
    expect(settings.saveAddress).toHaveBeenCalledWith('GB', [
    'Willow and Wick Ltd',
    '1 Test Street',
    'Lewes BN7 2QA']
    );
  });

  it('refuses a shape the renderer cannot lay out, and does not call the store', async () => {
    // The renderer indexes lines[0] and lines[length - 2]. Two lines is a name where a
    // postcode belongs, on a label.
    const settings = stubSettings();
    drawIdentityTab(settings);

    await userEvent.type(screen.getByLabelText(/Great Britain address lines/), 'Acme\nLewes');
    await userEvent.click(screen.getAllByRole('button', { name: /Save this block/ })[0]);

    expect(await screen.findByText(/at least three lines/i)).toBeInTheDocument();
    expect(settings.saveAddress).not.toHaveBeenCalled();
  });

  it('marks a block that has never been filled in as such', () => {
    drawIdentityTab(stubSettings());
    expect(screen.getAllByText('Not filled in')).toHaveLength(2);
  });
});

describe('when the settings cannot be read at all', () => {
  it('offers a retry for a failed read, and says the failure', () => {
    const settings = stubSettings({
      status: 'error',
      error: 'We could not read your printed identity just now.'
    });
    drawIdentityTab(settings);

    expect(screen.getByText(/could not read your printed identity/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Try again/ })).toBeInTheDocument();
    // No form, because there is nothing to save into and nothing to draw from.
    expect(screen.queryByLabelText(/Registered name/)).not.toBeInTheDocument();
  });

  it('does NOT offer a retry for a state a retry cannot move', () => {
    // The defect class by name: a retry button on a state a retry cannot fix. An app with no
    // database connection will have none on the second press either.
    drawIdentityTab(stubSettings({ status: 'unconfigured', error: null }));
    expect(screen.getByText(/no database connection/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Try again/ })).not.toBeInTheDocument();
  });

  it('tells "still reading" apart from "nothing there"', () => {
    drawIdentityTab(stubSettings({ status: 'loading' }));
    expect(screen.getByText(/Reading your settings/i)).toBeInTheDocument();
    expect(screen.queryByText(/We are not holding/)).not.toBeInTheDocument();
  });
});

describe('the emergency telephone, which is not built', () => {
  it('shows no control rather than one that keeps a number nothing prints', () => {
    drawIdentityTab(stubSettings({ identity: SAVED }));
    // There used to be a disabled `<Select>` here offering "A number we operate". Nothing
    // stored it and nothing would have printed it, so it is gone rather than disabled — there
    // is no form control of any kind left in this section.
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.getByText(/is not built/i)).toBeInTheDocument();
  });
});
