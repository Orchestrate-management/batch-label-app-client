import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { Settings } from './Settings';
import { WorkspaceProvider } from '../lib/workspace';
import { SettingsContext, type SettingsValue } from '../lib/settings-store';
import { describeWriteFailure } from '../lib/settings-data';

/**
 * A REFUSED WRITE HAS TO SHOW THE MAKER SOMETHING.
 *
 * Companion to preferences-tab.test.tsx, which covers what this tab offers and what it stores.
 * This file is about the other half, and it is the half that was missing: what a maker sees
 * when the write they just triggered is REFUSED.
 *
 * What it was. Untick Cosmetics, `savePreferences` comes back refused (42501, or a request
 * that never lands): the box stays ticked because the stored row is what draws it — and that
 * was the only thing that happened. `queryAllByRole('alert')` was empty. No sentence anywhere
 * on the page matched /did not accept|could not save|not been saved|failed/. There was not
 * even a pending state, so the click produced no evidence of itself of any kind. The maker's
 * reasonable conclusion is that the control is broken, and their reasonable next move is to
 * click it again, firing another failed write each time.
 *
 * WHY IT WAS NOT A MISSING SENTENCE ON THIS SCREEN. `toggleCategory` in lib/workspace.tsx
 * returned `void` and dropped the promise, so there was no answer for any screen to render.
 * The comment above it claimed "the Preferences screen wraps this with its own saving and
 * error state" — it did not, and there was nothing it could have wrapped. The signature is
 * what is fixed; this file is what proves the fix reaches the glass.
 *
 * WHAT WOULD MAKE THIS FILE RED, AND SHOULD. `toggleCategory` going back to `void`, or any
 * screen dropping `categoryWrite`. A refusal announced as a status rather than an alert. The
 * "you may not switch the last one off" case being dressed up as a failure — nothing failed
 * and nothing was sent. And the box moving on its own before the row does: what is drawn has
 * to be what is stored, or a refused save leaves a tick over a row that does not agree.
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

function boxes() {
  return screen.getAllByRole('checkbox') as HTMLInputElement[];
}

/**
 * The sentence the app ACTUALLY produces for a row level security refusal, taken from the
 * function that produces it rather than retyped here. A test that invents its own copy passes
 * over a screen that renders nothing a maker would recognise.
 */
const REFUSED = describeWriteFailure({ code: '42501', message: 'row-level security' });

describe('when the database refuses a category change', () => {
  it('says so, as an alert, in the sentence the app really produces', async () => {
    const savePreferences = vi.fn().mockResolvedValue({ error: REFUSED });
    drawPreferencesTab(stubSettings({ savePreferences }));

    const cosmetics = boxes()[1];
    expect(cosmetics.checked).toBe(true);
    await userEvent.click(cosmetics);

    await waitFor(() => expect(savePreferences).toHaveBeenCalledTimes(1));

    // The three things the maker had none of. An announced failure…
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(REFUSED);
    // …a sentence that names a refusal rather than sounding like nothing happened…
    expect(alert.textContent).toMatch(/did not accept|could not save|not been saved|failed/i);
    // …and a box still showing what is STORED, because the row is the truth.
    expect(boxes()[1].checked).toBe(true);
  });

  it('says it about a request that never arrived, rather than throwing into the void', async () => {
    // `savePreferences` resolves with `{ error }` today and is one await over a network call
    // away from throwing. A `void`-ed rejection is a silent no-op wearing an
    // unhandled-rejection warning nobody sees, which is the same defect again.
    const savePreferences = vi.fn().mockRejectedValue(new Error('Failed to fetch'));
    drawPreferencesTab(stubSettings({ savePreferences }));

    await userEvent.click(boxes()[1]);
    await waitFor(() => expect(savePreferences).toHaveBeenCalledTimes(1));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/did not reach us/i);
    expect(alert).toHaveTextContent(/have not been saved/i);
    // And not the browser's own words, which mean nothing to a candle maker.
    expect(alert.textContent).not.toMatch(/Failed to fetch/);
  });

  it('shows the write is in flight, so the click leaves some evidence of itself', async () => {
    let release: (value: {error: string | null;}) => void = () => {};
    const savePreferences = vi.
    fn().
    mockReturnValue(new Promise<{error: string | null;}>((resolve) => (release = resolve)));
    drawPreferencesTab(stubSettings({ savePreferences }));

    await userEvent.click(boxes()[1]);

    expect(await screen.findByText('Saving…')).toBeInTheDocument();
    release({ error: null });
    await waitFor(() => expect(screen.queryByText('Saving…')).not.toBeInTheDocument());
  });

  it('clears the refusal once a later change is accepted', async () => {
    const savePreferences = vi.
    fn().
    mockResolvedValueOnce({ error: REFUSED }).
    mockResolvedValueOnce({ error: null });
    drawPreferencesTab(stubSettings({ savePreferences }));

    await userEvent.click(boxes()[1]);
    expect(await screen.findByRole('alert')).toHaveTextContent(REFUSED);

    await userEvent.click(boxes()[2]);
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  });
});

describe('the last category, which is not a failure', () => {
  it('says why nothing was sent, and does not call it an error', async () => {
    const savePreferences = vi.fn().mockResolvedValue({ error: null });
    drawPreferencesTab(
      stubSettings({
        savePreferences,
        preferences: {
          enabledCategories: ['home-fragrance'],
          defaultMarket: null,
          defaultExport: null
        }
      })
    );

    await userEvent.click(boxes().find((box) => box.checked) as HTMLInputElement);

    // Still no write — the CHECK would refuse it and the box must not flicker while a round
    // trip proves what we already knew.
    expect(savePreferences).not.toHaveBeenCalled();
    // But the click is no longer silent.
    const status = await screen.findByRole('status');
    expect(status).toHaveTextContent(/at least one category/i);
    // And it is not dressed up as something going wrong.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('when there is no store to save into', () => {
  it('reports neither a refusal nor a save, because nothing was sent', async () => {
    // The tab already says, above the boxes, that these last for this visit only. A toggle in
    // that state must not additionally claim a failure — nothing was attempted.
    drawPreferencesTab(stubSettings({ status: 'unconfigured', preferences: null }));

    await userEvent.click(boxes()[1]);

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByText('Saving…')).not.toBeInTheDocument();
    expect(screen.getByText(/apply for this visit/i)).toBeInTheDocument();
  });
});
