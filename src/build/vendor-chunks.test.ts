import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { packageOf, vendorChunkFor } from './vendor-chunks';

/**
 * THE ONLY WAY THIS CHANGE CAN HURT ANYONE IS BY BEING TIDIED UP.
 *
 * Splitting the vendors out of the entry chunk moves no bytes off the first paint — every
 * package it names is one route `/` already needs — and buys a returning maker most of their
 * cache back after a deploy. The shorter version of the same rule,
 * `if (id.includes('node_modules')) return 'vendor'`, reads as the obvious simplification and
 * is a first-paint regression: it drags packages that only a lazily-loaded screen ever reaches
 * into the file the browser must have before it can draw anything. No build log would say so.
 * The chunk list would just look neater.
 *
 * So the rule is called rather than described.
 */

const inPackage = (name: string) => `/Users/x/app/node_modules/${name}/dist/index.js`;

describe('what comes out of the entry chunk', () => {
  it('takes the packages route / cannot draw without', () => {
    // AuthProvider blocks the first render on getSession(); the router and the toaster are
    // mounted in App.tsx; React is React. All of them are in the entry chunk today, so moving
    // them into siblings cannot cost the first paint anything.
    expect(vendorChunkFor(inPackage('@supabase/supabase-js'))).toBe('supabase');
    expect(vendorChunkFor(inPackage('react'))).toBe('react');
    expect(vendorChunkFor(inPackage('react-dom'))).toBe('react');
    expect(vendorChunkFor(inPackage('scheduler'))).toBe('react');
    expect(vendorChunkFor(inPackage('react-router-dom'))).toBe('router');
    expect(vendorChunkFor(inPackage('sonner'))).toBe('sonner');
  });

  it('keeps supabase together, however many packages it is really made of', () => {
    // supabase-js is an assembly: auth-js, postgrest-js, realtime-js and the rest ship as
    // separate packages and are all pulled in by the one import. Naming only the umbrella
    // would leave most of the 218 kB behind in the entry chunk, which is the opposite of the
    // intent and would look like it had worked.
    expect(vendorChunkFor(inPackage('@supabase/postgrest-js'))).toBe('supabase');
    expect(vendorChunkFor(inPackage('@supabase/realtime-js'))).toBe('supabase');
    expect(vendorChunkFor(inPackage('@supabase/auth-js'))).toBe('supabase');
  });

  it('leaves everything else where the bundler put it', () => {
    // THE LOAD-BEARING ONE. lucide-react is the canary: Vite emits two of its icons as their
    // own on-demand chunks today, and any blanket node_modules rule pulls them forward.
    expect(vendorChunkFor(inPackage('lucide-react'))).toBeUndefined();
    expect(vendorChunkFor(inPackage('tailwind-merge'))).toBeUndefined();
  });

  it('reads the package name rather than a substring of the path', () => {
    // `id.includes('/react/')` is the version that reads fine and is wrong: @emotion/react
    // contains it and would be hoisted into the React chunk on the strength of its folder
    // name. The naive check fails this test and the careful one passes it.
    expect(vendorChunkFor(inPackage('@emotion/react'))).toBeUndefined();
    expect(packageOf(inPackage('@emotion/react'))).toBe('@emotion/react');
    expect(packageOf(inPackage('lucide-react'))).toBe('lucide-react');
  });

  it('says nothing about our own code, which is the chunk being kept small', () => {
    expect(vendorChunkFor('/Users/x/app/src/pages/Studio.tsx')).toBeUndefined();
    expect(packageOf('/Users/x/app/src/lib/products.ts')).toBeUndefined();
  });
});

describe('vite.config.ts', () => {
  const source = readFileSync(resolve(__dirname, '../../vite.config.ts'), 'utf8');

  it('uses this rule rather than one written inline beside it', () => {
    expect(source).toMatch(/manualChunks: vendorChunkFor/);
  });

  it('still reports the entry graph, because the 500 kB warning no longer fires', () => {
    // One 578 kB chunk became five, which silenced Rollup's own size warning without moving a
    // byte off the critical path. The plugin re-states the number that warning stood for. If it
    // goes, the build reads lighter than it is and nothing on screen says otherwise.
    //
    // Matched on the plugin being INSTALLED rather than on the exact array literal: the list has
    // more than two entries in it now, and a test that breaks when a plugin is added is a test
    // that gets edited rather than read.
    expect(source).toMatch(/plugins: \[[\s\S]*?reportEntryGraph\(\)/);
    expect(source).toMatch(/if \(raw > limitBytes\) this\.warn\(line\)/);
  });

  it('does not emit the error-reporting vendor on a build that has no DSN', () => {
    // `installErrorSink` checks the DSN before it imports anything, so the chunk was never
    // fetched — but Rollup followed the dynamic import and wrote 89.46 kB of it into every
    // preview deploy regardless. `enforce: 'pre'` is load-bearing: without it the plugin is
    // asked only after Vite has resolved the bare specifier to a path in node_modules, and the
    // chunk comes out exactly as before.
    expect(source).toMatch(/sentryOnlyWhenThereIsADsn/);
    expect(source).toMatch(/enforce: 'pre'/);
    expect(source).toMatch(/source === '@sentry\/react'/);
  });
});
