/**
 * The Meta Pixel inside the product app. One event, one gate, nothing else.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS FILE IS FOR
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * This app had no analytics of any kind before this file. That is a starting
 * position worth protecting, so what is added here is deliberately the smallest
 * thing that answers the question the marketing site cannot: **did the upgrade
 * click happen inside the product?** Nothing else about a maker's session is
 * reported to Meta.
 *
 * The sibling of this file is `batch-label/src/lib/meta-pixel.ts` on
 * www.batchlabel.xyz. It is the same Pixel id and the same dataset, so the two
 * are written to read alike — the fbq bootstrap, the script attribute, the
 * cookie clearing and the "never load without consent" rule are the same code
 * on purpose, so an auditor can diff them. The differences below are the point
 * of this file, and every one of them narrows what is sent.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE THREE DIFFERENCES FROM WWW, AND WHY
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * 1. NO PageView. Not on load, not per route, not on the consent transition
 *    (www sends one there, because a marketing page view is the thing the ad
 *    paid for). This is the authenticated product: every path a maker walks
 *    through it is work they are doing, and streaming that to an advertising
 *    platform is a real privacy cost for no measurement Meta needs. There is
 *    no `metaPageView` in this file and there must not be one added. If a
 *    reviewer wants to check that claim, `meta-pixel.test.ts` asserts that the
 *    string 'PageView' never reaches fbq, across a grant, a withdrawal and a
 *    re-grant.
 *
 * 2. autoConfig OFF. Left on, fbevents.js does its own "automatic advanced
 *    matching" and automatic event detection: it scrapes button text, form
 *    field values and page microdata and logs events nobody wrote. On a
 *    marketing page that is noisy. Inside a product where the buttons say
 *    "Export PDF" and the fields hold a maker's supplier details, it is a leak.
 *    `fbq('set', 'autoConfig', false, id)` is called before `init`, which is
 *    Meta's documented switch and the only order in which it works.
 *
 * 3. NO advanced matching. www attaches a hashed email at signup because it has
 *    just been typed. This app never sends one. It does not need to: `_fbp` is
 *    written by fbevents.js against the registrable domain (`.batchlabel.xyz`),
 *    so a browser that has been to www already carries the same browser id here
 *    and the app's event lands on the same person without us sending anything
 *    extra. See docs/META_TRACKING.md.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE GATE
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * `granted` starts false and only `setMetaConsent(true)` opens it. That call
 * has exactly one caller — `MetaTrackingProvider` in `./meta-consent`, which
 * reads `brand_memberships.advertising_opt_in` under RLS with the maker's own
 * session. There is no cookie banner in this app and there must never be one:
 * see docs/CONSENT.md in the marketing repo, which is the model this obeys
 * rather than a second one invented here.
 *
 * The script is not fetched, `fbq` does not exist, and no Meta cookie is
 * written until that flag is known to be true. It is not loaded-then-suppressed.
 * Loading `fbevents.js` and hoping a flag holds it back is a different promise:
 * the request itself reaches Meta with the maker's IP and the URL they are on,
 * before any flag is consulted.
 *
 * WITHDRAWAL. `setMetaConsent(false)` does four things, because one is not
 * enough. (1) The gate closes, so nothing in this file emits again — absolute,
 * and not dependent on Meta honouring anything. (2) `fbq('consent', 'revoke')`,
 * Meta's own switch, stops the parts of the Pixel we do not drive. (3) The
 * script element is removed. (4) `_fbp` and `_fbc` are deleted, because they
 * are advertising identifiers written under a permission that has just been
 * taken away, and leaving them would let a later grant silently resume the same
 * identity.
 *
 * What cannot be done, stated rather than implied: JavaScript that has already
 * executed cannot be un-executed. The library stays in memory until the next
 * navigation. That is exactly why the primary gate is "never load without
 * consent" rather than "load and revoke".
 */

