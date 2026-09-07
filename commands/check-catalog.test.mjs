#!/usr/bin/env node
//
// Known-answer tests for check-catalog.mjs — the gate that says every held
// skill is filed and every declared edge points at something real.
//
// Two layers on purpose. The exported functions are tested on in-memory
// shapes, because that is where the rules live; and the script is run end to
// end against fixture repositories built here, because promote.mjs and
// check.mjs both consume it as a process with an exit code, and "the function
// returns the right list" says nothing about whether the exit code follows.
//
//   node scripts/check-catalog.test.mjs

import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { checkEdges, unfiledSkills } from './check-catalog.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const SCRIPT = join(HERE, 'check-catalog.mjs')

let pass = 0
const failures = []
const check = (name, fn) => {
	try {
		fn()
		pass++
	} catch (e) {
		failures.push(`${name}: ${e.message}`)
	}
}
const ok = (cond, what) => {
	if (!cond) throw new Error(what)
}
const eq = (got, want, what = '') => {
	const g = JSON.stringify(got)
	const w = JSON.stringify(want)
	if (g !== w) throw new Error(`${what} expected ${w}, got ${g}`)
}

// ── in-memory shapes ────────────────────────────────────────────────────────

const skill = (name, { manualOnly = false, calls = [], body = '' } = {}) => ({
	name,
	manualOnly,
	calls: new Set(calls),
	body,
})
const edge = (from, to, type = 'referential', extra = {}) => ({ from, to, type, when: 'x', source: 'fixture', ...extra })

check('a clean graph has no errors and no warnings', () => {
	const r = checkEdges({
		skills: [skill('a', { calls: ['b'] }), skill('b')],
		edges: [edge('a', 'b', 'operative')],
		rejected: new Set(),
	})
	eq(r.errors, [], 'errors')
	eq(r.warnings, [], 'warnings')
})

check('an edge from a skill that is not held is an error', () => {
	const r = checkEdges({ skills: [skill('b')], edges: [edge('ghost', 'b')], rejected: new Set() })
	eq(r.errors.length, 1, 'error count')
	ok(r.errors[0].includes('no such skill is held'), r.errors[0])
})

check('a target that resolves to nothing is an error', () => {
	const r = checkEdges({ skills: [skill('a')], edges: [edge('a', 'nowhere')], rejected: new Set() })
	eq(r.errors.length, 1, 'error count')
	ok(r.errors[0].includes('resolves to nothing'), r.errors[0])
})

check('a REJECTED.md row resolves a target', () => {
	const r = checkEdges({ skills: [skill('a')], edges: [edge('a', 'declined-one')], rejected: new Set(['declined-one']) })
	eq(r.errors, [], 'errors')
})

check('a declared gap resolves a target', () => {
	const r = checkEdges({ skills: [skill('a')], edges: [edge('a', 'nowhere', 'referential', { status: 'gap' })], rejected: new Set() })
	eq(r.errors, [], 'errors')
})

check('an operative edge at a manual-only skill is an error — the instruction can never fire', () => {
	const r = checkEdges({
		skills: [skill('a', { calls: ['b'] }), skill('b', { manualOnly: true })],
		edges: [edge('a', 'b', 'operative')],
		rejected: new Set(),
	})
	eq(r.errors.length, 1, 'error count')
	ok(r.errors[0].includes('manual-only'), r.errors[0])
})

check('an operative edge at a rejected skill is an error — only a held skill can be invoked', () => {
	const r = checkEdges({ skills: [skill('a')], edges: [edge('a', 'gone', 'operative')], rejected: new Set(['gone']) })
	eq(r.errors.length, 1, 'error count')
	ok(r.errors[0].includes('only point at a held skill'), r.errors[0])
})

check('an operative edge the prose never invokes is a warning, not an error', () => {
	const r = checkEdges({ skills: [skill('a'), skill('b')], edges: [edge('a', 'b', 'operative')], rejected: new Set() })
	eq(r.errors, [], 'errors')
	eq(r.warnings.length, 1, 'warning count')
	ok(r.warnings[0].includes('the prose never says'), r.warnings[0])
})

check('prose that invokes a sibling over a non-operative edge is a warning', () => {
	const r = checkEdges({ skills: [skill('a', { calls: ['b'] }), skill('b')], edges: [edge('a', 'b', 'referential')], rejected: new Set() })
	eq(r.errors, [], 'errors')
	eq(r.warnings.length, 1, 'warning count')
	ok(r.warnings[0].includes('typed "referential"'), r.warnings[0])
})

check('prose naming a hyphenated sibling with no edge declared is a warning', () => {
	const r = checkEdges({
		skills: [skill('a', { body: 'See also skill-two for the rest.' }), skill('skill-two')],
		edges: [],
		rejected: new Set(),
	})
	eq(r.warnings.length, 1, 'warning count')
	ok(r.warnings[0].includes('no edge declares'), r.warnings[0])
})

check('a single-word sibling named in prose is never matched — animate is English', () => {
	const r = checkEdges({
		skills: [skill('a', { body: 'You may animate the panel.' }), skill('animate')],
		edges: [],
		rejected: new Set(),
	})
	eq(r.warnings, [], 'warnings')
})

check('unfiledSkills: a skill in no category, or in a category that does not exist, is unfiled', () => {
	const catalog = { categories: [{ id: 'core', skills: ['a'] }, { id: 'x', skills: ['c'] }] }
	// 'b' appears nowhere; 'd' is filed under an id no category declares
	const catalogBroken = { categories: [{ id: 'core', skills: ['a', 'd'] }] }
	eq(unfiledSkills([skill('a'), skill('b'), skill('c')], catalog), ['b'], 'missing from every category')
	eq(unfiledSkills([skill('a'), skill('d')], catalogBroken), [], 'filed in a declared category')
	eq(unfiledSkills([skill('a')], { categories: [] }), ['a'], 'no categories at all')
})

