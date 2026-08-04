import { APP_COMPONENT_NAMES } from './app-component-names';
import type { ErrorReport } from './report-error';

/**
 * What may leave a maker's machine when this app files an error report.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE RULE IS AN ALLOW-LIST, AND THE REASON IS THE FAILURE MODE OF THE OTHER ONE
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * There are two ways to write this file.
 *
 *   A DENY-LIST says "send the report, but strip the things that look like
 *   customer data" — a regex for percentages, one for uuids, one for anything
 *   that looks like a supplier name. It is easier to write, it keeps far more
 *   debugging detail, and its default answer for anything nobody thought of is
 *   SEND. It is safe exactly until the day somebody adds a field to
 *   `ErrorReport`, throws a new kind of error, or upgrades the SDK — and on that
 *   day it fails silently and in the wrong direction. Nothing goes red. A
 *   formulation percentage just quietly appears in a third party's web UI.
 *
 *   AN ALLOW-LIST says "send nothing except these named things, in these
 *   shapes". Its default answer for anything nobody thought of is DROP. It is
 *   more work, it throws away detail a deny-list would have kept, and when it
 *   goes stale the cost is a redacted line in an issue nobody can read — a
 *   developer is inconvenienced, a customer is not exposed.
 *
 * THIS FILE IS AN ALLOW-LIST. Batchlabel turns a supplier's Safety Data Sheet
 * into a compliant CLP label, so the data it holds IS the customer's commercial
 * secret: fragrance supplier names, formulation percentages, batch identifiers,
 * product names not yet launched. They pay us precisely to handle that
 * carefully. A reporting integration that leaks it is not a bug in a tool, it is
 * the company breaking the promise it sells. So the default has to be drop, and
 * every single thing that leaves has to be named below and defended in a
 * comment.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE RULE INSIDE THE RULE: ASK WHO WROTE THE STRING, NOT WHAT IT LOOKS LIKE
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * "Allow-list" is not enough said on its own, because a regex is an allow-list
 * too and THREE FIELDS IN A ROW have now leaked through one. `frames[].function`
 * was deleted after a batch code was shown arriving in it. `extra.component_trail`
 * then did the same thing, by the same mechanism, in the field next door — and
 * that one was not a demonstration, a real batch code went out on the real
 * Sentry wire before anybody noticed. Then `frames[].filename` — the field this
 * header used to name as "the one place this file still owes an answer" — put an
 * unlaunched product name into a real serialised envelope by FOUR separate
 * routes, one of which was the route the round before had claimed to close.
 * Deleting or patching a third field is not a rule either. So:
 *
 * FOR EVERY FIELD THAT LEAVES, ASK WHO WROTE THE STRING.
 *
 *   WE DID, FROM AN ALPHABET WE FIXED — `reference` (report-error.ts's own
 *   alphabet, minus the characters that misread down a phone) and `at` (a
 *   clock). Here a shape check IS a list, and the test for that is exact: THE
 *   PATTERN ENUMERATES THE ENTIRE SPACE OF VALUES THE FIELD CAN HOLD, and no
 *   input can add to it. `reference` is 30^8 strings from our own alphabet and
 *   `at` is a clock, so both qualify.
 *
 *   SO DO SOME CAPTURES INSIDE `RECOGNISED`, WHICH THIS HEADER USED TO DENY. It
 *   said `reference` and `at` were "the ONLY fields in this file entitled to a
 *   bare shape check" while seven renderers below echo a capture verbatim. They
 *   are two kinds, and both meet the rule as stated — the header was wrong, not
 *   the code:
 *
 *     FOUR ARE ALTERNATIONS OF LITERALS, which is a list written as a pattern
 *     and not a shape at all: `(undefined|null)` in three entries, and
 *     `(completed with undelivered notifications\.|limit exceeded)` in the
 *     ResizeObserver one. Two values each. Nothing else can match.
 *
 *     THREE ARE BOUNDED SPACES THE PATTERN ITSELF FIXES: `plan catalogue request
 *     failed (\d{3})` (1,000 values), `Minified React error #(\d{1,4})` (11,110)
 *     and `Unexpected token '(.)'` (one character). What they cost is written
 *     down rather than waved at: at most log2(11,110) ≈ 13.4 bits of
 *     attacker-chosen text per report, and only for a message that already
 *     matched one of our templates whole.
 *
 *   Every OTHER capture in that table is replaced by `REDACTED` or held to a
 *   list — `SCREEN_NAMES` and `PROVIDER_HOOK_MESSAGES`. Read the table with that
 *   in mind: a `render` that interpolates `m[n]` is making one of the two claims
 *   above and has to be able to say which.
 *
 *   THE RUNTIME DID — and then ask what the runtime READ in order to write it.
 *   V8 and React both name things after values: a computed object key becomes a
 *   function's `name`, that `name` becomes React's component label, `error.name`
 *   is a plain writable property, and a message is assembled at a throw site out
 *   of whatever was in scope. Every one of those is a channel from a customer's
 *   product to a string that looks exactly like one of our identifiers, and
 *   nothing can tell `BL240417A` from `deriveHazards`. These fields get a LIST
 *   of strings that occur in our own source, or they do not go.
 *
 * THE TEST FOR THE NEXT FIELD, and it takes a minute: can you write a line of
 * ORDINARY application code — not a contrived one — that puts a value read off a
 * product into it? For `function` it was `{ [batch.code]: fn }`. For
 * `component_trail` it was that line with JSX around it. If you can, the field
 * is list-checked or it does not go, and "it is always an identifier from our
 * own code today" is not an answer — that is a property of the call sites, and
 * the check is what runs.
 *
 * THE MINUTE, ACTUALLY SPENT ON `filename`, WHICH IS WHAT THE LAST THREE ROUNDS
 * DID NOT DO. The rule was written down and then `filename` was exempted from it
 * without being tested against it. Run: `throw new Error('\n' + text)` where
 * `text` is anything a maker typed and one line of it reads `at f (/assets/X.js:1:2)`.
 * V8 writes the stack as `${name}: ${message}` followed by frames, so every line
 * of a multi-line message is INSIDE the stack, and a line that parses as a frame
 * has its path read. That is one line of ordinary code. The answer is therefore
 * the same as for the other two: `filename` is list-checked or it does not go.
 * See LOADED SCRIPTS below for the list it is held to and what that costs.
 *
 * WHERE EACH FIELD STANDS TODAY. List-checked: `source`, `name`, `message` (and
 * inside it the screen name and the provider-hook sentence), `route`, every
 * component name, and `frames[].filename`. Shape-checked, because for these the
 * pattern IS the list: `reference`, `at`, and the three bounded captures named
 * above. Carried only alongside a field that passed its own list check:
 * `frames[].lineno` and `frames[].colno`, which travel with the path or not at
 * all — see scrubStack.
 *
 * That last clause is the fourth field, and it was found after the sentence that
 * used to close this paragraph — "nothing in this file is now on a bare shape
 * check over a string a runtime wrote" — was already written and already false.
 * `lineno` and `colno` were on a bare 0..10,000,000 bound, read off the same
 * line as the path, and nobody had counted them because they are numbers. The
 * paragraph is now an inventory of four dispositions rather than a claim of
 * completeness, because a claim of completeness is what went wrong four times.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * AND THE THING THAT IS SUPPOSED TO FIND THE FOURTH FIELD
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Three rounds have each found the next leaking field by hand, after it shipped.
 * The rule above is what a reader applies; these two are what CI applies, and
 * they are the actual deliverable of this round:
 *
 *   scrub-report.canary.test.ts   TWO secrets — one text, one numeric — pushed
 *                                 down every channel an ordinary line of app
 *                                 code has into a report: message, name, source,
 *                                 reference, route, stack header, multi-line
 *                                 message, adopted stack, nested cause,
 *                                 component name, thrown object, and the three
 *                                 routes where the header cut cannot fire — all
 *                                 asserted absent from the WHOLE serialised
 *                                 envelope. The numeric one exists because the
 *                                 text one is a substring search, which made the
 *                                 harness blind to exactly the field that leaked
 *                                 next, and to the fact that a formulation
 *                                 percentage is a number.
 *   error-sink.test.ts, "the wire key set"   Every key path that reaches the
 *                                 wire, pinned. A field ADDED anywhere — by us,
 *                                 by a scope, by an SDK upgrade — fails it, and
 *                                 the failure message says the privacy notice in
 *                                 the www repo has to change too.
 *
 * Neither is a substitute for the rule. Both fail loudly on the two things the
 * last three rounds only noticed afterwards: a new field, and an old field that
 * started carrying something new.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT LEAVES, AND WHY EACH ONE IS SAFE
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *   reference   Eight characters generated for this one report by
 *               `newReference()`. It identifies nothing and is meaningless
 *               anywhere else; it exists so a support email and a log line can
 *               be joined up by a human. Shape-checked anyway.
 *   source      The call site name — 'render', 'window-error'. Matched against a
 *               LIST of the four sources that exist, not against a slug shape:
 *               `reportError(error, `product-${id}`)` is slug-shaped, and the
 *               field is documented as free text from the call site.
 *   name        The error's constructor name: 'TypeError', 'ScreenNotLoaded'.
 *               Also a list, for the same reason — `error.name` is writable, so
 *               `error.name = product.name` passes any identifier shape.
 *   message     THE DANGEROUS ONE. See scrubMessage below.
 *   at          The ISO timestamp, shape-checked.
 *   route       NOT the URL — the matched ROUTE PATTERN, e.g. '/products/:productId'.
 *               See scrubRoute: a product id in a path segment identifies a
 *               customer's product, and a query string can hold anything at all.
 *   frames      Script path, line and column — reconstructed from the stack
 *               rather than passed through, deliberately WITHOUT the function
 *               name, and with the path held to the LIST of scripts this page
 *               actually fetched. See scrubStack and LOADED SCRIPTS.
 *   components  React component names from the componentStack, each held to the
 *               list in lib/app-component-names.ts. Anything else is
 *               `[redacted]`, so the trail keeps its depth and loses a label.
 *               A shape check here put a real batch code on the wire — see
 *               scrubComponentStack.
 *
 * And what leaves is ONLY that. `scrubReport` names each field explicitly rather
 * than spreading the report, so a field added to `ErrorReport` next month does
 * not leave on its own — it leaves when somebody adds it here, on purpose, with
 * a reason. There is a test that holds that property.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE ONE FINGERPRINT THAT LEAVES, AND WHAT IT IS AND IS NOT
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * EVERY NUMBER IN THIS SECTION WAS RE-MEASURED THIS ROUND rather than read, and
 * one of them was arithmetically impossible when it was checked. The catalogue
 * they are measured on is one generator with one parameter, so any of them can
 * be reproduced: 60 first words × 52 second words × N × 4 sizes, rendered
 * `${first} ${second} No. ${n} Candle ${size}`, which is the shape a real maker
 * uses. The lists are in scrub-report.test.ts; N = 10 gives 124,800 names (what
 * the suite runs, because it costs a second rather than half a minute), N = 15
 * gives 187,200, N = 25 gives 312,000 and N = 32 gives 399,360.
 *
 * Removed text is replaced by `[redacted]` AND NOTHING ELSE. It used to carry a
 * per-value tag — `[redacted:d311c481]`, a 32-bit FNV-1a of the removed text —
 * and the comment here used to say that tag was "useless as a way to recover the
 * text it stands for". That was false, and it was disproved by running this
 * file's own exported `digest`:
 *
 *   - the formulation percentage `12.43` was recovered UNIQUELY from all 10,001
 *     candidates between 0.00 and 100.00;
 *   - the supplier `Aromatica Fragrances Europe Ltd` hashes to `09ce5a4a`, and
 *     one supplier out of a bounded list of 4,096 (`Supplier <i> Fragrances
 *     Europe Ltd`, which is the list the suite uses) comes back UNIQUELY — under
 *     16 bits, and therefore under 32, since the fold is a function of the wider
 *     hash;
 *   - across the 312,000-name catalogue, 311,976 names — 99.992% — were
 *     recovered UNIQUELY from their tag. (Re-measured: this line used to say
 *     311,984 and 99.995%. At 124,800 it is 124,792 and at 399,360 it is
 *     399,334, both 99.994%; the share does not move with the catalogue because
 *     32 bits is 4.3 billion buckets.)
 *
 * The same attack is in scrub-report.test.ts, run over 124,800 names, and it is
 * run against the OLD function and the new one side by side so the numbers below
 * stay checkable.
 *
 * A 32-bit hash only collides freely when the candidate space approaches 2^32. A
 * maker's catalogue is a few hundred names, and the template around the tag is
 * not secret: for a runtime fault it is V8's own fixed wording, for one of ours a
 * string literal in the shipped bundle. So the tag was a dictionary attack with
 * the dictionary supplied.
 *
 * The per-value tags are gone, and they cost nothing to lose: `eventFor` groups
 * on `[name, messageDigest]`, so Sentry never reads the exception value for
 * grouping here and the inner tags contributed NOTHING to triage. They were one
 * guessing oracle per redacted value in exchange for nothing.
 *
 * ONE FINGERPRINT REMAINS, `messageDigest`, and TWO things were done to it.
 *
 * FIRST, IT IS NO LONGER TAKEN OVER THE CUSTOMER'S TEXT WHEN THERE IS ANYTHING
 * ELSE TO TAKE IT OVER. A recognised message is a template we shipped with the
 * customer's value removed, so the digest is taken over the text we SEND — the
 * template — and the removed value never enters a fingerprint at all. Width does
 * not fix that case and narrowing alone would not have: a formulation percentage
 * lives in a space of 10,001 candidates, and 16 bits over the whole message
 * still names it uniquely (re-measured: 1 survivor). Digesting the template
 * instead means all 10,001 produce the SAME tag, which is no information at all.
 * Same for the catalogue: every name now yields one identical tag.
 *
 * SECOND, IT IS SIXTEEN BITS, which is what protects the case where there IS
 * nothing else — an unrecognised message, where the original text is the only
 * thing separating two unknown faults, so the digest has to be taken over it.
 * Re-measured on the 312,000-name catalogue put into free-text messages: 32 bits
 * named one candidate per tag (99.992% of the catalogue uniquely), 16 bits
 * leaves 5.76 candidates on average and 0.84% uniquely. And 16 bits is still
 * 65,536 issue buckets — at ~200 distinct unknown messages, 0.30 expected
 * collided pairs over the life of the project, which is far more separation than
 * an unknown-fault stream needs.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT IS TRUE ABOUT IT, IN TWO PARTS: THE STRONG ONE AND THE RESIDUAL
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * RECOGNISED MESSAGES ARE FULLY DEFEATED, and that is the strong result, so it
 * goes first. For a message this file recognises, NOTHING that varies with the
 * removed value reaches the wire in any field — not the exception value, not the
 * type, not `fingerprint`, not `extra.message_digest`, not a tag, not a frame.
 * Re-measured by running the shipped chain — `eventFor(scrubReport(…))`, the
 * actual bytes, every field, mark excluded because it is random per page load —
 * over the 399,360-name catalogue, over all 10,001 percentages from 0.00 to
 * 100.00, and over 65,536 supplier names: ONE distinct wire signature each, in
 * every case. The 32-bit per-value tag this replaced recovered 99.994% of that
 * same catalogue uniquely.
 *
 * UNRECOGNISED FREE TEXT CARRIES A 16-BIT FINGERPRINT OF THE ORIGINAL, AND
 * AGAINST A BOUNDED CANDIDATE LIST A GUESSER ALREADY HOLDS, THAT IS NOT
 * ANONYMITY. This comment used to close by saying a match "would still leave
 * several thousand other messages that produce it". That is true of the space of
 * all strings and false of the space anybody actually enumerates — which is the
 * same bounded catalogue this header calls realistic above. On the
 * shipped function, with the message `Failed to derive hazards for <x>`:
 *
 *   - the percentage 12.43 comes back UNIQUELY from all 10,001 candidates
 *     between 0.00 and 100.00;
 *   - one supplier comes back UNIQUELY from a bounded list of 4,096;
 *   - it takes a big catalogue before 16 bits leaves more than a handful: over
 *     124,800 names the mean survivor count is 2.91, and over 399,360 it is
 *     7.10. (THIS LINE USED TO SAY 4 AT 400,000, WHICH IS NOT A POSSIBLE
 *     NUMBER. Mean survivors under a B-bucket digest is ~N/B + 1, so at
 *     N = 400,000 and B = 65,536 it cannot be below 400,000/65,536 = 6.10 —
 *     and the 2.91 sitting next to it, which is 124,800/65,536 + 1, was
 *     produced by the arithmetic the 4 contradicted. Re-measured: 7.0958.)
 *
 * 16 bits is still a real improvement on 32: it is the difference between "any
 * catalogue at all" and "a catalogue smaller than 65,536". It is not anonymity
 * for a small space, and the defence for an unrecognised message is NOT the
 * width — it is adding the message to RECOGNISED. `tags.message_recognised` is
 * on every event for exactly that reason: it is the count that says this
 * residual is growing.
 *
 * AND TWO ORACLES COMPOSE, WHICH NOTHING HERE USED TO CONSIDER. Two DIFFERENT
 * unrecognised messages carrying the SAME secret are two independent 16-bit
 * fingerprints of it, and intersecting their candidate sets is 32 bits.
 * Measured over the whole catalogue rather than over one lucky secret: of the
 * 399,360 names, the first oracle leaves 7.0958 on average; of the 64,490 tags
 * still ambiguous after it, the second resolves all but 25. On the 124,800-name
 * catalogue the suite runs, it resolves every one of the 37,124.
 *
 * THE 25 USED TO SAY 7, AND THE REASON IT COULD IS WORTH MORE THAN THE
 * CORRECTION. The figure depends entirely on WHICH second message you pick, and
 * no version of this comment ever named one. Measured with a different second
 * message it is 23, and 4 rather than 0 at 124,800 — so three different numbers
 * were all defensible and none was reproducible. The two messages are now fixed
 * in the test that pins this ("two oracles, counted over the whole catalogue"),
 * and they are the same two the composition test above it uses.
 *
 * The definition matters as much as the messages. "Resolved" means: within one
 * first-oracle tag, no two names share a second-oracle tag. Count TAGS, not
 * names — 25 tags is 50 names. And the second message must be genuinely
 * UNRECOGNISED, because a recognised one digests the text we SEND and carries
 * nothing about the secret at all.
 *
 * It is NOT defended against, deliberately, and the reasoning is worth more than
 * the shrug:
 *
 *   - salting the digest per report is the obvious fix and it destroys the only
 *     thing the digest is for. `eventFor` groups on it, so a per-report salt
 *     makes every occurrence of one unknown fault its own issue, which is the
 *     failure this field exists to prevent;
 *   - narrowing further does not close it, it only changes the arithmetic — two
 *     8-bit oracles compose to 16 just as readily;
 *   - it is inherent to ANY deterministic grouping key taken over the original
 *     text, and an unknown-fault stream cannot be triaged without one.
 *
 * So the honest shape of the residual is: a guesser who holds a bounded
 * candidate list AND can attribute two distinct unrecognised messages from one
 * account to one secret can recover that secret. What shrinks it is the same
 * lever as above — fewer unrecognised messages.
 *
 * NEARLY PURE, AND IN ITS OWN FILE, ON PURPOSE. Everything below is a function
 * of its arguments — no `window`, no clock, no Sentry — because the one thing
 * this repo cannot afford is for "what leaves the machine" to be an emergent
 * property of an integration nobody can run in a test. The sink imports this;
 * this imports one type and one constant list of names
 * (lib/app-component-names.ts, which imports nothing at all and is data), and
 * that list is the reason `component_trail` is list-checked rather than
 * shape-checked.
 */

