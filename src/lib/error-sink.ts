import type { BrowserOptions, ErrorEvent } from '@sentry/react';
import { setErrorSink, type ErrorReport } from './report-error';
import { scrubReport, type ScrubbedReport } from './scrub-report';

/**
 * The one screw entry 6 of docs/PRODUCTION_TODO.md left to turn.
 *
 * `src/lib/report-error.ts` has been a seam since the shell stream: every call
 * site already calls `reportError`, and `setErrorSink()` was exported and called
 * by nothing, so every report has been a structured `console.error` on the
 * maker's own machine. Nobody watches a customer's console, so we have found out
 * about faults when somebody wrote in. This file is the transport, and it is the
 * only file that had to be written to add one — not one `reportError` call site
 * moved, and this module is imported by exactly one line of `src/index.tsx`.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * IT IS COMPLETE AND IT IS INERT WITHOUT A DSN
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * With `VITE_SENTRY_DSN` unset, `installErrorSink()` installs NO SINK AT ALL —
 * not a disabled one, not a buffering one. `hasErrorSink()` therefore stays
 * false, and the crash screen goes on telling the customer "This has not reached
 * us automatically", which on that build is true. That sentence is gated on the
 * seam rather than hard-coded precisely so it stops being printed by itself on
 * the day a DSN exists, and so it cannot become a lie in either direction.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * NOTHING LEAVES THAT HAS NOT BEEN THROUGH THE SCRUBBER
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * This app turns a supplier's Safety Data Sheet into a compliant CLP label, so
 * an exception message can carry a supplier name, a formulation percentage or a
 * product that has not launched, and a URL can carry a product id. `scrubReport`
 * in `lib/scrub-report.ts` is an allow-list over exactly that, and it is pure and
 * separately tested because "what leaves the machine" must be readable in one
 * file rather than emergent from an integration.
 *
 * A SCRUBBER THE SDK ROUTES AROUND IS NOT A SCRUBBER, so this file also has to
 * stop @sentry/react collecting on its own account. It does that three ways:
 *
 *   1. `defaultIntegrations: false` with `integrations: []`. Out of the box the
 *      browser SDK installs breadcrumbs (console, DOM clicks, fetch, XHR and
 *      history — i.e. a transcript of the maker's session), global error and
 *      rejection handlers, an HttpContext integration that attaches the page URL,
 *      culture context, and session tracking. Every one of those captures
 *      something we did not choose. All of them are off. The two window listeners
 *      this app wants are its own (lib/global-errors.ts) and they feed the seam.
 *   2. `dataCollection` with every category set to false, so no cookies, no
 *      headers, no bodies, no query parameters and no stack-frame variables are
 *      collected even if some future integration would like to — and, the one
 *      that no allow-list here could have caught, `userInfo: false`, which is
 *      what puts `infer_ip: "never"` on the wire and stops Sentry taking the
 *      maker's IP address off the request. See NOTHING_COLLECTED_BY_THE_SDK.
 *   3. `beforeSend` DROPS ANY EVENT THAT DID NOT COME THROUGH `send` below —
 *      see SCRUBBED_TAG. Someone reaching for `Sentry.captureException(error)`
 *      directly, in a year, would otherwise ship a raw message. Now it silently
 *      sends nothing instead, which is the right way for that mistake to fail.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * REGION
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * The project's data region is carried IN the DSN — `@sentry/core`'s
 * `getEnvelopeEndpointWithUrlEncodedAuth` builds the ingest URL out of the DSN's
 * own host — so an EU project's DSN (`…ingest.de.sentry.io`) routes to the EU
 * host with no code change and no hostname written down anywhere. There is
 * deliberately no host, no `region` option and no `tunnel` here: a hardcoded
 * ingest host is a thing that silently stops matching the DSN.
 */

/**
 * Read once, at module load, the same way lib/meta-pixel.ts reads its Pixel id.
 *
 * Vite inlines `import.meta.env` per module at build time, so this cannot be
 * changed from a test — which is exactly why `installErrorSink` takes the DSN as
 * an argument and this constant is only its default. A test that could not vary
 * the DSN would be a test of whatever the build happened to bake in.
 */
const env = (import.meta as unknown as {env?: Record<string, string>;}).env;

export const SENTRY_DSN: string = (env?.VITE_SENTRY_DSN ?? '').trim();

/** 'production' or 'development' from Vite. Build metadata, not anybody's data. */
const ENVIRONMENT: string = (env?.MODE ?? 'production').trim() || 'production';

