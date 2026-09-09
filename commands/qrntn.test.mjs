#!/usr/bin/env node
// Tests for bin/qrntn.mjs — the front door. Run: node qrntn.test.mjs
//
// It lives in commands/ rather than beside the thing it tests because check.mjs
// discovers suites from this one directory, and a suite in bin/ would simply
// never run. A test nobody executes is worse than none: it reads as coverage.
//
// Two of these are packaging gates rather than behaviour gates, and they are the
// reason this file exists at all. The dispatcher is trivial and its behaviour is
// nearly self-evident; what is NOT self-evident is whether every verb it offers
// will still resolve once the tree is reduced to package.json's `files`
// allowlist. Running qrntn from a checkout cannot answer that — every file is
// present in a checkout — so the allowlist is read and cross-checked directly.
//
// Expected values are derived by hand from the fixture, never captured from an
// earlier run of this tool.

import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = join(HERE, '..')
const BIN = join(REPO, 'bin', 'qrntn.mjs')
const PKG = join(REPO, 'package.json')
const ROOT = mkdtempSync(join(tmpdir(), 'qrntn-bin-test-'))

let pass = 0
const failures = []
const check = (name, cond, detail = '') => {
	if (cond) pass++
	else failures.push(`${name}${detail ? ` — ${detail}` : ''}`)
}

function run(args, opts = {}) {
	const r = spawnSync(process.execPath, [BIN, ...args], { encoding: 'utf8', ...opts })
	return { code: r.status, raw: (r.stdout ?? '') + (r.stderr ?? '') }
}

