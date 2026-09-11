// mutate.mjs — the mutation harness every self-test runs on.
//
// A suite that has only ever passed has not been tested. Each self-test names
// a list of mutations — defects a careless edit could plausibly introduce —
// applies each to a copy of the script under test, runs the suite against the
// mutant, and asserts the suite FAILS. A mutation that survives names a check
// nobody is really making. That loop used to be typed out eleven times, once
// per self-test, and the eleven had begun to differ in small ways: three spawned
// `'node'` by name where the rest used process.execPath, and the wording of the
// same outcome drifted from file to file. This is the one copy.
//
// IT RUNS MUTATIONS IN PARALLEL, and that is the reason it was written when it
// was. Measured on CI before this existed: 432 of 454 seconds of a full gate
// run were spent here, 95%, and 192 of those in the audit scanner's self-test
// alone — 53 mutations at roughly 3.6 seconds each, one after another. None of
// that work is sequential. Every mutation is independent of every other; they
// ran one at a time only because each wrote into the same sandbox file. Each
// gets its own sandbox now, and as many run at once as the machine has cores,
// up to a cap.
//
// WHAT PARALLELISM COSTS, AND HOW IT IS PAID FOR. These suites spawn processes
// and bind sockets, and two defects were fixed in them the week before this:
// a harness that left listening servers behind whenever a mutant's output did
// not parse, and a readiness check that read assertions against half-written
// stdout. Parallelism amplifies both rather than exposing anything new. So:
// every sandbox is its own directory, so nothing collides on disk; every
// suite is spawned as its own process group and the group is swept with
// SIGKILL once the suite has ended however it ended, so a mutant's server
// cannot outlive its run; and each run is bounded, because a mutation that
// hangs the tool would otherwise hang the gate — a hung suite has not passed,
// which is the outcome a caught mutation produces, and it is reported as
// having been stopped rather than counted in silence.
//
// WHAT IT BUYS, MEASURED, all eleven self-tests on an 11-core laptop:
//
//   workers   total     vs serial
//   1         19m 23s
//   4         10m 03s   1.9×
//   8          8m 44s   2.2×
//
// Well short of 8×, and the reason is worth knowing before anyone reaches for
// more cores. The audit scanner's suite is 44% of serial time and spawns
// fifty processes a run; alone it takes 9s, four at once take 16s, eight take
// 29s — throughput tops out near 2.5× because process creation, not CPU, is
// the ceiling. intake's suite is bound by git's fsyncs the same way. The
// larger win for those two is a cheaper suite per run, which is a different
// change to suites that are deliberately black-box against the CLI.
//
// QRNTN_JOBS=1 makes it serial again, for bisecting a flake or reading output
// in mutation order. The default is min(cores, 8): eight measured faster than
// four here, and past eight the suites contend for the disk and the port
// range more than they gain.
//
// Not shipped. It is test infrastructure and package.json's `files` does not
// list it — qrntn.test.mjs asserts the allowlist ships no test machinery, and
// this is that.