/**
 * The Pixel id. Public by design — it ships inside the page and anyone can read
 * it out of the network tab — which is why it is `VITE_` prefixed and why that
 * is safe. The Conversions API access token is the opposite of this and lives
 * only on the marketing site's server (`batch-label/src/server/meta-capi.ts`).
 * The two must never be confused.
 *
 * Absent by default. With no id configured every function here is a no-op, so
 * the app runs exactly as it did before until the founder sets it.
 */
const env = (import.meta as unknown as {env?: Record<string, string>;}).env;

export const META_PIXEL_ID: string = (env?.VITE_META_PIXEL_ID ?? '').trim();

/**
 * Loads the Pixel on localhost too, for verifying in Meta's Test Events tool
 * without deploying. Off unless the value is exactly "true", so it cannot be
 * left on by accident.
 */
const ALLOW_LOCAL = (env?.VITE_META_PIXEL_DEBUG ?? '').trim() === 'true';

const PIXEL_SRC = 'https://connect.facebook.net/en_US/fbevents.js';
const SCRIPT_ATTRIBUTE = 'data-bl-meta-pixel';

/** Meta's own identifiers, written by fbevents.js on the registrable domain. */
const META_COOKIES = ['_fbp', '_fbc'] as const;

/**
 * The Meta standard events this app raises. One entry, and that is the design.
 *
 * `PageView`, `ViewContent` and `CompleteRegistration` belong to www — they are
 * things that happen before or outside the product. `Purchase` is server-side
 * only, from www's Stripe webhook, because payment success is known there and
 * a browser event inflates on refunds, failed cards and redirect drop-off.
 * The full table is in docs/META_TRACKING.md.
 */
type AppMetaEventName = 'InitiateCheckout';

/**
 * Which upgrade control was pressed. Reported so app clicks stay separable.
 *
 * `billing-page` replaced `billing-settings` when billing moved out of Settings onto its own
 * route and became the place a purchase actually happens. The old value is kept rather than
 * renamed: events already sitting in the Meta dataset carry it, and dropping the union member
 * would make historical data unreadable against the current type for no gain.
 */
export type UpgradeSurface = 'plan-gate' | 'billing-page' | 'billing-settings';

type FbqCommand = (...args: unknown[]) => void;

interface FbqFunction extends FbqCommand {
  callMethod?: FbqCommand;
  queue?: unknown[];
  push?: unknown;
  loaded?: boolean;
  version?: string;
}

declare global {
  interface Window {
    fbq?: FbqFunction;
    _fbq?: FbqFunction;
  }
}

/**
 * Module state, deliberately not derived from `window.fbq`.
 *
 * `granted` is the gate every send checks. It starts false and only
 * `setMetaConsent` can open it, so a missing call, an early render or a thrown
 * exception all fail towards sending nothing.
 */
let granted = false;
let loaded = false;

/**
 * An id for an event that exists in exactly one place.
 *
 * The full deduplication contract lives in `batch-label/src/lib/meta-events.ts`
 * and is deliberately NOT copied here. That file is isomorphic because www has
 * two halves that must agree on an id; this app has one half and raises one
 * event with no server counterpart, so a derived id would deduplicate against
 * nothing. A second copy of that file in this repo would be a thing to drift.
 *
 * An event with no `eventID` at all cannot be deduplicated by a later server
 * event, so one is always sent even though nothing currently matches it.
 */
function randomEventId(): string {
  const c = typeof crypto !== 'undefined' ? crypto : undefined;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return `e.${Date.now().toString(36)}.${Math.random().toString(36).slice(2, 12)}`;
}

/** The current hostname, or '' where there is not one. Never throws. */
function hostname(): string {
  if (typeof window === 'undefined') return '';
  const h = window.location?.hostname;
  return typeof h === 'string' ? h : '';
}

/**
 * May the Pixel be loaded here at all, before consent is even considered?
 *
 * Pure, and takes its three inputs as arguments rather than reading them,
 * because a Vite bundle inlines `import.meta.env` per module and a test cannot
 * reach in and change it afterwards. Passing them in is the difference between
 * a test that proves the rule and a test that passes because the id happened to
 * be empty — which is a failure mode a consent test in particular must not
 * have.
 *
 * Development must not report into the live dataset, so localhost and friends
 * are excluded unless VITE_META_PIXEL_DEBUG is exactly "true". Same rule, same
 * host list, as www's.
 */
