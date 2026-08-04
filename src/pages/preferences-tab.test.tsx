import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { Settings } from './Settings';
import { WorkspaceProvider } from '../lib/workspace';
import { SettingsContext, type SettingsValue } from '../lib/settings-store';

/**
 * CONTROLS THAT LOOK LIKE SETTINGS MUST EITHER BE SETTINGS OR NOT BE THERE.
 *
 * This tab held two kinds of control and they used to be indistinguishable. The category
 * checkboxes were session state that at least did something; "Default export" and "Default
 * market" were uncontrolled `<Select defaultValue=…>` with no onChange and nowhere to write
 * to. The first fix disabled the two selects and said so. This is the second and last one:
 *
 *   - the categories are STORED, in `batchlabel.workspace_preferences.enabled_categories`, so
 *     the tab now claims a save and has to make one;
 *   - the two selects are GONE, because nothing in this app produces an export and a product's
 *     market is chosen per product. Saving them into a row nothing consults would be the same
 *     defect wearing a database row.
 *
 * WHAT WOULD MAKE THIS FILE RED, AND SHOULD. Re-adding either select — enabled, disabled or
 * "wired up" to a column nothing reads. Letting a toggle stop writing. And, the one that would
 * be easiest to do by accident, letting the checkboxes look identical whether or not a save is
 * possible: the tab has to say when it is only holding a choice for this visit.
 */

