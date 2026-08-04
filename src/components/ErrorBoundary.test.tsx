import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ErrorBoundary, crashCopy, type CrashKind, type CrashScope } from './ErrorBoundary';
import { ScreenNotLoaded } from '../lib/lazy-screen';
import { setErrorSink, type ErrorReport } from '../lib/report-error';

/**
 * Two halves, and the second is the important one.
 *
 * The first checks the boundary does its job: it catches, it reports, it offers a way out.
 * The second is a scan of the words, because the failure this screen can have is not a
 * missing catch — it is a soothing sentence. "Something went wrong, please try again" over a
 * screen where a maker was reading an ingredient declaration they were about to put on a
 * label is worse than a white screen: white is obviously broken, and "please try again"
 * quietly suggests that what they saw a second ago was fine.
 */

/** React logs every error it hands to a boundary. Nothing here is a real console assertion. */
beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  setErrorSink(null);
  vi.restoreAllMocks();
});

/**
 * Annotated `never` rather than left to inference: TypeScript gives a function DECLARATION
 * whose body only throws a return type of `void`, and `void` is not a valid JSX element.
 */
function Boom({ error }: {error: unknown;}): never {
  throw error;
}

function renderCrash(error: unknown) {
  const reports: ErrorReport[] = [];
  setErrorSink((report) => reports.push(report));
  render(
    <ErrorBoundary>
      <Boom error={error} />
    </ErrorBoundary>
  );
  return reports;
}

/** The inner mount: inside AppShell, so the navigation is still on screen beside it. */
function renderScreenCrash(error: unknown) {
  const reports: ErrorReport[] = [];
  setErrorSink((report) => reports.push(report));
  render(
    <ErrorBoundary scope="screen" resetKey="/products">
      <Boom error={error} />
    </ErrorBoundary>
  );
  return reports;
}