/**
 * The tag `beforeSend` looks for, and the value only this module can put in it.
 *
 * IT USED TO BE THE LITERAL 'yes', AND THAT MADE THE GATE A LABEL RATHER THAN A
 * PROVENANCE CHECK. The gate advertises itself as the thing that makes a stray
 * `Sentry.captureException` in some other file harmless — but one
 * `Sentry.setTag('scrubbed', 'yes')` on a scope, anywhere, and every event that
 * scope touches is waved through with a raw exception message and absolute file
 * paths on it. Nothing in the app does that today; the point is that the promise
 * was unenforced, and a gate whose key is written down next to the lock is not a
 * gate.
 *
 * So the value is minted here, at module load, from the platform CSPRNG, and it
 * is not exported. `eventFor` is the only thing that can put it on an event and
 * `gateOutgoingEvent` is the only thing that reads it; nothing outside this file
 * can guess it and nothing outside this module can name it.
 *
 * IT DOES NOT GO ON THE WIRE. The gate swaps it for the literal 'yes' on the way
 * out, so the issue list still carries the fact that an event was scrubbed and
 * the transmitted bytes do not carry a value that would let the next event forge
 * it. Random per page load rather than per build for the same reason: a constant
 * baked into the bundle is a constant an attacker can read out of the bundle.
 */
const SCRUBBED_TAG = 'scrubbed';

/** What the tag says on the wire once the gate has checked the real mark. */
const SCRUBBED_ON_THE_WIRE = 'yes';

function mintScrubberMark(): string {
  try {
    const source = (globalThis as {crypto?: {getRandomValues?: <T>(array: T) => T;};}).crypto;
    if (source?.getRandomValues) {
      const words = source.getRandomValues(new Uint32Array(4));
      return Array.from(words, (word) => word.toString(16).padStart(8, '0')).join('');
    }
  } catch {
    // No crypto, or a hostile one. Fall through — this is a latch, not a key,
    // and it must never be the reason a crash report fails to be built.
  }
  let out = '';
  for (let index = 0; index < 4; index += 1) {
    out += Math.floor(Math.random() * 0x1_0000_0000).toString(16).padStart(8, '0');
  }
  return out;
}

const SCRUBBER_MARK = mintScrubberMark();

/**
 * Is this a DSN, or is it a leftover, a placeholder or half a copy-paste?
 *
 * Worth checking because of what the alternative failure looks like: `init` with
 * a malformed DSN returns a disabled client, we install a sink anyway,
 * `hasErrorSink()` goes true, the crash screen stops saying "this has not
 * reached us" — and nothing has reached us. A wrong environment variable would
 * turn one sentence of customer-facing copy into a lie, silently. So the shape
 * is checked before anything is installed, and the client `init` returns is
 * checked after.
 *
 * Shape only, and deliberately no host list: the region lives in the host and
 * pinning it here is how an EU project ends up posting at a US ingest.
 */
export function looksLikeDsn(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;
    // publicKey@host/projectId — a DSN without a key or a project id is not one.
    if (url.username.length === 0) return false;
    if (url.hostname.length === 0) return false;
    return /^\/+[\w/-]+$/.test(url.pathname);
  } catch {
    return false;
  }
}

/* ─────────────────────────────────────────────── the shape of what we use of Sentry */

/**
 * The two functions this file needs, and no more of the vendor than that.
 *
 * `BrowserOptions` and `ErrorEvent` are imported as TYPES ONLY, which matters
 * twice. It is erased at build time, so naming them costs the entry graph
 * nothing and the vendor is still fetched on demand (see `loadSentry`). And it
 * makes `sentryOptionsFor` a CHECKED claim rather than a hopeful one: every
 * switch turned off down there is checked against the real option list at
 * compile time, so a misspelled `defaultIntegrations` — which would silently
 * leave every default integration running and every default capture on — is a
 * typecheck failure rather than a leak nobody notices.
 */
interface SentryEvent {
  [key: string]: unknown;
  tags?: Record<string, unknown>;
}

export interface SentryLike {
  init: (options: BrowserOptions) => unknown;
  captureEvent: (event: SentryEvent) => unknown;
}

/**
 * The keys of an event that may be transmitted.
 *
 * The second gate, and it is aimed at the SDK rather than at us. `beforeSend`
 * runs after Sentry has prepared the event, which is where it would have merged
 * in anything a scope, an integration or a future version of the client decided
 * to attach — `request` (the page URL), `user`, `breadcrumbs`, `contexts`,
 * `server_name`. The integrations that add those are all switched off, so on
 * today's version this list removes nothing; it exists so that turning one back
 * on by accident, or an SDK upgrade that adds a field, cannot post something new
 * without a diff to this line.
 */
