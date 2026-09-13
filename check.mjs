#!/usr/bin/env node
//
// Every gate this tool has, run in one command.
//
//   node check.mjs            everything
//   node check.mjs --quick    skip the mutation self-tests (minutes → seconds)
//   node check.mjs --list     name the gates without running them
//   node check.mjs --jobs N   how many processes' worth of gates run at once
//                             (QRNTN_JOBS does the same; 1 is serial)
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
// GATES RUN AT ONCE, UNDER ONE BUDGET. This file ran its gates one after
// another, and a full run took eleven minutes at 1.4 cores on an eleven-core
// machine. Two thirds of that was not the gates' own work. Measured on
// 2026-09-13, in the order the causes were found:
//
//   - `/usr/bin/git` on a Mac with Xcode is a shim, and each call through it
//     is slow, serialised system-wide, and degrades every process creation on
//     the machine for a second or two after. Eight copies of refresh's suite
//     took 52s that way and 4.8s with the real git first on PATH. hostPath()
//     in commands/mutate.mjs is the fix, applied here to every gate.
//   - The audit scanner's suite spawned `node` by name, a hundred times a run,
//     and the name is resolved by one failed execve per PATH entry ahead of
//     the right one — 3× the cost of the path under load. The suite spawns
//     by path now.
//   - Two suites bounded a hang at twenty seconds, and the mutation that
//     hangs paid it on every run. Five seconds is still fifteen times what
//     the non-hanging path takes.
//
// With those fixed, the gates are mostly independent work that happened to be
// queued. So they run through a pool. The budget is a number of PROCESSES
// rather than of gates, because they are not alike: a suite is one process
// and a self-test is a harness driving up to QRNTN_JOBS of them, and treating
// those as equal would run eight self-tests at eight workers each and call
// it parallelism. Each self-test is told half the budget and weighs that
// much; a suite weighs one. The budget is the core count: with the shim out
// of the way, copies of the scanner's suite kept gaining throughput up to
// twelve at once on eleven cores (0.55 runs/s at four, 0.86 at eight, 1.04
// at twelve, 1.10 at sixteen), so two self-tests at half the cores each sit
// where the curve flattens. The harness's own default cap of eight predates
// the fix and is left alone — eleven measured 10% faster than eight there,
// which is not the argument for reopening a settled number.
//
// One gate does not join the pool. The viewer build goes first and alone,
// because three suites change what they can ask by whether view/ exists (the
// comment on that gate has the history) — and because the smoke gate packs
// the tree, `npm pack` runs prepack, and prepack REBUILDS view/, vite
// emptying the directory first. A suite copying the bundle into a sandbox
// during that rebuild reads half of it. So smoke is told --as-built: the
// bundle the first gate wrote is the one packed, and smoke runs in the pool
// with everything else instead of alone at the end, which was 26s on its own.
//
// Results print as they finish, the way the harness reports mutations; the
// tails of failures print together at the end, so a red run reads the same
// as it did. Exit 0 when every gate passes, 1 otherwise. Plain Node, no
// dependencies.

import { spawn } from 'node:child_process'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { availableParallelism } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { hostPath } from './commands/mutate.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const COMMANDS = join(HERE, 'commands')
const NEXUS = join(HERE, 'nexus')

const args = process.argv.slice(2)
const QUICK = args.includes('--quick')
const LIST = args.includes('--list')

const BUDGET = (() => {
	const i = args.indexOf('--jobs')
	const asked = i !== -1 ? Number(args[i + 1]) : Number(process.env.QRNTN_JOBS)
	return Math.max(1, asked || availableParallelism())
})()
// Half the budget each, rounded DOWN, so two self-tests fit side by side —
// rounded up, on an odd core count, the second does not fit and they run one
// at a time, which cost a minute the first time it was tried.
const SELF_TEST_JOBS = Math.max(1, Math.floor(BUDGET / 2))

// One environment for every gate: the real git ahead of the shim, and the
// harness told its share of the budget. Resolved once — hostPath asks
// xcode-select, and that is a spawn.
const ENV = { ...process.env, PATH: hostPath() }
const HARNESS_ENV = { ...ENV, QRNTN_JOBS: String(SELF_TEST_JOBS) }

const files = readdirSync(COMMANDS).sort()
const tests = files.filter((f) => f.endsWith('.test.mjs'))
// Largest first. The pool cannot know how long a self-test takes before it
// runs, and the file's size is the proxy that costs nothing: more mutations
// is more bytes, and the audit scanner's — the longest by a wide margin — is
// the largest. Starting it first is what keeps it off the critical path.
const selfTests = files
	.filter((f) => f.endsWith('.self-test.mjs'))
	.sort((a, b) => statSync(join(COMMANDS, b)).size - statSync(join(COMMANDS, a)).size)

/** Spawn and collect. `signal` and `error` are carried, not dropped — see whyFailed. */
const run = (cmd, argv, { env = ENV, cwd } = {}) =>
	new Promise((resolveP) => {
		let out = ''
		let child
		try {
			child = spawn(cmd, argv, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] })
		} catch (error) {
			return resolveP({ status: null, signal: null, error, out })
		}
		child.stdout.on('data', (d) => { out += d })
		child.stderr.on('data', (d) => { out += d })
		child.on('error', (error) => resolveP({ status: null, signal: null, error, out }))
		child.on('exit', (status, signal) => resolveP({ status, signal, error: null, out }))
	})

const node = (file, opts) => run(process.execPath, [file], opts)

const toolchain = (what) =>
	existsSync(join(NEXUS, 'node_modules')) ? null : { status: 0, skipped: `nexus/node_modules absent — run npm ci --prefix nexus${what ? `; ${what}` : ''}` }

