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
        // The two the shell stream left for whoever next opened this list (TODO entry 6's
        // follow-up). Both meet the rule above on the third clause rather than the first two:
        // `hasErrorSink()` drives a sentence the crash screen says to a customer about whether
        // their failure reached us, and `lazyScreen`'s typed rejection is the only thing that
        // tells "the file never arrived" apart from "this screen crashed" — opposite
        // instructions to give somebody who was about to print a label. Neither costs money or
        // data; both can make a screen state something untrue.
        'src/lib/report-error.ts',
        'src/lib/lazy-screen.ts',
        // The other half of the reporting seam (TODO entry 7): the two window listeners that
        // catch what an error boundary structurally cannot — a rejected promise, a throw in a
        // click handler. On the list for the same third-clause reason as report-error.ts, and
        // for one of its own: it decides when NOT to file, so a mistake here is either a fault
        // that silently goes unrecorded or one crash filed three times, and the second is what
        // a paid vendor bills for.
        'src/lib/global-errors.ts',
        // Where those reports now go (TODO entry 6). These two are on this list
        // under a clause the rule above did not have to spell out, because until
        // now nothing in this repo sent anything anywhere: scrub-report.ts is
        // the ONLY thing deciding what of a customer's data leaves their
        // machine for a third party, and error-sink.ts is the only thing that
        // can install a transport for it. A mistake in the first is a supplier
        // name or a formulation percentage in somebody else's database; a
        // mistake in the second is the crash screen telling a customer their
        // failure reached us when it did not.
        'src/lib/scrub-report.ts',
        'src/lib/error-sink.ts',
        // The settings rail. On this list under the third clause and hard: between them these
        // three decide what a CLP label and sections 1 and 15 of a safety data sheet print as
        // the supplier — the name, address and telephone a regulator reads — and whether a
        // write that PostgREST answered with 204 and no rows is reported to a maker as a save.
        // identity.ts is also the one module-level holder in the app that survives a route
        // change, so getting its clearing wrong prints one account's registered address under
        // another account's product.
        'src/lib/identity.ts',
        'src/lib/settings-data.ts',
        'src/lib/settings-store.tsx',
      ],
      thresholds: {
        lines: 70,
        functions: 70,
        statements: 70,
        branches: 70,
        // PER FILE, WHICH TURNS THE NUMBER FROM AN AVERAGE INTO A FLOOR.
        //
        // Pooled was the same trick the include list was: a new module with no
        // tests at all cost the total a point or two and the gate stayed green.
        // Every file on the list above is one where being wrong costs a customer
        // money, data, or a true sentence about their compliance, and an average
        // lets one of them be uncovered as long as the others carry it.
        //
        // It was blocked on src/lib/billing.ts, at 66.66% functions. The TODO
        // named createRailTestSession and createPortalSession; the portal call
        // was in fact already covered, and the two without a test were
        // createRailTestSession — the 30p live-rail purchase — and leaveFor, the
        // line that actually navigates the customer to Stripe. Both have one now.
        //
        // WHEN THIS FAILS ON A FILE, the fix is a test. Lowering the bar, or
        // writing a per-file exception, puts the number back to being an average
        // with extra steps — and it would do it in whichever file was hardest to
        // cover, which is not the one you want excused.
        perFile: true
      },
    },
  },
});
