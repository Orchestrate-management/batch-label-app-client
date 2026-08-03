# How www and app fit together

Two deployments, one product, one login.

| | `www.batchlabel.xyz` | `app.batchlabel.xyz` |
| --- | --- | --- |
| Repo | `batch-label` | `Batch-Label-Product-Application` (this one) |
| Owns | marketing, signup, login, consent, and the **server** side of Stripe | the product, and all account management |
| Writes to Supabase | yes, including entitlements (server-side) | **never** |
| Has a login form | yes | no, and it never will |
| Sells a plan | no longer — it routes here | **yes**, at `/billing` |

**The split moved, and this table is the thing to read twice.** Buying, changing and
cancelling a plan all happen in this app now: www keeps the public pricing page and hands a
signed-in visitor over, and does not create Checkout sessions for existing customers. What
stays on www is the *server* side — the Stripe secret key, the Supabase service-role key and
the plan contract — because none of those may ever be in a browser bundle. This app calls
those endpoints cross-origin with the user's access token, and Stripe returns the customer to
a path in this app.

What has not changed: this client never writes to Supabase, and it holds no price and no
allowance of its own.

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

One row of **`public.entitlements`** — the view the marketing repo publishes as the contract
(`docs/ENTITLEMENTS.md` over there) — for the signed-in user and the brand in
`VITE_ORCHESTRATE_BRAND` (default `batchlabel`):

```sql
select * from public.entitlements where brand = 'batchlabel';
```

No `user_id` filter. The view is `security_invoker`, so the row-level-security policy on
`brand_memberships` (`auth.uid() = user_id`) applies and already restricts the result to the
caller's own row; a client-side id filter would be redundant at best, and would return
nothing at all if it were ever wrong.

`select *` rather than a column list, which is deliberate. The view IS the published read
surface: it is per-user, it holds no secret, and there is nothing to over-fetch. In exchange
it cannot raise `42703`, so the old "retry with `*` on undefined_column" fallback is gone,
and the columns the schema says are still to come — `can_modify` with the SKU enforcement
trigger, `sku_count` with the products table — arrive with no code change, read as `null`
until then.

### The database decides `active`. This app only labels it.

This used to query `brand_memberships` directly and then decide, in `src/lib/membership.ts`,
whether the row entitled anybody. It disagreed with the database three ways:

| Case | This app said | `entitlement_is_active()` says |
| --- | --- | --- |
| `plan_status = 'unpaid'` | entitled | **not** entitled |
| paid plan, `plan_status` null | entitled | **not** entitled |
| `current_period_end` in the past | entitled — the column was never selected | **not** entitled |

All three gave the paid product away, and all three were the same defect: a second copy of a
rule. `public.entitlement_is_active(membership_status, plan, plan_status, current_period_end)`
is the single definition of "currently entitled" and it is the one the marketing site, the
checkout endpoint's already-subscribed guard and this app now all read.

So `active` is **copied out of the column** and never recomputed, widened or narrowed. What
this app still decides is wording — which of seven sentences to show — and no gate consults
that wording.

### WHETHER, and HOW MUCH

Two questions, two columns, and conflating them is the failure the schema is shaped to
prevent.

- `active` answers *may they use the product*.
- `sku_limit` / `editor_seat_limit` answer *how many things may they have*.

An account over its allowance is `active = true` **and** at its limit. Losing `active` over a
SKU count would take away the ability to re-produce a label for stock already on a shelf,
which is exactly what a recall or a Trading Standards query needs.

`sku_limit` is **displayed and not enforced** — the enforcement trigger ships with the
cofounder's `products` table — so no copy in this app says what happens at the limit, in
either direction.

The unlimited tier arrives as `sku_unlimited = true`. The sentinel behind it (int4 max) never
reaches this repo: without the boolean, `mapEntitlement` reports the allowance as *unknown*
rather than guessing, because a number it cannot interpret must not be rendered to somebody
about to be charged.

### A missing column fails OPEN

`can_modify` does not exist yet and maps to `null`. `mayModify()` treats `null` as **true**.
A column that is not there must never become a lockout — the failure mode it replaces was
every account, including a paying Consultant, silently losing an ability with no error
anywhere.

The one deliberate exception is `active` itself: if that column were absent there is nothing
left to establish an ability from, so the state is `unknown`, access is withheld, and the copy
blames us rather than the customer.

### How state is labelled

| Row | `status` | Paid features |
| --- | --- | --- |
| Read failed, or no `active` column | `unknown` | off |
| No row for this brand | `no_membership` | off |
| `active = true`, `plan_status = 'past_due'` | `past_due` | **on**, with a warning |
| `active = true` | `active` | **on** |
| `active = false`, membership `status` ≠ `active` | `suspended` | off |
| `active = false`, `plan` = `free` or null | `free` | off |
| `active = false`, any other plan | `lapsed` | off |

