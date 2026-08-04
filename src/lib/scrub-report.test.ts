import { describe, expect, it } from 'vitest';
import {
  digest,
  loadedScriptPaths,
  NO_LOADED_SCRIPTS,
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

/**
 * The scripts this page fetched, which is the list `frames[].filename` is held to.
 *
 * In a browser this comes from `document.scripts`, the modulepreload links and
 * resource timing — see `scriptsThePageFetched` in error-sink.ts. Here it is
 * written out, because the property every test below turns on is that a path
 * NOT in this list is redacted however plausible it looks.
 */
const LOADED = loadedScriptPaths([
'https://app.batchlabel.xyz/assets/Specification-C6POi-On.js',
'https://app.batchlabel.xyz/assets/react-2p8jeSLm.js',
'https://app.batchlabel.xyz/assets/index-CQDYjleZ.js',
'https://app.batchlabel.xyz/assets/index-abc.js',
'https://app.batchlabel.xyz/assets/index-a1b2c3.js',
'https://app.batchlabel.xyz/assets/index.js',
'https://app.batchlabel.xyz/assets/x.js',
'https://app.batchlabel.xyz/assets/a.js',
'https://app.batchlabel.xyz/src/lib/derive.ts']);


/** Everything that left, as one string, so nothing can hide in a field nobody checked. */
function everythingSent(report: ErrorReport, href: string | null): string {
  return JSON.stringify(scrubReport(report, href, LOADED));
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
      'https://app.batchlabel.xyz/products/8f3c2d1a-4b5e-4c7d-9a1f-2e6b8c0d4f37',
      LOADED
    );
    expect(scrubbed.name).toBe('TypeError');
    expect(scrubbed.message).toMatch(/^Cannot read properties of undefined \(reading/);
    expect(scrubbed.route).toBe('/products/:productId');
    expect(scrubbed.components).toEqual(['Specification', 'ErrorBoundary']);
    // No `function` — see scrubStack. The position is what resolves to a symbol.
    expect(scrubbed.frames[0]).toEqual({
      filename: '/assets/Specification-C6POi-On.js',
      lineno: 12,
      colno: 3456
    });
  });

  it('keeps the reference, which is the only thing a customer can quote back', () => {
    expect(scrubReport(REALISTIC, null, LOADED).reference).toBe('K7QP-3MTX');
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
    // …and only the four we actually wrote. The shape check that used to stand
    // in for this echoed BOTH captures verbatim, which is up to eighty
    // characters of arbitrary text in the one message form that does that.
    const invented = scrubMessage(
      'useMidnightFigNoSevenCandle must be used inside RobertetRoseAbsoluteEurope'
    );
    expect(invented.text).not.toContain('MidnightFig');
    expect(invented.text).not.toContain('Robertet');
    expect(invented.text).toBe('use[redacted] must be used inside [redacted]');
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
    // `[redacted]` AND NOTHING ELSE. It used to be `[redacted:<32-bit digest of
    // the removed text>]`, which was a per-value guessing oracle — see the
    // dictionary attack below and the header of scrub-report.ts.
    expect(text).toBe("Cannot read properties of null (reading '[redacted]')");
    expect(text).not.toContain('lavender_dream');
    expect(text).not.toContain(digest('lavender_dream'));
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
    const frames = scrubStack(REALISTIC.stack, '', LOADED);
    expect(JSON.stringify(frames)).not.toContain('Firmenich');
    expect(frames).toHaveLength(2);
  });

  it("drops ScreenNotLoaded's `caused by` line, which is a second message", () => {
    const frames = scrubStack(
      'ScreenNotLoaded: The code for the Materials screen could not be downloaded.\n' +
      '    at loadMaterials (https://app.batchlabel.xyz/assets/index-CQDYjleZ.js:4:9)\n' +
      'caused by: TypeError: Failed to fetch Winter Fig & Cassis\n' +
      '    at fetchChunk (https://app.batchlabel.xyz/assets/index-CQDYjleZ.js:2:1)',
      '',
      LOADED
    );
    expect(JSON.stringify(frames)).not.toContain('Winter Fig');
    expect(frames.map((frame) => frame.lineno)).toEqual([4, 2]);
  });

  it('keeps the path and drops the origin', () => {
    const [frame] = scrubStack('    at go (https://app.batchlabel.xyz/assets/index-abc.js:1:2)', '', LOADED);
    expect(frame.filename).toBe('/assets/index-abc.js');
    expect(frame.filename).not.toContain('batchlabel');
  });

  it('redacts a frame that is the document, because the document is the route', () => {
    // A frame whose file is the page itself carries the page's path, and the
    // page's path is /products/<a customer's product>.
    const [frame] = scrubStack(
      '    at onClick (https://app.batchlabel.xyz/products/8f3c2d1a-4b5e-4c7d-9a1f-2e6b8c0d4f37:1:2)',
      '',
      LOADED
    );
    expect(frame.filename).toBe('[redacted]');
    expect(JSON.stringify(frame)).not.toContain('8f3c2d1a');
  });

  it('drops the query string on a script path rather than reading it', () => {
    const [frame] = scrubStack(
      '    at go (https://app.batchlabel.xyz/assets/index.js?product=Winter%20Fig:1:2)',
      '',
      LOADED
    );
    expect(frame.filename).not.toContain('Winter');
  });

  it('keeps a frame with no function at all, because it is still a position', () => {
    const [frame] = scrubStack('    at https://app.batchlabel.xyz/assets/index-abc.js:5:7', '', LOADED);
    expect(frame).toEqual({ filename: '/assets/index-abc.js', lineno: 5, colno: 7 });
  });

  it('reads Safari and Firefox frames too', () => {
    const [frame] = scrubStack('deriveHazards@https://app.batchlabel.xyz/assets/x.js:9:4', '', LOADED);
    expect(frame).toEqual({ filename: '/assets/x.js', lineno: 9, colno: 4 });
  });

  it('sends no function name, because V8 infers those from a maker\'s own data', () => {
    // THE FIELD IS GONE, AND THIS IS WHY. A batch code used as an object key
    // becomes a function name, in a real V8 stack, in a production-shaped chunk:
    //
    //   const handlers = { [batch.code]: function () { throw new Error('x') } }
    //
    // V8 writes `at Object.BL240417A (…)`. It survives minification — esbuild
    // mangles bindings, not property names — and no shape check can tell that
    // string from `deriveHazards`.
    const frames = scrubStack(
      'Error: recompute failed\n' +
      '    at Object.BL240417A (/assets/index-a1b2c3.js:2:53)\n' +
      '    at deriveHazards (/assets/index-a1b2c3.js:9:1)',
      '',
      LOADED
    );
    expect(JSON.stringify(frames)).not.toContain('BL240417A');
    expect(frames).toEqual([
    { filename: '/assets/index-a1b2c3.js', lineno: 2, colno: 53 },
    { filename: '/assets/index-a1b2c3.js', lineno: 9, colno: 1 }]
    );
    // What is left is exactly what Sentry resolves a symbol from.
    expect(Object.keys(frames[0])).toEqual(['filename', 'lineno', 'colno']);
  });

  it('will not let a message line masquerade as a frame', () => {
    // A message that happens to end in :line:col parses as a frame. When it
    // does, the file is not one of ours and the whole frame says so.
    const [frame] = scrubStack('    at Lavender (Ambrox 12.5%:3:1)', '', LOADED);
    expect(frame.filename).toBe('[redacted]');
    expect(JSON.stringify(frame)).not.toContain('Lavender');
  });

  it('wants a script extension as well as an allow-listed prefix', () => {
    // The prefix on its own said "anything, as long as it starts with /assets/",
    // and the way arbitrary text reaches here is a message line that parses.
    expect(
      scrubStack('    at go (/assets/WinterFigAndCassis-unlaunched:1:2)', '', LOADED)[0].filename
    ).toBe('[redacted]');
    expect(scrubStack('    at go (/assets/index-abc.js:1:2)', '', LOADED)[0].filename).toBe(
      '/assets/index-abc.js'
    );
    expect(scrubStack('    at go (/src/lib/derive.ts:1:2)', '', LOADED)[0].filename).toBe(
      '/src/lib/derive.ts'
    );
  });

  it('cuts the WHOLE header, so a multi-line message cannot smuggle a frame', () => {
    // THE SECOND COUNTEREXAMPLE TO A CLAIM THIS FILE MADE. The claim was that a
    // path only reaches scrubScriptPath from a stack and V8 writes those from
    // real script URLs. But `error.stack` BEGINS with the message, so every
    // line of a multi-line message is inside the stack — and one that parses as
    // a frame gets its path read, prefix, suffix and all.
    const message =
    'Failed to derive hazards\n' +
    '    at go (/assets/Winter-Fig-and-Cassis-unlaunched-2027.js:1:2)';
    const report: ErrorReport = {
      ...REALISTIC,
      message,
      stack: `Error: ${message}\n    at deriveHazards (/assets/index-abc.js:9:1)`,
      componentStack: undefined
    };

    expect(scrubReport(report, null, LOADED).frames).toEqual([
    { filename: '/assets/index-abc.js', lineno: 9, colno: 1 }]
    );
    expect(everythingSent(report, null)).not.toContain('Winter-Fig');
  });

  it('cuts nothing when there is no header, which is Safari and Firefox', () => {
    // Their stacks are frames from the first character, so `indexOf` finds
    // nothing and the frames survive. Cutting on a guess would lose all of them.
    expect(scrubStack('deriveHazards@/assets/x.js:9:4', 'Failed to fetch', LOADED)).toEqual([
    { filename: '/assets/x.js', lineno: 9, colno: 4 }]
    );
  });

  it('has a floor and a ceiling: no stack is empty, no stack is unbounded', () => {
    expect(scrubStack(undefined, '', LOADED)).toEqual([]);
    const huge = Array.from({ length: 200 }, (_, i) => `    at f${i} (/assets/a.js:1:2)`).join('\n');
    expect(scrubStack(huge, '', LOADED).length).toBeLessThanOrEqual(30);
  });
});

