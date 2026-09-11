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

import { cpSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { mutate } from './mutate.mjs'

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
		// a terminal. Bounded once, in scan(), so the row and --json say the
		// same thing; the mutation below that strips it there is what covers
		// the row. Both halves of the bound get their own, because a filename
		// long enough to be truncated never reaches the escaping and one short
		// enough never reaches the cap.
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
		// The one place the bound is applied. Removing it un-bounds the row,
		// the terminal and --json together, and adopt.test.mjs asserts all
		// three.
		name: 'an artefact-chosen filename is no longer bounded at all',
		find: '\t\tblocking: blocking.map((f) => ({ code: f.code, file: fromArtefact(f.file) }))',
		replace: '\t\tblocking: blocking.map((f) => ({ code: f.code, file: f.file }))'
	},
	{
		// The removal is reported, not thrown. Rethrowing turns a recorded
		// decision into a stack trace and empty --json.
		name: 'a removal that fails is thrown rather than reported',
		find: '\t\t\t} catch (e) {\n\t\t\t\tremoved = false',
		replace: '\t\t\t} catch (e) {\n\t\t\t\tthrow e\n\t\t\t\tremoved = false'
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

await mutate({
	name: 'adopt',
	test: TEST,
	sources: { 'adopt.mjs': SRC, 'audit-record.mjs': RECORD },
	// The suite and every sibling it drives, beside a mutant of one of the two
	// sources. Each mutation gets its own copy of this layout.
	build: (dir, files) => {
		cpSync(TEST, join(dir, 'adopt.test.mjs'))
		for (const s of SIBLINGS) cpSync(join(HERE, s), join(dir, s))
		for (const [file, text] of Object.entries(files)) writeFileSync(join(dir, file), text)
		return join(dir, 'adopt.test.mjs')
	},
	mutations: MUTATIONS
})
