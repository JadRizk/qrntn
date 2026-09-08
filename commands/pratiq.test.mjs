#!/usr/bin/env node
// Tests for bin/pratiq.mjs — the front door. Run: node pratiq.test.mjs
//
// It lives in commands/ rather than beside the thing it tests because check.mjs
// discovers suites from this one directory, and a suite in bin/ would simply
// never run. A test nobody executes is worse than none: it reads as coverage.
//
// Two of these are packaging gates rather than behaviour gates, and they are the
// reason this file exists at all. The dispatcher is trivial and its behaviour is
// nearly self-evident; what is NOT self-evident is whether every verb it offers
// will still resolve once the tree is reduced to package.json's `files`
// allowlist. Running pratiq from a checkout cannot answer that — every file is
// present in a checkout — so the allowlist is read and cross-checked directly.
//
// Expected values are derived by hand from the fixture, never captured from an
// earlier run of this tool.

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = join(HERE, '..')
const BIN = join(REPO, 'bin', 'pratiq.mjs')
const PKG = join(REPO, 'package.json')
const ROOT = mkdtempSync(join(tmpdir(), 'pratiq-bin-test-'))

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
	check('bin/pratiq.mjs is in the allowlist', files.includes('bin/pratiq.mjs'), JSON.stringify(files))
	check('check-catalog.mjs is too — promote spawns it, though no verb names it', files.includes('commands/check-catalog.mjs'), JSON.stringify(files))

	// The allowlist must not ship the suites. Nothing at runtime reads them, and
	// a tarball carrying tests but not check.mjs — which is deliberately not
	// shipped — is half a gesture.
	const shippedTests = files.filter((f) => /\.test\.mjs$|\.self-test\.mjs$|^check\.mjs$|fixtures/.test(f))
	check('the allowlist ships no tests, self-tests, fixtures or the gate runner', shippedTests.length === 0, JSON.stringify(shippedTests))
}

// ── asking what it does ─────────────────────────────────────────────────────
{
	const bare = run([])
	check('bare `pratiq` lists the verbs', /pratiq <verb>/.test(bare.raw), bare.raw.slice(0, 200))
	check('bare `pratiq` names every verb it has', VERBS.every((v) => bare.raw.includes(`  ${v.verb}`)), bare.raw)
	// Getting it wrong is an error; asking directly is not.
	check('bare `pratiq` exits 2 — the absence of a question', bare.code === 2, `exit ${bare.code}`)

	for (const flag of ['--help', '-h']) {
		const r = run([flag])
		check(`\`pratiq ${flag}\` exits 0`, r.code === 0, `exit ${r.code}`)
		check(`\`pratiq ${flag}\` lists the verbs`, /pratiq <verb>/.test(r.raw), r.raw.slice(0, 200))
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
	check('unknown verb: not a usage dump', !/pratiq <verb>/.test(r.raw), r.raw.slice(0, 300))
}

// ── a verb whose script is gone: a packaging fault, said as one ─────────────
{
	const lonely = mkdtempSync(join(tmpdir(), 'pratiq-nocommands-'))
	mkdirSync(join(lonely, 'bin'), { recursive: true })
	mkdirSync(join(lonely, 'commands'), { recursive: true })
	writeFileSync(join(lonely, 'bin', 'pratiq.mjs'), readFileSync(BIN, 'utf8'))
	const r = spawnSync(process.execPath, [join(lonely, 'bin', 'pratiq.mjs'), 'ledger'], { encoding: 'utf8' })
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
	check('and the verb`s own words reach the caller', /pratiq init/.test(before.raw), before.raw.slice(0, 300))

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
	// `pratiq ledger --help` is ledger's help, not the dispatcher's. The verb is
	// the only thing this file owns; every other argument belongs downstream.
	const r = run(['ledger', '--help'])
	check('--help after a verb belongs to the verb, not the front door', !/pratiq <verb>/.test(r.raw), r.raw.slice(0, 300))
}

console.log(`\n${pass} passed, ${failures.length} failed`)
for (const f of failures) console.log(`  FAIL  ${f}`)
process.exit(failures.length ? 1 : 0)