Three decisions worth knowing about:

- **A failed read is never presented as "free".** Telling a customer with a live subscription
  that they have not paid, because a request timed out, is how you get a cancellation email.
  `unknown` withholds the paid output — we cannot prove entitlement — but says so honestly
  and offers a retry.
- **`past_due` keeps access,** because the view says so. Stripe retries a failed card for
  days. The app nags; it does not block.
- **`lapsed` is not a punishment.** Ruling R9: a lapsed account can do everything the Free
  plan can. Nothing about having once paid may leave somebody worse off than a new signup,
  and the copy may not imply a penalty, a deletion or a countdown.

### What is gated

Exporting a finished artefact: both **Export PDF** and **Export sheet** in the artefact
designer. Everything up to that stays open — building products, designing the surface, seeing
which regulatory checks fail. Both buttons are still `toast()` stubs (see section 7), so the
gate is real and what it gates is not built yet. No billing surface describes what they will
produce.

### Consuming it

```tsx
import { useEntitlement } from './lib/entitlement';

const { loading, status, active, plan, skuLimit, skuUnlimited, businessName, refresh } =
  useEntitlement();
```

Check `loading` before trusting `status`. Use `active` for a yes/no gate, `mayModify()` for
anything that will one day be SKU enforcement, and `<PlanNotice />` to explain a `false` — it
renders different copy and a different call to action for each state, because "you have not
paid", "your card bounced" and "we could not reach the server" are three completely different
sentences.

---

## 4. Billing

`app.batchlabel.xyz` is where a plan is bought and managed. www keeps the public pricing page
and routes a signed-in visitor here; it no longer creates Checkout sessions for existing
customers.

The **server** side stays on www, because the Stripe secret key, the Supabase service-role key
and the plan contract live there and none of them may be in a browser bundle. So this app
makes three cross-origin calls to `VITE_MARKETING_URL`:

| Call | Auth | Purpose |
| --- | --- | --- |
| `GET /api/plans` | none | the public catalogue: tiers, prices in pence, allowances |
| `POST /api/create-checkout-session` | `Bearer <access token>` | opens Stripe Checkout for a tier and interval |
| `POST /api/create-portal-session` | `Bearer <access token>` | opens the Stripe Customer Portal |

### No price and no allowance lives in this repo

Not a constant, not a fallback, not a sensible default for when the request fails. Every
number on `/billing` comes from `GET /api/plans`, which is generated from
`src/server/plan-contract.ts` on www — the same file the Stripe prices are created from.

The consequence is accepted rather than papered over: **when that request fails the page says
the prices could not be loaded and shows none.** A fallback table is a stale price quoted to
somebody about to be charged a different one.

The payload carries no Stripe price ids, no `rail_test` entry, and no unlimited sentinel by
construction. `src/lib/plans.ts` is the only module that reads it.

### Prices are exclusive of VAT, in GBP, everywhere

Every displayed amount is labelled `exc VAT`. Stripe adds VAT at checkout from the customer's
address and their VAT number, so the number on screen never changes by country. A price
printed without that label is a £16.80 charge against a £14 expectation, so the label is not
optional.

### The request may name a tier. It may not name a price.

`src/lib/billing.ts` sends `{ tier, interval, success_path, cancel_path }` and an access
token. It sends no price id, amount, currency, allowance, plan, brand, user id or email. The
server turns the tier into an env var name, reads the price id from server-only env, and
re-derives the plan it writes to Stripe by resolving that price id back through the same index
the webhook uses. A test asserts the forbidden fields are absent, because the first one added
is where the drift starts.

The user id comes from the verified JWT and from nowhere else. There is deliberately no
`user_id` field on either endpoint: a portal session URL is a bearer link to somebody's cards,
invoices and cancel button.

### Returning from Checkout

`/billing/success` **does not know that the plan is on.** Stripe redirects as soon as the
Checkout Session completes, but the entitlement is written by a webhook and not by the event
firing at that moment — `checkout.session.completed` carries no line items, so the plan and
the allowance land on the `customer.subscription.*` event a beat later.

So the return screen re-reads on a backoff (`src/lib/activation.ts`: six reads, about thirty
seconds) and says "we are waiting" until the row says otherwise. It never names a plan as live
off the back of the redirect. `session_id` in the query string is deliberately unused — it is a
value anybody can type, and the only evidence this app accepts is `entitlements.active`,
written server-side from a signature-verified Stripe event.

### Changing or cancelling a plan

All of it is the Stripe Customer Portal: card, invoices, VAT number, monthly/annual switch,
tier change, cancel. There is no in-app substitute and that is the design — one product per
subscription and no add-ons means the portal handles tier changes natively with proration, and
rebuilding that here would mean rebuilding proration and getting it subtly wrong with
somebody's money.

