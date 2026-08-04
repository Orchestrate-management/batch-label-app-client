import { afterEach, describe, expect, it, vi } from 'vitest';
import { createElement, type FC } from 'react';
import { render } from '@testing-library/react';
import type { BrowserOptions } from '@sentry/react';
import * as realSentry from '@sentry/react';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { eventFor, installErrorSink, type SentryLike } from './error-sink';
import { reportError, setErrorSink, type ErrorReport } from './report-error';
import { loadedScriptPaths, scrubReport } from './scrub-report';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * THE THING THAT IS SUPPOSED TO FIND THE FOURTH FIELD
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Three rounds of this integration have each ended the same way: one field of
 * one class was found to be sending a customer's data, it was fixed, and the
 * class was left open. `frames[].function` first. Then `extra.component_trail`,
 * by the same mechanism, in the field next door — and that one was not a
 * demonstration, a real batch code went out on the real wire. Then
 * `frames[].filename`, which the round before had written down as closed.
 *
 * The class is: A STRING THE RUNTIME WROTE, HELD TO A SHAPE RATHER THAN A LIST,
 * WHERE THE RUNTIME READ A CUSTOMER'S VALUE IN ORDER TO WRITE IT. Every instance
 * was found by hand, after it shipped, by somebody who happened to look.
 *
 * This file is the attempt to stop doing that. It does not test a function. It
 * takes ONE canary token, pushes it down every channel an ORDINARY line of this
 * app's code has into an error report, and asserts the token is absent from the
 * whole serialised payload. A field that starts carrying a customer's value
 * fails here wherever that field is and whatever it is called — including a
 * field nobody has written yet, as long as the channel that feeds it is below.
 *
 * ITS COMPANION IS THE WIRE KEY-SET PIN in error-sink.test.ts. Between them:
 * nothing NEW can appear on the wire without the pin failing, and nothing
 * EXISTING can start carrying a value without this failing. Neither replaces the
 * rule in lib/scrub-report.ts — a reader still has to ask who wrote the string —
 * but the rule was written down once and then not applied to the very next
 * field, which is what these two are for.
 *
 * ADDING A CHANNEL IS THE MAINTENANCE. If you find a new way for a value to
 * reach a report, it goes in the table below, whether or not it leaks today.
 */

/**
 * ONE TOKEN, SHAPED SO IT FITS EVERY CHANNEL.
 *
 * It has to be a legal JavaScript identifier (so it can be a computed key, a
 * component name, an error name), a legal path segment (so it can be a script
 * name and a route segment) and a plausible product name at once — because the
 * whole argument of lib/scrub-report.ts is that nothing can tell a maker's
 * unlaunched product from one of our own identifiers.
 */
const CANARY = 'Kanarie7Unlaunched';

/**
 * The forms the token can arrive in on the wire, so an encoding is not an escape.
 *
 * `JSON.stringify` of the payload would render a `\u`-escaped copy differently
 * from the raw one, and a URL-encoded copy differently again.
 */
const CANARY_FORMS = [
CANARY,
encodeURIComponent(CANARY),
CANARY.toLowerCase(),
JSON.stringify(CANARY).slice(1, -1)];


function expectAbsent(payload: string, channel: string): void {
  for (const form of CANARY_FORMS) {
    expect(
      payload.includes(form),
      `${channel}: the canary reached the wire as "${form}".\n` +
      'A field is carrying a value the runtime read off a customer\'s product. ' +
      'Find which one, then read "THE RULE INSIDE THE RULE" in lib/scrub-report.ts: ' +
      'a string the runtime wrote is held to a LIST or it does not go. ' +
      'Do not fix the channel — fix the field.\n' +
      `payload: ${payload.slice(0, 1200)}`
    ).toBe(false);
  }
}

/** A page that has fetched exactly the two chunks a real one would have. */
const LOADED = loadedScriptPaths([
'https://app.batchlabel.xyz/assets/index-abc.js',
'https://app.batchlabel.xyz/assets/Specification-def.js']);


const BASE: ErrorReport = {
  reference: 'K7QP-3MTX',
  source: 'render',
  name: 'TypeError',
  message: 'Failed to fetch',
  at: '2026-08-04T09:15:22.481Z'
};

/**
 * Every channel, as the line of ordinary application code that opens it.
 *
 * `href` is separate because the URL is not part of the report — it is read off
 * `window` by the sink — and it is the channel that carries a product id.
 */
