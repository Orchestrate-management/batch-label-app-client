/**
 * The Orchestrate sub-brand this deployment belongs to.
 *
 * Orchestrate runs one shared Supabase identity pool across every offering. Each
 * deployment tags its signups with a brand slug so the pool stays filterable by
 * sub-brand (public.brand_memberships.brand_slug).
 *
 * This must agree with the marketing site's src/lib/brand.ts. If www writes a
 * membership for `batchlabel` and this app reads one for something else, the
 * user arrives signed in with no entitlement at all.
 *
 * Set VITE_ORCHESTRATE_BRAND per deployment. Batchlabel is the default because
 * it is the first offering; a future brand ships the same code with a different
 * value.
 */
const configured = (import.meta as unknown as {env?: Record<string, string>;}).env?.
VITE_ORCHESTRATE_BRAND;

export const BRAND_SLUG = (configured && configured.trim()) || 'batchlabel';
