import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * THE LANDING SCREEN IS NOT CODE-SPLIT, AND NOTHING MAY QUIETLY SPLIT IT.
 *
 * Route `/` is where a signed-in maker arrives. Every other screen in this app is fetched on
 * demand, and the tidy-looking version of App.tsx — the one where all nine routes are written
 * the same way — costs the first screen after sign-in an extra network round trip, spent
 * staring at nothing. It is a one-line change, it looks like consistency, it will never show
 * up in a test run, and it is exactly the kind of thing a reviewer nods through.
 *
 * So the shape of the imports is asserted rather than commented. Read as source rather than
 * exercised as behaviour on purpose: what is being guarded IS the module graph, and by the
 * time this file is imported the graph has already been resolved by the bundler.
 *
 * Measured on the build this was written against: one 704.60 kB chunk (197.67 kB gzip) became
 * a 570.26 kB entry (167.22 kB gzip) plus nine on-demand chunks. If a future change moves
 * those numbers the right way for the wrong reason, this test is what says so.
 */

const source = readFileSync(resolve(__dirname, 'App.tsx'), 'utf8');

/** `import { Thing } from './pages/Thing';` — a screen in the entry chunk. */
const EAGER_SCREEN = /^import \{[^}]*\} from '\.\/pages\/([A-Za-z]+)';$/gm;

/** `import('./pages/Thing')` — a screen in its own chunk. */
const SPLIT_SCREEN = /import\('\.\/pages\/([A-Za-z]+)'\)/g;

function matches(pattern: RegExp): string[] {
  return [...source.matchAll(pattern)].map((match) => match[1]);
}

describe('App.tsx', () => {
  /**
   * Exactly two screens are in the entry chunk, and each is there for its own reason.
   *
   * Studio, because it is where a signed-in maker lands: splitting it buys an extra round
   * trip at the one moment they have nothing else to look at.
   *
   * BillingReturn, because it is where Stripe returns somebody the instant after they have
   * been charged. Behind a second fetch, a dropped connection — or a deploy that landed
   * while they were away in Checkout, which is exactly when a tab has been sitting open —
   * shows a crash screen to a customer who has just paid and does not yet know whether
   * their plan is on. It costs about 1 kB gzipped.
   *
   * Adding a third needs a reason of the same kind, which is why this asserts the whole set
   * rather than just containing these two.
   */
  it('loads only the landing screen and the post-payment return up front', () => {
    expect(matches(EAGER_SCREEN).sort()).toEqual(['BillingReturn', 'Studio']);
  });

  it('splits every other screen out', () => {
    expect(matches(SPLIT_SCREEN).sort()).toEqual([
    'AcceptInvite',
    'ArtefactDesigner',
    'Billing',
    'Materials',
    'Products',
    'Records',
    'Settings',
    'Specification']
    );
  });

  it('routes every split screen through lazyScreen, not through a bare React.lazy', () => {
    // A bare `lazy()` rejects with whatever the browser threw — a TypeError whose message
    // differs between Chrome and Safari — and the crash screen would have to guess from that
    // string whether to tell the maker to distrust what they were reading or that nothing was
    // ever drawn. Those are opposite instructions. lib/lazy-screen.ts types the failure so it
    // is not a guess.
    expect(source).not.toMatch(/[^A-Za-z]lazy\(/);
    expect(matches(SPLIT_SCREEN)).toHaveLength(source.split('lazyScreen(').length - 1);
  });

  it('keeps the whole app inside the error boundary', () => {
    // Outside the providers, not just around the routes: a crash in AuthProvider,
    // ProductsProvider or AppShell has to be caught too, or the blank document is still
    // reachable. The second, screen-scoped boundary below does NOT relieve this one — it
    // covers the routed content and nothing else. See components/ErrorBoundary.tsx.
    expect(source).toMatch(/<ErrorBoundary>\s*<AuthProvider>/);
  });

  it('puts a second boundary around the routed screens, inside the shell', () => {
    // Inside AppShell is the whole point: the navigation is drawn by a component this
    // boundary cannot unmount, so a screen crashing leaves the maker somewhere to go. Moved
    // outside the shell it silently becomes a worse copy of the outer one.
    expect(source).toMatch(/<AppShell>\s*<RoutedScreens \/>\s*<\/AppShell>/);
    expect(source).toMatch(/<ErrorBoundary scope="screen"[^>]*>\s*<Suspense/);
  });

  it('gives that boundary the pathname, so the surviving navigation navigates', () => {
    // Without a resetKey the maker keeps a sidebar that lights up and changes nothing: the
    // URL moves, the crash fallback stays, and it stays for the rest of the session.
    expect(source).toMatch(/<ErrorBoundary scope="screen" resetKey=\{pathname\}>/);
    expect(source).toMatch(/const \{ pathname \} = useLocation\(\);/);
  });

  /**
   * THE THREE ACCOUNT-SCOPED STORES ARE MOUNTED, AND MOUNTED ABOVE THE ROUTER.
   *
   * This is asserted here rather than by a throw inside the hooks, and the reason is worth
   * writing down because it is the seam three parallel branches met at.
   *
   * Studio, Specification and ArtefactDesigner subscribe with `useOptionalMaterials` /
   * `useOptionalSettings`, which return null instead of throwing — they have to, because a
   * dozen harnesses mount one of those screens on its own and the screens do not LIE without a
   * store: the material index answers "has not loaded" and the identity holder prints its
   * bracketed placeholders, both of which are true sentences.
   *
   * That tolerance is exactly what makes deleting a provider from this file a silent change.
   * The app would still render, still pass every screen test, and quietly show a maker a work
   * queue counted against a register that never arrived and a label carrying "[Business name]"
   * instead of theirs. So the tree is pinned as source, where the deletion would happen.
   *
   * Above the router, not inside it: none of the three is one screen's data. The identity is
   * what every label and every safety data sheet prints from any route, the register is what
   * the classification reads, and the product list has to survive navigation.
   */
  it('mounts the three account-scoped stores, above the router and inside the entitlement', () => {
    // `[\s\S]*?` between the entitlement and the first store, because the comment explaining
    // the arrangement sits there and is worth more than a tighter regex.
    expect(source).toMatch(
      /<EntitlementProvider>[\s\S]*?<SettingsProvider>\s*<MaterialsProvider>\s*<ProductsProvider>\s*<AppRoutes \/>/
    );
    // AppRoutes is what owns BrowserRouter, so matching it above is what places all three
    // outside the router. Asserted separately so a move of the router reads as its own failure.
    expect(source).toMatch(/function AppRoutes\(\)[\s\S]*?<BrowserRouter>/);
  });

  it('is a check that can actually fail', () => {
    expect([...`import { Materials } from './pages/Materials';`.matchAll(EAGER_SCREEN)]).
    toHaveLength(1);
    expect([...`import('./pages/Studio')`.matchAll(SPLIT_SCREEN)]).toHaveLength(1);
    // And the provider guard above: the same shape with one store removed must not match.
    expect(
      `<EntitlementProvider><SettingsProvider><ProductsProvider><AppRoutes />`
    ).not.toMatch(
      /<EntitlementProvider>[\s\S]*?<SettingsProvider>\s*<MaterialsProvider>\s*<ProductsProvider>\s*<AppRoutes \/>/
    );
  });
});
