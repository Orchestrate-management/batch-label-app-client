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
      //
      // THE CURATION IS THE POINT AND ALSO THE RISK. A hand-written list keeps
      // the percentage honest, and it silently excuses whatever is not on it —
      // so a file added to the app is a file added to this list, or the number
      // goes UP as the untested surface grows. That is what happened to the two
      // entries at the bottom: lib/products.ts and lib/product-store.tsx landed
      // with the cutover from the in-memory fixture store to Supabase, which is
      // the account isolation, the SKU meter's client half and every write a
      // maker makes, and coverage read 93% throughout without once looking at
      // them.
      //
      // The rule for what belongs here: anything where being wrong costs a
      // customer money, data, or a true sentence about their compliance. Not
      // "anything with a test".
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
        'src/lib/account.ts',
        'src/lib/agreements.ts',
        'src/lib/consent-preferences.ts',
        'src/lib/meta-pixel.ts',
        'src/lib/meta-consent.tsx',
        // The data layer. Two files decide, between them, which account's rows
        // a screen reads, whether a write landed, and what a maker is told when
        // it did not — and one of those answers ("you have no products") is the
        // one this app must never get wrong, because to somebody holding forty
        // SKUs it reads as data loss.
        'src/lib/products.ts',
        'src/lib/product-store.tsx',
      ],
      thresholds: {
        lines: 70,
        functions: 70,
        statements: 70,
        branches: 70,
        // STILL POOLED, AND THAT IS A KNOWN HOLE — see docs/PRODUCTION_TODO.md,
        // "Coverage thresholds are pooled, not per file". A pooled average is
        // the same trick the include list was: a new module with no tests at
        // all costs the total a point or two and the gate stays green. Turning
        // `perFile: true` on today fails the build on src/lib/billing.ts
        // (functions 66.66%: createRailTestSession and createPortalSession have
        // no test), and billing is a live money rail this stream was told not
        // to touch. It is two small tests away, not a threshold change away,
        // and the TODO says which two.
      },
    },
  },
});
