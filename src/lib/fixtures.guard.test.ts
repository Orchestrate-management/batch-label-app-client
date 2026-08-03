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

/**
 * The shipped catalogue must hold reference data only, never account-scoped state.
 *
 * The guard above watches imports of fixtures.ts, and INBOX and DOCUMENT_HISTORY lived in
 * catalog.ts — which ships — so it saw nothing while Materials opened on "3 documents
 * received, none read yet" for an account that had received none, and while the pipeline
 * told makers, under their own product name, that a newer sheet was waiting and their
 * allergen table had changed.
 *
 * The distinction the catalogue has to hold: a fragrance oil that exists in the world is
 * REFERENCE data and belongs here; a document THIS account received is per-account STATE and
 * belongs in Supabase. Both look like a const array in a bundle. Only one is a lie when it
 * renders for somebody who never saw it.
 *
 * This assertion is narrow by design — it names the two that escaped rather than pretending
 * to recognise the category. A regex cannot tell reference from state. What it can do is
 * stop these two coming back, and put the question in front of whoever adds the next one.
 */
describe('the shipped materials catalogue', () => {
  const catalogue = readFileSync(join(SRC, 'lib', 'catalog.ts'), 'utf8');

  it.each(['INBOX', 'DOCUMENT_HISTORY'])(
    'does not declare %s — that is per-account state, not reference data',
    (name) => {
      expect(
        new RegExp(`export\\s+const\\s+${name}\\b`).test(catalogue),
        `catalog.ts declares ${name}. It ships to every browser, so anything here renders ` +
        'identically for every account. A document an account received is that account\'s ' +
        'state and belongs in Supabase; if there is no table for it yet, the screen says ' +
        '"not built yet" rather than showing a plausible example.'
      ).toBe(false);
    }
  );

  it('still holds the reference data the app legitimately ships', () => {
    // Non-vacuity, and the other half of the point: this file is not the problem, its
    // contents were. A materials catalogue everyone shares is exactly right.
    expect(/export\s+const\s+MATERIALS\b/.test(catalogue)).toBe(true);
  });
});

/**
 * NO SHIPPING COPY MAY SAY THE ACCOUNT HOLDS SUPPLIER DOCUMENTS.
 *
 * There is no document store. There is nowhere to upload a supplier safety data sheet and
 * nothing that reads one, and section 16 of every generated sheet now says so outright: "This
 * sheet was assembled from Batchlabel's reference data… No supplier document of yours is
 * held." The claim kept surviving in other places because it is one phrase, spelled a few
 * ways, spread over three files — the Materials register said it, then section 16 said it,
 * then section 3 still said it two paragraphs above section 16 ON THE SAME A4 PAGE, and the
 * product screen repeated it in a summary line. A maker hands that sheet to a Trading
 * Standards officer with both sentences printed on it.
 *
 * This is the phrase-level guard, and a phrase-level guard is the right instrument here: the
 * problem is not a module or an import, it is a sentence that reads perfectly and is false,
 * and it comes back because it sounds like the thing anybody would write.
 *
 * WHAT IS DELIBERATELY NOT BANNED. "Composition on file" — that IS the account's, it is the
 * recipe they typed. "No value on file", "No document on file", "No declaration on file", "No
 * IFRA categories on file" — every one of those is a stated GAP, which is the honest form and
 * the one the whole round has been moving towards.
 */
describe('copy about documents the account does not hold', () => {
  /**
   * Comments are stripped first. Every fix in this family left a comment behind explaining
   * what the sentence used to say, and a guard that cannot tell the correction from the
   * offence would force the corrections to be written in code.
   */
  function withoutComments(source: string): string {
    return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^[ \t]*\/\/.*$/gm, ' ');
  }

  /** "the sheet on file", "supplier safety data sheets on file", "documents on file". */
  const CLAIMS_DOCUMENTS = /\b(?:sheets?|documents)\s+on\s+file\b/i;

  it('appears in nothing that ships', () => {
    const offenders = walk(SRC).
    filter((path) => !isTestFile(path)).
    filter((path) => CLAIMS_DOCUMENTS.test(withoutComments(readFileSync(path, 'utf8')))).
    map((path) => relative(SRC, path));

    expect(
      offenders,
      'A screen or a generated document claims supplier sheets are on file for this account. ' +
      'Nothing holds one and nothing can: name Batchlabel\'s reference data instead, as ' +
      'section 16 of the safety data sheet does.'
    ).toEqual([]);
  });

  it('is a check that can actually fail, and one that does not overreach', () => {
    expect(CLAIMS_DOCUMENTS.test('assembled from the supplier safety data sheets on file.')).toBe(true);
    expect(CLAIMS_DOCUMENTS.test('The sheet on file carries no classification')).toBe(true);
    expect(CLAIMS_DOCUMENTS.test('derived from the composition and the supplier sheets on file')).toBe(true);
    // A stated gap is the honest form and must stay sayable.
    expect(CLAIMS_DOCUMENTS.test('No value on file')).toBe(false);
    expect(CLAIMS_DOCUMENTS.test('No declaration on file')).toBe(false);
    expect(CLAIMS_DOCUMENTS.test('Composition on file')).toBe(false);
  });

  it('strips comments rather than counting them as copy', () => {
    expect(withoutComments('// it used to say sheets on file\nconst a = 1;')).not.toMatch(CLAIMS_DOCUMENTS);
    expect(withoutComments('/* was: documents on file */\nconst a = 1;')).not.toMatch(CLAIMS_DOCUMENTS);
    expect(withoutComments('const a = "documents on file";')).toMatch(CLAIMS_DOCUMENTS);
  });
});
