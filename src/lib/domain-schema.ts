import { hasErrorSink, reportError } from './report-error';

/**
 * WHETHER POSTGREST IS STILL SERVING THE `batchlabel` SCHEMA, AND HOW WE FIND OUT.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE FAULT THIS EXISTS FOR
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Every domain read and write in this app goes through `supabase.schema('batchlabel')`
 * (lib/domain.ts). That works because `batchlabel` is in the Supabase project's PostgREST
 * "Exposed schemas" list. THAT LIST IS A SETTING IN THE SUPABASE PROJECT. It is not created by
 * a migration, `supabase db push` does not set it, and `[api] schemas` in supabase/config.toml
 * does NOT apply it to a linked project — that key is read by `supabase config push` and by
 * local dev, and by nothing else. The comment in lib/domain.ts used to send the next
 * maintainer to that file first; it has been corrected, because sending somebody to a file
 * that cannot be the cause is how an hour goes.
 *
 * So the setting can change — a dashboard edit, a `config push` from a branch where the list
 * is shorter, a project restored from a template — with nothing in either repo touched, and
 * NOTHING IN EITHER REPO WOULD HAVE NOTICED. The failure is total: PostgREST answers every
 * single domain request 406 / PGRST106, and each of the five data layers turns that into its
 * own sentence, all of which sound temporary and every one of which offers a retry:
 *
 *     products     "We could not read your products just now. This is us, not you…"
 *     preferences  "We could not read your preferences just now. This is us, not you."
 *     requests     "We could not read your requests just now. This is us, not you."
 *     materials    "We could not read your materials just now…"
 *     any write    "We could not save that just now. Please try again."
 *
 * Five true sentences that together say something false: that this is weather. It is not
 * weather, it will not pass, the maker cannot affect it, and — the part that mattered most —
 * the one person who could fix it never heard about it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT CATCHES IT, AND WHY THE ALTERNATIVES DO NOT
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * CHOSEN: observe it at the transport. `observedFetch` below is handed to `createClient`, so
 * every PostgREST request this app makes passes through it — the ones written last night, the
 * ones written this morning, and the ones somebody writes next year without reading this file.
 * That is the property that matters. A classifier each data layer has to remember to call is
 * the same shape as the bug this repo keeps re-finding: correct at every site that knows about
 * it, and silent at the next one.
 *
 * NOT CHOSEN, a test that asserts config.toml lists the schema. The config is not what makes
 * it true. That test passes on the exact day production breaks, which makes it worse than
 * nothing — it is a green tick over a broken deployment.
 *
 * NOT CHOSEN AS THE ONLY GUARD, a CI or deploy check against the live REST endpoint. It is
 * genuinely useful and it is written down in docs/SCHEMA_EXPOSURE.md as a one-liner, but it
 * only ever runs when somebody deploys. The setting can change on a Tuesday with no deploy
 * that week, and the whole app is dead until the next one. It catches a change that happens to
 * precede a deploy and nothing else.
 *
 * NOT CHOSEN, a dedicated boot probe. It would be one extra request on every page load for
 * every maker, forever, to learn a moment earlier something the app's own first domain read
 * establishes anyway: `SettingsProvider`, `MaterialsProvider` and `ProductsProvider` all read
 * domain tables as soon as an account resolves, on every session. The observer latches on
 * whichever lands first.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * AND THEN IT IS SAID OUT LOUD, TWICE
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * To the maker, once, at the top of the shell (components/SchemaNotServed.tsx): the app names
 * the fault, says nothing of theirs has been lost, and says plainly that reloading will not
 * clear it — because every screen underneath is about to offer them a retry.
 *
 * To us, through the existing lib/report-error.ts seam, ONCE per page. Without that this is
 * still a fault only a customer finds out about, which is the actual complaint.
 */

/**
 * The Postgres schema holding the Batchlabel domain.
 *
 * It lives in this leaf module rather than in lib/domain.ts so that lib/supabase.ts can reach
 * `observedFetch` without importing lib/domain.ts, which imports lib/supabase.ts. domain.ts
 * re-exports it, so `import { DOMAIN_SCHEMA } from './domain'` still means what it always did.
 */
export const DOMAIN_SCHEMA = 'batchlabel';

/**
 * PostgREST's code for "the schema you asked for is not one I serve".
 *
 * 406, and it is decided before anything else: before authentication, before row level
 * security, before the table is looked at. That is why the check in docs/SCHEMA_EXPOSURE.md
 * needs only the anon key, and why this code cannot arrive for any other reason.
 */
const SCHEMA_NOT_EXPOSED_CODE = 'PGRST106';

/**
 * What the app says when it has seen that answer.
 *
 * It states the fault, states that nothing was lost, and REMOVES THE RETRY. Every data layer
 * below is about to say "just now" and offer a Try again button; this is the sentence that
 * stops a maker pressing it for twenty minutes.
 */
export const SCHEMA_NOT_SERVED_MESSAGE =
'Batchlabel cannot reach its own data. Our database is not serving the schema this app reads ' +
'from, so every read and every save is being refused. Nothing of yours has been lost and ' +
'nothing has been changed — but nothing on any screen is a statement about your account ' +
'either. This is a fault in our configuration, not on your machine, and reloading will not ' +
'clear it.';

