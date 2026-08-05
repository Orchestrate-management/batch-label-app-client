import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { render, screen } from '@testing-library/react';
import { SchemaNotServed } from '../components/SchemaNotServed';
import {
  DOMAIN_SCHEMA,
  describeDomainFailure,
  domainSchemaState,
  isSchemaNotServed,
  observedFetch,
  resetDomainSchemaState } from
'./domain-schema';
import { describeWriteFailure } from './settings-data';
import { setErrorSink, type ErrorReport } from './report-error';
import { scrubReport } from './scrub-report';

/**
 * THE ONE SETTING NOTHING IN EITHER REPO WOULD HAVE NOTICED CHANGING.
 *
 * Every domain read and write goes through `supabase.schema('batchlabel')`, which works only
 * because `batchlabel` is in the Supabase project's PostgREST exposed-schemas list. That list
 * is a PROJECT SETTING: no migration writes it, `supabase db push` does not write it, and
 * `[api] schemas` in supabase/config.toml is read by `supabase config push` and local dev and
 * applies to a linked project not at all.
 *
 * So it can change with nothing in either repo touched, and the failure is total — PostgREST
 * answers every domain request 406/PGRST106. Before this module the app's whole response was
 * five separately-worded shrugs:
 *
 *     products     "We could not read your products just now. This is us, not you…"
 *     preferences  "We could not read your preferences just now. This is us, not you."
 *     requests     "We could not read your requests just now. This is us, not you."
 *     materials    "We could not read your materials just now…"
 *     any write    "We could not save that just now. Please try again."
 *
 * Five true sentences that together say something false: that this is weather, that it will
 * pass, and that pressing Try again is worth doing. And nobody who could fix it was told.
 *
 * WHY THE OBSERVATION IS AT THE TRANSPORT AND NOT IN THE DATA LAYERS. A classifier each layer
 * has to remember to call is correct at the five sites that know about it and silent at the
 * sixth, which is this repo's recurring defect exactly. `observedFetch` is handed to
 * `createClient`, so a query written next year by somebody who has never opened this file is
 * covered by construction. That is the property under test below, and a test asserting
 * config.toml lists the schema would have none of it — it passes on the day production breaks.
 */

const NOT_EXPOSED_BODY = {
  code: 'PGRST106',
  details: null,
  hint: null,
  message: 'The schema must be one of the following: public, graphql_public'
};

