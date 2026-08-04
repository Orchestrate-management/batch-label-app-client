# Overnight report — `chore/production-grade`

Batches ran 00:15–01:52 on 4 Aug. Eleven entries done, two deliberately left with reasons
written in, one held for you, one missed. Nothing was reverted. Nothing was pushed.

---

## 1. Is the branch safe to look at

Yes. All four gates pass on a clean tree, re-run just now from the committed state.

| gate | result |
|---|---|
| `npm run typecheck` | clean |
| `npm run test:run` | **573 passed / 573**, 37 files, 61 s |
| `npm run test:coverage` | **exit 0** — every file on the floor list clears 70% on all four counters |
| `npm run lint` | **0 errors**, 23 warnings (all pre-existing categories) |
| `npm run build` | succeeds, 1748 modules, 37 s |

`npm run vercel-build` is `typecheck && test:run && vite build` — all three components pass, so
the deploy gate is green.

Coverage overall is 96.81% statements / 93% branches / 96.8% functions. The lowest single number
anywhere is `auth-redirect.ts` at 77.41% branches. Tree is clean, 15 code commits ahead of
`origin/main` (plus this report), no upstream configured, nothing pushed.

**One caveat about how I got that number.** My first coverage run failed — four tests in
`AccountTab.test.tsx` timed out. The cause was not the branch: a process left running by one of
the batches was still looping `rm -rf coverage && vitest run --coverage`, and the machine was at
load average ~200. It was also deleting `coverage/.tmp` out from under my runs. I killed it;
coverage has been green on every clean run since. Two things follow — those password tests are
the first thing in the suite to fail when the machine is busy, and a batch left a process running
overnight.

---

## 2. What is now true that was not last night

**A maker whose signup never finished is no longer told a lie with a useless button.**
Every screen used to say *"We could not read your products"* with **Try again**. Nothing had
failed, and waiting cannot finish a signup. The store now publishes `no-account` on first paint,
not just after a write — so the three-way copy that was already written and reviewed on Studio,
Products, Specification and the artefact designer actually renders, and names which of the three
causes is in play. Separately, Studio, Products and Materials stop offering a create the database
is certain to refuse. That rule is one predicate rather than logic copied onto four surfaces, and
it deliberately fails **open**: it names `suspended` and `no_membership` only, so a maker whose
entitlement read merely blipped keeps a button that would in fact have worked.

**A new device no longer arrives with an invented rating plate.**
`blankSpec` seeded `5 V / 2 A / 10 W`. A maker who created a wax warmer, never opened the ratings
fields and printed the plate got those numbers on a mains product — plausible enough to survive a
glance, invented by us, and a rating plate is a legal marking. It now seeds em dashes, which is
what a stored row with no ratings already read as.

**A crash no longer takes the navigation with it, and does not quietly imply the rest is fine.**
The boundary is mounted a second time inside the shell. The screen-scoped copy states outright
that the surviving sidebar is *not* us telling them the rest of Batchlabel is sound — because a
working sidebar says that silently otherwise, and we cannot establish it from a caught render
error. A chunk that never arrives is now a message in the content area instead of a full-app
crash screen, and at screen scope it adds the one clause that is a fact rather than a hedge: if
the cause is a deploy, every screen this tab has not already opened will fail the same way.

**Failures no boundary can see now reach the same seam.** `window.onerror` and
`unhandledrejection` are installed at boot, so a rejected promise or a throw in a click handler is
no longer invisible. This turned out to need more than two lines: React dispatches the error at
the window *before* `componentDidCatch` runs, and a dev build re-invokes the throwing component so
the values are not even the same object — one crash was measured producing three reports. It is
now one.

**The product-count sentences stop contradicting the screen they sit on.**
*"0 products · 3 things outstanding across 1 product"* was reachable for a maker's entire first
session. The first fix read zero as unknown, which made a genuine zero unsayable while leaving a
stale `3` as sayable as ever. There are now three states — no number, a number we know a write has
moved, and a current number — plus a rule that a count lower than the list already drawn is not
stated at all.

**Two Preferences controls stop pretending to be settings.** Default export and Default market
were uncontrolled selects with nowhere to write. Both are disabled and say why, and the tab
description no longer promises "what the export defaults to" — a control the screen does not have.

**A returning maker after a deploy fetches a third of what they did.** I verified this rather than
taking it on trust: I changed one customer-facing string, rebuilt, and compared fingerprints. All
eleven of our chunks re-fingerprint; `react`, `react-router`, `sonner` and `supabase` stay
byte-identical. So the critical path costs **49.8 kB gzip on a return visit instead of 165.9 kB**,
against 1.3 kB extra once on a cold visit.

One thing to know about that, because it is the standing rule in build-output form: Rollup's
"larger than 500 kB" warning **stopped firing**, since no single chunk exceeds 500 kB any more —
but not one byte left the critical path. The batch replaced the signal rather than pocketing it. A
plugin now prints the entry graph and warns at the same threshold, and it fires today:
`entry graph is 563.50 kB across 5 chunks (165.90 kB gzip)`.

