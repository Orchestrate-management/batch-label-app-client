import { afterEach, describe, expect, it, vi } from 'vitest';
import { hasErrorSink, reportError, setErrorSink, type ErrorReport } from './report-error';

/**
 * The seam, tested as a seam.
 *
 * Almost every assertion here is about what happens when something goes wrong INSIDE the
 * error handler, because that is the failure mode that matters: this code only ever runs on a
 * day that is already going badly, and a reporter that throws while reporting turns a broken
 * screen into a blank one. So the transport is allowed to fail, the thrown value is allowed
 * to be nonsense, and neither may reach the caller.
 */

afterEach(() => {
  // A sink left installed by one test would be handed the next test's reports.
  setErrorSink(null);
  vi.restoreAllMocks();
});

function silenceConsole() {
  return vi.spyOn(console, 'error').mockImplementation(() => {});
}

describe('the reference', () => {
  it('is readable down a phone', () => {
    silenceConsole();
    const { reference } = reportError(new Error('nope'), 'test');
    // Four, a dash, four. No I, L, O, U, 0 or 1, because this gets read aloud to support.
    expect(reference).toMatch(/^[ABCDEFGHJKMNPQRSTVWXYZ23456789]{4}-[ABCDEFGHJKMNPQRSTVWXYZ23456789]{4}$/);
  });

  it('is different for every report, so two failures are two lines', () => {
    silenceConsole();
    const references = new Set(
      Array.from({ length: 24 }, () => reportError(new Error('nope'), 'test').reference)
    );
    expect(references.size).toBe(24);
  });
});

describe('the local default', () => {
  it('writes the reference and the original error to the console', () => {
    const spy = silenceConsole();
    const report = reportError(new Error('the derivation blew up'), 'render');

    expect(spy).toHaveBeenCalledTimes(1);
    const [message, original, logged] = spy.mock.calls[0];
    expect(message).toContain(report.reference);
    expect(message).toContain('render');
    // The raw Error goes out alongside the flat report, because a browser console renders a
    // real Error as an expandable stack and a plain object as a plain object.
    expect(original).toBeInstanceOf(Error);
    expect(logged).toMatchObject({ name: 'Error', message: 'the derivation blew up' });
  });

  it('survives a console that throws', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {
      throw new Error('console is gone');
    });
    expect(() => reportError(new Error('nope'), 'test')).not.toThrow();
  });
});

describe('the sink', () => {
  it('is not installed until something installs one', () => {
    expect(hasErrorSink()).toBe(false);
  });

  it('receives the report once installed, and stops when it is removed', () => {
    silenceConsole();
    const received: ErrorReport[] = [];
    setErrorSink((report) => received.push(report));
    expect(hasErrorSink()).toBe(true);

    const first = reportError(new Error('one'), 'render');
    setErrorSink(null);
    reportError(new Error('two'), 'render');

    expect(hasErrorSink()).toBe(false);
    expect(received).toHaveLength(1);
    expect(received[0].reference).toBe(first.reference);
    expect(received[0].message).toBe('one');
  });

  it('cannot take the app down with it', () => {
    // Whatever is installed here later is third-party code running inside a crash handler.
    silenceConsole();
    setErrorSink(() => {
      throw new Error('the vendor is having an outage');
    });
    expect(() => reportError(new Error('nope'), 'render')).not.toThrow();
  });
});

describe('whatever was actually thrown', () => {
  it('keeps an Error whole', () => {
    silenceConsole();
    const error = new TypeError('cannot read properties of undefined');
    const report = reportError(error, 'render');
    expect(report.name).toBe('TypeError');
    expect(report.message).toBe('cannot read properties of undefined');
    expect(report.stack).toBeTruthy();
  });

  it('handles a thrown string', () => {
    silenceConsole();
    expect(reportError('just a string', 'render')).toMatchObject({
      name: 'Error',
      message: 'just a string'
    });
  });

  it('handles a thrown object', () => {
    silenceConsole();
    expect(reportError({ code: 'PGRST301' }, 'render')).toMatchObject({
      name: 'NonError',
      message: '{"code":"PGRST301"}'
    });
  });

  it('handles a thrown nothing', () => {
    silenceConsole();
    expect(reportError(undefined, 'render').message).toBe('undefined');
    expect(reportError(null, 'render').message).toBe('null');
  });

  it('handles a value that cannot be printed at all', () => {
    silenceConsole();
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(reportError(circular, 'render')).toMatchObject({
      name: 'NonError',
      message: 'An unprintable value was thrown.'
    });
  });
});

describe('the shape handed to a transport', () => {
  it('survives JSON, because whatever is chosen later will send JSON', () => {
    silenceConsole();
    const report = reportError(new Error('nope'), 'render', { componentStack: '\n at Studio' });
    expect(() => JSON.stringify(report)).not.toThrow();
    expect(JSON.parse(JSON.stringify(report))).toEqual(report);
  });

  it('carries the component trail only when the caller had one', () => {
    silenceConsole();
    expect(reportError(new Error('nope'), 'billing-portal').componentStack).toBeUndefined();
    expect(
      reportError(new Error('nope'), 'render', { componentStack: '\n at Studio' }).componentStack
    ).toBe('\n at Studio');
  });

  it('records which call site reported, not just what was thrown', () => {
    // The same exception from two places is two different problems.
    silenceConsole();
    expect(reportError(new Error('nope'), 'billing-portal').source).toBe('billing-portal');
  });
});
