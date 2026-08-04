import { afterEach, describe, expect, it, vi } from 'vitest';
import { createElement, type FC } from 'react';
import { render } from '@testing-library/react';
import type { BrowserOptions } from '@sentry/react';
import * as realSentry from '@sentry/react';
import { ErrorBoundary } from '../components/ErrorBoundary';
import {
  eventFor,
  gateOutgoingEvent,
  installErrorSink,
  keepOnlyAllowedEventFields,
  looksLikeDsn,
  scriptsThePageFetched,
  sentryOptionsFor,
  type EveryKeyRequired,
  type SentryLike } from
'./error-sink';
import { hasErrorSink, reportError, setErrorSink } from './report-error';
import { loadedScriptPaths, NO_LOADED_SCRIPTS, scrubReport } from './scrub-report';

/**
 * Two questions, and the first one is the one Rhys cannot answer from a Sentry
 * dashboard: does this app do NOTHING when there is no DSN?
 *
 * The integration had to be complete and inert at once — written, reviewed and
 * merged before anybody here had a DSN — so "inert" is not a temporary state to
 * be tidied up later, it is the state every developer machine and every preview
 * build runs in. If it were only nearly inert, the way you would find out is a
 * report from somebody's laptop landing in a project that does not exist.
 *
 * The second is what leaves when there IS one, asserted on the actual object
 * handed to `captureEvent` rather than on an intention.
 */

/**
 * NOT A REAL DSN, AND IT CANNOT BECOME ONE BY ACCIDENT. `.invalid` is reserved by
 * RFC 2606 and never resolves, so no test in this file can post anywhere even if a
 * stand-in were one day swapped for the real client. The `.de.` is kept because the
 * region-carrying test below is about exactly that segment. There is no real DSN in
 * this repo.
 */
const DSN = 'https://a1b2c3d4e5f6@o4507000000000000.ingest.de.sentry.invalid/4508000000000000';

/**
 * The scripts the page fetched, which is the list `frames[].filename` is held to.
 *
 * In the browser `scriptsThePageFetched()` reads this off `document.scripts`, the
 * modulepreload links and resource timing. Here it is written out so that the
 * assertions below are about a frame whose script the page really did load —
 * see lib/scrub-report.ts, LOADED SCRIPTS.
 */
const LOADED = loadedScriptPaths([
'https://app.batchlabel.xyz/assets/Specification-C6.js',
'https://app.batchlabel.xyz/assets/react-2p8.js',
'https://app.batchlabel.xyz/assets/index-a1b2c3.js']);


/** A stand-in for @sentry/react that records rather than posts. */
function recordingSentry() {
  const events: Record<string, unknown>[] = [];
  const inits: Record<string, any>[] = [];
  const sentry: SentryLike = {
    init: (options) => {
      inits.push(options);
      return { name: 'BrowserClient' };
    },
    captureEvent: (event) => {
      events.push(event as Record<string, unknown>);
      return 'id';
    }
  };
  return { sentry, events, inits };
}

afterEach(() => {
  // A sink left installed by one test is handed the next test's reports.
  setErrorSink(null);
  vi.restoreAllMocks();
});

describe('with no DSN', () => {
  it('installs nothing, so the crash screen goes on telling the truth', async () => {
    // hasErrorSink() drives one sentence of customer copy: "This has not reached
    // us automatically". On a build with no DSN that sentence is true and it has
    // to keep being printed.
    const { sentry, inits } = recordingSentry();
    const installed = await installErrorSink('', () => Promise.resolve(sentry));
    expect(installed).toBe(false);
    expect(hasErrorSink()).toBe(false);
    expect(inits).toHaveLength(0);
  });

  it('does not even fetch the vendor', async () => {
    // The chunk is not downloaded, so a maker on a build with no DSN pays
    // nothing for a feature that is not switched on.
    const load = vi.fn();
    await installErrorSink('', load as unknown as () => Promise<SentryLike>);
    expect(load).not.toHaveBeenCalled();
  });

  it('refuses a DSN that is not one, rather than half-installing', async () => {
    // The failure this prevents is silent and customer-facing: a placeholder in
    // Vercel installs a sink, hasErrorSink() goes true, the crash screen stops
    // saying "this has not reached us" — and nothing has.
    for (const notADsn of ['your-dsn-here', 'https://sentry.io/4508', 'https://key@host', '']) {
      expect(looksLikeDsn(notADsn)).toBe(false);
      const { sentry, inits } = recordingSentry();
      expect(await installErrorSink(notADsn, () => Promise.resolve(sentry))).toBe(false);
      expect(hasErrorSink()).toBe(false);
      expect(inits).toHaveLength(0);
    }
  });

  it('accepts a real one, including an EU project', () => {
    expect(looksLikeDsn(DSN)).toBe(true);
    expect(looksLikeDsn('https://k@o1.ingest.us.sentry.invalid/2')).toBe(true);
  });
});

