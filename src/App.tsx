import { Suspense } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Toaster } from 'sonner';
import { AppShell } from './components/AppShell';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ScreenLoading } from './components/ScreenLoading';
import { AuthProvider, RequireAuth } from './lib/auth';
import { EntitlementProvider } from './lib/entitlement';
import { lazyScreen } from './lib/lazy-screen';
import { MetaTrackingProvider } from './lib/meta-consent';
import { ProductsProvider } from './lib/product-store';
import { WorkspaceProvider } from './lib/workspace';
import { Studio } from './pages/Studio';

/**
 * ROUTE `/` IS THE ONLY SCREEN LOADED UP FRONT, AND THAT IS NOT AN OVERSIGHT.
 *
 * Studio is where a signed-in maker lands. Splitting it out would mean the browser downloads
 * the app, boots React, resolves the session and only then discovers it needs a second file
 * before it can draw anything — an extra round trip added to the one moment where the customer
 * is staring at an empty screen with nothing else to look at. That is a regression dressed up
 * as an optimisation, and it is why this import is a plain one while everything below it is
 * not.
 *
 * Everything else is fetched when it is first asked for. These screens are large — Materials
 * and Specification are a thousand lines each, and the artefact designer drags the renderer,
 * the SDS document and the symbol set behind it — and most sessions never open most of them.
 *
 * The named-export unwrap in each loader is here rather than in the pages: `React.lazy` wants
 * a module with a default export and these screens export named components, so the alternative
 * was adding default exports to eight files to satisfy a loader. `lazyScreen` also names each
 * screen, so a fetch that fails says which one — see lib/lazy-screen.ts.
 */
const Materials = lazyScreen('Materials', () =>
import('./pages/Materials').then((module) => ({ default: module.Materials }))
);
const Products = lazyScreen('Products', () =>
import('./pages/Products').then((module) => ({ default: module.Products }))
);
const Specification = lazyScreen('specification', () =>
import('./pages/Specification').then((module) => ({ default: module.Specification }))
);
const ArtefactDesigner = lazyScreen('artefact', () =>
import('./pages/ArtefactDesigner').then((module) => ({ default: module.ArtefactDesigner }))
);
const Records = lazyScreen('Records', () =>
import('./pages/Records').then((module) => ({ default: module.Records }))
);
const Settings = lazyScreen('Settings', () =>
import('./pages/Settings').then((module) => ({ default: module.Settings }))
);
const Billing = lazyScreen('Billing', () =>
import('./pages/Billing').then((module) => ({ default: module.Billing }))
);
const BillingReturn = lazyScreen('Billing', () =>
import('./pages/BillingReturn').then((module) => ({ default: module.BillingReturn }))
);

/**
 * Nothing in this app is public.
 *
 * RequireAuth wraps everything, including the shell, so there is no route — not
 * even a 404 — that renders product data without a session. The entitlement read
 * sits inside it because it is a query for a specific signed-in user and there is
 * nothing to ask before we have one.
 *
 * MetaTrackingProvider sits in the same place and for the same reason: it reads
 * one account-level consent flag for a specific signed-in maker, and there is
 * nobody to read it for until there is a session. It renders nothing and gates
 * everything Meta-related — see lib/meta-consent.tsx.
 *
 * ProductsProvider is inside all of it, and inside the entitlement, because it
 * reads one account's products — row level security answers it from the session
 * and from nothing this app sends, so there is nothing to ask before there is a
 * session either. It is above the router so that the list survives navigation:
 * every screen shares one read, and a maker moving between Studio and a product
 * does not re-query on each hop.
 *
 * ErrorBoundary is OUTSIDE all of it — not around the routes, around the whole thing,
 * providers and shell and toaster included. A render error anywhere used to leave a blank
 * white document; from here there is no arrangement of failures that can do that again. The
 * reasoning, and the case for a second boundary further in, is in components/ErrorBoundary.tsx
 * and docs/PRODUCTION_TODO.md.
 */
export function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <RequireAuth>
          <MetaTrackingProvider>
            <EntitlementProvider>
              <ProductsProvider>
                <AppRoutes />
              </ProductsProvider>
            </EntitlementProvider>
          </MetaTrackingProvider>
        </RequireAuth>
      </AuthProvider>
    </ErrorBoundary>);

}

function AppRoutes() {
  return (
    <WorkspaceProvider>
      <BrowserRouter>
        <AppShell>
          {/*
            The Suspense boundary is INSIDE AppShell, so the navigation stays put while a
            screen's code is fetched. Above the shell it would blank the sidebar on every
            first visit to a screen, and the app would feel like it reloads on every click.
           */}
          <Suspense fallback={<ScreenLoading />}>
            <Routes>
              <Route path="/" element={<Studio />} />
              <Route path="/materials" element={<Navigate to="/materials/ingredient" replace />} />
              <Route path="/materials/:materialClass" element={<Materials />} />
              <Route path="/materials/:materialClass/:materialId" element={<Materials />} />
              <Route path="/products" element={<Products />} />
              <Route path="/products/:productId" element={<Specification />} />
              <Route path="/outputs" element={<Navigate to="/products" replace />} />
              <Route path="/artefacts" element={<Navigate to="/products" replace />} />
              <Route
                path="/products/:productId/artefacts/:artefactType"
                element={<ArtefactDesigner />} />

              <Route path="/records" element={<Records />} />
              <Route path="/records/:recordCode" element={<Records />} />
              <Route path="/compliance" element={<Navigate to="/" replace />} />
              {/* Both paths are load-bearing rather than chosen: the marketing repo's checkout
                  endpoint defaults its success and cancel URLs to `${APP_URL}/billing/success`
                  and `${APP_URL}/billing`, and the portal returns to `/billing`. Renaming
                  either of these strands a customer on a 404 immediately after paying. */}
              <Route path="/billing" element={<Billing />} />
              <Route path="/billing/success" element={<BillingReturn />} />
              {/* Billing used to be a Settings tab. Old bookmarks and links land here. */}
              <Route path="/settings/billing" element={<Navigate to="/billing" replace />} />
              <Route path="/settings" element={<Navigate to="/settings/identity" replace />} />
              <Route path="/settings/:tab" element={<Settings />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Suspense>
        </AppShell>
        <Toaster
          position="bottom-right"
          toastOptions={{
            style: {
              background: 'rgb(var(--paper))',
              border: '1px solid rgb(var(--paper-line))',
              borderRadius: '0.875rem',
              color: 'rgb(var(--ink))',
              fontFamily: '"IBM Plex Sans", sans-serif'
            }
          }} />

      </BrowserRouter>
    </WorkspaceProvider>);

}
