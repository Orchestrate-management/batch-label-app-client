import React, { createContext, useContext, useEffect, useState } from 'react';
import { CategoryId } from './model';
import { CATEGORIES, categoryById } from './categories';

/**
 * `useProducts` has moved to lib/product-store.tsx.
 *
 * It used to live here, over a module-level array that could be read synchronously and never
 * failed. Products come from Supabase now, so the list has a loading state and an error state
 * and both have to be rendered distinctly — which is a provider, not a re-export. What is
 * left here is what was always workspace state: which categories are switched on, and which
 * surface hue the screen in view is using. Neither is stored anywhere yet.
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
  const [enabledCategories, setEnabledCategories] = useState<CategoryId[]>(
    CATEGORIES.map((category) => category.id)
  );
  const [surfaceOverride, setSurfaceOverride] = useState<CategoryId | null>(null);

  const surface: 'warm' | 'neutral' = surfaceOverride ?
  categoryById(surfaceOverride).surface :
  'warm';

  useEffect(() => {
    document.documentElement.setAttribute('data-surface', surface);
  }, [surface]);

  const value: WorkspaceValue = {
    enabledCategories,
    toggleCategory: (id) =>
    setEnabledCategories((prev) =>
    prev.includes(id) ? prev.filter((category) => category !== id) : [...prev, id]
    ),
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