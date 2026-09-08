#!/usr/bin/env node
// Tests for check-library.mjs. Run: node check-library.test.mjs
//
// Black box against the CLI, same reasoning as the rest of this suite.
//
// The distinction this file exists to hold is the one between exit 1 and exit
// 2. `check` composes two commands that each already have their own suite, so
// there is little point re-asserting what they find — what is new here, and
// what nothing else tests, is that "your library is inconsistent" and "you have
// not made a library yet" are different answers with different exit codes and
// different things to do about them.
//
// Expected values are derived by hand from the fixture, never captured from an
// earlier run of this tool.

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const SRC = join(HERE, 'check-library.mjs')
const INIT = join(HERE, 'init.mjs')
const ROOT = mkdtempSync(join(tmpdir(), 'check-library-test-'))

let pass = 0
const failures = []
const check = (name, cond, detail = '') => {
	if (cond) pass++
	else failures.push(`${name}${detail ? ` — ${detail}` : ''}`)
}

const skillMd = (name) => `---
name: ${name}
description: Do the ${name} thing. Use when the ${name} thing needs doing.
---

# ${name}

### 00 · Do it → done
Do the thing.
> **Gate:** the thing is done.
`

/** A folder of skills and nothing else — what a stranger has before init. */
function mkLibrary(label, names = ['tidy-notes', 'sort-inbox']) {
	const lib = join(ROOT, label)
	mkdirSync(join(lib, 'skills'), { recursive: true })
	for (const n of names) {
		mkdirSync(join(lib, 'skills', n), { recursive: true })
		writeFileSync(join(lib, 'skills', n, 'SKILL.md'), skillMd(n))
	}
	return lib
}

const init = (lib) => spawnSync(process.execPath, [INIT, '--library', lib], { encoding: 'utf8' })

function run(lib, args = []) {
	const r = spawnSync(process.execPath, [SRC, '--library', lib, ...args], { encoding: 'utf8' })
	return { code: r.status, raw: (r.stdout ?? '') + (r.stderr ?? '') }
}

function runJson(lib, args = []) {
	const r = run(lib, ['--json', ...args])
	let json = null
	try { json = JSON.parse(r.raw) } catch { /* asserted by caller */ }
	return { ...r, json }
}

const catalogOf = (lib) => JSON.parse(readFileSync(join(lib, 'catalog.json'), 'utf8'))

