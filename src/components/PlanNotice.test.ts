import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { copyFor } from './PlanNotice';
import type { EntitlementStatus } from '../lib/membership';

/**
 * What the billing surfaces are allowed to say.
 *
 * Two halves. The first is the notice's own copy, one state at a time. The second is a scan
 * of every billing surface for sentences describing machinery that does not exist — because
 * the failure this project keeps having is not a wrong price, it is a true-sounding sentence
 * about a feature nobody built, and a reviewer reading a diff will not catch it twice.
 */

const STATUSES: EntitlementStatus[] = [
'active',
'past_due',
'lapsed',
'free',
'no_membership',
'suspended',
'unknown'];


describe('the notice, state by state', () => {
  it('says nothing to somebody who is entitled', () => {
    // Including past_due, which IS entitled: the database keeps access on while Stripe
    // retries the card. Nothing is being withheld, so there is nothing to explain — and a
    // "update your card" banner on a screen with no card field is a dead end. That nag lives
    // on /billing, beside the button that opens the portal.
    expect(copyFor('active', 'Exporting', 'Maker')).toBeNull();
    expect(copyFor('past_due', 'Exporting', 'Maker')).toBeNull();
  });

  it('names the control being withheld rather than waving at premium features', () => {
    const copy = copyFor('free', 'Exporting a finished artefact', 'Free');
    expect(copy?.title).toBe('Exporting a finished artefact is part of a paid plan');
  });

  it('tells a lapsed account it is no worse off than a new signup', () => {
    // Ruling R9. A lapse lands on Free's abilities. The copy may not imply a penalty, a
    // lockout, a deletion or a countdown, because none of those happen.
    const copy = copyFor('lapsed', 'Exporting', 'Studio');
    expect(copy?.title).toBe('Your Studio plan is not running');
    expect(copy?.body).toContain('everything the Free plan can');
    expect(copy?.body).toContain('never subscribed');
    expect(copy?.body).not.toMatch(/lost|expired|locked|removed|deleted your/i);
  });

  it('sends somebody who wants to pay to the billing page in this app', () => {
    // Purchases happen here now. Sending a signed-in customer to another origin to buy the
    // thing they are looking at loses people for no reason, and the checkout session has to
    // carry their Supabase user id anyway.
    for (const status of ['free', 'lapsed'] as EntitlementStatus[]) {
      // `upgrade: true` on both, and that is the point of the flag rather than an
      // incidental extra key: these two presses are somebody deciding to start paying, so
      // they are the only ones that report Meta's InitiateCheckout. The suspended and retry
      // actions deliberately do not — see the render test.
      expect(copyFor(status, 'Exporting', 'Free')?.action).toEqual({
        kind: 'internal',
        to: '/billing',
        label: expect.any(String),
        upgrade: true
      });
    }
  });

  it('offers a person, not a checkout, to a suspended account', () => {
    // They may well already be paying. An upgrade button here would be insulting and would
    // not fix anything.
    const copy = copyFor('suspended', 'Exporting', 'Consultant');
    expect(copy?.action).toMatchObject({ kind: 'external', href: 'mailto:hello@batchlabel.co.uk' });
    expect(copy?.body).not.toMatch(/upgrade|plan again/i);
  });

  it('blames itself, not the customer, when the read failed', () => {
    const copy = copyFor('unknown', 'Exporting', 'Unknown');
    expect(copy?.body).toContain('This is us, not you');
    expect(copy?.action).toMatchObject({ kind: 'retry' });
  });

  it('has something to say for every state that is not entitled', () => {
    for (const status of STATUSES) {
      const copy = copyFor(status, 'Exporting', 'Maker');
      if (status === 'active' || status === 'past_due') {
        expect(copy).toBeNull();
      } else {
        expect(copy?.title.length).toBeGreaterThan(0);
        expect(copy?.body.length).toBeGreaterThan(0);
      }
    }
  });
});

/* ------------------------------------------------------- the honesty scan */

/** Every surface that talks to a customer about money or about what a plan allows. */
const BILLING_SURFACES = [
'./PlanNotice.tsx',
'../pages/Billing.tsx',
'../pages/BillingReturn.tsx',
'../lib/plans.ts',
'../lib/billing.ts',
'../lib/membership.ts'];