vi.mock('../lib/entitlement', () => ({
  useEntitlement: () => ({
    status: 'active',
    accountId: 'acct-1111',
    businessName: 'Test Ltd',
    plan: 'maker',
    skuLimit: 45,
    skuCount: 4,
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

function stubSettings(overrides: Partial<SettingsValue> = {}): SettingsValue {
  return {
    status: 'ready',
    accountId: 'acct-1111',
    identity: null,
    addresses: [],
    preferences: {
      enabledCategories: ['home-fragrance', 'cosmetics', 'electronics'],
      defaultMarket: null,
      defaultExport: null
    },
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

function drawPreferencesTab(settings: SettingsValue) {
  render(
    <MemoryRouter initialEntries={['/settings/preferences']}>
      <SettingsContext.Provider value={settings}>
        <WorkspaceProvider>
          <Routes>
            <Route path="/settings/:tab" element={<Settings />} />
          </Routes>
        </WorkspaceProvider>
      </SettingsContext.Provider>
    </MemoryRouter>
  );
}

describe('the two controls that stored nothing', () => {
  it('does not offer a default export, because nothing exports', () => {
    drawPreferencesTab(stubSettings());
    expect(screen.queryByLabelText(/Default export/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Default export/i)).not.toBeInTheDocument();
  });

  it('does not offer a default market, because a market is chosen per product', () => {
    drawPreferencesTab(stubSettings());
    expect(screen.queryByLabelText(/Default market/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Default market/i)).not.toBeInTheDocument();
  });

  it('does not promise an export default in the tab description', () => {
    drawPreferencesTab(stubSettings());
    expect(screen.queryByText(/what the export defaults to/i)).not.toBeInTheDocument();
    expect(screen.getByText(/Which categories are switched on/i)).toBeInTheDocument();
  });
});

describe('the categories, which are a setting now', () => {
  it('draws the categories the account has stored, not all of them', () => {
    drawPreferencesTab(
      stubSettings({
        preferences: {
          enabledCategories: ['home-fragrance'],
          defaultMarket: null,
          defaultExport: null
        }
      })
    );
    const boxes = screen.getAllByRole('checkbox') as HTMLInputElement[];
    expect(boxes.filter((box) => box.checked)).toHaveLength(1);
  });

  it('writes the whole list when one is switched off', async () => {
    const settings = stubSettings();
    drawPreferencesTab(settings);

    const boxes = screen.getAllByRole('checkbox');
    await userEvent.click(boxes[0]);

    await waitFor(() => expect(settings.savePreferences).toHaveBeenCalledTimes(1));
    // The whole row, not a patch: an upsert missing a column would reset it to the column
    // default, and enabled_categories defaults to home-fragrance alone.
    expect(settings.savePreferences).toHaveBeenCalledWith({
      enabledCategories: ['cosmetics', 'electronics'],
      defaultMarket: null,
      defaultExport: null
    });
  });

  it('refuses to switch the last category off rather than sending a write that cannot land', async () => {
    // `cardinality(enabled_categories) > 0` is a CHECK, so this write would be refused. The
    // box must not flicker on and off while a round trip proves what we already knew.
    const settings = stubSettings({
      preferences: {
        enabledCategories: ['home-fragrance'],
        defaultMarket: null,
        defaultExport: null
      }
    });
    drawPreferencesTab(settings);

    const checked = (screen.getAllByRole('checkbox') as HTMLInputElement[]).find(
      (box) => box.checked
    );
    await userEvent.click(checked as HTMLInputElement);

    expect(settings.savePreferences).not.toHaveBeenCalled();
  });

  it('preserves the columns it does not draw', async () => {
    // Nothing on this screen sets default_market, and a save from here must not wipe one
    // somebody else's code put there.
    const settings = stubSettings({
      preferences: {
        enabledCategories: ['home-fragrance', 'cosmetics', 'electronics'],
        defaultMarket: 'EU',
        defaultExport: 'sheet'
      }
    });
    drawPreferencesTab(settings);

    await userEvent.click(screen.getAllByRole('checkbox')[2]);

    await waitFor(() =>
    expect(settings.savePreferences).toHaveBeenCalledWith(
      expect.objectContaining({ defaultMarket: 'EU', defaultExport: 'sheet' })
    )
    );
  });
});

describe('when the choice cannot be stored', () => {
  it('says so rather than looking identical to a tab that saves', () => {
    drawPreferencesTab(stubSettings({ status: 'unconfigured', preferences: null }));
    expect(screen.getByText(/not being saved right now/i)).toBeInTheDocument();
    expect(screen.getByText(/no database connection/i)).toBeInTheDocument();
  });

  it('tells a failed read apart from an account that has never set one', () => {
    // The house rule: an empty state means empty and a failure means failure, and they never
    // share a sentence. A ready store with no preferences row says nothing at all — the
    // defaults simply apply.
    drawPreferencesTab(stubSettings({ preferences: null }));
    expect(screen.queryByText(/not being saved right now/i)).not.toBeInTheDocument();

    drawPreferencesTab(
      stubSettings({ status: 'error', preferences: null, error: 'We could not read that.' })
    );
    expect(screen.getByText(/We could not read that\./)).toBeInTheDocument();
  });

  it('keeps the boxes usable, and says they last only for this visit', () => {
    drawPreferencesTab(stubSettings({ status: 'unconfigured', preferences: null }));
    for (const box of screen.getAllByRole('checkbox')) expect(box).toBeEnabled();
    expect(screen.getByText(/apply for this visit/i)).toBeInTheDocument();
  });
});

describe('while the stored choice is still being read', () => {
  /**
   * Mid-read is not "not connected" and it is not "you have set nothing". A checkbox that
   * accepts a click here would have it silently overwritten by the row landing a moment later,
   * which is a control that takes a choice and discards it — the same fault as the two selects
   * this file was originally written about, in a shorter window.
   */
  it('holds the boxes rather than accepting a choice it is about to overwrite', () => {
    drawPreferencesTab(stubSettings({ status: 'loading', preferences: null }));
    for (const box of screen.getAllByRole('checkbox')) expect(box).toBeDisabled();
    expect(screen.getByText(/Reading your preferences/i)).toBeInTheDocument();
    // And not the wording used when a save is genuinely impossible.
    expect(screen.queryByText(/not being saved right now/i)).not.toBeInTheDocument();
  });
});
