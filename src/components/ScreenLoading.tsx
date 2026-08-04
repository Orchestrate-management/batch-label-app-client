import { useEffect, useState } from 'react';

/**
 * What fills the content area while a split-out screen is being fetched.
 *
 * IT SHOWS NOTHING FOR THE FIRST QUARTER SECOND, deliberately. Once routes are code-split,
 * every navigation to a screen the maker has not opened yet suspends — but on a warm
 * connection that fetch resolves in tens of milliseconds, and a spinner that appears and
 * disappears inside 60ms does not read as "loading", it reads as a flicker. The app looking
 * unsteady on every click would be a worse trade than the bundle size the split bought.
 *
 * After that threshold something really is slow and silence stops being kind, so a plain line
 * of text appears. It is announced politely rather than as an alert: somebody who has just
 * pressed a link expects a wait, and interrupting them mid-sentence to say so is rude.
 *
 * There is no skeleton here on purpose. A skeleton is a claim about the shape of what is
 * coming — how many rows, how many cards — and these screens have no fixed shape; a maker with
 * no products would watch four grey rows resolve into an empty state.
 *
 * The sidebar and the mobile strip are outside this, so navigation never blanks. Route `/` is
 * not split at all, so the first screen after sign-in never reaches this component. Both are
 * load-bearing — see App.tsx.
 */
export function ScreenLoading() {
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setSlow(true), 250);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className="flex flex-1 items-start justify-center px-6 py-16 lg:px-10">
      <p
        role="status"
        className={`text-sm text-ink-tertiary transition-opacity duration-200 ${
        slow ? 'opacity-100' : 'opacity-0'}`
        }>

        {slow ? 'Loading…' : ''}
      </p>
    </div>);

}
