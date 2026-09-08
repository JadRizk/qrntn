#!/usr/bin/env node
//
// init.mjs — make a folder of skills into a library this tool can act on.
//
//   node init.mjs [--library <dir>] [--json]
//
// SK-97 §3. The ninth verb, and it exists because day one measured as a
// refusal. Against what a stranger actually has — a folder of skills, no
// catalog.json, no ledger/, not a git repository — `check-catalog` exits 2 and
// `ledger --check` exits 1, both for reasons about the library not being
// qrntn-shaped rather than about it being inconsistent. That is the "reason
// about itself" failure `foreign-library.test.mjs` exists to prevent, one level
// above the code that suite tests.
//
// It is smaller than it looks, and deliberately so: two things, one of which is
// already written and gated.
//
// **catalog.json, and only if absent.** Every held skill filed into one
// category. Absent means this is a first run; present means someone has already
// decided how their library is organised, and re-filing it would be this tool
// overwriting a human's arrangement with a default. Kept, and said so.
//
// **No edges.json, ever.** `check-catalog.mjs:161` reads it with `existsSync`
// and its comment says absence "is simply no declared edges". An empty file
// would assert "no edges declared" where absence already says exactly that, and
// writing a claim nobody made is the one thing this tool does not do.
//
// **The ledger half already exists.** `ledger.mjs --backfill` writes a
// structural entry per held skill, uses a recorded arrival date where one
// exists, leaves unknowables null rather than inventing them, and already skips
// skills that have an entry. It is spawned rather than imported: `backfill()`
// resolves `heldSkills()` and its write path from ledger.mjs's module scope, so
// an import would act on this tool's own location instead of the library named
// here. The same process boundary promote.mjs uses, for the same reason.
//
// Idempotent, and re-running is a normal thing to do rather than a mistake — a
// library with a catalog but no ledger entry for a skill added yesterday is an
// ordinary state, and a flat refusal on re-run would be hostile. It reports what
// it created against what it left alone, because "nothing happened" and "nothing
// needed to happen" are different answers.
//
// Exit 0 when the library is set up. 1 when the backfill failed. 2 when there is
// nothing here to set up. Plain Node, no dependencies.

import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, writeFileSync } from 'node:fs'
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
// through bin/qrntn.mjs, so QRNTN_VERB is unset and the module would return
// this exact string anyway.
let invokedAs = () => `node ${basename(fileURLToPath(import.meta.url))}`
try {
	const mod = await import('./invoked-as.mjs')
	invokedAs = () => mod.invokedAs(import.meta.url)
} catch {
	// Deployed alone. Naming the file is correct, not a failure.
}


const HERE = dirname(fileURLToPath(import.meta.url))

// ── the library ─────────────────────────────────────────────────────────────
//
// Named, or the place you are standing — never inferred from where this file
// happens to be installed. The same order every other command resolves, and one
// of the two names SHIPPING.md freezes.
export function resolveLibrary(argv = process.argv.slice(2)) {
	const i = argv.indexOf('--library')
	if (i !== -1) {
		const value = argv[i + 1]
		if (!value || value.startsWith('--')) return { error: '--library needs a directory' }
		return { root: resolve(value) }
	}
	return { root: resolve(process.env.SKILL_LIBRARY ?? process.cwd()) }
}

// ── the catalog ─────────────────────────────────────────────────────────────

// Directory names, not frontmatter names. catalog.json and edges.json both name
// a skill by the directory it lives in — check-catalog.mjs says so at :55 and
// resolves it that way — and a skill whose frontmatter name differs from its
// folder is a real thing that exists. Filing it under the wrong one produces an
// "unfiled" and a "missing" for the same skill, which reads as two faults.
export function heldSkillDirs(library) {
	const root = join(library, 'skills')
	if (!existsSync(root)) return []
	return readdirSync(root)
		.filter((name) => !name.startsWith('.'))
		.filter((name) => existsSync(join(root, name, 'SKILL.md')))
		.sort()
}

