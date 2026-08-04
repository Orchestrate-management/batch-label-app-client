# Production TODO

Gaps found while hardening this app for production, logged rather than decided.
Each entry: what the gap is, the options and their trade-offs, a recommendation, and where
in the code it bites. Several streams append here — add, never rewrite.


## Data layer coverage (stream: coverage of src/lib/products.ts and src/lib/product-store.tsx)

### 1. `no-account` never reaches the screen on first paint — the mount path publishes `error` instead — DONE

**DONE** (commit `entry 1`, `fix(1)`): option (a). The mount effect gained the same
`if (!accountId)` branch `read` already had, publishing `no-account` and firing no read. The
pinned test `"reads the mount path as error today, not as no-account"` became
`"publishes no-account on the mount path too, without firing a read to find out"`; the
load-bearing test above it ("never publishes an empty account…") is unchanged and still passes.
The `?? []` note below was left as-is: unreachable by PostgREST's contract, no recommendation
attached to it, and changing it would be a behaviour change with nothing able to exercise it.


**The gap.** `ProductsProvider` has two ways to fill the store and they disagree about the case
where no account resolved. The `read` callback (product-store.tsx:146-154), which `reload()` uses,
publishes `status: 'no-account'` and fires no query. The mount effect (product-store.tsx:186) has
no such branch: it calls `fetchProducts(null)`, which correctly refuses, and the refusal is mapped
to `status: 'error'`.

So `'no-account'` is only ever published after a write. Since only somebody who HAS an account
gets as far as a write, it is in practice never published at all — and `Products.tsx:103`, which
carries a written, three-way explanation keyed on `entitlement.status`, is dead on arrival.

**What the customer gets instead.** The `error` callout: heading "We could not read your products",
the reader's sentence, and a **Try again** button. For the `no_membership` cause — signup never
finished — that is the retry-that-never-works pattern this codebase has removed three times
already (`account_ambiguous`, the bare 42501, the silent no-op UPDATE). Waiting does not finish
their signup.

**Options.**
- *(a) Give the effect the same branch `read` already has* — three lines, before the
  `fetchProducts` call. The `no-account` copy on Products.tsx starts rendering; nothing else moves.
- *(b) Have the effect call `read()`* instead of duplicating it. Removes the divergence at the
  source, but `read` is a `useCallback` and the effect deliberately keeps its own `active` flag for
  the unmount race — merging them means re-deriving that guard, in the one provider where a stale
  answer is somebody else's account.
- *(c) Leave it.* The sentence shown is not false; it is just the wrong one of three, and it offers
  a retry that cannot work for two of them.

**Recommendation: (a).** It is the smallest change that makes an already-written, already-reviewed
screen reachable, and it changes what a customer sees only in the direction of being more accurate.
(b) is the better shape and is worth doing when someone is next in this file with time to re-verify
the unmount race.

**Where it bites.** `src/lib/product-store.tsx:165-197` (the effect), against `:136-163` (`read`).
The dead branch is `src/pages/Products.tsx:103-124`. Test
`src/lib/product-store.test.tsx` › "reads the mount path as error today, not as no-account" pins
the current behaviour on purpose — when this is fixed, that expectation flips to `'no-account'`,
and the test directly above it ("never publishes an empty account…") is the one that proves the
fix did not regress the thing that actually matters.

**Related, smaller, same failure class.** `fetchProducts` treats a response with neither rows nor
an error (`data: null, error: null`) as an empty account — `products.ts:722-725`, the `?? []`.
PostgREST always returns an array, so this is unreachable today; it is only worth a line here
because the failure it would produce is the empty state on a non-answer, which is the exact thing
the rest of the file is built to prevent.

### 2. Coverage thresholds are pooled, not per file — DONE

**DONE** (commit `test(2)`): option (a). `perFile: true` is on, at the same 70% bar, and the
number is a floor rather than an average.

**The entry named the wrong second function.** It says `createRailTestSession` (billing.ts:126)
and `createPortalSession` (billing.ts:142) have no test; the portal call is in fact covered by
`billing.test.ts` › "sends only a return path — never a user id" and "passes on the ordinary 'no
billing record yet' answer". The two genuinely uncovered were `createRailTestSession` and
`leaveFor` — the line that actually navigates the customer to Stripe. Both have tests now (4 new
in `billing.test.ts`, including that the rail test names no tier, so a penny cannot buy a plan
and a tier request cannot resolve to the penny price). `billing.ts` went 85.71/95/66.66/85.71 to
**100/95.45/100/100**.

**No second file failed** once `perFile` was on: every file on the list clears 70% on all four
counters, the lowest being `auth-redirect.ts` at 77.41% branches. Nothing was excused and no
per-file exception was written.

**Entry 6's follow-up, which was addressed to this entry, is done too.** `report-error.ts` and
`lazy-screen.ts` are now on the include list. Both meet the stated rule on its third clause
rather than its first two — neither costs money or data, and both can make a screen state
something untrue: `hasErrorSink()` drives the sentence about whether a failure reached us, and
`lazyScreen`'s typed rejection is the only thing that tells "the file never arrived" apart from
"this screen crashed". `report-error.ts` was already at 100/91.3/100/100; `lazy-screen.ts` was at
55% statements with `lazyScreen` itself untested, so it gained `src/lib/lazy-screen.test.tsx`
(5 tests) and is now 100/85.71/100/100.

**Original entry follows.**

### 2 (original). Coverage thresholds are pooled, not per file

**The gap.** `vitest.config.ts` sets one 70% bar across the pooled total of the include list.
A brand new module with no tests at all costs the pooled number a point or two and the gate stays
green — which is structurally the same hole as the curated include list, and is how
`src/lib/products.ts` and `src/lib/product-store.tsx` went through the entire Supabase cutover
without a number on them while coverage reported 93%.

**Options.**
- *(a) `thresholds.perFile: true`.* Fails the build today on `src/lib/billing.ts` — functions
  66.66%, because `createRailTestSession` (billing.ts:126) and `createPortalSession` (billing.ts:142)
  have no test. Both are one-line wrappers over `post`; two tests asserting the endpoint and the
  posted body would clear it. This stream was told not to touch the billing rail, so the switch is
  left off rather than turned on with the gate red.
- *(b) `perFile: true` with a lower bar written in for `billing.ts`.* Rejected — that is lowering
  the threshold quietly, in the file where being wrong costs a customer money.
- *(c) Leave pooled.* Cheapest, and keeps the hole.

**Recommendation: (a), immediately after the two billing tests land.** The two tests are perhaps
twenty minutes; `perFile` is one line and turns the coverage number from an average into a floor.
The include-list comment in `vitest.config.ts` now also states the rule for what belongs on it, so
the next file added has a reason to be listed rather than a reason not to be.

**Where it bites.** `vitest.config.ts`, `thresholds` block — the comment there points back at this
entry. Blocker: `src/lib/billing.ts:126` and `:142`.

### 3. A new device starts with plausible-looking electrical ratings — DONE

**DONE** (commit `fix(3)`): option (a). `blankSpec` seeds `{ voltage: '—', current: '—',
power: '—' }`. (a) over (b) because it makes the seed and the read agree exactly — `toProduct`
already maps an absent rating to `'—'` via `str(…, '—')` — and because the line above has
always taken the same view of the model (`'Not yet assigned'`), which is the other field the
plate carries; an empty string would have relied on a database round trip to become the dash.

`DerivationPanel`/`ArtefactRenderer` needed no matching state: `deriveBom` interpolates the
three strings straight into the plate line, so it now reads `— ⎓ —, —` instead of `5 V ⎓ 2 A,
10 W`. Nothing in `pipeline.ts` flags unfilled ratings as outstanding, which is the same
treatment `model` has always had — a broader change than this entry, and not made here.

The named test now has a sibling above it that asserts the seed directly, plus a
placeholder-independent assertion that no seeded rating contains a digit. `src/lib/fixtures.ts`
still carries `5 V DC / 2 A / 10 W`, deliberately: that is a fixture product with real shape
for the derivation tests, and `fixtures.guard.test.ts` proves nothing that ships imports it.