describe('with a DSN', () => {
  it('installs the sink, and the crash screen stops saying nobody was told', async () => {
    const { sentry } = recordingSentry();
    expect(await installErrorSink(DSN, () => Promise.resolve(sentry))).toBe(true);
    expect(hasErrorSink()).toBe(true);
  });

  it('passes the DSN through untouched, so the region travels with it', async () => {
    // An EU project's DSN points at ingest.de.sentry.io. The SDK builds its
    // ingest URL out of the DSN's own host, so there is nothing else to set —
    // and nothing that could disagree with it later.
    const { sentry, inits } = recordingSentry();
    await installErrorSink(DSN, () => Promise.resolve(sentry));
    expect(inits[0].dsn).toBe(DSN);
    expect(inits[0].tunnel).toBeUndefined();
    expect(JSON.stringify(sentryOptionsFor(DSN))).not.toContain('/api/');
  });

  it('reports that reach the seam arrive scrubbed', async () => {
    // End to end through the real reportError, so this is the seam doing it and
    // not a test calling the scrubber itself.
    const { sentry, events } = recordingSentry();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await installErrorSink(DSN, () => Promise.resolve(sentry));

    reportError(new Error('Failed to derive hazards for Winter Fig (Robertet) at 8.5%'), 'render');

    expect(events).toHaveLength(1);
    const sent = JSON.stringify(events[0]);
    expect(sent).not.toContain('Winter Fig');
    expect(sent).not.toContain('Robertet');
    expect(sent).not.toContain('8.5%');
  });

  it('never lets a sink failure become the customer\'s problem', async () => {
    // reportError wraps the sink in a try/catch and this proves the contract
    // still holds with a real one installed: a vendor that throws inside a crash
    // handler must not take the crash screen with it.
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const sentry: SentryLike = {
      init: () => ({}),
      captureEvent: () => {
        throw new Error('transport is down');
      }
    };
    await installErrorSink(DSN, () => Promise.resolve(sentry));
    expect(() => reportError(new Error('nope'), 'render')).not.toThrow();
  });

  it('installs nothing when the chunk never arrives', async () => {
    // The mid-deploy case, applied to the telemetry chunk itself.
    expect(await installErrorSink(DSN, () => Promise.reject(new Error('Failed to fetch')))).toBe(
      false
    );
    expect(hasErrorSink()).toBe(false);
  });

  it('installs nothing when the SDK declines to start', async () => {
    // `init` returns undefined when the SDK has decided not to run. A sink over
    // a disabled client would make the crash screen's copy a lie.
    const sentry: SentryLike = { init: () => undefined, captureEvent: () => 'id' };
    expect(await installErrorSink(DSN, () => Promise.resolve(sentry))).toBe(false);
    expect(hasErrorSink()).toBe(false);
  });
});

