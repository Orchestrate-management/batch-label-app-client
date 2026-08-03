import React from 'react';
import { Logo } from './Logo';
import { SUPPORT_EMAIL } from '../lib/marketing';
import { ScreenNotLoaded } from '../lib/lazy-screen';
import { hasErrorSink, reportError, type ErrorReport } from '../lib/report-error';

/**
 * The floor under the whole app.
 *
 * Until this existed, any error thrown during render unmounted the entire React tree and left
 * the customer looking at an empty white document with no message, no navigation and no
 * indication that anything had happened at all. Nothing in the app caught anything. That was
 * the single largest hole in it.
 *
 * WHY THIS IS MOUNTED AT THE TOP AND NOT AROUND EACH ROUTE. Both are defensible and they are
 * genuinely different products; this one is the safe one, and the other is written up in
 * docs/PRODUCTION_TODO.md rather than decided quietly here.
 *
 *   - A boundary around `<Routes>` keeps the sidebar alive and confines the failure to the
 *     content area, which is a softer and in many apps a nicer failure. But it does not cover
 *     AuthProvider, EntitlementProvider, ProductsProvider, WorkspaceProvider, AppShell or the
 *     Toaster — and ProductsProvider is the newest and least covered code in the repo. A crash
 *     in any of those still white-screens. It is a better experience over a smaller area.
 *   - This one covers everything, which is the only version that can honestly be described as
 *     "the app can no longer go blank".
 *
 * And there is a second reason to prefer it in THIS product. A shell that survives with the
 * navigation working tells the maker, without saying it, that the rest of the app is fine. We
 * cannot establish that from a caught render error — we do not know whether the fault was in
 * the view or in the derivation that produced the values they were reading a second ago. In a
 * compliance tool the quiet implication is the dangerous part, so the app stops, whole, and
 * says what it does and does not know.
 *
 * WHAT IT MAY NOT SAY. "Something went wrong. Please try again." is worse than useless on a
 * screen where somebody was reading an ingredient declaration they were about to put on a
 * label. The question in their head is not "what happened", it is "can I trust what I was just
 * looking at", and the only honest answer to that after an unexplained crash is no. The copy
 * below answers that question first and everything else second, and it does not offer a
 * silent in-place "try again": re-rendering the same broken tree usually throws again
 * immediately, and a screen that flickers back looks like a recovery that did not happen.
 */

type CrashKind = 'render' | 'screen-not-loaded';

export interface CrashCopy {
  title: string;
  /** Paragraphs, in order. The first one is what a person who reads one line will read. */
  body: string[];
}

/**
 * The words, separated from the rendering so they can be read and tested as words.
 *
 * `screen` is the human name of the screen that failed to download, and is null for a render
 * crash — where naming the screen would be a guess, because the throw can come from anywhere
 * in the tree including the shell.
 */
export function crashCopy(kind: CrashKind, screen: string | null): CrashCopy {
  if (kind === 'screen-not-loaded') {
    return {
      title: screen ?
      `Batchlabel could not load the ${screen} screen` :
      'Batchlabel could not load this screen',
      body: [
      'The files this screen is built from did not arrive, so none of it was drawn. There is ' +
      'nothing on this screen to check, and nothing about your products has changed.',
      'This is usually one of two things: a connection that dropped, or Batchlabel having ' +
      'been updated while this tab sat open — in which case the tab is asking for files that ' +
      'have since been replaced. Reloading fetches the current version, and is worth trying ' +
      'first.']

    };
  }

  return {
    title: 'Batchlabel stopped part-way through this screen',
    body: [
    'Something inside the app failed while this screen was being drawn. This is a fault in ' +
    'Batchlabel. It is not a finding about your product, and it is not a compliance warning.',
    'Because it stopped part-way, there is no way to tell you how much of what you could see ' +
    'had finished being worked out. Treat everything that was on screen as unchecked: do not ' +
    'copy it onto a label, into a document, or to a supplier, until you have opened it again ' +
    'and seen it come up whole.',
    'Anything you had already saved is still in your account. Anything you were part-way ' +
    'through saving is worth opening again to confirm it went in.']

  };
}

