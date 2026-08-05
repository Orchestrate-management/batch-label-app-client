import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { CategoryId } from './model';
import { CATEGORIES, categoryById } from './categories';
import { enabledCategoriesOf, useOptionalSettings, DEFAULT_PREFERENCES } from './settings-store';

/**
 * `useProducts` has moved to lib/product-store.tsx.
 *
 * It used to live here, over a module-level array that could be read synchronously and never
 * failed. Products come from Supabase now, so the list has a loading state and an error state
 * and both have to be rendered distinctly — which is a provider, not a re-export. What is
 * left here is what was always workspace state: which categories are switched on, and which
 * surface hue the screen in view is using.
 *
 * THE CATEGORIES ARE STORED NOW. `batchlabel.workspace_preferences.enabled_categories` holds
 * them, `SettingsProvider` reads and writes it, and this provider defers to it whenever there
 * is one above. Without a SettingsProvider — which is how several test harnesses mount this —
 * the toggles stay session state, exactly as they were. That fallback is deliberately silent
 * HERE and deliberately loud on the Preferences screen: nothing in this file claims a save,
 * and the screen that does claim one requires the provider before it says anything.
 *
 * AND THE WRITE IS NOT FIRE-AND-FORGET ANY MORE. This file used to say, in the comment over
 * `toggleCategory`, that "the Preferences screen wraps this with its own saving and error
 * state". It did not, and it could not have: the function returned `void` and dropped the
 * promise, so a refused save reached nobody. Unticking a category against a database that
 * said no produced NOTHING — the box did not move, no alert appeared, no sentence anywhere
 * said the save had failed — and the maker's reasonable next move was to click again, which
 * fired another failed write. `toggleCategory` now returns what happened and this provider
 * holds it as `categoryWrite`, so any screen drawing these boxes can say it without inventing
 * a mechanism of its own.
 *
 * The surface hue is not stored and is not a setting. It is decided by the product currently
 * on screen and lasts as long as that screen is mounted.
 */

/**
 * What a toggle DID. Never `void`, and that is the fix rather than a detail of it.
 *
 * `toggleCategory` used to return nothing and drop the promise. A save refused by the database
 * therefore reached no caller and no screen: the box stayed where it was, no alert appeared, no
 * sentence anywhere matched "could not save", and the click produced nothing at all — so the
 * maker concluded the control was broken and clicked again, firing another failed write each
 * time. The signature is what allowed that. A caller cannot now drop a refusal without deleting
 * a value it was handed.
 */
export type CategoryToggle =
/** The database accepted it and the row it returned is what is drawn. */
{state: 'saved';} |
/** No store above, or none read yet: held for this visit, and NOTHING WAS SENT. */
{state: 'session-only';} |
/** The last one may not be switched off. Nothing was sent and nothing is wrong. */
{state: 'declined';message: string;} |
/** The database was asked and said no, or was never reached. Nothing changed. */
{state: 'refused';message: string;};

/**
 * The same answer, held for whichever screen is drawing the boxes.
 *
 * It lives on the provider and not on the Preferences screen because the provider is the only
 * thing that knows a write was attempted at all, and because the next screen to draw a category
 * toggle then gets the pending and refused states without re-implementing them. The comment
 * that used to sit over `toggleCategory` asserted that the Preferences screen "wraps this with
 * its own saving and error state". It did not, and there was nothing it could have wrapped.
 */
export type CategoryWrite =
{state: 'idle';} |
{state: 'saving';id: CategoryId;} |
{state: 'declined';message: string;} |
{state: 'refused';message: string;};

type WorkspaceValue = {
  enabledCategories: CategoryId[];
  toggleCategory: (id: CategoryId) => Promise<CategoryToggle>;
  /** What the last toggle did, for the screen drawing these boxes to say out loud. */
  categoryWrite: CategoryWrite;
  /** Surface hue set, driven only by the product currently in view. */
  surface: 'warm' | 'neutral';
  setSurfaceOverride: (id: CategoryId | null) => void;
};

/**
 * Said when the write never came back at all — a dropped request, a rejected promise.
 *
 * Distinct from a refusal on purpose: a refusal is the database answering, and this is nobody
 * answering. Both leave the stored row untouched, which is the only thing the sentence has to
 * be right about.
 */
const NOT_DELIVERED =
'That did not reach us, so your categories have not been saved. Check your connection and try ' +
'again — nothing has changed.';

/**
 * Said when the last ticked box is clicked.
 *
 * `cardinality(enabled_categories) > 0` is a CHECK, so this write would be refused; refusing
 * here means the box does not flicker on and off while a round trip proves what we already
 * knew. It is NOT an error — nothing failed and nothing was sent — which is why it is its own
 * state rather than a refusal with a friendlier sentence.
 */
const LAST_CATEGORY =
'Leave at least one category switched on — you would have nothing to create a product from.';

