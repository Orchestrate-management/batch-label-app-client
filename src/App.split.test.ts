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
  it('loads the screen a maker lands on, and only that one, up front', () => {
    expect(matches(EAGER_SCREEN)).toEqual(['Studio']);
  });

  it('splits every other screen out', () => {
    expect(matches(SPLIT_SCREEN).sort()).toEqual([
    'ArtefactDesigner',
    'Billing',
    'BillingReturn',
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
    // reachable. See components/ErrorBoundary.tsx.
    expect(source).toMatch(/<ErrorBoundary>\s*<AuthProvider>/);
  });

  it('is a check that can actually fail', () => {
    expect([...`import { Materials } from './pages/Materials';`.matchAll(EAGER_SCREEN)]).
    toHaveLength(1);
    expect([...`import('./pages/Studio')`.matchAll(SPLIT_SCREEN)]).toHaveLength(1);
  });
});
