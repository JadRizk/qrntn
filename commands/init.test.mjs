#!/usr/bin/env node
// Tests for init.mjs. Run: node init.test.mjs
//
// Black box against the CLI, same reasoning as the rest of this suite: the CLI
// is what `pratiq init` invokes, and a test that reached past it would be
// testing a different program from the one that ships.
//
// The fixture every case starts from is what SK-97 §3 measured against and what
// a stranger actually has: a folder of skills, no catalog.json, no ledger/, not
// a git repository. If any case here needed more than that to pass, init would
// not be doing the job it exists for.
//
// Expected values are derived by hand from the fixture, never captured from an
// earlier run of this tool.

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const SRC = join(HERE, 'init.mjs')
const CHECK_CATALOG = join(HERE, 'check-catalog.mjs')
const ROOT = mkdtempSync(join(tmpdir(), 'init-test-'))

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

/** What a stranger has: skills/, and nothing else this tool put there. */
function mkLibrary(label, skills = { 'tidy-notes': 'tidy-notes', 'sort-inbox': 'sort-inbox' }) {
	const lib = join(ROOT, label)
	for (const [dir, fmName] of Object.entries(skills)) {
		mkdirSync(join(lib, 'skills', dir), { recursive: true })
		writeFileSync(join(lib, 'skills', dir, 'SKILL.md'), skillMd(fmName))
	}
	if (!Object.keys(skills).length) mkdirSync(join(lib, 'skills'), { recursive: true })
	return lib
}

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
const checkCatalog = (lib) => {
	const r = spawnSync(process.execPath, [CHECK_CATALOG, '--library', lib], { encoding: 'utf8' })
	return { code: r.status, raw: (r.stdout ?? '') + (r.stderr ?? '') }
}

// ── the whole point: a bare folder of skills becomes one `check` can report on ──
//
// SHIPPING.md's §7 acceptance criterion, asserted here rather than left to the
// packaging smoke test: "init on a bare folder of skills makes check pass".
{
	const lib = mkLibrary('fresh')
	check('fresh library: check-catalog refuses before init', checkCatalog(lib).code === 2, JSON.stringify(checkCatalog(lib)))

	const r = runJson(lib)
	check('fresh library: init exits 0', r.code === 0, r.raw.slice(0, 300))
	check('fresh library: catalog was created, not kept', r.json?.catalog === 'created', JSON.stringify(r.json?.catalog))
	check('fresh library: both skills filed', JSON.stringify(catalogOf(lib).categories[0].skills) === JSON.stringify(['sort-inbox', 'tidy-notes']), JSON.stringify(catalogOf(lib)))
	check('fresh library: a ledger entry per skill', existsSync(join(lib, 'ledger', 'tidy-notes.json')) && existsSync(join(lib, 'ledger', 'sort-inbox.json')), 'missing ledger entries')
	check('fresh library: and it says how many it wrote', r.json?.written?.length === 2, JSON.stringify(r.json?.written))

	const after = checkCatalog(lib)
	check('fresh library: check-catalog passes after init', after.code === 0, after.raw.slice(-300))
}

// ── the two things it must never invent ─────────────────────────────────────
{
	const lib = mkLibrary('inventions')
	run(lib)
	check('never writes edges.json — absence already says "no declared edges"', !existsSync(join(lib, 'edges.json')), 'edges.json was created')
	check('never invents a vault root', !('vault' in catalogOf(lib)), JSON.stringify(catalogOf(lib)))
}

// ── idempotent, because re-running is ordinary rather than a mistake ────────
{
	const lib = mkLibrary('rerun')
	run(lib)
	const second = runJson(lib)
	check('re-run: exits 0 rather than refusing', second.code === 0, second.raw.slice(0, 300))
	check('re-run: keeps the catalog', second.json?.catalog === 'kept', JSON.stringify(second.json?.catalog))
	check('re-run: writes no ledger entries', second.json?.written?.length === 0, JSON.stringify(second.json?.written))
	check('re-run: and accounts for the ones already there', second.json?.skipped?.length === 2, JSON.stringify(second.json?.skipped))
	check('re-run: says nothing was missing', /nothing missing/.test(run(lib).raw), run(lib).raw.slice(0, 300))
}

