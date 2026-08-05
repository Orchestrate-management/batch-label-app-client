import { useSyncExternalStore } from 'react';
import {
  SCHEMA_NOT_SERVED_MESSAGE,
  domainSchemaState,
  schemaFaultWasReported,
  subscribeToDomainSchema } from
'../lib/domain-schema';

/**
 * The one thing the app says when PostgREST has stopped serving the domain schema.
 *
 * WHY IT IS ONE BANNER AND NOT TWELVE REWRITTEN SCREENS. The failure is total, so every screen
 * fails at once, and each already has a truthful sentence for a read it could not make. What
 * none of them can know from their own error is that this one is permanent, account-wide and
 * ours — so each offers a retry, and five true sentences add up to the false impression that
 * this is weather. This says the part they cannot: it will not clear, and none of what is
 * drawn below it is a statement about the maker's account.
 *
 * IT NEVER SAYS "REPORTED" ON A BUILD THAT CANNOT REPORT. `hasErrorSink()` is false with no
 * `VITE_SENTRY_DSN`, exactly as on the crash screen — the same discipline, for the same reason:
 * "we have been told" is the single most tempting sentence to hard-code and the easiest one to
 * make permanently false.
 *
 * It renders nothing at all in the normal case. `domainSchemaState()` starts 'unknown' and only
 * ever moves on an observed PGRST106; a request that succeeded is not evidence the next one
 * will, so there is no 'served' state for this to be wrong about.
 */
export function SchemaNotServed() {
  const state = useSyncExternalStore(
    subscribeToDomainSchema,
    domainSchemaState,
    // The server snapshot. This app is client-rendered and there is nothing to observe before
    // a request has been made, so it is the same starting value rather than a second guess.
    () => 'unknown' as const
  );

  if (state !== 'not-served') return null;

  return (
    <div
      role="alert"
      className="border-b border-clay/40 bg-clay/10 px-6 py-4 lg:px-10">

      <p className="font-display text-sm font-medium text-ink">
        Batchlabel cannot reach its own data
      </p>
      <p className="mt-1 max-w-prose text-[0.8125rem] leading-relaxed text-ink-secondary">
        {SCHEMA_NOT_SERVED_MESSAGE}
      </p>
      <p className="mt-2 max-w-prose text-2xs leading-relaxed text-ink-tertiary">
        {schemaFaultWasReported() ?
        'This has been reported to us automatically. Anything a screen below says about what you have or have not got is not to be relied on until it clears.' :
        'This has NOT reached us automatically on this build — please get in touch. Anything a screen below says about what you have or have not got is not to be relied on until it clears.'}
      </p>
    </div>);

}