describe('what Sentry is allowed to collect on its own account', () => {
  const options = sentryOptionsFor(DSN);

  it('has no integrations at all, default or otherwise', () => {
    // The browser SDK ships breadcrumbs (console, clicks, fetch, XHR, history —
    // a transcript of the session), global handlers, an HttpContext integration
    // that attaches the page URL, culture context and session tracking. None of
    // that has been through the scrubber, so none of it is installed.
    expect(options.defaultIntegrations).toBe(false);
    expect(options.integrations).toEqual([]);
  });

  it('collects no breadcrumbs even if an integration tried', () => {
    expect(options.maxBreadcrumbs).toBe(0);
    expect((options.beforeBreadcrumb as () => unknown)()).toBeNull();
  });

  it('has every data-collection category switched off', () => {
    expect(options.dataCollection).toEqual({
      userInfo: false,
      cookies: false,
      httpHeaders: { request: false, response: false },
      httpBodies: [],
      urlQueryParams: false,
      graphQL: { document: false, variables: false },
      genAI: { inputs: false, outputs: false },
      databaseQueryData: false,
      stackFrameVariables: false,
      frameContextLines: 0
    });
  });

  it('runs no tracing and no session replay', () => {
    // Replay records the DOM. On this app that is a maker's formulation, on video.
    expect(options.tracesSampleRate).toBe(0);
    expect(options.replaysSessionSampleRate).toBe(0);
    expect(options.replaysOnErrorSampleRate).toBe(0);
  });

  it('does not let the SDK rewrite the app\'s own error messages', () => {
    // enhanceFetchErrorMessages defaults to 'always' and appends the request
    // hostname to a real Error object — one a maker's screen may go on to show.
    expect(options.enhanceFetchErrorMessages).toBe(false);
  });

  it('requires every category to any depth, and refuses a bag it cannot exhaust', () => {
    // A COMPILE-TIME ASSERTION IN A RUNTIME TEST, because there is no other
    // place to put it: the property is that `npm run typecheck` FAILS, and
    // `@ts-expect-error` is the only way to assert that a line does not compile.
    // Delete the type's third arm and this file stops typechecking.
    //
    // The claim being checked is the one the comment on EveryKeyRequired makes.
    // It used to overstate itself: it said `{}` fails for a bag at any depth,
    // and that was true only of a bag with KNOWN keys. A category shaped
    // `Record<string, boolean>` has no known keys, so the mapped type produced
    // the same index signature and `{}` satisfied it — while @sentry/core's
    // resolver reads an unset sub-key as TRUE. It now maps to a marker no object
    // literal satisfies, so that shape fails loudly instead of silently.

    // @ts-expect-error `{}` is not every key of a nested bag with known keys.
    const nested: EveryKeyRequired<{websocket?: {frames?: boolean;};}> = { websocket: {} };
    // @ts-expect-error an index signature cannot be exhausted by a type, so it must not pass.
    const indexed: EveryKeyRequired<{websocket?: Record<string, boolean>;}> = { websocket: {} };
    expect(nested).toBeDefined();
    expect(indexed).toBeDefined();

    // …and the shape that CAN be exhausted still compiles, so this is not a type
    // that refuses everything.
    const written: EveryKeyRequired<{websocket?: {frames?: boolean;};}> = {
      websocket: { frames: false }
    };
    expect(written.websocket.frames).toBe(false);
  });

  it('cannot be switched back on by a caller, at any depth', () => {
    // THE REGRESSION THIS EXISTS FOR. `dataCollection` was a module-level object
    // handed out by reference, and the negative control further down this file
    // did `delete options.dataCollection.userInfo` on it — permanently turning
    // the maker's IP address back on for every later caller in the worker, and
    // making the "infer_ip is never" assertion depend on which test ran first.
    // The test guarding the most important privacy property in this repo was the
    // thing breaking it.
    const handed = sentryOptionsFor(DSN) as Record<string, any>;
    expect(() => delete handed.dataCollection.userInfo).toThrow(TypeError);
    expect(() => {
      handed.dataCollection.userInfo = true;
    }).toThrow(TypeError);
    // Frozen all the way down, not just at the top.
    expect(() => {
      handed.dataCollection.httpHeaders.request = true;
    }).toThrow(TypeError);
    expect(() => handed.dataCollection.httpBodies.push('incomingRequest')).toThrow(TypeError);

    // And a later caller gets the configuration this file wrote.
    const later = sentryOptionsFor(DSN).dataCollection as Record<string, unknown>;
    expect(later.userInfo).toBe(false);
    expect(later.httpHeaders).toEqual({ request: false, response: false });
  });
});