// ── end to end, as promote.mjs and check.mjs run it ─────────────────────────

const ROOT = mkdtempSync(join(tmpdir(), 'check-catalog-'))

const SKILL_MD = (name, { manualOnly = false, body = '' } = {}) =>
	`---\nname: ${name}\ndescription: Fixture ${name}.\n${manualOnly ? 'disable-model-invocation: true\n' : ''}---\n\n# ${name}\n\n${body}\n`

function mkRepo(label, { skills = {}, catalog, edges = { edges: [] }, rejected = null } = {}) {
	const repo = join(ROOT, label)
	mkdirSync(join(repo, 'scripts'), { recursive: true })
	cpSync(SCRIPT, join(repo, 'scripts', 'check-catalog.mjs'))
	for (const [name, text] of Object.entries(skills)) {
		mkdirSync(join(repo, 'skills', name), { recursive: true })
		writeFileSync(join(repo, 'skills', name, 'SKILL.md'), text)
	}
	const cat = catalog ?? { categories: [{ id: 'core', title: 'Core', skills: Object.keys(skills) }] }
	writeFileSync(join(repo, 'catalog.json'), JSON.stringify(cat, null, 2))
	writeFileSync(join(repo, 'edges.json'), JSON.stringify(edges, null, 2))
	if (rejected) writeFileSync(join(repo, 'REJECTED.md'), rejected)
	return repo
}

function run(repo) {
	const r = spawnSync('node', [join(repo, 'scripts', 'check-catalog.mjs')], { encoding: 'utf8', cwd: repo })
	return { code: r.status, out: r.stdout + r.stderr }
}

try {
	check('end to end: a filed, well-edged repo exits 0 and says clean', () => {
		const r = run(
			mkRepo('clean', {
				skills: { a: SKILL_MD('a', { body: 'Call the Skill tool with "b".' }), b: SKILL_MD('b') },
				edges: { edges: [{ from: 'a', to: 'b', type: 'operative', when: 'x', source: 'fixture' }] },
			})
		)
		eq(r.code, 0, `exit (${r.out.trim()})`)
		ok(r.out.includes('clean'), r.out)
	})

	check('end to end: an unfiled skill exits 1 and names it', () => {
		const r = run(mkRepo('unfiled', { skills: { a: SKILL_MD('a'), b: SKILL_MD('b') }, catalog: { categories: [{ id: 'core', title: 'Core', skills: ['a'] }] } }))
		eq(r.code, 1, `exit (${r.out.trim()})`)
		ok(r.out.includes('unfiled: b'), r.out)
	})

	check('end to end: a dangling edge exits 1', () => {
		const r = run(mkRepo('dangling', { skills: { a: SKILL_MD('a') }, edges: { edges: [{ from: 'a', to: 'nowhere', type: 'referential', when: 'x', source: 'fixture' }] } }))
		eq(r.code, 1, `exit (${r.out.trim()})`)
		ok(r.out.includes('ERROR'), r.out)
	})

	check('end to end: a REJECTED.md row resolves the edge and exits 0', () => {
		const r = run(
			mkRepo('rejected-row', {
				skills: { a: SKILL_MD('a') },
				edges: { edges: [{ from: 'a', to: 'declined-one', type: 'alternative', when: 'x', source: 'fixture' }] },
				rejected: '# Rejected\n\n| Skill | Source |\n|---|---|\n| `declined-one` | somewhere |\n',
			})
		)
		eq(r.code, 0, `exit (${r.out.trim()})`)
	})

	check('end to end: an operative edge at a manual-only skill exits 1', () => {
		const r = run(
			mkRepo('dead-operative', {
				skills: { a: SKILL_MD('a', { body: 'Call the Skill tool with "b".' }), b: SKILL_MD('b', { manualOnly: true }) },
				edges: { edges: [{ from: 'a', to: 'b', type: 'operative', when: 'x', source: 'fixture' }] },
			})
		)
		eq(r.code, 1, `exit (${r.out.trim()})`)
		ok(r.out.includes('manual-only'), r.out)
	})

	check('end to end: a warning alone still exits 0', () => {
		const r = run(mkRepo('warn-only', { skills: { a: SKILL_MD('a'), b: SKILL_MD('b') }, edges: { edges: [{ from: 'a', to: 'b', type: 'operative', when: 'x', source: 'fixture' }] } }))
		eq(r.code, 0, `exit (${r.out.trim()})`)
		ok(r.out.includes('warn:'), r.out)
	})

	check('end to end: a catalog entry with no skill on disk is reported, not fatal', () => {
		// promote.mjs runs this before the artefact moves out of inbox/, so the
		// name it just filed is in catalog.json and not yet in skills/.
		const r = run(mkRepo('filed-early', { skills: { a: SKILL_MD('a') }, catalog: { categories: [{ id: 'core', title: 'Core', skills: ['a', 'arriving'] }] } }))
		eq(r.code, 0, `exit (${r.out.trim()})`)
		ok(r.out.includes('missing: arriving'), r.out)
	})
} finally {
	rmSync(ROOT, { recursive: true, force: true })
}

console.log(`\n  ${pass} passed · ${failures.length} failed`)
for (const f of failures) console.log(`  ✘ ${f}`)
process.exit(failures.length ? 1 : 0)