/**
 * The file with its comments removed.
 *
 * The scan is about what a CUSTOMER can read, so it has to see the strings and the JSX and
 * not the reasoning around them. Half of these modules explain at length which mechanisms do
 * NOT exist and what the deleted price stub used to say — comments that are the whole point
 * of the change — and a scan that read those would force every one of them to be reworded
 * around a regex, which is the guard corrupting the thing it guards.
 *
 * Hand-rolled rather than reached for a parser: a dependency in the test tree to strip
 * comments is a poor trade, and the states that matter (inside a string, inside a template
 * literal, inside either kind of comment) are few enough to track exactly.
 */
function stripComments(code: string): string {
  let out = '';
  let quote: string | null = null;
  let comment: 'line' | 'block' | null = null;

  for (let i = 0; i < code.length; i += 1) {
    const char = code[i];
    const next = code[i + 1];

    if (comment === 'line') {
      if (char === '\n') {
        comment = null;
        out += char;
      }
      continue;
    }
    if (comment === 'block') {
      if (char === '*' && next === '/') {
        comment = null;
        i += 1;
      }
      continue;
    }
    if (quote) {
      // A backslash escapes the next character, including the closing quote.
      if (char === '\\') {
        out += char + (next ?? '');
        i += 1;
        continue;
      }
      if (char === quote) quote = null;
      out += char;
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      out += char;
      continue;
    }
    if (char === '/' && next === '/') {
      comment = 'line';
      i += 1;
      continue;
    }
    if (char === '/' && next === '*') {
      comment = 'block';
      i += 1;
      continue;
    }
    out += char;
  }
  return out;
}

function source(relative: string): string {
  return stripComments(readFileSync(new URL(relative, import.meta.url), 'utf8'));
}

/**
 * Phrases naming a mechanism this product does not have.
 *
 * The exporter is deferred (R6): both export buttons in the app are toast stubs, so nothing
 * may describe a print-ready file, a format, or a watermark. There is no SDS upload and no
 * archive (R7, R10). And `sku_limit` is stored and displayed but NOT enforced (R8), so no
 * sentence may say what happens at the limit — in either direction, because "you cannot
 * create a new one" and "you will not be stopped" are both promises about software nobody
 * has written.
 */
const FORBIDDEN: Array<{pattern: RegExp;why: string;}> = [
{ pattern: /print-?ready/i, why: 'there is no exporter (R6)' },
{ pattern: /\bPDF\b/, why: 'there is no exporter (R6)' },
{ pattern: /\bSVG\b/, why: 'there is no exporter (R6)' },
{ pattern: /watermark/i, why: 'nothing is watermarked, and nothing un-watermarks it (R6)' },
{ pattern: /upload/i, why: 'there is no SDS upload' },
{ pattern: /archiv/i, why: 'there is no archive (R10)' },
{ pattern: /\bAPI access\b/i, why: 'there is no API (R10)' },
{ pattern: /bulk (generation|import)/i, why: 'there is no bulk generation or CSV import (R10)' },
{ pattern: /re-?export.{0,20}forever/i, why: 'artefact_exports is deferred (R7)' },
{ pattern: /cannot create a new/i, why: 'the SKU limit is not enforced (R8)' },
{ pattern: /reprints?\b/i, why: 'reprints are not built, so they cannot be promised on any tier' }];


describe('no billing surface promises a mechanism that does not exist', () => {
  it.each(BILLING_SURFACES)('%s', (file) => {
    const text = source(file);
    for (const { pattern, why } of FORBIDDEN) {
      expect(text, `${file} mentions ${pattern} — ${why}`).not.toMatch(pattern);
    }
  });
});

describe('no billing surface writes a price or an allowance of its own', () => {
  it.each(BILLING_SURFACES)('%s', (file) => {
    const text = source(file);
    // The stub that was deleted: Maker £24 for 3, Studio £58 for 10, House £140 for 40.
    // Nothing may reintroduce a currency literal, and the unlimited sentinel must never
    // appear in a browser bundle at all.
    expect(text, `${file} contains a hard-coded price`).not.toMatch(/£\s?\d/);
    expect(text, `${file} contains the unlimited sentinel`).not.toContain('2147483647');
  });
});
