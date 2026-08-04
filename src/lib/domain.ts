import { supabase } from './supabase';

/**
 * The Postgres schema holding the Batchlabel domain, and the client scoped to it.
 *
 * LIFTED OUT OF products.ts RATHER THAN COPIED. It was private there, and the second module
 * that needed it (evidence.ts, which reads and writes the append-only record log) would
 * otherwise have had to either duplicate the string or import from products.ts and create a
 * cycle — products.ts now reads the log on every product read, so the arrow already points the
 * other way. A duplicated schema name is the kind of thing that survives one rename and not
 * two, and reading the wrong schema does not error: it 404s or returns an empty decoy table,
 * and the screen says "you have nothing" in a calm voice.
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
