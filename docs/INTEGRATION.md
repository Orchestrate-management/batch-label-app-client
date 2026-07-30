# How www and app fit together

Two deployments, one product, one login.

| | `www.batchlabel.xyz` | `app.batchlabel.xyz` |
| --- | --- | --- |
| Repo | `batch-label` | `Batch-Label-Product-Application` (this one) |
| Owns | marketing, signup, login, consent, Stripe, plan changes | the product |
| Writes to Supabase | yes, including entitlements (server-side) | **never** |
| Has a login form | yes | no, and it never will |

The split is deliberate. Accounts and money are sold, changed and cancelled in
one place, next to the Stripe customer portal, and that place is not this app.
Everything here either reads the session or links back to www.

A maker who finishes signing up on www is sent straight here. That only works if
the session travels with them, which is what the rest of this document is about.

---

## 1. The shared session contract

### The problem

`supabase-js` keeps the session in `localStorage`. `localStorage` is partitioned
per origin, so a session created on `www.batchlabel.xyz` is simply invisible to
`app.batchlabel.xyz`. Left alone, a maker signs up, gets handed to the product,
and is immediately asked to sign in again.

### The fix

Both apps hand `supabase-js` a custom storage adapter that writes the session to
a cookie scoped to `.batchlabel.xyz`, so both subdomains read the same session.
One login covers both.

The cookie name comes from `supabase-js` itself — `sb-<project-ref>-auth-token`
— so as long as both apps point at the same Supabase project the name matches
automatically. There is nothing to keep in sync by hand, which also means
**pointing this app at a different Supabase project silently breaks the
handoff.** The two apps would each have a valid session under a different cookie
name and neither would see the other's.

### The 4KB trap

A Supabase session is an access token, a refresh token and the user object. That
regularly exceeds the ~4096 byte per-cookie limit, and browsers do not error on
an oversized cookie — **they drop it**. The failure looks like being randomly
signed out, it gets worse as more claims land in the JWT, and it reproduces on
nobody's machine.

So the adapter splits the value across numbered chunks (`<key>.0`, `<key>.1`, …),
the same convention `@supabase/ssr` uses. Two consequences that are easy to get
wrong:

- When it chunks, it **deletes the unchunked cookie**. Reads prefer the whole
  cookie, so a stale one left behind would make every read return the previous
  session forever.
- When a session gets *shorter*, it **clears the tail** the longer one left. A
  new head concatenated onto an old tail parses into nonsense, which again reads
  to the user as being signed out.

Both are covered in `src/lib/session-storage.test.ts`.

### The byte-for-byte rule

> `src/lib/session-storage.ts` is duplicated verbatim between this repo and
> `batch-label`. If you change it in one, change it in the other **in the same
> commit**.

The two copies must agree on cookie name, chunk size and domain. If they
disagree, the session silently fails to carry and users appear signed out the
moment they cross between the sites. There is no error, no console warning and
no failing request — just a login screen where the product should be.

Verify a copy with the git blob hash rather than by eye:

```sh
# in this repo
git hash-object src/lib/session-storage.ts
# the marketing repo's copy
gh api "repos/Orchestrate-management/batch-label/contents/src/lib/session-storage.ts?ref=main" --jq .sha
```

They must be identical. `src/lib/session-storage.test.ts` also pins `CHUNK_SIZE`,
`MAX_CHUNKS` and `PARENT_DOMAIN`, so an edit here fails the build rather than
production.

The adapter falls back to a host-only cookie when it is not running under
`batchlabel.xyz` — `localhost` and `*.vercel.app` previews cannot set a cookie
for a domain they are not under, and silently get no cookie at all if they try.
**This means a Vercel preview of this app cannot share a session with a preview
of www.** Test the crossing on the real domains, or on two localhost ports.

---

## 2. The auth gate

`RequireAuth` (`src/lib/auth.tsx`) wraps the entire router, including the 404
route. There is no path in this app that renders product data without a session.

| State | What happens |
| --- | --- |
| Session still resolving | neutral loading screen, **no redirect** |
| Session present | the app renders |
| No session | full navigation to `${VITE_MARKETING_URL}/log-in?next=<url-encoded current href>` |
| Bounced twice in 30s, still no session | "we could not carry your sign-in" screen |
| Supabase not configured | "sign in is not configured" screen, app does not render |

Three things it is careful about, all of them tested:

1. **It never checks before the session has had a chance to load.** Reading the
   cookie is asynchronous. A maker arriving straight from signup has a perfectly
   good session; checking too early throws a brand new customer back to the
   login page they just came from.
