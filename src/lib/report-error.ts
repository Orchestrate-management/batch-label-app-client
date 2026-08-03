/**
 * Where an error goes when this app catches one.
 *
 * BEFORE THIS FILE THERE WAS NOWHERE. Not one console.error in the whole repo and no
 * reporting of any kind, which meant that when something broke for a real maker the only
 * person who ever found out was the maker, and only if they bothered to write in. That is
 * the gap this closes, and it closes it as a SEAM rather than as an integration.
 *
 * The distinction matters. Picking Sentry, or Highlight, or a self-hosted GlitchTip, is a
 * decision that costs money and posts a customer's data to somebody else's servers — for a
 * compliance tool whose error messages can carry product names and formulation values, that
 * is a data-protection decision and not a refactor. So this file deliberately does NOT pick
 * one. It gives every call site one function to call and one shape to produce, and it leaves
 * exactly one screw to turn later:
 *
 *     setErrorSink((report) => vendor.capture(report));
 *
 * installed once at boot. Nothing that calls `reportError` changes on that day. See
 * docs/PRODUCTION_TODO.md for the vendor choice itself and for what may and may not be put
 * in the payload once it leaves the device.
 *
 * WHAT IT DOES TODAY is local and sensible: it writes a structured line to the browser
 * console. That is not observability — nobody is watching a customer's console — but it is
 * the difference between a support call that starts with "it went white" and one that starts
 * with a reference and a stack, and it costs nothing and sends nothing anywhere.
 */

/**
 * The shape a transport receives.
 *
 * Flat, serialisable and free of React or DOM objects on purpose: whatever is chosen later
 * will want to JSON it, and a report that cannot survive `JSON.stringify` is a report that
 * arrives empty.
 */
export interface ErrorReport {
  /**
   * A short code shown to the customer and printed to the console, so a support email and a
   * log line can be joined up by a human. Not an identifier of anything — it is generated
   * here, for this one report, and is meaningless anywhere else.
   */
  reference: string;
  /** Which part of the app was reporting. Free text from the call site, e.g. `render`. */
  source: string;
  name: string;
  message: string;
  stack?: string;
  /** React's own component trail, when the caller is an error boundary. */
  componentStack?: string;
  /** ISO 8601, in the customer's clock. */
  at: string;
}

export type ErrorSink = (report: ErrorReport) => void;

let sink: ErrorSink | null = null;

/**
 * Point reporting at a service. Call once, at boot, before anything renders.
 *
 * Passing `null` removes it again, which is what a test does in its teardown so one test's
 * spy cannot be handed another test's reports.
 */
export function setErrorSink(next: ErrorSink | null): void {
  sink = next;
}

/**
 * Whether reports currently go anywhere but the customer's own console.
 *
 * This exists so that a screen can tell a customer the truth about whether we know. Today
 * nothing is installed and the crash screen says "this has not reached us, tell us if it is
 * blocking you"; on the day a transport is installed that sentence has to stop being printed
 * or it becomes a lie. Reading the seam rather than hard-coding the sentence means nobody has
 * to remember.
 */
export function hasErrorSink(): boolean {
  return sink !== null;
}

/**
 * Unambiguous when read down a phone: no I, L, O, U, 0 or 1.
 */
const REFERENCE_ALPHABET = 'ABCDEFGHJKMNPQRSTVWXYZ23456789';

function newReference(): string {
  let out = '';
  for (let index = 0; index < 8; index += 1) {
    if (index === 4) out += '-';
    out += REFERENCE_ALPHABET[Math.floor(Math.random() * REFERENCE_ALPHABET.length)];
  }
  return out;
}

/**
 * Get a name and a message out of a value that is only conventionally an Error.
 *
 * `throw 'nope'`, a rejected promise carrying an object, and a library throwing a DOMException
 * all arrive here, and this function is called from inside a crash handler — so it may not
 * itself throw. An error reporter that dies on the error it was handed leaves exactly the
 * white screen the whole change exists to remove.
 */
function describe(error: unknown): {name: string;message: string;stack?: string;} {
  try {
    if (error instanceof Error) {
      return {
        name: error.name || 'Error',
        message: error.message || String(error),
        stack: error.stack
      };
    }
    if (typeof error === 'string') return { name: 'Error', message: error };
    const asJson = JSON.stringify(error);
    return { name: 'NonError', message: asJson === undefined ? String(error) : asJson };
  } catch {
    // A thrown object with a hostile toString, or a circular structure JSON refuses. There is
    // still a report to file; it just has less in it.
    return { name: 'NonError', message: 'An unprintable value was thrown.' };
  }
}

/**
 * Report an error and get back the record that was filed.
 *
 * The return value is the point: the caller gets the reference and can put it on screen, so
 * the code a customer reads back to us is the code sitting next to the stack.
 *
 * `source` names the call site rather than the error — "render", "billing-portal", "sds-save"
 * — because the same exception thrown from two places is two different problems.
 */
export function reportError(
  error: unknown,
  source: string,
  extra?: {componentStack?: string;})
: ErrorReport {
  const described = describe(error);
  const report: ErrorReport = {
    reference: newReference(),
    source,
    name: described.name,
    message: described.message,
    at: new Date().toISOString()
  };
  if (described.stack) report.stack = described.stack;
  if (extra?.componentStack) report.componentStack = extra.componentStack;

  // The local default. The original value goes out alongside the report because a browser
  // console renders a real Error as an expandable stack and a plain object as a plain object,
  // and the stack is the half a developer actually wants.
  try {
    console.error(`[batchlabel] ${source} failed — reference ${report.reference}`, error, report);
  } catch {
    // A console that throws must not take the app with it.
  }

  if (sink) {
    try {
      sink(report);
    } catch {
      // Whatever is installed here is third-party code running inside a crash handler. If it
      // fails it fails alone: the customer's screen does not depend on our telemetry working.
    }
  }

  return report;
}
