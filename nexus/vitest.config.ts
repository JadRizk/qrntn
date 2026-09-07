import { fileURLToPath } from 'node:url'

import { defineConfig } from 'vitest/config'

const resolvePath = (p: string) => fileURLToPath(new URL(p, import.meta.url))

export default defineConfig({
  // This config does NOT inherit vite.config.ts, so an alias added there is
  // invisible here — which is how the record agreement test failed to resolve
  // @nexus/record while the app build resolved it fine. Two places, one fact.
  resolve: {
    alias: [{ find: '@nexus/record', replacement: resolvePath('./packages/record/schema.ts') }],
  },
  test: {
    // packages/*/src too: the vendored @nexus/graph and @nexus/react
    // engines carry their own tests (physics.test.ts, camera.test.ts) and
    // were silently never collected by a bare `vitest run` from here.
    include: ['src/**/*.test.ts', 'packages/*/src/**/*.test.ts'],
  },
})
