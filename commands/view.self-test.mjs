#!/usr/bin/env node
// Self-test: does view.test.mjs actually catch anything?
//
// A suite that has only ever passed has not been tested. This mutates view.mjs
// in specific ways, runs the suite against each mutant, and asserts the suite
// FAILS every time. A mutation that survives names a check nobody is making.
//
// It matters here for a reason the other verbs do not have. `view` is the only
// one that opens a socket and serves files off the disk, so three of its rules
// are the kind that fail silently and in the reader's favour: the path that
// must not leave the bundle, the fixture that must never be answered, and the
// method filter. A server that serves too much looks exactly like a server
// that works. The suite asserts all three; without this, nothing asserts the
// suite would notice if they were deleted.
//
// The fourth is the exit code. `view` runs until interrupted, and Ctrl-C is
// how it is meant to stop — 0, not a signal death — which is the contract the
// README freezes and the one that was already broken once, in the dispatcher.
//
//   node view.self-test.mjs

import { spawnSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const SRC = join(HERE, 'view.mjs')
const TEST = join(HERE, 'view.test.mjs')

// The suite builds its own sandboxes out of these, so they travel with it.
const SIBLINGS = ['tint.mjs', 'invoked-as.mjs', 'argv.mjs', 'init.mjs', 'check-library.mjs', 'check-catalog.mjs', 'ledger.mjs', 'validate-record.mjs', 'record.schema.json']

// `find` must appear exactly once in view.mjs, so a silent no-op cannot
// masquerade as a surviving mutation. `expect: 'survives'` marks an inert
// control: a harness that can only report "caught" proves nothing about
// itself.
const MUTATIONS = [
	{
		// The fixture is a 49-node snapshot of the library this was extracted
		// from. It does not ship, and if it ever did it must still never be
		// answered — SHIPPING.md §8: it must never ship as truth.
		name: 'anything under /data/ is served, so a fixture could answer',
		find: "\tif (pathname.startsWith('/data/')) return notFound()",
		replace: '\tif (false) return notFound()'
	},
	{
		name: 'the served graph is no longer the one exported for this library',
		find: "\tif (pathname === '/data/graph.json') return send(200, graphBytes, CONTENT_TYPES['.json'])",
		replace: "\tif (pathname === '/data/graph.json' && false) return send(200, graphBytes, CONTENT_TYPES['.json'])"
	},
	{
		// UNREACHABLE ON THIS PLATFORM, AND RECORDED RATHER THAN QUIETLY
		// DROPPED. Removing the prefix check does not fail the suite, and the
		// first version of this file expected it to. The reason is that the
		// normalisation one line earlier has already done the work: on a path
		// beginning with `/`, posix.normalize drops every `..` that would
		// climb past the root, so nothing arrives at the check to be caught.
		// Verified against the traversal spellings the suite sends and several
		// it does not.
		//
		// So this entry survives on purpose. It is not an inert control — it
		// removes a real check — but the check is belt to the normalisation's
		// braces, kept for the platform where `\` separates and for whoever
		// changes the line above. An entry that claimed to be caught here
		// would be the suite taking credit for an assertion nobody wrote.
		name: 'REDUNDANT ON POSIX — the bundle-root prefix check removed',
		find: '\tif (!file.startsWith(VIEW + sep)) return notFound()',
		replace: '\tif (false) return notFound()',
		expect: 'survives'
	},
	{
		// `..` is resolved here, before the check above sees the path. Dropping
		// the normalisation leaves the check looking at a string that has not
		// been collapsed yet.
		name: 'the path is not normalised before it is checked',
		find: '\t\tpathname = posix.normalize(decodeURIComponent(raw.split(/[?#]/)[0]))',
		replace: '\t\tpathname = decodeURIComponent(raw.split(/[?#]/)[0])'
	},
	{
		name: 'any method is answered, not only GET and HEAD',
		find: "\tif (req.method !== 'GET' && req.method !== 'HEAD') {",
		replace: '\tif (false) {'
	},
	{
		name: 'a directory is served as though it were a file',
		find: '\tif (!st.isFile()) return notFound()',
		replace: '\tif (false) return notFound()'
	},
	{
		// The contract the README freezes, broken once already one level up.
		name: 'Ctrl-C is a signal death again rather than a clean stop',
		find: '\tprocess.exit(0)\n}\nprocess.on(\'SIGINT\', stop)',
		replace: "\tprocess.exit(3)\n}\nprocess.on('SIGINT', stop)"
	},
	{
		name: 'the exported graph is left behind on the disk',
		find: 'const cleanup = () => rmSync(scratch, { recursive: true, force: true })',
		replace: 'const cleanup = () => {}'
	},
	{
		// A missing bundle is a packaging fault and says so. Without this the
		// verb runs on to spawn a file that is not there.
		name: 'a missing viewer bundle is not noticed',
		find: '\tif (!existsSync(required)) {',
		replace: '\tif (false) {'
	},
	{
		// The exporter has already said what is wrong, in the project's own
		// refusal voice and with the right code. Swallowing it leaves the
		// reader with a message about the wrong thing.
		name: 'the exporter\'s own refusal is replaced by this file\'s',
		find: '\t\tif (/^refused:/m.test(err)) {',
		replace: '\t\tif (false) {'
	},
	{
		name: 'a port that is not a number is accepted',
		find: "\t\tif (value === undefined || value.startsWith('--') || !/^\\d{1,5}$/.test(value) || Number(value) > 65535) {",
		replace: '\t\tif (false) {'
	},
	{
		name: 'a port already in use is not reported as such',
		find: "\tif (e.code === 'EADDRINUSE') {",
		replace: '\tif (false) {'
	},
	{
		name: 'INERT CONTROL — a comment reworded, nothing else',
		find: '// LOCAL, ONLY. Bound to 127.0.0.1, no browser opened, nothing leaves the',
		replace: '// LOCAL ONLY. Bound to 127.0.0.1, no browser is opened, nothing leaves the',
		expect: 'survives'
	}
]

const dir = mkdtempSync(join(tmpdir(), 'view-self-'))
mkdirSync(join(dir, 'commands'), { recursive: true })
const sandboxSrc = join(dir, 'commands', 'view.mjs')
const sandboxTest = join(dir, 'commands', 'view.test.mjs')
cpSync(TEST, sandboxTest)
for (const s of SIBLINGS) cpSync(join(HERE, s), join(dir, 'commands', s))
// The suite's second half drives the REAL bundle, and finds it beside
// commands/ — the same place the shipped layout puts it. Copied when the tree
// has one so the mutant is exercised against it too; when it has none the
// suite says so and runs its stub half only, which is still most of it.
const REAL = join(HERE, '..', 'view')
try {
	cpSync(REAL, join(dir, 'view'), { recursive: true })
} catch {
	// No build in this tree. The suite reports that itself.
}
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
