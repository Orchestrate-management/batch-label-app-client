# Meta tracking in the product app

One Meta dataset, two surfaces. This document is the app's half. The marketing site's
half is `batch-label/docs/META_CAPI_SETUP.md` (setup and the server-side Conversions
API) and `batch-label/src/TRACKING.md` (how tags load there). The consent model both
obey is `batch-label/docs/CONSENT.md`, and it is the authority — nothing here overrides
it.

Pixel (dataset) id **`1374342861305621`**, the same on both surfaces, exposed as
`VITE_META_PIXEL_ID`. It is public by design: it ships inside the page and anyone can
read it out of the network tab.

---

## 1. The contract

| Event | Fires from | Consent basis |
| --- | --- | --- |
| `PageView` | **www only — never the app** | cookie banner |
| `ViewContent` (pricing) | www | cookie banner |
| `CompleteRegistration` | www (signup) | cookie banner |
| `InitiateCheckout` | **www and app** — wherever the upgrade is actually clicked | www: banner · app: `advertising_opt_in` |
| `Purchase` | server-side Conversions API only, from www's `/api` | `advertising_opt_in`, server-side |

`InitiateCheckout` firing from both origins is not a duplicate and there is no
cross-origin deduplication for it. They are two different actions by a person at two
different moments — pressing the plan CTA on the pricing page, and pressing an upgrade
control from inside the product — not one action reported twice. Each app event carries
`checkout_origin: 'app'` so the two can be separated in Events Manager whenever a total
needs splitting.

### What the app sends

Exactly one event, from exactly two controls:

| Control | Where | `checkout_surface` |
| --- | --- | --- |
| "See plans" / "Start a plan again" | `PlanNotice`, wherever a plan gates a feature | `plan-gate` |
| "Compare plans" | Settings → Billing | `billing-settings` |

Parameters: `content_type: 'product'`, `content_ids: ['maker']`,
`content_name: 'Maker plan'`, `checkout_origin: 'app'`, `checkout_surface`, and an
`eventID`. Deliberately **no `value` and no `currency`** — on www the plan CTA knows
which interval was pressed, so £14 or £140 is a fact; here the maker has chosen nothing
yet, and a made-up value would flow into Meta's ROAS reporting as though it were
revenue.

### What the app deliberately does not send

- **Any `PageView`.** Not on load, not per route, not on the consent transition. See §2.
- **`ViewContent`, `CompleteRegistration`, `Purchase`.** They belong to www: pricing and
  signup happen before the product, and payment success is only knowable server-side.
- **Advanced matching.** No email, hashed or otherwise, is passed to `fbq`. See §5.
- **An activation event.** Argued in §6.
- **Anything on the other three upgrade-adjacent links.** "Manage billing", "Update your
  card" and "Go to your account" all leave for www too, and none of them is a purchase
  starting. Fixing a bounced card is not a checkout, and counting it as one would
  inflate the exact number the ad account optimises against. Pinned by
  `src/components/PlanNotice.test.tsx` and `src/pages/Settings.billing.test.tsx`.

---

## 2. Why there is no PageView here

This is the authenticated product. Every screen a maker walks through is work they are
doing: their formulations, their suppliers, their batch records. Streaming that to an
advertising platform as a stream of page views is a real privacy cost, and Meta does not
need it — none of it is a conversion, and none of it can be optimised against.

So the app reports conversion-relevant actions only, and today that is one action.

This is enforced, not merely intended. There is no `metaPageView` in
`src/lib/meta-pixel.ts`, no route listener anywhere, and `fbq('set', 'autoConfig',
false, …)` is called before `init` so that fbevents.js does not log events nobody wrote
— its automatic event detection otherwise scrapes button text, form field values and
page microdata, which inside a product means a maker's supplier details. A test asserts
that the string `PageView` never reaches `fbq` across a grant, a send, a withdrawal and
a re-grant.

---

