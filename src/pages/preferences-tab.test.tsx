import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { Settings } from './Settings';
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
      enabledCategories: ['home-fragrance'],
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
        <Routes>
          <Route path="/settings/:tab" element={<Settings />} />
        </Routes>
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
    expect(screen.getByText(/label stock the artefact designer offers/i)).toBeInTheDocument();
  });
});
