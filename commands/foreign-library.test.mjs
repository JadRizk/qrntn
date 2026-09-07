#!/usr/bin/env node
//
// The library does not contain the tool.
//
// SK-97. This is the case every other suite here structurally cannot reach.
// They all build a fixture library and seed copies of the scripts into it —
// `repo/scripts/ledger.mjs`, `repo/skills/skill-audit/scripts/audit-skill.mjs`
// — reproducing exactly the arrangement the split abolished. Every
// library-rooted lookup then resolves, and a command that can only find its own
// siblings by reaching into somebody else's library passes.
//
// Three real defects survived 454 tests and 23 caught mutations that way:
// `promote` looked for the scanner, the ledger and the catalog check inside the
// library it was pointed at. Pointed at a library that had never heard of this
// tool, it would have refused every skill for reasons that had nothing to do
// with the skill.
//
// So: a library with no copy of the tool anywhere in it, and one question asked
// of every command — does it fail for a reason about the artefact, or for a
// reason about itself?
//
//   node foreign-library.test.mjs

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))

let pass = 0
const failures = []
const check = (name, cond, detail = '') => {
	if (cond) pass++
	else failures.push(`${name}${detail ? ` — ${detail}` : ''}`)
}

const SKILL_MD = `---
name: tidy-notes
description: A fixture skill, used to give the commands something real to act on.
---

# Tidy notes

## 1 · Read → the notes are read
## 2 · Write → the notes are written
`

// A library, and nothing else. No scripts/, no skills/skill-audit/, no copy of
// anything in this directory.
function foreignLibrary() {
	const lib = mkdtempSync(join(tmpdir(), 'foreign-library-'))
	mkdirSync(join(lib, 'skills', 'tidy-notes'), { recursive: true })
	writeFileSync(join(lib, 'skills', 'tidy-notes', 'SKILL.md'), SKILL_MD)
	mkdirSync(join(lib, 'inbox', 'incoming'), { recursive: true })
	writeFileSync(join(lib, 'inbox', 'incoming', 'SKILL.md'), SKILL_MD.replace('tidy-notes', 'incoming'))
	mkdirSync(join(lib, 'ledger'), { recursive: true })
	writeFileSync(
		join(lib, 'catalog.json'),
		JSON.stringify({ categories: [{ id: 'fixture', title: 'Fixture', blurb: 'x', skills: ['tidy-notes'] }] }, null, 2)
	)
	return lib
}

const run = (script, args, cwd) => {
	const r = spawnSync(process.execPath, [join(HERE, script), ...args], { cwd, encoding: 'utf8' })
	return { code: r.status, out: r.stdout ?? '', err: r.stderr ?? '', all: (r.stdout ?? '') + (r.stderr ?? '') }
}

// The sentence that names this suite's purpose: a command may refuse, but never
// because it could not find a part of itself.
const TOOL_MISSING = /(ledger\.mjs not found|skill-audit not found|check-catalog\.mjs not found|ERR_MODULE_NOT_FOUND|Cannot find module)/

