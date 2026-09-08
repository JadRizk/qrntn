#!/usr/bin/env node
//
// The gate that decides whether any of this actually shipped.
//
//   node smoke.mjs           pack, install, and drive the installed tool
//   node smoke.mjs --keep    leave the sandbox behind for inspection
//
// SK-97 §7. Every other gate in this repository runs the commands out of the
// checkout, where every file exists whether or not `package.json` says it
// ships. This one reduces the tree to what `npm pack` produces, installs that
// into a directory that has never seen this project, and drives it from there.
// The questions it can ask are the ones no other suite can:
//
//   1. does every verb run, and is every failure about the artefact rather than
//      about the tool — the question foreign-library.test.mjs asks of a library,
//      asked one level up, of the package;
//   2. does `init` on a bare folder of skills make `check` pass;
//   3. does the full round trip complete — intake, audit, promote, refresh;
//   4. is nothing written outside the install directory and the target library.
//
// **The empty HOME is the load-bearing part.** promote.test.mjs once passed two
// consecutive full runs on borrowed state — a real `~/.claude/skills/skill-audit`
// that happened to be installed on the machine running it — and only failed when
// that install disappeared mid-session. Every command here runs with HOME
// pointed at an empty directory, so borrowing is not available. Nothing else in
// this project asks that question.
//
// intake fetches from a local git repository built here, not from the network.
// A gate that needs a remote is a gate that fails for reasons about GitHub.
//
// Requires npm and git on PATH; says so plainly if either is missing rather
// than failing somewhere further in. Exit 0 when the package works, 1 otherwise.

