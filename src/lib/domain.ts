import { supabase } from './supabase';

/**
 * The Postgres schema holding the Batchlabel domain, and the client scoped to it.
 *
 * ONE COPY, AND THE MERGE IS WHY IT IS ONE. This started private in products.ts. Four data
 * layers were then built in parallel — evidence.ts, materials.ts, records.ts, settings-data.ts
 * — and every one of them wrote out its own `const DOMAIN_SCHEMA = 'batchlabel'` and its own
 * one-line `domainClient`, each with a comment explaining that it was deliberately duplicated.
 * Four deliberate duplications of a string is not four decisions, it is one missing module,
 * and this is it. Importing from products.ts instead would have made a cycle: products.ts
 * reads the log on every product read, so the arrow already points the other way.
 *
 * The cost of the duplication is not stylistic. A copy that survives one rename and not the
 * next reads the WRONG SCHEMA, and reading the wrong schema does not error: PostgREST 404s, or
 * `public` answers with an empty decoy table, and the screen says "you have nothing" in a calm
 * voice. On the records screen that sentence is a false negative on a recall.
 *
 * The argument for the schema itself is in the header of
 * supabase/migrations/20260804120000_brand_namespacing.sql (in the www repo): `products` and
 * `specifications` moved out of `public` so that a sibling Orchestrate brand can have its own
 * table called `products` meaning stock. Identity, consent, billing and the entitlements view
 * stay in `public` and are read through the plain client.
 *
 * PostgREST serves only the schemas listed in `[api] schemas` in supabase/config.toml. If
 * these reads start 404ing, check that list first: the table exists and the client is asking
 * the right question, but the API has not been told the schema is servable.
 */
export const DOMAIN_SCHEMA = 'batchlabel';

/** The domain-scoped client, or null when Supabase is not configured at all. */
export const domainClient = () => (supabase ? supabase.schema(DOMAIN_SCHEMA) : null);

export const NOT_CONFIGURED_MESSAGE =
'This app is not connected to its database, so nothing can be saved. This is us, not you.';