**Coverage is a floor per file now, not an average across them** — same 70% bar. `billing.ts` went
from 66.66% functions to 100%; the two genuinely untested were `createRailTestSession` and
`leaveFor`, the line that actually navigates a customer to Stripe.

---

## 3. What still needs you, and what it costs

**Entry 6 — where error reports go.** Held exactly as instructed: no vendor, no dependency, no
endpoint, and `setErrorSink` still has no caller anywhere in the app. The money is the small half.
Sentry is free to ~5k errors/month then ~$26/month, and is a US processor — so it needs a line in
the www privacy notice and a look at the DPA. GlitchTip self-hosted costs a VM and monthly
patching attention instead of cash. Your own endpoint costs nothing new and gives you a log rather
than a tool: no grouping, no alerting, no source maps.

The half that is actually yours is the **payload**. An exception message can carry a product name,
a supplier name or a formulation percentage; a `componentStack` can carry a route with a product
id in it. Shipping `message` whole is the most useful for debugging and the most likely to
embarrass us. Until this is decided, the crash screen honestly tells makers *"This has not reached
us automatically"*, and last night's listeners file into a seam that ends on the customer's laptop.

**Entry 4 — the atomicity RPC.** Needs a migration; this branch owns no schema. The batch banked
the reading so the schema stream does not rediscover it: `SECURITY INVOKER`, not `DEFINER` —
definer bypasses RLS and forces the account check to live in a second place — and the function
body must preserve both errcode `P0001` and hint `sku_limit_reached`, because `classifyWriteError`
matches the hint and never the sentence. What it buys: a half-landed save currently leaves a new
recipe in an old pack, a combination the maker never approved, and it drives both the label and
the safety data sheet.

**One premise to confirm against the deployed database, not the migration file.** Entry 11 claimed
the browser holds no DELETE grant on `products`. Read against the schema branch's migration, it
does — §7 grants delete to `authenticated` with a matching policy. That makes "somebody builds an
archive path and forgets to move the count" a live concern rather than a hypothetical one.

**Entry 13 — left, per its own recommendation.** A shell-level no-account banner needs product
decisions (dismissable? what does it do on the billing pages?) that a refactor should not make.
Entry 10 widened the case for it: Materials now hides a control and still says nothing.

**Entry 15 — stale, and it is the one record failure of the night.** See below.

---

## 4. What was attempted and backed out

**Nothing was reverted.** No revert commits, no entry recording a backout. Eleven done, two left
with written reasons, one held, one half-done by instruction (entry 7, listeners only).

The interesting content is the three entries that turned out partly wrong when read against the
code, all of which were flagged rather than quietly worked around:

- **Entry 2 named the wrong function.** It said `createPortalSession` had no test; it was already
  covered. The genuinely untested pair was `createRailTestSession` and `leaveFor`.
- **Entry 12 was done against its own recommendation** — correctly. The entry itself calls its
  guard "a backstop, not a model" in the sentence above the recommendation, and following it would
  have meant a second patch. The shape was fixed instead and the reasoning recorded.
- **Entry 11's DELETE premise was wrong**, as above.

**And one thing was left undone without being recorded, which is the miss.** Entry 15 says the
suite is red at the default 5 s timeout. It is not, and has not been since 23:24 — commit
`9f0483f`, the last one before the batches started, fixed it narrowly with a per-test
`{ timeout: 15_000 }` on the one heavy test plus `userEvent.setup({ delay: null })` to drop 55
characters of simulated human typing. That is option **(b)**, not the recommended (a), and the
reasoning is written into the test file: raising the global timeout would hide every other slow
test behind the same change. Nobody marked the entry. So the TODO currently tells its next reader
the branch is red when it is green, and points at a recommendation that is arguably now the worse
of the two.

---

## 5. What I would do next

1. **Close entry 15 in the TODO** — five minutes. It is the only stale record in the file, and the
   file is the record. Note that the fix was (b), landed in `9f0483f`, and that (a) was rejected
   for a written reason.

2. **Fix one character in `src/lib/report-error.ts:101`, before you read the diff.** `signatureOf`
   builds its key as `` `${name}<NUL>${message}` `` with a **raw NUL byte in the source**. The
   separator is a good idea; writing it as a literal is not. Git classes the file as binary, so
   every diff of it reads `Bin 6504 -> 10656 bytes` — and `report-error.ts` is one of the files
   that changed most last night, which makes it currently the one file on this branch you cannot
   review. Writing it `\u0000` is identical at runtime and makes the file readable again.

3. **Then entry 6**, because it is now the binding constraint on everything else. Two boundaries,
   the window listeners, the de-duplication and a coverage floor over all of it are built and
   tested, and every one of them terminates in a console on a customer's laptop. That work stays
   worth nothing until there is a destination — and the crash screen keeps telling makers so, out
   loud, which is correct and is not a good look.

**Not entry 4 next.** It needs the schema branch, the reading is already banked, and it costs
nothing to wait until someone is in a migration anyway.
