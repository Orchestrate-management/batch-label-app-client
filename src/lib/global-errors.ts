import { describedRecently, reportError } from './report-error';

/**
 * The half of this app's failures an error boundary cannot see.
 *
 * A boundary catches what is thrown during render and in lifecycle methods. It catches nothing
 * thrown in an event handler, nothing thrown in a `setTimeout`, and no unhandled promise
 * rejection — which is most of how this app actually fails, because most of what it does is
 * `await supabase…`. Those are handled locally wherever the code expects them (billing, account
 * and product writes all return typed failures), but an UNEXPECTED one went nowhere at all: no
 * console line, no reference, no trace of it anywhere. A maker's save silently not happening,
 * and us with nothing to look at.
 *
 * TWO LISTENERS, AND NO TRANSPORT. Where reports go is a decision that costs money and posts a
 * customer's formulation values to somebody else's servers; it is written up as entry 6 in
 * docs/PRODUCTION_TODO.md and it is not made here. These listeners feed the same `reportError`
 * seam every other call site already feeds, so the day a sink is installed they are already
 * wired to it and nothing in this file changes.
 *
 * WHAT IS DELIBERATELY NOT FILTERED. Browser extensions, blocked third-party scripts and
 * cross-origin errors (which arrive as a bare "Script error." with no stack and no useful
 * message) all land in this funnel. Entry 7 is right that they are noise and right that a
 * filter belongs in the sink rather than here: today the destination is the maker's own
 * console, where a line costs nothing and a dropped line costs a developer the one clue they
 * had. Dropping reports is a decision for the day they start costing money — which is the same
 * day as entry 6, in the same place.
 *
 * NOT `preventDefault()`, either. Cancelling the event suppresses the browser's own reporting
 * of the same error, which is the more detailed of the two — and React reads a prevented
 * default as a signal to stop logging the error itself.
 */

/**
 * File it, unless something better already has.
 *
 * THE ORDER IS NOT OURS TO CHOOSE, WHICH IS WHY THIS WAITS. A render error reaches
 * `window.onerror` BEFORE the boundary's componentDidCatch runs — in a development build React
 * re-invokes the failed component to recover a stack, so the same crash arrives here two or
 * three times over, as values that are not each other. Reporting on the spot would mean the
 * backstop always won the race and the good report — the one with the component trail, filed
 * by the boundary that actually handled it — always looked like the duplicate.
 *
 * So the backstop yields a tick and then asks whether the fault has since been described. If
 * it has, it says nothing; if nothing else ever saw it, which is the entire reason this file
 * exists, it files. A macrotask of delay costs a log line its position in the console and
 * nothing else. The one thing it loses is an error thrown in the instant before the document
 * is torn down — where the browser's own reporting is the better record anyway.
 */
function backstop(value: unknown, source: string): void {
  setTimeout(() => {
    try {
      if (describedRecently(value)) return;
      reportError(value, source);
    } catch {
      // Reporting must not become the failure. See reportError, which has the same rule.
    }
  }, 0);
}

/**
 * What the window handed us, made into something reportable without throwing.
 *
 * An `error` event usually carries the thrown value on `.error`, but not always: cross-origin
 * script errors carry a message and nothing else. Both are worth a report; a resource that
 * failed to load is not, and is not one of ours to report.
 */
function fromErrorEvent(event: ErrorEvent): unknown {
  if (event.error !== undefined && event.error !== null) return event.error;
  if (typeof event.message === 'string' && event.message.length > 0) {
    const where = [event.filename, event.lineno, event.colno].filter(Boolean).join(':');
    return new Error(where ? `${event.message} (${where})` : event.message);
  }
  return undefined;
}

/**
 * Install the two listeners. Returns the teardown, which the app never calls and a test always
 * does — a listener left on one test's window is handed the next test's errors.
 *
 * Takes its target rather than reaching for the global, so a test can hand it a window it
 * controls and so this module has nothing to say about whether a `window` exists.
 */
export function listenForUncaughtErrors(target: Window): () => void {
  const onError = (event: ErrorEvent) => {
    try {
      const value = fromErrorEvent(event);
      // An `error` event with neither a value nor a message is a resource that failed to
      // load — an image, a stylesheet — reported at the element rather than by the script
      // that ran. There is nothing in it for this funnel.
      if (value === undefined) return;
      backstop(value, 'window-error');
    } catch {
      // A handler that throws inside the browser's error reporting is a loop with a bad
      // ending. Nothing here is important enough to risk it.
    }
  };

  const onRejection = (event: PromiseRejectionEvent) => {
    try {
      // `reason` is whatever was passed to `reject`, which is conventionally an Error and is
      // frequently not one. reportError already survives being handed anything.
      backstop(event.reason, 'unhandled-rejection');
    } catch {
      // As above.
    }
  };

  target.addEventListener('error', onError);
  target.addEventListener('unhandledrejection', onRejection);

  return () => {
    target.removeEventListener('error', onError);
    target.removeEventListener('unhandledrejection', onRejection);
  };
}
