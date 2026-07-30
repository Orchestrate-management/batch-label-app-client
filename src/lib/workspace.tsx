import React, { createContext, useContext, useEffect, useState, useSyncExternalStore } from 'react';
import { CategoryId, Product } from './model';
import { CATEGORIES, allProducts, categoryById, subscribeProducts } from './products';

/** The live product list, including anything created in this session. */
export function useProducts(): Product[] {
  return useSyncExternalStore(subscribeProducts, allProducts, allProducts);
}

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