/**
 * A stack frame, reduced to the three things that are ours rather than a customer's.
 *
 * THERE IS NO `function`, AND ITS ABSENCE IS THE FIX FOR A REAL LEAK. See
 * scrubStack.
 */
export interface ScrubbedFrame {
  /** A path this page actually fetched a script from, or a placeholder. Never an origin. */
  filename: string;
  /**
   * A position INSIDE a path that survived the list check, or absent.
   *
   * The pairing is the point and it is enforced in scrubStack: a position on a
   * `[redacted]` path is not a position, it is two numbers read off a string
   * somebody else wrote. See the note there.
   */
  lineno?: number;
  colno?: number;
}

/** Exactly what may leave the machine. Nothing outside this interface is sent. */
export interface ScrubbedReport {
  reference: string;
  source: string;
  name: string;
  message: string;
  /** False when the message was not recognised and so was replaced wholesale. */
  messageRecognised: boolean;
  /**
   * The grouping fingerprint — of the text we SEND when we recognised the
   * message, and of the original only when we did not. See `scrubReport`.
   */
  messageDigest: string;
  at: string;
  route: string;
  /** Newest frame first, as the stack was written. The sink reverses for Sentry. */
  frames: ScrubbedFrame[];
  components: string[];
}

const REDACTED = '[redacted]';

