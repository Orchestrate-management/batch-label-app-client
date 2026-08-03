import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Vitest picks this file up in preference to vite.config.ts. Production builds
// still use vite.config.ts, so test-only settings never leak into the bundle.
export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    // Serve the document from an https origin under batchlabel.xyz. Both matter:
    // the storage adapter only adds `Secure` on https and only sets
    // `domain=.batchlabel.xyz` when it is actually on that domain, so a test run
    // from about:blank would exercise a different code path than production.
    environmentOptions: {
      jsdom: { url: 'https://app.batchlabel.xyz/' },
    },
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    css: false,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary', 'html', 'lcov'],
      reportsDirectory: './coverage',
      // Measured against the units that actually have tests, so the number is a
      // real signal rather than being diluted by the (as yet untested) view
      // layer inherited from the Magic Patterns scaffold.
      include: [
        'src/lib/session-storage.ts',
        'src/lib/auth-redirect.ts',
        'src/lib/membership.ts',
        'src/lib/marketing.ts',
        // The billing rail. Prices, the entitlement read and the two calls that move money
        // are the units where being wrong costs a customer real money, so they are held to
        // the same bar as the session adapter rather than left with the view layer.
        'src/lib/plans.ts',
        'src/lib/billing.ts',
        'src/lib/activation.ts',
      ],
      thresholds: {
        lines: 70,
        functions: 70,
        statements: 70,
        branches: 70,
      },
    },
  },
});
