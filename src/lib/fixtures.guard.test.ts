import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

/**
 * NOTHING THAT SHIPS MAY IMPORT THE FIXTURES.
 *
 * This is the assertion behind the founder's sentence — "when a user signs in for the first
 * time, they are in a virgin account with no products". Before this change, `products.ts`
 * held six invented products and seeded them into a module-level array that every screen
 * read, so every account on its first visit found four candles, a face oil and a wax warmer
 * it had never made. They are still in the repository, because the derivation, regime and
 * safety data sheet tests need compositions with real shape to derive from — but they are in
 * lib/fixtures.ts, and the only thing standing between them and a customer's first screen is
 * this test.
 *
 * A comment asking people not to import a module is a request. This is the difference between
 * a request and a guarantee, and it is worth one test: the failure it prevents is silent
 * (everything renders, nothing errors, the screen just quietly contains somebody else's
 * business), and it is exactly the kind of thing an autocomplete import adds by accident.
 *
 * IF THIS TEST FAILS, the answer is almost never to add an exemption. Whatever was about to
 * be rendered from the fixtures is customer data, and it belongs in Supabase — or, where
 * there is no table for it yet, on screen as an honest "not built yet" rather than as a
 * plausible example.
 */

const SRC = resolve(__dirname, '..');

/** A test file may import anything. Everything else under src/ ships to a browser. */
function isTestFile(path: string): boolean {
  return /\.(test|spec)\.(ts|tsx)$/.test(path);
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...walk(full));
      continue;
    }
    if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

/** Matches `from './fixtures'`, `from '../lib/fixtures'`, dynamic imports and re-exports. */
const IMPORTS_FIXTURES = /(?:from|import)\s*\(?\s*['"][^'"]*\/?fixtures['"]/;

describe('the product fixtures', () => {
  it('are imported by test files and by nothing else', () => {
    const offenders = walk(SRC).
    filter((path) => !isTestFile(path)).
    filter((path) => path !== join(SRC, 'lib', 'fixtures.ts')).
    filter((path) => IMPORTS_FIXTURES.test(readFileSync(path, 'utf8'))).
    map((path) => relative(SRC, path));

    expect(offenders).toEqual([]);
  });

  it('is a check that can actually fail', () => {
    // Guards that cannot fail are worse than no guard: they read as protection and provide
    // none. This proves the matcher recognises the import it exists to catch.
    expect(IMPORTS_FIXTURES.test("import { PRODUCTS } from './fixtures';")).toBe(true);
    expect(IMPORTS_FIXTURES.test("import { PRODUCTS } from '../lib/fixtures';")).toBe(true);
    expect(IMPORTS_FIXTURES.test("const f = await import('./fixtures');")).toBe(true);
    expect(IMPORTS_FIXTURES.test("export { PRODUCTS } from './fixtures';")).toBe(true);
    expect(IMPORTS_FIXTURES.test("import { supabase } from './supabase';")).toBe(false);
  });
});