/** Bounds on what one report may carry, so a pathological stack cannot become the payload. */
const MAX_FRAMES = 30;
const MAX_COMPONENTS = 30;
const MAX_MESSAGE = 200;

/**
 * FNV-1a, folded to sixteen bits. See the header for what this is and is not.
 *
 * THE WIDTH IS THE WHOLE POINT AND IT IS NOT A ROUND NUMBER BY ACCIDENT. Thirty-
 * two bits made this function a lookup table for anything a guesser could
 * enumerate — re-measured, 99.992% of a 312,000-name catalogue came back
 * uniquely. Sixteen leaves 5.76 candidates on that same space while keeping
 * 65,536 issue buckets, which is more separation than a stream of unknown faults
 * has ever needed. It is a DELIBERATE loss of precision; do not widen it back to
 * make grouping tidier without measuring what it hands out.
 *
 * Folded rather than truncated (`(h >>> 16) ^ (h & 0xffff)`) because that is
 * FNV's own prescription for a shorter tag: every input bit still reaches the
 * output, so the collisions are spread rather than concentrated on the low half.
 *
 * Written out rather than reached for, because the alternatives are a dependency
 * (for eight lines) or SubtleCrypto (which is async, and this runs inside a crash
 * handler where an await is a way to lose the report).
 */
export function digest(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  const folded = ((hash >>> 16) ^ hash) & 0xffff;
  return folded.toString(16).padStart(4, '0');
}

/**
 * Keep a value only if it has the shape we expect, and otherwise say so.
 *
 * The shape check is the allow-list applied to a single field: it is not looking
 * for anything bad, it is refusing anything it cannot positively recognise.
 */
function shaped(value: string | undefined, pattern: RegExp, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  return pattern.test(value) ? value : fallback;
}

/* ────────────────────────────────────────────────────────────── the message */

