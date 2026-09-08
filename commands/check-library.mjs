#!/usr/bin/env node
//
// check-library.mjs — is this library internally consistent?
//
//   node check-library.mjs [--library <dir>] [--install [--install-root <dir>]] [--json]
//
// SK-97 §2. `SURFACE.md` states the question as three clauses: every held skill
// is filed, every declared edge resolves, every ledger entry matches the bytes
// on disk. All three already have an implementation — `check-catalog.mjs`
// answers the first two, `ledger.mjs --check` the third — so this is
// composition and a report, not new logic. Nothing here re-derives a fact
// either of them already produces; a second implementation of "is this skill
// filed" is exactly the drift SURFACE.md's "cannot drift" clause exists to
// prevent.
//
// **Not to be confused with the check.mjs at the repository root.** That one
// runs this project's own gates — every test and mutation self-test — and is
// not shipped; a stranger who installs pratiq has no use for it and no copy of
// it. This one runs against a stranger's library and knows nothing about tests.
// Two different questions that happen to share an English word, kept in two
// files with different names for that reason.
//
// ── the distinction the exit codes carry ────────────────────────────────────
//
// A library that has never been set up is not an inconsistent library. It is a
// folder this tool has not been pointed at yet, and saying "1 mismatch" about
// it would be reporting a library-shaped problem it does not have — the same
// "reason about itself" failure init exists to fix, one level up.
//
//   0   clean
//   1   set up, and inconsistent      — an unfiled skill, a broken edge, a
//                                       ledger entry that no longer matches
//   2   not set up, or not a library  — and the refusal names `pratiq init`
//
// A script consuming this has to tell 1 and 2 apart: "your library is wrong"
// and "you have not made one yet" lead to different next actions, and
// collapsing them is how a CI gate starts lying about which problem it found.
//
// Plain Node, no dependencies.

import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { realpathSync } from 'node:fs'

// ── colour, which is optional ───────────────────────────────────────────────
//
// The import is GUARDED because these scripts are deployed by copying ONE FILE
// into a skill's scripts/ folder, where commands/tint.mjs is simply not beside
// them — promote.test.mjs and refresh.test.mjs both do exactly that, and a
// static import turns it into an ERR_MODULE_NOT_FOUND before main() ever runs.
//
// The fallback is not a degraded mode, it is the SAME STRING tint.mjs produces
// on anything that is not a terminal. Colour was only ever a second copy of a
// word that is already there, so a script running without its sibling loses
// nothing but the escape sequences.
let refusalLine = (message) => `refused: ${message}`
try {
	const mod = await import('./tint.mjs')
	refusalLine = mod.refusalLine
} catch {
	// Deployed alone. Plain text is correct, not a failure.
}

// ── how this was invoked, which is also optional ────────────────────────────
//
// Guarded for the same reason colour is, and it is the same hazard: deployed as
// a single file into a skill's scripts/ folder, invoked-as.mjs is not beside
// this one either.
//
// The fallback is not a degraded mode. A script deployed alone was not reached
// through bin/pratiq.mjs, so PRATIQ_VERB is unset and the module would return
// this exact string anyway.
let invokedAs = () => `node ${basename(fileURLToPath(import.meta.url))}`
try {
	const mod = await import('./invoked-as.mjs')
	invokedAs = () => mod.invokedAs(import.meta.url)
} catch {
	// Deployed alone. Naming the file is correct, not a failure.
}


const HERE = dirname(fileURLToPath(import.meta.url))

export function resolveLibrary(argv = process.argv.slice(2)) {
	const i = argv.indexOf('--library')
	if (i !== -1) {
		const value = argv[i + 1]
		if (!value || value.startsWith('--')) return { error: '--library needs a directory' }
		return { root: resolve(value) }
	}
	return { root: resolve(process.env.SKILL_LIBRARY ?? process.cwd()) }
}

// `process.execPath`, never the bare string 'node'. A PATH lookup is not
// guaranteed to find the interpreter running this file, and under a version
// manager it frequently does not — the defect ee77966 records in promote.mjs,
// not repeated here.
function run(script, args) {
	return spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' })
}

const tail = (r, lines) => {
	const out = ((r.stdout ?? '') + (r.stderr ?? '')).trim()
	if (out) return out.split('\n').slice(-lines).join('\n')
	return r.error ? `${r.error.code ?? r.error.name}: ${r.error.message}` : `exit ${r.status}, no output`
}

// ── the two halves ──────────────────────────────────────────────────────────

export function checkCatalog(library, script = join(HERE, 'check-catalog.mjs')) {
	if (!existsSync(script)) return { ok: false, missing: true, detail: `check-catalog.mjs not found — looked at ${script}` }
	const r = run(script, ['--library', library])
	// Exit 2 from check-catalog means it could not run — the catalog is absent.
	// This command has already established that it is present, so a 2 here is a
	// fault in the tool rather than in the library, and is reported as one.
	if (r.status === 2) return { ok: false, missing: true, detail: tail(r, 3) }
	return { ok: r.status === 0, output: tail(r, 20) }
}

