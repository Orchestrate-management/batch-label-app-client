import { Suspense } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Toaster } from 'sonner';
import { AccountGate } from './components/AccountChooser';
import { AppShell } from './components/AppShell';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ScreenLoading } from './components/ScreenLoading';
import { ActiveAccountProvider } from './lib/active-account';
import { AuthProvider, RequireAuth } from './lib/auth';
import { EntitlementProvider } from './lib/entitlement';
import { lazyScreen } from './lib/lazy-screen';
import { MetaTrackingProvider } from './lib/meta-consent';
import { MaterialsProvider } from './lib/materials-store';
import { ProductsProvider } from './lib/product-store';
import { SettingsProvider } from './lib/settings-store';
import { BillingReturn } from './pages/BillingReturn';
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
const AcceptInvite = lazyScreen('invitation', () =>
import('./pages/AcceptInvite').then((module) => ({ default: module.AcceptInvite }))
);
/*
 * NOT lazy, deliberately, and it is the only screen singled out.
 *
 * This is where Stripe returns a customer the instant after they have been charged. Putting
 * it behind a second network fetch means a dropped connection — or a deploy that happened
 * while they were away in Checkout, which is precisely when a tab has been sitting open —
 * shows a crash screen to somebody who has just paid and does not yet know whether their
 * plan is on. No other screen in the app has that property.
 *
 * It costs a few kB on the entry chunk. That is the cheapest insurance in the codebase.
 */

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
 * white document; from here there is no arrangement of failures that can do that again.
 *
 * There is a SECOND boundary further in, around the routed screens only (see RoutedScreens
 * below), and this outer one is not weakened by it: everything the inner one cannot reach —
 * the providers, the shell, the toaster — still lands here. The two say different things
 * because they know different things, which is argued in components/ErrorBoundary.tsx.
 */
export function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <RequireAuth>
          <MetaTrackingProvider>
            {/* WHICH ACCOUNT, BEFORE ANYTHING THAT DEPENDS ON ONE.

                It sits above the entitlement because the entitlement is now an answer ABOUT an
                account rather than about a person: `public.account_entitlement(id)` is keyed on
                the account, which is the only way an invited member gets an allowance at all.
                It sits above the router because a screen must never render before the account
                its data would be scoped to is settled.

                AccountGate is the one thing between the provider and the rest of the app, and
                it intervenes in exactly one state: more than one account with none chosen. Every
                other state falls through, including having no account at all, because the
                screens already say that better than a gate could. */}
            <ActiveAccountProvider>
              <AccountGate>
            <EntitlementProvider>
              {/* THREE ACCOUNT-SCOPED READS, ALL INSIDE THE ENTITLEMENT AND ALL OUTSIDE THE
                  ROUTER, and the nesting order between them carries no meaning: nothing in one
                  read depends on another, so they fire in parallel.

                  Inside the entitlement, because the account to scope each read to is the one
                  the entitlement resolved for this brand.

                  Outside the router, because none of the three is a screen's data.
                  SettingsProvider holds the printed supplier block, which every label preview
                  and every safety data sheet section 1 renders from any route, and which has
                  to be loaded whether or not anybody opened Settings. MaterialsProvider holds
                  the register that the specification pickers, the classification and the
                  pipeline all read. ProductsProvider holds the list, so a maker moving between
                  Studio and a product does not re-query on each hop. */}
              <SettingsProvider>
                <MaterialsProvider>
                  <ProductsProvider>
                    <AppRoutes />
                  </ProductsProvider>
                </MaterialsProvider>
              </SettingsProvider>
            </EntitlementProvider>
              </AccountGate>
            </ActiveAccountProvider>
          </MetaTrackingProvider>
        </RequireAuth>
      </AuthProvider>
    </ErrorBoundary>);

}

function AppRoutes() {
  return (
    <BrowserRouter>
      <AppShell>
        <RoutedScreens />
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

  </BrowserRouter>);

}

/**
 * The routed content, and the boundary that keeps a screen's crash inside it.
 *
 * This mount is what stops one screen throwing from taking the sidebar with it. It is inside
 * AppShell — so the navigation is drawn by a component the boundary cannot unmount — and
 * inside BrowserRouter, so it can read the pathname.
 *
 * `resetKey={pathname}` is the other half. Without it the maker keeps a navigation that
 * navigates nowhere: the URL would change, the link would go blue, and the crash fallback
 * would sit there for the rest of the session. With it, pressing a link renders the screen
 * that link points at — see componentDidUpdate in components/ErrorBoundary.tsx for why it is
 * a prop rather than a `key`.
 *
 * The Suspense boundary is inside the shell for the same reason it always was: above it, the
 * sidebar would blank on every first visit to a screen and the app would feel like it reloads
 * on every click. It is inside the error boundary rather than outside so that a chunk that
 * never arrives — the mid-deploy case in lib/lazy-screen.ts — is a message in the content
 * area rather than a crash screen where the whole app used to be.
 */
function RoutedScreens() {
  const { pathname } = useLocation();
  return (
    <ErrorBoundary scope="screen" resetKey={pathname}>
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

          {/* An invitation link. The token is in the path rather than in a query string so it
              stays out of a Referer header when the page loads a third-party resource, and it
              is exchanged for a membership by an RPC that reads the caller's own verified email
              before it accepts anything. */}
          <Route path="/invite/:token" element={<AcceptInvite />} />
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
    </ErrorBoundary>);

}
