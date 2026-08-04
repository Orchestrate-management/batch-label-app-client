import { describe, expect, it } from 'vitest';
import {
  digest,
  scrubComponentStack,
  scrubMessage,
  scrubReport,
  scrubRoute,
  scrubStack } from
'./scrub-report';
import type { ErrorReport } from './report-error';

/**
 * The test that matters most in this stream, and it is not testing a function —
 * it is testing a promise.
 *
 * Batchlabel's customers hand it the things they would not hand a competitor:
 * which fragrance house supplies them, at what percentage, under what batch
 * code, for a product that has not launched. A crash report is the one thing in
 * this app that takes text off a maker's machine and posts it to a third party,
 * so every assertion below is of the form "this specific piece of a real
 * maker's data did NOT leave", written with the actual data in it so that a
 * reader can see what is being protected rather than being told.
 *
 * A NOTE ON HOW THESE ARE WRITTEN. They assert absence with `not.toContain` on
 * the whole serialised payload rather than on one field. Asserting that
 * `message` is clean proves nothing if the same text also went out in `stack`,
 * which is exactly the mistake this scrubber exists to make impossible — the
 * stack's first line IS the message.
 */

const REALISTIC: ErrorReport = {
  reference: 'K7QP-3MTX',
  source: 'render',
  name: 'TypeError',
  message: "Cannot read properties of undefined (reading 'Firmenich Ambrox 12.5%')",
  stack:
  "TypeError: Cannot read properties of undefined (reading 'Firmenich Ambrox 12.5%')\n" +
  '    at deriveHazards (https://app.batchlabel.xyz/assets/Specification-C6POi-On.js:12:3456)\n' +
  '    at renderWithHooks (https://app.batchlabel.xyz/assets/react-2p8jeSLm.js:1:2)',
  componentStack:
  '\n    at Specification (https://app.batchlabel.xyz/assets/Specification-C6POi-On.js:12:3456)' +
  '\n    at ErrorBoundary (https://app.batchlabel.xyz/assets/index-CQDYjleZ.js:1:2)',
  at: '2026-08-04T09:15:22.481Z'
};

/** Everything that left, as one string, so nothing can hide in a field nobody checked. */
function everythingSent(report: ErrorReport, href: string | null): string {
  return JSON.stringify(scrubReport(report, href));
}