// ── a catalog that already exists is a human's arrangement, not a default ───
{
	const lib = mkLibrary('hand-arranged')
	const arranged = {
		categories: [
			{ id: 'writing', title: 'Writing', skills: ['tidy-notes'] },
			{ id: 'admin', title: 'Admin', skills: ['sort-inbox'] }
		]
	}
	writeFileSync(join(lib, 'catalog.json'), JSON.stringify(arranged, null, 2) + '\n')

	const r = runJson(lib)
	check('existing catalog: kept, not rewritten', r.json?.catalog === 'kept', JSON.stringify(r.json?.catalog))
	check('existing catalog: the two categories survive', catalogOf(lib).categories.length === 2, JSON.stringify(catalogOf(lib)))
	check('existing catalog: filed exactly as the human filed it', catalogOf(lib).categories[0].id === 'writing', JSON.stringify(catalogOf(lib)))
	// The ledger half still runs — a catalog is not evidence that the ledger
	// exists, and refusing the whole verb because one half was done is how a
	// second run stops being useful.
	check('existing catalog: the ledger half still ran', r.json?.written?.length === 2, JSON.stringify(r.json?.written))
	check('existing catalog: and check-catalog passes', checkCatalog(lib).code === 0, checkCatalog(lib).raw.slice(-200))
}

// ── the catalog names a skill by its directory, not its frontmatter ─────────
//
// check-catalog.mjs:55 says catalog.json and edges.json both name a skill by
// the directory it lives in. Filing by the frontmatter name instead produces an
// "unfiled" and a "missing" for the same skill — one fault reported as two —
// and the two names differ often enough to be worth a fixture.
{
	const lib = mkLibrary('name-mismatch', { 'tidy-notes': 'tidy-my-notes' })
	run(lib)
	check('names by directory: the folder name is what is filed', catalogOf(lib).categories[0].skills.includes('tidy-notes'), JSON.stringify(catalogOf(lib)))
	check('names by directory: the frontmatter name is not', !catalogOf(lib).categories[0].skills.includes('tidy-my-notes'), JSON.stringify(catalogOf(lib)))
	const after = checkCatalog(lib)
	check('names by directory: check-catalog reports neither unfiled nor missing', after.code === 0, after.raw.slice(-300))
}

