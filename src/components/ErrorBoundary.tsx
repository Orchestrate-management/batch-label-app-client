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
 * THIS CLASS IS MOUNTED TWICE, AND THE TWO MOUNTS SAY DIFFERENT THINGS.
 *
 *   - `scope="app"` (the default) is the one outside everything in App.tsx — outside
 *     AuthProvider, EntitlementProvider, ProductsProvider, WorkspaceProvider, AppShell and the
 *     Toaster. It is the only mount that can honestly be described as "the app can no longer
 *     go blank", because it is the only one that covers the providers. Nothing about its copy
 *     or its behaviour changed when the second mount was added.
 *   - `scope="screen"` sits inside AppShell, around the routed content and its Suspense. A
 *     throw from one screen — or a chunk that never arrives — is confined to the content area,
 *     and the maker keeps a working navigation instead of losing the app whole.
 *
 * THE SECOND MOUNT IS THE ONE WITH THE COPY PROBLEM, and it is why the two are not allowed to
 * share a sentence. A shell that survives with the navigation working tells the maker, without
 * saying it, that the rest of the app is fine. We cannot establish that from a caught render
 * error: we do not know whether the fault was in the view or in the derivation that produced
 * the values they were reading a second ago, and that derivation feeds other screens too. In a
 * compliance tool the quiet implication is the dangerous part — so the screen-scoped copy
 * names the navigation as a thing they can use and then says outright that its being there is
 * not a verdict on anything else. The app-scoped copy has no such problem: the app stopped
 * whole and says so.
 *
 * The screen-scoped mount also clears itself on navigation, via `resetKey` — see
 * componentDidUpdate. Without that, a crash on one screen would leave the fallback in place
 * for the rest of the session however many links the maker pressed, which is a working
 * navigation that navigates nowhere.
 *
 * WHAT NEITHER MAY SAY. "Something went wrong. Please try again." is worse than useless on a
 * screen where somebody was reading an ingredient declaration they were about to put on a
 * label. The question in their head is not "what happened", it is "can I trust what I was just
 * looking at", and the only honest answer to that after an unexplained crash is no. The copy
 * below answers that question first and everything else second, and it does not offer a
 * silent in-place "try again": re-rendering the same broken tree usually throws again
 * immediately, and a screen that flickers back looks like a recovery that did not happen.
 */

/**
 * Exported so the banned-register scan in the test can be built as a cross product of every
 * kind and every scope rather than as a hand-kept list. A list is the thing that goes stale
 * the day somebody adds a third kind of failure and its copy quietly escapes the scan.
 */
export type CrashKind = 'render' | 'screen-not-loaded';

/**
 * How much of the app the failure took with it — which is a fact about the mount, not a guess.
 *
 * `app`: this boundary is outside the providers, so nothing is left rendering. `screen`: it is
 * inside AppShell, so the navigation is still on screen and still works. Everything the two
 * copies differ about follows from that one difference and from nothing else.
 */
export type CrashScope = 'app' | 'screen';

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
 *
 * `scope` defaults to `app` so that the outer mount, and every existing caller, keeps exactly
 * the wording it had.
 */
export function crashCopy(
  kind: CrashKind,
  screen: string | null,
  scope: CrashScope = 'app')
