import { Suspense } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { setErrorSink, type ErrorReport } from '../lib/report-error';
import { ScreenNotLoaded, lazyScreen } from './lazy-screen';

/**
 * THE ONE NEW FAILURE ROUTE SPLITTING BOUGHT, AND WHY IT IS TYPED.
 *
 * A screen's code is now fetched when the maker first opens it. That fetch fails for two
 * reasons that say nothing about the code inside it: the connection dropped, or WE DEPLOYED —
 * Vite fingerprints every chunk, so a release renames all of them and a tab opened beforehand
 * asks for files that no longer exist. The second is invisible in testing and universal in
 * production.
 *
 * `ScreenNotLoaded` exists so the boundary can tell those apart from a screen that genuinely
 * crashed, with `instanceof` rather than by sniffing a TypeError message that Chrome and
 * Safari do not even word the same. They are opposite sentences to put in front of somebody
 * about to print a label: one means distrust what you were reading, the other means there was
 * nothing to read. If this wrapper ever stops wrapping, the boundary says the wrong one of the
 * two and nothing else goes red — which is why the module is now on the coverage floor in
 * vitest.config.ts rather than sitting off the list with "it has tests" as the reason.
 */

beforeEach(() => {
  // React logs every error it hands to a boundary, and a lazy rejection logs twice.
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  setErrorSink(null);
  vi.restoreAllMocks();
});

function renderScreen(load: () => Promise<{default: () => JSX.Element;}>) {
  const reports: ErrorReport[] = [];
  setErrorSink((report) => reports.push(report));
  const Screen = lazyScreen('Materials', load);
  render(
    <ErrorBoundary>
      <Suspense fallback={<p>opening…</p>}>
        <Screen />
      </Suspense>
    </ErrorBoundary>
  );
  return reports;
}

describe('a screen whose code arrives', () => {
  it('renders it, and the wrapper is invisible', async () => {
    renderScreen(async () => ({ default: () => <p>the materials library</p> }));
    expect(await screen.findByText('the materials library')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('a screen whose code never arrives', () => {
  it('reaches the boundary as ScreenNotLoaded, not as a bare TypeError', async () => {
    const reports = renderScreen(() => Promise.reject(new TypeError('Failed to fetch')));
    await waitFor(() => expect(reports).toHaveLength(1));
    expect(reports[0].name).toBe('ScreenNotLoaded');
  });

  it('names the screen the maker was opening, in words rather than a module path', async () => {
    const reports = renderScreen(() => Promise.reject(new TypeError('Failed to fetch')));
    await waitFor(() => expect(reports).toHaveLength(1));
    expect(reports[0].message).toContain('Materials');
  });

  it('keeps the original failure, so a report says which of the two it was', async () => {
    // The cause is the only thing that distinguishes a dropped connection from a deploy that
    // renamed the file, and it is the difference between "they were on a train" and "every
    // open tab in the world is broken until it is reloaded".
    const error = new ScreenNotLoaded('Materials', new TypeError('Failed to fetch'));
    expect(error.stack).toContain('caused by');
    expect(error.stack).toContain('Failed to fetch');
    expect(error.screen).toBe('Materials');
  });

  it('survives a rejection that is not an Error at all', async () => {
    // `import()` rejects with whatever the runtime threw. A string cannot carry a stack, and
    // the wrapper must still produce a typed error rather than throwing while handling one.
    const error = new ScreenNotLoaded('Materials', 'nope');
    expect(error.name).toBe('ScreenNotLoaded');
    expect(error.stack).not.toContain('caused by');
  });
});