function postgrest(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

let filed: ErrorReport[] = [];

beforeEach(() => {
  resetDomainSchemaState();
  filed = [];
  setErrorSink((report) => filed.push(report));
});

afterEach(() => {
  setErrorSink(null);
  resetDomainSchemaState();
  vi.unstubAllGlobals();
});

/**
 * Drives `observedFetch` and lets the observation finish.
 *
 * The inspection is deliberately NOT awaited by `observedFetch` — the maker's request must not
 * wait on an observation — so the response comes back first and the latch moves a tick later.
 * That ordering is the point of the design and it is why this helper has to settle.
 */
async function request(
response: Response,
headers: Record<string, string>)
: Promise<Response> {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));
  const answered = await observedFetch('https://example.supabase.co/rest/v1/products', {
    headers
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  return answered;
}

describe('noticing that PostgREST has stopped serving the domain schema', () => {
  it('starts out having observed nothing, rather than assuming it is fine', () => {
    // There is no 'served' state and that is deliberate. A request that succeeded proves the
    // schema was served for THAT request; it does not establish anything about the next one,
    // and a screen reading 'served' as a fact would assert what one response cannot support.
    expect(domainSchemaState()).toBe('unknown');
  });

  it('latches on a 406 PGRST106 carrying our schema in the profile header', async () => {
    await request(postgrest(406, NOT_EXPOSED_BODY), { 'Accept-Profile': DOMAIN_SCHEMA });
    expect(domainSchemaState()).toBe('not-served');
  });

  it('latches on a write, which sends Content-Profile rather than Accept-Profile', async () => {
    await request(postgrest(406, NOT_EXPOSED_BODY), { 'Content-Profile': DOMAIN_SCHEMA });
    expect(domainSchemaState()).toBe('not-served');
  });

  it('hands the response back untouched, so nothing downstream behaves differently', async () => {
    const answered = await request(postgrest(406, NOT_EXPOSED_BODY), {
      'Accept-Profile': DOMAIN_SCHEMA
    });
    expect(answered.status).toBe(406);
    // The body is still readable by the caller: the observation runs on a clone.
    await expect(answered.json()).resolves.toMatchObject({ code: 'PGRST106' });
  });

  it('says nothing about a healthy request', async () => {
    await request(postgrest(200, []), { 'Accept-Profile': DOMAIN_SCHEMA });
    expect(domainSchemaState()).toBe('unknown');
    expect(filed).toHaveLength(0);
  });

  it('says nothing about a 406 that is not this fault', async () => {
    // `.single()` over a row count that is not one is the other thing PostgREST answers 406
    // with, and it is an ordinary query result rather than a dead deployment.
    await request(
      postgrest(406, { code: 'PGRST116', message: 'JSON object requested, multiple rows' }),
      { 'Accept-Profile': DOMAIN_SCHEMA }
    );
    expect(domainSchemaState()).toBe('unknown');
  });

  it('says nothing about a PGRST106 raised over some OTHER schema', async () => {
    // The one this file could most easily have got wrong. A sibling brand's schema going
    // missing must not raise a banner telling a Batchlabel maker their own products are
    // unreachable — that is the defect class this module exists to close, wearing this
    // module's clothes.
    await request(postgrest(406, NOT_EXPOSED_BODY), { 'Accept-Profile': 'somebody_else' });
    expect(domainSchemaState()).toBe('unknown');
  });

  it('files it through the error seam, once, in a form the scrubber keeps whole', async () => {
    await request(postgrest(406, NOT_EXPOSED_BODY), { 'Accept-Profile': DOMAIN_SCHEMA });
    await request(postgrest(406, NOT_EXPOSED_BODY), { 'Accept-Profile': DOMAIN_SCHEMA });

    // Once per page load, not once per failed request — and every request fails.
    expect(filed).toHaveLength(1);
    expect(filed[0].source).toBe('domain-schema');

    // AND IT SURVIVES THE ALLOW-LIST. lib/scrub-report.ts replaces anything it cannot
    // positively recognise, so an unlisted message and an unlisted source arrive as
    // "[redacted]" twice over — a report that tells us the app is dead and not which app.
    const scrubbed = scrubReport(filed[0], null, new Set<string>());
    expect(scrubbed.source).toBe('domain-schema');
    expect(scrubbed.message).toBe(
      'The batchlabel schema is not exposed by PostgREST (PGRST106).'
    );
  });
});

describe('against supabase-js itself, rather than against an assumption about it', () => {
  /**
   * THE ONE ASSUMPTION EVERYTHING ABOVE RESTS ON, CHECKED RATHER THAN BELIEVED.
   *
   * The observer only latches when the request carried a profile header naming our schema.
   * That is deliberate — a PGRST106 about some future sibling schema must not tell a
   * Batchlabel maker their products are unreachable — but it means the guard is worth exactly
   * as much as the claim that `supabase.schema('batchlabel')` really sets that header, spelt
   * that way. If postgrest-js ever stopped, or renamed it, every test above would still be
   * green over a guard that had quietly stopped guarding.
   *
   * So this drives the real client through the real chain and reads what went on the wire.
   */
  it('latches on a real .schema().from().select() that PostgREST refuses', async () => {
    const seen: Array<Record<string, string>> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        const headers: Record<string, string> = {};
        new Headers(init?.headers).forEach((value, key) => (headers[key] = value));
        seen.push(headers);
        return postgrest(406, NOT_EXPOSED_BODY);
      })
    );

    // Built exactly as lib/supabase.ts builds it — the observer is a transport option, so a
    // client assembled without it is a client this module cannot see.
    const client = createClient('https://example.supabase.co', 'anon-key', {
      global: { fetch: observedFetch }
    });
    await client.schema(DOMAIN_SCHEMA).from('products').select('id');
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(seen[0]['accept-profile']).toBe(DOMAIN_SCHEMA);
    expect(domainSchemaState()).toBe('not-served');
  });

  it('is actually wired into the client the app ships', () => {
    // The module above cannot observe anything it is not handed to, and it is handed over in
    // one line in one file. A refactor that drops that line leaves every test in this file
    // green and the app blind again, which is the only way this guard can fail silently.
    const source = readFileSync(resolve(__dirname, 'supabase.ts'), 'utf8');
    expect(source).toMatch(/global:\s*\{\s*fetch:\s*observedFetch\s*\}/);
    expect(source).toMatch(/from '\.\/domain-schema'/);
  });
});