const EVENT_FIELDS_THAT_MAY_LEAVE = [
'event_id',
'timestamp',
'platform',
'level',
'environment',
'release',
'exception',
'fingerprint',
'tags',
'extra',
'sdk'];


/**
 * The keys inside `tags` and `extra` that may be transmitted.
 *
 * The top-level list above is not enough on its own, because `tags` and `extra`
 * are the two bags anybody can add to from anywhere: one `Sentry.setTag('product',
 * name)` or `Sentry.setExtra('sds', sheet)` on a scope, in any file, at any time,
 * and the value is merged into every event this app sends without going near the
 * scrubber. Nothing does that today. These lists mean nothing can start.
 */
const TAG_KEYS_THAT_MAY_LEAVE = [SCRUBBED_TAG, 'reference', 'source', 'route', 'message_recognised'];
const EXTRA_KEYS_THAT_MAY_LEAVE = ['message_digest', 'component_trail'];

function pick(value: unknown, keys: string[]): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const source = value as Record<string, unknown>;
  const kept: Record<string, unknown> = {};
  for (const key of keys) {
    if (source[key] !== undefined) kept[key] = source[key];
  }
  return kept;
}

/**
 * Everything not named above, removed — at the top level and inside the two bags.
 *
 * Generic so that the real `ErrorEvent` can go through it without a cast at the
 * call site: the shape that comes out is the shape that went in, minus fields.
 * Exported so a test can put a real prepared event through it.
 */
export function keepOnlyAllowedEventFields<T extends object>(event: T): T {
  const source = event as Record<string, unknown>;
  const kept: Record<string, unknown> = {};
  for (const key of EVENT_FIELDS_THAT_MAY_LEAVE) {
    if (source[key] !== undefined) kept[key] = source[key];
  }
  if (kept.tags !== undefined) kept.tags = pick(kept.tags, TAG_KEYS_THAT_MAY_LEAVE);
  if (kept.extra !== undefined) kept.extra = pick(kept.extra, EXTRA_KEYS_THAT_MAY_LEAVE);
  return kept as T;
}

/**
 * The Sentry event built from a scrubbed report, and from nothing else.
 *
 * Exported for the test, which is the point: the assertion worth making about
 * this integration is "given this report, exactly these bytes leave", and that
 * is only assertable if the bytes are the return value of a function.
 *
 * The frames are reversed because Sentry renders a stack oldest-first, while
 * `error.stack` — and therefore `scrubStack` — is newest-first.
 */
export function eventFor(scrubbed: ScrubbedReport): SentryEvent {
  const at = Date.parse(scrubbed.at);
  return {
    level: 'error',
    ...(Number.isFinite(at) ? { timestamp: at / 1000 } : {}),
    exception: {
      values: [
      {
        type: scrubbed.name,
        value: scrubbed.message,
        stacktrace: {
          // No `function`: see scrubStack in lib/scrub-report.ts. filename +
          // lineno + colno is what Sentry's source-map resolution needs to name
          // the real symbol, and a function name is the one thing V8 will infer
          // from a maker's own data.
          frames: scrubbed.frames.
          slice().
          reverse().
          map((frame) => ({
            filename: frame.filename,
            lineno: frame.lineno,
            colno: frame.colno,
            in_app: frame.filename.startsWith('/assets/')
          }))
        }
      }]

    },
    // GROUPED BY US, NOT BY SENTRY. Its default grouping reads the exception
    // value, and ours is `[unrecognised:1a2b]` for anything we did not
    // recognise — so the digest is what separates two different unknown faults,
    // and it has to be said out loud or every unknown error lands in one issue.
    //
    // AND IT IS WHY THE INNER `[redacted:…]` TAGS WERE FREE TO DELETE: grouping
    // reads this line and nothing else, so a fingerprint on every redacted value
    // was a guessing oracle bought for no triage at all. See scrub-report.ts.
    fingerprint: [scrubbed.name, scrubbed.messageDigest],
    tags: {
      // The real mark, which `gateOutgoingEvent` swaps for 'yes' before this
      // leaves. See SCRUBBED_TAG.
      [SCRUBBED_TAG]: SCRUBBER_MARK,
      reference: scrubbed.reference,
      source: scrubbed.source,
      route: scrubbed.route,
      // Visible in the issue list on purpose: a rising count of unrecognised
      // messages is the signal that lib/scrub-report.ts needs a pattern adding.
      message_recognised: scrubbed.messageRecognised ? 'yes' : 'no'
    },
    extra: {
      message_digest: scrubbed.messageDigest,
      component_trail: scrubbed.components
    }
  };
}

/* ─────────────────────────────────────────────── what the SDK may collect itself */