import { execFileSync, spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const KEEP = process.argv.includes('--keep')

let pass = 0
const failures = []
const check = (name, cond, detail = '') => {
	if (cond) pass++
	else failures.push(`${name}${detail ? ` — ${detail}` : ''}`)
}

function need(bin, args) {
	const r = spawnSync(bin, args, { encoding: 'utf8' })
	if (r.status !== 0) {
		console.error(`smoke: ${bin} is not usable on this machine — this gate packs and installs, and cannot run without it`)
		process.exit(2)
	}
}
need('npm', ['--version'])
need('git', ['--version'])

const SANDBOX = mkdtempSync(join(tmpdir(), 'pratiq-smoke-'))
const HOME = join(SANDBOX, 'home')
const INSTALL = join(SANDBOX, 'install')
const LIB = join(SANDBOX, 'library')
const SRC = join(SANDBOX, 'source')
for (const d of [HOME, INSTALL, LIB, SRC]) mkdirSync(d, { recursive: true })

const SKILL_MD = `---
name: tidy-notes
description: Rename files in a notes directory to a consistent date-prefixed form. Use when notes filenames have drifted apart.
---

# Tidy notes

### 00 · Scan → files
Look at what is there.
> **Gate:** every file listed.

### 01 · Rename → disk
Do the rename.
> **Gate:** every file matches the new pattern.
`

const git = (args, cwd) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' })

// ── pack, and install what was packed ───────────────────────────────────────

const packed = spawnSync('npm', ['pack', '--pack-destination', SANDBOX], { cwd: HERE, encoding: 'utf8' })
const tarball = (packed.stdout ?? '').trim().split('\n').pop()
check('npm pack produced a tarball', packed.status === 0 && tarball && existsSync(join(SANDBOX, tarball)), (packed.stderr ?? '').slice(-300))

if (!tarball || !existsSync(join(SANDBOX, tarball))) {
	console.error('\nsmoke: nothing to install — the remaining questions are unaskable')
	process.exit(1)
}

writeFileSync(join(INSTALL, 'package.json'), JSON.stringify({ name: 'host', private: true, version: '1.0.0' }, null, 2) + '\n')
// npm's cache and update-notifier live under HOME by default, and would put
// `.npm/` there before pratiq had run once. Pointed elsewhere so the last
// assertion can stay absolute: HOME must be EMPTY, not "empty apart from".
const NPM_CACHE = join(SANDBOX, 'npm-cache')
const installed = spawnSync('npm', ['install', join(SANDBOX, tarball), '--no-audit', '--no-fund', '--cache', NPM_CACHE], {
	cwd: INSTALL,
	encoding: 'utf8',
	env: { ...process.env, HOME, npm_config_cache: NPM_CACHE, npm_config_update_notifier: 'false' }
})
check('the tarball installs into a directory that has never seen this project', installed.status === 0, (installed.stderr ?? '').slice(-400))

const PRATIQ = join(INSTALL, 'node_modules', '.bin', 'pratiq')
check('the bin link exists', existsSync(PRATIQ), PRATIQ)

// Zero dependencies is a claim the README makes; a tarball that quietly pulled
// something in would falsify it here rather than in someone else's lockfile.
const installedDirs = existsSync(join(INSTALL, 'node_modules'))
	? readdirSync(join(INSTALL, 'node_modules')).filter((n) => !n.startsWith('.'))
	: []
check('it brought no dependencies with it', installedDirs.length === 1 && installedDirs[0] === 'pratiq', JSON.stringify(installedDirs))

if (!existsSync(PRATIQ)) {
	console.error('\nsmoke: nothing to run — the remaining questions are unaskable')
	process.exit(1)
}

// Every invocation from here runs the INSTALLED tool with an empty HOME.
const run = (args, cwd = SANDBOX) => {
	const r = spawnSync(PRATIQ, args, { cwd, encoding: 'utf8', env: { ...process.env, HOME } })
	return { code: r.status, raw: (r.stdout ?? '') + (r.stderr ?? '') }
}

// ── 1 · every verb runs, and no failure is about the tool ───────────────────
//
// The verbs are read out of the installed dispatcher rather than listed here,
// so a verb added later is covered without anyone remembering to add it.
const VERBS = [...readFileSync(join(INSTALL, 'node_modules', 'pratiq', 'bin', 'pratiq.mjs'), 'utf8')
	.matchAll(/^\t\['([a-z-]+)', '([\w.-]+)'/gm)].map((m) => m[1])

check('the installed dispatcher offers verbs', VERBS.length >= 9, `found ${VERBS.length}`)

// The installed tool must be able to say which bytes are running, and say the
// same thing the tarball's own manifest says. Asserted here rather than only in
// the checkout because the manifest and the dispatcher travel separately: npm
// writes package.json into every tarball whatever `files` says, and a version
// read from the wrong place would still look right from a checkout.
{
	const declared = JSON.parse(readFileSync(join(INSTALL, 'node_modules', 'pratiq', 'package.json'), 'utf8')).version
	const r = run(['--version'])
	check('the installed tool reports its version', r.code === 0, `exit ${r.code} ${r.raw.slice(0, 200)}`)
	check('and it is the version the installed manifest declares', r.raw.trim() === declared, `${JSON.stringify(r.raw)} vs ${declared}`)
}

// Pointed at a folder with nothing in it. Every verb must reach its own opinion
// about that, and none may fail because a file it needed was not shipped.
const bare = join(SANDBOX, 'bare')
mkdirSync(join(bare, 'skills'), { recursive: true })
for (const verb of VERBS) {
	const r = run([verb, '--library', bare])
	check(`${verb}: runs from the tarball`, !/is missing its implementation/.test(r.raw), r.raw.slice(0, 200))
	check(`${verb}: no module-resolution failure`, !/ERR_MODULE_NOT_FOUND|Cannot find module/.test(r.raw), r.raw.slice(0, 300))
	check(`${verb}: no raw stack trace`, !/^\s+at .+\(.+:\d+:\d+\)$/m.test(r.raw), r.raw.slice(0, 400))
}

// ── 2 · init on a bare folder of skills makes check pass ────────────────────
mkdirSync(join(LIB, 'skills', 'tidy-notes'), { recursive: true })
writeFileSync(join(LIB, 'skills', 'tidy-notes', 'SKILL.md'), SKILL_MD)

check('check refuses a library that was never set up', run(['check', '--library', LIB]).code === 2, run(['check', '--library', LIB]).raw.slice(0, 200))
check('and names init as the thing to do about it', /pratiq init/.test(run(['check', '--library', LIB]).raw), run(['check', '--library', LIB]).raw.slice(0, 200))

const inited = run(['init', '--library', LIB])
check('init exits 0', inited.code === 0, inited.raw.slice(0, 300))
check('init on a bare folder of skills makes check pass', run(['check', '--library', LIB]).code === 0, run(['check', '--library', LIB]).raw.slice(-300))

// ── 3 · the full round trip ─────────────────────────────────────────────────
//
// A local git repository, so intake takes its ordinary path without a network.
writeFileSync(join(SRC, 'SKILL.md'), SKILL_MD)
writeFileSync(join(SRC, 'LICENSE'), 'MIT\n')
git(['init', '-q', '.'], SRC)
git(['add', '-A'], SRC)
git(['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'init'], SRC)

const intake = run(['intake', SRC, '--name', 'sort-inbox', '--library', LIB])
check('intake: fetched into quarantine', existsSync(join(LIB, 'inbox', 'sort-inbox', 'SKILL.md')), intake.raw.slice(0, 300))
check('intake: wrote the arrival record', existsSync(join(LIB, 'inbox', 'sort-inbox', 'ORIGIN.md')), intake.raw.slice(0, 300))
check('intake: excluded the clone machinery', !existsSync(join(LIB, 'inbox', 'sort-inbox', '.git')), 'shipped .git into the inbox')

const audit = run(['audit', join(LIB, 'inbox', 'sort-inbox')])
check('audit: reached a verdict', /verdict/i.test(audit.raw), audit.raw.slice(-300))
check('audit: wrote nothing into the artefact', !existsSync(join(LIB, 'inbox', 'sort-inbox', 'AUDIT.md')), 'audit edited the artefact')

// promote refuses without an adjudicated record, which is the correct answer
// and the one worth asserting: the gate survives being packaged.
const unadjudicated = run(['promote', 'sort-inbox', '--library', LIB])
check('promote: refuses an artefact nobody adjudicated', unadjudicated.code === 1, `exit ${unadjudicated.code} ${unadjudicated.raw.slice(0, 200)}`)
check('promote: and refuses by name rather than by crash', /no AUDIT\.md|refused/.test(unadjudicated.raw), unadjudicated.raw.slice(0, 300))

const refresh = run(['refresh', '--library', LIB])
check('refresh: ran against the pin intake wrote', refresh.code === 0 || /drift|clean|skill/i.test(refresh.raw), `exit ${refresh.code} ${refresh.raw.slice(0, 300)}`)

// ── 4 · nothing written outside the install directory and the library ───────
const homeFiles = []
const walk = (dir) => {
	for (const e of readdirSync(dir, { withFileTypes: true })) {
		const p = join(dir, e.name)
		if (e.isDirectory()) walk(p)
		else homeFiles.push(relative(HOME, p))
	}
}
walk(HOME)
// Absolute, not relative to a baseline. npm's own cache was pointed out of the
// way above precisely so this can be "empty" rather than "empty apart from the
// things we decided not to count", which is how an assertion stops being one.
check('nothing was written into HOME', homeFiles.length === 0, JSON.stringify(homeFiles.slice(0, 10)))

// The installed package must not be written into either — a tool that caches
// into its own node_modules is a tool that behaves differently on second run.
const pkgDir = join(INSTALL, 'node_modules', 'pratiq')
const strayInPackage = readdirSync(pkgDir).filter((n) => !['bin', 'commands', 'package.json', 'README.md', 'LICENSE', 'NOTICE'].includes(n))
check('nothing was written into the installed package', strayInPackage.length === 0, JSON.stringify(strayInPackage))

check('the source repository was not modified', !existsSync(join(SRC, 'ORIGIN.md')) && !existsSync(join(SRC, 'catalog.json')), 'intake wrote back into its source')

// ── report ──────────────────────────────────────────────────────────────────

if (!KEEP) rmSync(SANDBOX, { recursive: true, force: true })
else console.log(`\nsandbox kept at ${SANDBOX}`)

console.log(`\nsmoke: ${pass} passed, ${failures.length} failed`)
for (const f of failures) console.log(`  FAIL  ${f}`)
if (failures.length) {
	console.log('\nA failure here is about the package, not about the code — the same code passes check.mjs.')
	console.log('Most often it is package.json `files`: a script that exists in the checkout and not in the tarball.')
}
process.exit(failures.length ? 1 : 0)
