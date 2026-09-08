#!/usr/bin/env node
// Self-test: does check-library.test.mjs actually catch anything?
//
// A suite that has only ever passed has not been tested. This mutates
// check-library.mjs in specific ways, runs the suite against each mutant, and
// asserts the suite FAILS every time. A surviving mutation names a guard nobody
// is really checking.
//
// The reason it matters here is the shape of this command's worst failure. Every
// other script in this directory fails by refusing something it should have
// allowed, which is loud. `check` fails by printing "clean" — about a library it
// only half looked at, or about a library it never looked at because half the
// tool was missing. That output is indistinguishable from the good case at a
// terminal and in CI, and it is the one people will wire a pipeline to.
//
// The mutant is always a copy in a temp directory. try/finally survives an
// exception but not a signal, and a Ctrl-C at the wrong moment would otherwise
// leave the shipped script silently wrong.
//
//   node check-library.self-test.mjs

import { spawnSync } from 'node:child_process'
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const SRC = join(HERE, 'check-library.mjs')
const TEST = join(HERE, 'check-library.test.mjs')

// The suite sets its fixtures up by running init.mjs, which in turn spawns
// ledger.mjs from beside itself, and the command under test spawns both
// check-catalog.mjs and ledger.mjs. A sandbox missing any of the three would
// fail every mutant for the wrong reason — and a self-test that can only say
// "caught" proves nothing about itself.
const SIBLINGS = ['check-catalog.mjs', 'ledger.mjs', 'init.mjs']

// Each mutation is a defect a careless edit could plausibly introduce. `find`
// must appear exactly once, so a silent no-op cannot masquerade as a survivor.
//
// `expect: 'survives'` marks an inert control.
const MUTATIONS = [
	{
		name: 'a library that was never set up is reported as inconsistent',
		find: "\tif (!existsSync(join(library, 'catalog.json'))) {",
		replace: '\tif (false) {'
	},
	{
		name: 'a folder that is not a skill library is sent to init anyway',
		find: "\tif (!existsSync(join(library, 'skills'))) {",
		replace: '\tif (false) {'
	},
	{
		name: 'not-set-up collapses into the same exit code as inconsistent',
		find: "return { ok: false, code: 2, setUp: false, why: state.why, detail: state.detail }",
		replace: "return { ok: false, code: 1, setUp: false, why: state.why, detail: state.detail }"
	},
	{
		name: 'a half of the tool that could not run is reported as clean',
		find: '\tif (catalog.missing || ledger.missing) {',
		replace: '\tif (false) {'
	},
	{
		name: 'the ledger half is never run, and assumed clean',
		find: '\tconst ledger = checkLedger(library, passthrough)',
		replace: '\tconst ledger = { ok: true, errors: [] }'
	},
	{
		name: 'the catalog half is never run, and assumed clean',
		find: '\tconst catalog = checkCatalog(library)',
		replace: "\tconst catalog = { ok: true, output: '' }"
	},
	{
		name: '--install is swallowed instead of handed to ledger',
		find: "\t\tpassthrough.push('--install')",
		replace: '\t\tpassthrough.push()'
	},
	{
		name: '--install-root without --install is silently ignored',
		find: "\t} else if (argv.includes('--install-root')) {",
		replace: '\t} else if (false) {'
	},
	{
		name: 'INERT CONTROL — a comment reworded, nothing else',
		find: '// ── the two halves ──────────────────────────────────────────────────────────',
		replace: '// ── the two questions, each already answered elsewhere ──────────────────────',
		expect: 'survives'
	}
]

const dir = mkdtempSync(join(tmpdir(), 'check-library-self-'))
const sandboxSrc = join(dir, 'check-library.mjs')
const sandboxTest = join(dir, 'check-library.test.mjs')
cpSync(TEST, sandboxTest)
for (const s of SIBLINGS) cpSync(join(HERE, s), join(dir, s))
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
		const r = spawnSync(process.execPath, [sandboxTest], { encoding: 'utf8' })
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

const clean = spawnSync(process.execPath, [TEST], { encoding: 'utf8' })
console.log(`\nclean run: ${clean.status === 0 ? 'PASS' : 'FAIL'}`)
console.log(`self-test: ${asExpected} as expected, ${unexpected} not`)
if (unexpected || clean.status !== 0) {
	console.error('\nA surviving mutation means the suite is not checking what it appears to.\nAdd the assertion that would have caught it.')
	process.exit(1)
}
