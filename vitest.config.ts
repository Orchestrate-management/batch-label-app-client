import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// The Meta environment the test suite runs under, fixed before Vite resolves.
//
// This has to happen here, in the config module, and not in a test. Vite builds
// `import.meta.env` once and inlines it per module, so `vi.stubEnv` (which only
// reaches `process.env`) and `test.env` (applied after resolution) both leave
// the module under test with an empty Pixel id — and an empty id makes every
// "nothing was sent" assertion in meta-pixel.test.ts pass for the wrong reason.
// Green because the feature was switched off is the worst failure a consent
// test can have.
//
// Assigned outright rather than defaulted, because Vite gives `process.env` the
// last word over `.env` files: a developer with VITE_META_PIXEL_DEBUG=true in
// their .env.local (which is how you check events in Meta's Test Events tool)
// would otherwise run a suite with the localhost guard disabled, and watch it
// fail for a reason that has nothing to do with their change. The suite must
// answer the same way on every machine.
//
// The unconfigured case is not lost: `pixelCanLoad()` takes the id and the
// debug flag as arguments precisely so both can be tested without an
// environment at all.
process.env.VITE_META_PIXEL_ID = '1374342861305621';
process.env.VITE_META_PIXEL_DEBUG = '';

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
        'src/lib/meta-pixel.ts',
        'src/lib/meta-consent.tsx',
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