/**
 * The screens `lazyScreen` names in App.tsx, which is the only place the name in
 * a `ScreenNotLoaded` message can come from — every one is a string literal at a
 * call site, never a value read from a product.
 *
 * A LIST RATHER THAN A CHARACTER CLASS, and it will go stale: add a screen and
 * forget this and its message is redacted rather than sent. That is the correct
 * direction to fail, and it is the whole argument of this file in one place. The
 * alternative — allow any short word here — is safe only until somebody writes
 * `lazyScreen(product.name, …)`.
 */
const SCREEN_NAMES = [
'Materials',
'Products',
'specification',
'artefact',
'Records',
'Settings',
'Billing'];


/**
 * The four provider hooks, WHOLE, because the shape check was not one.
 *
 * `use([A-Za-z]{1,32}) must be used inside ([A-Za-z]{1,48})` was the only entry
 * in the table below that echoed BOTH of its captures verbatim — up to eighty
 * characters of arbitrary text, on the argument that both captures are code
 * identifiers by construction. They are, today, from these four throw sites. But
 * "by construction" is a property of the call sites and not of the pattern, and
 * the pattern is what runs: a hook named after a product, or an error whose
 * message merely FITS that sentence, walks straight through it.
 *
 * So the sentence is a list, on the same argument as SCREEN_NAMES, KNOWN_SOURCES
 * and KNOWN_ERROR_NAMES. Grep `must be used inside` to see all four; add a
 * provider and forget this and its message is redacted rather than sent.
 */
const PROVIDER_HOOK_MESSAGES = [
'useAuth must be used inside AuthProvider',
'useWorkspace must be used inside WorkspaceProvider',
'useProducts must be used inside ProductsProvider',
'useEntitlement must be used inside EntitlementProvider'];


/**
 * The messages this app is allowed to say out loud, and how each one is rendered
 * once its variable parts are removed.
 *
 * Two families, and the distinction is worth keeping in mind when adding one:
 *
 *   OURS — thrown by this codebase, so the whole string is a literal in our
 *   source and can be echoed back whole. Grep `throw new` to see them all.
 *
 *   THE RUNTIME'S — thrown by the browser or by a library. These are the ones
 *   that carry things: `Cannot read properties of undefined (reading 'x')` puts
 *   a property key in the message, and while that key is almost always an
 *   identifier from our own code, `map[product.name]` would put a product name
 *   there instead. Almost always is not a standard this file gets to use, so the
 *   TEMPLATE is kept and the capture is redacted. That still separates "a null
 *   read" from "a failed chunk fetch" from "a syntax error", which is the
 *   triage most of this is for.
 *
 * Anything that matches nothing here is replaced wholesale. That is the
 * allow-list doing its job, and it is the reason `NonError` — where
 * `report-error.ts` puts `JSON.stringify(thrownValue)` into the message, and a
 * thrown product object therefore becomes the message — cannot leak: an
 * arbitrary JSON blob matches no pattern below.
 */
const RECOGNISED: Array<{pattern: RegExp;render: (match: RegExpExecArray) => string;}> = [
// ── ours
{
  // The four provider hooks — matched for shape, then held to the LIST. See
  // PROVIDER_HOOK_MESSAGES: this was the one entry here that echoed arbitrary
  // text, and it is now the one entry that echoes a string we shipped.
  pattern: /^use([A-Za-z]{1,32}) must be used inside ([A-Za-z]{1,48})$/,
  render: (m) =>
  PROVIDER_HOOK_MESSAGES.includes(m[0]) ?
  m[0] :
  `use${REDACTED} must be used inside ${REDACTED}`
},
{ pattern: /^plan catalogue is empty$/, render: () => 'plan catalogue is empty' },
{
  pattern: /^plan catalogue is missing currency or tax behaviour$/,
  render: () => 'plan catalogue is missing currency or tax behaviour'
},
{
  // An HTTP status is not a customer's data. One of the three captures in this
  // table echoed verbatim: the pattern fixes the space at 1,000 values, which is
  // the "a shape check IS a list" case the header names.
  pattern: /^plan catalogue request failed \((\d{3})\)$/,
  render: (m) => `plan catalogue request failed (${m[1]})`
},
{
  // ScreenNotLoaded, from lib/lazy-screen.ts. The screen name is kept only if it
  // is one we know we wrote — see SCREEN_NAMES.
  pattern: /^The code for the ([A-Za-z]{1,24}) screen could not be downloaded\.$/,
  render: (m) =>
  `The code for the ${SCREEN_NAMES.includes(m[1]) ? m[1] : REDACTED} screen ` +
  'could not be downloaded.'
},
{
  // report-error.ts's own last resort, when describe() cannot print the value.
  pattern: /^An unprintable value was thrown\.$/,
  render: () => 'An unprintable value was thrown.'
},

// ── the runtime's
{
  pattern: /^Cannot read properties of (undefined|null) \(reading '([\s\S]*)'\)$/,
  render: (m) => `Cannot read properties of ${m[1]} (reading '${REDACTED}')`
},
{
  pattern: /^Cannot set properties of (undefined|null) \(setting '([\s\S]*)'\)$/,
  render: (m) => `Cannot set properties of ${m[1]} (setting '${REDACTED}')`
},
{
  // Safari's wording for the same fault.
  pattern: /^(undefined|null) is not an object \(evaluating '([\s\S]*)'\)$/,
  render: (m) => `${m[1]} is not an object (evaluating '${REDACTED}')`
},
{
  pattern: /^([\s\S]+) is not a function$/,
  render: () => `${REDACTED} is not a function`
},
{
  pattern: /^([\s\S]+) is not iterable$/,
  render: () => `${REDACTED} is not iterable`
},
{
  pattern: /^([\s\S]+) is not defined$/,
  render: () => `${REDACTED} is not defined`
},
{
  // EVERY React invariant in a production build arrives looking like this, so
  // without it the most common class of fault in this app would be unreadable.
  //
  // The second of the three captures echoed verbatim, and the space the pattern
  // fixes is 11,110 values. See the header.
  //
  // THE TAIL IS DROPPED AND THAT IS THE WHOLE POINT OF THE ENTRY. React appends
  // `; visit https://react.dev/errors/418?args[]=…`, and those args are the
  // values interpolated into the real message — which for a hydration or a
  // rendering invariant is text off the screen the maker was looking at. The
  // number alone is enough: it maps to the message on React's own site.
  pattern: /^Minified React error #(\d{1,4})[\s\S]*$/,
  render: (m) => `Minified React error #${m[1]}`
},
{
  // The failed-chunk family, which is the mid-deploy case in lib/lazy-screen.ts
  // reaching us from below `ScreenNotLoaded`. The URL is redacted: it is our own
  // asset path today and there is no rule that says it must stay that way.
  pattern: /^Failed to fetch dynamically imported module:?\s*([\s\S]*)$/,
  render: () => `Failed to fetch dynamically imported module: ${REDACTED}`
},
{
  pattern: /^error loading dynamically imported module:?\s*([\s\S]*)$/,
  render: () => `error loading dynamically imported module: ${REDACTED}`
},
{
  pattern: /^Importing a module script failed\.$/,
  render: () => 'Importing a module script failed.'
},
{ pattern: /^Failed to fetch$/, render: () => 'Failed to fetch' },
{ pattern: /^Load failed$/, render: () => 'Load failed' },
{
  pattern: /^NetworkError when attempting to fetch resource\.$/,
  render: () => 'NetworkError when attempting to fetch resource.'
},
{ pattern: /^Network request failed$/, render: () => 'Network request failed' },
{
  // A cross-origin script, with everything stripped by the browser before we
  // ever see it. Kept because knowing a report is this and nothing else is the
  // difference between investigating and not.
  pattern: /^Script error\.$/,
  render: () => 'Script error.'
},
{
  pattern: /^ResizeObserver loop (completed with undelivered notifications\.|limit exceeded)$/,
  render: (m) => `ResizeObserver loop ${m[1]}`
},
{
  // ONE character, and it is the one that matters: '<' means the origin served
  // index.html for a request for a script, which is the signature of a stale
  // tab after a deploy. A single character cannot carry a supplier name — the
  // third and last capture in this table echoed verbatim. See the header.
  pattern: /^Unexpected token '(.)'$/,
  render: (m) => `Unexpected token '${m[1]}'`
}];