## 3. Why there is no cookie banner here, and what gates the tag instead

The app is always authenticated: `RequireAuth` wraps every route, including the 404, so
there is never an anonymous visitor here to ask. And `bl_consent`, the banner's browser
record, is **host-only on www.batchlabel.xyz** — this app cannot see it and must not be
given the chance to. A second advertising control is exactly the drift the consent model
was rebuilt to eliminate: two controls produce two records, and two records that
disagree prove we did not know.

So the gate is the account-level flag: **`brand_memberships.advertising_opt_in`**, read
under RLS with the maker's own session, in `src/lib/meta-consent.tsx`. It is the same
record the cookie banner keeps in step — the banner is the single place advertising
consent is asked, and www's `syncAdvertisingConsent()` writes the account flag through
the `set_consent` function whenever the answer changes.

**There is no write path in this app for advertising consent.** Not to
`brand_memberships`, not to `consent_events`, not through an endpoint of its own. The
maker changes their mind in www's cookie settings.

### Failing closed

The Pixel script is not fetched, `fbq` does not exist and no Meta cookie is written
until a read has come back saying `true`. Every other outcome loads nothing and sends
nothing:

| Situation | Result |
| --- | --- |
| Flag is `true` | Pixel loads. Nothing is sent until the maker clicks an upgrade control. |
| Flag is `false` | Nothing loads, nothing is sent. |
| Flag is `null`, or the column is not a real boolean | Treated as denied. Never answered is not yes. |
| No membership row yet (mid-signup) | Nothing loads. Silence is not consent. |
| Read failed — network, RLS, 500, renamed column | Nothing loads. A failed read is not consent. |
| Read still in flight | Nothing loads. The gate starts shut, so there is no window in which "not decided yet" could be read as permission. |
| Signed out | Gate closes immediately, without waiting for a read. |

It is never loaded optimistically and retracted. Loading `fbevents.js` and hoping a flag
holds it back is a different promise from the one the banner makes: the request itself
reaches Meta with the maker's IP and the URL they are on, before any flag is consulted.

Being wrong in this direction under-reports conversions, which is the correct direction
to be wrong in. An unreported upgrade click costs us attribution; an unconsented send
costs somebody their privacy.

### Withdrawal

Consent is withdrawn on www — a different origin, usually a different tab — and nothing
pushes that to the app. So the flag is re-read whenever the app is brought back to the
front (`focus` and `visibilitychange`, with a 30 second floor so alt-tabbing does not
mean a query per flick). That is the sequence that has to work: change the cookie
setting on www, come back to the product.

When the answer changes to no, four things happen, because one is not enough:

1. Our own gate closes, so nothing in `meta-pixel.ts` emits again. Absolute, and not
   dependent on Meta honouring anything.
2. `fbq('consent', 'revoke')` — Meta's own switch, which stops the parts of the Pixel we
   do not drive.
3. The script element is removed from the document.
4. `_fbp` and `_fbc` are deleted, on the host and on every parent domain down to two
   labels, because they are advertising identifiers written under a permission that has
   just been taken away and leaving them would let a later grant silently resume the
   same identity.

What cannot be done, stated rather than implied: JavaScript that has already executed
cannot be un-executed. The library stays in memory until the next navigation. That is
exactly why the primary gate is "never load without consent" rather than "load and
revoke".

Note also that there is **no in-app control that changes this flag**, and PR #3
(`feat/account-settings`) keeps it that way: Settings → Account shows advertising as
read-only state with a link to www's cookie settings. Withdrawal is a www action that
this app obeys.

---

## 4. Where the module lives

Two files, so that "what decides" and "what sends" are separable and each is short
enough to read in one sitting.

| File | Responsibility |
| --- | --- |
| `src/lib/meta-consent.tsx` | **Decides.** Reads `advertising_opt_in`, drives the gate, re-reads on refocus. `MetaTrackingProvider` is mounted once, inside `RequireAuth`. |
| `src/lib/meta-pixel.ts` | **Sends.** Loads the Pixel, holds the gate as module state, exports one named function per event. The send path is private; there is no way for a component to invent an event name. |

