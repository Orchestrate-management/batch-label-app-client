# How www and app fit together

Two deployments, one product, one login.

| | `www.batchlabel.xyz` | `app.batchlabel.xyz` |
| --- | --- | --- |
| Repo | `batch-label` | `Batch-Label-Product-Application` (this one) |
| Owns | marketing, signup, login, password reset, consent, Stripe, plan changes | the product, and the signed-in account settings |
| Writes to Supabase | yes, including entitlements (server-side) | only through `set_consent()` and `auth.updateUser` — never a table |
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

## 3a. Account settings

`Settings → Account` (`/settings/account`) is the one place in this app that is about
the person rather than the product. It is reachable from the sidebar account menu
("Account and password"), from the settings tab strip, and from the mobile nav — the
sidebar menu is desktop only, so without the last one a maker on a phone had no route to
their password or to sign out.

### Changing a password

`supabase.auth.updateUser({ password })` **does not ask for the current password**. A live
session is enough. That makes a borrowed laptop or a stolen session cookie sufficient to
take an account, and the owner finds out when their password stops working.

Supabase's answer is the **Secure password change** setting (Authentication → Providers →
Email). Turn it on, but do not mistake it for a fix. From supabase-js's own documentation:

> A user is only required to reauthenticate before updating their password if Secure
> password change is enabled **and the user hasn't recently signed in**. A user is deemed
> recently signed in if the session was created in the last 24 hours.

A borrowed laptop is a recent session. A stolen cookie is a live session. The exemption
covers exactly the case that matters.

So `src/lib/account.ts` re-authenticates first: it calls `signInWithPassword` with the
current password and only calls `updateUser` if that succeeds. It needs no dashboard
change and it stops the actual threat. Two properties make the probe safe, both verified
against `@supabase/auth-js` 2.111 and against the live auth server:

- A failed `signInWithPassword` returns the error and **leaves the existing session
  intact**. A typo costs a retry, not a sign-out.
- A successful one issues a fresh session through the same shared cookie adapter, so www
  and this app stay in step.

Brute force is bounded by the same Supabase rate limit that protects the login form on
www, because it is the same endpoint.

**Other sessions are ended.** After a successful change the app calls
`signOut({ scope: 'others' })`, which revokes every other session and keeps the current
one. Changing a password is what someone does when they think another person has their
account, so leaving that person signed in would defeat the point. It is done explicitly
rather than relying on a server default, and reported separately: if the revoke fails the
password has still changed, and the screen says so rather than claiming a failure that
would send someone back to a password that no longer works.

### The other side of it: www

`updateUser({ password })` is reachable from www's `/reset-password` too, and a guard on
one of two stacked sites is not a guard. That page is gated on a **recovery marker
captured from the URL fragment**, not on session presence — the session cookie is shared
for 400 days, so on www an ordinary signed-in maker is signed in essentially always, and
gating on it would have handed the account to anyone holding the browser. See
`batch-label/src/lib/recovery-entry.ts`.

### An account with no password

A maker who signed up with Google probably has no password, so the set-password card leads:
a button that emails a link via `resetPasswordForEmail`, redirecting to www's
`/reset-password`. www's `/forgot-password` is written for someone who had a password and
forgot it, so a Google user would never think to look there.

**Both routes are always reachable, and neither is gated on the identity list.**
`hasEmailIdentity` only decides which one leads. It cannot decide which one someone is
allowed, because Supabase exposes no "has password" flag and `identities` is wrong in both
directions:

- setting a password through `updateUser` writes `encrypted_password` and does **not** add
  an `email` identity, so a maker who used the set-password link still reports Google only
  for ever;
- a magic-link signup creates an `email` identity and never sets a password.

An earlier version used it as a gate and permanently stranded exactly the people the
set-password flow was written for: they set a password, then could never reach the form to
change it. Getting the hint wrong now costs one click.

### Consent

`Settings → Account` changes the marketing email opt-in through the `set_consent()`
function — the same call www's account area makes. See `docs/CONSENT.md` in the marketing
repo, section "The contract for the product app". There is no table write and no endpoint
of this app's own.

Advertising is read-only here. It is the cookie banner's marketing toggle, and this app
cannot see the stored banner choice at all: `bl_consent` lives in `localStorage` and in a
cookie written with no `domain` attribute, so it is host-only on `www.batchlabel.xyz`
while the session cookie is scoped to `.batchlabel.xyz`. What is shown is
`advertising_opt_in` from the membership row, with a link to
`/cookie-policy?cookie-settings=1`, which opens www's banner directly.