describe('the classifier, for a data layer that wants to name it in its own voice', () => {
  it('recognises the code and nothing else', () => {
    expect(isSchemaNotServed({ code: 'PGRST106' })).toBe(true);
    expect(isSchemaNotServed({ code: '42501' })).toBe(false);
    expect(isSchemaNotServed(null)).toBe(false);
    expect(isSchemaNotServed(undefined)).toBe(false);
  });

  it('leaves every other failure in the caller\'s own words', () => {
    const own = 'We could not read your products just now.';
    expect(describeDomainFailure({ code: '42501' }, own)).toBe(own);
    expect(describeDomainFailure({ code: 'PGRST106' }, own)).not.toBe(own);
    expect(describeDomainFailure({ code: 'PGRST106' }, own)).toMatch(/reloading will not/i);
  });

  it('is what a settings write says, because a Save button sits beside that sentence', () => {
    // The banner is above every screen, but the sentence next to the button is the one being
    // read at the moment somebody decides whether to press it again.
    expect(describeWriteFailure({ code: 'PGRST106', message: 'schema must be one of' })).toMatch(
      /reloading will not clear it/i
    );
    // And nothing else moved: the constraint sentences and the RLS refusal are unchanged.
    expect(describeWriteFailure({ code: '42501', message: 'row-level security' })).toMatch(
      /did not accept that change/i
    );
    expect(describeWriteFailure({ code: '23514', message: 'whatever' })).toBe(
      'We could not save that just now. Please try again.'
    );
  });
});

describe('what the maker is told', () => {
  it('shows nothing at all until the fault has actually been observed', () => {
    render(<SchemaNotServed />);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('names the fault and removes the retry every screen below is about to offer', async () => {
    render(<SchemaNotServed />);
    await request(postgrest(406, NOT_EXPOSED_BODY), { 'Accept-Profile': DOMAIN_SCHEMA });

    const alert = await screen.findByRole('alert');
    // The part no individual screen can know from its own error.
    expect(alert).toHaveTextContent(/reloading will not clear it/i);
    expect(alert).toHaveTextContent(/nothing of yours has been lost/i);
    expect(alert).toHaveTextContent(/fault in our configuration, not on your machine/i);
    // And the part that makes the five "we could not read your X just now" sentences legible
    // instead of misleading.
    expect(alert).toHaveTextContent(/nothing on any screen is a statement about your account/i);
  });

  it('does not claim it reached us on a build with nowhere to send it', async () => {
    // Same discipline as the crash screen: `hasErrorSink()` is false with no VITE_SENTRY_DSN,
    // and "we have been told" is the easiest sentence in the app to make permanently false.
    setErrorSink(null);
    render(<SchemaNotServed />);
    await request(postgrest(406, NOT_EXPOSED_BODY), { 'Accept-Profile': DOMAIN_SCHEMA });

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/has NOT reached us automatically/i);
  });

  it('claims it only once there is somewhere for it to go', async () => {
    setErrorSink(() => {});
    render(<SchemaNotServed />);
    await request(postgrest(406, NOT_EXPOSED_BODY), { 'Accept-Profile': DOMAIN_SCHEMA });

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/has been reported to us automatically/i);
  });
});