describe('beforeSend, the last gate before the network', () => {
  const beforeSend = gateOutgoingEvent as (event: any) => any;

  it('is what the SDK is actually given, not a second copy of the rule', () => {
    // A gate the client never calls is decoration. Everything below tests the
    // real one because of this line.
    expect(sentryOptionsFor(DSN).beforeSend).toBe(gateOutgoingEvent);
  });

  it('drops an event that did not come through the scrubber', () => {
    // The realistic mistake, a year from now: somebody imports Sentry and calls
    // captureException directly, with a raw message. It sends nothing at all,
    // which is the right way for that to fail.
    expect(
      beforeSend({
        exception: { values: [{ type: 'Error', value: 'Winter Fig (Robertet) at 8.5%' }] }
      })
    ).toBeNull();
  });

  it('drops an event whose mark was FORGED, not just one that has none', () => {
    // The gate advertises itself as the thing that makes a stray
    // `Sentry.captureException` harmless. While the mark was the literal 'yes',
    // one `Sentry.setTag('scrubbed', 'yes')` on a scope anywhere in the app
    // undid that for every event the scope touched — a raw exception message and
    // absolute file paths, straight onto the wire. The mark is now minted in
    // error-sink.ts at module load and is not exported, so it cannot be written
    // down anywhere else.
    const forged = {
      tags: { scrubbed: 'yes' },
      exception: {
        values: [
        {
          type: 'Error',
          value: 'Winter Fig & Cassis (Robertet) at 8.5%',
          stacktrace: { frames: [{ filename: '/Users/rhys/batchlabel/src/lib/derive.ts' }] }
        }]

      }
    };
    expect(beforeSend(forged)).toBeNull();
  });

  it('says on the wire that an event was scrubbed, without saying what the mark is', () => {
    // The issue list still carries the fact. It does not carry the value, which
    // would let the next event forge it.
    const kept = beforeSend(
      eventFor(
        scrubReport(
          {
            reference: 'K7QP-3MTX',
            source: 'render',
            name: 'TypeError',
            message: 'Failed to fetch',
            at: '2026-08-04T09:15:22.481Z'
          },
          null,
          NO_LOADED_SCRIPTS
        )
      )
    );
    expect(kept.tags.scrubbed).toBe('yes');
  });

  it('strips anything the SDK attached that we did not choose', () => {
    // The integrations that add these are all off, so today this removes
    // nothing. It exists so that turning one back on, or an SDK upgrade adding
    // a field, cannot post something new without a diff to this list.
    const kept: Record<string, unknown> = keepOnlyAllowedEventFields({
      tags: { scrubbed: 'yes' },
      request: { url: 'https://app.batchlabel.xyz/products/8f3c2d1a-4b5e' },
      user: { email: 'maker@example.com', ip_address: '81.2.3.4' },
      breadcrumbs: [{ message: 'clicked Export label for Winter Fig' }],
      contexts: { browser: { name: 'Safari' } },
      server_name: 'a-laptop'
    });
    expect(kept.request).toBeUndefined();
    expect(kept.user).toBeUndefined();
    expect(kept.breadcrumbs).toBeUndefined();
    expect(kept.contexts).toBeUndefined();
    expect(kept.server_name).toBeUndefined();
    expect(JSON.stringify(kept)).not.toContain('8f3c2d1a');
    expect(JSON.stringify(kept)).not.toContain('maker@example.com');
  });

  it('strips a tag or an extra somebody set on a scope from anywhere', () => {
    // `tags` and `extra` are the two bags any file can add to with
    // Sentry.setTag/setExtra, and whatever is in them is merged into every
    // event this app sends without passing the scrubber. Named keys only.
    const kept: Record<string, any> = keepOnlyAllowedEventFields({
      tags: { scrubbed: 'yes', reference: 'K7QP-3MTX', product: 'Winter Fig & Cassis' },
      extra: { message_digest: '1a2b3c4d', sds: 'Robertet, Rose Absolute, 0.8%' }
    });
    expect(kept.tags.reference).toBe('K7QP-3MTX');
    expect(kept.tags.product).toBeUndefined();
    expect(kept.extra.sds).toBeUndefined();
    expect(JSON.stringify(kept)).not.toContain('Robertet');
  });

  it('lets a scrubbed event through with what it needs to be readable', () => {
    const event = eventFor(
      scrubReport(
        {
          reference: 'K7QP-3MTX',
          source: 'render',
          name: 'TypeError',
          message: 'Failed to fetch',
          at: '2026-08-04T09:15:22.481Z'
        },
        'https://app.batchlabel.xyz/products/8f3c2d1a-4b5e',
        NO_LOADED_SCRIPTS
      )
    );
    const kept = beforeSend(event);
    expect(kept).not.toBeNull();
    expect(kept.exception).toBeDefined();
    expect(kept.fingerprint).toEqual(['TypeError', expect.any(String)]);
  });
});

describe('the event a scrubbed report becomes', () => {
  const event = eventFor(
    scrubReport(
      {
        reference: 'K7QP-3MTX',
        source: 'screen-render',
        name: 'TypeError',
        message: "Cannot read properties of undefined (reading 'Firmenich Ambrox')",
        stack:
        "TypeError: Cannot read properties of undefined (reading 'Firmenich Ambrox')\n" +
        '    at deriveHazards (https://app.batchlabel.xyz/assets/Specification-C6.js:12:3456)\n' +
        '    at renderWithHooks (https://app.batchlabel.xyz/assets/react-2p8.js:1:2)',
        componentStack: '\n    at Specification (https://app.batchlabel.xyz/assets/S.js:1:2)',
        at: '2026-08-04T09:15:22.481Z'
      },
      'https://app.batchlabel.xyz/products/8f3c2d1a-4b5e-4c7d-9a1f-2e6b8c0d4f37',
      LOADED
    )
  );

  it('carries no part of the maker\'s product, in any field', () => {
    const sent = JSON.stringify(event);
    expect(sent).not.toContain('Firmenich');
    expect(sent).not.toContain('Ambrox');
    expect(sent).not.toContain('8f3c2d1a');
    expect(sent).not.toContain('batchlabel.xyz');
  });

  it('is still a usable issue: a type, a route, a reference and a trail', () => {
    const tags = event.tags as Record<string, string>;
    expect(tags.route).toBe('/products/:productId');
    expect(tags.reference).toBe('K7QP-3MTX');
    expect(tags.source).toBe('screen-render');
    expect(tags.message_recognised).toBe('yes');
    expect((event.extra as {component_trail: string[];}).component_trail).toEqual([
    'Specification']
    );
  });

  it('orders the frames the way Sentry renders them, oldest first', () => {
    const frames = (
    event.exception as {values: [{stacktrace: {frames: {filename: string;lineno: number;}[];};}];}).
    values[0].stacktrace.frames;
    expect(frames.map((frame) => frame.lineno)).toEqual([1, 12]);
    expect(frames.map((frame) => frame.filename)).toEqual([
    '/assets/react-2p8.js',
    '/assets/Specification-C6.js']
    );
  });

  it('sends no function name on any frame', () => {
    // The field is gone from ScrubbedFrame because V8 infers function names from
    // data — `{ [batch.code]: fn }` becomes `at Object.BL240417A (…)`, and no
    // shape check can tell that from `deriveHazards`. filename + lineno + colno
    // is what Sentry's source-map resolution needs to name the real symbol.
    const withABatchCode = eventFor(
      scrubReport(
        {
          reference: 'K7QP-3MTX',
          source: 'render',
          name: 'TypeError',
          message: 'Failed to fetch',
          stack:
          'TypeError: recompute failed\n' +
          '    at Object.BL240417A (https://app.batchlabel.xyz/assets/index-a1b2c3.js:2:53)',
          at: '2026-08-04T09:15:22.481Z'
        },
        null,
        LOADED
      )
    );
    expect(JSON.stringify(withABatchCode)).not.toContain('BL240417A');
    const frames = (
    withABatchCode.exception as {values: [{stacktrace: {frames: object[];};}];}).
    values[0].stacktrace.frames;
    expect(Object.keys(frames[0])).toEqual(['filename', 'lineno', 'colno', 'in_app']);
  });

  it('groups an unrecognised message by its digest rather than by its text', () => {
    // Otherwise every occurrence of one unknown fault becomes its own issue,
    // because every value the message was assembled from differs.
    const one = eventFor(
      scrubReport(
        {
          reference: 'AAAA-BBBB',
          source: 'render',
          name: 'Error',
          message: 'Save failed for BL-2026-0417',
          at: '2026-08-04T09:15:22.481Z'
        },
        null,
        NO_LOADED_SCRIPTS
      )
    );
    const two = eventFor(
      scrubReport(
        {
          reference: 'CCCC-DDDD',
          source: 'render',
          name: 'Error',
          message: 'Save failed for BL-2026-0417',
          at: '2026-08-04T10:00:00.000Z'
        },
        null,
        NO_LOADED_SCRIPTS
      )
    );
    expect(one.fingerprint).toEqual(two.fingerprint);
    expect(JSON.stringify(one)).not.toContain('BL-2026-0417');
  });
});