**`src/lib/agreements.ts` mirrors the version strings from the marketing repo.** Both
repos write into the same `consent_events` table. Bump a version there and it must be
bumped here in the same change, or one piece of wording ends up with two version numbers
in the audit log.

That is checked by `scripts/check-agreement-versions.mjs`, run as its own CI job, which
fetches www's `agreements.ts` and compares. A unit test cannot do this — it can only
compare this repo to itself, and an earlier one that did exactly that would have passed
through any real drift.

**The check needs a token.** Both repos are private and a workflow's default
`GITHUB_TOKEN` is scoped to its own repository, so without one the job prints a
`NOT CHECKED` warning and passes rather than failing a build nobody can fix. To switch it
on, add a fine-grained personal access token with **Contents: read** on
`Orchestrate-management/batch-label` as the repository secret **`WWW_REPO_TOKEN`**.

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
| `VITE_META_PIXEL_ID` | no | unset | The Meta dataset id, `1374342861305621`. Public by design. Unset means no Pixel loads and nothing is sent. **Not yet set on the Vercel project** — see `docs/META_TRACKING.md` §7. |
| `VITE_META_PIXEL_DEBUG` | no | unset | Only `"true"` counts. Loads the Pixel on localhost for Meta's Test Events. Never set it in Vercel. |

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

### 5.3a Secure password change

Supabase → Authentication → Providers → Email → **Secure password change**: switch it on.

Be precise about what this buys, because overstating it is how a hole gets missed. It
requires a reauthentication OTP **only** when the session is more than 24 hours old. It
does not ask for the current password, and it does nothing at all for a session created
in the last day — which is the borrowed-laptop and stolen-cookie case, and therefore the
one that matters.

So it is a narrow addition, not a safety net:

| | Session under 24h | Session over 24h |
| --- | --- | --- |
| App `/settings/account` | current password required (this repo) | current password required (this repo) |
| www `/reset-password` | recovery link required (marketing repo) | recovery link required (marketing repo) |
| Any other client | **nothing** | OTP, from this setting |

The real protections are the two in the first two rows, and both are code in the two
repos. An earlier version of this document claimed this setting "covers any other client
that ever talks to this project". That was wrong in a way that mattered: it implied www
was covered when www required no current password at all, and it is part of why that gap
survived self-review. A new client written against this project is protected only for
sessions over a day old, and must implement its own re-authentication.

### 5.4 Checklist

- [ ] `https://app.batchlabel.xyz` and `https://app.batchlabel.xyz/**` in Supabase redirect URLs
- [ ] **Secure password change** enabled on the email provider
- [ ] `WWW_REPO_TOKEN` secret set, so the agreement version check can actually run
- [ ] `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` set on the Vercel app project
- [ ] The Supabase project ref matches the one www uses
- [ ] `VITE_ORCHESTRATE_BRAND` matches www (or is unset on both)
- [ ] `VITE_META_PIXEL_ID` set on the Vercel app project, matching www's — `docs/META_TRACKING.md` §7
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

Settings → Account is real: the password change, the marketing email opt-in and the
advertising state all talk to Supabase.

Three things it does not do, all of them by email today and all of them flagged rather
than faked:

- **Changing an email address.** Not self service anywhere. `auth.updateUser({ email })`
  exists, but doing it properly needs confirmation sent to both the old and the new
  address (Supabase's **Secure email change** setting), and getting that wrong hands an
  account to whoever typed the new address.
- **Deleting an account.** Needs a service-role call, so it cannot live in this browser.
- **Exporting data.** No endpoint exists yet.

The privacy notice promises the last two within a month, by email to
privacy@batchlabel.co.uk. Until they are built, that promise is the product.

That the export is still a toast is also why no "activation" event is sent to Meta:
an advertising event for an action that produces nothing is a fabricated conversion.
The reasoning is in `docs/META_TRACKING.md` §6, and it is worth re-reading when the
export becomes real rather than assuming the answer stays no.

---

## 7. Advertising measurement

The app loads the Meta Pixel for one event, `InitiateCheckout`, gated on
`brand_memberships.advertising_opt_in` and failing closed in every other case. It has
no cookie banner and sends no `PageView`. See `docs/META_TRACKING.md`, and
`batch-label/docs/CONSENT.md` for the consent model both sites obey.
