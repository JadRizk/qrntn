#!/usr/bin/env node
// Self-test: does adopt.test.mjs actually catch anything?
//
// Same shape as promote.self-test.mjs, for the same reason: a suite that has
// only ever passed has not been tested. Each mutation is a defect a careless
// edit could introduce in the verb, or in the AUDIT.md contract it shares with
// promote, and the suite has to fail on every one. The failure mode this verb
// has is quieter than a crash — a row in the wrong section, a decision
// recorded over one already made — and quiet is the kind you believe.
//
//   node adopt.self-test.mjs

import { spawnSync } from 'node:child_process'
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const SRC = join(HERE, 'adopt.mjs')
const RECORD = join(HERE, 'audit-record.mjs')
const TEST = join(HERE, 'adopt.test.mjs')

// Everything the verb reaches for beside itself, and everything the suite
// imports. The sandbox is the commands/ directory as the tarball ships it.
const SIBLINGS = ['check-catalog.mjs', 'audit-skill.mjs', 'argv.mjs', 'tint.mjs', 'invoked-as.mjs']

// `find` must appear exactly once in its file. `file` names which: adopt.mjs
// unless it says audit-record.mjs. `expect: 'survives'` marks an inert control.
const MUTATIONS = [
	{
		// The contract's own blind spot: the template's menu begins with a
		// verdict, so a reader that forgets the menu takes an unfilled cell for
		// a decision already made — and this verb then refuses to make one.
		name: 'the verdict menu reads as ADOPT again',
		file: 'audit-record.mjs',
		find: '\tif (row && VERDICT_MENU.test(row[2])) return null\n',
		replace: ''
	},
	{
		name: 'a recorded verdict is overwritten',
		find: "\t\tif (verdict) {\n\t\t\trefuse(`AUDIT.md already records a verdict: ${verdict}`",
		replace: "\t\tif (false) {\n\t\t\trefuse(`AUDIT.md already records a verdict: ${verdict}`"
	},
	{
		name: 'undecided findings no longer refuse',
		file: 'audit-record.mjs',
		find: '\tif (undecided) problems.push(',
		replace: '\tif (false) problems.push('
	},
	{
		// The failure that turns a refusal into a decline: the row lands in
		// whichever section is last.
		name: 'the row is appended to the file instead of its section',
		find: '\t\tlines.splice(last + 1, 0, row)',
		replace: '\t\tlines.push(row)'
	},
	{
		name: 'a bar in a cell splits the row',
		find: "const cell = (text) => String(text).replace(/\\|/g, '¦').trim()",
		replace: 'const cell = (text) => String(text).trim()'
	},
	{
		// Text the artefact chose, on its way into a row a human reads and onto
		// a terminal. Both halves of the bound get a mutation, because a
		// filename long enough to be truncated never reaches the escaping and
		// one short enough never reaches the cap.
		name: 'an artefact-chosen filename is no longer bounded at all',
		find: "\t\t\tconst finding = why ?? (first ? `${first.code} ${fromArtefact(first.file)}` : null)",
		replace: '\t\t\tconst finding = why ?? (first ? `${first.code} ${first.file}` : null)'
	},
	{
		name: 'a control character in a filename is carried, not escaped',
		find: "\treturn cut.replace(/[^\\x20-\\x7e…]/g, (ch) => {",
		replace: '\treturn cut.replace(/[^\\s\\S]/g, (ch) => {'
	},
	{
		name: 'an over-long filename is no longer capped',
		find: '\tconst cut = flat.length > max ? `${flat.slice(0, max)}…` : flat',
		replace: '\tconst cut = flat'
	},
	{
		name: 'a second row for the same name is written',
		find: '\t\tif (readRejected(LIBRARY).has(name)) {',
		replace: '\t\tif (false) {'
	},
	{
		name: 'a symlinked inbox entry is followed and removed',
		find: '\tif (lstatSync(dir).isSymbolicLink()) {',
		replace: '\tif (false) {'
	},
	{
		name: 'the name is not checked before a path is built from it',
		find: 'if (!SAFE_NAME.test(name)) usageError(',
		replace: 'if (false) usageError('
	},
	{
		name: 'refuse with nothing blocking writes an empty finding',
		find: "\t\t\tif (!finding) {\n\t\t\t\trefuse('nothing blocks'",
		replace: "\t\t\tif (false) {\n\t\t\t\trefuse('nothing blocks'"
	},
	{
		name: '--dry-run writes anyway',
		find: '\t\tif (!refusals.length && !DRY) {\n\t\t\t// The row first',
		replace: '\t\tif (!refusals.length) {\n\t\t\t// The row first'
	},
	{
		name: 'INERT CONTROL — a comment reworded, nothing else',
		find: '// IT RECORDS. IT DOES NOT MOVE.',
		replace: '// It records. It does not move.',
		expect: 'survives'
	}
]

const dir = mkdtempSync(join(tmpdir(), 'adopt-self-'))
const sandboxSrc = join(dir, 'adopt.mjs')
const sandboxRecord = join(dir, 'audit-record.mjs')
const sandboxTest = join(dir, 'adopt.test.mjs')
cpSync(TEST, sandboxTest)
for (const s of SIBLINGS) cpSync(join(HERE, s), join(dir, s))
const original = readFileSync(SRC, 'utf8')
const originalRecord = readFileSync(RECORD, 'utf8')

let asExpected = 0
let unexpected = 0

try {
	for (const m of MUTATIONS) {
		const expectSurvival = m.expect === 'survives'
		const inRecord = m.file === 'audit-record.mjs'
		const source = inRecord ? originalRecord : original
		const occurrences = source.split(m.find).length - 1
		if (occurrences !== 1) {
			console.error(
				`  ERROR     "${m.name}" — anchor found ${occurrences} times, expected exactly 1.\n` +
					'            The source has drifted; update the mutation before trusting this run.'
			)
			unexpected++
			continue
		}
		writeFileSync(sandboxSrc, inRecord ? original : original.replace(m.find, m.replace))
		writeFileSync(sandboxRecord, inRecord ? originalRecord.replace(m.find, m.replace) : originalRecord)
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

if (readFileSync(SRC, 'utf8') !== original || readFileSync(RECORD, 'utf8') !== originalRecord) {
	console.error('  ERROR     a shipped script changed during this run — it should never be written.')
	unexpected++
}

const clean = spawnSync(process.execPath, [TEST], { encoding: 'utf8' })
console.log(`\nclean run: ${clean.status === 0 ? 'PASS' : 'FAIL'}`)
console.log(`self-test: ${asExpected} as expected, ${unexpected} not`)
if (unexpected || clean.status !== 0) {
	console.error('\nA surviving mutation means the suite is not checking what it appears to.\nAdd the assertion that would have caught it.')
	process.exit(1)
}