`meta-pixel.ts` is written to read like `batch-label/src/lib/meta-pixel.ts` — same fbq
bootstrap, same script attribute, same cookie clearing — so the two can be diffed. The
three differences (no PageView, autoConfig off, no advanced matching) are documented at
the top of the file and every one of them narrows what is sent.

The deduplication contract in `batch-label/src/lib/meta-events.ts` is deliberately **not**
copied into this repo. That file is isomorphic because www has a browser half and a
server half that must agree on an `event_id`; this app has one half and raises one event
with no server counterpart, so a derived id would deduplicate against nothing and a
second copy would only be something to drift.

---

## 5. `_fbp` / `_fbc`: no plumbing needed, and none was built

The server-side `Purchase` on www attaches `_fbp` and `_fbc` from the browser that
started the checkout, to improve match quality. The question was whether this app should
contribute them across origins.

**It should not, and it does not need to.** fbevents.js writes `_fbp` and `_fbc` against
the *registrable* domain — `.batchlabel.xyz` — not the host. So a browser that has been
to www already carries the same `_fbp` on `app.batchlabel.xyz`, and a Pixel loaded here
writes to the same cookie rather than a private copy. The identity is shared by cookie
scope, with no scheme, no message passing and no query parameter.

Two consequences worth stating:

- The app's `InitiateCheckout` already lands on the same browser identity as www's
  events without this app sending anything extra. That is why there is no advanced
  matching here: there is no match-quality gap for a hashed email to close.
- If the app ever gains its own checkout — `POST /api/create-checkout-session` already
  CORS-allows `app.batchlabel.xyz` and returns to whichever origin started it — the
  cookies are simply readable from `document.cookie` at that point, exactly as
  `batch-label/src/lib/billing.ts` reads them today. That is a few lines when it is
  needed, not a cross-origin scheme to build in advance.

Note that withdrawal in this app therefore clears a cookie www also relies on. That is
correct: it is one consent, one identifier, and one withdrawal.

---

## 6. Recommendation: no activation event

The candidate was "a maker exports their first artefact". The recommendation is **not to
send it**, for four reasons in descending order of weight.

1. **It is not real yet.** The export buttons in `ArtefactDesigner` fire a
   `toast('Artefact exported')`. Nothing is produced. An advertising event for a stubbed
   action is a fabricated conversion, and it would go on being fabricated for as long as
   the stub lives.
2. **The optimisation value is close to zero at this volume.** Meta needs roughly 50
   conversions per week on the optimised event before it leaves the learning phase. A
   product with one paid tier and an early customer base will not feed a custom
   activation event at that rate, and an event that never leaves learning changes no
   bids. The event that *is* worth optimising against — `Purchase` — already exists,
   server-side and deduplicated.
3. **The timing does not attribute.** Exporting a finished artefact happens days or
   weeks after signup, routinely outside Meta's 7-day click window. The event would
   arrive unattributed, which is to say it would tell Meta nothing about which ad worked.
4. **It costs exactly what the no-PageView decision refuses to spend.** It reports what a
   paying customer does *inside* the product. That is the same privacy cost as a
   PageView, for a smaller measurement return, and taking it would make decision §2 look
   like a preference rather than a principle.

If activation is ever wanted, the honest place for it is a product analytics tool the
maker's data is not shared out of, not the ad platform.

---

## 7. Environment and founder actions

| Variable | Required | Default | Notes |
| --- | --- | --- | --- |
| `VITE_META_PIXEL_ID` | no | unset | `1374342861305621`. Public by design. **Unset means no Pixel is loaded and nothing is sent, whatever any consent flag says.** |
| `VITE_META_PIXEL_DEBUG` | no | unset | Only `"true"` counts. Loads the Pixel on localhost so events can be checked in Meta's Test Events tool. **Never set this in Vercel.** |

