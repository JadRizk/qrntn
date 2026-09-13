#!/usr/bin/env node
//
// check-graph.mjs — Tier 3, §7. Runs data/integrity.ts against the
// committed public/data/graph.json and prints warnings. Exits 0 by
// default; `--strict` exits 1 if any warning fired.
//
// Deliberately not wired into scripts/check.mjs — that gate only discovers
// tests under skills/*/scripts, plan/, and the repo-root scripts/ dir, so a
// new top-level nexus/ is invisible to it by construction, and this script
// keeps it that way rather than entangling the two test suites.

import { readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { GraphSnapshotSchema } from '../src/data/types.ts'
import { checkIntegrity } from '../src/data/integrity.ts'

const strict = process.argv.includes('--strict')
const graphPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'data', 'graph.json')

const raw = JSON.parse(readFileSync(graphPath, 'utf8'))
const snapshot = GraphSnapshotSchema.parse(raw)

const warnings = checkIntegrity(snapshot)

// The graph carries every held skill's bytes (READING.md: embed at export).
// Fine at any library that exists — the fixture is under 100 KB — and the
// move to lazy loading is invisible to the UI when it comes, but a snapshot
// past 4 MB is loaded before first paint and should be noticed, with the
// files that made it so named.
const SIZE_LIMIT = 4 * 1024 * 1024
const size = statSync(graphPath).size
if (size > SIZE_LIMIT) {
  const largest = snapshot.nodes
    .flatMap((n) => (n.kind === 'skill' ? n.files.map((f) => ({ path: `${n.id}/${f.path}`, bytes: f.bytes })) : []))
    .sort((a, b) => b.bytes - a.bytes)
    .slice(0, 5)
    .map((f) => `${f.path} (${Math.round(f.bytes / 1024)} KB)`)
  warnings.push({ code: 'snapshot-size', message: `graph.json is ${(size / 1024 / 1024).toFixed(1)} MB, over ${SIZE_LIMIT / 1024 / 1024} MB — largest: ${largest.join(', ')}` })
}

if (warnings.length === 0) {
  console.log(`check-graph: clean — ${snapshot.nodes.length} nodes, ${snapshot.edges.length} edges, 0 warnings`)
} else {
  console.log(`check-graph: ${warnings.length} warning(s)`)
  for (const w of warnings) console.log(`  ${w.code}: ${w.message}`)
}

if (strict && warnings.length > 0) process.exit(1)
