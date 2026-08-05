import { DOMAIN_SCHEMA } from './domain-schema';
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
 * PostgREST serves only the schemas the PROJECT exposes, and this comment used to name the
 * wrong file. `[api] schemas` in supabase/config.toml is read by `supabase config push` and by
 * local dev; it is NOT applied to a linked project by `supabase db push`, so on production the
 * list is the "Exposed schemas" setting in the Supabase project and nothing in either repo
 * writes it. Checking config.toml "first" would show a correct-looking line over a dead
 * deployment. What the reads actually 406 with, what notices, what says so and how to verify
 * it in one line is all in lib/domain-schema.ts and docs/SCHEMA_EXPOSURE.md.
 */
export { DOMAIN_SCHEMA } from './domain-schema';

/** The domain-scoped client, or null when Supabase is not configured at all. */
export const domainClient = () => (supabase ? supabase.schema(DOMAIN_SCHEMA) : null);

export const NOT_CONFIGURED_MESSAGE =
'This app is not connected to its database, so nothing can be saved. This is us, not you.';
