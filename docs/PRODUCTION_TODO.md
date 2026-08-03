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

### 2. Coverage thresholds are pooled, not per file

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

### 3. A new device starts with plausible-looking electrical ratings

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

### 4. Neither two-statement write is atomic, and both can half-land

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

### 5. There is one error boundary and it is at the very top, so any crash replaces the whole app

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

### 6. Error reports go to the customer's own console and nowhere else

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

**Small follow-up.** `src/lib/report-error.ts` and `src/lib/lazy-screen.ts` are not on the coverage
`include` list in `vitest.config.ts` (both have tests; the list is curated). Whoever next opens
that list — entry 2 above — should add them or decide they do not meet the bar stated there.

### 7. Only render errors are caught; a failed promise in a handler is still invisible

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

### 8. The entry chunk is still 570 kB, and 212 kB of it is the Supabase client

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

### 11. A create now re-reads the SKU count. Nothing else that moves it exists yet

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

### 12. Zero is now read as "unknown" in two sentences, which is a patch over entry 11's shape

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

### 13. Settings and Materials never mention that the workspace has no account

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

### 14. Two Preferences controls look like settings and save nothing

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

### 15. The full suite is red at the default 5 s test timeout, on a test nobody changed

**The gap.** `npm run test:run` now fails one test — `AccountTab.test.tsx` › "asks for the current
password and sends all three to changePassword". It is not a logic failure: it passes in isolation
(1.8 s of that is `userEvent` typing three password fields character by character) and the whole
suite passes at `--testTimeout=20000` (494/494). It began failing as the suite grew past ~450 tests
across three streams; vitest runs files in parallel, and the wall clock on a slow test is shared
with everything else in flight.

**Options.** *(a)* `testTimeout: 15000` in `vitest.config.ts`. One line, fixes it now, and raises
the bar at which a genuinely hung test is caught. *(b)* A per-test timeout on that one test —
narrower, and leaves the next slow test to rediscover this. *(c)* Make the test itself fast:
`user.type` is the cost, and `fireEvent.change` on each field would cut it to milliseconds at the
price of not exercising real keystrokes on a password form. *(d)* Leave it red.

**Recommendation: (a), by whoever is next in `vitest.config.ts`.** Left undone here only because
the coverage stream is editing that file's `include` block in parallel and a concurrent one-line
edit to the same file buys a merge conflict for no urgency. Nothing is wrong with the code under
test.

**Where it bites.** `vitest.config.ts` (`test` block, no `testTimeout` set today);
`src/components/settings/AccountTab.test.tsx`.