/**
 * The message, reduced to something we can defend sending.
 *
 * An exception message is the single most likely place a customer's formulation
 * data leaves this app: it is free text assembled at the throw site, and the
 * throw site is frequently not ours. So it is not filtered, it is RECOGNISED —
 * matched whole against the list above — and anything that matches nothing is
 * replaced by its fingerprint and nothing else.
 *
 * The cost is real and is the point: an unfamiliar error arrives unreadable, and
 * making it readable means adding a pattern here, in a diff, with a reason. That
 * is the trade this file exists to make.
 */
export function scrubMessage(message: string): {text: string;recognised: boolean;} {
  if (typeof message !== 'string' || message.length === 0) {
    return { text: '', recognised: true };
  }
  for (const entry of RECOGNISED) {
    const match = entry.pattern.exec(message);
    if (match) return { text: entry.render(match).slice(0, MAX_MESSAGE), recognised: true };
  }
  return { text: `[unrecognised:${digest(message)}]`, recognised: false };
}

/* ──────────────────────────────────────────────────────────────── the stack */

/**
 * Where a script may have come from for its path to be sent.
 *
 * `/assets/` is every chunk Vite emits in a production build; `/src/` and
 * `/node_modules/` are what a dev server serves. Everything else is redacted,
 * and the case that matters is the DOCUMENT: a frame whose file is the page
 * itself carries the page's path, which is `/products/<a customer's product id>`.
 * Browser extensions and injected third-party scripts fall out here too.
 *
 * The origin is dropped from every frame regardless. `~/assets/index-abc.js` is
 * also the form Sentry's source-map resolution expects, so nothing is lost by it.
 */
const ALLOWED_SCRIPT_PREFIXES = ['/assets/', '/src/', '/node_modules/'];

/**
 * What a script's path may END in, which is the other half of the prefix check.
 *
 * The prefix alone said "anything at all, as long as it starts with /assets/",
 * and the way arbitrary text reaches this function is a MESSAGE line that parses
 * as a frame — `at go (/assets/Winter-Fig-unlaunched:1:2)` is a stack line as far
 * as the patterns below are concerned. Requiring an extension a bundler or a dev
 * server actually emits costs nothing and refuses that line.
 *
 * IT NARROWS, IT DOES NOT CLOSE, AND THE ROUND THAT SAID IT DID WAS WRONG. The
 * sentence that used to end this comment read "the header is now cut off by
 * construction … that closes the demonstrated route". It did not close it, and
 * it was not the only route. Four were run against the shipped code before it
 * was touched this round, each of them putting a path-shaped product name into a
 * real serialised envelope through `filename`:
 *
 *   1. A MESSAGE THAT BEGINS WITH A NEWLINE. `withoutHeader` refused to cut when
 *      it found a '\n' at or before the start of the message — `lastIndexOf('\n',
 *      at)` is inclusive of `at` — so a message whose first character is a
 *      newline defeated the subtraction entirely. `new Error('\n    at go
 *      (/assets/Winter-Fig-and-Cassis-unlaunched-2027.js:1:2)')` went out with
 *      that filename and `in_app: true` on it. Off by one, in the guard.
 *   2. A STACK ADOPTED FROM ANOTHER ERROR. `err.stack = original.stack` is
 *      ordinary rethrow hygiene, and then the header is not the message we hold,
 *      `indexOf` fails, and nothing is cut.
 *   3. A REPORT WHOSE MESSAGE IS NOT THE ONE IN THE HEADER for any other reason
 *      — `describe()` in report-error.ts falls back to `String(error)`, and an
 *      Error whose `.stack` was formatted before `.message` was reassigned keeps
 *      the old header. Same failure: nothing to subtract, nothing subtracted.
 *   4. THE NESTED CAUSE. `ScreenNotLoaded` appends `caused by: ${cause.stack}`,
 *      whose header is a second message this function cannot subtract.
 *
 * All four are the same fault: the subtraction is CONDITIONAL on the stack's
 * header being the message we were handed, and there are ordinary reasons for it
 * not to be. `withoutHeader`'s own comment only ever considered one of them.
 *
 * SO THE SUFFIX AND PREFIX CHECKS ARE NO LONGER WHAT STANDS THERE. They still
 * run — they are what a path must pass to be ELIGIBLE — but the thing that
 * decides is the list of scripts the page actually fetched. See LOADED SCRIPTS.
 * The header cut is fixed (off-by-one gone) and kept as a second layer, because
 * two independent reasons to drop a line is the shape of the rest of this file.
 */
const SCRIPT_SUFFIXES = ['.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx', '.css', '.map'];

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * LOADED SCRIPTS: THE LIST `filename` IS HELD TO, AND WHAT IT COSTS
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * The rule at the top of this file says a string the RUNTIME wrote gets a list
 * of strings we can vouch for. `filename` was exempted from that rule for three
 * rounds on the argument that no list was available at runtime. There is one,
 * and it is better than a list of names in our source, because it is a list of
 * paths THE BROWSER ITSELF FETCHED A SCRIPT FROM on this page:
 *
 *   - `document.scripts` — in a production build the entry chunk is a real
 *     `<script type="module" src="/assets/index-HASH.js">` in index.html;
 *   - `<link rel="modulepreload">` — Vite emits one per entry-graph chunk in
 *     index.html, and its `__vitePreload` helper APPENDS one to `document.head`
 *     for every chunk a dynamic `import()` pulls in, so a lazily-loaded route's
 *     chunk is in the DOM by the time code in it can throw;
 *   - `performance.getEntriesByType('resource')` — everything else the page
 *     fetched, including what a dev server serves out of `/src/` and
 *     `/node_modules/`.
 *
 * WHY THIS IS A LIST AND NOT A SECOND SHAPE CHECK. The question the rule asks is
 * who wrote the string. Every entry in this list was written by our build or by
 * the dev server and then FETCHED BY THE BROWSER, which is a fact about the
 * network rather than about the text: a product name cannot get into it unless
 * this app fetches a script whose URL it built out of a product, and nothing
 * does, and that would be the leak rather than a way of hiding one.
 *
 * IT CAN ONLY EVER REMOVE. The list is built by `loadedScriptPaths` below, which
 * puts every candidate through the SAME shape, prefix and suffix gate a frame
 * has to pass. So the set of values `filename` can take is a SUBSET of what the
 * old check allowed. Adding this cannot widen anything; it is not itself a
 * channel.
 *
 * WHAT IT COSTS, STATED RATHER THAN HOPED. A frame whose script the page did not
 * fetch is `[redacted]`, keeping its line and column. Three cases:
 *
 *   - A CALLER THAT PASSES NO LIST gets every filename redacted. That is the
 *     default and it is deliberate — this file's whole argument is that the
 *     default answer for anything nobody thought about is DROP — but it means a
 *     new call site that forgets the argument quietly loses the field. That is
 *     the direction this file chooses to fail in, and `scrubReport`'s signature
 *     makes the argument required rather than optional so a new call site has to
 *     say something.
 *   - A BROWSER WITH NO RESOURCE TIMING still has `document.scripts` and the
 *     modulepreload links, which between them cover every chunk in a production
 *     build. Resource timing's buffer (250 entries by default) can fill on a
 *     long session; the DOM sources do not expire, which is why they are read
 *     first rather than instead.
 *   - A FRAME FROM SOMEBODY ELSE'S SCRIPT — an extension, an injected tag — was
 *     already redacted by the prefix check and still is.
 *
 * The alternative considered and rejected is still worth writing down: requiring
 * Vite's own `name-HASH.ext` shape. It is a shape check, so it would have
 * refused nothing that this file's own tests could not defeat, and an
 * `entryFileNames` change would have silently redacted every frame in the app.
 * The list has the opposite failure mode: it goes wrong when the browser did not
 * fetch the file, which is exactly when the path is not one of ours.
 *
 * WHAT IS LEFT ON THIS FIELD, since the last three rounds each said "closed" and
 * were each wrong. Two things, and both are small and stated rather than hidden:
 *
 *   - A CHUNK NAME IS A CHUNK NAME. `/assets/Specification-CXsyFQtt.js` says
 *     which screen the maker was on, which is the same fact `route` already
 *     sends deliberately. It is ours, not the customer's.
 *   - THE LIST WOULD CARRY A PRODUCT IF THE APP EVER FETCHED A SCRIPT NAMED
 *     AFTER ONE. `import(`/assets/${product.slug}.js`)` would put that path in
 *     the browser's own resource timing and therefore in the list. Nothing in
 *     this app builds a script URL from data, and a change that did would be the
 *     leak rather than a way past this check — but it is the one input that can
 *     widen what this field may say, so it is the thing to look at if the
 *     canary in scrub-report.canary.test.ts ever goes off on a frame.
 */