2. **It redirects at most once per page load.** React re-renders several times
   before the browser actually leaves.
3. **It counts bounces across page loads.** "No session → go to login" and
   "authenticated → go back to `next`" are both correct rules that, if the
   session does not carry, fire against each other forever. Each hop is a full
   page navigation, so no error boundary or router guard can catch it — the user
   just sees a flickering address bar. After two attempts in thirty seconds the
   gate stops and explains, with a manual link. A real login takes longer than
   thirty seconds, so a person who genuinely signs in never trips it.

The counter lives in `sessionStorage` (per tab, cleared when the tab closes,
preserved across a navigation to www and back) and is cleared the moment a
session is seen.

**Missing configuration fails closed.** If `VITE_SUPABASE_URL` or
`VITE_SUPABASE_ANON_KEY` is absent the app refuses to render rather than falling
open. Falling open is friendlier for local review and it would mean one missing
environment variable in production silently restores the thing this whole
integration exists to fix: a product readable by anyone with the URL.

**Sign-out** clears the shared cookie (and every chunk of it, on both the shared
and host-only scopes) and returns to `VITE_MARKETING_URL`. Because the cookie is
shared, signing out here signs the maker out of www too. That is the correct
reading of "sign out".

The `next` parameter is validated on the receiving end, not here — see the
marketing repo's `src/lib/app-handoff.ts`, which matches it against an allow-list
of hosts. An unchecked `next` is an open redirect, and a convincing one, because
it fires immediately after a real login.

---

## 3. The entitlement read contract

### What is read

One row from `public.brand_memberships`, for the signed-in user and the brand in
`VITE_ORCHESTRATE_BRAND` (default `batchlabel`):

```sql
select brand_slug, status, business_name, plan, plan_status
from public.brand_memberships
where brand_slug = 'batchlabel';
```

No `user_id` filter. RLS (`own memberships are readable`) is the security
boundary and already restricts the result to the caller's own row; a client-side
id filter would be redundant at best, and would return nothing at all if it were
ever wrong.

### This client never writes

RLS grants `select` on your own row and grants **no** `insert` or `update` to
anybody. Every write is server-side, from the marketing site's Stripe webhook
running under the service role. That is deliberate: a browser that can write its
own `plan` is a browser that can award itself a subscription. There is no write
path in `src/lib/membership.ts` and none should be added.

### Schema drift

The marketing side owns this schema and is adding richer entitlement fields. The
query therefore names the columns it needs and falls back to `select *` on
Postgres error `42703` (undefined column), and every field is read through a
tolerant reader that treats missing, blank or wrongly-typed values as absent. A
column being renamed on the other side degrades to a plan we cannot read, not to
a white screen.

### How state is decided

| Row | `status` | Paid features |
| --- | --- | --- |
| Read failed | `unknown` | off |
| No row for this brand | `no_membership` | off |
| `plan` = `free` or null | `free` | off |
| `plan_status` = `active` or `trialing` | `active` | **on** |
| Paid `plan`, `plan_status` null | `active` | **on** |
| `plan_status` = `past_due` or `unpaid` | `past_due` | **on**, with a warning |
| `plan_status` = `canceled` / `cancelled` / `incomplete_expired` | `cancelled` | off |
| `plan_status` = anything unrecognised | `unknown` | off |
| Membership `status` ≠ `active` | `suspended` | off |

Three decisions worth knowing about:

- **A failed read is never presented as "free".** Telling a customer with a live
  subscription that they have not paid, because a request timed out, is how you
  get a cancellation email. `unknown` withholds the paid output — we cannot
  prove entitlement — but says so honestly and offers a retry.
- **`past_due` keeps access.** Stripe retries a failed card for days. Cutting a
  maker off mid-batch over a card that expired yesterday is worse for them and
  for us than a loud banner. Access ends at `canceled`.
- **A paid plan with no Stripe status is active.** The column defaults to `free`
  and no client can change it, so a non-free value with no subscription behind it
  was granted server-side on purpose — a comped account or a migration.

### What is gated

Exporting a finished artefact: both **Export PDF** and **Export sheet** in the
artefact designer. Everything up to that stays open on the free plan — building
products, reading supplier documents, designing the surface, seeing which
regulatory checks fail. What a plan buys is the artefact you can send to a
printer.

Drawn there on purpose: the free tier is genuinely useful rather than a demo,
and nobody discovers the paywall *after* doing the work, because the notice is
on screen the whole time they are designing.

Settings → Billing shows the real plan and links to www. It has no checkout of
its own.

### Consuming it

```tsx
import { useEntitlement } from './lib/entitlement';

const { loading, status, active, plan, businessName, refresh } = useEntitlement();
```