const WorkspaceContext = createContext<WorkspaceValue | null>(null);

export function WorkspaceProvider({ children }: {children: React.ReactNode;}) {
  const settings = useOptionalSettings();
  const [sessionCategories, setSessionCategories] = useState<CategoryId[]>(
    DEFAULT_PREFERENCES.enabledCategories
  );
  const [surfaceOverride, setSurfaceOverride] = useState<CategoryId | null>(null);
  const [write, setWrite] = useState<CategoryWrite>({ state: 'idle' });
  /** Sequence number of the most recent toggle, so a slow earlier one cannot describe it. */
  const latest = useRef(0);

  const surface: 'warm' | 'neutral' = surfaceOverride ?
  categoryById(surfaceOverride).surface :
  'warm';

  useEffect(() => {
    document.documentElement.setAttribute('data-surface', surface);
  }, [surface]);

  /**
   * A stored row only wins once it has actually been READ.
   *
   * `settings.status === 'ready'` and not merely `settings !== null`: mid-read the store holds
   * no preferences and `enabledCategoriesOf` would answer with the defaults, which look exactly
   * like a stored row saying "all three". The screen would then be drawing a setting nobody has
   * established, and a toggle made in that window would be sent to a save that cannot land.
   * Until the read finishes this is session state, and the Preferences screen says so.
   */
  const persisting = settings !== null && settings.status === 'ready';
  const enabledCategories = persisting ? enabledCategoriesOf(settings) : sessionCategories;

  /**
   * Toggling switches the box and asks the database to agree — AND WAITS FOR THE ANSWER.
   *
   * THE CHECKBOX STILL DOES NOT MOVE UNTIL THE ROW DOES, because the row is the truth:
   * `savePreferences` replaces the held preferences with the row the database returned, so a
   * refused save leaves the box where it was rather than where the click put it. That part was
   * right and is unchanged. What was wrong is that a refusal then went nowhere at all, so
   * "refused" and "nothing happened" looked identical from the maker's chair — and the fix for
   * that is not a sentence on one screen, it is this function having an answer to give.
   *
   * A REJECTED PROMISE IS CAUGHT rather than left to the window. `savePreferences` resolves
   * with `{ error }` today, but it is one `await` over a network call away from throwing, and
   * a `void`-ed rejection is a silent no-op wearing an unhandled-rejection warning nobody sees.
   *
   * ONLY THE LATEST CLICK MAY SET THE STATE. Two quick clicks are two writes in flight, and
   * the first one to come back is not necessarily the one that describes what is on screen.
   */
  const toggleCategory = async (id: CategoryId): Promise<CategoryToggle> => {
    const wanted = new Set<CategoryId>(enabledCategories);
    if (wanted.has(id)) wanted.delete(id);else wanted.add(id);

    // Written back in CATEGORIES order rather than click order, so the stored array is stable
    // and two accounts that switched the same things on hold the same row.
    const next = CATEGORIES.map((category) => category.id).filter((category) =>
    wanted.has(category)
    );

    if (next.length === 0) {
      setWrite({ state: 'declined', message: LAST_CATEGORY });
      return { state: 'declined', message: LAST_CATEGORY };
    }

    if (!persisting) {
      setSessionCategories(next);
      setWrite({ state: 'idle' });
      return { state: 'session-only' };
    }

    const ticket = (latest.current += 1);
    setWrite({ state: 'saving', id });

    let outcome: CategoryToggle;
    try {
      const result = await settings.savePreferences({
        enabledCategories: next,
        defaultMarket: settings.preferences?.defaultMarket ?? null,
        defaultExport: settings.preferences?.defaultExport ?? null
      });
      outcome = result.error ?
      { state: 'refused', message: result.error } :
      { state: 'saved' };
    } catch {
      outcome = { state: 'refused', message: NOT_DELIVERED };
    }

    if (latest.current === ticket) {
      setWrite(
        outcome.state === 'refused' ?
        { state: 'refused', message: outcome.message } :
        { state: 'idle' }
      );
    }
    return outcome;
  };

  const value: WorkspaceValue = {
    enabledCategories,
    toggleCategory,
    categoryWrite: write,
    surface,
    setSurfaceOverride
  };

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace(): WorkspaceValue {
  const value = useContext(WorkspaceContext);
  if (!value) throw new Error('useWorkspace must be used inside WorkspaceProvider');
  return value;
}

/** Applies the surface set of the category in view for as long as the screen is mounted. */
export function useCategorySurface(categoryId: CategoryId | undefined) {
  const { setSurfaceOverride } = useWorkspace();
  useEffect(() => {
    if (!categoryId) return;
    setSurfaceOverride(categoryId);
    return () => setSurfaceOverride(null);
  }, [categoryId, setSurfaceOverride]);
}
