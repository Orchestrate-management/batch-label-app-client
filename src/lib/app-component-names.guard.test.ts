import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  APP_COMPONENT_NAMES,
  REACT_BUILT_IN_LABELS,
  SCANNED_FROM_OUR_SOURCE } from
'./app-component-names';
import { scrubComponentStack } from './scrub-report';

/**
 * THE ONE PROPERTY THAT MAKES THE COMPONENT TRAIL SAFE TO SEND.
 *
 * `scrubComponentStack` echoes a component name verbatim if and only if it is
 * in `APP_COMPONENT_NAMES`. That is only worth anything if every string in that
 * list is one WE wrote — because the string React hands us is one V8 inferred,
 * and V8 infers function names from data (`{ [batch.code]: fn }` becomes a
 * function called `BL240417A`, and React turns that into a component called
 * `BL240417A`).
 *
 * So this test does not check that the list is complete — a list that reddens
 * CI every time somebody adds a component is a list somebody deletes, and an
 * incomplete one costs a label in an issue and nothing else. It checks the
 * direction that can leak: NOTHING IN THE LIST THAT IS NOT IN OUR OWN SOURCE.
 */

const SRC = resolve(__dirname, '..');

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...walk(full));
      continue;
    }
    if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

/** Our own shipping source: no tests, and not the list itself. */
function ourSourceFiles(): string[] {
  return walk(SRC).
  filter((path) => !/\.(test|spec)\.tsx?$/.test(path)).
  filter((path) => path !== join(SRC, 'lib', 'app-component-names.ts'));
}

/**
 * The scan that produced the list, run again here so it is a checked claim
 * rather than a note about how somebody once generated a file.
 */
function scanForComponentNames(): Set<string> {
  const found = new Set<string>();
  for (const path of ourSourceFiles()) {
    const text = readFileSync(path, 'utf8');
    if (path.endsWith('.tsx')) {
      for (const m of text.matchAll(/(?:^|\b)(?:function|class)\s+([A-Z][A-Za-z0-9_]*)/g)) {
        found.add(m[1]);
      }
      for (const m of text.matchAll(/(?:^|\b)const\s+([A-Z][A-Za-z0-9_]*)\s*[:=]/g)) found.add(m[1]);
      for (const m of text.matchAll(/<([A-Z][A-Za-z0-9_]*)[\s/>]/g)) found.add(m[1]);
      // NAMED IMPORTS COUNT TOO. A component can be referenced as a value rather
      // than written as a tag — `{ icon: SettingsIcon }` on a nav item, rendered
      // later as `<Icon />` — and React still infers the trail entry from the
      // function's own name. The three patterns above see declarations and tags
      // and miss that entirely, which showed up the moment an icon moved from a
      // menu into a data table.
      //
      // It does not widen what the list may contain: an imported name is a
      // literal somebody typed into our source, which is the whole property this
      // guard is defending. A batch code never appears in an import statement.
      for (const block of text.matchAll(/import\s*\{([^}]*)\}\s*from/g)) {
        for (const m of block[1].matchAll(/\b([A-Z][A-Za-z0-9_]*)\b/g)) found.add(m[1]);
      }
    }
    for (const m of text.matchAll(/displayName\s*[:=]\s*['"]([A-Za-z0-9_$]+)['"]/g)) found.add(m[1]);
  }
  return found;
}

describe('the component-name allow-list', () => {
  it('contains only identifiers that occur in this repository\'s own source', () => {
    // THE SECURITY PROPERTY, ONE NAME AT A TIME. A name that is not in our
    // source is a name we cannot vouch for, and a name we cannot vouch for is
    // the one that turns out to be a batch code.
    const scanned = scanForComponentNames();
    const notOurs = SCANNED_FROM_OUR_SOURCE.filter((name) => !scanned.has(name));
    expect(notOurs).toEqual([]);
  });

  it('names React\'s own labels separately, because those are not ours to scan for', () => {
    // React writes these from string literals in its own bundle rather than
    // from a function's inferred name, so they cannot carry anything.
    expect(REACT_BUILT_IN_LABELS).toContain('Suspense');
    expect(APP_COMPONENT_NAMES.has('Suspense')).toBe(true);
    expect(APP_COMPONENT_NAMES.has('Lazy')).toBe(true);
  });

  it('does not contain anything shaped like a maker\'s data', () => {
    // The three shapes this app actually holds, none of which is an identifier
    // anybody typed into src/.
    for (const value of ['BL240417A', 'WinterFigAndCassis', 'Robertet', 'Firmenich']) {
      expect(APP_COMPONENT_NAMES.has(value)).toBe(false);
    }
  });

  it('is what scrubComponentStack actually consults, not a second copy of the rule', () => {
    // A list nothing reads is decoration. One name from each half, plus one
    // that is in neither.
    expect(scrubComponentStack('    at Specification')).toEqual(['Specification']);
    expect(scrubComponentStack('    at Suspense')).toEqual(['Suspense']);
    expect(scrubComponentStack('    at BL240417A')).toEqual(['[redacted]']);
  });

  it('covers the components a crash is most likely to be reported from', () => {
    // Not a completeness check — see the header — but the boundary, the crash
    // screen and the routed screens are the trail entries that exist on
    // essentially every report, and a list that had lost those would be a list
    // that had quietly stopped being worth having.
    for (const name of ['ErrorBoundary', 'CrashScreen', 'AppShell', 'Specification', 'Materials']) {
      expect(APP_COMPONENT_NAMES.has(name)).toBe(true);
    }
  });
});