const gates = [
	{
		// FIRST, AND THAT IS THE WHOLE POINT. `view` ships a bundle that is
		// built rather than committed, and three suites change what they can
		// ask depending on whether it is there: view.test.mjs drives the real
		// bundle in its second half, qrntn.test.mjs needs a verb that runs
		// until interrupted to check that signals reach it, and the smoke gate
		// serves from the tarball. All three say so when it is absent.
		//
		// This gate sat after the suites, which meant a fresh checkout built
		// the bundle in the same run that had already skipped everything
		// needing it — every gate green, and eight assertions never asked. CI
		// found it, because CI is the only place that starts without a
		// previous build lying around. qrntn.self-test.mjs found the sharp
		// edge: a mutation removing signal forwarding survived, because the
		// assertion that catches it had been skipped an hour earlier.
		//
		// Not slow, so `--quick` builds it too. It costs seconds, and a --quick
		// run that quietly covers less than a full one is the thing this file
		// keeps finding everywhere else.
		name: 'view · build the viewer bundle the tarball ships',
		slow: false,
		alone: 'first',
		weight: BUDGET,
		run: async () =>
			toolchain('the suites and the smoke gate will say what they skipped') ??
			node(join(NEXUS, 'scripts', 'build-view.mjs'))
	},
	...selfTests.map((f) => ({
		name: `self-test · ${f}`,
		slow: true,
		weight: SELF_TEST_JOBS,
		run: () => node(join(COMMANDS, f), { env: HARNESS_ENV })
	})),
	{
		// SK-94. record.schema.json is generated from packages/record/schema.ts and
		// committed, so the zero-dependency commands can validate without a
		// toolchain. A generated file that is committed and not checked is a file
		// that drifts — the same contract the plugin manifest has in the library.
		name: 'record · the compiled schema matches its zod source',
		slow: true,
		weight: 1,
		run: async () =>
			toolchain() ?? run('npx', ['--prefix', NEXUS, 'tsx', join(NEXUS, 'scripts', 'build-record-schema.mjs'), '--check'])
	},
	{
		// Not a pass and not a failure when the toolchain is absent: saying so
		// is the point — a gate that silently skips is how a suite quietly
		// stops covering something. Weighs two: vitest runs its own workers.
		name: 'nexus · verify (typecheck, vitest, data integrity)',
		slow: true,
		weight: 2,
		run: async () => toolchain() ?? run('npm', ['run', '--prefix', NEXUS, 'verify'])
	},
	{
		// SK-97 §7. The only gate that reduces the tree to what `npm pack`
		// produces and runs the tool from there. Everything above it runs out of
		// the checkout, where every file exists whether or not package.json says
		// it ships — so a script missing from the `files` allowlist passes every
		// other gate in this list and is broken for everyone who installs it.
		//
		// Slow because it packs and installs; skipped by --quick, and run by
		// prepublishOnly, which is the moment it exists for. --as-built, for
		// the reason the header gives. Weighs two: npm install is its own
		// small storm of processes.
		name: 'smoke · the tarball installs and every verb runs from it',
		slow: true,
		weight: 2,
		run: () => run(process.execPath, [join(HERE, 'smoke.mjs'), '--as-built'])
	},
	...tests.map((f) => ({ name: `test · ${f}`, slow: false, weight: 1, run: () => node(join(COMMANDS, f)) })),
]

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
	console.log(`\n  ${gates.length} gates · ${gates.filter((g) => g.slow).length} slow · ${BUDGET} at a time`)
	process.exit(0)
}

let passed = 0
let skipped = 0
const failures = []

function report(g, r, seconds) {
	const took = `${seconds.toFixed(1)}s`
	if (r.skipped) {
		console.log(`  skip ${g.name}  — ${r.skipped}`)
		skipped++
	} else if (r.status === 0) {
		const tail = (r.out ?? '').trim().split('\n').filter(Boolean).pop() ?? ''
		console.log(`  ok   ${g.name}  — ${tail.trim()}  ${took}`)
		passed++
	} else {
		console.log(`  FAIL ${g.name}  — ${whyFailed(r)}  ${took}`)
		failures.push({ name: g.name, out: r.out })
	}
}

async function runGate(g) {
	const started = Date.now()
	const r = await g.run()
	report(g, r, (Date.now() - started) / 1000)
}

/**
 * First-fit over a weighted queue. A gate is admitted when its weight fits
 * in what is free, or when nothing is running — a gate heavier than the
 * whole budget still runs, alone. Suites at weight one fill in beside a
 * self-test; two self-tests fill the budget between them.
 */
async function pool(queue) {
	let free = BUDGET
	const running = new Set()
	const admit = () => {
		for (let i = 0; i < queue.length; i++) {
			const g = queue[i]
			if (g.weight <= free || running.size === 0) {
				queue.splice(i, 1)
				free -= g.weight
				const p = runGate(g).then(() => {
					free += g.weight
					running.delete(p)
				})
				running.add(p)
				return true
			}
		}
		return false
	}
	while (queue.length || running.size) {
		while (queue.length && admit()) { /* fill */ }
		if (running.size) await Promise.race(running)
	}
}

const wanted = gates.filter((g) => {
	if (QUICK && g.slow) {
		skipped++
		return false
	}
	return true
})

for (const g of wanted.filter((g) => g.alone)) await runGate(g)
await pool(wanted.filter((g) => !g.alone))

for (const f of failures) {
	console.log(`\n──── ${f.name} ────`)
	console.log((f.out ?? '').trim().split('\n').slice(-25).join('\n'))
}

const total = passed + failures.length
console.log(`\n  ${passed}/${total} gates passed${skipped ? ` · ${skipped} skipped` : ''}`)
process.exit(failures.length ? 1 : 0)
