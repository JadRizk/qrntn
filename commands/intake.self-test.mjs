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

import { cpSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'


import { mutate } from './mutate.mjs'

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
		// The defect this shipped with: the url went to git whole, /tree/main/foo
		// and all, and the fetch failed for a reason that named the url rather
		// than the form. A no-op split is the exact shape of the regression.
		name: 'a pasted browser url is no longer split',
		find: 'const web = splitWebUrl(src)',
		replace: 'const web = null'
	},
	{
		// Silently preferring one half of what the caller typed. The artefact
		// still lands, from a ref or a subpath nobody named — which is the
		// failure mode that prints nothing and reads as success.
		name: 'a flag disagreeing with the url is resolved instead of refused',
		find: `refuse(\`\${which} says "\${fromFlag}" and the url says "\${fromUrl}" — pass one or the other, not both\`)`,
		replace: 'void 0'
	},
	{
		// The url's own subpath skipping the containment check, while a subpath
		// typed as a flag still gets it.
		name: 'a subpath lifted out of a url is trusted',
		find: "const subpath = reconcile('--subpath', flag('--subpath'), web?.subpath ?? null)",
		replace: "const subpath = flag('--subpath')"
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

await mutate({
	name: 'intake',
	test: TEST,
	sources: { 'intake.mjs': SRC },
	build: (dir, files) => {
		cpSync(TEST, join(dir, 'intake.test.mjs'))
		writeFileSync(join(dir, 'intake.mjs'), files['intake.mjs'])
		return join(dir, 'intake.test.mjs')
	},
	mutations: MUTATIONS
})