export function checkLedger(library, passthrough = [], script = join(HERE, 'ledger.mjs')) {
	if (!existsSync(script)) return { ok: false, missing: true, detail: `ledger.mjs not found — looked at ${script}` }
	const r = run(script, ['--check', '--library', library, '--json', ...passthrough])
	let parsed = null
	try { parsed = JSON.parse(r.stdout) } catch { /* asserted below */ }
	if (!parsed || !Array.isArray(parsed.errors)) {
		return { ok: false, missing: true, detail: tail(r, 3) }
	}
	return { ok: parsed.errors.length === 0, errors: parsed.errors }
}

// ── is this a library, and has it been set up ───────────────────────────────

// Two absences, and they are not the same answer. No skills/ means this is not
// a skill library at all and init cannot make it one. No catalog.json means it
// is one that has never been set up, which init exists for and is named.
export function readiness(library) {
	if (!existsSync(join(library, 'skills'))) {
		return { ready: false, why: `no skills/ in ${library}`, detail: 'pratiq acts on a library whose skills live in skills/ — this does not look like one' }
	}
	if (!existsSync(join(library, 'catalog.json'))) {
		return { ready: false, why: `${library} has no catalog.json`, detail: 'it has never been set up — run `pratiq init` to file its skills and write its ledger' }
	}
	return { ready: true }
}

export function check(library, passthrough = []) {
	const state = readiness(library)
	if (!state.ready) return { ok: false, code: 2, setUp: false, why: state.why, detail: state.detail }

	const catalog = checkCatalog(library)
	const ledger = checkLedger(library, passthrough)

	// A missing half is not a clean library and not a dirty one — it is this
	// tool being unable to answer, which is a 2 for the same reason an absent
	// catalog is.
	if (catalog.missing || ledger.missing) {
		return {
			ok: false,
			code: 2,
			setUp: true,
			why: 'a part of this tool could not be run',
			detail: [catalog.detail, ledger.detail].filter(Boolean).join(' · '),
			catalog,
			ledger
		}
	}

	const ok = catalog.ok && ledger.ok
	return { ok, code: ok ? 0 : 1, setUp: true, catalog, ledger }
}

// ── main ────────────────────────────────────────────────────────────────────

function invokedAsScript() {
	if (!process.argv[1]) return false
	try {
		return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
	} catch {
		return false
	}
}

function main(argv) {
	if (argv.includes('--help') || argv.includes('-h')) {
		console.log(`usage: ${invokedAs()} [--library <dir>] [--install [--install-root <dir>]] [--json]`)
		return 0
	}
	const lib = resolveLibrary(argv)
	if (lib.error) {
		console.error(refusalLine(lib.error))
		return 2
	}

	// --install and --install-root are ledger's, and are handed through
	// untouched rather than re-parsed. This command owns no opinion about where
	// installed skills live; adding one would be a second place to change when
	// that resolution order changes.
	const passthrough = []
	if (argv.includes('--install')) {
		passthrough.push('--install')
		const i = argv.indexOf('--install-root')
		if (i !== -1) passthrough.push('--install-root', argv[i + 1] ?? '')
	} else if (argv.includes('--install-root')) {
		console.error(refusalLine('--install-root without --install — nothing would look there'))
		return 2
	}

	const result = check(lib.root, passthrough)

	if (argv.includes('--json')) {
		console.log(JSON.stringify({ library: lib.root, ...result }, null, 2))
		return result.code
	}

	if (result.code === 2) {
		console.error(refusalLine(result.why))
		if (result.detail) console.error(`  ${result.detail}`)
		return 2
	}

	// The catalog half already prints a readable report; it is passed through
	// rather than summarised, because a count of problems that does not name
	// them sends the reader to run the other command anyway.
	if (result.catalog.output) console.log(result.catalog.output)
	if (result.ledger.errors.length) {
		console.log(`\nledger — ${result.ledger.errors.length} mismatch(es)`)
		for (const e of result.ledger.errors) console.log(`  ✗ ${e}`)
	}

	console.log(
		result.ok
			? `\n${lib.root} — catalog clean, ledger clean\n`
			: `\n${lib.root} — ${result.catalog.ok ? 'catalog clean' : 'catalog has problems'}, ${result.ledger.ok ? 'ledger clean' : `${result.ledger.errors.length} ledger mismatch(es)`}\n`
	)
	return result.code
}

export const _url = pathToFileURL(fileURLToPath(import.meta.url)).href

if (invokedAsScript()) process.exit(main(process.argv.slice(2)))