describe('when nothing is wrong', () => {
  it('is invisible', () => {
    render(
      <ErrorBoundary>
        <p>the studio</p>
      </ErrorBoundary>
    );
    expect(screen.getByText('the studio')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('when a screen throws while rendering', () => {
  it('replaces the app instead of leaving a blank document', () => {
    renderCrash(new Error('cannot read properties of undefined'));
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: /stopped part-way through this screen/i })
    ).toBeInTheDocument();
  });

  it('answers the only question a maker actually has', () => {
    // Not "what happened" — "can I trust what I was just looking at". After an unexplained
    // crash the honest answer is no, and it has to be in words a person acts on.
    renderCrash(new Error('nope'));
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(/treat everything that was on screen as unchecked/i);
    expect(alert).toHaveTextContent(/do not copy it onto a label/i);
  });

  it('says plainly that this is not a compliance finding', () => {
    // A red screen in a compliance tool reads, to somebody who has just pressed a button on
    // their own product, as a verdict about that product.
    renderCrash(new Error('nope'));
    expect(screen.getByRole('alert')).toHaveTextContent(/not a compliance warning/i);
  });

  it('offers two ways out, both of them fresh documents', () => {
    renderCrash(new Error('nope'));
    expect(screen.getByRole('button', { name: /reload this page/i })).toBeInTheDocument();
    // A plain anchor, not a router Link: this boundary sits outside BrowserRouter, and a
    // client-side navigation after a crash would keep the broken tree's state.
    expect(screen.getByRole('link', { name: /go to studio/i })).toHaveAttribute('href', '/');
  });

  it('reports through the seam, with the component trail', () => {
    const reports = renderCrash(new Error('the derivation blew up'));
    expect(reports).toHaveLength(1);
    expect(reports[0].source).toBe('render');
    expect(reports[0].message).toBe('the derivation blew up');
    expect(reports[0].componentStack).toContain('Boom');
  });

  it('shows the customer the same reference that went into the report', () => {
    const reports = renderCrash(new Error('nope'));
    expect(screen.getByRole('alert')).toHaveTextContent(reports[0].reference);
  });

  it('tells the customer nobody has been told, while that is true', () => {
    // Gated on the seam rather than hard-coded, so installing a transport later cannot leave
    // this sentence behind as a lie. See lib/report-error.ts.
    render(
      <ErrorBoundary>
        <Boom error={new Error('nope')} />
      </ErrorBoundary>
    );
    expect(screen.getByRole('alert')).toHaveTextContent(/has not reached us automatically/i);
  });

  it('stops saying it once reports go somewhere', () => {
    const reports = renderCrash(new Error('nope'));
    expect(reports).toHaveLength(1);
    expect(screen.getByRole('alert')).not.toHaveTextContent(/has not reached us automatically/i);
  });
});

describe('when a split-out screen never arrives', () => {
  it('says so, and names the screen', () => {
    renderCrash(new ScreenNotLoaded('Materials', new TypeError('Failed to fetch')));
    expect(
      screen.getByRole('heading', { name: /could not load the Materials screen/i })
    ).toBeInTheDocument();
  });

  it('does not tell the maker to distrust a screen that was never drawn', () => {
    // The opposite message to a render crash, and getting it the wrong way round is worse
    // than saying nothing: there is nothing on screen to check.
    renderCrash(new ScreenNotLoaded('Materials', new TypeError('Failed to fetch')));
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(/nothing on this screen to check/i);
    expect(alert).not.toHaveTextContent(/treat everything that was on screen as unchecked/i);
  });

  it('names the deploy, because that is the cause a maker cannot guess', () => {
    renderCrash(new ScreenNotLoaded('Materials', new TypeError('Failed to fetch')));
    expect(screen.getByRole('alert')).toHaveTextContent(/updated while this tab sat open/i);
  });

  it('is still reported — a chunk nobody can fetch is our problem, not the connection', () => {
    const reports = renderCrash(new ScreenNotLoaded('Materials', new TypeError('Failed to fetch')));
    expect(reports[0].name).toBe('ScreenNotLoaded');
  });
});

/* ------------------------------------------ the second mount, inside the shell */

/**
 * The route-level boundary is a different product, not a smaller version of the same one, and
 * the difference is entirely in what the maker is left holding. A screen crash leaves them a
 * working sidebar — which is genuinely useful, and which quietly asserts something we cannot
 * establish. These tests are mostly about that assertion being made out loud instead.
 */
describe('when one screen throws and the shell is still standing', () => {
  it('does not use the words written for the app stopping whole', () => {
    // Two boundaries with one sentence between them is the failure this whole entry is
    // about: "Batchlabel stopped" is false when Batchlabel plainly has not.
    expect(crashCopy('render', null, 'screen').title).not.toBe(crashCopy('render', null).title);
  });

  it('tells the maker the navigation is there and is not a verdict', () => {
    renderScreenCrash(new Error('the derivation blew up'));
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(/the navigation is still here/i);
    // The load-bearing half. A working sidebar reads as "the rest is fine" unless something
    // says otherwise, and a caught render error cannot support that.
    expect(alert).toHaveTextContent(/not us telling you the rest of Batchlabel is sound/i);
  });

  it('still says do not trust what was on this screen', () => {
    // The one thing that must survive being made softer: the failure mode of a gentler
    // screen-level message is that it reads as a hiccup on a screen someone was reading a
    // declaration off.
    renderScreenCrash(new Error('nope'));
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(/treat all of it as unchecked/i);
    expect(alert).toHaveTextContent(/do not copy it onto a label/i);
    expect(alert).toHaveTextContent(/not a compliance warning/i);
  });

  it('offers the reload and does not duplicate the sidebar', () => {
    // "Go to Studio" here would sit inches from a Studio link that behaves differently — one
    // a full document load, one a client-side navigation — with nothing to tell them apart.
    renderScreenCrash(new Error('nope'));
    expect(screen.getByRole('button', { name: /reload this page/i })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /go to studio/i })).not.toBeInTheDocument();
  });

  it('files under its own source, so the two mounts are one apart in a log', () => {
    const reports = renderScreenCrash(new Error('nope'));
    expect(reports).toHaveLength(1);
    expect(reports[0].source).toBe('screen-render');
  });

  it('warns that a stale tab will fail the same way on every screen it has not opened', () => {
    // Only sayable here: at app scope there is no navigation left to press. Vite fingerprints
    // every chunk, so if the cause is a deploy this is a fact rather than a hedge.
    renderScreenCrash(new ScreenNotLoaded('Materials', new TypeError('Failed to fetch')));
    expect(screen.getByRole('alert')).toHaveTextContent(
      /any other screen it has not already opened will fail the same way/i
    );
  });
});

