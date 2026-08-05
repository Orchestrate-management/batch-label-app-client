/**
 * WHICH VENDORS COME OUT OF THE ENTRY CHUNK, AND WHICH MAY NOT.
 *
 * Route-level splitting is done; what is left on the critical path is almost all vendor code
 * and none of it can be deferred (`AuthProvider` calls `getSession()` on mount and the app
 * renders nothing until it answers). So this does not make the first visit faster and is not
 * meant to. It makes the SECOND one cheaper: with vendors in their own fingerprinted files, a
 * deploy that changes only our own code leaves their hashes alone and a returning maker
 * re-downloads our code instead of the world. The measured numbers are in entry 8 of
 * docs/PRODUCTION_TODO.md.
 *
 * IT LIVES HERE, IN src, RATHER THAN INSIDE vite.config.ts, so it can be exercised. The failure
 * this rule can have is a one-line tidy-up — `if (id.includes('node_modules')) return 'vendor'`
 * is shorter, reads as the obvious version, and drags packages that only a lazily-loaded screen
 * ever reaches onto the first paint. That is the exact regression this change exists not to
 * make, it arrives dressed as a simplification, and nothing in a build log would say so: the
 * chunk list would look tidier. A config is not importable from a jsdom test (esbuild will not
 * start there), so the rule moved to where a test can call it.
 */

/**
 * The packages route `/` cannot draw without, and only those.
 *
 * Not "the big packages" — a different and much more careful claim. Every name here is already
 * in the entry chunk today, so hoisting it into a sibling file cannot cost the first paint
 * anything. `lucide-react` is deliberately absent: Vite emits two of its icons as their own
 * on-demand chunks, and any blanket rule pulls them forward.
 */
const EAGER_VENDOR: Record<string, string> = {
  // AuthProvider blocks the first render on getSession(). The scoped members are the packages
  // supabase-js is itself assembled from — auth-js, postgrest-js, realtime-js and the rest.
  '@supabase/supabase-js': 'supabase',
  'react': 'react',
  'react-dom': 'react',
  'scheduler': 'react',
  'react-router': 'router',
  'react-router-dom': 'router',
  '@remix-run/router': 'router',
  'sonner': 'sonner',
  /**
   * The dropdown's vendor set. It is here for the same reason as the rest and under the
   * same test: it is ALREADY in the entry chunk, so naming it cannot cost the first paint.
   *
   * It is in the entry chunk because Studio — the one screen loaded up front — imports
   * NewProductDialog, and that dialog has two `Select`s in it. Left unnamed, 89 kB of
   * third-party code would sit inside `index-[hash].js` beside our own, and every deploy
   * that touched a line of our code would make a returning maker fetch all of it again.
   * That is precisely the property this file exists to protect, so a change that adds a
   * large stable vendor to the critical path has to say so here.
   *
   * The scroll-lock and focus trio (`react-remove-scroll` and friends, `aria-hidden`) are
   * not Radix packages but are pulled in only by it; `@floating-ui` is what positions the
   * popup. `tslib` is deliberately NOT named — it is shared helper code, and forcing it in
   * here would drag this whole chunk into whatever else imports it.
   */
  'aria-hidden': 'listbox',
  'react-remove-scroll': 'listbox',
  'react-remove-scroll-bar': 'listbox',
  'react-style-singleton': 'listbox',
  'use-sidecar': 'listbox',
  'use-callback-ref': 'listbox',
  'get-nonce': 'listbox',
  'detect-node-es': 'listbox'
};

/**
 * The package a resolved module id belongs to, or undefined if it is our own code.
 *
 * Written out rather than done with `id.includes('/react/')`, which is the version that reads
 * fine and is wrong: `@emotion/react` contains it. A mistake here does not fail a build — it
 * silently moves code between chunks.
 */
export function packageOf(id: string): string | undefined {
  return /node_modules\/((?:@[^/]+\/)?[^/]+)\//.exec(id)?.[1];
}

/** The chunk a module belongs in, or undefined to leave it wherever the bundler put it. */
export function vendorChunkFor(id: string): string | undefined {
  const pkg = packageOf(id);
  if (!pkg) return undefined;
  if (pkg.startsWith('@supabase/')) return 'supabase';
  // Same reasoning as the supabase prefix: Radix ships one package per primitive and the
  // popup is positioned by a second scoped family, so naming only `react-select` would
  // leave most of the weight behind and look like it had worked.
  if (pkg.startsWith('@radix-ui/') || pkg.startsWith('@floating-ui/')) return 'listbox';
  return EAGER_VENDOR[pkg];
}