type DataCollection = NonNullable<BrowserOptions['dataCollection']>;

/**
 * `dataCollection` with EVERY CATEGORY REQUIRED, so a new one is a typecheck failure.
 *
 * THE OPTION IS A DENY-LIST AT THE SDK LAYER AND IT DEFAULTS THE WRONG WAY. Read
 * `resolveDataCollectionOptions` in @sentry/core: the moment `dataCollection` is
 * non-null it switches its baseline to a DEFAULTS object in which every value is
 * TRUE, and then fills each unset key from it. So `dataCollection: {}` is not
 * "collect nothing", it is "collect everything" — proved on the wire, where it
 * produces `sdk.settings.infer_ip: "auto"` despite the SDK's own type doc saying
 * `userInfo` defaults to false. Delete the one key `userInfo` from the object
 * below and the same thing happens: Relay takes the end-user's IP address off
 * the request and stores it on every event this app files.
 *
 * THE TWO ALLOW-LISTS IN THIS FILE CANNOT BACK THAT UP, which is why the type is
 * doing the work instead. `createEventEnvelope` calls `_enhanceEventWithSdkInfo`
 * AFTER `beforeSend` has returned, so `keepOnlyAllowedEventFields` never sees
 * `sdk.settings` and `scrubReport` is irrelevant to it. There is no runtime gate
 * downstream of this object; there is only this object.
 *
 * `Required<…>` over the SDK's own type means a category added in a minor
 * release — which under the rule above would arrive switched ON — fails
 * `npm run typecheck` with "property missing" rather than shipping quietly. The
 * nested bags are re-required for the same reason. `queryParams` is excluded
 * deliberately: it is the SDK's deprecated alias for `urlQueryParams`, which is
 * set below, and the resolver reads it only when `urlQueryParams` is unset.
 */
type EveryDataCollectionCategory = Required<Omit<DataCollection, 'queryParams'>> & {
  httpHeaders: Required<NonNullable<DataCollection['httpHeaders']>>;
  graphQL: Required<NonNullable<DataCollection['graphQL']>>;
  genAI: Required<NonNullable<DataCollection['genAI']>>;
};

const NOTHING_COLLECTED_BY_THE_SDK: EveryDataCollectionCategory = {
  userInfo: false,
  cookies: false,
  httpHeaders: { request: false, response: false },
  httpBodies: [],
  urlQueryParams: false,
  graphQL: { document: false, variables: false },
  genAI: { inputs: false, outputs: false },
  databaseQueryData: false,
  stackFrameVariables: false,
  frameContextLines: 0
};

/**
 * Everything handed to `Sentry.init`, as a value, so a test can read it.
 *
 * Written out in full rather than trimmed to "the ones that differ from the
 * default", because the defaults are the thing being defended against and a
 * default that changes in a minor release should not change what this app
 * collects. Every line below is either off, or something we chose.
 */
export function sentryOptionsFor(dsn: string): BrowserOptions {
  return {
    dsn,
    environment: ENVIRONMENT,
    // See the header: the region is in the DSN. No host, no `tunnel`.
    defaultIntegrations: false,
    integrations: [],
    // Breadcrumbs are a transcript of a maker's session — every click, every
    // console line, every fetch. The integration is already gone with the
    // defaults; these make it two more things to undo rather than one.
    maxBreadcrumbs: 0,
    beforeBreadcrumb: () => null,
    // Tracing and replay are separate integrations and are not installed. Zero
    // is written down so that adding one later is a decision rather than a
    // side effect of a copy-pasted config.
    tracesSampleRate: 0,
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,
    // captureMessage only; nothing here uses it. Off so it cannot start
    // attaching a synthetic stack we never scrubbed.
    attachStacktrace: false,
    enableLogs: false,
    enableMetrics: false,
    // Client reports are counts of dropped events. No customer data in them,
    // and no reason for this app to be making a second kind of request.
    sendClientReports: false,
    // Default 'always' REWRITES the app's own error messages, appending the
    // request hostname — which here would be the Supabase project host, added
    // to an Error a maker's screen may go on to display. Off.
    enhanceFetchErrorMessages: false,
    // Every category, off, and exhaustive by construction — see
    // NOTHING_COLLECTED_BY_THE_SDK for why the type is load-bearing here and
    // why `userInfo: false` in particular is the only thing standing between a
    // maker's IP address and Sentry. `sendDefaultPii` is the deprecated single
    // switch for the same thing; setting both means one is ignored, so only
    // this is set.
    dataCollection: NOTHING_COLLECTED_BY_THE_SDK,
    /**
     * The last gate before the network, and the one that catches us rather than
     * the SDK: an event without the scrubber's mark is dropped whole. See the
     * header — this is what makes a stray `Sentry.captureException(error)`
     * somewhere else in the app send nothing at all instead of sending a
     * customer's formulation values.
     */
    beforeSend: gateOutgoingEvent
  };
}