/** A path that is ours to send: no query, no fragment, no surprises. */
const SCRIPT_PATH = /^\/[A-Za-z0-9._@/-]{1,200}$/;

/** No list at all, which redacts every filename. The deliberate default. */
export const NO_LOADED_SCRIPTS: ReadonlySet<string> = new Set<string>();

/** How many locations `loadedScriptPaths` will read, so a hostile page cannot make it the payload. */
const MAX_LOADED_SCRIPTS = 500;

/**
 * A URL or a bare path, reduced to a path, or null if it is neither.
 *
 * Shared by the list builder and the frame reader on purpose: a path that is
 * normalised one way going into the list and another way coming out of a frame
 * would be a list that never matches, which is the quiet total loss of the field
 * this file says it will not accept.
 */
function pathOf(location: string): string | null {
  if (typeof location !== 'string' || location.length === 0) return null;
  try {
    return new URL(location).pathname;
  } catch {
    // Not an absolute URL. A bare absolute path is the only other form worth
    // reading; anything else (`blob:`, `eval at …`, a Windows path) is dropped.
    if (!location.startsWith('/')) return null;
    return location.split('?')[0].split('#')[0];
  }
}

/** Is this a path we would be willing to name at all, before asking whether it was loaded? */
function sendableShape(path: string): boolean {
  if (!SCRIPT_PATH.test(path)) return false;
  if (!ALLOWED_SCRIPT_PREFIXES.some((prefix) => path.startsWith(prefix))) return false;
  return SCRIPT_SUFFIXES.some((suffix) => path.endsWith(suffix));
}

/**
 * The list, built from whatever the caller could find out about the page.
 *
 * Pure, and takes the raw locations rather than reading the DOM itself, so this
 * file stays a function of its arguments and a test can hand it anything. The
 * impure half — reading `document.scripts`, the modulepreload links and resource
 * timing — is `scriptsThePageFetched` in lib/error-sink.ts, next to the other
 * thing that has to touch `window`.
 */
export function loadedScriptPaths(locations: Iterable<string>): ReadonlySet<string> {
  const paths = new Set<string>();
  for (const location of locations) {
    if (paths.size >= MAX_LOADED_SCRIPTS) break;
    const path = pathOf(location);
    if (path !== null && sendableShape(path)) paths.add(path);
  }
  return paths;
}

/** V8: `    at fn (url:1:2)`, and `    at url:1:2` with no function at all. */
const V8_FRAME = /^\s*at\s+(?:(.+?)\s+\()?(.+?):(\d+):(\d+)\)?\s*$/;
/** SpiderMonkey and JavaScriptCore: `fn@url:1:2`, `@url:1:2`. */
const AT_FRAME = /^([^@]*)@(.+?):(\d+):(\d+)$/;

/**
 * A frame's file, reduced to a path we are willing to name, or a placeholder.
 *
 * Deliberately does not care whether the origin is ours: it drops the origin
 * either way and then asks only about the path. Comparing origins would need the
 * page's origin passed in, and would make a frame's safety depend on where the
 * app happens to be deployed.
 *
 * THE LAST LINE IS THE ONE THAT MATTERS. Shape, prefix and suffix say the path
 * is eligible; `loaded` says the browser actually fetched a script from it. See
 * LOADED SCRIPTS above for why the second question is a list and the first three
 * are not.
 */
function scrubScriptPath(location: string, loaded: ReadonlySet<string>): string {
  const path = pathOf(location);
  if (path === null) return REDACTED;
  if (!sendableShape(path)) return REDACTED;
  if (!loaded.has(path)) return REDACTED;
  return path;
}

function boundedPosition(raw: string): number | undefined {
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value < 0 || value > 10_000_000) return undefined;
  return value;
}

/**
 * The stack with its header removed — the whole run of it, not the first line.
 *
 * `error.stack` in V8 begins `${name}: ${message}` and the frames follow. When
 * the message is one line that is one line; when the message contains newlines
 * the header is as many lines as the message has, and a line of a MESSAGE that
 * happens to parse as a frame is what carried an unlaunched product name through
 * `filename`. See SCRIPT_SUFFIXES.
 *
 * So the cut is made from the message rather than from the shape of a line: find
 * the message, insist it starts on the first line (which is what makes it a
 * header rather than a coincidence), and drop everything through the end of it.
 * Safari and Firefox write no header at all, so `indexOf` fails and nothing is
 * cut, which is correct — their stacks are frames from the first character.
 *
 * IT IS A SECOND LAYER AND NOT THE DEFENCE, and the reason is written where it
 * can be checked: this cut only happens when the header IS the message we were
 * handed, and SCRIPT_SUFFIXES lists four ordinary reasons for it not to be —
 * three of which this function cannot do anything about from inside. What stands
 * between `filename` and a maker's product is the loaded-script list. This makes
 * the frame list tidier and takes one route off the board; it is not the answer.
 *
 * THE GUARD BELOW WAS OFF BY ONE, WHICH IS THE ROUTE THAT SHIPPED. It read
 * `stack.lastIndexOf('\n', at) !== -1`, and `lastIndexOf` searches from `at`
 * INCLUSIVE — so a message whose first character is a newline found itself, and
 * every multi-line message beginning with '\n' skipped the subtraction
 * completely. The question being asked is "is there a line break BEFORE this",
 * so it is now asked about the text before it and nothing else.
 */
function withoutHeader(stack: string, message: string): string {
  if (message.length === 0) return stack;
  const at = stack.indexOf(message);
  if (at === -1) return stack;
  // A '\n' before it means this is not the header; it is the message quoted
  // somewhere further down, and cutting to there would eat real frames.
  if (stack.slice(0, at).includes('\n')) return stack;
  return stack.slice(at + message.length);
}