describe('what a real crash on a real product sends', () => {
  it('does not send the supplier, the material or the percentage', () => {
    const sent = everythingSent(REALISTIC, 'https://app.batchlabel.xyz/products/8f3c2d1a-4b5e-4c7d-9a1f-2e6b8c0d4f37');
    expect(sent).not.toContain('Firmenich');
    expect(sent).not.toContain('Ambrox');
    expect(sent).not.toContain('12.5%');
  });

  it('does not send the product id, from the URL or from anywhere else', () => {
    const sent = everythingSent(REALISTIC, 'https://app.batchlabel.xyz/products/8f3c2d1a-4b5e-4c7d-9a1f-2e6b8c0d4f37');
    expect(sent).not.toContain('8f3c2d1a');
  });

  it('still says enough to act on: the kind of fault, the screen, the trail', () => {
    // The other half of the bargain. A scrubber that sends nothing usable is a
    // scrubber nobody will keep, and the entry that asked for this asked for
    // observability, not for silence.
    const scrubbed = scrubReport(
      REALISTIC,
      'https://app.batchlabel.xyz/products/8f3c2d1a-4b5e-4c7d-9a1f-2e6b8c0d4f37'
    );
    expect(scrubbed.name).toBe('TypeError');
    expect(scrubbed.message).toMatch(/^Cannot read properties of undefined \(reading/);
    expect(scrubbed.route).toBe('/products/:productId');
    expect(scrubbed.components).toEqual(['Specification', 'ErrorBoundary']);
    expect(scrubbed.frames[0]).toMatchObject({
      function: 'deriveHazards',
      filename: '/assets/Specification-C6POi-On.js',
      lineno: 12,
      colno: 3456
    });
  });

  it('keeps the reference, which is the only thing a customer can quote back', () => {
    expect(scrubReport(REALISTIC, null).reference).toBe('K7QP-3MTX');
  });
});

describe('the message', () => {
  it('replaces one it does not recognise with a fingerprint and nothing else', () => {
    // The shape of a hundred real faults: a message assembled at the throw site
    // out of values. There is no filtering to be done here — it goes, whole.
    const { text, recognised } = scrubMessage(
      'Failed to save batch BL-2026-0417 for Rose Absolute (Robertet) at 0.8%'
    );
    expect(recognised).toBe(false);
    expect(text).toBe(`[unrecognised:${digest('Failed to save batch BL-2026-0417 for Rose Absolute (Robertet) at 0.8%')}]`);
    expect(text).not.toContain('Robertet');
    expect(text).not.toContain('BL-2026-0417');
  });

  it('sends a thrown product object as a hash, not as JSON', () => {
    // report-error.ts's describe() does JSON.stringify on a thrown non-Error, so
    // `throw product` puts the entire row in `message`. This is the single worst
    // case in the app and it has to fall out of the rule rather than be caught
    // by a special case.
    const thrown = JSON.stringify({
      id: '8f3c2d1a-4b5e-4c7d-9a1f-2e6b8c0d4f37',
      name: 'Winter Fig & Cassis',
      supplier: 'Robertet',
      fraction: 0.085
    });
    const { text, recognised } = scrubMessage(thrown);
    expect(recognised).toBe(false);
    expect(text).not.toContain('Winter Fig');
    expect(text).not.toContain('Robertet');
    expect(text).not.toContain('0.085');
  });

  it('groups: the same unknown message twice is the same fingerprint', () => {
    // Without this the tracker is a list rather than a tool — every occurrence
    // of one fault becomes its own issue.
    const once = scrubMessage('Failed to save batch BL-2026-0417');
    const twice = scrubMessage('Failed to save batch BL-2026-0417');
    const other = scrubMessage('Failed to save batch BL-2026-0418');
    expect(once.text).toBe(twice.text);
    expect(once.text).not.toBe(other.text);
  });

  it('keeps our own messages whole, because we wrote every character of them', () => {
    expect(scrubMessage('useProducts must be used inside ProductsProvider')).toEqual({
      text: 'useProducts must be used inside ProductsProvider',
      recognised: true
    });
    expect(scrubMessage('plan catalogue request failed (503)')).toEqual({
      text: 'plan catalogue request failed (503)',
      recognised: true
    });
  });

  it('names the screen in a failed chunk fetch, but only a screen we named', () => {
    expect(scrubMessage('The code for the Materials screen could not be downloaded.').text).toBe(
      'The code for the Materials screen could not be downloaded.'
    );
    // A screen name that is not in the list — which is what a product name
    // reaching that argument would look like — is redacted, and the useful half
    // of the sentence survives.
    const surprising = scrubMessage(
      'The code for the Cassis screen could not be downloaded.'
    );
    expect(surprising.text).not.toContain('Cassis');
    expect(surprising.text).toContain('could not be downloaded');
  });

  it('keeps the browser template and redacts what the browser put in it', () => {
    const { text } = scrubMessage("Cannot read properties of null (reading 'lavender_dream')");
    expect(text).toBe(`Cannot read properties of null (reading '${'[redacted:' + digest('lavender_dream') + ']'}')`);
    expect(text).not.toContain('lavender_dream');
  });

  it('lets the deploy signal through, because it is one character', () => {
    // '<' means the origin served index.html for a request for a script: a stale
    // tab after a deploy. Losing it costs a real diagnosis and one character
    // cannot carry a supplier name.
    expect(scrubMessage("Unexpected token '<'").text).toBe("Unexpected token '<'");
    expect(scrubMessage('Failed to fetch').text).toBe('Failed to fetch');
  });

  it('sends nothing for an empty message rather than a placeholder', () => {
    expect(scrubMessage('')).toEqual({ text: '', recognised: true });
  });
});

/**
 * Every message the allow-list claims to know, put through it.
 *
 * A pattern nobody exercises is a claim nobody checked, and the claim is
 * "this message is safe to repeat verbatim". Two of these had a real bug in
 * them before this table existed. It is also what keeps the per-file coverage
 * floor honest for this file: each entry in the table is a `render` closure,
 * and an unexercised one shows up as an uncovered function rather than as
 * nothing at all.
 *
 * `carries` is the text that must survive, so a pattern that quietly stopped
 * matching — and therefore started redacting a message we want — fails here
 * rather than in six months on a Sentry issue nobody can read.
 */
const RECOGNISED_FORMS: Array<{message: string;carries: string;}> = [
{ message: 'useAuth must be used inside AuthProvider', carries: 'AuthProvider' },
{ message: 'plan catalogue is empty', carries: 'plan catalogue is empty' },
{
  message: 'plan catalogue is missing currency or tax behaviour',
  carries: 'currency or tax behaviour'
},
{ message: 'plan catalogue request failed (404)', carries: '(404)' },
{
  message: 'The code for the Billing screen could not be downloaded.',
  carries: 'Billing screen'
},
{ message: 'An unprintable value was thrown.', carries: 'unprintable' },
{
  message: "Cannot read properties of undefined (reading 'sdsRows')",
  carries: 'Cannot read properties of undefined'
},
{
  message: "Cannot set properties of null (setting 'value')",
  carries: 'Cannot set properties of null'
},
{
  message: "undefined is not an object (evaluating 'a.b')",
  carries: 'undefined is not an object'
},
{ message: "null is not an object (evaluating 'a.b')", carries: 'null is not an object' },
{ message: 'x.derive is not a function', carries: 'is not a function' },
{ message: 'rows is not iterable', carries: 'is not iterable' },
{
  message: 'Failed to fetch dynamically imported module: https://app.batchlabel.xyz/assets/x.js',
  carries: 'Failed to fetch dynamically imported module'
},
{
  message: 'error loading dynamically imported module: https://app.batchlabel.xyz/assets/x.js',
  carries: 'error loading dynamically imported module'
},
{ message: 'Importing a module script failed.', carries: 'Importing a module script failed.' },
{ message: 'Failed to fetch', carries: 'Failed to fetch' },
{ message: 'Load failed', carries: 'Load failed' },
{
  message: 'NetworkError when attempting to fetch resource.',
  carries: 'NetworkError'
},
{ message: 'Network request failed', carries: 'Network request failed' },
{ message: 'Script error.', carries: 'Script error.' },
{
  message: 'ResizeObserver loop completed with undelivered notifications.',
  carries: 'undelivered notifications'
},
{ message: 'ResizeObserver loop limit exceeded', carries: 'limit exceeded' },
{ message: "Unexpected token '<'", carries: "'<'" }];


describe('every message the allow-list claims to know', () => {
  it.each(RECOGNISED_FORMS)('recognises $message', ({ message, carries }) => {
    const { text, recognised } = scrubMessage(message);
    expect(recognised).toBe(true);
    expect(text).toContain(carries);
  });

  it('redacts the variable half of the ones that have one', () => {
    // The template is the diagnosis; the value in it is whatever the throw site
    // was holding, which in this app is a maker's data often enough to matter.
    expect(scrubMessage("Cannot read properties of undefined (reading 'sdsRows')").text).
    not.toContain('sdsRows');
    expect(scrubMessage('deriveWinterFig is not a function').text).not.toContain('WinterFig');
    expect(
      scrubMessage(
        'Failed to fetch dynamically imported module: https://app.batchlabel.xyz/assets/x.js'
      ).text
    ).not.toContain('batchlabel');
  });
});

describe('the stack', () => {
  it('drops the header line, which is the whole unredacted message', () => {
    // The mistake this exists to prevent: scrubbing `message` and then shipping
    // `stack`, whose first line is `Name: <that same message>`.
    const frames = scrubStack(REALISTIC.stack);
    expect(JSON.stringify(frames)).not.toContain('Firmenich');
    expect(frames).toHaveLength(2);
  });

  it("drops ScreenNotLoaded's `caused by` line, which is a second message", () => {
    const frames = scrubStack(
      'ScreenNotLoaded: The code for the Materials screen could not be downloaded.\n' +
      '    at loadMaterials (https://app.batchlabel.xyz/assets/index-CQDYjleZ.js:4:9)\n' +
      'caused by: TypeError: Failed to fetch Winter Fig & Cassis\n' +
      '    at fetchChunk (https://app.batchlabel.xyz/assets/index-CQDYjleZ.js:2:1)'
    );
    expect(JSON.stringify(frames)).not.toContain('Winter Fig');
    expect(frames.map((frame) => frame.function)).toEqual(['loadMaterials', 'fetchChunk']);
  });

  it('keeps the path and drops the origin', () => {
    const [frame] = scrubStack('    at go (https://app.batchlabel.xyz/assets/index-abc.js:1:2)');
    expect(frame.filename).toBe('/assets/index-abc.js');
    expect(frame.filename).not.toContain('batchlabel');
  });

  it('redacts a frame that is the document, because the document is the route', () => {
    // A frame whose file is the page itself carries the page's path, and the
    // page's path is /products/<a customer's product>.
    const [frame] = scrubStack(
      '    at onClick (https://app.batchlabel.xyz/products/8f3c2d1a-4b5e-4c7d-9a1f-2e6b8c0d4f37:1:2)'
    );
    expect(frame.filename).toBe('[redacted]');
    expect(JSON.stringify(frame)).not.toContain('8f3c2d1a');
  });

  it('drops the query string on a script path rather than reading it', () => {
    const [frame] = scrubStack(
      '    at go (https://app.batchlabel.xyz/assets/index.js?product=Winter%20Fig:1:2)'
    );
    expect(frame.filename).not.toContain('Winter');
  });

  it('names an anonymous frame rather than dropping it', () => {
    // A frame with no function is still a position in our own code.
    const [frame] = scrubStack('    at https://app.batchlabel.xyz/assets/index-abc.js:5:7');
    expect(frame).toEqual({
      function: '<anonymous>',
      filename: '/assets/index-abc.js',
      lineno: 5,
      colno: 7
    });
  });

  it('reads Safari and Firefox frames too', () => {
    const [frame] = scrubStack('deriveHazards@https://app.batchlabel.xyz/assets/x.js:9:4');
    expect(frame).toMatchObject({ function: 'deriveHazards', filename: '/assets/x.js', lineno: 9 });
  });

  it('will not let a message line masquerade as a frame', () => {
    // A message that happens to end in :line:col parses as a frame. When it
    // does, the file is not one of ours — and the function name goes with it,
    // rather than being sent because it happened to look like an identifier.
    const [frame] = scrubStack('    at Lavender (Ambrox 12.5%:3:1)');
    expect(frame.filename).toBe('[redacted]');
    expect(frame.function).toBe('[redacted]');
    expect(JSON.stringify(frame)).not.toContain('Lavender');
  });

  it('has a floor and a ceiling: no stack is empty, no stack is unbounded', () => {
    expect(scrubStack(undefined)).toEqual([]);
    const huge = Array.from({ length: 200 }, (_, i) => `    at f${i} (/assets/a.js:1:2)`).join('\n');
    expect(scrubStack(huge).length).toBeLessThanOrEqual(30);
  });
});

describe('the component trail', () => {
  it('keeps the names and throws away the lines they came on', () => {
    const names = scrubComponentStack(
      '\n    at Specification (https://app.batchlabel.xyz/products/8f3c2d1a-4b5e:1:2)' +
      '\n    at Suspense' +
      '\n    at ErrorBoundary (https://app.batchlabel.xyz/assets/index.js:1:2)'
    );
    expect(names).toEqual(['Specification', 'Suspense', 'ErrorBoundary']);
    expect(JSON.stringify(names)).not.toContain('8f3c2d1a');
  });

  it('reads React\'s older `in` wording as well as `at`', () => {
    expect(scrubComponentStack('\n    in Materials (created by App)')).toEqual(['Materials']);
  });
});

describe('the route', () => {
  it('reports the pattern, never the product', () => {
    expect(
      scrubRoute('https://app.batchlabel.xyz/products/8f3c2d1a-4b5e-4c7d-9a1f-2e6b8c0d4f37')
    ).toBe('/products/:productId');
  });

  it('cuts the query without looking at it', () => {
    expect(scrubRoute('https://app.batchlabel.xyz/records/BL-2026-0417?supplier=Robertet')).toBe(
      '/records/:recordCode'
    );
  });

  it('prefers the literal route to the parameterised one that also matches', () => {
    // '/settings/billing' and '/settings/:tab' both fit a two-segment path.
    expect(scrubRoute('https://app.batchlabel.xyz/settings/billing')).toBe('/settings/billing');
    expect(scrubRoute('https://app.batchlabel.xyz/settings/identity')).toBe('/settings/:tab');
  });

  it('handles the deep one, which is the one with two ids in it', () => {
    expect(
      scrubRoute('https://app.batchlabel.xyz/products/8f3c2d1a/artefacts/label')
    ).toBe('/products/:productId/artefacts/:artefactType');
  });

  it('says nothing rather than guessing when it does not know the path', () => {
    const unknown = scrubRoute('https://app.batchlabel.xyz/exports/Winter-Fig-and-Cassis.pdf');
    expect(unknown).toBe('[unrecognised route]');
    expect(unknown).not.toContain('Winter');
  });

  it('copes with no URL at all', () => {
    expect(scrubRoute(null)).toBe('[no route]');
    expect(scrubRoute('/')).toBe('/');
  });
});

describe('the fields themselves', () => {
  it('redacts a source that is not one of the four we file under', () => {
    // The realistic accident: a call site that starts naming the thing it was
    // working on. `product-8f3c…` is a perfectly good slug.
    const scrubbed = scrubReport(
      { ...REALISTIC, source: 'product-8f3c2d1a-4b5e-4c7d' },
      null
    );
    expect(scrubbed.source).toBe('[redacted]');
  });

  it('redacts an error name that was assigned rather than declared', () => {
    // `error.name` is a writable property. An identifier-shaped check would send
    // "Lavender" without hesitating.
    expect(scrubReport({ ...REALISTIC, name: 'Lavender' }, null).name).toBe('[redacted]');
    expect(scrubReport({ ...REALISTIC, name: 'ScreenNotLoaded' }, null).name).toBe(
      'ScreenNotLoaded'
    );
  });

  it('drops a reference that is not the shape report-error.ts generates', () => {
    expect(scrubReport({ ...REALISTIC, reference: 'Winter Fig & Cassis' }, null).reference).toBe(
      '[redacted]'
    );
  });

  it('does not carry a field that was added to ErrorReport and not to the scrubber', () => {
    // THE PROPERTY THIS WHOLE FILE TURNS ON. Somebody adds `accountId`, or
    // `productId`, or `lastQuery` to ErrorReport for a good local reason and
    // never opens scrub-report.ts. Nothing new leaves. This test fails the day
    // scrubReport becomes a spread.
    const withExtra = {
      ...REALISTIC,
      accountId: 'acc_9f21c0',
      lastSavedProduct: 'Winter Fig & Cassis'
    } as ErrorReport;
    const sent = everythingSent(withExtra, null);
    expect(sent).not.toContain('acc_9f21c0');
    expect(sent).not.toContain('Winter Fig');
  });
});
