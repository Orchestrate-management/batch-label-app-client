import { gzipSync } from 'node:zlib'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { vendorChunkFor } from './src/build/vendor-chunks'

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
export default defineConfig({
  plugins: [react(), reportEntryGraph()],
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
})