/** The message filed through the error seam. A literal, so the scrubber can echo it whole. */
const REPORT_MESSAGE = `The ${DOMAIN_SCHEMA} schema is not exposed by PostgREST (PGRST106).`;

/** The `source` this files under. Listed in lib/scrub-report.ts KNOWN_SOURCES. */
const REPORT_SOURCE = 'domain-schema';

export type DomainSchemaState = 'unknown' | 'not-served';

/**
 * Deliberately two states and not three.
 *
 * There is no 'served'. A request that succeeded proves the schema was served for that
 * request; it does not establish that it will be for the next one, and a screen that read
 * 'served' as a fact would be asserting something one HTTP response cannot support. The only
 * thing worth latching is the observation that it is NOT, which is total and does not
 * intermittently resolve.
 */
let state: DomainSchemaState = 'unknown';

const listeners = new Set<() => void>();

export function domainSchemaState(): DomainSchemaState {
  return state;
}

/** For `useSyncExternalStore`. Returns the unsubscribe. */
export function subscribeToDomainSchema(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Cleared between tests. Nothing in the app calls this. */
export function resetDomainSchemaState() {
  state = 'unknown';
  listeners.clear();
}

/**
 * Recognises the answer in an error object supabase-js has already handed back.
 *
 * Exported so a data layer can name the failure in its own sentence if it wants to. It is NOT
 * how the app finds out — that is `observedFetch`, which needs nobody to remember it.
 */
export function isSchemaNotServed(error: {code?: string | null;} | null | undefined): boolean {
  return error?.code === SCHEMA_NOT_EXPOSED_CODE;
}

/**
 * `fallback` unless the error is the one this module is about.
 *
 * A data layer keeps its own voice for everything else; this only overrides the sentence in
 * the one case where "just now" and "try again" are both untrue.
 *
 * `settings-data.ts` uses it in `describeWriteFailure`, which every settings write goes
 * through — the write path is where it earns most, because a Save button is sitting beside
 * the sentence inviting exactly the retry that cannot work. The other four data layers are
 * covered by the banner rather than by their own copy, and this is here for whoever wants the
 * same one-liner in `products.ts`, `materials.ts`, `records.ts` or `evidence.ts`. NONE of them
 * is how the app FINDS OUT — that is `observedFetch`, which needs nobody to remember it.
 */
export function describeDomainFailure(
error: {code?: string | null;} | null | undefined,
fallback: string)
: string {
  return isSchemaNotServed(error) ? SCHEMA_NOT_SERVED_MESSAGE : fallback;
}

function noteSchemaNotServed() {
  if (state === 'not-served') return;
  state = 'not-served';
  // Once per page load. `reportError` de-duplicates by object identity, and a fresh Error
  // each time would defeat that — the latch above is what makes it once.
  reportError(new Error(REPORT_MESSAGE), REPORT_SOURCE);
  for (const listener of listeners) listener();
}

/** Whether a report filed from here actually leaves the device, so no screen may claim it did. */
export function schemaFaultWasReported(): boolean {
  return hasErrorSink();
}

/**
 * The profile header supabase-js puts on a schema-switched request.
 *
 * Reads carry `Accept-Profile`, writes carry `Content-Profile`. Read off whichever of the two
 * places the caller put its headers — `fetch(Request)` and `fetch(url, { headers })` are both
 * legal and postgrest-js has used both.
 */
function profileOf(input: RequestInfo | URL, init: RequestInit | undefined): string | null {
  try {
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    return headers.get('accept-profile') ?? headers.get('content-profile');
  } catch {
    return null;
  }
}

async function inspect(response: Response, profile: string | null) {
  try {
    const body = (await response.json()) as {code?: unknown;} | null;
    if (body?.code !== SCHEMA_NOT_EXPOSED_CODE) return;
    // THE SCHEMA NAME IS CHECKED RATHER THAN ASSUMED. This app switches to exactly one schema
    // today, so any PGRST106 is about `batchlabel` — but "today" is not a guarantee, and a
    // PGRST106 about some future sibling schema must not raise a banner saying the maker's
    // products are unreachable. That would be this repo's defect class wearing this module's
    // clothes. A request with no readable profile header cannot produce this code at all, so
    // there is nothing to fall back to.
    if (profile !== DOMAIN_SCHEMA) return;
    noteSchemaNotServed();
  } catch {
    // A 406 whose body we could not read establishes nothing, so nothing is claimed. The
    // request itself still fails and still reaches the maker as that data layer's own
    // sentence — this observer only ever adds a name, never removes one.
  }
}

/**
 * The fetch handed to `createClient`. Transparent: same request, same response, same timing.
 *
 * The body is only read on a 406, which PostgREST reserves for this and for a `.single()`
 * whose row count was wrong — so the parse costs nothing on any normal request. It runs on a
 * `clone()` and is not awaited, so the caller is never delayed by an observation.
 */
export const observedFetch: typeof fetch = async (input, init) => {
  const response = await fetch(input as RequestInfo, init);
  if (response.status === 406) void inspect(response.clone(), profileOf(input, init));
  return response;
};
