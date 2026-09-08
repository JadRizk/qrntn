#!/usr/bin/env node
// Self-test: does pratiq.test.mjs actually catch anything?
//
// A suite that has only ever passed has not been tested. This mutates
// bin/pratiq.mjs in specific ways, runs the suite against each mutant, and
// asserts the suite FAILS every time.
//
// The sandbox is larger here than for the other self-tests, and has to be: the
// suite resolves the repository from its own location and reads package.json
// and every command out of it, because two of its gates are about what the
// tarball will contain rather than about behaviour. So the sandbox is a whole
// miniature tree — bin/, commands/, package.json — and the mutant is the only
// thing in it that differs from what ships.
//
//   node pratiq.self-test.mjs

import { spawnSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = join(HERE, '..')
const SRC = join(REPO, 'bin', 'pratiq.mjs')
const TEST = join(HERE, 'pratiq.test.mjs')

const MUTATIONS = [
	{
		name: 'a verb it does not have is run anyway',
		find: 'if (!file) {',
		replace: 'if (false) {'
	},
	{
		name: 'a verb whose script is missing is spawned regardless',
		find: 'if (!existsSync(path)) {',
		replace: 'if (false) {'
	},
	{
		name: 'every exit code is reported as success',
		find: 'process.exit(r.status)',
		replace: 'process.exit(0)'
	},
	{
		name: 'arguments are dropped instead of passed through',
		find: 'const r = spawnSync(process.execPath, [path, ...rest], {',
		replace: 'const r = spawnSync(process.execPath, [path], {'
	},
	{
		// The command then cannot know which verb reached it, and every usage
		// line falls back to naming its own file — which is what they all did
		// before, and reads as perfectly normal output.
		name: 'the verb is not passed to the command it dispatches',
		find: '\tenv: { ...process.env, [VERB_ENV]: verb }',
		replace: '\tenv: { ...process.env }'
	},
	{
		// Drift between the two copies of the name. Nothing throws: the command
		// reads a variable the dispatcher never set, and quietly names its file.
		name: 'the env var name drifts from the one commands/ reads',
		find: "const VERB_ENV = 'PRATIQ_VERB'",
		replace: "const VERB_ENV = 'PRATIQ_COMMAND'"
	},
	{
		name: 'getting it wrong and asking directly answer the same way',
		find: '\tprocess.exit(verb ? 0 : 2)',
		replace: '\tprocess.exit(0)'
	},
	{
		name: '--version is refused as a verb again',
		find: "if (verb === '--version' || verb === '-v') {",
		replace: 'if (false) {'
	},
	{
		name: 'the version is invented instead of read from the manifest',
		find: "declared = JSON.parse(readFileSync(manifest, 'utf8')).version ?? null",
		replace: "declared = '0.0.0'"
	},
	{
		name: 'a package with no manifest reports a version anyway',
		find: 'if (!existsSync(manifest)) {',
		replace: 'if (false) {'
	},
	{
		name: 'INERT CONTROL — a comment reworded, nothing else',
		find: '// Plain Node, no dependencies, in keeping with the rest of the tool.',
		replace: '// Plain Node, with no dependencies, as everything else here is.',
		expect: 'survives'
	}
]

const original = readFileSync(SRC, 'utf8')

const dir = mkdtempSync(join(tmpdir(), 'pratiq-bin-self-'))
mkdirSync(join(dir, 'bin'), { recursive: true })
mkdirSync(join(dir, 'commands'), { recursive: true })
cpSync(join(REPO, 'package.json'), join(dir, 'package.json'))
for (const f of readdirSync(join(REPO, 'commands'))) {
	if (f.endsWith('.mjs') || f.endsWith('.md') || f.endsWith('.json')) cpSync(join(REPO, 'commands', f), join(dir, 'commands', f))
}
cpSync(TEST, join(dir, 'commands', 'pratiq.test.mjs'))
const sandboxSrc = join(dir, 'bin', 'pratiq.mjs')
const sandboxTest = join(dir, 'commands', 'pratiq.test.mjs')

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