const CHANNELS: Array<{
  channel: string;
  code: string;
  report: ErrorReport;
  href?: string;
}> = [
{
  channel: 'the message, free text',
  code: 'throw new Error(`Failed to derive hazards for ${product.name}`)',
  report: { ...BASE, message: `Failed to derive hazards for ${CANARY}` }
},
{
  channel: 'the message, inside a template the browser wrote',
  code: 'product[key].rows — V8 puts the key in the message',
  report: { ...BASE, message: `Cannot read properties of undefined (reading '${CANARY}')` }
},
{
  channel: 'the message, inside one of OUR templates',
  code: 'lazyScreen(product.name, …) — ScreenNotLoaded names the screen',
  report: {
    ...BASE,
    name: 'ScreenNotLoaded',
    message: `The code for the ${CANARY} screen could not be downloaded.`
  }
},
{
  channel: 'the message, inside the provider-hook sentence',
  code: 'a hook named after a product',
  report: { ...BASE, message: `use${CANARY} must be used inside ${CANARY}Provider` }
},
{
  channel: 'the message, as a React invariant tail',
  code: 'React appends ?args[]=<what was on the screen>',
  report: {
    ...BASE,
    message: `Minified React error #418; visit https://react.dev/errors/418?args[]=${CANARY}`
  }
},
{
  channel: 'the message, as a whole thrown object',
  code: 'throw product — describe() does JSON.stringify on a non-Error',
  report: {
    ...BASE,
    name: 'NonError',
    message: JSON.stringify({ id: 'p_1', name: CANARY, fraction: 0.085 })
  }
},
{
  channel: 'the error name, which is a writable property',
  code: 'error.name = product.name',
  report: { ...BASE, name: CANARY }
},
{
  channel: 'the source, which is free text from the call site',
  code: 'reportError(error, `product-${product.name}`)',
  report: { ...BASE, source: `product-${CANARY}` }
},
{
  channel: 'the reference, if a caller ever builds its own',
  code: 'reportError with a reference taken from a record',
  report: { ...BASE, reference: CANARY }
},
{
  channel: 'the timestamp field, if a caller ever puts text in it',
  code: 'at: record.label',
  report: { ...BASE, at: CANARY }
},
{
  channel: 'the URL, which is where a product id lives',
  code: 'the maker was looking at /products/<id>',
  report: BASE,
  href: `https://app.batchlabel.xyz/products/${CANARY}`
},
{
  channel: 'the URL query, which can carry anything',
  code: 'a screen that put a filter in the query string',
  report: BASE,
  href: `https://app.batchlabel.xyz/products?supplier=${CANARY}`
},
{
  channel: 'a stack function name inferred from a computed key',
  code: 'const handlers = { [batch.code]: fn }',
  report: {
    ...BASE,
    stack:
    `TypeError: Failed to fetch\n    at Object.${CANARY} (/assets/index-abc.js:2:53)`
  }
},
{
  channel: 'a stack filename, via a message that BEGINS with a newline',
  code: 'throw new Error(`\\n${somethingTheMakerTyped}`)',
  report: {
    ...BASE,
    message: `\n    at go (/assets/${CANARY}.js:1:2)`,
    stack:
    `TypeError: \n    at go (/assets/${CANARY}.js:1:2)\n` +
    '    at deriveHazards (/assets/index-abc.js:9:1)'
  }
},
{
  channel: 'a stack filename, via a stack adopted from another error',
  code: 'rethrown.stack = original.stack',
  report: {
    ...BASE,
    message: 'Could not load the safety data sheet',
    stack:
    `TypeError: something else\n    at go (/assets/${CANARY}.js:1:2)\n` +
    '    at deriveHazards (/assets/index-abc.js:9:1)'
  }
},
{
  channel: 'a stack filename, via a nested cause',
  code: 'ScreenNotLoaded appends `caused by: ${cause.stack}`',
  report: {
    ...BASE,
    name: 'ScreenNotLoaded',
    message: 'The code for the Materials screen could not be downloaded.',
    stack:
    'ScreenNotLoaded: The code for the Materials screen could not be downloaded.\n' +
    '    at loadMaterials (/assets/index-abc.js:4:9)\n' +
    `caused by: TypeError: broke\n    at go (/assets/${CANARY}.js:2:1)`
  }
},
{
  channel: 'a stack filename, via the document rather than a script',
  code: 'an inline handler on the page itself',
  report: {
    ...BASE,
    stack: `TypeError: Failed to fetch\n    at onClick (https://app.batchlabel.xyz/products/${CANARY}:1:2)`
  }
},
{
  channel: 'a component name inferred from a computed key',
  code: 'const screens = { [batch.code]: () => <Sheet /> }',
  report: { ...BASE, componentStack: `\n    at ${CANARY}\n    at ErrorBoundary` }
},
{
  channel: 'a component name from displayName',
  code: 'Sheet.displayName = product.name',
  report: { ...BASE, componentStack: `\n    at ${CANARY}\n    at Suspense` }
},
{
  channel: 'a component stack line carrying the document URL',
  code: 'React writes the page URL on the trail line in some builds',
  report: {
    ...BASE,
    componentStack: `\n    at Specification (https://app.batchlabel.xyz/products/${CANARY}:1:2)`
  }
},
{
  channel: 'a field added to ErrorReport by somebody working on something else',
  code: 'report.lastSavedProduct = product.name',
  report: { ...BASE, lastSavedProduct: CANARY } as ErrorReport
}];