interface Props {
  children: React.ReactNode;
  /** Recorded on the report, so a future second boundary can be told apart from this one. */
  source?: string;
}

interface State {
  kind: CrashKind | null;
  screen: string | null;
  report: ErrorReport | null;
}

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { kind: null, screen: null, report: null };

  /**
   * Pure, as React requires: it decides WHICH failure this is and nothing else. The reporting
   * happens in componentDidCatch, which is the lifecycle documented for side effects — putting
   * it here would file a duplicate report on every StrictMode double render.
   */
  static getDerivedStateFromError(error: unknown): Partial<State> {
    if (error instanceof ScreenNotLoaded) {
      return { kind: 'screen-not-loaded', screen: error.screen };
    }
    return { kind: 'render', screen: null };
  }

  componentDidCatch(error: unknown, info: React.ErrorInfo): void {
    const report = reportError(error, this.props.source ?? 'render', {
      componentStack: info.componentStack ?? undefined
    });
    // Second setState after getDerivedStateFromError. The fallback renders once without a
    // reference and then again with it, which is the right way round: the sentence a maker
    // needs is on screen immediately, and the code they would quote us arrives a frame later.
    this.setState({ report });
  }

  render(): React.ReactNode {
    if (!this.state.kind) return this.props.children;
    return (
      <CrashScreen
        kind={this.state.kind}
        screen={this.state.screen}
        report={this.state.report} />);


  }
}

const PRIMARY_ACTION =
'inline-flex h-11 items-center justify-center rounded-control bg-teal px-4 text-sm font-medium text-white transition-colors hover:bg-teal-hover';

const SECONDARY_ACTION =
'inline-flex h-11 items-center justify-center rounded-control border border-paper-line bg-paper px-4 text-sm font-medium text-ink transition-colors hover:bg-paper-panel';

/**
 * Both ways out are full document loads, and that is the point rather than an oversight.
 *
 * This boundary sits outside BrowserRouter, so there is no `Link` to reach for — but even if
 * there were, a client-side navigation after an unexplained crash keeps the broken tree's
 * state, its providers and whatever half-finished read caused the throw. A fresh document is
 * the only recovery that is actually fresh, and in the stale-deploy case it is the only one
 * that fixes anything at all.
 */
function CrashScreen({
  kind,
  screen,
  report




}: {kind: CrashKind;screen: string | null;report: ErrorReport | null;}) {
  const copy = crashCopy(kind, screen);
  return (
    <div
      role="alert"
      className="flex min-h-screen w-full items-center justify-center bg-paper px-6 py-12">

      <div className="max-w-prose">
        <Logo size={34} />
        <h1 className="mt-6 font-display text-xl font-semibold text-ink">{copy.title}</h1>
        {copy.body.map((paragraph) =>
        <p key={paragraph.slice(0, 32)} className="mt-3 text-sm leading-relaxed text-ink-secondary">
            {paragraph}
          </p>
        )}
        <div className="mt-6 flex flex-wrap items-center gap-2">
          <button
            type="button"
            className={PRIMARY_ACTION}
            onClick={() => {
              try {
                window.location.reload();
              } catch {
                // If even this fails there is nothing left for the app to offer, and the
                // browser's own reload button is still there.
              }
            }}>

            Reload this page
          </button>
          <a href="/" className={SECONDARY_ACTION}>
            Go to Studio
          </a>
        </div>
        {report &&
        <p className="mt-6 text-2xs leading-relaxed text-ink-tertiary">
            Reference <span className="font-mono text-ink-secondary">{report.reference}</span>.{' '}
            {hasErrorSink() ?
          null :
          'This has not reached us automatically. '}
            If it is stopping you working, email{' '}
            <a className="underline" href={`mailto:${SUPPORT_EMAIL}`}>
              {SUPPORT_EMAIL}
            </a>{' '}
            and quote it.
          </p>
        }
      </div>
    </div>);

}