Check `loading` before trusting `status`. Use `active` for a yes/no gate, and
`<PlanNotice />` to explain a `false` — it renders different copy and a different
call to action for each of the seven states, because "you have not paid", "your
card bounced" and "we could not reach the server" are three completely different
sentences.

---

## 4. Environment variables

Copy `.env.example` to `.env.local` for development, and set the same values in
the Vercel project for preview and production.

| Variable | Required | Default | Notes |
| --- | --- | --- | --- |
| `VITE_SUPABASE_URL` | yes | — | `https://cqzrwfresuiktgzhkhok.supabase.co`. **Must be the same project as www.** |
| `VITE_SUPABASE_ANON_KEY` | yes | — | Public by design; protected by RLS. |
| `VITE_MARKETING_URL` | no | `https://www.batchlabel.xyz` | Where login lives and sign-out returns to. |
| `VITE_ORCHESTRATE_BRAND` | no | `batchlabel` | Must match www's value. |

There are no secrets in this app. The anon key is meant to be in a browser
bundle: every table is behind row level security, and `brand_memberships` in
particular grants a user `select` on their own row and grants nobody `insert` or
`update`. If the anon key alone were enough to change an entitlement, the fix
would be the RLS policy, not hiding the key.

Neither missing variable can be papered over: without them the app renders the
"sign in is not configured" screen instead of the product.

---

## 5. What the founder must configure

These are Supabase dashboard settings. They cannot be done from this repo, and
until they are done the handoff will not work.

### 5.1 Supabase → Authentication → URL Configuration

Add both entries to **Redirect URLs**:

```
https://app.batchlabel.xyz
https://app.batchlabel.xyz/**
```

Leave **Site URL** as the marketing site (`https://www.batchlabel.xyz`) — that is
where signup confirmation and password reset emails should land, and those flows
still belong to www.

Why the app origin is needed at all: this app creates its client with
`detectSessionInUrl: true`, and any Supabase flow that could ever return a user
directly to the app (a magic link, an OAuth callback, an email confirmation
whose `next` pointed here) is rejected unless the destination is on this list.
Supabase silently refuses a redirect to an unlisted URL. The `/**` wildcard entry
covers deep links, which is exactly what the `next` round trip produces.

Add the preview origin too if you want to exercise auth on a Vercel preview:

```
https://<preview-deployment>.vercel.app/**
```

Note that a preview still cannot *share* a session with www — see the host-only
cookie fallback in section 1.

### 5.2 Google OAuth (only if Google sign-in is in use)

In the Google Cloud console, on the OAuth 2.0 Client used by Supabase:

- **Authorised JavaScript origins** — add `https://app.batchlabel.xyz`.
- **Authorised redirect URIs** — no change. Google redirects to Supabase's own
  callback (`https://cqzrwfresuiktgzhkhok.supabase.co/auth/v1/callback`), not to
  either of our origins, and that entry already exists.

The Google button itself lives on www and stays there. This matters only if a
Google flow is ever initiated from the app origin.

### 5.3 Vercel

- Set the four environment variables from section 4 on the app project, for
  Production **and** Preview.
- The build command is `npm run vercel-build`, which runs `typecheck` and the
  test suite before `vite build`. A broken build or a red suite cannot deploy.
- `vercel.json` adds the SPA rewrite. Without it every deep link 404s —
  including the one www hands back after login.

### 5.4 Checklist

- [ ] `https://app.batchlabel.xyz` and `https://app.batchlabel.xyz/**` in Supabase redirect URLs
- [ ] `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` set on the Vercel app project
- [ ] The Supabase project ref matches the one www uses
- [ ] `VITE_ORCHESTRATE_BRAND` matches www (or is unset on both)
- [ ] `https://app.batchlabel.xyz` in Google authorised JavaScript origins, if Google sign-in is used
- [ ] Sign up on www, confirm you land in the app already signed in
- [ ] Sign out in the app, confirm you are signed out on www too

---

## 6. What is still stubbed

Authentication and entitlements are real. The product itself is not yet: products,
materials, records, the derivation engine and the artefact renderer all run on the
fixtures in `src/lib/products.ts`, and the export buttons fire a toast rather than
producing a PDF. The gate around them is real — an unentitled maker genuinely
cannot press them — but what they do when pressed is still a placeholder.

Settings → Identity and Settings → Team also still read from fixtures. The card on
file, invoice history and plan switcher that used to sit in Settings → Billing have
been removed rather than left looking real next to a genuine plan status, and now
link to www where Stripe actually is.
