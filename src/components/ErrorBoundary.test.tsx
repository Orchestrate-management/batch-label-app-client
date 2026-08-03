import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ErrorBoundary, crashCopy } from './ErrorBoundary';
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

/* -------------------------------------------------------- the honesty scan */

const EVERY_COPY = [
crashCopy('render', null),
crashCopy('screen-not-loaded', 'Materials'),
crashCopy('screen-not-loaded', null)];


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