describe('the canary: one token, every channel, the whole payload', () => {
  it.each(CHANNELS)('$channel', ({ channel, report, href }) => {
    const scrubbed = scrubReport(report, href ?? null, LOADED);
    expectAbsent(JSON.stringify(scrubbed), `${channel} (scrubbed report)`);
    expectAbsent(JSON.stringify(eventFor(scrubbed)), `${channel} (Sentry event)`);
  });

  it('is a canary and not a tautology: the same token DOES survive unscrubbed', () => {
    // Every assertion above is an absence, and an absence passes for free if the
    // token never got in. This is the control: the same reports, not scrubbed,
    // carry the canary — so the table is exercising real channels.
    const carried = CHANNELS.filter((entry) =>
    JSON.stringify(entry.report).includes(CANARY) || (entry.href ?? '').includes(CANARY)
    );
    expect(carried).toHaveLength(CHANNELS.length);
  });
});

/* ────────────────────────────────────────────── the canary that is not text */

/**
 * A SECOND CANARY, BECAUSE THE FIRST ONE CANNOT SEE NUMBERS.
 *
 * `CANARY` is a string in four string encodings, so every assertion above is a
 * substring search. That made the harness structurally blind to any channel
 * carrying a number — and this app's most sensitive value, a formulation
 * percentage, IS a number. The field that proved it was `lineno`/`colno`:
 *
 *     at compute (/assets/Midnight-Fig-No7.js:12:43)
 *
 * on a stack whose header is not our message arrived as `{filename:
 * '[redacted]', lineno: 12, colno: 43}` — the path correctly refused, and 12.43
 * on the wire beside it in two pieces.
 *
 * The digits below are deliberately implausible as real source positions, so a
 * hit is a leak rather than a coincidence. A realistic percentage would be a
 * worse test: `12` and `43` occur in honest stacks constantly, and an assertion
 * that cannot distinguish a leak from a true positive is one somebody deletes.
 */
const NUMERIC_CANARY = { lineno: 9182736, colno: 4736251 };

/**
 * The routes where `withoutHeader` cannot fire, which is where the numbers came
 * from. The cut needs the stack's header to be the message we hold; each of
 * these breaks that in a different, ordinary way.
 */
const NUMERIC_CHANNELS: Array<{ channel: string; code: string; report: ErrorReport }> = [
{
  channel: 'an adopted stack — the header is somebody else\'s message',
  code: 'error.stack = otherError.stack',
  report: {
    ...BASE,
    message: 'a completely different message',
    stack:
    `SomeOtherError: unrelated header\n` +
    `    at compute (/assets/${CANARY}.js:${NUMERIC_CANARY.lineno}:${NUMERIC_CANARY.colno})`
  }
},
{
  channel: 'a stack with no header at all (Safari, Firefox)',
  code: 'the browser simply writes frames from the first character',
  report: {
    ...BASE,
    stack: `compute@/assets/${CANARY}.js:${NUMERIC_CANARY.lineno}:${NUMERIC_CANARY.colno}`
  }
},
{
  channel: 'an empty message, so there is nothing to cut',
  code: 'throw new Error()',
  report: {
    ...BASE,
    message: '',
    stack: `    at compute (/assets/${CANARY}.js:${NUMERIC_CANARY.lineno}:${NUMERIC_CANARY.colno})`
  }
}];


function expectNumbersAbsent(payload: string, channel: string): void {
  for (const [name, value] of Object.entries(NUMERIC_CANARY)) {
    expect(
      payload.includes(String(value)),
      `${channel}: the numeric canary reached the wire as ${name}=${value}.\n` +
      'A NUMBER read off a string somebody else wrote is on the payload. A formulation ' +
      'percentage is a number, so this is not a lesser leak than a string one.\n' +
      'Read "THE RULE INSIDE THE RULE" in lib/scrub-report.ts: the rule asks who wrote ' +
      'the string, and a position is written by whoever wrote the path beside it. ' +
      'Do not fix the channel — fix the field.\n' +
      `payload: ${payload.slice(0, 1200)}`
    ).toBe(false);
  }
}