// ── the distinction the exit codes carry ────────────────────────────────────
//
// SHIPPING.md §2: "On a library that has never been init'd it refuses and names
// qrntn init, rather than reporting a library-shaped problem it does not
// have." A 1 here would be this command reasoning about itself.
{
	const lib = mkLibrary('never-inited')
	const r = runJson(lib)
	check('never init-ed: exit 2, not 1', r.code === 2, `exit ${r.code} ${r.raw.slice(0, 200)}`)
	check('never init-ed: reported as not set up', r.json?.setUp === false, JSON.stringify(r.json))
	check('never init-ed: the refusal names init', /qrntn init/.test(run(lib).raw), run(lib).raw.slice(0, 300))
	check('never init-ed: says nothing about mismatches', !/mismatch/.test(run(lib).raw), run(lib).raw.slice(0, 300))
	check('never init-ed: no stack trace', !/at \w+ \(/.test(run(lib).raw), run(lib).raw.slice(0, 300))
}
{
	// Not the same absence. init cannot make a folder without skills/ into a
	// library, so pointing at it would be advice that does not work.
	const lib = join(ROOT, 'not-a-library')
	mkdirSync(lib, { recursive: true })
	const r = run(lib)
	check('no skills/: exit 2', r.code === 2, `exit ${r.code}`)
	check('no skills/: names skills/ as what is missing', /no skills\//.test(r.raw), r.raw.slice(0, 300))
	check('no skills/: does not send you to init, which cannot help', !/qrntn init/.test(r.raw), r.raw.slice(0, 300))
}

// ── a library init made is a library check passes ───────────────────────────
{
	const lib = mkLibrary('clean')
	init(lib)
	const r = runJson(lib)
	check('after init: exit 0', r.code === 0, r.raw.slice(0, 300))
	check('after init: set up', r.json?.setUp === true, JSON.stringify(r.json?.setUp))
	check('after init: catalog clean', r.json?.catalog?.ok === true, JSON.stringify(r.json?.catalog))
	check('after init: ledger clean', r.json?.ledger?.ok === true, JSON.stringify(r.json?.ledger))
	check('after init: says both halves are clean', /catalog clean, ledger clean/.test(run(lib).raw), run(lib).raw.slice(-200))
}

// ── each half fails on its own, and is named on its own ─────────────────────
//
// Two fixtures rather than one, so a single mismatch cannot be reported as
// both — an exit code that is right for the wrong reason is the failure this
// suite's sibling files keep finding.
{
	// Catalog-only: the skill is held and has a ledger entry, but nothing files
	// it. check-catalog says "unfiled"; the ledger is untouched and still matches.
	const lib = mkLibrary('unfiled-only')
	init(lib)
	const catalog = catalogOf(lib)
	catalog.categories[0].skills = catalog.categories[0].skills.filter((n) => n !== 'sort-inbox')
	writeFileSync(join(lib, 'catalog.json'), JSON.stringify(catalog, null, 2) + '\n')

	const r = runJson(lib)
	check('unfiled skill: exit 1, not 2 — this library IS set up', r.code === 1, `exit ${r.code} ${r.raw.slice(0, 200)}`)
	check('unfiled skill: catalog half is not ok', r.json?.catalog?.ok === false, JSON.stringify(r.json?.catalog))
	check('unfiled skill: ledger half is still clean', r.json?.ledger?.ok === true, JSON.stringify(r.json?.ledger))
	check('unfiled skill: the report names the skill', /sort-inbox/.test(run(lib).raw), run(lib).raw.slice(0, 400))
}
{
	// Ledger-only: everything is filed, but an entry was deleted. check-catalog
	// is clean; ledger --check says a held skill has no entry.
	const lib = mkLibrary('ledger-only')
	init(lib)
	rmSync(join(lib, 'ledger', 'sort-inbox.json'))

	const r = runJson(lib)
	check('missing ledger entry: exit 1', r.code === 1, `exit ${r.code} ${r.raw.slice(0, 200)}`)
	check('missing ledger entry: catalog half is still clean', r.json?.catalog?.ok === true, JSON.stringify(r.json?.catalog))
	check('missing ledger entry: ledger half is not ok', r.json?.ledger?.ok === false, JSON.stringify(r.json?.ledger))
	check('missing ledger entry: the error names the skill', (r.json?.ledger?.errors ?? []).some((e) => /sort-inbox/.test(e)), JSON.stringify(r.json?.ledger))
	check('missing ledger entry: the human report lists it', /✗ .*sort-inbox/.test(run(lib).raw), run(lib).raw.slice(0, 400))
}
{
	// Both at once still exits 1, and reports both rather than stopping at the
	// first. A command that short-circuits makes you run it twice to learn what
	// is wrong.
	const lib = mkLibrary('both-broken')
	init(lib)
	const catalog = catalogOf(lib)
	catalog.categories[0].skills = []
	writeFileSync(join(lib, 'catalog.json'), JSON.stringify(catalog, null, 2) + '\n')
	rmSync(join(lib, 'ledger', 'sort-inbox.json'))

	const r = runJson(lib)
	check('both halves broken: exit 1', r.code === 1, `exit ${r.code}`)
	check('both halves broken: catalog reported', r.json?.catalog?.ok === false, JSON.stringify(r.json?.catalog))
	check('both halves broken: ledger reported too, not short-circuited', r.json?.ledger?.ok === false, JSON.stringify(r.json?.ledger))
}

// ── install checking is ledger's, handed through rather than re-parsed ──────
{
	const lib = mkLibrary('install-passthrough')
	init(lib)
	const r = run(lib, ['--install-root', join(ROOT, 'anywhere')])
	check('--install-root without --install is refused', r.code === 2, `exit ${r.code} ${r.raw.slice(0, 200)}`)
	check('--install-root without --install says why', /nothing would look there/.test(r.raw), r.raw.slice(0, 200))
}
{
	// With --install and a root nothing is symlinked into, the entries init
	// wrote carry install: null — never looked — and asking now finds
	// "not installed". Those differ, so the check reports a mismatch, which is
	// the passthrough working rather than a fault.
	const lib = mkLibrary('install-on')
	init(lib)
	const emptyRoot = join(ROOT, 'install-on-root')
	mkdirSync(emptyRoot, { recursive: true })
	const off = runJson(lib)
	const on = runJson(lib, ['--install', '--install-root', emptyRoot])
	check('--install off: ledger clean', off.json?.ledger?.ok === true, JSON.stringify(off.json?.ledger))
	check('--install on: the flag reached ledger', on.json?.ledger?.ok === false, JSON.stringify(on.json?.ledger))
	check('--install on: and the mismatch is the install section', (on.json?.ledger?.errors ?? []).some((e) => /\.install/.test(e)), JSON.stringify(on.json?.ledger))
}

// ── the library is named, never inferred ────────────────────────────────────
{
	const lib = mkLibrary('named')
	init(lib)
	const elsewhere = mkdtempSync(join(tmpdir(), 'check-cwd-'))
	const r = spawnSync(process.execPath, [SRC, '--library', lib, '--json'], { cwd: elsewhere, encoding: 'utf8' })
	check('--library wins over the working directory', r.status === 0, (r.stdout + r.stderr).slice(0, 300))
}
{
	const lib = mkLibrary('env-named')
	init(lib)
	const r = spawnSync(process.execPath, [SRC, '--json'], {
		cwd: ROOT,
		encoding: 'utf8',
		env: { ...process.env, SKILL_LIBRARY: lib }
	})
	check('SKILL_LIBRARY is honoured when no flag names one', r.status === 0, (r.stdout + r.stderr).slice(0, 300))
}
{
	const r = spawnSync(process.execPath, [SRC, '--library'], { encoding: 'utf8' })
	check('--library with no value is refused, exit 2', r.status === 2, `exit ${r.status}`)
	check('--library with no value says what it needed', /needs a directory/.test(r.stdout + r.stderr), (r.stdout + r.stderr).slice(0, 200))
}

// ── a half that cannot be run is a 2, not a clean report ───────────────────
//
// The failure mode worth guarding: a missing sibling makes one of the two
// questions unanswerable, and answering the other one and printing "clean"
// would be the most dangerous possible output from a gate.
{
	const lib = mkLibrary('lonely')
	init(lib)
	const lonely = mkdtempSync(join(tmpdir(), 'check-lonely-'))
	writeFileSync(join(lonely, 'check-library.mjs'), readFileSync(SRC, 'utf8'))
	// check-catalog.mjs is copied; ledger.mjs deliberately is not.
	writeFileSync(join(lonely, 'check-catalog.mjs'), readFileSync(join(HERE, 'check-catalog.mjs'), 'utf8'))
	const r = spawnSync(process.execPath, [join(lonely, 'check-library.mjs'), '--library', lib], { encoding: 'utf8' })
	const raw = (r.stdout ?? '') + (r.stderr ?? '')
	check('absent ledger.mjs: exit 2, not 0', r.status === 2, `exit ${r.status} ${raw.slice(0, 200)}`)
	check('absent ledger.mjs: never prints clean', !/clean/.test(raw), raw.slice(0, 300))
	check('absent ledger.mjs: names the file it wanted', /ledger\.mjs not found/.test(raw), raw.slice(0, 300))
	check('absent ledger.mjs: says where it looked', /looked at /.test(raw), raw.slice(0, 300))
	check('absent ledger.mjs: no stack trace', !/ERR_MODULE_NOT_FOUND/.test(raw), raw.slice(0, 300))
	check('absent ledger.mjs: nothing was left behind in the library', !existsSync(join(lib, 'edges.json')), 'wrote into the library')
}

console.log(`\n${pass} passed, ${failures.length} failed`)
for (const f of failures) console.log(`  FAIL  ${f}`)
process.exit(failures.length ? 1 : 0)