/**
 * THE THIRD FIELD OF THE SEND-BY-DEFAULT CLASS, AND THE FOUR ROUTES INTO IT.
 *
 * `frames[].function` was deleted, `extra.component_trail` was list-checked, and
 * `filename` was left on a shape check with a comment saying the demonstrated
 * route was closed. It was not, and it was not the only one. Every route below
 * was run against the shipped code before it was changed and every one of them
 * put a path-shaped, unlaunched product name through `filename`; the first put
 * it into a real serialised Sentry envelope with `in_app: true` on it.
 *
 * They are four different ways of arriving at ONE fault — the stack's header is
 * not always the message we hold — which is why the fix is not four patches. The
 * path is now held to the list of scripts the page actually fetched, so how the
 * text got into the stack stops mattering.
 */
describe('frames[].filename, and the four ways text reached it', () => {
  const SECRET = 'Winter-Fig-and-Cassis-unlaunched-2027';
  const asFrame = `    at go (/assets/${SECRET}.js:1:2)`;
  const real = '    at deriveHazards (/assets/index-abc.js:9:1)';

  it('1: a message that BEGINS WITH A NEWLINE, which defeated the header cut entirely', () => {
    // THE OFF-BY-ONE. The guard asked `stack.lastIndexOf('\n', at) !== -1`, and
    // lastIndexOf searches from `at` INCLUSIVE — so a message whose first
    // character is a newline found its own newline, concluded it was not the
    // header, and skipped the subtraction. This is a real V8 stack: `new
    // Error(message).stack` is `Error: ` + message + the frames.
    const message = `\n${asFrame}`;
    const error = new Error(message);
    expect(error.stack?.startsWith(`Error: ${message}`)).toBe(true);

    expect(JSON.stringify(scrubStack(error.stack, message, LOADED))).not.toContain(SECRET);
    // …and the cut itself now happens, rather than being carried by the list.
    expect(JSON.stringify(scrubStack(error.stack, message, loadedScriptPaths([
    `/assets/${SECRET}.js`]
    )))).not.toContain(SECRET);
  });

  it('2: a stack ADOPTED from another error, so the header is somebody else\'s message', () => {
    // Ordinary rethrow hygiene: keep the original stack, say something friendlier.
    const original = new Error(`\n${asFrame}`);
    const rethrown = new Error('Could not load the safety data sheet');
    rethrown.stack = original.stack;
    expect(JSON.stringify(scrubStack(rethrown.stack, rethrown.message, LOADED))).
    not.toContain(SECRET);
  });

  it('3: a report whose message is simply not the one in the header', () => {
    // describe() in report-error.ts falls back to String(error) for an Error with
    // an empty message, and an Error whose .stack was read before .message was
    // reassigned keeps the old header. Either way there is nothing to subtract.
    const report: ErrorReport = {
      ...REALISTIC,
      message: 'something else entirely',
      stack: `Error: \n${asFrame}\n${real}`,
      componentStack: undefined
    };
    expect(everythingSent(report, null)).not.toContain(SECRET);
    // The frame that IS one of ours still arrives, so this is not a test of
    // "redact everything and call it safe".
    expect(scrubReport(report, null, LOADED).frames).toContainEqual({
      filename: '/assets/index-abc.js',
      lineno: 9,
      colno: 1
    });
  });

  it('4: the nested cause, whose header is a second message nothing can subtract', () => {
    // ScreenNotLoaded appends `caused by: ${cause.stack}`. Those frames are the
    // only ones a mid-deploy chunk failure has, so they are still read — and the
    // cause's own message lines can no longer name a file.
    const frames = scrubStack(
      'ScreenNotLoaded: The code for the Materials screen could not be downloaded.\n' +
      '    at loadMaterials (/assets/index-abc.js:4:9)\n' +
      `caused by: TypeError: broke\n${asFrame}`,
      'The code for the Materials screen could not be downloaded.',
      LOADED
    );
    expect(JSON.stringify(frames)).not.toContain(SECRET);
    expect(frames.map((frame) => frame.lineno)).toEqual([4, 1]);
  });

  it('is the LIST that decides, not the shape: a perfect chunk name still fails', () => {
    // The whole point. `/assets/Winter-Fig-and-Cassis-unlaunched-2027.js` passes
    // every shape, prefix and suffix check this file has ever had. It is
    // redacted because the browser never fetched it.
    expect(scrubStack(asFrame, '', LOADED)[0].filename).toBe('[redacted]');
    expect(scrubStack(asFrame, '', loadedScriptPaths([`/assets/${SECRET}.js`]))[0].filename).
    toBe(`/assets/${SECRET}.js`);
  });

  it('redacts every filename when no list was passed, which is the default', () => {
    expect(scrubStack(real, '', NO_LOADED_SCRIPTS)[0].filename).toBe('[redacted]');
    // And the position survives, so the frame is still a position.
    expect(scrubStack(real, '', NO_LOADED_SCRIPTS)[0].lineno).toBe(9);
  });

  it('builds the list through the same gate a frame has to pass, so it can only narrow', () => {
    // A resource entry is any URL the page fetched, including a Supabase REST
    // call. Nothing enters the list that a frame would not have been allowed to
    // name anyway, which is why adding the list cannot widen what leaves.
    const paths = loadedScriptPaths([
    'https://xyz.supabase.co/rest/v1/products?name=eq.Winter%20Fig',
    'https://app.batchlabel.xyz/products/8f3c2d1a-4b5e-4c7d',
    'https://app.batchlabel.xyz/assets/hero-Winter-Fig.png',
    'https://app.batchlabel.xyz/assets/index-abc.js?t=1',
    'chrome-extension://abcdef/inject.js']);

    expect([...paths]).toEqual(['/assets/index-abc.js']);
    expect(JSON.stringify([...paths])).not.toContain('Winter');
    expect(JSON.stringify([...paths])).not.toContain('8f3c2d1a');
  });
});

