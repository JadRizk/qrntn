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

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { GraphSnapshotSchema } from '../src/data/types.ts'
import { checkIntegrity } from '../src/data/integrity.ts'

const strict = process.argv.includes('--strict')
const graphPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'data', 'graph.json')

const raw = JSON.parse(readFileSync(graphPath, 'utf8'))
const snapshot = GraphSnapshotSchema.parse(raw)

const warnings = checkIntegrity(snapshot)

if (warnings.length === 0) {
  console.log(`check-graph: clean — ${snapshot.nodes.length} nodes, ${snapshot.edges.length} edges, 0 warnings`)
} else {
  console.log(`check-graph: ${warnings.length} warning(s)`)
  for (const w of warnings) console.log(`  ${w.code}: ${w.message}`)
}

if (strict && warnings.length > 0) process.exit(1)
