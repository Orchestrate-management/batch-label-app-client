import { gzipSync } from 'node:zlib'
import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { vendorChunkFor } from './src/build/vendor-chunks'

/**
 * DO NOT SHIP 89 kB OF ERROR REPORTER TO A BUILD THAT CANNOT REPORT ERRORS.
 *
 * `installErrorSink` checks the DSN before it imports anything, so on a build
 * with `VITE_SENTRY_DSN` unset the vendor chunk is never fetched — that has a
 * test and it stays true. But never fetched is not never emitted: Rollup follows
 * the dynamic import regardless and writes the chunk, so every preview deploy
 * and every developer's `dist` has carried 89.46 kB raw / 30.26 kB gzip of a
 * vendor that build has no way to reach. Nobody downloads it; it is still
 * deployed, and "deployed but unreachable" is a thing that stops being true
 * quietly.
 *
 * So the import is resolved to a stub when there is no DSN. THE STUB IS NOT A
 * DISABLED SENTRY — its `init` returns undefined, which is precisely the value
 * `installErrorSink` already treats as "the SDK declined to start": no sink is
 * installed, `hasErrorSink()` stays false, and the crash screen goes on telling
 * the customer their failure has not reached us. On that build that is true, and
 * it was already true before this plugin existed.
 *
 * BUILD ONLY, and it logs which way it went, because the failure mode worth
 * naming is a DSN that is set in Vercel but not visible to `loadEnv`: the app
 * would build inert with nothing red. `loadEnv` reads `process.env` as well as
 * the `.env` files, which is how Vercel supplies it, and the line below is how
 * you check.
 */
function sentryOnlyWhenThereIsADsn(dsn: string): Plugin {
  const STUB = '\0batchlabel:sentry-absent'
  return {
    name: 'batchlabel:sentry-only-with-a-dsn',
    apply: 'build',
    // BEFORE `vite:resolve`, or this never sees the bare specifier: a normal-order
    // plugin is asked only after Vite has already resolved '@sentry/react' to a
    // path inside node_modules, and the chunk is emitted exactly as before.
    enforce: 'pre',
    buildStart() {
      this.info(
        dsn
          ? 'VITE_SENTRY_DSN is set — bundling @sentry/react as an on-demand chunk'
          : 'VITE_SENTRY_DSN is unset — @sentry/react is stubbed and not emitted'
      )
    },
    resolveId(source) {
      return !dsn && source === '@sentry/react' ? STUB : null
    },
    load(id) {
      if (id !== STUB) return null
      // The two named bindings lib/error-sink.ts destructures, and nothing else.
      return (
        'export function init() { return undefined }\n' +
        'export function captureEvent() { return undefined }\n'
      )
    }
  }
}

/**
 * THE NUMBER THE 500 kB WARNING USED TO STAND FOR.
 *
 * Rollup warns per chunk. Before the split below there was one chunk and it was 578 kB, so the
 * warning and the truth were the same sentence. After the split the largest chunk is 218 kB,
 * the warning falls silent, and not one byte has left the critical path — a build that looks
 * better and is not. That is the reverse of how this codebase is supposed to work, so the
 * signal is replaced rather than lost.
 *
 * ENTRY GRAPH, not "total build": the entry chunk plus everything it STATICALLY imports, which
 * is exactly the set a browser must have in hand before route `/` can draw. Dynamic imports —
 * the on-demand screens — are excluded on purpose; they are the thing the splitting bought and
 * counting them would make the number meaningless.
 *
 * Warns above the same 500 kB Rollup used, so it fires today, for the same reason, about the
 * same weight.
 */
function reportEntryGraph(limitBytes = 500 * 1024): Plugin {
  return {
    name: 'batchlabel:entry-graph-size',
    generateBundle(_options, bundle) {
      const chunks = Object.values(bundle).flatMap((item) =>
        item.type === 'chunk' ? [item] : []
      )
      const entry = chunks.find((chunk) => chunk.isEntry)
      if (!entry) return

      const byFileName = new Map(chunks.map((chunk) => [chunk.fileName, chunk]))
      const reached = new Set<string>()
      const pending = [entry.fileName]
      while (pending.length > 0) {
        const fileName = pending.pop() as string
        if (reached.has(fileName)) continue
        reached.add(fileName)
        // `imports` is static only. `dynamicImports` is deliberately not followed.
        pending.push(...(byFileName.get(fileName)?.imports ?? []))
      }

      let raw = 0
      let gzip = 0
      for (const fileName of reached) {
        const chunk = byFileName.get(fileName)
        if (!chunk) continue
        const code = Buffer.from(chunk.code)
        raw += code.length
        gzip += gzipSync(code, { level: 9 }).length
      }

      const kb = (bytes: number) => `${(bytes / 1024).toFixed(2)} kB`
      const line =
        `entry graph is ${kb(raw)} across ${reached.size} chunks (${kb(gzip)} gzip) — ` +
        `what route / must fetch before it can draw anything`
      if (raw > limitBytes) this.warn(line)
      else this.info(line)
    }
  }
}

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    reportEntryGraph(),
    sentryOnlyWhenThereIsADsn((loadEnv(mode, process.cwd(), 'VITE_').VITE_SENTRY_DSN ?? '').trim())
  ],
  build: {
    rollupOptions: {
      output: {
        /**
         * SAME BYTES ON FIRST PAINT, IN MORE FILES. That is not a hedge, it is the point.
         *
         * Every chunk named here is needed to draw anything, so none of this makes the first
         * visit faster and nothing in it is meant to. What it changes is the SECOND visit: with
         * vendors in their own fingerprinted files, a deploy that touches only our own code
         * leaves their hashes alone and a returning maker re-downloads our code instead of the
         * world. Measured on this branch, a code-only deploy went from invalidating the entire
         * build to invalidating about a fifth of it — the numbers are in entry 8 of
         * docs/PRODUCTION_TODO.md.
         *
         * ONE THING THIS COSTS, and it is worth knowing before reading the build output as good
         * news: Rollup's "chunks are larger than 500 kB" warning stops firing, because no single
         * chunk is over 500 kB any more. The weight it was warning about has not moved. Do not
         * read its absence as an improvement — read the entry-graph total the plugin below
         * prints, which is the number that actually corresponds to what a first-time visitor
         * waits for.
         */
        manualChunks: vendorChunkFor
      }
    }
  }
}))