/**
 * The last gate before the network. Exported so the test can put an event through
 * it directly as well as through the real client.
 *
 * The check is against the minted mark, not against a word — see SCRUBBED_TAG —
 * so an event carrying `scrubbed: 'yes'` set on a scope by some other file is
 * dropped exactly like an unmarked one. The mark is then replaced by 'yes' so it
 * is the FACT and not the value that leaves.
 */
export function gateOutgoingEvent(event: ErrorEvent): ErrorEvent | null {
  if (!event || event.tags?.[SCRUBBED_TAG] !== SCRUBBER_MARK) return null;
  const kept = keepOnlyAllowedEventFields(event);
  if (kept.tags) kept.tags = { ...kept.tags, [SCRUBBED_TAG]: SCRUBBED_ON_THE_WIRE };
  return kept;
}

/* ────────────────────────────────────────────────────────────────── installing */

/**
 * The vendor, fetched on demand.
 *
 * TWO NAMED BINDINGS, NOT THE NAMESPACE, AND THE DIFFERENCE IS 130 kB GZIP.
 * `@sentry/react` re-exports the whole of `@sentry/browser` — session replay,
 * user feedback, a browser-tracing integration for every router anyone has ever
 * shipped — and taking the module object (`import(…).then((m) => m as …)`)
 * makes every one of those reachable, because anything can be read off a
 * namespace. Rollup emitted a 494 kB chunk. Destructuring names exactly two
 * functions, so it emits what those two need and nothing else. It is off the
 * critical path either way; a maker still downloads it, and downloading half a
 * megabyte of replay machinery that this file has switched off is not free
 * because it is late.
 *
 * The casts are the one place this file admits `SentryLike` is a narrower
 * description of a much larger module. Describing the two functions we use in
 * our own terms is what keeps the vendor's surface — and the temptation to
 * reach for the rest of it — out of the app.
 */
function loadSentry(): Promise<SentryLike> {
  return import('@sentry/react').then(({ init, captureEvent }) => ({
    init,
    captureEvent: captureEvent as unknown as SentryLike['captureEvent']
  }));
}

/** The page's URL, or null where there is not one. Never throws. */
function currentHref(): string | null {
  try {
    if (typeof window === 'undefined') return null;
    const href = window.location?.href;
    return typeof href === 'string' ? href : null;
  } catch {
    return null;
  }
}

/**
 * Install the transport, if there is one to install.
 *
 * Both arguments are defaulted so the call site in `src/index.tsx` is one word,
 * and both are arguments so the test can vary them — the DSN because
 * `import.meta.env` is inlined at build time and cannot be stubbed, and the
 * loader because a unit test should not be posting to Sentry.
 *
 * LOADED DYNAMICALLY, AND THAT IS A TRADE WORTH KNOWING. A static import would
 * put ~30 kB gzip of vendor code into the entry graph — the set a maker must
 * download before route `/` can draw anything, which entry 8 measured and which
 * this repo prints on every build. Telemetry does not belong in front of the
 * first paint. The cost is that a crash in the few hundred milliseconds before
 * the chunk lands reaches the console and nothing else; during that window
 * `hasErrorSink()` is false and the crash screen says so, so the customer is not
 * told anything untrue. It is deliberately NOT buffered: a queue would make
 * `hasErrorSink()` true while the report was still on the device and might never
 * leave it, which is the one thing that sentence must not do.
 *
 * Never throws and never rejects. A telemetry integration that can break the
 * boot of a compliance tool has its priorities backwards.
 */
export async function installErrorSink(
dsn: string = SENTRY_DSN,
load: () => Promise<SentryLike> = loadSentry)
: Promise<boolean> {
  if (!dsn || !looksLikeDsn(dsn)) return false;
  try {
    const sentry = await load();
    // `init` returns undefined when the SDK has decided not to run — a
    // malformed DSN, or an embedded browser extension. No client, no sink, and
    // the crash screen goes on being honest about it.
    const client = sentry.init(sentryOptionsFor(dsn));
    if (!client) return false;
    setErrorSink((report: ErrorReport) => {
      sentry.captureEvent(eventFor(scrubReport(report, currentHref())));
    });
    return true;
  } catch {
    // A chunk that never arrived, or an SDK that threw on init. Reports keep
    // going to the console, `hasErrorSink()` stays false, and the app is
    // untouched.
    return false;
  }
}
