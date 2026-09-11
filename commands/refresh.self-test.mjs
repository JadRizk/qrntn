#!/usr/bin/env node
// Self-test: does refresh.test.mjs actually catch anything?
//
// Same reasoning as this repo's other SK-3x self-tests. This script's whole
// job is telling apart "upstream genuinely changed" from "you changed it
// yourself" and "nothing changed" — a mutation that quietly collapses that
// distinction, or that writes into skills/ instead of only reporting, is
// the failure mode that matters most here.
//
//   node scripts/refresh.self-test.mjs

import { cpSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'


import { mutate } from './mutate.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const SRC = join(HERE, 'refresh.mjs')
const TEST = join(HERE, 'refresh.test.mjs')

const MUTATIONS = [
	{
		name: 'a file the pinned inventory no longer finds upstream is not reported as removed',
		find: 'if (!upstreamFiles.has(path)) removedUpstream.push(path)',
		replace: 'if (false) removedUpstream.push(path)'
	},
	{
		name: 'a hash mismatch is no longer detected as a changed file',
		find: 'else if (upstreamFiles.get(path) !== hash) changed.push(path)',
		replace: 'else if (false) changed.push(path)'
	},
	{
		name: 'every changed file reads as genuine divergence, even ones you adapted yourself',
		find: 'const genuineDivergence = changed.filter((p) => !adapted.has(p))',
		replace: 'const genuineDivergence = changed'
	},
	{
		name: 'nothing is ever reported as inconclusive, even a file you demonstrably adapted',
		find: 'const inconclusive = changed.filter((p) => adapted.has(p))',
		replace: 'const inconclusive = []'
	},
	{
		name: 'the pinned-vs-upstream commit comparison always reports unmoved',
		find: 'const moved = prov.commit ? prov.commit !== head : null',
		replace: 'const moved = prov.commit ? false : null'
	},
	{
		name: 'a failed clone is no longer reported as fetch-failed — a stack trace or a false status instead',
		find: 'if (clone.status !== 0) {',
		replace: 'if (false) {'
	},
	{
		name: 'a skill with no provenance record silently proceeds instead of being reported',
		find: "if (!prov?.source) return { name, status: 'no-provenance' }",
		replace: "if (false) return { name, status: 'no-provenance' }"
	},
	{
		name: 'a moved or renamed subpath is silently ignored instead of reported',
		find: "if (!existsSync(subRoot)) return { name, status: 'subpath-missing', subpath: prov.subpath, upstreamHead: head, movedCommit: moved }",
		replace: 'if (false) return { name, status: \'subpath-missing\' }'
	},
	{
		name: 'a fetch failure no longer makes the process exit non-zero',
		find: "const hardFailures = results.filter((r) => r.status === 'fetch-failed')",
		replace: 'const hardFailures = []'
	},
	{
		name: 'a result with no upstreamHead (a fetch failure) still gets a ledger write attempt',
		find: 'for (const r of results) if (r.upstreamHead) recordResult(r.name, r)',
		replace: 'for (const r of results) recordResult(r.name, r)'
	},
	{
		name: 'the ledger is written even under --dry-run and --json',
		find: 'if (!JSON_OUT && !DRY) {',
		replace: 'if (true) {'
	},
	{
		name: 'the write drops the rest of origin, keeping only upstreamHead',
		find: 'origin: { ...current.origin, upstreamHead: result.upstreamHead ?? current.origin.upstreamHead },',
		replace: 'origin: { upstreamHead: result.upstreamHead ?? current.origin.upstreamHead },'
	},
	{
		name: 'INERT CONTROL — a comment reworded, nothing else',
		find: '// ---------------------------------------------------------------- provenance',
		replace: '// ---------------------------------------------------------------- provenance record',
		expect: 'survives'
	}
]

await mutate({
	name: 'refresh',
	test: TEST,
	sources: { 'refresh.mjs': SRC },
	build: (dir, files) => {
		cpSync(TEST, join(dir, 'refresh.test.mjs'))
		cpSync(join(HERE, 'ledger.mjs'), join(dir, 'ledger.mjs'))
		writeFileSync(join(dir, 'refresh.mjs'), files['refresh.mjs'])
		return join(dir, 'refresh.test.mjs')
	},
	mutations: MUTATIONS
})
