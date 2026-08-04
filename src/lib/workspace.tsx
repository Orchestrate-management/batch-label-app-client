import React, { createContext, useContext, useEffect, useState } from 'react';
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
 * The surface hue is not stored and is not a setting. It is decided by the product currently
 * on screen and lasts as long as that screen is mounted.
 */

type WorkspaceValue = {
  enabledCategories: CategoryId[];
  toggleCategory: (id: CategoryId) => void;
  /** Surface hue set, driven only by the product currently in view. */
  surface: 'warm' | 'neutral';
  setSurfaceOverride: (id: CategoryId | null) => void;
};

const WorkspaceContext = createContext<WorkspaceValue | null>(null);

export function WorkspaceProvider({ children }: {children: React.ReactNode;}) {
  const settings = useOptionalSettings();
  const [sessionCategories, setSessionCategories] = useState<CategoryId[]>(
    DEFAULT_PREFERENCES.enabledCategories
  );
  const [surfaceOverride, setSurfaceOverride] = useState<CategoryId | null>(null);

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
   * Toggling switches the box and asks the database to agree.
   *
   * The last category may not be switched off — `cardinality(enabled_categories) > 0` is a
   * CHECK, so the write would be refused anyway, and refusing here means the box does not
   * flicker on and off while the round trip proves what we already knew.
   *
   * The write is fire-and-forget from here BECAUSE THE ROW IS THE TRUTH and the screen redraws
   * from it: `savePreferences` replaces the held preferences with the row the database
   * returned, so a refused save leaves the checkbox where it was rather than where the click
   * put it. The Preferences screen wraps this with its own saving and error state; this
   * provider deliberately has none, because a checkbox in the create dialog's filter list is
   * not the place to report a database failure.
   */
  const toggleCategory = (id: CategoryId) => {
    const wanted = new Set<CategoryId>(enabledCategories);
    if (wanted.has(id)) wanted.delete(id);else wanted.add(id);

    // Written back in CATEGORIES order rather than click order, so the stored array is stable
    // and two accounts that switched the same things on hold the same row.
    const next = CATEGORIES.map((category) => category.id).filter((category) =>
    wanted.has(category)
    );

    if (next.length === 0) return;

    if (!persisting) {
      setSessionCategories(next);
      return;
    }
    void settings.savePreferences({
      enabledCategories: next,
      defaultMarket: settings.preferences?.defaultMarket ?? null,
      defaultExport: settings.preferences?.defaultExport ?? null
    });
  };

  const value: WorkspaceValue = {
    enabledCategories,
    toggleCategory,
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