export function pixelCanLoad(pixelId: string, host: string, allowLocal: boolean): boolean {
  if (!pixelId) return false;
  if (allowLocal) return true;
  // No hostname at all is not a host we can prove is safe to measure from.
  if (!host) return false;
  return host !== 'localhost' && host !== '127.0.0.1' && host !== '::1' && !host.endsWith('.local');
}

/** Meta's bootstrap snippet, written out so it can be read. */
function installFbqStub() {
  if (window.fbq) return;
  const fbq = function (...args: unknown[]) {
    if (fbq.callMethod) {
      // `.apply` is what Meta's own snippet does, and `callMethod` is
      // fbevents.js's function rather than ours: spreading would drop the
      // `this` binding the library sets on it.
      // eslint-disable-next-line prefer-spread
      fbq.callMethod.apply(fbq, args);
    } else {
      fbq.queue?.push(args);
    }
  } as FbqFunction;
  fbq.queue = [];
  fbq.loaded = true;
  fbq.version = '2.0';
  // fbevents.js reads `push` off the function and expects it to be the function itself.
  fbq.push = fbq;
  window.fbq = fbq;
  if (!window._fbq) window._fbq = fbq;
}

function injectScript() {
  if (document.querySelector(`script[${SCRIPT_ATTRIBUTE}]`)) return;
  const script = document.createElement('script');
  script.async = true;
  script.src = PIXEL_SRC;
  script.setAttribute(SCRIPT_ATTRIBUTE, 'true');
  document.head.appendChild(script);
}

function removeScript() {
  document.querySelectorAll(`script[${SCRIPT_ATTRIBUTE}]`).forEach((node) => node.remove());
}

/**
 * Expires Meta's cookies.
 *
 * A cookie is only deleted by a Set-Cookie whose domain MATCHES the one it was
 * written with. fbevents.js writes against the registrable domain, and working
 * out which suffix that is needs a public suffix list (`batchlabel.xyz` is
 * registrable, `co.uk` is not). Rather than ship one, every parent domain down
 * to two labels is attempted: the browser silently ignores the ones it is not
 * allowed to set, so the only cost is a few no-ops and the one that matches
 * always lands. `undefined` covers a host-only cookie.
 *
 * This matters more here than on www. `_fbp` is shared across
 * `.batchlabel.xyz`, so a withdrawal handled in this tab has to clear the same
 * identifier www would clear, not a private copy of it.
 */
function clearMetaCookies() {
  if (typeof document === 'undefined') return;

  const host = hostname();
  const domains: (string | undefined)[] = [undefined];
  if (host) {
    domains.push(host);
    const parts = host.split('.');
    for (let i = 1; parts.length - i >= 2; i++) {
      domains.push(`.${parts.slice(i).join('.')}`);
    }
  }

  META_COOKIES.forEach((name) => {
    domains.forEach((domain) => {
      const scope = domain ? `; domain=${domain}` : '';
      document.cookie = `${name}=; path=/; max-age=0${scope}`;
    });
  });
}

/** Can we send anything at all right now? */
function ready(): boolean {
  return granted && loaded && typeof window !== 'undefined' && typeof window.fbq === 'function';
}

function load() {
  if (loaded || typeof window === 'undefined') return;
  if (!pixelCanLoad(META_PIXEL_ID, hostname(), ALLOW_LOCAL)) return;
  installFbqStub();
  injectScript();
  // Before init, and it only works before init. See the header: this is what
  // stops fbevents.js logging button text and form values from inside an
  // authenticated product without anybody having written the event.
  window.fbq?.('set', 'autoConfig', false, META_PIXEL_ID);
  // `init` with no advanced matching. There is no address to attach and sending
  // an empty user-data object is not the same as sending none.
  window.fbq?.('init', META_PIXEL_ID);
  loaded = true;
}