// ── an empty skills/ is a real state; a missing one is not a library ────────
{
	const lib = mkLibrary('empty', {})
	const r = runJson(lib)
	check('empty skills/: exits 0 — a library with no skills yet is a real state', r.code === 0, r.raw.slice(0, 300))
	check('empty skills/: writes the category anyway, as a shape to fill', catalogOf(lib).categories[0].skills.length === 0, JSON.stringify(catalogOf(lib)))
	check('empty skills/: check-catalog passes', checkCatalog(lib).code === 0, checkCatalog(lib).raw.slice(-200))
}
{
	const lib = join(ROOT, 'no-skills-dir')
	mkdirSync(lib, { recursive: true })
	const r = run(lib)
	check('no skills/: refused, exit 2', r.code === 2, `exit ${r.code} ${r.raw.slice(0, 200)}`)
	check('no skills/: the refusal names the directory it wanted', /skills\//.test(r.raw), r.raw.slice(0, 200))
	check('no skills/: nothing was written', !existsSync(join(lib, 'catalog.json')) && !existsSync(join(lib, 'ledger')), 'init wrote into a folder it refused')
	check('no skills/: no stack trace', !/at \w+ \(/.test(r.raw), r.raw.slice(0, 300))
}

// ── the library is named, never inferred from where this file sits ──────────
{
	const lib = mkLibrary('named-library')
	const elsewhere = mkdtempSync(join(tmpdir(), 'init-cwd-'))
	const r = spawnSync(process.execPath, [SRC, '--library', lib, '--json'], { cwd: elsewhere, encoding: 'utf8' })
	check('--library wins over the working directory', r.status === 0 && existsSync(join(lib, 'catalog.json')), (r.stdout + r.stderr).slice(0, 200))
	check('--library: nothing was written where the command was run from', !existsSync(join(elsewhere, 'catalog.json')), 'wrote into cwd')
	check('--library: and nothing into the tool s own tree', !existsSync(join(HERE, 'catalog.json')), 'wrote beside the script')
}
{
	const lib = mkLibrary('env-library')
	const r = spawnSync(process.execPath, [SRC, '--json'], {
		cwd: ROOT,
		encoding: 'utf8',
		env: { ...process.env, SKILL_LIBRARY: lib }
	})
	check('SKILL_LIBRARY is honoured when no flag names one', r.status === 0 && existsSync(join(lib, 'catalog.json')), (r.stdout + r.stderr).slice(0, 200))
}
{
	const r = spawnSync(process.execPath, [SRC, '--library'], { encoding: 'utf8' })
	check('--library with no value is refused, exit 2', r.status === 2, `exit ${r.status}`)
	check('--library with no value says what it needed', /needs a directory/.test(r.stdout + r.stderr), (r.stdout + r.stderr).slice(0, 200))
}

// ── what counts as a held skill is SKILL.md, not a directory ───────────────
//
// The same rule every other command uses. A folder under skills/ without a
// SKILL.md is not a skill — filing it would put a name in catalog.json that
// check-catalog then reports as "missing", so a stray directory would become a
// failing gate rather than a thing being ignored.
{
	const lib = mkLibrary('stray-dirs')
	mkdirSync(join(lib, 'skills', 'not-a-skill'), { recursive: true })
	writeFileSync(join(lib, 'skills', 'not-a-skill', 'README.md'), '# notes\n')
	mkdirSync(join(lib, 'skills', '.hidden'), { recursive: true })
	writeFileSync(join(lib, 'skills', '.hidden', 'SKILL.md'), skillMd('hidden'))

	run(lib)
	const filed = catalogOf(lib).categories[0].skills
	check('stray directory without SKILL.md is not filed', !filed.includes('not-a-skill'), JSON.stringify(filed))
	check('dot-directory is not filed', !filed.includes('.hidden'), JSON.stringify(filed))
	check('the real skills still are', JSON.stringify(filed) === JSON.stringify(['sort-inbox', 'tidy-notes']), JSON.stringify(filed))
	check('stray directories: check-catalog reports nothing missing', checkCatalog(lib).code === 0, checkCatalog(lib).raw.slice(-300))
}

// ── the ledger half is a sibling, and its absence is named ─────────────────
//
// init spawns ledger.mjs from beside itself. Copied somewhere that sibling is
// not, the failure has to be a refusal that names it rather than a half-done
// library: the catalog would already be written by then, and a run that reports
// success having done half the job is worse than one that refuses.
{
	const lib = mkLibrary('no-ledger-sibling')
	const lonely = mkdtempSync(join(tmpdir(), 'init-lonely-'))
	writeFileSync(join(lonely, 'init.mjs'), readFileSync(SRC, 'utf8'))
	const r = spawnSync(process.execPath, [join(lonely, 'init.mjs'), '--library', lib], { encoding: 'utf8' })
	const raw = (r.stdout ?? '') + (r.stderr ?? '')
	check('absent ledger.mjs: refused, exit 1', r.status === 1, `exit ${r.status} ${raw.slice(0, 200)}`)
	check('absent ledger.mjs: named, not crashed', /ledger\.mjs not found/.test(raw), raw.slice(0, 300))
	check('absent ledger.mjs: says where it looked', /looked at /.test(raw), raw.slice(0, 300))
	check('absent ledger.mjs: no module-resolution stack trace', !/ERR_MODULE_NOT_FOUND/.test(raw), raw.slice(0, 300))
}

console.log(`\n${pass} passed, ${failures.length} failed`)
for (const f of failures) console.log(`  FAIL  ${f}`)
process.exit(failures.length ? 1 : 0)
