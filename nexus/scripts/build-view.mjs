#!/usr/bin/env node
//
// build-view.mjs — what `qrntn view` ships, built from one source.
//
//   node scripts/build-view.mjs        writes ../view/
//
// Two artefacts into the repository-root `view/` directory, which is
// gitignored, built at publish time, and listed in package.json's `files`:
//
//   1. the viewer — `vite build`, the same build `npm run build` makes, with
//      its output pointed at ../view instead of dist/;
//   2. the exporter — scripts/export-graph.mjs bundled to one plain-Node ESM
//      file, its TypeScript imports (integrity.ts, types.ts) and zod compiled
//      in, so the zero-dependency CLI can run it with no toolchain installed.
//
// ONE SOURCE. SHIPPING.md §8 rejects reimplementing the exporter in the CLI on
// the record: a second implementation of the resolution order is the drift
// SURFACE.md's "cannot drift" clause exists to prevent. This bundles the one
// implementation instead. The bundle is not committed — a generated file that
// is committed is a file that drifts — so a release is whatever this script
// makes of the tree it runs in, and the smoke gate drives the result.
//
// THE FIXTURE NEVER SHIPS. vite copies public/ into the output, and public/
// holds data/graph.json — a 49-node snapshot of the library this was
// extracted from. It is a fixture for the checkout and must never reach a
// user as truth, so it is removed from the output here and view.mjs refuses
// to serve anything under /data/ but the graph it exported itself.

import { build as bundle } from 'esbuild'
import { existsSync, rmSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build as vite } from 'vite'

const NEXUS = join(dirname(fileURLToPath(import.meta.url)), '..')
const VIEW = join(NEXUS, '..', 'view')

await vite({ root: NEXUS, logLevel: 'warn', build: { outDir: VIEW, emptyOutDir: true } })

rmSync(join(VIEW, 'data'), { recursive: true, force: true })

await bundle({
	entryPoints: [join(NEXUS, 'scripts', 'export-graph.mjs')],
	outfile: join(VIEW, 'export-graph.mjs'),
	bundle: true,
	platform: 'node',
	target: 'node20',
	format: 'esm',
	// Kept readable: this file is what a person inspects when they ask what
	// the tarball runs against their library. The viewer is minified because
	// nobody reads a three.js build; this one is 70 KB and mostly its own
	// comments, and they are the point.
	minify: false,
	legalComments: 'inline',
	logLevel: 'warning'
})

for (const required of ['index.html', 'export-graph.mjs']) {
	if (!existsSync(join(VIEW, required))) {
		console.error(`build-view: ${required} was not produced — the build is incomplete`)
		process.exit(1)
	}
}
if (existsSync(join(VIEW, 'data'))) {
	console.error('build-view: view/data survived — the fixture must never ship')
	process.exit(1)
}

const kb = (p) => Math.round(statSync(p).size / 1024)
console.log(`build-view: wrote ${VIEW} — export-graph.mjs ${kb(join(VIEW, 'export-graph.mjs'))} KB, index.html and assets/`)
