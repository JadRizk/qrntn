#!/usr/bin/env node
// Self-test: does intake.test.mjs actually catch anything?
//
// A suite that has only ever passed has not been tested. This mutates intake.mjs
// in specific ways, runs the suite against each mutant, and asserts the suite
// FAILS every time. A surviving mutation names a guard nobody is really checking.
//
// It matters especially here. This script's failure mode is not a crash — it is
// letting something through while printing nothing, which reads exactly like
// success. A gate that has quietly stopped refusing is worse than no gate,
// because it is the one you trust.
//
// The mutant is always a copy in a temp directory. try/finally survives an
// exception but not a signal, and a Ctrl-C at the wrong moment would otherwise
// leave the shipped gate silently wrong.
//
//   node self-test.mjs

import { spawnSync } from 'node:child_process'
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const SRC = join(HERE, 'intake.mjs')
const TEST = join(HERE, 'intake.test.mjs')

// Each mutation is a defect a careless edit could plausibly introduce. `find`
// must appear exactly once, so a silent no-op cannot masquerade as a survivor.
//
// `expect: 'survives'` marks an inert control: a harness that can only ever say
// "caught" proves nothing about itself.
const MUTATIONS = [
	{
		name: 'plain http sources accepted',
		find: "if (src.startsWith('http://')) refuse(",
		replace: 'if (false) refuse('
	},
	{
		name: 'submodules no longer refused',
		find: "if (existsSync(join(work, '.gitmodules'))) {",
		replace: 'if (false) {'
	},
	{
		name: 'symlinks leaving the artefact no longer refused',
		find: 'if (escaping.length) {',
		replace: 'if (false) {'
	},
	{
		name: 'a second fetch merges onto the first',
		find: 'if (existsSync(dest)) refuse(',
		replace: 'if (false) refuse('
	},
	{
		name: 'any skill name accepted, including one escaping the inbox',
		find: 'if (!SAFE_NAME.test(name)) refuse(',
		replace: 'if (false) refuse('
	},
	{
		name: 'subpath traversal accepted',
		find: "if (subpath && (subpath.includes('..') || subpath.startsWith('/'))) refuse(",
		replace: 'if (false) refuse('
	},
	{
		name: 'more than one source accepted at once',
		find: 'if (positional.length > 1) refuse(',
		replace: 'if (false) refuse('
	},
	{
		name: 'INERT CONTROL — a comment reworded, nothing else',
		find: '// ── record ───────────────────────────────────────────────────────────────────',
		replace: '// ── the origin record ────────────────────────────────────────────────────────',
		expect: 'survives'
	}
]

const dir = mkdtempSync(join(tmpdir(), 'intake-self-'))
const sandboxSrc = join(dir, 'intake.mjs')
const sandboxTest = join(dir, 'intake.test.mjs')
cpSync(TEST, sandboxTest)
const original = readFileSync(SRC, 'utf8')

let asExpected = 0
let unexpected = 0

try {
	for (const m of MUTATIONS) {
		const expectSurvival = m.expect === 'survives'
		const occurrences = original.split(m.find).length - 1
		if (occurrences !== 1) {
			console.error(
				`  ERROR     "${m.name}" — anchor found ${occurrences} times, expected exactly 1.\n` +
					'            The source has drifted; update the mutation before trusting this run.'
			)
			unexpected++
			continue
		}
		writeFileSync(sandboxSrc, original.replace(m.find, m.replace))
		const r = spawnSync('node', [sandboxTest], { encoding: 'utf8' })
		const survived = r.status === 0
		if (survived === expectSurvival) {
			asExpected++
			const failed = (r.stdout.match(/(\d+) failed/) ?? [])[1] ?? '0'
			console.log(`  ${expectSurvival ? 'survived  ' : 'caught    '}${m.name}${expectSurvival ? '' : `  (${failed} assertion(s))`}`)
		} else {
			unexpected++
			console.error(
				expectSurvival
					? `  BROKE     ${m.name} — an inert change failed the suite, so the suite tests something it should not.`
					: `  SURVIVED  ${m.name}`
			)
		}
	}
} finally {
	rmSync(dir, { recursive: true, force: true })
}

if (readFileSync(SRC, 'utf8') !== original) {
	console.error('  ERROR     the shipped script changed during this run — it should never be written.')
	unexpected++
}

const clean = spawnSync('node', [TEST], { encoding: 'utf8' })
console.log(`\nclean run: ${clean.status === 0 ? 'PASS' : 'FAIL'}`)
console.log(`self-test: ${asExpected} as expected, ${unexpected} not`)
if (unexpected || clean.status !== 0) {
	console.error('\nA surviving mutation means the suite is not checking what it appears to.\nAdd the assertion that would have caught it.')
	process.exit(1)
}
