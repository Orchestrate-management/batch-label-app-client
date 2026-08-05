# The `batchlabel` schema has to be exposed, and nothing in either repo sets it

Every domain read and write in this app goes through `supabase.schema('batchlabel')`
(`src/lib/domain.ts`). That works only because `batchlabel` is in the Supabase project's
PostgREST **Exposed schemas** list.

That list is a **project setting**. To be exact about what does and does not write it:

| | writes the exposed-schemas list on production? |
| --- | --- |
| `supabase db push` | no |
| a migration in `supabase/migrations` | no |
| `[api] schemas` in `supabase/config.toml` | **no** — that key is read by `supabase config push` and by local dev |
| the Supabase dashboard → Project Settings → API | yes |
| `supabase config push` from a linked branch | yes, to whatever that branch's config.toml says |
| the Management API | yes |

So `config.toml` listing `batchlabel` is necessary for local dev and proves nothing about
production. **A test that asserts the config declares it would pass on the day production
broke.** That is why there is no such test.

## What it looks like when it goes

PostgREST answers **every** domain request with `406` and:

```json
{ "code": "PGRST106", "message": "The schema must be one of the following: public, graphql_public" }
```

The code is decided before authentication and before row level security, which is why the
check below needs only the anon key.

Each of the five data layers turns that into its own sentence — "we could not read your
products just now", "we could not save that just now. Please try again" — every one of which
is true, sounds temporary, and offers a retry that cannot work.

## What catches it

`src/lib/domain-schema.ts` observes it **at the transport**: `observedFetch` is handed to
`createClient`, so every PostgREST request this app makes passes through it, including ones
written by someone who has never read that file. On a PGRST106 whose profile header is
`batchlabel` it latches, reports once through the `lib/report-error.ts` seam, and raises
`components/SchemaNotServed.tsx` above every screen — which is the only place that says the
part no individual screen can know: it will not clear, and nothing below it is a statement
about the maker's account.

Its own header argues why a config test, a deploy-only check and a dedicated boot probe were
not chosen instead.

## Verifying it by hand, in one line

```sh
curl -s -o /dev/null -w '%{http_code}\n' \
  -H "apikey: $VITE_SUPABASE_ANON_KEY" \
  -H "Accept-Profile: batchlabel" \
  "$VITE_SUPABASE_URL/rest/v1/products?select=id&limit=0"
```

- `200` — the schema is being served. (The body is `[]`: anon holds no rows, which is row
  level security answering correctly, and is not what this is measuring.)
- `406` — it is not. Add `batchlabel` back under Project Settings → API → Exposed schemas.

This asks PostgREST what it is actually serving, which is the thing that has to be true. It is
a diagnosis, not a guard: nothing runs it unless a human does.
