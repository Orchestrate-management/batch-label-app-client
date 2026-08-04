import { lazy } from 'react';
import type { ComponentType, LazyExoticComponent } from 'react';

/**
 * A route loaded on demand, and the one new failure that buys.
 *
 * Splitting the bundle by route means a screen's code is fetched when the maker first asks
 * for it, over the network, at a moment when they are already waiting. That fetch can fail,
 * and it fails for two reasons that have nothing to do with the code inside the chunk:
 *
 *   1. the connection dropped — a phone in a workshop, a train, a flaky café;
 *   2. WE DEPLOYED. Vite fingerprints every chunk, so a release renames all of them. A tab
 *      that was opened before the deploy is still holding the old index and will ask for
 *      files that no longer exist on the origin. Every navigation in that tab fails until the
 *      page is reloaded.
 *
 * The second one is the one that bites, because it is invisible in testing and universal in
 * production, and because the fix — reload — is not something a maker will guess.
 *
 * SO THE REJECTION IS TYPED RATHER THAN LEFT RAW. A bare `import()` rejection reaches the
 * error boundary as a TypeError with a browser-specific message, and the boundary would have
 * to sniff that string to tell "your product screen crashed" apart from "the file never
 * arrived". Those are opposite messages to put in front of somebody about to print a label:
 * one means distrust what you were reading, the other means there was nothing to read. A
 * class the boundary can ask about with `instanceof` keeps that distinction exact instead of
 * making it a guess about wording that Chrome and Safari do not even share.
 *
 * DELIBERATELY NOT RETRIED HERE. The obvious reflex is to call the loader a second time, but
 * the module map records a failed fetch against the specifier, so a second `import()` of the
 * same URL can reject straight out of cache without touching the network — a retry that
 * mostly pretends. Getting a real second attempt means cache-busting the resolved URL, which
 * Vite does not hand us. The honest recovery is the one the crash screen offers: reload, which
 * fetches a fresh index and therefore the current file names. See docs/PRODUCTION_TODO.md.
 */
export class ScreenNotLoaded extends Error {
  /** The screen the maker was trying to open, for the console line and the report. */
  readonly screen: string;

  constructor(screen: string, cause: unknown) {
    super(`The code for the ${screen} screen could not be downloaded.`);
    this.name = 'ScreenNotLoaded';
    this.screen = screen;
    // `cause` is standard on Error, but assigning it through the constructor options bag
    // needs lib ES2022. Set directly so the original TypeError survives into the report.
    if (cause instanceof Error) this.stack = `${this.stack}\ncaused by: ${cause.stack ?? cause.message}`;
  }
}

/** Every routed screen in this app takes no props, which is what keeps this signature honest. */
type ScreenModule = {default: ComponentType;};

/**
 * `React.lazy` with the failure named.
 *
 * `name` is what the customer is told they were opening, so it is the screen's name in
 * words — "Materials", "your product" — not the module path.
 */
export function lazyScreen(
  name: string,
  load: () => Promise<ScreenModule>)
: LazyExoticComponent<ComponentType> {
  return lazy(() =>
  load().catch((cause: unknown) => {
    throw new ScreenNotLoaded(name, cause);
  })
  );
}