describe('the navigation the shell keeps', () => {
  function Screen({ crash }: {crash: boolean;}) {
    if (crash) throw new Error('this screen threw');
    return <p>the products list</p>;
  }

  it('actually navigates: a new path clears the crash', () => {
    // Without this the sidebar stays lit and goes nowhere for the rest of the session, which
    // is worse than the app stopping — it looks like the app works and does not.
    const { rerender } = render(
      <ErrorBoundary scope="screen" resetKey="/products/1">
        <Screen crash />
      </ErrorBoundary>
    );
    expect(screen.getByRole('alert')).toBeInTheDocument();

    rerender(
      <ErrorBoundary scope="screen" resetKey="/materials">
        <Screen crash={false} />
      </ErrorBoundary>
    );
    expect(screen.getByText('the products list')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('does not clear itself on a re-render that is not a navigation', () => {
    // A parent re-rendering for any other reason must not flash the broken screen back in
    // and out; a screen that flickers back looks like a recovery that did not happen.
    const { rerender } = render(
      <ErrorBoundary scope="screen" resetKey="/products/1">
        <Screen crash />
      </ErrorBoundary>
    );
    rerender(
      <ErrorBoundary scope="screen" resetKey="/products/1">
        <Screen crash={false} />
      </ErrorBoundary>
    );
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.queryByText('the products list')).not.toBeInTheDocument();
  });

  it('crashes again rather than looping when the next screen throws too', () => {
    const { rerender } = render(
      <ErrorBoundary scope="screen" resetKey="/products/1">
        <Screen crash />
      </ErrorBoundary>
    );
    rerender(
      <ErrorBoundary scope="screen" resetKey="/products/2">
        <Screen crash />
      </ErrorBoundary>
    );
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });
});

/* -------------------------------------------------------- the honesty scan */

/**
 * Every string this component can put in front of a customer, generated rather than listed.
 *
 * The scan is only worth what it covers, and a hand-kept list goes stale the first time
 * somebody adds a third failure kind or a third scope: the new copy escapes the register
 * silently, which is exactly how a soothing sentence gets back in. These two records are
 * typed by the unions themselves, so adding a member without adding it here is a typecheck
 * error rather than a quiet gap.
 */
const KINDS: Record<CrashKind, true> = { 'render': true, 'screen-not-loaded': true };
const SCOPES: Record<CrashScope, true> = { app: true, screen: true };

const EVERY_COPY = (Object.keys(KINDS) as CrashKind[]).flatMap((kind) =>
(Object.keys(SCOPES) as CrashScope[]).flatMap((scope) =>
[null, 'Materials'].map((named) => crashCopy(kind, named, scope))
)
);


/** Sentences that would make this screen worse than the white one it replaced. */
const FORBIDDEN: Array<{pattern: RegExp;why: string;}> = [
{ pattern: /something went wrong/i, why: 'says nothing, and reads as reassurance' },
{ pattern: /oops|whoops|sorry about that/i, why: 'jaunty, on a screen about a label' },
{
  pattern: /(we|our team|someone) (have|has|are) been (notified|alerted|told)/i,
  why: 'nothing is sent anywhere yet — see lib/report-error.ts'
},
{
  pattern: /please try again/i,
  why: 'the same broken tree throws the same way; the ways out are reload and leave'
},
{ pattern: /your data is safe/i, why: 'a blanket claim a caught render error cannot support' },
{ pattern: /unexpected error/i, why: 'every error is unexpected; it tells a maker nothing' },
{ pattern: /error code|status \d{3}/i, why: 'a number is not an answer to "can I trust this"' }];


describe('the crash copy', () => {
  it.each(FORBIDDEN)('never says $pattern', ({ pattern, why }) => {
    for (const copy of EVERY_COPY) {
      const text = [copy.title, ...copy.body].join(' ');
      expect(text, why).not.toMatch(pattern);
    }
  });

  it('always has a title and something to do about it', () => {
    for (const copy of EVERY_COPY) {
      expect(copy.title.length).toBeGreaterThan(0);
      expect(copy.body.length).toBeGreaterThan(0);
    }
  });

  it('is a scan that can actually fail', () => {
    // A guard that cannot fail reads as protection and provides none.
    expect('Something went wrong. Please try again.').toMatch(FORBIDDEN[0].pattern);
  });
});
