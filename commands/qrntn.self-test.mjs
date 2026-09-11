#!/usr/bin/env node
// Self-test: does qrntn.test.mjs actually catch anything?
//
// A suite that has only ever passed has not been tested. This mutates
// bin/qrntn.mjs in specific ways, runs the suite against each mutant, and
// asserts the suite FAILS every time.
//
// The sandbox is larger here than for the other self-tests, and has to be: the
// suite resolves the repository from its own location and reads package.json
// and every command out of it, because two of its gates are about what the
// tarball will contain rather than about behaviour. So the sandbox is a whole
// miniature tree — bin/, commands/, package.json — and the mutant is the only
// thing in it that differs from what ships.
//
//   node qrntn.self-test.mjs

import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'


import { mutate } from './mutate.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = join(HERE, '..')
const SRC = join(REPO, 'bin', 'qrntn.mjs')
const TEST = join(HERE, 'qrntn.test.mjs')

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
		find: '\tprocess.exit(code)',
		replace: '\tprocess.exit(0)'
	},
	{
		name: 'arguments are dropped instead of passed through',
		find: 'const child = spawn(process.execPath, [path, ...rest], {',
		replace: 'const child = spawn(process.execPath, [path], {'
	},
	{
		// The verb decides what an interrupt means and the dispatcher carries
		// its answer out. Without forwarding, a verb that handles a signal
		// never hears it and the dispatcher blocks; without the handler at all,
		// the dispatcher dies of the signal and the verb's exit code is lost.
		// Both were real, in that order, and `view` is the verb that showed it.
		name: 'signals are not forwarded to the verb',
		find: '\t\t\tchild.kill(signal)',
		replace: '\t\t\tvoid signal',
		// Only askable where the viewer bundle exists: `view` is the one verb
		// that runs until interrupted, so it is the only one whose exit code
		// can prove a signal reached it, and without its bundle the suite
		// skips those assertions. Declared rather than left to survive, which
		// is what it did on CI's first run of this file — a mutation reported
		// as uncaught when the truth was that nothing had asked.
		needsViewBundle: true
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
		find: "const VERB_ENV = 'QRNTN_VERB'",
		replace: "const VERB_ENV = 'QRNTN_COMMAND'"
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

// The viewer bundle, when the tree has one. The suite's signal assertions
// drive `view`, the only verb that runs until interrupted, and without the
// bundle they are skipped — so the mutation that needs them is skipped here
// too, by name, rather than left to survive. Declared once, up front.
const hasViewBundle = existsSync(join(REPO, 'view', 'index.html'))
for (const m of MUTATIONS) {
	if (m.needsViewBundle && !hasViewBundle) m.skip = 'no viewer bundle in this tree, so the suite cannot ask'
}

await mutate({
	name: 'qrntn-bin',
	test: TEST,
	sources: { 'bin/qrntn.mjs': SRC },
	// A whole miniature tree — bin/, commands/, package.json — because two of
	// the suite's gates are about what the tarball will contain, not about
	// behaviour, and it reads the manifest and every command out of it.
	build: (dir, files) => {
		mkdirSync(join(dir, 'bin'), { recursive: true })
		mkdirSync(join(dir, 'commands'), { recursive: true })
		cpSync(join(REPO, 'package.json'), join(dir, 'package.json'))
		for (const f of readdirSync(join(REPO, 'commands'))) {
			if (f.endsWith('.mjs') || f.endsWith('.md') || f.endsWith('.json')) cpSync(join(REPO, 'commands', f), join(dir, 'commands', f))
		}
		cpSync(TEST, join(dir, 'commands', 'qrntn.test.mjs'))
		if (hasViewBundle) cpSync(join(REPO, 'view'), join(dir, 'view'), { recursive: true })
		writeFileSync(join(dir, 'bin', 'qrntn.mjs'), files['bin/qrntn.mjs'])
		return join(dir, 'commands', 'qrntn.test.mjs')
	},
	mutations: MUTATIONS
})
