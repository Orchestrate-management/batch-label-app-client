import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { listenForUncaughtErrors } from './global-errors';
import { setErrorSink, type ErrorReport } from './report-error';

/**
 * The failures an error boundary structurally cannot see, and the one thing that makes
 * catching them safe.
 *
 * Most of what this app does is `await supabase…`, and a rejection nobody expected is caught by
 * no boundary anywhere — it used to leave no console line, no reference and no trace. These
 * two listeners close that. The awkward half is that they watch ground a boundary also
 * watches, and in a development build the overlap is exact: React re-dispatches an error it has
 * already handed to a boundary, so `window.onerror` sees it first, and twice. One fault filed
 * three times is a worse log than no log, and on a paid vendor it is a bill.
 */

let stop: (() => void) | null = null;
let reports: ErrorReport[] = [];

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  reports = [];
  setErrorSink((report) => reports.push(report));
  stop = listenForUncaughtErrors(window);
});

afterEach(() => {
  stop?.();
  stop = null;
  setErrorSink(null);
  vi.restoreAllMocks();
});

/** jsdom has no PromiseRejectionEvent, so the shape the listener reads is built by hand. */
function rejectWith(reason: unknown) {
  const event = new Event('unhandledrejection');
  Object.assign(event, { reason, promise: Promise.resolve() });
  window.dispatchEvent(event);
}

/**
 * The backstop yields a macrotask before filing, so that a boundary handling the same crash
 * gets to describe it first. Every assertion about what was reported has to wait that out.
 */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('a promise nobody handled', () => {
  it('is reported, where before it went nowhere at all', async () => {
    rejectWith(new Error('the save never came back'));
    await settle();
    expect(reports).toHaveLength(1);
    expect(reports[0].message).toBe('the save never came back');
    expect(reports[0].source).toBe('unhandled-rejection');
  });

  it('is reported even when the reason is not an Error', async () => {
    // `reject('nope')` and `reject({ code: 'PGRST301' })` are both common and neither carries
    // a stack. A funnel that only understands Errors drops exactly the ones that are hardest
    // to reproduce.
    rejectWith({ code: 'PGRST301' });
    await settle();
    expect(reports).toHaveLength(1);
    expect(reports[0].message).toContain('PGRST301');
  });
});

describe('an error nothing caught', () => {
  it('is reported, with the thrown value', async () => {
    const error = new Error('the derivation blew up in a click handler');
    window.dispatchEvent(new ErrorEvent('error', { error, message: error.message }));
    await settle();
    expect(reports).toHaveLength(1);
    expect(reports[0].message).toBe('the derivation blew up in a click handler');
    expect(reports[0].source).toBe('window-error');
  });

  it('is still reported when the browser withholds the error, as it does cross-origin', async () => {
    // A blocked third-party script arrives as a bare "Script error." with no stack. Entry 7
    // is right that this is noise and right that the filter belongs in the sink — today the
    // destination is the maker's own console, where a line costs nothing and a dropped line
    // costs a developer the only clue they had. See entry 6.
    window.dispatchEvent(
      new ErrorEvent('error', { message: 'Script error.', filename: 'https://cdn.example/x.js', lineno: 1 })
    );
    await settle();
    expect(reports).toHaveLength(1);
    expect(reports[0].message).toContain('Script error.');
    expect(reports[0].message).toContain('https://cdn.example/x.js');
  });

  it('ignores an image that failed to load', async () => {
    // Resource `error` events carry neither a value nor a message and are not a fault in this
    // app's code. Reporting them would fill the funnel with somebody's ad blocker.
    window.dispatchEvent(new ErrorEvent('error', {}));
    await settle();
    expect(reports).toHaveLength(0);
  });
});

describe('the overlap with the error boundary', () => {
  function Boom(): never {
    throw new Error('this screen threw during render');
  }

  it('files one report for one render crash, not one per reporter', async () => {
    // THE REASON THE BACKSTOP WAITS. React dispatches this error at the window before
    // componentDidCatch ever runs, and in a development build it re-invokes the component to
    // recover a stack — so the window sees the same crash more than once, as values that are
    // not the boundary's value and are not each other. Filing on the spot would mean three
    // reports for one fault and a customer shown a reference belonging to none of them.
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>
    );
    await settle();
    expect(reports).toHaveLength(1);
    expect(screen.getByRole('alert')).toHaveTextContent(reports[0].reference);
  });

  it('lets the boundary be the one that describes it, because it knows more', async () => {
    // The component trail is the whole difference between the two reporters, and only one of
    // them has it.
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>
    );
    await settle();
    expect(reports[0].source).toBe('render');
    expect(reports[0].componentStack).toContain('Boom');
  });

  it('still reports a fault the boundary never saw', async () => {
    // The guard must not become "the window listener never files anything". A rejection in a
    // handler reaches no boundary at all, which is the entire reason this file exists.
    render(
      <ErrorBoundary>
        <p>the studio</p>
      </ErrorBoundary>
    );
    rejectWith(new Error('nothing was rendering when this happened'));
    await settle();
    expect(reports).toHaveLength(1);
    expect(reports[0].source).toBe('unhandled-rejection');
  });
});

describe('the listeners themselves', () => {
  it('stop when told to, so nothing is left watching', async () => {
    stop?.();
    stop = null;
    rejectWith(new Error('after teardown'));
    // Message-only, no `error` payload: with our listener gone, Vitest's own window handler
    // would turn a populated one into an uncaught exception and fail the file for the wrong
    // reason. The message path is the one being asserted anyway.
    window.dispatchEvent(new ErrorEvent('error', { message: 'after teardown' }));
    await settle();
    expect(reports).toHaveLength(0);
  });

  it('survive a value that cannot even be read', async () => {
    // This code only ever runs on a day that is already going badly. A handler that throws
    // inside the browser's own error reporting is a loop with a bad ending.
    const event = new Event('unhandledrejection');
    Object.defineProperty(event, 'reason', {
      get() {
        throw new Error('even reading this throws');
      }
    });
    expect(() => window.dispatchEvent(event)).not.toThrow();
    await settle();
    expect(reports).toHaveLength(0);
  });
});
