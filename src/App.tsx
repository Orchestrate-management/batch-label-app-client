import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Toaster } from 'sonner';
import { AppShell } from './components/AppShell';
import { AuthProvider, RequireAuth } from './lib/auth';
import { EntitlementProvider } from './lib/entitlement';
import { WorkspaceProvider } from './lib/workspace';
import { Studio } from './pages/Studio';
import { Materials } from './pages/Materials';
import { Products } from './pages/Products';
import { Specification } from './pages/Specification';
import { ArtefactDesigner } from './pages/ArtefactDesigner';
import { Records } from './pages/Records';
import { Settings } from './pages/Settings';

/**
 * Nothing in this app is public.
 *
 * RequireAuth wraps everything, including the shell, so there is no route — not
 * even a 404 — that renders product data without a session. The entitlement read
 * sits inside it because it is a query for a specific signed-in user and there is
 * nothing to ask before we have one.
 */
export function App() {
  return (
    <AuthProvider>
      <RequireAuth>
        <EntitlementProvider>
          <AppRoutes />
        </EntitlementProvider>
      </RequireAuth>
    </AuthProvider>);

}

function AppRoutes() {
  return (
    <WorkspaceProvider>
      <BrowserRouter>
        <AppShell>
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
            <Route path="/settings" element={<Navigate to="/settings/identity" replace />} />
            <Route path="/settings/:tab" element={<Settings />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
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