/**
 * THE ATTACK THAT WORKED, RUN AGAINST THE FUNCTION THAT SHIPPED.
 *
 * `[redacted:xxxxxxxx]` carried a 32-bit FNV-1a of the text it replaced, and the
 * file said that made it "useless as a way to recover the text it stands for".
 * It did not. A tag is only safe when the candidate space approaches 2^32, and a
 * candle maker's catalogue is a few hundred names in a shape anyone can generate.
 * Both halves are exercised below with the real exported `digest`, so the claim
 * this file now makes is the one the code has.
 */
describe('the fingerprint, and what a guesser can do with it', () => {
  const FIRST = [
  'Midnight', 'Winter', 'Amber', 'Velvet', 'Smoked', 'Wild', 'Black', 'Golden',
  'Copper', 'Frosted', 'Burnt', 'Salted', 'Bitter', 'Sun', 'Moss', 'Storm',
  'Rose', 'Cedar', 'Fig', 'Oud', 'Vetiver', 'Neroli', 'Tonka', 'Cassis',
  'Pepper', 'Saffron', 'Iris', 'Linen', 'Driftwood', 'Ember', 'Hearth', 'Tide',
  'Harvest', 'Solstice', 'Equinox', 'Lantern', 'Orchard', 'Meadow', 'Thicket', 'Hollow',
  'Slate', 'Marble', 'Ink', 'Ash', 'Peat', 'Birch', 'Alder', 'Sorrel',
  'Quince', 'Damson', 'Sloe', 'Bergamot', 'Yuzu', 'Clove', 'Anise', 'Myrrh',
  'Labdanum', 'Benzoin', 'Ambrette', 'Immortelle'];

  const SECOND = [
  'Fig', 'Rose', 'Cassis', 'Cedarwood', 'Oud', 'Vetiver', 'Amber', 'Musk',
  'Jasmine', 'Tuberose', 'Lily', 'Violet', 'Peony', 'Magnolia', 'Osmanthus', 'Mimosa',
  'Sandalwood', 'Patchouli', 'Oakmoss', 'Labdanum', 'Tobacco', 'Leather', 'Suede', 'Cashmere',
  'Vanilla', 'Tonka', 'Praline', 'Honey', 'Fir', 'Pine', 'Spruce', 'Juniper',
  'Bergamot', 'Neroli', 'Petitgrain', 'Mandarin', 'Grapefruit', 'Lime', 'Basil', 'Mint',
  'Sage', 'Thyme', 'Lavender', 'Rosemary', 'Cardamom', 'Cinnamon', 'Nutmeg', 'Ginger',
  'Saffron', 'Pepper', 'Pimento', 'Coriander'];

  const SIZES = ['20cl', '30cl', '35cl', '50cl'];

  /**
   * 60 × 52 × N × 4 names in the shape a real maker uses.
   *
   * ONE GENERATOR WITH ONE PARAMETER, because the header of scrub-report.ts
   * quotes figures at four catalogue sizes and every one of them has to be
   * reproducible from this file rather than from a note about how somebody once
   * generated a list. N = 10 is 124,800 (what the suite runs, so it costs a
   * second rather than half a minute), 15 is 187,200, 25 is 312,000 and 32 is
   * 399,360.
   */
  function catalogueOf(numbers: number): string[] {
    const names: string[] = [];
    for (const first of FIRST) {
      for (const second of SECOND) {
        for (let number = 1; number <= numbers; number += 1) {
          for (const size of SIZES) {
            names.push(`${first} ${second} No. ${number} Candle ${size}`);
          }
        }
      }
    }
    return names;
  }

  const CATALOGUE = catalogueOf(10);

  /** What a V8 null-read puts on the wire when the property key is a product. */
  const messageFor = (name: string) =>
  `Cannot read properties of undefined (reading '${name}')`;

  /** The 32-bit FNV-1a this file used to ship, so the two can be compared here. */
  function digest32(value: string): string {
    let hash = 0x811c9dc5;
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
  }

  /** Brute-force the whole catalogue against one tag function, and score it. */
  function attack(tagOf: (name: string) => string) {
    const buckets = new Map<string, number>();
    for (const name of CATALOGUE) {
      const tag = tagOf(name);
      buckets.set(tag, (buckets.get(tag) ?? 0) + 1);
    }
    let unique = 0;
    let survivors = 0;
    for (const count of buckets.values()) {
      if (count === 1) unique += 1;
      // Every name in a bucket of n has n candidates surviving its own tag.
      survivors += count * count;
    }
    return {
      uniqueShare: unique / CATALOGUE.length,
      meanSurvivors: survivors / CATALOGUE.length
    };
  }

  /** What actually goes on the wire as the grouping key, for one product name. */
  const shippedDigestFor = (message: string) =>
  scrubReport(
    {
      reference: 'K7QP-3MTX',
      source: 'render',
      name: 'TypeError',
      message,
      at: '2026-08-04T09:15:22.481Z'
    },
    null,
    NO_LOADED_SCRIPTS
  ).messageDigest;

  it('is sixteen bits, and says so in four hex characters', () => {
    expect(digest('Failed to save batch BL-2026-0417')).toMatch(/^[0-9a-f]{4}$/);
    expect(Number.parseInt(digest('anything at all'), 16)).toBeLessThan(65536);
  });

  it('put a per-value tag next to every redaction, and no longer does', () => {
    // The tag was one oracle per redacted value, and it bought nothing: eventFor
    // fingerprints on [name, messageDigest], so Sentry never reads the exception
    // value for grouping and the inner tags were not part of triage at all.
    const secret = 'Midnight Fig No. 7 Candle 30cl';
    const sent = scrubMessage(messageFor(secret)).text;
    expect(sent).toBe("Cannot read properties of undefined (reading '[redacted]')");
    expect(sent).not.toMatch(/\[redacted:/);
    expect(sent).not.toContain(digest(secret));
    expect(sent).not.toContain(digest32(secret));
  });

  it('recovered a formulation percentage and a supplier from 32 bits', () => {
    // The two smallest spaces, and the ones this app most obviously holds. NOTE
    // that narrowing the hash would NOT have saved the percentage: 10,001
    // candidates against a 16-bit tag over the whole message still comes back
    // with one. That is why the fix below is about the INPUT, not the width.
    const percentages = Array.from({ length: 10_001 }, (_, i) => (i / 100).toFixed(2));
    const tag = digest32('12.43');
    expect(percentages.filter((p) => digest32(p) === tag)).toEqual(['12.43']);
    expect(digest32('Aromatica Fragrances Europe Ltd')).toBe('09ce5a4a');
  });

  it('gives a recognised message a tag that owes nothing to the value removed', () => {
    // THE FIX THAT MATTERS. `Cannot read properties of undefined (reading 'X')`
    // is V8's own fixed wording, so a guesser who has the template needs only to
    // enumerate X — which for a candle catalogue is a generated list. The digest
    // is now taken over the text we SEND, which is the template with X gone, so
    // all 124,800 names produce one identical tag and a brute force learns which
    // of them it was with probability 1 in 124,800.
    const before = attack((name) => digest32(messageFor(name)));
    const after = attack((name) => shippedDigestFor(messageFor(name)));

    expect(before.uniqueShare).toBeGreaterThan(0.999);
    expect(before.meanSurvivors).toBeLessThan(1.01);

    expect(after.uniqueShare).toBe(0);
    expect(after.meanSurvivors).toBe(CATALOGUE.length);
    // Same tag for a percentage, a supplier and a product: the template only.
    expect(shippedDigestFor(messageFor('12.43'))).toBe(
      shippedDigestFor(messageFor('Aromatica Fragrances Europe Ltd'))
    );
  });

  it('leaves several thousand candidates when only the original will do', () => {
    // An UNRECOGNISED message is the one case where the original text has to be
    // digested — it is the only thing separating two unknown faults. So this is
    // where the width earns its keep, on the same 124,800 names.
    const asFreeText = (name: string) => `Failed to derive hazards for ${name}`;
    expect(scrubMessage(asFreeText('x')).recognised).toBe(false);

    const before = attack((name) => digest32(asFreeText(name)));
    const after = attack((name) => shippedDigestFor(asFreeText(name)));

    expect(before.uniqueShare).toBeGreaterThan(0.999);
    expect(before.meanSurvivors).toBeLessThan(1.01);
    // 16 bits: a tag no longer names a product, and most names share theirs.
    expect(after.uniqueShare).toBeLessThan(0.25);
    // PINNED TO THE MEASURED VALUE, NOT TO "MORE THAN 2". The header of
    // scrub-report.ts quotes 2.91 here, and it used to quote 4 at 400,000 —
    // which is not a possible number, because mean survivors under a B-bucket
    // digest is ~N/B + 1 and 400,000/65,536 is already 6.10. A loose assertion
    // is what let an impossible figure sit next to a correct one for three
    // rounds. 124,800/65,536 + 1 = 2.904.
    expect(after.meanSurvivors).toBeCloseTo(2.906, 2);
    expect(after.meanSurvivors).toBeCloseTo(CATALOGUE.length / 65_536 + 1, 1);
  });

  it('names one candidate from a bounded list when the message was NOT recognised', () => {
    // THE RESIDUAL THE HEADER NOW STATES, MEASURED HERE SO IT STAYS CHECKABLE.
    // The header used to close by saying a 16-bit match "would still leave
    // several thousand other messages that produce it". That is true of the
    // space of all strings and false of the space anybody enumerates — and a
    // formulation percentage is a space of 10,001. This is what a guesser who
    // holds the template and the candidate list actually gets.
    const asFreeText = (value: string) => `Failed to derive hazards for ${value}`;
    expect(scrubMessage(asFreeText('x')).recognised).toBe(false);

    const percentages = Array.from({ length: 10_001 }, (_, i) => (i / 100).toFixed(2));
    const tag = shippedDigestFor(asFreeText('12.43'));
    expect(percentages.filter((p) => shippedDigestFor(asFreeText(p)) === tag)).toEqual(['12.43']);

    const suppliers = Array.from({ length: 4096 }, (_, i) => `Supplier ${i} Fragrances Europe Ltd`);
    const secret = suppliers[1234];
    const supplierTag = shippedDigestFor(asFreeText(secret));
    expect(suppliers.filter((s) => shippedDigestFor(asFreeText(s)) === supplierTag)).toEqual([
    secret]
    );
  });

  it('composes: two unrecognised messages about one secret are two oracles', () => {
    // NOBODY HAD CONSIDERED THIS, so it is written down rather than assumed
    // away. Two DIFFERENT unrecognised messages carrying the SAME value are two
    // independent 16-bit fingerprints of it, and intersecting the candidate sets
    // is 32 bits. The header says why it is not defended against — a per-report
    // salt would break the grouping the digest exists for, and narrowing only
    // changes the arithmetic.
    const asFreeText = (value: string) => `Failed to derive hazards for ${value}`;
    const andAlso = (value: string) => `Could not price the batch for ${value}`;
    expect(scrubMessage(andAlso('x')).recognised).toBe(false);

    const buckets = new Map<string, string[]>();
    for (const name of CATALOGUE) {
      const tag = shippedDigestFor(asFreeText(name));
      const bucket = buckets.get(tag);
      if (bucket) bucket.push(name);else buckets.set(tag, [name]);
    }
    // A secret whose FIRST oracle leaves a crowd, so the second one is visibly
    // what does the work rather than the arithmetic being a coincidence.
    const afterOneOracle = [...buckets.values()].find((names) => names.length >= 5) as string[];
    expect(afterOneOracle.length).toBeGreaterThanOrEqual(5);

    const secret = afterOneOracle[0];
    const secondTag = shippedDigestFor(andAlso(secret));
    const afterTwo = afterOneOracle.filter((n) => shippedDigestFor(andAlso(n)) === secondTag);
    expect(afterTwo).toEqual([secret]);
  });

  it('still groups: same message, same fingerprint; different message, different bucket', () => {
    // The other half of the bargain, and the reason the digest exists at all.
    // 16 bits is 65,536 buckets, which is the separation being traded for.
    expect(digest('Save failed for BL-2026-0417')).toBe(digest('Save failed for BL-2026-0417'));
    expect(digest('Save failed for BL-2026-0417')).not.toBe(digest('Save failed for BL-2026-0418'));
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

  it('redacts a name the runtime inferred from a maker\'s data', () => {
    // THE FIELD THAT INHERITED THE `function` LEAK. React labels a component
    // from `type.displayName || type.name`, V8 infers `type.name` from a
    // computed key, and a batch code used as a key is therefore a component
    // name. A shape check sent it — it went out on the real Sentry wire —
    // because `BL240417A` is a perfectly good identifier and so is
    // `deriveHazards`. The list in lib/app-component-names.ts is the only thing
    // that can tell them apart, and the trail keeps its depth either way.
    const batch = { code: 'BL240417A' };
    const inferred = { [batch.code]: function () {/* a screen keyed by batch */} };
    expect(inferred[batch.code].name).toBe('BL240417A');

    expect(
      scrubComponentStack(
        `\n    at ${inferred[batch.code].name}` +
        '\n    at Suspense' +
        '\n    at ErrorBoundary'
      )
    ).toEqual(['[redacted]', 'Suspense', 'ErrorBoundary']);
  });

  it('redacts the other shapes a maker\'s data arrives in', () => {
    for (const name of ['WinterFigAndCassis', 'Robertet', 'Firmenich', 'BL2026_0417']) {
      expect(scrubComponentStack(`    at ${name}`)).toEqual(['[redacted]']);
    }
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
      null,
      LOADED
    );
    expect(scrubbed.source).toBe('[redacted]');
  });

  it('redacts an error name that was assigned rather than declared', () => {
    // `error.name` is a writable property. An identifier-shaped check would send
    // "Lavender" without hesitating.
    expect(scrubReport({ ...REALISTIC, name: 'Lavender' }, null, LOADED).name).toBe('[redacted]');
    expect(scrubReport({ ...REALISTIC, name: 'ScreenNotLoaded' }, null, LOADED).name).toBe(
      'ScreenNotLoaded'
    );
  });

  it('drops a reference that is not the shape report-error.ts generates', () => {
    expect(
      scrubReport({ ...REALISTIC, reference: 'Winter Fig & Cassis' }, null, LOADED).reference
    ).toBe('[redacted]');
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
