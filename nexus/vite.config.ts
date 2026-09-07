import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const resolvePath = (p: string) => fileURLToPath(new URL(p, import.meta.url))

export default defineConfig({
  plugins: [react()],
  resolve: {
    // @nexus/react and @nexus/tokens are vendored (packages/), not real npm
    // packages — no workspace link back to ../nexus. These aliases are what
    // let their own source keep importing each other by bare specifier
    // ("@nexus/tokens") unchanged, matching tsconfig.json's own `paths`.
    alias: [
      { find: '@nexus/tokens/tokens.css', replacement: resolvePath('./packages/tokens/src/tokens.css') },
      { find: '@nexus/tokens', replacement: resolvePath('./packages/tokens/src/index.ts') },
      { find: '@nexus/react', replacement: resolvePath('./packages/react/src/index.ts') },
      // SK-94: the record's shape, shared with the zero-dependency commands.
      { find: '@nexus/record', replacement: resolvePath('./packages/record/schema.ts') },
    ],
  },
  server: {
    port: process.env['PORT'] ? Number(process.env['PORT']) : 5173,
  },
})
