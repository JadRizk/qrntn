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
		// `view` ships a bundle that is built, not committed, and the smoke gate
		// below is the only thing that drives it. Built here first, so that a
		// full run with the viewer's toolchain installed exercises the same
		// tarball a release publishes. Without the toolchain the bundle is
		// absent, the smoke gate asserts the verb says so, and this gate says
		// why rather than passing quietly — the same rule as the two nexus
		// gates at the end of this list.
		name: 'view · build the viewer bundle the tarball ships',
		slow: true,
		run: () => {
			const dir = join(HERE, 'nexus')
			if (!existsSync(join(dir, 'node_modules'))) {
				return { status: 0, skipped: 'nexus/node_modules absent — run npm ci --prefix nexus; the smoke gate will assert view refuses' }
			}
			const r = spawnSync(process.execPath, [join(dir, 'scripts', 'build-view.mjs')], { encoding: 'utf8' })
			return { status: r.status, out: (r.stdout ?? '') + (r.stderr ?? '') }
		}
	},
	{
		// SK-97 §7. The only gate that reduces the tree to what `npm pack`
		// produces and runs the tool from there. Everything above it runs out of
		// the checkout, where every file exists whether or not package.json says
		// it ships — so a script missing from the `files` allowlist passes every
		// other gate in this list and is broken for everyone who installs it.
		//
		// Slow because it packs and installs; skipped by --quick, and run by
		// prepublishOnly, which is the moment it exists for.
		name: 'smoke · the tarball installs and every verb runs from it',
		slow: true,
		run: () => node(join(HERE, 'smoke.mjs'))
	},
	{
		// SK-94. record.schema.json is generated from packages/record/schema.ts and
		// committed, so the zero-dependency commands can validate without a
		// toolchain. A generated file that is committed and not checked is a file
		// that drifts — the same contract the plugin manifest has in the library.
		name: 'record · the compiled schema matches its zod source',
		slow: true,
		run: () => {
			const dir = join(HERE, 'nexus')
			if (!existsSync(join(dir, 'node_modules'))) {
				return { status: 0, skipped: 'nexus/node_modules absent — run npm ci --prefix nexus' }
			}
			const r = spawnSync('npx', ['--prefix', dir, 'tsx', join(dir, 'scripts', 'build-record-schema.mjs'), '--check'], {
				encoding: 'utf8',
			})
			return { status: r.status, out: (r.stdout ?? '') + (r.stderr ?? '') }
		},
	},
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
	// `signal` and `error` are carried, not dropped. spawnSync reports a null
	// status for two entirely different events — the child was killed, or it
	// never started — and keeping only `status` throws away which.
	return { status: r.status, signal: r.signal, error: r.error, out: (r.stdout ?? '') + (r.stderr ?? '') }
}

/**
 * Why a gate did not pass, in words.
 *
 * `exit null` was the previous answer to three different situations, and the
 * distinction is not cosmetic: an exit code is the GATE'S OWN ANSWER about the
 * code under test, a signal is the MACHINE interrupting it, and a spawn failure
 * is neither. Only the first is a finding. Reading `exit null` and going to
 * look for a bug in the suite is wasted work — which is exactly what happened:
 * audit-skill.self-test.mjs, an 8m47s gate, was reported this way after being
 * killed under memory pressure, and passed cleanly on its own.
 *
 * Gates that build their own result object may carry neither field; undefined
 * falls through to the exit-code branch, which is what they always used.
 */
function whyFailed({ status, signal, error }) {
	if (error) return `could not run — ${error.code ?? error.message}`
	if (signal) return `killed by ${signal} — the process was terminated, so this is not a gate failure; re-run it alone`
	if (status === null) return 'ended without an exit code'
	return `exit ${status}`
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
		console.log(`  FAIL ${g.name}  — ${whyFailed(r)}`)
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