/**
 * The stack, rebuilt from the frames it contains rather than passed through.
 *
 * REBUILT IS THE LOAD-BEARING WORD. `error.stack` begins with a header that is
 * the name and the whole unredacted message, and `ScreenNotLoaded` appends a
 * `caused by:` line carrying a second one. Sending the stack as a string would
 * hand over the exact text scrubMessage exists to withhold, in a field nobody
 * was looking at. Only lines that parse as a frame survive; everything else —
 * causes, blank lines, whatever a future Error subclass appends — is dropped
 * because it is not on the list. The header is not left to that check: it is
 * subtracted first, by `withoutHeader`, because "does not parse as a frame" was
 * not true of every line of it.
 *
 * AND THE PATH ON A LINE THAT DOES PARSE IS HELD TO `loadedScripts`, which is
 * the fix that closes the class rather than the instance: it does not matter
 * which of the four ways a message line got into the stack, because a line the
 * runtime did not fetch a script from cannot name one. See LOADED SCRIPTS.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE FUNCTION NAME IS PARSED AND THEN THROWN AWAY, AND THAT IS THE POINT
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * It used to be sent, held to an identifier shape, so its default answer for a
 * string nobody anticipated was SEND. THIS COMMENT USED TO CALL IT "THE ONE
 * FIELD IN THIS FILE" LIKE THAT, AND THAT WAS NOT TRUE WHEN IT WAS WRITTEN:
 * `components` was shape-checked in exactly the same way, in the function below,
 * and went on to put a real batch code on the real wire. Both are list-checked
 * now, and the rule that was missing is at the top of this file.
 *
 * A shape check cannot be a list here, because V8 INFERS FUNCTION NAMES FROM
 * DATA. Run this and read the stack:
 *
 *     const handlers = { [batch.code]: function () { throw new Error('x') } };
 *     handlers[batch.code]();
 *
 * V8 writes `at Object.BL240417A (/assets/index-a1b2c3.js:2:53)`, and a batch
 * code is exactly the kind of value this app holds. `Object.defineProperty(fn,
 * 'name', …)` and a class named from data do the same. Minification does not
 * save us either: esbuild mangles local bindings and not property names, so the
 * computed key survives into the bundle and into the frame. And an identifier
 * shape cannot tell `BL240417A` from `deriveHazards` — nothing can.
 *
 * WHAT IT COST TO DROP: nothing Sentry needs. `filename`, `lineno` and `colno`
 * are already sent and are precisely what its source-map resolution consumes to
 * name the real symbol; grouping here is our own `fingerprint`, not the frames.
 * In a production build the name would have been a mangled two-letter binding
 * anyway — except in the one case that leaked.
 */
export function scrubStack(
stack: string | undefined,
message = '',
loadedScripts: ReadonlySet<string> = NO_LOADED_SCRIPTS)
: ScrubbedFrame[] {
  if (typeof stack !== 'string' || stack.length === 0) return [];
  const frames: ScrubbedFrame[] = [];
  for (const line of withoutHeader(stack, typeof message === 'string' ? message : '').split('\n')) {
    if (frames.length >= MAX_FRAMES) break;
    const match = V8_FRAME.exec(line) ?? AT_FRAME.exec(line);
    if (!match) continue;
    // match[1] is the function name. It is matched so that the rest of the line
    // parses, and deliberately not read — see above.
    const filename = scrubScriptPath(match[2].trim(), loadedScripts);
    // THE POSITION TRAVELS WITH THE PATH OR NOT AT ALL, and this is the same
    // defect as `function` and as `filename` before it, in its fourth costume.
    //
    // `lineno` and `colno` are read off the same line as the path — a line that,
    // on every route where the header cut does not fire, was written by somebody
    // else. Reproduced: a stack whose header is not our message (an adopted
    // stack, a Safari/Firefox stack with no header, or an empty message) puts
    //
    //     at compute (/assets/Midnight-Fig-No7.js:12:43)
    //
    // through as `{filename: '[redacted]', lineno: 12, colno: 43}` — the path
    // correctly refused, and the formulation percentage 12.43 on the wire beside
    // it in two pieces. Two small integers look like the safest thing in the
    // payload, which is exactly why they were the field nobody checked.
    //
    // The rule at the top of this file asks who wrote the string. For a position
    // the honest answer is: the same author as the path next to it. So it gets
    // the same answer — and the list is one we already have, because a position
    // is only MEANINGFUL for a path a source map can resolve. On `[redacted]`
    // there is nothing to resolve it against, so dropping it costs Sentry
    // nothing it could have used and removes the channel entirely.
    //
    // Written as a pair rather than as two guards so the invariant is visible in
    // one place: no path, no numbers.
    frames.push(
      filename === REDACTED ?
      { filename } :
      { filename, lineno: boundedPosition(match[3]), colno: boundedPosition(match[4]) }
    );
  }
  return frames;
}

/* ─────────────────────────────────────────────────────── the component trail */

const COMPONENT_LINE = /^\s*(?:at|in)\s+([A-Za-z_$][A-Za-z0-9_$.]{0,63})/;

/**
 * React's component trail, reduced to the component names WE SHIPPED.
 *
 * The REST of each line is a script URL, and in some React builds the document
 * URL, which is where the route and therefore a product id lives. So the names
 * are extracted and the lines are thrown away, rather than the lines being
 * cleaned up and kept. That part was always right.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE NAME ITSELF WAS THE LEAK, AND IT WAS THE SAME LEAK AS `function`
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * This comment used to say "the names are our own code — a component is never
 * named after a product", and hold them to `[A-Za-z_$][A-Za-z0-9_$.]{0,63}`.
 * Both halves were wrong, and a REAL BATCH CODE WAS PUT ON THE REAL SENTRY WIRE
 * through `extra.component_trail` to prove it:
 *
 *     const screens = { [batch.code]: function () { throw … } };
 *     render(<ErrorBoundary><screens[batch.code] /></ErrorBoundary>);
 *
 * V8 names that function `BL240417A` from the computed key; React reads
 * `type.displayName || type.name` to build the stack; the trail arrived as
 * `["BL240417A", "ErrorBoundary"]` and went out in the envelope. It is the
 * mechanism that had `frames[].function` deleted, one level up the tree, and it
 * walked into the field next door because that field was shape-checked.
 *
 * So the name is now held to APP_COMPONENT_NAMES — a list scanned from this
 * app's own source, the way SCREEN_NAMES and ROUTES are hand-copied from theirs.
 * A name that is not on it is `[redacted]`: the trail keeps its DEPTH and its
 * position, which is most of what it was read for, and loses a label.
 *
 * See lib/app-component-names.ts for how the list is produced, why it is
 * deliberately over-inclusive, what it is worth in a minified build (measured:
 * less than you think — our own names are mangled out of production, so the one
 * name that would survive verbatim there is the inferred one), and the guard
 * test that holds every entry to "this string occurs in our own source".
 */
export function scrubComponentStack(componentStack: string | undefined): string[] {
  if (typeof componentStack !== 'string' || componentStack.length === 0) return [];
  const names: string[] = [];
  for (const line of componentStack.split('\n')) {
    if (names.length >= MAX_COMPONENTS) break;
    const match = COMPONENT_LINE.exec(line);
    if (match) names.push(APP_COMPONENT_NAMES.has(match[1]) ? match[1] : REDACTED);
  }
  return names;
}

/* ──────────────────────────────────────────────────────────────── the route */

/**
 * Every route this app answers, copied from `RoutedScreens` in App.tsx.
 *
 * LITERAL SEGMENTS BEFORE PARAMETERISED ONES, because '/settings/billing' and
 * '/settings/:tab' both match a two-segment path and the first match wins. The
 * list below is already in that order and the sort keeps it there, so adding a
 * route in the wrong place cannot quietly relabel an existing one.
 *
 * A second copy of the route table is a thing that can drift, and the drift is
 * survivable in one direction only: a route added there and not here reports as
 * unrecognised, which loses a label. The reverse — a pattern here that is not a
 * route — costs nothing at all.
 */
