#!/usr/bin/env node
// Self-test: does init.test.mjs actually catch anything?
//
// A suite that has only ever passed has not been tested. This mutates init.mjs
// in specific ways, runs the suite against each mutant, and asserts the suite
// FAILS every time. A surviving mutation names a guard nobody is really checking.
//
// It matters here for a reason particular to this verb. init is the first thing
// a stranger runs, on a library this tool has never touched, and its failure
// mode is not a crash — it is writing something plausible. A catalog that files
// the wrong names, or overwrites an arrangement someone made by hand, or invents
// a field nobody asked for, all look exactly like success at the terminal. The
// suite is the only thing standing between "it printed created" and "it was
// right", so the suite has to be shown to bite.
//
// The mutant is always a copy in a temp directory. try/finally survives an
// exception but not a signal, and a Ctrl-C at the wrong moment would otherwise
// leave the shipped script silently wrong.
//
//   node init.self-test.mjs

import { spawnSync } from 'node:child_process'
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const SRC = join(HERE, 'init.mjs')
const TEST = join(HERE, 'init.test.mjs')

// The sandbox needs both siblings the suite reaches for: init.test.mjs resolves
// check-catalog.mjs from its own directory, and init.mjs spawns ledger.mjs from
// beside itself. A sandbox missing either would fail every mutant for the wrong
// reason, and a self-test that always reports "caught" proves nothing.
const SIBLINGS = ['check-catalog.mjs', 'ledger.mjs']

// Each mutation is a defect a careless edit could plausibly introduce. `find`
// must appear exactly once, so a silent no-op cannot masquerade as a survivor.
//
// `expect: 'survives'` marks an inert control: a harness that can only ever say
// "caught" proves nothing about itself.
const MUTATIONS = [
	{
		name: 'an existing catalog is overwritten with the default arrangement',
		find: 'if (!catalogExisted) {',
		replace: 'if (true) {'
	},
	{
		name: 'a library with no skills/ is set up anyway',
		find: 'if (!existsSync(skillsDir)) {',
		replace: 'if (false) {'
	},
	{
		name: 'a failed ledger backfill is reported as success',
		find: 'if (!backfill.ok) {',
		replace: 'if (false) {'
	},
	{
		name: 'a vault root is invented to fill the field',
		find: '\t\tcategories: [',
		replace: "\t\tvault: { root: '/vault' },\n\t\tcategories: ["
	},
	{
		name: '--library is ignored, so it acts on the working directory',
		find: "\tconst i = argv.indexOf('--library')",
		replace: '\tconst i = -1'
	},
	{
		name: 'any directory under skills/ is filed, SKILL.md or not',
		find: "\t\t.filter((name) => existsSync(join(root, name, 'SKILL.md')))",
		replace: '\t\t.filter(() => true)'
	},
	{
		name: 'a refusal prints as success and exits 0',
		find: 'if (!result.ok) {',
		replace: 'if (false) {'
	},
	{
		name: 'INERT CONTROL — a comment reworded, nothing else',
		find: '// Idempotent, and re-running is a normal thing to do rather than a mistake',
		replace: '// Idempotent, and running it again is ordinary rather than a mistake',
		expect: 'survives'
	}
]

const dir = mkdtempSync(join(tmpdir(), 'init-self-'))
const sandboxSrc = join(dir, 'init.mjs')
const sandboxTest = join(dir, 'init.test.mjs')
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
		// process.execPath, never the bare string 'node' — the interpreter running
		// this file is the one the mutant must run under, and PATH is not
		// guaranteed to resolve to it.
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
