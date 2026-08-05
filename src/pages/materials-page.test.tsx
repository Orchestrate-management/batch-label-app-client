import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { Materials } from './Materials';
import { Material, MaterialClass } from '../lib/model';
import { MaterialsStatus } from '../lib/materials-store';

/**
 * WHAT THE MATERIALS SCREEN IS ALLOWED TO SAY IN EACH OF ITS STATES.
 *
 * The screen has four answers and they are not interchangeable — a failed read, a suspended
 * account, an unfinished signup, and a genuinely empty register. The last is what every real
 * customer sees on their first visit, and it is the one the other three must never be
 * mistaken for. "You have no materials" to somebody holding forty of them is a support
 * ticket and quite possibly a cancellation, over a dropped request.
 *
 * And the control that saves has to save. This screen's predecessor toasted "Saving a
 * material is not built yet" from a primary button styled exactly like one that worked.
 */

const created = vi.hoisted(() => ({ calls: [] as unknown[], result: { ok: true, value: 'mat-new' } }));
const store = vi.hoisted(() => ({
  status: 'ready' as MaterialsStatus,
  materials: [] as Material[],
  error: null as string | null,
  reloads: 0
}));

vi.mock('../lib/materials-store', () => ({
  useMaterials: () => ({
    status: store.status,
    materials: store.materials,
    error: store.error,
    accountId: 'acct-1',
    refresh: () => {},
    reload: async () => {
      store.reloads += 1;
    }
  })
}));

vi.mock('../lib/materials', async () => {
  const actual = await vi.importActual<typeof import('../lib/materials')>('../lib/materials');
  return {
    ...actual,
    createMaterial: async (input: unknown, accountId: unknown) => {
      created.calls.push({ input, accountId });
      return created.result;
    },
    addHazard: async () => ({ ok: true, value: undefined }),
    addAllergen: async () => ({ ok: true, value: undefined }),
    addIfraLimit: async () => ({ ok: true, value: undefined }),
    addDocument: async () => ({ ok: true, value: undefined }),
    archiveMaterial: async () => ({ ok: true, value: undefined }),
    overrideReferenceMaterial: async () => ({ ok: true, value: 'mat-own' }),
    removeChildRow: async () => ({ ok: true, value: undefined })
  };
});

function ownMaterial(overrides: Partial<Material> = {}): Material {
  return {
    id: 'mat-1',
    source: 'account',
    class: 'ingredient',
    role: 'Fragrance oil',
    name: 'Black Fig and Cassis',
    supplier: 'Aurelia Fragrances',
    categories: ['home-fragrance'],
    editable: true,
    hazards: [],
    allergens: [],
    ifra: [],
    ...overrides
  } as Material;
}

function draw(
state: Partial<typeof store> = {},
path = '/materials/ingredient')
{
  store.status = state.status ?? 'ready';
  store.materials = state.materials ?? [];
  store.error = state.error ?? null;
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/materials/:materialClass" element={<Materials />} />
        <Route path="/materials/:materialClass/:materialId" element={<Materials />} />
      </Routes>
    </MemoryRouter>
  );
}

describe('an empty register', () => {
  it('says it is empty, and does not read as a failure', async () => {
    draw({ status: 'ready', materials: [] });
    expect(await screen.findByText(/No ingredients yet/i)).toBeInTheDocument();
    // The distinction that costs the most when it is lost.
    expect(screen.queryByText(/could not read/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/try again/i)).not.toBeInTheDocument();
  });

  it('says the empty catalogue is deliberate rather than missing', async () => {
    draw({ status: 'ready', materials: [] });
    expect(await screen.findByText(/Batchlabel does not publish any/i)).toBeInTheDocument();
  });

  it('still offers the control that fills it', async () => {
    draw({ status: 'ready', materials: [] });
    expect(await screen.findAllByRole('button', { name: /Add a material/i })).not.toHaveLength(0);
  });
});

describe('a read that failed', () => {
  it('says so, blames us, and offers a retry', async () => {
    draw({ status: 'error', error: 'We could not read your materials just now.' });
    expect(await screen.findAllByText(/could not read your materials/i)).not.toHaveLength(0);
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
    // And it must not simultaneously claim the register is empty.
    expect(screen.queryByText(/No ingredients yet/i)).not.toBeInTheDocument();
  });

  it('does not offer a control that creates something it cannot place', () => {
    draw({ status: 'error', error: 'x' });
    expect(screen.queryByRole('button', { name: /Add a material/i })).not.toBeInTheDocument();
  });
});

describe('a register still loading', () => {
  it('claims neither an empty register nor a failure', () => {
    draw({ status: 'loading' });
    expect(screen.queryByText(/No ingredients yet/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/could not read/i)).not.toBeInTheDocument();
  });
});

describe('a suspended account', () => {
  it('says the materials are withheld, not that there are none', async () => {
    draw({ status: 'unavailable' });
    expect(await screen.findByText(/not being shown/i)).toBeInTheDocument();
    expect(screen.getByText(/Nothing has been deleted/i)).toBeInTheDocument();
    expect(screen.queryByText(/No ingredients yet/i)).not.toBeInTheDocument();
  });
});

