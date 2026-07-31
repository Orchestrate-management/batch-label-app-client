import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The tab is the first thing a maker sees of this app.
 *
 * They sign up on www.batchlabel.xyz and are handed straight here, so the tab
 * title and icon are part of the crossing. A scaffold title next to a missing
 * icon reads as "did I just get phished", and it is not something anyone
 * notices while working inside the app — only a test catches it.
 *
 * The icon assertions are not cosmetic. vercel.json rewrites every unmatched
 * path to index.html, so a reference to a file that is not in `public/` does
 * not 404 — the browser asks for an icon and is handed a page of HTML. That
 * failure is invisible unless something checks the file is really there.
 */

const root = resolve(__dirname, '../..');
const html = readFileSync(resolve(root, 'index.html'), 'utf8');

describe('index.html', () => {
  it('is titled with the brand the maker signed up to', () => {
    expect(html).toMatch(/<title>Batchlabel<\/title>/);
  });

  it('references icons that are actually committed', () => {
    const referenced = [...html.matchAll(/rel="(?:icon|apple-touch-icon)"[^>]*href="([^"]+)"/g)].map(
      (match) => match[1]
    );

    // Guards the guard: if the icon links are ever dropped, the loop below would
    // pass vacuously.
    expect(referenced.length).toBeGreaterThanOrEqual(3);

    for (const path of referenced) {
      expect(existsSync(resolve(root, 'public', path.replace(/^\//, '')))).toBe(true);
    }
  });

  it('is not indexable, because nothing in this app is public', () => {
    expect(html).toMatch(/name="robots"\s+content="noindex/);
  });
});