/* ─────────────────────────────────────────── and now with the real thing */

/**
 * EVERY TEST ABOVE THIS LINE TALKS TO A STAND-IN, WHICH IS THE ONE WAY THIS FILE
 * COULD BE GREEN AND WRONG.
 *
 * A stand-in accepts whatever options it is handed. It cannot tell us that
 * `defaultIntegrations` is a real option rather than a plausible-looking typo
 * that leaves every default integration running, and it cannot tell us that the
 * real client actually CALLS `beforeSend` before it puts an event on the wire.
 * Those are the two claims the whole privacy argument rests on, so they are made
 * against `@sentry/react` itself, with the transport replaced by one that keeps
 * the envelope instead of posting it.
 *
 * NOTHING IS SENT ANYWHERE BY THIS TEST. `transport` is a function of ours, so
 * the SDK never constructs its fetch transport, and the DSN below is under the
 * reserved `.invalid` TLD, which by RFC 2606 can never resolve. There is no real
 * DSN in this repo and none of this needs one.
 */
const UNROUTABLE_DSN = 'https://0000000000000000000000000000000@o0.ingest.sentry.invalid/0';

describe('against the real @sentry/react, with the wire replaced', () => {
  const envelopes: unknown[] = [];

  /** The event as it was serialised into the envelope, not as we built it. */
  function eventOnTheWire(index = 0): Record<string, any> {
    const envelope = envelopes[index] as [unknown, Array<[unknown, Record<string, any>]>];
    return envelope?.[1]?.[0]?.[1];
  }

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
    await realSentry.close(0);
  });

  it('starts: the real client accepts every option this file sets', async () => {
    // `installErrorSink` only returns true if `init` handed back a client, so
    // this is the SDK saying it understood the configuration and is running.
    expect(
      await installErrorSink(UNROUTABLE_DSN, () => Promise.resolve(realSentryWithStubTransport()))
    ).toBe(true);
    expect(hasErrorSink()).toBe(true);
  });

  it('puts a scrubbed report on the wire and nothing of the product in it', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await installErrorSink(UNROUTABLE_DSN, () => Promise.resolve(realSentryWithStubTransport()));

    const report = reportError(
      new Error("Cannot read properties of undefined (reading 'Winter Fig 8.5% Robertet')"),
      'render'
    );
    await realSentry.flush(2000);

    const wire = JSON.stringify(envelopes);
    // It really went out — otherwise the assertions below pass on an empty array.
    expect(envelopes).toHaveLength(1);
    expect(wire).toContain(report.reference);
    expect(wire).not.toContain('Winter Fig');
    expect(wire).not.toContain('Robertet');
    expect(wire).not.toContain('8.5%');
    // HttpContext is the integration that attaches the page URL, and jsdom is
    // serving this suite from https://app.batchlabel.xyz/. With the defaults off
    // it is not installed, and `beforeSend` would drop the field even if it were.
    expect(wire).not.toContain('batchlabel.xyz');
  });

  it('tells Sentry never to take the maker\'s IP address off the request', async () => {
    // ASSERTED ON THE TRANSMITTED BYTES, AND IT HAS TO BE. `infer_ip` is not a
    // field of the event we build — `createEventEnvelope` calls
    // `_enhanceEventWithSdkInfo` AFTER `beforeSend` has returned, so
    // `keepOnlyAllowedEventFields` never sees it and `scrubReport` is irrelevant
    // to it. `dataCollection.userInfo: false` in sentryOptionsFor is the only
    // thing that produces "never" here, and "never" is what stops Relay reading
    // the end user's IP off the request and storing it on every event.
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await installErrorSink(UNROUTABLE_DSN, () => Promise.resolve(realSentryWithStubTransport()));
    reportError(new Error('Failed to fetch'), 'render');
    await realSentry.flush(2000);

    expect(envelopes).toHaveLength(1);
    const event = eventOnTheWire();
    expect(event.sdk.settings.infer_ip).toBe('never');
    expect(event.user).toBeUndefined();
    expect(JSON.stringify(envelopes)).not.toContain('ip_address');
  });

  it('would say "auto" if one key of dataCollection went missing', async () => {
    // THE NEGATIVE CONTROL, so the assertion above is known to have teeth. It is
    // also the upgrade case: @sentry/core's `resolveDataCollectionOptions`
    // switches its baseline to an all-TRUE DEFAULTS object the moment
    // `dataCollection` is non-null, so an unset category is an ON category —
    // `dataCollection: {}` produces "auto" too, despite the SDK's own type doc
    // saying `userInfo` defaults to false. That is why the object in
    // error-sink.ts is typed to require every category to any depth: a category
    // added in an SDK minor, or a bag added inside one, fails the typecheck
    // instead of switching itself on.
    //
    // ON ITS OWN COPY, AND THAT IS NOT A DETAIL. This test used to do
    // `delete options.dataCollection.userInfo` on the object `sentryOptionsFor`
    // returns — which was the shared module-level one. It permanently switched
    // the maker's IP address back on for every later caller in the worker and
    // made the assertion directly above pass or fail on test ordering: the test
    // proving the IP is off was the thing turning it on. The object is frozen
    // now, so that line throws rather than poisoning, and a variant is built
    // here.
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const shipped = sentryOptionsFor(UNROUTABLE_DSN);
    const withoutUserInfo: Record<string, unknown> = {
      ...(shipped.dataCollection as Record<string, unknown>)
    };
    delete withoutUserInfo.userInfo;
    const options = { ...shipped, dataCollection: withoutUserInfo } as Record<string, any>;
    await installErrorSink(UNROUTABLE_DSN, () =>
    Promise.resolve({
      init: () =>
      realSentry.init({
        ...(options as BrowserOptions),
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
    })
    );
    reportError(new Error('Failed to fetch'), 'render');
    await realSentry.flush(2000);

    expect(envelopes).toHaveLength(1);
    expect(eventOnTheWire().sdk.settings.infer_ip).toBe('auto');

    // And the shipped configuration is untouched by the copy above, which is
    // the property that makes the "never" assertion order-independent.
    expect((sentryOptionsFor(UNROUTABLE_DSN).dataCollection as Record<string, unknown>).userInfo).
    toBe(false);
  });

  it('drops the fields the SDK attaches on its own, which is not nothing', async () => {
    // The comment on EVENT_FIELDS_THAT_MAY_LEAVE used to say that with every
    // integration off "this list removes nothing". Read out of a real prepared
    // event it removes three keys: `contexts` (a trace id, a span id and the
    // React version), `sdkProcessingMetadata` (a dynamic sampling context
    // carrying the DSN's public key) and `breadcrumbs`. None of that is a
    // maker's data — and all of it arrived without being asked for, which is
    // exactly what the list is for.
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await installErrorSink(UNROUTABLE_DSN, () => Promise.resolve(realSentryWithStubTransport()));
    reportError(new Error('Failed to fetch'), 'render');
    await realSentry.flush(2000);

    const event = eventOnTheWire();
    expect(event.contexts).toBeUndefined();
    expect(event.sdkProcessingMetadata).toBeUndefined();
    expect(event.breadcrumbs).toBeUndefined();
    expect(JSON.stringify(envelopes)).not.toContain('trace_id');
    // Exactly what is left, so a key the SDK starts adding shows up here.
    expect(Object.keys(event).sort()).toEqual([
    'environment',
    'event_id',
    'exception',
    'extra',
    'fingerprint',
    'level',
    'platform',
    'sdk',
    'tags',
    'timestamp']
    );
  });

  it('puts no data-derived component name on the wire', async () => {
    // THE SEND-BY-DEFAULT FIELD THAT MOVED RATHER THAN DYING, AND THIS IS THE
    // RENDER THAT PROVED IT. `frames[].function` was deleted because V8 infers
    // function names from data. `extra.component_trail` inherited the leak one
    // level up the tree: React reads a component's label from
    // `type.displayName || type.name`, and a batch code used as a computed key
    // IS `type.name`. Before lib/app-component-names.ts existed, this exact
    // render put `["BL240417A","ErrorBoundary"]` into a real envelope.
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await installErrorSink(UNROUTABLE_DSN, () => Promise.resolve(realSentryWithStubTransport()));

    const batch = { code: 'BL240417A' };
    const screens: Record<string, () => never> = {
      [batch.code]: function () {
        throw new Error('Failed to fetch');
      }
    };
    // V8 did it, not the test: the component is called after the batch code.
    expect(screens[batch.code].name).toBe('BL240417A');

    render(
      createElement(ErrorBoundary, null, createElement(screens[batch.code] as unknown as FC))
    );
    await realSentry.flush(2000);

    expect(envelopes).toHaveLength(1);
    expect(JSON.stringify(envelopes)).not.toContain('BL240417A');
    // The trail keeps its depth and its shape; it loses the one label it could
    // not vouch for. `ErrorBoundary` is on the list, so it still reads.
    expect(eventOnTheWire().extra.component_trail).toContain('[redacted]');
    expect(eventOnTheWire().extra.component_trail).toContain('ErrorBoundary');
  });

  it('carries the scrubber\'s mark as a fact and never as its value', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await installErrorSink(UNROUTABLE_DSN, () => Promise.resolve(realSentryWithStubTransport()));
    reportError(new Error('Failed to fetch'), 'render');
    await realSentry.flush(2000);

    expect(eventOnTheWire().tags.scrubbed).toBe('yes');
  });

  /**
   * THE PIN. NOTHING ELSE IN EITHER REPO FAILS WHEN A FIELD IS ADDED TO WHAT WE
   * SEND, AND THE PRIVACY NOTICE HAS NOW BEEN MADE FALSE TWICE BY EXACTLY THAT.
   *
   * `keepOnlyAllowedEventFields` is an allow-list, but an allow-list only stops
   * a field somebody ELSE adds. It does nothing about a field WE add: one line
   * in `eventFor` and the notice in the www repo — which names, field by field,
   * what leaves a maker's machine — is quietly wrong, and nobody finds out.
   *
   * So this asserts the exact set of key paths in the transmitted bytes, taken
   * off the envelope the SDK serialised rather than off the object we built, so
   * that an SDK upgrade adding `sdk.settings.something` fails here too. Array
   * indices collapse to `[]` so a second frame is not a new key; VALUES are not
   * asserted, only the shape, so this does not redden on a different reference.
   */
  function keyPathsOf(value: unknown, prefix: string): string[] {
    if (Array.isArray(value)) {
      if (value.length === 0) return [`${prefix}[]`];
      return [...new Set(value.flatMap((entry) => keyPathsOf(entry, `${prefix}[]`)))];
    }
    if (value !== null && typeof value === 'object') {
      return Object.keys(value as object).
      sort().
      flatMap((key) => keyPathsOf((value as Record<string, unknown>)[key], `${prefix}.${key}`));
    }
    return [prefix];
  }

  /**
   * Every key path in the transmitted envelope, and nothing else may appear.
   *
   * ADDING A LINE HERE IS THE POINT — it is meant to be a diff somebody has to
   * write on purpose, next to the one in the www repo.
   */
  const WIRE_KEY_SET = [
  'envelope.event_id',
  'envelope.sdk.name',
  'envelope.sdk.version',
  'envelope.sent_at',
  'item.type',
  'event.environment',
  'event.event_id',
  'event.exception.values[].stacktrace.frames[].colno',
  'event.exception.values[].stacktrace.frames[].filename',
  'event.exception.values[].stacktrace.frames[].in_app',
  'event.exception.values[].stacktrace.frames[].lineno',
  'event.exception.values[].type',
  'event.exception.values[].value',
  'event.extra.component_trail[]',
  'event.extra.message_digest',
  'event.fingerprint[]',
  'event.level',
  'event.platform',
  'event.sdk.integrations[]',
  'event.sdk.name',
  'event.sdk.packages[].name',
  'event.sdk.packages[].version',
  'event.sdk.settings.infer_ip',
  'event.sdk.version',
  'event.tags.message_recognised',
  'event.tags.reference',
  'event.tags.route',
  'event.tags.scrubbed',
  'event.tags.source',
  'event.timestamp'];


  const WHY_THIS_FAILED =
  'The set of fields that leaves a maker\'s machine has changed. If you are ' +
  'adding a field, the privacy notice in the www repo (batch-label-www, the ' +
  'section that names what an error report contains) names what we send, and it ' +
  'has to change too — in the same change, not afterwards. If you are REMOVING ' +
  'one, the notice still has to change. Update this list last, and only once the ' +
  'notice says the same thing.';

  it('pins the exact set of keys that reaches the wire', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    // A real <script> in the document, so the frames carry a real filename and
    // the frame key paths are exercised rather than being absent by accident.
    const script = document.createElement('script');
    script.src = 'https://app.batchlabel.xyz/assets/index-abc.js';
    document.head.appendChild(script);
    await installErrorSink(UNROUTABLE_DSN, () => Promise.resolve(realSentryWithStubTransport()));

    reportError(
      Object.assign(new Error('Failed to fetch'), {
        stack: 'Error: Failed to fetch\n    at go (/assets/index-abc.js:1:2)'
      }),
      'render',
      { componentStack: '\n    at ErrorBoundary' }
    );
    await realSentry.flush(2000);
    document.head.removeChild(script);

    expect(envelopes).toHaveLength(1);
    const envelope = envelopes[0] as [object, Array<[object, object]>];
    const paths = [
    ...keyPathsOf(envelope[0], 'envelope'),
    ...keyPathsOf(envelope[1][0][0], 'item'),
    ...keyPathsOf(envelope[1][0][1], 'event')].
    sort();

    expect(paths, WHY_THIS_FAILED).toEqual([...WIRE_KEY_SET].sort());
    // The frame really did carry a path, so `filename` above is a live key and
    // not one that happened to be `[redacted]` in a stack with no frames.
    const wire = eventOnTheWire();
    expect(wire.exception.values[0].stacktrace.frames[0].filename).toBe('/assets/index-abc.js');
  });

  it('prunes the exception subtree too, which the gate used to pass through whole', () => {
    // `tags` and `extra` were pruned per key and `exception` was not, so the
    // comment claiming an upgrade "cannot post something new without a diff to
    // this line" was false for the subtree the SDK is likeliest to add to.
    // `vars` is a real Sentry frame field: the locals at the throw site, which
    // on this app is a formulation.
    const kept: Record<string, any> = keepOnlyAllowedEventFields({
      tags: { scrubbed: 'yes' },
      exception: {
        values: [
        {
          type: 'TypeError',
          value: '[unrecognised:1a2b]',
          mechanism: { type: 'onerror', handled: false },
          module: 'Winter Fig & Cassis',
          stacktrace: {
            frames: [
            {
              filename: '/assets/index-abc.js',
              lineno: 1,
              colno: 2,
              in_app: true,
              vars: { supplier: 'Robertet', fraction: 0.085 },
              pre_context: ['const fraction = 0.085 // Robertet']
            }]

          }
        }]

      }
    });
    const values = kept.exception.values[0];
    expect(Object.keys(values).sort()).toEqual(['stacktrace', 'type', 'value']);
    expect(Object.keys(values.stacktrace.frames[0]).sort()).toEqual([
    'colno', 'filename', 'in_app', 'lineno']);
    expect(JSON.stringify(kept)).not.toContain('Robertet');
    expect(JSON.stringify(kept)).not.toContain('Winter Fig');
    expect(JSON.stringify(kept)).not.toContain('0.085');
  });

  it('reads the page\'s own scripts, so a real frame keeps its filename', async () => {
    // The other half of `scriptsThePageFetched`: it has to actually FIND the
    // page's scripts, or the field is quietly lost on every report. jsdom serves
    // this suite from https://app.batchlabel.xyz/, so a <script src> and a
    // modulepreload <link> here are the same two sources index.html has.
    const script = document.createElement('script');
    script.src = 'https://app.batchlabel.xyz/assets/index-mAj7fPxR.js';
    const link = document.createElement('link');
    link.rel = 'modulepreload';
    link.href = 'https://app.batchlabel.xyz/assets/react-2p8jeSLm.js';
    document.head.append(script, link);
    try {
      const found = scriptsThePageFetched();
      expect(found.has('/assets/index-mAj7fPxR.js')).toBe(true);
      expect(found.has('/assets/react-2p8jeSLm.js')).toBe(true);
      // The favicon links in index.html are fetched too and are not scripts.
      expect(found.has('/brand/batchlabel-favicon.svg')).toBe(false);
    } finally {
      document.head.removeChild(script);
      document.head.removeChild(link);
    }
  });

  it('sends nothing at all for a capture that did not come through the seam', async () => {
    // THE ONE THAT MATTERS MOST IN A YEAR. Somebody imports Sentry directly and
    // calls captureException with a raw Error — the ordinary, reasonable thing
    // to do, and the thing that would post a customer's formulation values. The
    // real pipeline, not a stand-in, is what drops it.
    await installErrorSink(UNROUTABLE_DSN, () => Promise.resolve(realSentryWithStubTransport()));

    realSentry.captureException(new Error('Winter Fig (Robertet) at 8.5%'));
    await realSentry.flush(2000);

    expect(envelopes).toHaveLength(0);
  });
});