The checkout endpoint refuses to sell a second subscription to an entitled account (409), so
`/billing` stops offering the purchase buttons once `active` is true and points at the portal
instead. The UI is not the guard; it is the explanation.

### The CORS gate

These calls are cross-origin and credentialed, so this app's origin must be on the allow-list
in the marketing repo's `src/server/cors.ts`. `https://app.batchlabel.xyz` and
`http://localhost:5173` are on it by default. **Every Vercel preview of this app is a distinct
origin and is blocked until it is added to `STRIPE_ALLOWED_ORIGINS` on the www project.** A
CORS block fails in the browser with nothing in the server logs, which is why it is worth
knowing before debugging one.

---

## 5. Environment variables

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

## 6. What the founder must configure

These are Supabase dashboard settings. They cannot be done from this repo, and
until they are done the handoff will not work.

### 6.1 Supabase → Authentication → URL Configuration

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

### 6.2 Google OAuth (only if Google sign-in is in use)

In the Google Cloud console, on the OAuth 2.0 Client used by Supabase:

- **Authorised JavaScript origins** — add `https://app.batchlabel.xyz`.
- **Authorised redirect URIs** — no change. Google redirects to Supabase's own
  callback (`https://cqzrwfresuiktgzhkhok.supabase.co/auth/v1/callback`), not to
  either of our origins, and that entry already exists.

The Google button itself lives on www and stays there. This matters only if a
Google flow is ever initiated from the app origin.

### 6.3 Vercel

- Set the four environment variables from section 5 on the app project, for
  Production **and** Preview.
- The build command is `npm run vercel-build`, which runs `typecheck` and the
  test suite before `vite build`. A broken build or a red suite cannot deploy.
- `vercel.json` adds the SPA rewrite. Without it every deep link 404s —
  including the one www hands back after login.

### 6.5 On the www project, for billing

Set on the **marketing** Vercel project, not this one:

- `APP_URL` (or `VITE_APP_URL`) = `https://app.batchlabel.xyz`. This is the origin Stripe
  returns customers to; it is a server constant precisely so no request can influence where
  somebody is sent after paying.
- `STRIPE_ALLOWED_ORIGINS` = any preview origin of **this** repo you want billing to work
  from. Production and `localhost:5173` are already on the default allow-list.
- `STRIPE_PORTAL_CONFIGURATION_ID`. Without it the portal falls back to the shared Orchestrate
  account default, which has no tier switching — the portal still opens, so the failure looks
  like a Stripe bug rather than a missing variable.

### 6.6 Checklist

- [ ] `https://app.batchlabel.xyz` and `https://app.batchlabel.xyz/**` in Supabase redirect URLs
- [ ] `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` set on the Vercel app project
- [ ] The Supabase project ref matches the one www uses
- [ ] `VITE_ORCHESTRATE_BRAND` matches www (or is unset on both)
- [ ] `https://app.batchlabel.xyz` in Google authorised JavaScript origins, if Google sign-in is used
- [ ] `20260802120000_plan_limits.sql` applied — `/billing` reads `public.entitlements`, and
      without the view every account reads as "we could not check your plan"
- [ ] `APP_URL` set on the www project, so Checkout returns to `/billing/success` here
- [ ] Sign up on www, confirm you land in the app already signed in
- [ ] Sign out in the app, confirm you are signed out on www too
- [ ] Open `/billing`, confirm prices load; block `/api/plans` and confirm the page says so
      rather than showing a number

---

## 7. What is still stubbed

Authentication, entitlements and billing are real. The product itself is not yet: products,
materials, records, the derivation engine and the artefact renderer all run on the fixtures in
`src/lib/products.ts`, and the export buttons fire a toast rather than producing a file. The
gate around them is real — an unentitled maker genuinely cannot press them — but what they do
when pressed is still a placeholder. Nothing on a billing surface describes what they will
one day produce, for that reason.

Settings → Identity and Settings → Team still read from fixtures. The SKU count on the billing
page is the fixture product list, because there is no `products` table yet; the **allowance**
it is measured against is real, read from `entitlements.sku_limit`.

What was removed rather than left looking real: the `PLANS` array in `src/lib/products.ts`
(Maker £24 for 3 products, Studio £58 for 10, House £140 for 40 — three tiers at three prices
that existed nowhere but that file, rendered to signed-in customers), along with the invented
card on file, invoice history and renewal date beside them.

Not built, and therefore not sold anywhere in this app: the exporter, SDS upload, an archive,
editor-seat invitations, multi-client workspaces, bulk generation and the API. Editor seats
appear on `/billing` because they are a real column on the plan and on the account, and they
are labelled as not yet available rather than offered.

`src/components/PlanNotice.test.ts` scans every billing surface for sentences describing any
of them and fails the build on one.
