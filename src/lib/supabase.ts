import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { sharedCookieStorage } from './session-storage';

/**
 * Supabase browser client for app.batchlabel.xyz.
 *
 * The auth options below are deliberately identical to the marketing site's
 * (batch-label, src/lib/supabase.ts). Both apps point at the same Supabase
 * project, so supabase-js derives the same storage key
 * (`sb-<project-ref>-auth-token`) on both, and `sharedCookieStorage` puts that
 * key in a cookie on `.batchlabel.xyz`. One login therefore covers www and app.
 *
 * Set these in your environment (never commit them):
 *   VITE_SUPABASE_URL=https://cqzrwfresuiktgzhkhok.supabase.co
 *   VITE_SUPABASE_ANON_KEY=your-anon-key
 *
 * The anon key is public by design — it is safe in a browser bundle because
 * every table is behind row level security. In particular `brand_memberships`
 * grants SELECT on your own row and no INSERT or UPDATE at all, so this client
 * physically cannot grant itself a plan.
 */
const url = (import.meta as unknown as {env?: Record<string, string>;}).env?.VITE_SUPABASE_URL;
const anonKey = (import.meta as unknown as {env?: Record<string, string>;}).env?.
VITE_SUPABASE_ANON_KEY;

export const isSupabaseConfigured = Boolean(url && anonKey);

export const supabase: SupabaseClient | null = isSupabaseConfigured ?
createClient(url as string, anonKey as string, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    // Session lives in a cookie on .batchlabel.xyz rather than localStorage, so
    // www.batchlabel.xyz and this app see the same login. See lib/session-storage.ts
    // — that file is duplicated from the marketing site and the two must stay
    // byte for byte identical.
    storage: sharedCookieStorage
  }
}) :
null;

export const MISSING_CONFIG_MESSAGE =
'This app is not connected to Supabase yet. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.';