describe('the canary that is not text: a number is a channel too', () => {
  it.each(NUMERIC_CHANNELS)('$channel', ({ channel, report }) => {
    const scrubbed = scrubReport(report, null, LOADED);
    expectNumbersAbsent(JSON.stringify(scrubbed), `${channel} (scrubbed report)`);
    expectNumbersAbsent(JSON.stringify(eventFor(scrubbed)), `${channel} (Sentry event)`);
  });

  it('is a canary and not a tautology: the numbers DO survive unscrubbed', () => {
    const carried = NUMERIC_CHANNELS.filter((entry) =>
    JSON.stringify(entry.report).includes(String(NUMERIC_CANARY.lineno))
    );
    expect(carried).toHaveLength(NUMERIC_CHANNELS.length);
  });

  it('keeps the position on a path that survived the list check', () => {
    // The counterpart the absence assertions cannot make: dropping every
    // position would pass all of them and take Sentry's source-map resolution
    // with it. A frame the page really fetched must still carry its position.
    const real = '/assets/Specification-def.js';
    const scrubbed = scrubReport(
      {
        ...BASE,
        stack: `TypeError: Failed to fetch\n    at go (https://app.batchlabel.xyz${real}:99:7)`
      },
      null,
      LOADED
    );
    expect(scrubbed.frames).toContainEqual({ filename: real, lineno: 99, colno: 7 });
  });
});

/* ─────────────────────────────────────────── and now with the real thing */

const UNROUTABLE_DSN = 'https://0000000000000000000000000000000@o0.ingest.sentry.invalid/0';

/**
 * THE TWO CHANNELS THAT CANNOT BE FAKED WITH A LITERAL.
 *
 * The component trail and the frame function name are written by React and V8
 * from a value at runtime, so a hand-written `componentStack` above proves the
 * scrubber's behaviour but not that the runtime does what the comments say it
 * does. These two make V8 infer the name and React read it, through the real
 * ErrorBoundary and the real @sentry/react, and read the bytes the SDK
 * serialised into the envelope.
 *
 * NOTHING IS SENT ANYWHERE. `transport` is ours, and the DSN is under the
 * reserved `.invalid` TLD, which by RFC 2606 can never resolve.
 */
describe('the canary, through the real runtime and the real SDK', () => {
  const envelopes: unknown[] = [];

  function realSentryWithStubTransport(): SentryLike {
    return {
      init: (options: BrowserOptions) =>
      realSentry.init({
        ...options,
        transport: () => ({
          send: (envelope: unknown) => {
            envelopes.push(envelope);
            return Promise.resolve({});
          },
          flush: () => Promise.resolve(true)
        })
      } as BrowserOptions),
      captureEvent: (event) =>
      realSentry.captureEvent(event as Parameters<typeof realSentry.captureEvent>[0])
    };
  }

  afterEach(async () => {
    envelopes.length = 0;
    setErrorSink(null);
    await realSentry.close(0);
    vi.restoreAllMocks();
  });

  it('a component V8 named from a product, rendered and reported for real', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await installErrorSink(UNROUTABLE_DSN, () => Promise.resolve(realSentryWithStubTransport()));

    const product = { name: CANARY };
    const screens: Record<string, () => never> = {
      [product.name]: function () {
        throw new Error('Failed to fetch');
      }
    };
    // V8 did this, not the test.
    expect(screens[product.name].name).toBe(CANARY);

    render(createElement(ErrorBoundary, null, createElement(screens[product.name] as unknown as FC)));
    await realSentry.flush(2000);

    expect(envelopes).toHaveLength(1);
    expectAbsent(JSON.stringify(envelopes), 'a component named by V8 from a product');
  });

  it('a multi-line message whose lines parse as frames, reported for real', async () => {
    // THE ROUTE THAT SHIPPED. `error.stack` begins `${name}: ${message}`, so a
    // message beginning with a newline put `/assets/<product>.js` on the wire
    // through `filename`, with `in_app: true` on it.
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await installErrorSink(UNROUTABLE_DSN, () => Promise.resolve(realSentryWithStubTransport()));

    reportError(new Error(`\n    at go (/assets/${CANARY}.js:1:2)`), 'render');
    await realSentry.flush(2000);

    expect(envelopes).toHaveLength(1);
    expectAbsent(JSON.stringify(envelopes), 'a multi-line message read as frames');
  });

  it('a whole product object thrown, reported for real', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await installErrorSink(UNROUTABLE_DSN, () => Promise.resolve(realSentryWithStubTransport()));

    // eslint-disable-next-line @typescript-eslint/no-throw-literal
    reportError({ id: 'p_1', name: CANARY, supplier: 'Robertet', fraction: 0.085 }, 'render');
    await realSentry.flush(2000);

    expect(envelopes).toHaveLength(1);
    expectAbsent(JSON.stringify(envelopes), 'a thrown product object');
    expect(JSON.stringify(envelopes)).not.toContain('Robertet');
  });
});