: CrashCopy {
  if (kind === 'screen-not-loaded') {
    return {
      title: screen ?
      `Batchlabel could not load the ${screen} screen` :
      'Batchlabel could not load this screen',
      body: [
      // NOT "and nothing about your products has changed". The boundary knows this screen
      // never drew; it does not know what the maker did before navigating here. Create a
      // product and then hit a failed chunk and that sentence is false — and it is most
      // false on the path where it matters most, a return from Stripe Checkout. Say only
      // what a failed fetch actually establishes: this screen drew nothing.
      'The files this screen is built from did not arrive, so none of it was drawn. There is ' +
      'nothing on this screen to check. Anything you did before opening it was saved or not ' +
      'on its own, and is unaffected by this.',
      // The extra clause is only true at screen scope, where the navigation the maker is
      // about to press is right there. It is not a guess: Vite fingerprints every chunk, so
      // if the cause is a deploy then every screen this tab has NOT already fetched is
      // asking for a file name that no longer exists. Saying it here saves them finding
      // out one screen at a time.
      scope === 'screen' ?
      'This is usually one of two things: a connection that dropped, or Batchlabel having ' +
      'been updated while this tab sat open — in which case the tab is asking for files that ' +
      'have since been replaced, and any other screen it has not already opened will fail ' +
      'the same way. Reloading fetches the current version, and is worth trying first.' :
      'This is usually one of two things: a connection that dropped, or Batchlabel having ' +
      'been updated while this tab sat open — in which case the tab is asking for files that ' +
      'have since been replaced. Reloading fetches the current version, and is worth trying ' +
      'first.']

    };
  }

  if (scope === 'screen') {
    return {
      title: 'This screen stopped part-way through',
      body: [
      'Something inside Batchlabel failed while this screen was being drawn. This is a fault ' +
      'in Batchlabel. It is not a finding about your product, and it is not a compliance ' +
      'warning.',
      'Because it stopped part-way, there is no way to tell you how much of what was on this ' +
      'screen had finished being worked out. Treat all of it as unchecked: do not copy it ' +
      'onto a label, into a document, or to a supplier, until you have opened it again and ' +
      'seen it come up whole.',
      // The whole reason this copy exists separately. The navigation surviving is a fact and
      // it is useful, so it gets said. What it is NOT is evidence — and a maker who reads a
      // working sidebar as "everything else is fine" has been told something we cannot
      // establish, by a screen that never said it. So it is said the other way, out loud.
      'The navigation is still here, so you can open something else from it. That is not us ' +
      'telling you the rest of Batchlabel is sound: we cannot tell from here whether the ' +
      'fault was in this screen or in the working-out behind it, and the same working-out ' +
      'feeds other screens. Reloading is the only way to begin again from nothing.',
      'Anything you had already saved is still in your account. Anything you were part-way ' +
      'through saving is worth opening again to confirm it went in.']

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
  /**
   * How much this mount covers, which decides both the copy and the layout. Defaults to
   * `app` so the outer mount reads exactly as it did before there was a second one.
   */
  scope?: CrashScope;
  /**
   * Recorded on the report, so the two mounts can be told apart in a log. Defaults from
   * `scope`, so a call site sets one thing rather than two things that must agree.
   */
  source?: string;
  /**
   * Change this and a boundary that is currently showing a crash goes back to rendering its
   * children. The screen-scoped mount passes the pathname, so pressing a nav link opens the
   * screen it points at instead of leaving the fallback up.
   *
   * DELIBERATELY NOT A `key`. Keying the boundary on the pathname would do the same job in
   * one word, and would also remount the entire routed subtree on every navigation —
   * including navigations between two products, where React Router keeps the same element
   * mounted and the screen keeps its working state on purpose. A reset that only runs when
   * there is something to reset costs a lifecycle method and changes nothing on the healthy
   * path.
   */
  resetKey?: unknown;
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
    const report = reportError(error, this.props.source ?? sourceFor(this.props.scope), {
      componentStack: info.componentStack ?? undefined
    });
    // Second setState after getDerivedStateFromError. The fallback renders once without a
    // reference and then again with it, which is the right way round: the sentence a maker
    // needs is on screen immediately, and the code they would quote us arrives a frame later.
    this.setState({ report });
  }

  /**
   * Clear the crash when the caller says the thing that crashed is no longer on screen.
   *
   * Only ever runs while a crash is showing, so a healthy tree pays nothing for it, and it
   * cannot loop: if the newly rendered children throw again the state is set from the render
   * that throws, and `resetKey` has not moved a second time.
   */
  componentDidUpdate(previous: Props): void {
    if (!this.state.kind) return;
    if (previous.resetKey === this.props.resetKey) return;
    this.setState({ kind: null, screen: null, report: null });
  }

  render(): React.ReactNode {
    if (!this.state.kind) return this.props.children;
    return (
      <CrashScreen
        kind={this.state.kind}
        screen={this.state.screen}
        scope={this.props.scope ?? 'app'}
        report={this.state.report} />);


  }
}

/**
 * `render` rather than `app`, because that string is already in every report filed to date and
 * in the tests that read them; renaming it would make the same failure look like two.
 */
function sourceFor(scope: CrashScope | undefined): string {
  return scope === 'screen' ? 'screen-render' : 'render';
}

const PRIMARY_ACTION =
'inline-flex h-11 items-center justify-center rounded-control bg-teal px-4 text-sm font-medium text-white transition-colors hover:bg-teal-hover';

const SECONDARY_ACTION =
'inline-flex h-11 items-center justify-center rounded-control border border-paper-line bg-paper px-4 text-sm font-medium text-ink transition-colors hover:bg-paper-panel';

/**
 * Every way out is a full document load, and that is the point rather than an oversight.
 *
 * The app-scoped boundary sits outside BrowserRouter, so there is no `Link` to reach for — but
 * even where there is one, a client-side navigation after an unexplained crash keeps the broken
 * tree's state, its providers and whatever half-finished read caused the throw. A fresh
 * document is the only recovery that is actually fresh, and in the stale-deploy case it is the
 * only one that fixes anything at all.
 *
 * WHICH IS WHY THE SCREEN-SCOPED VERSION OFFERS ONLY THE RELOAD. It is drawn beside a working
 * sidebar whose Studio link is a client-side navigation, and a second "Go to Studio" next to
 * it — same words, different and unexplained behaviour — would be a trap rather than a choice.
 * The navigation is the soft way out and the copy says so; this button is the hard one.
 */
function CrashScreen({
  kind,
  screen,
  scope,
  report



}: {kind: CrashKind;screen: string | null;scope: CrashScope;report: ErrorReport | null;}) {
  const copy = crashCopy(kind, screen, scope);
  const wholeApp = scope === 'app';
  return (
    <div
      role="alert"
      className={
      wholeApp ?
      'flex min-h-screen w-full items-center justify-center bg-paper px-6 py-12' :
      'w-full px-6 py-12 md:px-10'
      }>

      <div className="max-w-prose">
        {wholeApp && <Logo size={34} />}
        <h1
          className={`font-display text-xl font-semibold text-ink ${wholeApp ? 'mt-6' : ''}`}>

          {copy.title}
        </h1>
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
          {wholeApp &&
          <a href="/" className={SECONDARY_ACTION}>
              Go to Studio
            </a>
          }
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