// One category, holding everything. Not a guess at how someone wants their
// library organised — a shape that satisfies `unfiledSkills` on the first run
// and that a human can split up afterwards, which is the only division of
// labour available to a tool that cannot read intent.
//
// No `vault` key. check-catalog.mjs's header says it "deliberately does not
// need the vault", nothing else here reads one, and a path invented to fill a
// field is a claim this tool did not earn.
export function buildCatalog(skills) {
	return {
		categories: [
			{
				id: 'skills',
				title: 'Skills',
				skills
			}
		]
	}
}

// ── the ledger ──────────────────────────────────────────────────────────────

// `process.execPath`, never the bare string 'node' — a PATH lookup is not
// guaranteed to find the interpreter that is running this file, and under a
// version manager it frequently does not. The same rule promote.mjs was fixed
// to follow.
export function runBackfill(library, ledgerScript = join(HERE, 'ledger.mjs')) {
	if (!existsSync(ledgerScript)) {
		return { ok: false, detail: `ledger.mjs not found beside this script — looked at ${ledgerScript}` }
	}
	const r = spawnSync(process.execPath, [ledgerScript, '--backfill', '--library', library, '--json'], {
		encoding: 'utf8'
	})
	let parsed = null
	try { parsed = JSON.parse(r.stdout) } catch { /* asserted below */ }
	if (r.status !== 0 || !parsed) {
		const out = ((r.stdout ?? '') + (r.stderr ?? '')).trim()
		return { ok: false, detail: out ? out.split('\n').slice(-3).join(' · ') : `exit ${r.status}, no output` }
	}
	return { ok: true, written: parsed.written ?? [], skipped: parsed.skipped ?? [] }
}

// ── main ────────────────────────────────────────────────────────────────────

export function init(library) {
	const skillsDir = join(library, 'skills')
	// A library with no skills/ is not a library this can set up, and inventing
	// the directory would be deciding where someone keeps their skills. Named,
	// and refused, rather than silently creating a shape.
	if (!existsSync(skillsDir)) {
		return { ok: false, code: 2, why: `no skills/ directory in ${library}`, detail: 'there is nothing here to file — qrntn acts on a library whose skills live in skills/' }
	}

	const skills = heldSkillDirs(library)
	const catalogPath = join(library, 'catalog.json')
	const catalogExisted = existsSync(catalogPath)
	if (!catalogExisted) {
		writeFileSync(catalogPath, JSON.stringify(buildCatalog(skills), null, 2) + '\n')
	}

	const backfill = runBackfill(library)
	if (!backfill.ok) {
		return { ok: false, code: 1, why: 'the ledger backfill did not complete', detail: backfill.detail, catalog: catalogExisted ? 'kept' : 'created' }
	}

	return {
		ok: true,
		code: 0,
		catalog: catalogExisted ? 'kept' : 'created',
		skills,
		written: backfill.written,
		skipped: backfill.skipped
	}
}

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
		console.log(`usage: ${invokedAs()} [--library <dir>] [--json]`)
		return 0
	}
	const lib = resolveLibrary(argv)
	if (lib.error) {
		console.error(refusalLine(lib.error))
		return 2
	}

	const result = init(lib.root)

	if (argv.includes('--json')) {
		console.log(JSON.stringify(result, null, 2))
		return result.code
	}

	if (!result.ok) {
		console.error(refusalLine(result.why))
		if (result.detail) console.error(`  ${result.detail}`)
		return result.code
	}

	// What was created against what was already there. A run that changed
	// nothing is a real answer and says so, rather than printing the same line
	// as a run that did all of it.
	console.log(
		result.catalog === 'created'
			? `created  catalog.json — ${result.skills.length} skill(s) filed under "skills"`
			: `kept     catalog.json — already present, not rewritten`
	)
	console.log(
		result.written.length
			? `wrote    ${result.written.length} ledger entr${result.written.length === 1 ? 'y' : 'ies'}${result.skipped.length ? `, kept ${result.skipped.length}` : ''}`
			: `kept     ${result.skipped.length} ledger entr${result.skipped.length === 1 ? 'y' : 'ies'} — nothing missing`
	)
	console.log(`\n${lib.root} is set up. \`qrntn check\` will now report on the library rather than on its absence.\n`)
	return 0
}

export const _url = pathToFileURL(fileURLToPath(import.meta.url)).href

if (invokedAsScript()) process.exit(main(process.argv.slice(2)))