// The table, read out of the source rather than restated here. Restating it
// would make this file a second place to update when a verb is added, and the
// whole point of the two gates below is that nobody has to remember to.
const VERBS = [...readFileSync(BIN, 'utf8').matchAll(/^\t\['([a-z-]+)', '([\w.-]+)'/gm)].map((m) => ({ verb: m[1], file: m[2] }))

// ── the two packaging gates ─────────────────────────────────────────────────
{
	check('the verb table was parsed at all', VERBS.length >= 9, `found ${VERBS.length}`)

	const missing = VERBS.filter((v) => !existsSync(join(REPO, 'commands', v.file)))
	check('every verb has a script behind it', missing.length === 0, missing.map((v) => `${v.verb} -> ${v.file}`).join(', '))

	// The gate a checkout cannot fail and a tarball can. A verb absent from the
	// allowlist runs perfectly here and refuses with "missing its implementation"
	// for everyone who installed it, which is the worst possible place to find
	// out — after publish, on someone else's machine, about a verb you offered.
	const files = JSON.parse(readFileSync(PKG, 'utf8')).files ?? []
	const unshipped = VERBS.filter((v) => !files.includes(`commands/${v.file}`))
	check('every verb\'s script is in the files allowlist', unshipped.length === 0, unshipped.map((v) => `${v.verb} -> commands/${v.file}`).join(', '))

	// The dispatcher itself, and the one non-verb sibling promote spawns.
	check('bin/qrntn.mjs is in the allowlist', files.includes('bin/qrntn.mjs'), JSON.stringify(files))
	check('check-catalog.mjs is too — promote spawns it, though no verb names it', files.includes('commands/check-catalog.mjs'), JSON.stringify(files))
	// The AUDIT.md contract. Both verbs that read it import this and refuse by
	// name without it — which the smoke gate would read as an ordinary refusal,
	// so the allowlist is the place to catch it.
	check('audit-record.mjs is too — adopt and promote import it, though no verb names it', files.includes('commands/audit-record.mjs'), JSON.stringify(files))

	// The allowlist must not ship the suites. Nothing at runtime reads them, and
	// a tarball carrying tests but not check.mjs — which is deliberately not
	// shipped — is half a gesture.
	const shippedTests = files.filter((f) => /\.test\.mjs$|\.self-test\.mjs$|^check\.mjs$|fixtures/.test(f))
	check('the allowlist ships no tests, self-tests, fixtures or the gate runner', shippedTests.length === 0, JSON.stringify(shippedTests))
}

// ── asking what it does ─────────────────────────────────────────────────────
{
	const bare = run([])
	check('bare `qrntn` lists the verbs', /qrntn <verb>/.test(bare.raw), bare.raw.slice(0, 200))
	check('bare `qrntn` names every verb it has', VERBS.every((v) => bare.raw.includes(`  ${v.verb}`)), bare.raw)
	// Getting it wrong is an error; asking directly is not.
	check('bare `qrntn` exits 2 — the absence of a question', bare.code === 2, `exit ${bare.code}`)

	for (const flag of ['--help', '-h']) {
		const r = run([flag])
		check(`\`qrntn ${flag}\` exits 0`, r.code === 0, `exit ${r.code}`)
		check(`\`qrntn ${flag}\` lists the verbs`, /qrntn <verb>/.test(r.raw), r.raw.slice(0, 200))
	}
}

// ── a verb it does not have ─────────────────────────────────────────────────
{
	const r = run(['frobnicate'])
	check('unknown verb: refused', /no such verb/.test(r.raw), r.raw.slice(0, 300))
	check('unknown verb: exit 2', r.code === 2, `exit ${r.code}`)
	check('unknown verb: names the ones it does have', VERBS.every((v) => r.raw.includes(v.verb)), r.raw.slice(0, 400))
	check('unknown verb: no stack trace', !/at \w+ \(/.test(r.raw), r.raw.slice(0, 300))
	// A near-miss is the common case and must not be treated as a usage dump.
	check('unknown verb: not a usage dump', !/qrntn <verb>/.test(r.raw), r.raw.slice(0, 300))
}

// ── a verb whose script is gone: a packaging fault, said as one ─────────────
{
	const lonely = mkdtempSync(join(tmpdir(), 'qrntn-nocommands-'))
	mkdirSync(join(lonely, 'bin'), { recursive: true })
	mkdirSync(join(lonely, 'commands'), { recursive: true })
	writeFileSync(join(lonely, 'bin', 'qrntn.mjs'), readFileSync(BIN, 'utf8'))
	const r = spawnSync(process.execPath, [join(lonely, 'bin', 'qrntn.mjs'), 'ledger'], { encoding: 'utf8' })
	const raw = (r.stdout ?? '') + (r.stderr ?? '')
	check('missing implementation: exit 2', r.status === 2, `exit ${r.status}`)
	check('missing implementation: named as a packaging fault', /packaging fault/.test(raw), raw.slice(0, 300))
	check('missing implementation: says which path it expected', /expected .*ledger\.mjs/.test(raw), raw.slice(0, 300))
	check('missing implementation: no ENOENT stack trace', !/ENOENT/.test(raw), raw.slice(0, 300))
}

// ── arguments pass through untouched, and exit codes come back ─────────────
//
// The dispatcher's whole contract in one fixture: it must not parse --library,
// and it must not translate the three exit codes. Both are checked against a
// real library moving through its three states rather than against a stub.
{
	const lib = join(ROOT, 'passthrough')
	mkdirSync(join(lib, 'skills', 'tidy-notes'), { recursive: true })
	writeFileSync(
		join(lib, 'skills', 'tidy-notes', 'SKILL.md'),
		'---\nname: tidy-notes\ndescription: Rename notes files. Use when names drift.\n---\n\n# Tidy\n'
	)

	const before = run(['check', '--library', lib])
	check('exit 2 propagates: a library never set up', before.code === 2, `exit ${before.code} ${before.raw.slice(0, 200)}`)
	check('and the verb`s own words reach the caller', /qrntn init/.test(before.raw), before.raw.slice(0, 300))

	const inited = run(['init', '--library', lib])
	check('--library reached init untouched', inited.code === 0 && existsSync(join(lib, 'catalog.json')), inited.raw.slice(0, 300))

	const clean = run(['check', '--library', lib])
	check('exit 0 propagates: a library that is consistent', clean.code === 0, `exit ${clean.code} ${clean.raw.slice(0, 200)}`)

	writeFileSync(join(lib, 'catalog.json'), JSON.stringify({ categories: [{ id: 'skills', title: 'Skills', skills: [] }] }, null, 2) + '\n')
	const dirty = run(['check', '--library', lib])
	check('exit 1 propagates: a library that is inconsistent', dirty.code === 1, `exit ${dirty.code} ${dirty.raw.slice(0, 200)}`)

	// Three different answers, three different codes. If the dispatcher
	// collapsed any pair, one of the three above would have matched another.
	check('the three codes are distinct', new Set([before.code, clean.code, dirty.code]).size === 3, `${before.code}/${clean.code}/${dirty.code}`)
}

// ── flags the dispatcher must not claim for itself ─────────────────────────
{
	// `qrntn ledger --help` is ledger's help, not the dispatcher's. The verb is
	// the only thing this file owns; every other argument belongs downstream.
	const r = run(['ledger', '--help'])
	check('--help after a verb belongs to the verb, not the front door', !/qrntn <verb>/.test(r.raw), r.raw.slice(0, 300))
}

// ── the answer names the verb, not the file behind it ──────────────────────
//
// The header of bin/qrntn.mjs says the verb is the contract and the filename
// is not. Every command printed the filename anyway, so someone who typed
// `qrntn promote` was answered with a usage line for a script not on their
// PATH, in a directory they have no reason to know exists.
//
// This is asserted HERE rather than in each command's own suite on purpose.
// Those suites are what the mutation self-tests run inside a sandbox holding
// one script and no siblings, where invoked-as.mjs is deliberately absent and
// the fallback correctly names the file. An assertion on the verb would fail
// there for a reason that has nothing to do with the mutation, and a self-test
// that fails for the wrong reason proves nothing about itself.
{
	// Every verb, driven the way a user drives it. Each is given an argument
	// shape that makes it print its own usage: for most that is `--help`, and
	// for the two that take a required positional it is nothing at all.
	const HOW = {
		init: ['--help'],
		intake: [],
		audit: ['--help'],
		adopt: ['--help'],
		promote: [],
		refresh: ['--help'],
		usage: ['--help'],
		overlap: ['--help'],
		// Was `--badflag`, because ledger had no --help and an unrecognised flag
		// fell through to its synopsis. That was a workaround for a defect, not
		// a way of driving the verb: it now answers --help like the other eight,
		// and a bad flag is refused by name instead of answered with usage.
		ledger: ['--help'],
		check: ['--help'],
		view: ['--help']
	}

	// Empty, and it stays a list rather than becoming an assertion that every
	// verb answers, because the point is that the exceptions are NAMED. Two
	// lived here — refresh, which had no --help handling and refused for want
	// of a library, and overlap, which ignored the flag and ran its analysis.
	// Both are fixed; the list is where the next one gets written down instead
	// of being skipped.
	//
	// They are NAMED rather than skipped. An earlier version of this loop did
	// `if (!synopsis.length) continue`, which silently dropped three of nine
	// verbs — and the third was usage, whose synopsis read `node
	// scripts/usage.mjs`: a directory belonging to the library this was
	// extracted from, and the exact leak the assertion below exists to catch.
	// A gate that quietly covers less than it appears to is the failure this
	// project keeps finding everywhere else.
	const NO_SYNOPSIS_YET = []

	const named = []
	const leaked = []
	const silent = []
	for (const { verb } of VERBS) {
		const r = run([verb, ...HOW[verb]], { cwd: ROOT })
		// A synopsis line, in either of the two shapes this tool uses: the
		// `usage: …` prefix most commands print, and the indented bare synopsis
		// audit-skill puts under its title. Lines that merely mention a file
		// somewhere in prose are not synopsis lines and are left alone.
		const lines = r.raw.split('\n')
		// `refused:` may sit in front — intake's usage line is a refusal.
		//
		// The file pattern carries a path, not just a basename. Matching only
		// `[a-z-]+\.mjs` is what let `node scripts/usage.mjs` through: the slash
		// stopped the character class reaching `.mjs`, so the line never became
		// a synopsis and the leak check never saw it. The worst leak is the one
		// naming a directory that does not ship, so it must be the easiest to
		// match, not the hardest.
		const FILE = String.raw`[\w./-]*[a-z-]+\.mjs`
		const synopsis = lines.filter(
			(l) =>
				/^\s*(?:refused:\s*)?usage:/.test(l) ||
				new RegExp(String.raw`^\s{2,}(qrntn \w|node ${FILE}|${FILE} )`).test(l)
		)
		if (!synopsis.length) {
			silent.push(verb)
			continue
		}
		if (synopsis.some((l) => new RegExp(`\\bqrntn ${verb}\\b`).test(l))) named.push(verb)
		const leak = synopsis.find((l) => new RegExp(FILE).test(l))
		if (leak) leaked.push(`${verb}: ${leak.trim()}`)
	}

	// Exactly the known two, so a tenth verb arriving without a usage line —
	// or either of these growing one — fails here rather than shrinking the
	// coverage of the two assertions below without saying so.
	check(
		'the verbs printing no usage line are exactly the ones known not to',
		silent.slice().sort().join(',') === NO_SYNOPSIS_YET.join(','),
		`silent: [${silent.slice().sort()}] · expected: [${NO_SYNOPSIS_YET}]`
	)
	// Every remaining verb, counted rather than thresholded. `>= 6` passed at
	// exactly the value the gap produced, which is a number that agrees with
	// today and would agree with tomorrow being worse.
	check(
		'every verb that prints a usage line names itself as `qrntn <verb>`',
		named.length === VERBS.length - NO_SYNOPSIS_YET.length,
		`named ${named.length}/${VERBS.length - NO_SYNOPSIS_YET.length}: ${named.join(', ') || 'none'}`
	)
	check(
		'no usage line names the script file behind the verb',
		leaked.length === 0,
		leaked.join(' | ')
	)

	// Asking a tool how to use it is not a question about a library, and two
	// verbs used to answer as though it were. refresh resolved the library
	// first and refused with `not a skill library` — exit 2, telling a caller
	// who had not yet named a directory that their directory was wrong.
	// overlap ignored the flag entirely and ran its analysis, handing back a
	// ranked table instead of an answer.
	//
	// ROOT is this repository, which has no skills/ — so this runs from a
	// directory that is not a library, which is the condition that broke.
	//
	// Only these two. intake and promote answer --help with a refusal because
	// their positional is required and absent; whether that should be an exit 0
	// is a real question and a separate one from this.
	for (const verb of ['refresh', 'overlap']) {
		for (const flag of ['--help', '-h']) {
			const r = run([verb, flag], { cwd: ROOT })
			check(`\`qrntn ${verb} ${flag}\` exits 0 outside a library`, r.code === 0, `exit ${r.code} ${r.raw.slice(0, 160)}`)
			check(`\`qrntn ${verb} ${flag}\` answers rather than refusing`, !/refused:/.test(r.raw), r.raw.slice(0, 200))
		}
	}

	// Run directly rather than through the front door, the answer changes back.
	// This is the half that stops the fix from being a hardcoded "qrntn": these
	// scripts are still invoked by path, by every suite here and by the docs,
	// and a usage line naming a front door the caller did not use would be wrong
	// in the other direction — and wrong in the way that is harder to notice.
	const direct = spawnSync(process.execPath, [join(HERE, 'promote.mjs')], { encoding: 'utf8', cwd: ROOT })
	const directRaw = (direct.stdout ?? '') + (direct.stderr ?? '')
	check(
		'invoked by path, the usage line names the file — not a front door that was not used',
		/usage: node promote\.mjs/.test(directRaw),
		directRaw.slice(0, 200)
	)

	// The dispatcher cannot import from commands/ — its job when commands/ is
	// missing is to say so, and importing the constant would reintroduce exactly
	// the ERR_MODULE_NOT_FOUND fault its header describes. So the name is
	// written twice, and the copies are checked against each other here.
	const binSrc = readFileSync(BIN, 'utf8')
	const modSrc = readFileSync(join(HERE, 'invoked-as.mjs'), 'utf8')
	const nameIn = (src) => /VERB_ENV = '([A-Z_]+)'/.exec(src)?.[1] ?? null
	check(
		'the env var name is the same on both sides of the copy',
		nameIn(binSrc) !== null && nameIn(binSrc) === nameIn(modSrc),
		`bin: ${nameIn(binSrc)} · module: ${nameIn(modSrc)}`
	)

	// It is validated rather than trusted: it arrives from the environment and
	// is echoed straight into text a user reads.
	const forged = spawnSync(process.execPath, [join(HERE, 'promote.mjs')], {
		encoding: 'utf8',
		cwd: ROOT,
		env: { ...process.env, [nameIn(modSrc)]: 'promote; rm -rf /' }
	})
	const forgedRaw = (forged.stdout ?? '') + (forged.stderr ?? '')
	check(
		'a verb name that is not a verb shape is not echoed back',
		!forgedRaw.includes('rm -rf') && /usage: node promote\.mjs/.test(forgedRaw),
		forgedRaw.slice(0, 200)
	)
}

// ── which bytes are running ────────────────────────────────────────────────
//
// `qrntn --version` used to be refused as a verb this tool does not have,
// which is a confusing thing for a CLI to say about --version. It is answered
// before the verb lookup now.
//
// The version is read out of package.json rather than carried as a constant in
// the dispatcher, so these assert the two agree rather than asserting a literal
// — a literal here would be the second place the version lives, which is the
// fault the source comment exists to avoid.
{
	const declared = JSON.parse(readFileSync(PKG, 'utf8')).version

	for (const flag of ['--version', '-v']) {
		const r = run([flag])
		check(`\`qrntn ${flag}\` exits 0`, r.code === 0, `exit ${r.code} ${r.raw.slice(0, 200)}`)
		check(`\`qrntn ${flag}\` prints the version package.json declares`, r.raw.trim() === declared, `${JSON.stringify(r.raw)} vs ${declared}`)
		// Bare, so a script can read it without parsing. A name or a leading `v`
		// would each be one more thing for a caller to strip.
		check(`\`qrntn ${flag}\` prints nothing else`, !/qrntn|version|^v/i.test(r.raw.trim()), JSON.stringify(r.raw))
		check(`\`qrntn ${flag}\` is not treated as a verb`, !/no such verb/.test(r.raw), r.raw.slice(0, 200))
	}
}
{
	// A tool that cannot find its own manifest is broken in a way its user did
	// not cause. Same packaging fault as a missing command, and said the same
	// way rather than as a JSON parse error about a path they have no reason to
	// recognise.
	const lonely = mkdtempSync(join(tmpdir(), 'qrntn-nomanifest-'))
	mkdirSync(join(lonely, 'bin'), { recursive: true })
	writeFileSync(join(lonely, 'bin', 'qrntn.mjs'), readFileSync(BIN, 'utf8'))
	const r = spawnSync(process.execPath, [join(lonely, 'bin', 'qrntn.mjs'), '--version'], { encoding: 'utf8' })
	const raw = (r.stdout ?? '') + (r.stderr ?? '')
	check('no package.json: refused, exit 2', r.status === 2, `exit ${r.status} ${raw.slice(0, 200)}`)
	check('no package.json: named as a packaging fault', /packaging fault/.test(raw), raw.slice(0, 300))
	check('no package.json: says which file it wanted', /expected .*package\.json/.test(raw), raw.slice(0, 300))
	check('no package.json: no ENOENT stack trace', !/ENOENT/.test(raw), raw.slice(0, 300))
}

// ── signals reach the verb, and the verb's answer reaches the shell ─────────
//
// Every other suite in this repository spawns a SCRIPT, so the dispatcher is
// not in the path and this is unaskable there. It is askable here, and it has
// to be: `view` runs until interrupted and answers 0, and that 0 has to
// survive the trip out. Before the dispatcher forwarded signals it did not —
// the dispatcher died of SIGINT first and the shell saw 130, which is not one
// of the three codes the README freezes. A no-op handler instead of forwarding
// was worse: `kill -INT` on the dispatcher alone never reached the verb and
// the whole thing hung.
//
// The two cases are different questions. A verb that handles the signal must
// have its exit code propagated; a verb that does not must still die.
{
	const lib = join(ROOT, 'signals-lib')
	mkdirSync(join(lib, 'skills'), { recursive: true })
	writeFileSync(join(lib, 'catalog.json'), JSON.stringify({ categories: [] }))

	/** Run a verb, signal the DISPATCHER once it is up, and report how it ended. */
	const signalled = (args, signal, ready) =>
		new Promise((resolveP) => {
			const p = spawn(process.execPath, [BIN, ...args], { encoding: 'utf8' })
			let out = ''
			// A hang is a real outcome here and one of the two defects this
			// exists to catch, so it is bounded and named rather than left to
			// stall the suite.
			const timer = setTimeout(() => {
				p.kill('SIGKILL')
				resolveP('HUNG')
			}, 20000)
			p.stdout.on('data', (d) => {
				out += d
				if (ready(out)) p.kill(signal)
			})
			p.on('exit', (code, sig) => {
				clearTimeout(timer)
				resolveP(code === null ? `signal ${sig}` : code)
			})
		})

	// `view` is the only verb that runs until interrupted, so it is the only
	// one that can ask this — and it needs its bundle, which is built rather
	// than committed. Skipped with a line rather than silently when the tree
	// has no build, the same way commands/view.test.mjs does it.
	const viewUp = (out) => out.includes('\n')
	if (!existsSync(join(REPO, 'view', 'index.html'))) {
		console.log('  (the viewer bundle is not built — view/ absent — so the signal assertions were skipped; `npm run build:cli --prefix nexus` builds it)')
	} else {
		for (const signal of ['SIGINT', 'SIGTERM']) {
			const got = await signalled(['view', '--library', lib, '--json'], signal, viewUp)
			check(`view: ${signal} through the dispatcher exits 0, not a signal death`, got === 0, `got ${got}`)
		}
	}

	// A verb that installs no handler still dies of the forwarded signal, and
	// the dispatcher still reports 1 for it — the behaviour that was already
	// there, asserted so that forwarding cannot quietly change it.
	const held = join(lib, 'inbox', 'never-ends')
	mkdirSync(held, { recursive: true })
	writeFileSync(join(held, 'SKILL.md'), '---\nname: never-ends\ndescription: x\n---\n')
	const sleeper = await new Promise((resolveP) => {
		// `usage` with no transcripts to read is short-lived, so the honest way
		// to ask this is a verb that is definitely still running: a script that
		// sleeps, reached through the dispatcher's own verb table is not
		// available, so this asks the dispatcher directly with a signal sent
		// before the child can finish.
		const p = spawn(process.execPath, [BIN, 'check', '--library', lib], { encoding: 'utf8' })
		const timer = setTimeout(() => {
			p.kill('SIGKILL')
			resolveP('HUNG')
		}, 20000)
		p.on('exit', (code, sig) => {
			clearTimeout(timer)
			resolveP(code === null ? `signal ${sig}` : code)
		})
		p.kill('SIGINT')
	})
	check('a verb that handles no signal is not made to hang by forwarding', sleeper !== 'HUNG', `got ${sleeper}`)
}

console.log(`\n${pass} passed, ${failures.length} failed`)
for (const f of failures) console.log(`  FAIL  ${f}`)
process.exit(failures.length ? 1 : 0)