const ROUTES = [
'/',
'/materials',
'/materials/:materialClass',
'/materials/:materialClass/:materialId',
'/products',
'/products/:productId',
'/products/:productId/artefacts/:artefactType',
'/outputs',
'/artefacts',
'/records',
'/records/:recordCode',
'/compliance',
'/billing',
'/billing/success',
'/settings',
'/settings/billing',
'/settings/:tab'].
sort((a, b) => {
  const params = (route: string) => route.split('/').filter((s) => s.startsWith(':')).length;
  return params(a) - params(b);
});

function matches(pattern: string, path: string): boolean {
  const wanted = pattern.split('/');
  const got = path.split('/');
  if (wanted.length !== got.length) return false;
  return wanted.every((segment, index) =>
  segment.startsWith(':') ? got[index].length > 0 : segment === got[index]
  );
}

/**
 * Which SCREEN the maker was on — never which product.
 *
 * A URL is the quietest leak in this whole file. `/products/8f3c…` is a uuid,
 * and a uuid feels safe because it is not a name — but it identifies one
 * customer's product, it is stable, and a handful of reports from one account
 * are enough to map their catalogue by size. A query string is worse: it can
 * carry anything a screen ever chose to put there.
 *
 * So the URL is not cleaned, it is REPLACED — by the route pattern it matched,
 * and by nothing if it matched none. '/products/:productId' is the entire useful
 * content of a URL for triage anyway; which product it was is a question for the
 * customer, not for a third party's database.
 */
export function scrubRoute(href: string | null | undefined): string {
  if (typeof href !== 'string' || href.length === 0) return '[no route]';
  let path: string;
  try {
    path = new URL(href).pathname;
  } catch {
    // A bare path, which is what a test or a non-browser caller is likeliest to
    // hand over. Split before reading: the query is never inspected, only cut.
    path = href.split('?')[0].split('#')[0];
  }
  if (!path.startsWith('/')) return '[unrecognised route]';
  const normalised = path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path;
  const route = ROUTES.find((pattern) => matches(pattern, normalised));
  return route ?? '[unrecognised route]';
}

/* ────────────────────────────────────────────────────────────── the whole of it */

/**
 * The reference and the timestamp are SHAPES, because both are generated inside
 * `report-error.ts` from a fixed alphabet and a clock and cannot be anything
 * else. The two below them are LISTS, and the difference is the whole argument.
 */
// REFERENCE_ALPHABET in report-error.ts, exactly: no I, L, O, U, 0 or 1, because a
// reference is read down a phone. Copying the real alphabet rather than [A-Z0-9] costs
// nothing and means a reference-shaped string that this app did not generate is refused.
const REFERENCE = /^[A-HJ-KMNP-TV-Z2-9]{4}-[A-HJ-KMNP-TV-Z2-9]{4}$/;
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/;

/**
 * Every `source` this app files under.
 *
 * A LIST, NOT A SLUG SHAPE. `source` is documented in report-error.ts as free
 * text from the call site, and the natural next call site is
 * `reportError(error, `product-${id}`)` — which is a perfectly good slug and a
 * customer's product id. A shape check would wave it through. This cannot: a
 * source added without being added here reports as `[redacted]`, which loses a
 * label and leaks nothing.
 *
 * From `sourceFor` in components/ErrorBoundary.tsx and the two listeners in
 * lib/global-errors.ts. They are the only callers of `reportError` today.
 */
const KNOWN_SOURCES = ['render', 'screen-render', 'window-error', 'unhandled-rejection'];

/**
 * Every error name we are willing to repeat.
 *
 * ALSO A LIST, AND FOR A SHARPER REASON THAN `source`: `error.name` is a plain
 * writable property. `ScreenNotLoaded` sets its own in a constructor, which is
 * ordinary and fine — and `error.name = product.name` is one line away from
 * ordinary too. Any identifier-shaped check passes "Lavender". A list does not.
 *
 * The JavaScript built-ins, this app's own subclass, `report-error.ts`'s label
 * for a thrown non-Error, and the handful of DOMException names a browser
 * actually produces here. Anything else is `[redacted]` — the report still
 * arrives, still groups, and still carries its frames.
 */
const KNOWN_ERROR_NAMES = [
// JavaScript's own
'Error',
'TypeError',
'RangeError',
'SyntaxError',
'ReferenceError',
'EvalError',
'URIError',
'AggregateError',
// ours
'ScreenNotLoaded',
'NonError',
// DOMException, restricted to the ones this app can plausibly see
'AbortError',
'NetworkError',
'NotAllowedError',
'NotFoundError',
'NotSupportedError',
'QuotaExceededError',
'SecurityError',
'TimeoutError',
'InvalidStateError',
'DataCloneError'];


/** Keep it only if it is one of the values we know about. */
function oneOf(value: string | undefined, known: string[], fallback: string): string {
  if (typeof value !== 'string') return fallback;
  return known.includes(value) ? value : fallback;
}

/**
 * The one function the sink calls, and the only thing in this app that decides
 * what a third party is told.
 *
 * `href` and `loadedScripts` are passed in rather than read off `window` and
 * `document` so this stays pure and so a test can put a real product URL and a
 * real script list through it. Null `href` is fine and means "no route".
 *
 * `loadedScripts` IS REQUIRED RATHER THAN DEFAULTED, and that is the one place
 * this signature is deliberately awkward. An omitted list redacts every
 * `filename`, which is the safe direction but also a silent loss of the field —
 * so a new call site has to write `NO_LOADED_SCRIPTS` and mean it rather than
 * getting it by forgetting. See LOADED SCRIPTS.
 *
 * FIELD BY FIELD, NOT SPREAD. `{ ...report }` would be shorter and would mean
 * that the next field added to `ErrorReport` — by somebody working on something
 * else entirely, with no reason to think about this file — starts being sent to
 * a third party the moment it is added. Naming each field is the allow-list;
 * there is a test that fails if this ever becomes a spread.
 *
 * `messageDigest` IS TAKEN OVER WHAT WE SEND, NOT OVER WHAT WE WERE GIVEN —
 * except in the one case where there is nothing else to take it over. When a
 * message was RECOGNISED, the text that goes out is a template we shipped and
 * the only thing removed from it is the customer's; digesting the original there
 * would put the customer's value back into a grouping key, which is precisely the
 * oracle the header describes — and it would buy nothing, because two events
 * with the same rendered text are two events a triager cannot tell apart in the
 * issue list anyway. When it was NOT recognised, the text that goes out is
 * `[unrecognised:…]` and the original is the ONLY thing that separates two
 * different unknown faults, so the digest is taken over it and that residual is
 * named in the header rather than hidden.
 */
export function scrubReport(
report: ErrorReport,
href: string | null,
loadedScripts: ReadonlySet<string>)
: ScrubbedReport {
  const rawMessage = typeof report.message === 'string' ? report.message : '';
  const message = scrubMessage(rawMessage);
  return {
    reference: shaped(report.reference, REFERENCE, REDACTED),
    source: oneOf(report.source, KNOWN_SOURCES, REDACTED),
    name: oneOf(report.name, KNOWN_ERROR_NAMES, REDACTED),
    message: message.text,
    messageRecognised: message.recognised,
    messageDigest: message.recognised ? digest(message.text) : digest(rawMessage),
    at: shaped(report.at, ISO_TIMESTAMP, ''),
    route: scrubRoute(href),
    // The raw message is handed over so the stack's HEADER can be subtracted
    // rather than left to fail a shape check — a multi-line message puts
    // frame-shaped lines inside the stack. See withoutHeader. The list is what
    // actually decides each `filename`; see LOADED SCRIPTS.
    frames: scrubStack(report.stack, rawMessage, loadedScripts),
    components: scrubComponentStack(report.componentStack)
  };
}