describe('the override rule', () => {
  it('is stated on the screen, not only enforced in the database', async () => {
    draw({ status: 'ready', materials: [] });
    expect(await screen.findByText(/Your material always wins/i)).toBeInTheDocument();
    // Rhys's second question — what happens when we update a shared row — answered in place.
    expect(screen.getByText(/can never be changed or removed/i)).toBeInTheDocument();
  });
});

describe('a listed material', () => {
  it('says whose figures they are', async () => {
    draw({ status: 'ready', materials: [ownMaterial()] });
    expect(await screen.findByText('Yours')).toBeInTheDocument();
  });

  it('says a material with no hazard rows has none ENTERED, not that it is unclassified', async () => {
    // "Not classified" is a finding about the substance. An empty child table is a gap in
    // what the maker has typed, and only they know which it is.
    draw({ status: 'ready', materials: [ownMaterial()] });
    // Twice on the row: no hazards entered, and no allergens entered.
    expect(await screen.findAllByText('None entered')).toHaveLength(2);
    expect(screen.queryByText(/not classified/i)).not.toBeInTheDocument();
  });

  it('says no document is recorded rather than printing an empty citation', async () => {
    draw({ status: 'ready', materials: [ownMaterial()] });
    expect(await screen.findByText(/No document recorded/i)).toBeInTheDocument();
  });
});

describe('a reference material published as an illustrative example', () => {
  const example = ownMaterial({
    id: 'ing-example',
    source: 'reference',
    provenance: 'illustrative-example',
    referenceMaterialId: 'ref-1',
    editable: false
  });

  it('is labelled as an example in the list', async () => {
    draw({ status: 'ready', materials: [example] });
    expect(await screen.findByText(/Batchlabel example/i)).toBeInTheDocument();
  });

  it('warns, on its own screen, that it must not be classified from', async () => {
    draw({ status: 'ready', materials: [example] }, '/materials/ingredient/ing-example');
    expect(
      await screen.findByText(/an example, not a classification/i)
    ).toBeInTheDocument();
  });

  it('offers no archive control, because it is not the account\'s to archive', async () => {
    draw({ status: 'ready', materials: [example] }, '/materials/ingredient/ing-example');
    await screen.findByText(/an example, not a classification/i);
    expect(screen.queryByRole('button', { name: /^Archive$/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Hold my own version/i })).toBeInTheDocument();
  });
});

describe('saving a material', () => {
  it('persists it, rather than toasting that saving is not built', async () => {
    // The control this screen shipped with was a primary "Save material" button that wrote
    // nothing and said so only after it had been pressed.
    created.calls = [];
    draw({ status: 'ready', materials: [] });
    const user = userEvent.setup();

    await user.click((await screen.findAllByRole('button', { name: /Add a material/i }))[0]);
    await user.type(screen.getByLabelText(/^Name$/i), 'My own wax');
    await user.click(screen.getByRole('button', { name: /^Save material$/i }));

    await waitFor(() => expect(created.calls).toHaveLength(1));
    const call = created.calls[0] as {input: {name: string;materialClass: MaterialClass;};accountId: string;};
    expect(call.input.name).toBe('My own wax');
    expect(call.input.materialClass).toBe('ingredient');
    // The account id is the entitlement's, sent explicitly. Never taken from the form.
    expect(call.accountId).toBe('acct-1');
  });

  it('refuses to submit without a name, because the database would refuse it', async () => {
    created.calls = [];
    draw({ status: 'ready', materials: [] });
    const user = userEvent.setup();
    await user.click((await screen.findAllByRole('button', { name: /Add a material/i }))[0]);
    expect(screen.getByRole('button', { name: /^Save material$/i })).toBeDisabled();
  });

  it('reports a refusal on the form instead of navigating as though it saved', async () => {
    created.calls = [];
    created.result = { ok: false, reason: 'duplicate', message: 'You already have a material with that code.' } as never;
    draw({ status: 'ready', materials: [] });
    const user = userEvent.setup();

    await user.click((await screen.findAllByRole('button', { name: /Add a material/i }))[0]);
    await user.type(screen.getByLabelText(/^Name$/i), 'My own wax');
    await user.click(screen.getByRole('button', { name: /^Save material$/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/already have a material/i);
    // Still on the form: a failed save must not look like a completed one.
    expect(screen.getByRole('button', { name: /^Save material$/i })).toBeInTheDocument();
    created.result = { ok: true, value: 'mat-new' };
  });
});

describe('a material id that is not in the register', () => {
  it('says so instead of rendering an empty detail screen', async () => {
    draw({ status: 'ready', materials: [] }, '/materials/ingredient/mat-gone');
    expect(await screen.findByText(/not in your register/i)).toBeInTheDocument();
    // And explains what archiving actually did, rather than implying data loss.
    expect(screen.getByText(/keeps every product that used a material working/i)).toBeInTheDocument();
  });

  it('does not say that while the register is still loading', () => {
    draw({ status: 'loading' }, '/materials/ingredient/mat-gone');
    expect(screen.queryByText(/not in your register/i)).not.toBeInTheDocument();
  });
});