There is no Conversions API access token in this repo and there must never be one. It is
server-only, it lives on the marketing project, and it must never carry a `VITE_` prefix
— a `VITE_` variable is inlined into the browser bundle at build time.

### What the founder must do

`VITE_META_PIXEL_ID` is **not yet set on the `batch-label-client` Vercel project**. Until
it is, this code is inert in production: no Pixel, no events, no change of behaviour.

```bash
# From this repo, linked to the app's Vercel project.
vercel link --project batch-label-client

# Add the id to Production and Preview. Each command prompts for the value:
#   1374342861305621
vercel env add VITE_META_PIXEL_ID production
vercel env add VITE_META_PIXEL_ID preview

# Non-interactively, if you prefer:
printf '1374342861305621' | vercel env add VITE_META_PIXEL_ID production
printf '1374342861305621' | vercel env add VITE_META_PIXEL_ID preview

# Confirm:
vercel env ls
```

Then **redeploy**. Vite inlines `import.meta.env` at build time, so an environment
variable added after a build does not reach the bundle already in production.

Do **not** add `VITE_META_PIXEL_DEBUG` to any Vercel environment. Its only purpose is to
let the Pixel run on `localhost`; in a deployed environment it does nothing useful and
would only remove a safety rail.

Checklist:

- [ ] `VITE_META_PIXEL_ID=1374342861305621` on `batch-label-client`, Production and Preview
- [ ] Redeploy so the value reaches the bundle
- [ ] The same id is set on the marketing project (`batch-label`), or the two surfaces
      report into different datasets
- [ ] `VITE_META_PIXEL_DEBUG` is set nowhere in Vercel
- [ ] Confirm the app's `InitiateCheckout` in Meta Events Manager → Test Events, and that
      it is attributed to the same dataset as www's events (see §8)

---

## 8. How this was verified

Run locally against real Supabase, with a synthetic session written through the real
`sharedCookieStorage` adapter. **No account was created against production Supabase.**

| Check | Result |
| --- | --- |
| Dataset is real | `connect.facebook.net/signals/config/1374342861305621` returns a 285 KB live configuration with 43 references to the id; a made-up id returns a 30 KB "empty plugin" stub. |
| Fail closed on a failed read | The synthetic JWT is rejected by real Supabase (`401 PGRST301`, "JWT cryptographic operation failed"). `fbq` undefined, no script in the DOM, no `_fbp`/`_fbc`, nothing sent. |
| Gate opens only on `true` | With the flag read as `true`, the script is injected and `fbq` becomes a function. |
| No PageView | With the Pixel loaded and consent granted: zero requests on load, and zero across five route changes through the product. The only request in the whole session was the one raised by a click. |
| `InitiateCheckout`, plan gate | `GET https://www.facebook.com/tr/?id=1374342861305621&ev=InitiateCheckout&…&cd[checkout_origin]=app&cd[checkout_surface]=plan-gate&…&eid=<uuid>` — no `cd[value]`, no `cd[currency]`, no `ud[…]`. |
| `InitiateCheckout`, billing settings | The same, with `cd[checkout_surface]=billing-settings`. |
| The links that must stay silent | "Manage billing" produced no request. |
| autoConfig off | Clicking non-instrumented buttons produced no automatic events. |
| Withdrawal | Flag flipped to `false` and the tab refocused: script removed, `_fbp` deleted, and pressing the same upgrade control again produced **no** further request. |

**Not verified: Meta Events Manager → Test Events.** There is no signed-in Meta session
in this environment and entering credentials is not something this agent does, so the
events could not be watched arriving in the Events Manager UI. What is proven is that
the browser issues a well-formed `InitiateCheckout` to `facebook.com/tr` addressed to a
dataset Meta confirms exists. The last step — seeing it land, and seeing it beside www's
events in the same dataset — is on the founder's checklist above.