import { spawn, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { availableParallelism, tmpdir } from 'node:os'
import { join } from 'node:path'

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000

/**
 * Run every mutation against the suite, in parallel, and exit.
 *
 * @param {object} spec
 * @param {string} spec.name          short label for temp directories, e.g. 'adopt'
 * @param {string} spec.test          absolute path of the suite, run unmutated at the end
 * @param {Record<string,string>} spec.sources
 *        absolute paths of every file a mutation may target, keyed by the name
 *        mutations use in `file`. The FIRST key is the default target.
 * @param {(dir: string, files: Record<string,string>) => string} spec.build
 *        lay out a sandbox at `dir` from `files` (each source's text, with the
 *        mutant applied to one of them) and return the path of the suite to
 *        spawn inside it. Called once per mutation, each with its own `dir`.
 * @param {Array<{name:string, find:string, replace:string, file?:string, expect?:'survives', skip?:string}>} spec.mutations
 *        `expect: 'survives'` marks an inert control. `skip` names a reason
 *        this mutation cannot be asked in this tree; it is reported, not run.
 * @param {number} [spec.jobs]        concurrency; QRNTN_JOBS overrides, default min(cores, 8)
 * @param {number} [spec.timeoutMs]   per-mutation bound; default five minutes
 */
export async function mutate({ name, test, sources, build, mutations, jobs, timeoutMs = DEFAULT_TIMEOUT_MS }) {
	const keys = Object.keys(sources)
	const originals = Object.fromEntries(keys.map((k) => [k, readFileSync(sources[k], 'utf8')]))
	const concurrency = Math.max(1, Number(process.env.QRNTN_JOBS) || jobs || Math.min(availableParallelism(), 8))

	let asExpected = 0
	let unexpected = 0

	// Anchors are checked up front, all of them, before anything runs. A
	// drifted anchor is a defect in the self-test rather than in the suite,
	// and the reader should see every one of them at once rather than one per
	// run.
	const runnable = []
	for (const m of mutations) {
		if (m.skip) {
			console.log(`  skipped   ${m.name} — ${m.skip}`)
			asExpected++
			continue
		}
		const target = m.file ?? keys[0]
		if (!(target in originals)) {
			console.error(`  ERROR     "${m.name}" — targets ${target}, which this self-test did not declare as a source.`)
			unexpected++
			continue
		}
		const occurrences = originals[target].split(m.find).length - 1
		if (occurrences !== 1) {
			console.error(
				`  ERROR     "${m.name}" — anchor found ${occurrences} times in ${target}, expected exactly 1.\n` +
					'            The source has drifted; update the mutation before trusting this run.'
			)
			unexpected++
			continue
		}
		runnable.push({ m, target })
	}

	// One mutation, in its own sandbox, in its own process group.
	const runOne = ({ m, target }) =>
		new Promise((resolveP) => {
			const dir = mkdtempSync(join(tmpdir(), `${name}-self-`))
			const files = { ...originals, [target]: originals[target].replace(m.find, m.replace) }
			let suite
			try {
				suite = build(dir, files)
			} catch (e) {
				rmSync(dir, { recursive: true, force: true })
				return resolveP({ m, status: null, out: '', buildError: e })
			}
			const p = spawn(process.execPath, [suite], { detached: true, stdio: ['ignore', 'pipe', 'pipe'] })
			let out = ''
			let stopped = false
			const timer = setTimeout(() => {
				stopped = true
				sweep(p)
			}, timeoutMs)
			p.stdout.on('data', (d) => { out += d })
			p.stderr.on('data', (d) => { out += d })
			p.on('exit', (status) => {
				clearTimeout(timer)
				// Whatever the suite spawned and did not stop: gone with it.
				sweep(p)
				rmSync(dir, { recursive: true, force: true })
				resolveP({ m, status, out, stopped })
			})
		})

	// A bounded pool. Results are reported as they complete, so a slow run
	// shows progress; the summary at the end is what a gate reads.
	const queue = runnable.slice()
	const workers = Array.from({ length: Math.min(concurrency, queue.length || 1) }, async () => {
		while (queue.length) {
			const job = queue.shift()
			const r = await runOne(job)
			report(r)
		}
	})

	function report({ m, status, out, stopped, buildError }) {
		const expectSurvival = m.expect === 'survives'
		if (buildError) {
			console.error(`  ERROR     "${m.name}" — the sandbox could not be built: ${buildError.message}`)
			unexpected++
			return
		}
		const survived = status === 0
		if (survived === expectSurvival) {
			asExpected++
			const failed = (out.match(/(\d+) failed/) ?? [])[1] ?? '0'
			const how = stopped ? '  (stopped after the time limit — the suite did not finish)' : expectSurvival ? '' : `  (${failed} assertion(s))`
			console.log(`  ${expectSurvival ? 'survived  ' : 'caught    '}${m.name}${how}`)
		} else {
			unexpected++
			console.error(
				expectSurvival
					? `  BROKE     ${m.name} — an inert change failed the suite, so the suite tests something it should not.`
					: `  SURVIVED  ${m.name}`
			)
		}
	}

	await Promise.all(workers)

	// The shipped scripts are read, never written. A build() that wrote back
	// to a source would corrupt every later mutation and the checkout itself.
	for (const k of keys) {
		if (readFileSync(sources[k], 'utf8') !== originals[k]) {
			console.error(`  ERROR     ${k} changed during this run — a shipped script should never be written.`)
			unexpected++
		}
	}

	// The suite as it stands, unmutated, in place. A self-test whose clean
	// run fails is not measuring the suite; it is measuring a broken tree.
	const clean = spawnSync(process.execPath, [test], { encoding: 'utf8' })
	console.log(`\nclean run: ${clean.status === 0 ? 'PASS' : 'FAIL'}`)
	console.log(`self-test: ${asExpected} as expected, ${unexpected} not${concurrency > 1 ? `  · ${concurrency} at a time` : ''}`)
	if (unexpected || clean.status !== 0) {
		console.error('\nA surviving mutation means the suite is not checking what it appears to.\nAdd the assertion that would have caught it.')
		process.exit(1)
	}
}

// The suite was spawned as a group leader, so `-pid` is the suite and
// everything it started. A group nobody is left in answers ESRCH, which is
// the outcome wanted and not an error.
function sweep(p) {
	try {
		process.kill(-p.pid, 'SIGKILL')
	} catch {
		/* every member already gone */
	}
}