const lib = foreignLibrary()
try {
	check('the fixture library contains no copy of the tool', !existsSync(join(lib, 'scripts')) && !existsSync(join(lib, 'skills', 'skill-audit')))

	{
		const r = run('check-catalog.mjs', [], lib)
		check('check-catalog: runs against a library it does not live in', r.code === 0, r.all.slice(0, 200))
		check('check-catalog: does not report a missing part of itself', !TOOL_MISSING.test(r.all), r.all.slice(0, 200))
	}
	{
		const r = run('ledger.mjs', ['--check', '--library', lib])
		check('ledger --check: runs', r.code === 0 || /mismatch/.test(r.all), r.all.slice(0, 200))
		check('ledger --check: does not report a missing part of itself', !TOOL_MISSING.test(r.all), r.all.slice(0, 200))
	}
	{
		const r = run('refresh.mjs', ['--library', lib])
		check('refresh: runs', r.code === 0, r.all.slice(0, 200))
		check('refresh: names the library it acted on', r.out.includes(lib), r.all.slice(0, 200))
		check('refresh: does not report a missing part of itself', !TOOL_MISSING.test(r.all), r.all.slice(0, 200))
	}
	{
		const r = run('usage.mjs', ['--library', lib, '--json'], lib)
		check('usage: runs', r.code === 0, r.all.slice(0, 300))
		check('usage: does not report a missing part of itself', !TOOL_MISSING.test(r.all), r.all.slice(0, 200))
	}
	{
		const r = run('overlap.mjs', ['--library', lib])
		check('overlap: runs', r.code === 0, r.all.slice(0, 200))
		check('overlap: does not report a missing part of itself', !TOOL_MISSING.test(r.all), r.all.slice(0, 200))
	}
	{
		const r = run('audit-skill.mjs', [join(lib, 'skills', 'tidy-notes')])
		check('audit: reads a skill by path', /verdict/i.test(r.all), r.all.slice(0, 200))
		check('audit: does not report a missing part of itself', !TOOL_MISSING.test(r.all), r.all.slice(0, 200))
	}
	{
		// The one that matters. The authored path is the one that calls the
		// scanner, the catalog check AND the ledger, so all three defects show
		// here or nowhere. It is expected to refuse — `incoming` is not filed in
		// catalog.json — but the refusals must be about the artefact.
		const r = run('promote.mjs', ['incoming', '--json'], lib)
		check('promote: starts, rather than dying on module resolution', !/ERR_MODULE_NOT_FOUND/.test(r.all), r.all.slice(0, 300))
		check('promote: refuses for reasons about the artefact, not about itself', !TOOL_MISSING.test(r.all), r.all.slice(0, 400))

		let json = null
		try { json = JSON.parse(r.out) } catch { /* asserted below */ }
		check('promote: still produced a machine-readable report', json !== null, r.all.slice(0, 200))
		const whys = (json?.refusals ?? []).map((x) => x.why)
		check('promote: refused on the catalog entry, the real reason', whys.some((w) => /catalog\.json entry/.test(w)), JSON.stringify(whys))
		check('promote: promoted nothing', json?.promoted === false, JSON.stringify(json?.promoted))
	}
	{
		// intake makes no network call when the source is unreachable, so this
		// exercises argument handling and refusal in a foreign tree without one.
		const r = run('intake.mjs', [], lib)
		check('intake: refuses with a usage line rather than a stack trace', /usage:/.test(r.all) && !/ERR_MODULE_NOT_FOUND/.test(r.all), r.all.slice(0, 200))
	}
	{
		// The door this suite left shut. Every command above is invoked with
		// `--library`, but only the ones that take no positional argument —
		// so the case where a command has to tell a flag's value apart from
		// its own argument was never asked, of either command that has one.
		// Both got it wrong, in opposite directions: `intake` counted the
		// directory as a second source and refused a correct invocation,
		// `promote` read it as the skill name whenever it came first.
		const r = run('intake.mjs', [join(lib, 'no-such-source'), '--library', lib])
		check('intake: --library is a flag with a value, not a second source', !/one source at a time/.test(r.all), r.all.slice(0, 200))
		check('intake: refuses about the source it could not use', /source|fetch|not a/i.test(r.all), r.all.slice(0, 200))
	}
	{
		const r = run('promote.mjs', ['--library', lib, 'incoming', '--json'])
		let json = null
		try { json = JSON.parse(r.out) } catch { /* asserted below */ }
		check('promote: --library before the name still targets the name', json?.name === 'incoming', JSON.stringify(json?.name) + r.all.slice(0, 200))
	}
} finally {
	rmSync(lib, { recursive: true, force: true })
}

console.log(`\n${pass} passed, ${failures.length} failed`)
for (const f of failures) console.log(`  FAIL  ${f}`)
process.exit(failures.length ? 1 : 0)