/**
 * The one place consent enters this module.
 *
 * Called by `MetaTrackingProvider` with the account flag every time it is read:
 * on mount, when the signed-in user changes, and when the tab is brought back
 * to the front (which is how a withdrawal made on www is noticed here).
 *
 * Idempotent. Being told the same answer twice does nothing at all, so a
 * re-read that confirms consent neither reloads the script nor emits anything.
 */
export function setMetaConsent(nextGranted: boolean) {
  const next = Boolean(nextGranted);
  if (next === granted) return;
  granted = next;

  if (granted) {
    // Load, and send nothing. www sends a PageView on this transition because
    // the page someone consented on is a page an ad paid for. Here it would be
    // a screen of somebody's product data, so the transition is silent and the
    // first thing sent is whatever the maker does next, if anything.
    load();
    return;
  }

  // Withdrawn. Our own gate is already shut by `granted = false` above; the
  // rest stops the parts of the Pixel we do not drive and removes what it kept.
  if (typeof window !== 'undefined' && typeof window.fbq === 'function') {
    window.fbq('consent', 'revoke');
  }
  removeScript();
  clearMetaCookies();
  loaded = false;
}

/**
 * The single send path. Every Meta event in this app goes through here.
 *
 * Private on purpose: a component importing this and inventing an event name
 * would be the moment the "one place that sends" property is lost. The exported
 * surface is one named function per event, and there is currently one.
 */
function trackMeta(name: AppMetaEventName, params: Record<string, unknown> = {}) {
  if (!ready()) return;
  window.fbq?.('track', name, params, { eventID: randomEventId() });
}

/**
 * The upgrade click, made inside the product.
 *
 * WHERE IT FIRES. The app has no checkout of its own and is not getting one:
 * plans are sold, changed and cancelled on www, next to the Stripe customer
 * portal. So the real, findable action here is a maker pressing an upgrade
 * control that takes them to www's pricing page — `PlanNotice` when the export
 * is gated behind a plan, and "Compare plans" in Settings → Billing. Those are
 * the two call sites and there are no others.
 *
 * WHERE IT DELIBERATELY DOES NOT FIRE. "Manage billing", "Update your card" and
 * "Go to your account" all leave for the same marketing site, and none of them
 * is somebody starting a purchase. A maker fixing a bounced card is not a new
 * checkout, and counting them as one would quietly inflate the number the ad
 * account optimises against.
 *
 * NO `value`, NO `currency`. On www the plan CTA knows which interval was
 * pressed, so £14 or £140 is a fact. Here the maker has chosen nothing yet, and
 * a made-up value would flow into Meta's ROAS reporting as though it were
 * revenue. An event with no value is worth less to the algorithm than a true
 * one and infinitely more than a false one.
 *
 * `checkout_origin` is carried so these stay separable from www's own
 * InitiateCheckout in Events Manager. The two are different actions by
 * different people at different moments and no cross-origin deduplication is
 * wanted between them — but a founder looking at a total should be able to
 * split it, and a custom parameter is the cheap way to make that possible.
 *
 * Delivery is best effort. This fires on a link that navigates to another
 * origin, so the browser may cut the beacon off mid-flight. That is worth
 * knowing and not worth a fragile fix: delaying the navigation to protect a
 * measurement would make the product slower for the maker in order to make the
 * number nicer for us.
 */
export function metaInitiateCheckout(surface: UpgradeSurface) {
  trackMeta('InitiateCheckout', {
    content_type: 'product',
    content_ids: ['maker'],
    content_name: 'Maker plan',
    checkout_origin: 'app',
    checkout_surface: surface
  });
}

/** Test seam. Exported so a test can assert the gate rather than infer it. */
export function metaPixelState(): {granted: boolean;loaded: boolean;} {
  return { granted, loaded };
}

/** Test seam. Resets module state between tests; never called by application code. */
export function resetMetaPixelForTests() {
  granted = false;
  loaded = false;
}
