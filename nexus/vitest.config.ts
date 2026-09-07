import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // packages/*/src too: the vendored @nexus/graph and @nexus/react
    // engines carry their own tests (physics.test.ts, camera.test.ts) and
    // were silently never collected by a bare `vitest run` from here.
    include: ['src/**/*.test.ts', 'packages/*/src/**/*.test.ts'],
  },
})
