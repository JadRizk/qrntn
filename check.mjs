#!/usr/bin/env node
//
// Every gate this tool has, run in one command.
//
//   node check.mjs            everything
//   node check.mjs --quick    skip the mutation self-tests (minutes → seconds)
//   node check.mjs --list     name the gates without running them
//
// SK-97. This is the half of `check.mjs` that belongs to the tool rather than to
// the library it was written inside. The other half stayed: the skills
// collection's own gates — catalog, spine cost, frontmatter spec, the plugin
// manifest, the backlog — are facts about a library, not about this code, and a
// stranger who installs this has none of them.
//
// Suites are DISCOVERED, never listed. A hand-maintained list of test files goes
// stale and the missing entry is invisible — the same failure this pipeline
// keeps finding in everything else.
//
// Exit 0 when every gate passes, 1 otherwise. Plain Node, no dependencies.

import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const COMMANDS = join(HERE, 'commands')

const args = process.argv.slice(2)
const QUICK = args.includes('--quick')
const LIST = args.includes('--list')

const files = readdirSync(COMMANDS).sort()
const tests = files.filter((f) => f.endsWith('.test.mjs'))
const selfTests = files.filter((f) => f.endsWith('.self-test.mjs'))

const gates = [
	...tests.map((f) => ({ name: `test · ${f}`, slow: false, run: () => node(join(COMMANDS, f)) })),
	...selfTests.map((f) => ({ name: `self-test · ${f}`, slow: true, run: () => node(join(COMMANDS, f)) })),
	{
		name: 'nexus · verify (typecheck, vitest, data integrity)',
		slow: true,
		run: () => {
			const dir = join(HERE, 'nexus')
			if (!existsSync(join(dir, 'node_modules'))) {
				// Not a pass and not a failure: the viewer's toolchain is not
				// installed. Saying so is the point — a gate that silently skips is
				// how a suite quietly stops covering something.
				return { status: 0, skipped: 'nexus/node_modules absent — run npm ci --prefix nexus' }
			}
			const r = spawnSync('npm', ['run', '--prefix', dir, 'verify'], { encoding: 'utf8' })
			return { status: r.status, out: (r.stdout ?? '') + (r.stderr ?? '') }
		}
	}
]

function node(file) {
	const r = spawnSync(process.execPath, [file], { encoding: 'utf8' })
	return { status: r.status, out: (r.stdout ?? '') + (r.stderr ?? '') }
}

if (LIST) {
	for (const g of gates) console.log(`  ${g.slow ? '(slow) ' : ''}${g.name}`)
	console.log(`\n  ${gates.length} gates · ${gates.filter((g) => g.slow).length} slow`)
	process.exit(0)
}

let passed = 0
let skipped = 0
const failures = []

for (const g of gates) {
	if (QUICK && g.slow) {
		skipped++
		continue
	}
	const r = g.run()
	if (r.skipped) {
		console.log(`  skip ${g.name}  — ${r.skipped}`)
		skipped++
		continue
	}
	if (r.status === 0) {
		const tail = (r.out ?? '').trim().split('\n').filter(Boolean).pop() ?? ''
		console.log(`  ok   ${g.name}  — ${tail.trim()}`)
		passed++
	} else {
		console.log(`  FAIL ${g.name}  — exit ${r.status}`)
		failures.push({ name: g.name, out: r.out })
	}
}

for (const f of failures) {
	console.log(`\n──── ${f.name} ────`)
	console.log((f.out ?? '').trim().split('\n').slice(-25).join('\n'))
}

const total = passed + failures.length
console.log(`\n  ${passed}/${total} gates passed${skipped ? ` · ${skipped} skipped` : ''}`)
process.exit(failures.length ? 1 : 0)