**The gap.** `blankSpec` seeds a bill-of-materials composition with
`ratings: { voltage: '5 V', current: '2 A', power: '10 W' }` (`products.ts:796`). The same function
is careful in the line above it — `model: 'Not yet assigned'` — and `toProduct` is careful on the
read side, mapping an absent rating to an em dash rather than to a number. The blank composition is
the one place a real-looking value is invented.

Those three numbers are what a rating plate is printed from, and a rating plate is a legal marking
on a device. A maker who creates a wax warmer, does not open the ratings field, and produces the
plate gets 5 V / 2 A / 10 W on a mains product. Nothing on the screen says the numbers are a
placeholder, because they do not look like one.

**Options.**
- *(a) Seed the em dash* (`'—'`), matching what `toProduct` already does for a row with no ratings,
  and let the derivation refuse to produce a plate until they are filled in.
- *(b) Seed empty strings* and let the existing `str(..., '—')` fallback supply the dash on read.
  Same visible result, one less place that knows the dash.
- *(c) Leave it* and rely on the maker noticing.

**Recommendation: (a) or (b) — they are the same decision.** It is a two-line change and it is the
same rule the rest of this file already follows ("nothing here invents a version number or a print
date"). Flagged rather than done because it changes what a customer sees in the designer, and
because `DerivationPanel`/`ArtefactRenderer` may read the ratings and want a matching "not yet
stated" state rather than a bare dash.

**Where it bites.** `src/lib/products.ts:791-800` (`blankSpec`, the `bom` branch), read back at
`:568-573`. Covered as-is by `src/lib/products.test.ts` › "starts a cosmetic with its phases and a
device with an unassigned model", which asserts the model but deliberately does not assert the
ratings — change the seed and that test still passes.

### 4. Neither two-statement write is atomic, and both can half-land — LOGGED, not fixed here

**NOT DONE, and deliberately not worked around.** The entry's recommendation (a) is right, and it
is a migration: this branch owns no schema. What this pass adds is the reading the entry asks for
— what the schema actually offers — so the schema stream can act without rediscovering it, plus
the finding that nothing at application level is worth doing in the meantime.

**What the schema offers today.** Read against
`supabase/migrations/20260803120000_account_data_schema.sql` (on the schema branch; this repo
holds no `supabase/`). There is **no RPC that writes a specification and a product together**.
The functions that exist are `is_member_of`, `current_account_id`, `sku_within_limit`,
`account_sku_limit`, `enforce_sku_limit`, `pin_created_by`, `require_account_id`,
`ensure_account`, `handle_new_user` — none of them a write surface for the app. PostgREST cannot
span two tables in one request, and the order cannot be reversed (`products.specification_id` is
`not null`), so there is no shape available from this side. The entry is correct that the RPC is
the only real fix.

**`SECURITY INVOKER`, as the entry says — not `DEFINER`.** Worth stating because the two are one
word apart and the wrong one is a silent widening. Invoker keeps RLS on both tables, so
`with check (public.is_member_of(account_id))` remains the isolation and the function needs no
copy of the account check; definer bypasses RLS and would force the function to re-derive it,
which is a second place for the rule to live. The migration reserves definer for the two cases
that genuinely need it — the recursion trap in §3 and provisioning in §8 — and grants execute to
`authenticated` while revoking from `public, anon`, which is the pattern the new function should
follow.

**What it must preserve, all of it verifiable from the migration:**

- `enforce_sku_limit` is a BEFORE INSERT trigger on `products` and raises `P0001` with
  `hint = 'sku_limit_reached'`. It still fires inside the function; a plpgsql body that catches
  and re-raises must preserve the errcode AND the hint, because `classifyWriteError` matches the
  hint and never the sentence — the trigger's own comment says to.
- `pin_created_by` sets `created_by` from `auth.uid()`, which is a JWT claim and survives either
  security mode. It is the RLS bypass that is the reason to prefer invoker, not this.
- The return shape wants to be the two rows the app already maps (`SPECIFICATION_COLUMNS` /
  `PRODUCT_COLUMNS`), so `toProduct` and the `Product` type do not move.
- `products` cascades from `specifications` on delete, so the failure mode the current code
  protects against — archiving a specification under a LIVE product — cannot arise inside a
  transaction that either commits both or neither.

**What lands on the app side when it exists.** `createProduct` loses its post-failure lookup and
its archive-on-refusal branch; `saveComposition` loses `partial_save` entirely — with both
updates in one transaction there is no half to report — and `PARTIAL_SAVE_MESSAGE` and the
`'partial_save'` member of `WriteFailure` go with it. The two tests the entry names become
assertions about one result rather than about a sequence.

**One case the RPC does NOT remove, and the entry does not mention it.** A committed transaction
whose *response* is lost still leaves the app not knowing what happened — the dropped socket, the
proxy 5xx. That is the `unknown` reason and the "check the list first" copy, and both stay
earned. Atomicity fixes what the database did; it does not fix what the browser was told.

**Nothing done at application level, on purpose.** For `saveComposition` a compensating write
(re-applying the old specification when the second update fails) is worse than reporting: it can
itself fail, and if the product update had in fact committed with only its response lost, the
compensation would destroy the recipe the maker DID approve. The current handling — name which
half is stored, ask for one more press, reload so the screen matches the database — is the best
answer available without a transaction.

**Original entry follows.**

### 4 (original). Neither two-statement write is atomic, and both can half-land

**The gap.** Known and documented at length in the code; recording it here because it is a live
data-integrity risk and had no entry.

`createProduct` (`products.ts:872-959`) inserts a specification then a product; `saveComposition`
(`:995-1036`) updates a specification then a product. PostgREST cannot span a transaction, so both
pairs can commit their first half and fail their second. The handling is careful — the create path
asks the database whether the product landed before it archives anything, and the save path reports
`partial_save` naming which half is stored — but careful reporting is not atomicity: after a
`partial_save` the stored product IS the new recipe in the old pack, which is a combination the
maker never approved and which drives both the label and the safety data sheet.

**Options.**
- *(a) One `SECURITY INVOKER` RPC per operation* taking both halves, as the code comment already
  proposes. Fixes it properly; costs a migration and a second write path to keep in step.
- *(b) Leave the reporting as-is.* The window is small and the copy asks for one more press, which
  heals it — but only if the maker is still there to press it.

**Recommendation: (a), when the schema is next open anyway.** Not urgent enough on its own to
justify a migration, and it needs the schema stream rather than this one. The tests that pin the
current behaviour are `src/lib/products.test.ts` › "admits a half-save rather than claiming nothing
changed" and "returns the product when the insert won and only the answer was lost"; both would
become assertions about the RPC's single result rather than about a sequence.

**Where it bites.** `src/lib/products.ts:872-959` and `:995-1036`.

## Shell and resilience (stream: error boundary, reporting seam, code splitting)

### 5. There is one error boundary and it is at the very top, so any crash replaces the whole app — DONE

**DONE** (commit `feat(5)`): option (b). The same class is mounted twice, told apart by a new
`scope` prop — `app` (the default, outside every provider, copy and behaviour unchanged) and
`screen` (inside `AppShell`, around `<Suspense><Routes>`, in a new `RoutedScreens` component in
`App.tsx`).

**The copy is the whole of the work, and it says the thing the entry warned about out loud.**
The screen-scoped crash reads *"The navigation is still here, so you can open something else
from it. That is not us telling you the rest of Batchlabel is sound: we cannot tell from here
whether the fault was in this screen or in the working-out behind it, and the same working-out
feeds other screens."* The entry's worry was the unspoken implication of a surviving sidebar;
the answer is to state the limit rather than to hide the sidebar. Everything that must survive
being made gentler does — "treat all of it as unchecked", "do not copy it onto a label", "not a
compliance warning" are all asserted at screen scope too. Title differs (`This screen stopped
part-way through` vs today's `Batchlabel stopped part-way through this screen`) and a test pins
that they differ, because one sentence shared between the two mounts is the regression.

**Two things the entry did not specify, both decided against the obvious version.**

- **`resetKey`, not `key`.** The entry says "keyed on the pathname so it clears on navigation".
  A literal `key={pathname}` also remounts the whole routed subtree on *every* navigation,
  including between two products, where React Router deliberately keeps the same element
  mounted and the screen keeps its working state. So the reset is a prop compared in
  `componentDidUpdate`, which only runs when there is a crash to clear and changes nothing on
  the healthy path. Without it the maker keeps a sidebar that lights up and goes nowhere for
  the rest of the session, which is worse than the app stopping.
- **No second "Go to Studio".** At screen scope it would sit inches from the sidebar's own
  Studio link, same words, one a full document load and one a client-side navigation, with
  nothing to tell them apart. The reload button stays; the copy names the navigation as the
  soft way out.

**Failed chunk fetches now land inside the shell**, which is what the entry wanted from (b):
`ScreenNotLoaded` is thrown by the lazy screens, all of which are inside the inner boundary, so
a mid-deploy navigation is a message in the content area. Its screen-scoped copy gains one
clause the app-scoped one cannot honestly carry — that if the cause is a deploy, *any other
screen this tab has not already opened will fail the same way* — because Vite fingerprints
every chunk, so that is a fact and not a hedge, and it saves the maker discovering it one
screen at a time.

**The banned-register scan is extended, and is now generated rather than listed.** `EVERY_COPY`
is a cross product of `Record<CrashKind, true>` × `Record<CrashScope, true>` × (named screen /
not), so a third kind or a third scope added without adding it to the scan is a typecheck
error. A hand-kept list was the thing that would have gone stale on exactly this change.

+13 tests in `ErrorBoundary.test.tsx` (18 → 31), +2 source assertions in `App.split.test.ts`.

**Original entry follows.**

### 5 (original). There is one error boundary and it is at the very top, so any crash replaces the whole app

**The gap.** `App.tsx` now wraps everything — providers, shell, router, toaster — in a single
`ErrorBoundary`. That guarantees the app can never go blank again, which is the thing that was
actually broken. It also means a render error inside one screen tears down the sidebar with it:
the maker loses the navigation, and their only ways out are reload or a fresh load of `/`.

A second boundary around `<Routes>` (inside `AppShell`) would confine a screen's crash to the
content area. It is a different product, not a smaller version of the same one, so it is here
rather than done.

**Options.**
- *(a) Leave it as one top-level boundary.* Blunt, and honest by construction: the app stops
  whole and says it cannot vouch for what was on screen. Nothing implies the rest is fine.
- *(b) Add a route-level boundary as well,* keyed on the pathname so it clears on navigation.
  The maker keeps the nav, can open a different product, and a **failed chunk fetch** (entry 8 —
  the common cause is a mid-session deploy) stops being a full-app crash screen and becomes a
  message in the content area. The cost is the implication: a working sidebar tells someone,
  without saying it, that the rest of the app is trustworthy. We cannot establish that from a
  caught render error — we do not know whether the fault was in the view or in the derivation
  that produced the values they were reading a second ago.
- *(c) Route-level only.* Rejected outright: it does not cover `AuthProvider`,
  `EntitlementProvider`, `ProductsProvider`, `WorkspaceProvider` or `AppShell`, so the blank
  document is still reachable — and `ProductsProvider` is the newest code in the repo.

**Recommendation: (b), with the inner boundary's copy kept distinct from the outer one's.**
Inner should say "this screen stopped, the rest of Batchlabel is still running, but do not trust
what was on this one"; outer keeps today's wording. Roughly an hour, most of it copy. Not done
here because it changes what a customer sees at the worst moment they will ever have with this
product, and that is your call rather than a refactor.

**Where it bites.** `src/App.tsx` (the `<ErrorBoundary>` wrapper) and
`src/components/ErrorBoundary.tsx` — the same class already takes a `source` prop precisely so a
second mount can be told apart in the reports. The copy is `crashCopy()` in that file, guarded by
the banned-register scan at the bottom of `src/components/ErrorBoundary.test.tsx`.

### 6. Error reports go to the customer's own console and nowhere else — DONE (inert until Rhys makes the project)

**DONE** (commit `feat(6)`): option **(a) Sentry on the free tier, with the payload restricted**,
and the payload decided at the same time as the vendor, as this entry asked. Two new modules,
`src/lib/scrub-report.ts` and `src/lib/error-sink.ts`; `setErrorSink` is called from one line of
`src/index.tsx` and **no `reportError` call site moved**, which is what the seam was for.

**THE SCRUBBER IS THE CHANGE. THE INTEGRATION IS THE SMALL HALF.** `scrub-report.ts` is pure,
imports nothing but a type, and has its own test file, because "what leaves the machine" must be
readable in one place rather than emergent from a vendor's configuration.

**The rule is an ALLOW-LIST**, and the argument is entirely about which way each one fails. A
deny-list — send the report, strip what looks like customer data — is safe until somebody adds a
field to `ErrorReport`, throws a new kind of error, or upgrades the SDK; on that day it fails
silently towards SEND and a formulation percentage appears in a third party's web UI with nothing
going red. An allow-list fails towards DROP: the same day, the new value is `[redacted]`, somebody
notices a gap in a dashboard, and the fix is a deliberate line in a diff. The price is real and is
paid in maintenance — a route, a call site or an `Error` subclass that nobody adds to the lists in
that file reports as redacted.

**What leaves:** the reference (generated per report, meaningless elsewhere); the `source`, matched
against the four literals that exist rather than a slug shape, because a call site that starts
interpolating a product id into it is still slug-shaped; the error `name`, matched against a list because
`error.name` is writable and `error.name = product.name` passes any identifier check; the message
ONLY if it matches one of the recognised forms, with the variable parts redacted; the ROUTE
PATTERN rather than the URL; stack frames rebuilt into path/line/column with the origin and any
query dropped; React component names.

**What does not:** any message we do not recognise (it leaves as a 16-bit fingerprint and nothing
else, which is what keeps unknown faults grouping); **a stack frame's function name**, because V8
infers function names from data — `{ [batch.code]: fn }` produces `at Object.BL240417A (…)`, it
survives minification, and no shape check can tell it from `deriveHazards`; the `stack` as a string, because V8 puts the
whole unredacted message on its first line and `ScreenNotLoaded` appends a second one as
`caused by:`; the URL, in particular `/products/<uuid>` and `?session_id=` — a uuid is not safe to
send because it is a uuid, it names a product that may not have launched; anything React puts in a
minified error's `?args[]=`; and every field `ErrorReport` grows next.

**Four things were tightened after the fact, and each one had a false comment next to it.**

- **The redaction fingerprint was reversible and the file said it was not.** Removed text carried
  `[redacted:xxxxxxxx]`, a 32-bit FNV-1a of the removed value. Run against the real exported
  `digest`: a formulation percentage came back uniquely from all 10,001 candidates between 0.00 and
  100.00, a supplier name uniquely from 4,096, and 99.995% of a generated 312,000-name candle
  catalogue came back uniquely from its tag. A 32-bit hash only collides freely when the candidate
  space approaches 2^32; a maker's catalogue is a few hundred names and the template around the tag
  is public. The per-value tags are **gone** — they contributed nothing to grouping, because
  `eventFor` fingerprints on `[name, messageDigest]` and Sentry never reads the exception value
  here. The surviving `messageDigest` is now taken over **the text we send** when the message was
  recognised (so the removed value never enters a fingerprint at all: all 124,800 catalogue names
  produce one identical tag) and over the original **only** when it was not recognised, where
  nothing else separates two unknown faults — and there it is **16 bits**, which on the same
  catalogue leaves 5.8 candidates per tag instead of one while keeping 65,536 issue buckets.

- **`frames[].function` was the one field whose default for an unanticipated string was SEND.** It
  is dropped, above. `filename` + `lineno` + `colno` are what Sentry's source-map resolution needs.

- **The scrubber's mark was forgeable.** `beforeSend` looked for the literal `scrubbed: 'yes'`, so
  one `Sentry.setTag('scrubbed', 'yes')` on a scope anywhere would have waved a raw exception
  message and absolute file paths through. The mark is now minted from the CSPRNG at module load,
  is not exported, and is swapped for `'yes'` on the way out so the wire carries the fact and not
  the key.

- **`infer_ip` is asserted on the transmitted bytes.** `dataCollection` is a deny-list at the SDK
  layer: `resolveDataCollectionOptions` switches its baseline to an all-TRUE `DEFAULTS` the moment
  the option is non-null, so `dataCollection: {}` — or the same object with one key deleted —
  produces `sdk.settings.infer_ip: "auto"` and Relay stores the end user's IP on every event. No
  allow-list in this app can catch that: `_enhanceEventWithSdkInfo` runs *after* `beforeSend`. So
  the object is typed to require every category by name (a category added in an SDK minor is a
  typecheck failure, not a silent opt-in) and the test parses the real envelope and requires
  `infer_ip === "never"` with no `user` key, with a negative control that deletes a key and watches
  it become `"auto"`.

**The vendor chunk is no longer emitted on a build that cannot use it.** `installErrorSink` checks
the DSN before importing, so a DSN-less build never *fetched* the 89.46 kB chunk — but Rollup
followed the dynamic import and wrote it anyway, into every preview deploy and every local `dist`.
A build-only Vite plugin resolves `@sentry/react` to a two-line stub when `VITE_SENTRY_DSN` is
unset, and the chunk drops to 0.07 kB. The stub's `init` returns `undefined`, which is the value
`installErrorSink` already reads as "the SDK declined to start", so the crash screen's copy stays
true. The plugin logs which way it went on every build, because the failure worth naming is a DSN
set in Vercel that `loadEnv` cannot see.

**The SDK is not allowed to collect around it.** `defaultIntegrations: false` with `integrations:
[]` removes breadcrumbs (console, DOM clicks, fetch, XHR and history — a transcript of a maker's
session), the global handlers, HttpContext (which attaches the page URL), culture context and
session tracking. `dataCollection` is set with every category off, including
`stackFrameVariables`, which would otherwise capture local variables — the most direct possible
route for a formulation value. `enhanceFetchErrorMessages` is off because its default REWRITES the
app's own `Error` objects. And `beforeSend` drops any event that did not come through the
scrubber, so a `Sentry.captureException(error)` added anywhere in this app in a year sends nothing
rather than sending a raw message. That last one is asserted against the real SDK with the
transport replaced, not against a stand-in.

**IT IS INERT WHEREVER `VITE_SENTRY_DSN` IS ABSENT — WHICH IS NO LONGER PRODUCTION.** Rhys has
created the Sentry project, in the **EU region**, and has set `VITE_SENTRY_DSN` on Vercel
production. So the honest statement is narrower than it was: a build without the variable — local
dev, and any preview that does not inherit it — installs no sink at all, `@sentry/react` is never
even fetched, `hasErrorSink()` stays false and the crash screen goes on saying "This has not
reached us automatically", which on that build is true. **A production build of this branch will
install the sink and start sending.** There is still no DSN in this repo and no placeholder that
could be mistaken for one; the value lives only in Vercel.

Read that as the merge condition it is. The gate on shipping this is not the code — it is the
Sentry DPA, which is not signed. Merging starts personal data flowing to a processor with no
Article 28 contract in place. See the www privacy notice work, which lands first for the same
reason.

The DSN is checked for shape before anything is installed, and the client `init` returns is checked
after, because the failure that matters is silent: a half-installed sink makes that sentence a lie.

**Loaded on demand, deliberately.** A static import would put the vendor into the entry graph —
the set a maker must download before route `/` draws anything, which entry 8 measured and this
build prints on every run. The cost is that a crash in the few hundred milliseconds before the
chunk lands reaches the console and nothing else; during that window `hasErrorSink()` is false, so
the customer is told the truth. It is deliberately NOT buffered: a queue would make that sentence
claim a report had reached us while it was still on the device. The entry graph moved 563.50 kB →
571.78 kB (165.90 → 168.82 kB gzip), which is `scrub-report.ts` and `error-sink.ts` themselves; the
vendor is in a chunk of its own and is not on it.

**And a finding worth the next person's time: HOW you dynamically import it is worth 133 kB gzip.**
`import('@sentry/react').then((module) => …)` takes the whole namespace, and `@sentry/react`
re-exports the whole of `@sentry/browser` — session replay, user feedback, a browser-tracing
integration for every router anyone has shipped. Nothing can be tree-shaken off a namespace object,
so Rollup emitted a **494 kB (163 kB gzip)** chunk for a file that uses two functions. Destructuring
the import — `.then(({ init, captureEvent }) => …)` — makes the same chunk **89 kB (30 kB gzip)**.
Off the critical path is not the same as free: a maker still downloads it on every load.

**THE PROJECT EXISTS, IN THE EU REGION, AND THE DSN IS SET ON VERCEL PRODUCTION.** No DSN is in
this repo and there is no placeholder that could be mistaken for one; the two DSN-shaped strings in
`error-sink.test.ts` are under the reserved `.invalid` TLD, which by RFC 2606 can never resolve.

**The EU region needs no code change, and that was verified rather than assumed.** `@sentry/core`
builds the ingest URL out of the DSN's own host, so an `ingest.de.sentry.io` DSN posts to the EU
host by itself. There is no ingest hostname, no `region` option — none exists in `BrowserOptions` —
and no `tunnel` anywhere in this repo, and there must not be: a hardcoded host is a thing that
silently stops matching the DSN, and `tunnel` is the only setting that would override it.

**Two things about the region that the word "EU" hides, and both belong in a privacy conversation
rather than in this file's summary of them.** Storage in that region is Frankfurt, but account and
org settings, access tokens, audit logs, project metadata and the DSN keys themselves sit in the US
regardless of region. And the counterparty on the DPA is Functional Software, Inc., a US company.

This line used to read "there is no EU entity to contract with", and that half-sentence cost a
later reader a round trip: there IS a Sentry entity in the EU — Sentry Software Netherlands B.V. —
and finding it makes the line look wrong. It is not the counterparty. It is Sentry's Article 27
REPRESENTATIVE, the EU address a data subject or a supervisory authority writes to, and a
representative is not a party to the processing agreement. So the correct statement is the narrow
one: the processor you contract with is American, and the transfer is a transfer to the US whatever
the storage region says. So "the data is in the EU" is not a sentence anyone should repeat to a
customer without qualification. The www privacy notice states the qualified version, with the
safeguards it relies on.

**CONTENT SECURITY POLICY: THERE ISN'T ONE, IN EITHER REPO.** Checked because an EU ingest host
missing from a `connect-src` fails silently — every test passes, the code is correct, and no error
ever arrives. `vercel.json` here carries only a rewrite, there is no headers block, no CSP meta tag
in `index.html`, and the marketing repo sets no headers either. So nothing blocks the EU host today.
**If a CSP is ever added to this app, `connect-src` must include the DSN's host** — and it is the
DSN's host, not `*.sentry.io`, because the region lives there.

**Still Rhys's, and not doable here — and the first one now BLOCKS MERGE rather than blocking
launch.** Enter into Sentry's DPA: it is not automatic, it binds whoever accepts it, and with the
DSN already live in Vercel the only thing standing between customer error data and an unsigned
Article 28 relationship is that this branch is not merged. Confirm too that the region is set on
the **organisation** — in Sentry it is fixed when the org is created and cannot be changed
afterwards, and the privacy notice now asserts Frankfurt. Naming Sentry as a processor is done, on
www. Source maps are not uploaded, so frames arrive
as `/assets/<chunk>.js:line:col` until a release step exists — that needs `@sentry/vite-plugin` and
an auth token, which is its own decision.

**The gap.** `src/lib/report-error.ts` is a seam, not an integration. `setErrorSink()` is exported
and called by nothing, so today every report is a structured `console.error` on the maker's own
machine. That is a real improvement on the previous state (not one `console.error` anywhere in
the repo) but it is not observability: nobody watches a customer's console, so we still find out
when they write in. Choosing where reports go costs money and posts customer data to a third
party, which is why it is logged rather than picked.

**Options.**
- *(a) Sentry.* The default. Free tier around 5k errors/month, then roughly $26/month. Source-map
  upload, grouping, release tracking. US processor, so it needs naming in the privacy notice on
  www and a look at the DPA.
- *(b) Self-hosted GlitchTip* (Sentry-protocol compatible). No per-error cost and the data stays
  on infrastructure we control, which is the easiest privacy answer. Costs a small VM and someone
  to keep it patched — that is the real price, and it is paid monthly in attention.
- *(c) A one-endpoint sink of our own,* posting the `ErrorReport` to the marketing deployment
  (which already holds the service-role key and already fields cross-origin calls from this app)
  and writing it to a table. Cheapest, no new vendor, no new processor. No grouping, no alerting,
  no source maps — a log, not a tool.
- *(d) Nothing for now.* The console line at least gives support a reference to ask for.

**Recommendation: (a) Sentry on the free tier, with the payload restricted.** Half a day including
the privacy-notice line. (c) is what I would do if the answer to the privacy question turns out to
be "no third party at all", but grouping and alerting is most of the value and we would end up
rebuilding it.

**Decide the payload at the same time.** This is a compliance tool: an exception message can carry
a product name, a supplier name or a formulation percentage, and a `componentStack` can carry a
route with a product id in it. Shipping `message` whole is far more useful for debugging and is
the thing most likely to embarrass us. `ErrorReport` is deliberately flat and JSON-safe so a
scrubbing function can live in the sink and be tested on its own.

**Where it bites.** `src/lib/report-error.ts` — `setErrorSink` is the only line that changes on the
day this is decided; no call site moves. `hasErrorSink()` drives one sentence of customer copy
("This has not reached us automatically"), which disappears by itself once a sink exists — see
`src/components/ErrorBoundary.test.tsx` › "stops saying it once reports go somewhere".

**Small follow-up — DONE, see entry 2.** `src/lib/report-error.ts` and `src/lib/lazy-screen.ts`
are both on the coverage `include` list now, and both clear the per-file floor; `lazy-screen.ts`
needed a test file of its own to get there (`lazyScreen` itself had none). The rest of this entry
is untouched: no vendor, no dependency, no endpoint — that decision is Rhys's.

### 7. Only render errors are caught; a failed promise in a handler is still invisible — DONE (listeners only)

**DONE** (commit `feat(7)`): option (a), **listeners only, no transport**. `window.onerror` and
`unhandledrejection` are installed at boot from `src/index.tsx`, forwarding into the existing
`reportError` seam. No vendor, no dependency, no endpoint — entry 6 is untouched and is still
Rhys's. The new module is `src/lib/global-errors.ts`, on the coverage floor at 95/83/100/95.

**The double-report needed more than it looks like it needs, and this is the finding.** The
obvious guard — "don't file a value a boundary already filed" — cannot work, for two reasons
found by reading React 18.3.1 rather than by guessing:

1. **The window sees it first.** React dispatches the error at the window during the render
   that threw; `componentDidCatch` runs afterwards. So the backstop always wins the race, and
   the good report — the one with the component trail — always looks like the duplicate.
2. **The values are not the same value.** In a development build `beginWork` re-invokes a
   component that threw, twice, to recover a stack (`react-dom.development.js:4113` onwards,
   `invokeGuardedCallbackDev`). A component that does `throw new Error(...)` therefore produces
   a NEW error object each time. Measured: one crash, **three** reports — two from the window,
   one from the boundary, all distinct objects. Identity comparison cannot see it.

So the fix is two guards doing two different jobs, and it is worth keeping them apart:

- **Exact, everywhere.** `reportError` holds a `WeakMap` of values it has filed and hands the
  same report back rather than filing twice. One thrown value is one report and one reference,
  whichever call site sees it first; a `componentStack` arriving on the later call is attached
  rather than dropped.
- **Coarse, backstop only.** The listeners yield one macrotask and then ask
  `describedRecently(value)` — name and message, within three seconds — before filing. If a
  boundary has described the fault in the meantime they say nothing. This is a fingerprint and
  not an identity, which is the right resolution for a backstop but would be wrong for
  `reportError` itself, so `reportError` does not consult it and every direct call site still
  gets its own reference.

Measured after: one render crash, **one** report, `source: 'render'`, component trail intact.
An unhandled rejection, which no boundary ever sees, still files.

**Not filtered, deliberately.** Extension noise, blocked third-party scripts and the bare
`"Script error."` all still file. Entry 7 is right that they are noise and right that the
filter belongs in the sink — but today the destination is the maker's own console, where a
line costs nothing and a dropped line costs a developer their only clue. It becomes a real
decision on the day it costs money, which is entry 6's day, in entry 6's place.

Also not done: `preventDefault()`, which would suppress the browser's own (better) reporting
and which React reads as a signal to stop logging the error itself.

+10 tests in a new `src/lib/global-errors.test.tsx`, +7 in `report-error.test.ts`.

**Original entry follows.**

### 7 (original). Only render errors are caught; a failed promise in a handler is still invisible

**The gap.** An error boundary catches errors thrown during render and in lifecycle methods. It
catches nothing thrown in an event handler, in a `setTimeout`, or in an unhandled promise
rejection — which is most of how this app actually fails, because most of what it does is
`await supabase…`. Those are handled locally where the code expects them (billing, account and
product writes all return typed failures), but an unexpected one goes nowhere at all.

**Options.**
- *(a) Install `window.onerror` and `window.onunhandledrejection` at boot,* both forwarding to
  `reportError`. Two lines in `src/index.tsx`. Catches everything.
- *(b) Add `reportError` calls at the specific `catch` sites that currently swallow.* Precise and
  quiet, but it is a per-site job across files this stream does not own.
- *(c) Leave it.*

**Recommendation: (a), then (b).** The caveat on (a) is noise: browser extensions, blocked
third-party scripts and cross-origin errors (which arrive as a bare `"Script error."` with no
stack) all land in the same funnel, and on a paid plan noise is literally a bill. Worth pairing
with a filter in the sink that drops reports with no stack and no useful message. Not done here
because `src/index.tsx` is outside this stream's files, and because it is the single change that
most affects what a paid vendor charges.

**Where it bites.** `src/index.tsx` (the boot path), calling `reportError` from
`src/lib/report-error.ts`. Nothing else moves.

### 8. The entry chunk is still 570 kB, and 212 kB of it is the Supabase client — DONE (a); (b) still not worth it

**DONE** (commit `perf(8)`): option **(a)**, measured before and after rather than assumed.
Option (b) was left alone, agreeing with the entry. Option (c) is still unavailable and (d) was
the alternative (a) had to beat.

**What (a) actually bought, measured on this branch.** The method: build, record every chunk;
change one customer-visible string in a file that is in the entry chunk; build again; see which
fingerprints moved. That is a deploy that changed only our own code, which is what nearly every
deploy is.

| | before | after |
|---|---|---|
| critical path (route `/`), raw | 578,158 B, one chunk | 577,643 B, **five** chunks |
| critical path, gzip | **168,898 B** | **170,167 B** (+1,269 B, +0.75%) |
| re-downloaded after a code-only deploy, gzip | 210,502 B (**the entire build**) | **91,787 B** |
| …of which is on the critical path | **168,898 B** | **49,735 B** |

So a returning maker after a deploy fetches **50 kB gzip instead of 169 kB before their first
screen draws — 71% less** — and pays **1.3 kB extra, once, on a cold visit**. The entry
predicted "about 119 kB instead of 570 kB"; the real figure is better than that, because
Vite's hashing cascades: today a change to one of our files re-fingerprints *every* chunk in
the build, including all nine on-demand screens, since they carry the entry chunk's file name.
The vendor chunks are the only ones that break that chain, because nothing in them imports us.

**What is split, and the rule for adding to it.** `@supabase/*` (218 kB), react + react-dom +
scheduler (142 kB), react-router (23 kB), sonner (34 kB). The list is not "the big packages" —
it is the packages route `/` cannot draw without, every one of which is in today's entry chunk
already, which is the whole reason this cannot regress first paint. `lucide-react` is
deliberately NOT on it: Vite emits two of its icons as their own on-demand chunks, and the
one-line version of this rule (`if (id.includes('node_modules')) return 'vendor'`) would pull
them forward. That version is shorter, reads as the obvious simplification, is a first-paint
regression, and no build log would say so — so the rule lives in `src/build/vendor-chunks.ts`
where a test can call it, and `src/build/vendor-chunks.test.ts` (7 tests) exercises exactly
that boundary. A config cannot be imported from a jsdom test — esbuild refuses to start there —
which is why the rule moved out of `vite.config.ts` rather than being scanned as source.

**ONE THING THE SPLIT COSTS, AND IT IS THE STANDING RULE IN BUILD-OUTPUT FORM.** Rollup's
"chunks are larger than 500 kB" warning **stops firing**, because no single chunk is over 500 kB
any more. Not one byte has left the critical path. A build that reads better and is not is
exactly what this codebase is not allowed to ship, and the entry itself says the warning is
telling the truth and should be left firing. So the signal is replaced rather than lost: a
small plugin in `vite.config.ts` prints the **entry graph** — the entry chunk plus everything
it statically imports, which is the set a browser must hold before route `/` draws, dynamic
imports deliberately excluded — and warns above the same 500 kB. It fires today, on the same
weight, for the same reason:

```
[plugin:batchlabel:entry-graph-size] entry graph is 563.50 kB across 5 chunks (165.90 kB gzip)
 — what route / must fetch before it can draw anything
```

**(b), the lazy Toaster: still no, and now with a number.** `sonner` is its own chunk at 9.56 kB
gzip, so the trade the entry described is unchanged — 5.6% of what is left, against a
confirmation toast a maker never sees if one fires before the chunk lands. Being its own file
does mean that if the answer ever changes it is a one-line change with the cost already
measured.

**(c) is still not available** for the reason the entry gives, and it is worth restating because
the split makes `supabase` look separable: it is a separate FILE, not a deferred one.
`AuthProvider` calls `getSession()` on mount and the app renders nothing until it answers, so
the browser waits for those 57 kB gzip either way.

`src/build/vendor-chunks.ts` is not on the coverage floor in `vitest.config.ts`: the rule for
that list is money, data, or a true sentence about a customer's compliance, and this is none of
the three. It is fully covered by its own tests regardless.

**Original entry follows.**

### 8 (original). The entry chunk is still 570 kB, and 212 kB of it is the Supabase client

**The gap.** Route-level splitting is done; the numbers are below. What is left on the critical
path is almost all vendor code, and none of the remaining moves are free.

Measured on this branch with `npm run build`:

| | before | after |
|---|---|---|
| entry chunk (what route `/` needs) | 704.60 kB / **197.67 kB gzip** | 570.26 kB / **167.22 kB gzip** |
| loaded only on demand | — | 144.73 kB / 43.53 kB gzip, across 12 chunks |

Route `/` is deliberately **not** split, so the first screen after sign-in costs no extra round
trip; every other screen is fetched when first opened. `src/App.split.test.ts` guards that, because
making all nine routes look the same is a one-line change that reads as tidying.

Inside the remaining 570 kB (minified, uncompressed): `@supabase/supabase-js` 212.4 kB, React DOM
129.8 kB, our own code 119.2 kB, other dependencies 42.7 kB, `sonner` 33.9 kB, React Router 14.1 kB,
React 12.3 kB, Lucide icons 10.4 kB.

**Options.**
- *(a) `manualChunks` to split vendors out of the entry.* Does **not** improve first paint — every
  one of those chunks is needed to draw anything, so it is the same bytes in more files. It improves
  the *second* visit: with vendors in their own fingerprinted chunks, a deploy that only changes our
  code makes a returning maker re-download about 119 kB instead of 570 kB. Measured and working; the
  cost is a few extra requests and one more moving part in `vite.config.ts`.
- *(b) Lazy-load the `Toaster`.* Worth 9.6 kB gzip, 5.7% of what is left. The risk is small and
  real: a toast fired before the chunk lands is a confirmation the maker never sees.
- *(c) Defer `@supabase/supabase-js`.* The biggest single item, and not available — `AuthProvider`
  calls `getSession()` on mount and the app renders nothing until it answers, so deferring it only
  moves the wait.
- *(d) Stop here.* 167 kB gzip for a signed-in workshop tool is unremarkable.

**Recommendation: (a) when someone is next in `vite.config.ts`, (d) otherwise.** (a) is the only one
with a repeated payoff and it cannot regress first paint; it just needs a before-and-after build so
we are not guessing. (b) is not worth 9.6 kB against a dropped confirmation toast. The 500 kB Rollup
warning still fires on the entry chunk — leave it firing, it is telling the truth.

**Where it bites.** `vite.config.ts` (untouched by this stream — Vite's default chunking produced
the shared fragments above on its own), `src/App.tsx` (the eager/lazy split) and
`src/lib/lazy-screen.ts` (what happens when an on-demand chunk does not arrive, which today
replaces the whole app — see entry 5b).

## Known correctness bugs (stream: src/pages/** and src/lib/entitlement.tsx)

### 9. The `no-account` screens are written and correct, and inert until entry 1 lands — DONE

**DONE** (same commit as entry 1, `fix(1)`): no change to the screens, which were right. Entry 1's
branch is the whole of it. Verified rather than rewritten: `Studio.tsx:175`, `Products.tsx:108`,
`Specification.tsx:105` and `ArtefactDesigner.tsx:95` all branch on `'no-account'`, the store now
publishes it on the mount path as well as on `reload`, and the shared `ProductsStatus` union binds
the two ends at typecheck so they cannot drift apart silently. `src/pages/no-account.test.tsx`
(16 tests) green on the receiving end, `product-store.test.tsx` (24) on the sending end.


**The gap.** This stream gave Studio, the specification screen and the artefact designer the
`no-account` branch that only `Products.tsx` had, and moved the copy into one component so the
three sentences cannot drift (`src/components/NoAccountNotice.tsx`). Entry 1, found independently
by the coverage stream, says the store never publishes `'no-account'` on the mount path — it calls
`fetchProducts(null)`, which refuses, and the refusal maps to `'error'`.

So the two findings are the two ends of one bug. Today an abandoned Google signup gets **"We
could not read your products"** and a **Try again** button on every screen: the wrong sentence
(nothing failed) with the one action that cannot help (waiting does not finish a signup). The
branches added here are what that person should see instead, and they start rendering the moment
entry 1's three lines land — no further work on the screens.

**Options.**
- *(a) Apply entry 1 (option (a) there) and flip the pinned expectation.* Three lines in
  `product-store.tsx`, plus `src/lib/product-store.test.tsx` › "reads the mount path as error
  today, not as no-account", which deliberately pins today's behaviour and must become
  `'no-account'` in the same commit. `src/pages/no-account.test.tsx` already covers every screen
  on the receiving end, so nothing new is needed to prove it.
- *(b) Leave both.* The screens keep saying the wrong one of three, and the copy written for the
  other two stays unreachable.

**Recommendation: (a), and it wants one person doing both files in one commit** — this stream did
not touch `product-store.tsx` precisely because the other stream had just pinned its behaviour in
a test, and a silent change there would have turned their gate red for reasons they could not see.
It is about fifteen minutes now that both ends exist.

**Where it bites.** `src/lib/product-store.tsx:165-197` (entry 1) is the sending end.
`src/components/NoAccountNotice.tsx`, `src/pages/Studio.tsx`, `src/pages/Specification.tsx`,
`src/pages/ArtefactDesigner.tsx` and `src/pages/Products.tsx` are the receiving end, tested in
`src/pages/no-account.test.tsx`.

### 10. A workspace with no account behind it still offers **New product** — DONE

**DONE** (commit `feat(10)`): option (b). The rule is one exported predicate,
`createIsCertainToFail(entitlement)` in `src/lib/membership.ts`, rather than three-way logic
copied onto four surfaces — it names `suspended` and `no_membership` and fails OPEN on
everything else, with the `unknown` case (where the database resolves the account itself and
the create WOULD have worked) argued in the comment so a later pass does not "tidy" it into
covering all of `no-account`. Wired into `Studio.tsx`, `Products.tsx` and `Materials.tsx`
(`MaterialDetail`), which replaced their local `suspended` checks with it.

`NewProductDialog` deliberately gained no second early return: unlike suspension — a bare
42501 the migration will not explain — the `no_account` write path already answers with
NO_ACCOUNT_MESSAGE, which names the cause and points at the setup step. A duplicate of that
sentence in the dialog would be a second place for it to drift. Its header comment says so.

Tests: 5 in `membership.test.ts` (including the two that pin the fail-open cases) and 6 in
`no-account.test.tsx` asserting the button is gone for the unfinished signup and still present
for the other two causes.


**The gap.** Studio, Products and a material detail page all keep their create button when the
store says `no-account`, because only `suspended` hides it. The dialog opens, the maker fills in
four fields, and the write is refused. It is not refused *badly* — `products.ts` already
distinguishes `no_account` from `account_ambiguous` and writes a true sentence for each, and the
ambiguous one correctly offers no retry — but the person still typed a form in to be told no.

**Options.**
- *(a) Hide the create the same way suspension does.* Cleanest for the unfinished-signup case,
  where we know the write cannot succeed. Wrong for the `unknown` case, and that is the catch:
  when the entitlement read merely blipped, `createProduct` omits `account_id` and the database's
  own `current_account_id()` default resolves it — so for a single-account maker the create
  **would have worked**, and hiding the button takes away a thing they can actually do because
  one read of ours failed.
- *(b) Hide it only for `entitlement.status === 'no_membership'`,* the one cause where the write
  is certain to fail. Keeps it for the other two. More code, and three-way create-button logic on
  four surfaces.
- *(c) Leave it and let the write explain.* What happens today. Costs a wasted form; the message
  at the end is honest and specific.

**Recommendation: (b), or (c) if this is not worth the branch.** Not done here because it removes
a control from a screen on a guess about which of three causes is in play, and the guess is wrong
in the direction that costs a maker a product they could have created.

**Where it bites.** `src/pages/Studio.tsx` and `src/pages/Products.tsx` (`actions={unavailable ?
undefined : ...}`), `src/pages/Materials.tsx:390` (`suspended`, in `MaterialDetail`), backstopped in
`src/components/NewProductDialog.tsx`. Failure copy: `src/lib/products.ts:200-230`.

### 11. A create now re-reads the SKU count. Nothing else that moves it exists yet — DONE (with 12)

**DONE** (commit `fix(11,12)`), together with entry 12, whose recommendation is the one that
changed: 12 called its own guard "a backstop, not a model", and doing (a) there would have been
a second patch. The shape was fixed instead.

Three states are now named where there were two. `SkuCount` in `src/lib/membership.ts` is
`{known:true,count}` | `{known:false,reason:'unread'|'stale'}`, read through `readSkuCount`;
`EntitlementValue` gained `skuCountStale` and `noteSkuCountChanged()`, which the create calls
instead of `refresh()` — it states the fact ("the count moved") rather than the request, and the
provider marks the held number stale until the read that answers for it lands. Clearing is done
by that read only, and the `active` guard means an earlier in-flight read cannot clear it
(pinned).

Entry 11's own recommendation, (a), stands: no abstraction over mutations, two call sites do not
justify one. What it gains is a named seam — `noteSkuCountChanged` — so the archive path entry 11
worries about has one obvious call and a comment saying to use it rather than `refresh`.

**Where the recommendation was wrong.** 11 says only that whoever builds archive must remember to
`refresh()`. Reading the code, `refresh()` is not enough on its own: it re-reads while leaving
every screen free to keep stating the pre-write number for the whole round trip, which is exactly
the bug 12 then patched. The seam has to carry the fact, not just the request.

**And one premise is wrong.** 11 says "the browser holds no DELETE grant on `products`". Against
`20260803120000_account_data_schema.sql` §7 it does: `grant select, insert, update, delete on
public.products to authenticated`, with a matching policy `"products are deletable by account
members"`. It is `specifications` that has no DELETE, deliberately, because deleting one cascades
to its products. So a delete path is available to this client today and is simply not built —
which makes the seam above a live concern rather than a hypothetical one. (Read from the schema
branch's migration, which this repo does not contain; worth confirming against the deployed
database before anything relies on it.)

**The gap.** `entitlement.skuCount` is the database's own count and was read once at mount; until
this stream, `BillingReturn` was the only caller of `refresh()` in the app. `NewProductDialog` now
calls it after a successful create, which was the one write in this app that moves the number.
The question is what else should, and the answer today is "nothing, but not by design".

- **Delete and archive: there is no path.** The browser holds no DELETE grant on `products`, and
  nothing in `src/pages/**` archives one. When either arrives it must call `refresh()` on success
  — an archive frees a SKU slot, and a meter that does not notice tells a maker at their limit
  that they are still at it.
- **Plan change: covered, but by accident.** It changes `sku_limit`, not the count, and it happens
  through Stripe: `createPortalSession` → `leaveFor(url)` leaves the origin entirely, so the
  return is a cold load and every provider remounts. Nothing in the app re-reads it, and nothing
  needs to — *until* a plan change becomes possible without leaving, at which point this silently
  starts showing the old allowance.
- **A refused create: deliberately does not refresh.** `SkuLimitNotice` takes the refusal as its
  own input, because the refusal is the established fact and the entitlement's `can_modify` is a
  read that may be a moment old. Re-reading there would replace a fact with an older guess.

**Options.** *(a)* Leave it and rely on whoever builds archive to remember. *(b)* Make the store's
`reload()` refresh the entitlement too — rejected: `reload()` is also what a saved composition
calls, and a composition moves no count, so that is a round trip per save for a number that cannot
have changed. *(c)* Move the count behind a hook that re-reads on any product mutation.

**Recommendation: (a), with (c) if a third mutation ever appears.** Two call sites do not justify
an abstraction; four would.

**Where it bites.** `src/components/NewProductDialog.tsx` (the call, tested in
`NewProductDialog.test.tsx`), `src/lib/entitlement.tsx` (`refresh`), `src/pages/Billing.tsx:58`
and `src/pages/Studio.tsx` (`skuCount` in `Studio`) and `src/pages/Settings.tsx` (`skuCount` in `IdentityTab`) — the three readers.

### 12. Zero is now read as "unknown" in two sentences, which is a patch over entry 11's shape — DONE (with 11)

**DONE** (commit `fix(11,12)`), and NOT by its own recommendation (a), which the entry itself
argues against in the sentence above it. The two local guards are gone.

What replaced them is two rules, each in one place:

- **Is the count knowable?** `readSkuCount(skuCount, stale)` — `unread` (no number: the view
  declined, or the read failed), `stale` (a write of ours moved it, re-read in flight), or the
  number. `unread` beats `stale`, since after a failed refresh both are true and having no
  number is the stronger answer.
- **May it be stated beside a list?** `skuCountBeside(skus, shown)` — refuses any count LOWER
  than the products the screen has already drawn, because an account cannot hold fewer live
  products than this client just read out of it. Zero beside a non-empty list is the loudest
  case of that, not a special one; `1 product · 3 things outstanding across 3 products` was the
  same nonsense and the old guard printed it.

So a genuine zero is sayable again — `skuCountBeside({known:true,count:0}, 0)` is `0` — which is
the objection entry 12 raised against its own fix. Billing does not go through `skuCountBeside`
at all (no list beside its number) but does use `readSkuCount`: it used to state a count a create
had moved, with a matching meter and `aria-valuenow`, for the rest of the session. It now folds
that into the "counting…" state it already had for a read in flight, which is what is happening.

Callers: `Studio.tsx`, `Settings.tsx` (`IdentityTab`), `Billing.tsx`, `NewProductDialog.tsx`.
Tests: 9 in `membership.test.ts`, 4 in `entitlement.test.tsx` (including the in-flight ordering),
3 new in `account-count.test.tsx`, 1 in `Billing.test.tsx`, 1 in `NewProductDialog.test.tsx`
pinning that the dialog says the count MOVED rather than only asking again.

**The gap.** Studio's header and the Settings identity tab both state the account's product count
beside a list of that account's products, and both only render the clause when the list is
non-empty. A count of nought there is not a fact — it is the two sources disagreeing — and it
produced exactly the sentences the brief named: *"0 products · 3 things outstanding across 1
product"* and *"every output on all 0 products this account holds"*, for the whole of a maker's
first session. Both clauses now drop out at zero rather than printing it, which is what they
already did for `null`.

That is a backstop, not a model. It means neither screen can ever say "0 products" — which is
correct where it is used, because the clause is inside a non-empty branch, and would be wrong on
any screen that wanted to state a genuine zero.

**Options.** *(a)* Leave the two local guards. *(b)* Push the rule into `mapEntitlement` so a
zero count reads as null everywhere — rejected, that is a real number and Billing legitimately
shows `0 of 3` to a new account. *(c)* Have the screens compare the count against the list and
say so when they disagree — more honest, and a sentence nobody can act on.

**Recommendation: (a).** The guard is two lines, commented with why it is local, and tested in
`src/pages/account-count.test.tsx`. Revisit only if a third screen states the count.

**Where it bites.** `countWorthStating` in `Studio` (`src/pages/Studio.tsx`) and `scope` in
`IdentityTab` (`src/pages/Settings.tsx`); both carry the reasoning in a comment above them.

### 13. Settings and Materials never mention that the workspace has no account — LEFT, per its own recommendation

**NOT DONE, deliberately.** The entry recommends "(b) is the right shape and (c) is the right
size for today", and re-reading the code agrees: neither screen states anything false. Settings
suppresses the one clause that depends on the store (`IdentityTab`, the `scope` sentence, which
only renders inside `status === 'ready' && products.length > 0`), and Materials is shipped
reference data that is identical for every account and says so in its own header. The gap is
silence, not a lie, so it is not the standing rule being broken. (b) is a global piece of shell
chrome and needs decisions about dismissability and about the billing pages that are more
product than this warrants.

**One thing changed since this entry was written, and whoever does (b) should know it.** Entry
10 now hides "Make something with this" on a material detail page for `no_membership` as well
as for `suspended`. Materials still says nothing, so a maker with an unfinished signup sees a
control simply not be there. That was already true for suspension — this widens it by one
state rather than introducing it — and it is an argument for (b) rather than a reason to do (a)
here: putting `NoAccountNotice` on Materials alone would explain a missing button on the one
screen while Settings, Billing and Records stayed silent.


**The gap.** Entry 9 covers the screens that read the products store. Settings does read it, and
correctly suppresses the one sentence that depends on it, so it states nothing false — but it also
says nothing, and a half-finished signup can sit on Settings reading "Your printed identity is not
stored yet" with no hint that the real problem is upstream. Materials is shipped reference data and
renders identically for everyone.

**Options.** *(a)* Mount `NoAccountNotice` at the top of Settings and Materials too. *(b)* Put it
in `AppShell`, once, above the routed content — one place, every screen, including the ones with
no products dependency at all. *(c)* Leave it: the screens that matter say it, and a maker who
cannot see any products will go to Studio or Products soon enough.

**Recommendation: (b) is the right shape and (c) is the right size for today.** A banner in the
shell is a global, always-on piece of chrome and it needs a decision about whether it is dismissable
and what it does on the billing pages, which is more product than the gap warrants.

**Where it bites.** `src/pages/Settings.tsx:126` (reads the store), `src/pages/Materials.tsx`
(does not), `src/components/AppShell.tsx` if (b).

### 14. Two Preferences controls look like settings and save nothing — DONE

**DONE** (commit `fix(14)`): option (a). Both `<Select>`s are `disabled`, each carries a hint
saying why in the identity tab's register ("Not stored yet. Nothing produces an export for this
to be the default of." / "Not stored yet. A product's market is chosen on its specification
screen, per product."), the card gained a line separating the half that is real (the stock
presets — `ArtefactDesigner` genuinely reads `STOCK`) from the half that is not, and
`TABS[3].description` lost "and what the export defaults to", which named a control the screen
does not have.

Pinned in a new `src/pages/preferences-tab.test.tsx` (5 tests), because both ways of getting
this wrong again are one-line changes that read as improvements: removing `disabled` reads as
tidying, and wiring these into `WorkspaceProvider` beside the category toggles reads as
finishing the job while being worse — the widget would remember and still change nothing. The
last test asserts the category checkboxes are still enabled, so the fix cannot be "applied" to
the half of the tab that works.


**The gap.** The Preferences tab's **Default export** and **Default market** are uncontrolled
`<Select defaultValue=...>` with no `onChange` and nowhere to write to. Changing either does
nothing and survives nothing, under a tab description that reads "Small, reversible choices.
Which categories are switched on, and what the export defaults to." The categories half is real —
`WorkspaceProvider` holds it — the export half is not. It is the same family as the identity tab's
inputs, which were disabled and labelled "Not editable yet" for exactly this reason.

**Options.** *(a)* Disable both and add the "not stored yet" line the identity tab already uses,
and trim the tab description to what is true. *(b)* Wire them into `WorkspaceProvider` alongside
the category toggles — they would then persist for the session, which is what the categories do,
but nothing consumes a default export format because there is no exporter (R6) and the market is
chosen per product on the specification screen. *(c)* Delete both fields.

**Recommendation: (a).** (b) makes them work in the sense that the widget remembers, which is
worse — it looks saved and still changes nothing. (c) is tidier and loses the signal that this is
coming. Not done here because it is customer-facing copy on a screen this stream was not sent to
rewrite.

**Where it bites.** `src/pages/Settings.tsx`, `PreferencesTab`, the "Stock presets and export
defaults" card; tab description at `TABS[3].description`.

### 15. ~~The full suite is red at the default 5 s test timeout~~ — **DONE (9f0483f)**

Fixed before the overnight batches began, by **(b) + (c)**, not by the recommended (a).

- `{ timeout: 15_000 }` on the one heavy test — "asks for the current password and sends all
  three to changePassword". It renders the whole settings tab with its providers, drives three
  password fields and then awaits a mock; alone it takes ~2 s, under the full suite's parallel
  jsdom environments it reached ~6 s against a 5 s budget.
- `userEvent.setup({ delay: null })` across all 15 tests in that file, removing the simulated
  human typing speed. That alone was **not** enough — it still landed at ~6 s under load — which
  is why the per-test budget is there too.

**Why not (a), the recommended global `testTimeout`.** Raising the global bar hides every other
slow test behind the same change, and the point of a timeout is to catch a hung one. The comment
9f0483f added to the test argues this explicitly. If you are reading this entry looking for the
one-line config fix, that is the fix this branch deliberately rejected.

The stated blocker — "the coverage stream is editing that file's `include` block in parallel" —
is also gone: Batch B finished with `vitest.config.ts`, and the fix never needed to touch it.

**A correction worth keeping.** Batch A recorded that this "did not reproduce" and was
"load-dependent". It did not reproduce because the fix was already in the tree when Batch A
started. Load-dependent was the right description of the symptom and the wrong conclusion about
the cause: 5113 ms against a 5000 ms budget is a test that fails half the time for ever, not a
busy machine.

