#!/usr/bin/env node
//
// check-catalog.mjs — does every held skill have a home, and does every
// declared edge resolve to something real.
//
//   node scripts/check-catalog.mjs
//
// Extracted from the atlas build when it was retired (SK-51): that script's
// refusal conditions were never really about the SVG page — an unfiled skill
// or a broken edge is wrong whether or not anything renders it. This is the
// half that was validation wearing a renderer's clothes, pulled out so
// promote.mjs (which runs it before a skill lands) and the skill-adopt /
// skill-new gates (which cite it) keep a real check to point at, and so
// check.mjs can keep it true afterwards as the `catalog` gate.
//
// Deliberately does not need the vault, ledger/, or nexus — none of those
// bear on "is this skill filed, does this edge point at something real."
// Resolves the repo from its own location, so a copy dropped into a fixture
// repo's scripts/ checks that fixture (promote.test.mjs relies on this).
//
// Exit 0 when every skill is filed and every edge resolves and is typed
// correctly. Exit 1 otherwise. Plain Node, no dependencies.

import { existsSync, readFileSync, readdirSync, realpathSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

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

// ── the library ─────────────────────────────────────────────────────────────
//
// SK-97. Until the split this was `dirname(...)` of this file's own location,
// because the tool lived inside the one library it would ever act on. It does
// not any more, so the root cannot be inferred from where this script sits —
// it is named, or it is the working directory, and either way it is a thing
// the caller can see and change.
function resolveLibrary(argv = process.argv.slice(2)) {
	const i = argv.indexOf('--library')
	if (i !== -1) {
		const value = argv[i + 1]
		if (!value || value.startsWith('--')) {
			console.error(refusalLine('--library needs a directory'))
			process.exit(2)
		}
		return resolve(value)
	}
	return resolve(process.env.SKILL_LIBRARY ?? process.cwd())
}

const LIBRARY = resolveLibrary()

// -------------------------------------------------------------- frontmatter

// The same deliberately small YAML subset the atlas build used: `key: value`
// only. Only `description` and `disable-model-invocation` are read here —
// `name` is unused because checkEdges works in directory names, not the
// frontmatter name, and a skill's directory name is what edges.json and
// catalog.json both name it by.
function parseFrontmatter(text) {
	if (!text.startsWith('---')) return {}
	const end = text.indexOf('\n---', 3)
	if (end === -1) return {}
	const out = {}
	for (const line of text.slice(4, end).split('\n')) {
		const colon = line.indexOf(':')
		if (colon === -1 || /^\s/.test(line)) continue
		const key = line.slice(0, colon).trim()
		if (key) out[key] = line.slice(colon + 1).trim().replace(/^["']|["']$/g, '')
	}
	return out
}

// Skills, REJECTED.md rows and the catalog are read by readSkillsFrom /
// readRejectedFrom below, parameterised by repo root so the same code checks
// a fixture repo in a test.

// ------------------------------------------------------------------- edges

// Why this is checked at all: an edge's type encodes a constraint the
// harness enforces at runtime. A model-invoked skill can be reached by
// another skill; a manual-only one can be reached by nothing but a human
// typing its name. Write an operative edge at a manual-only target and the
// instruction is dead on arrival — it fails silently, at the moment it was
// supposed to help, and nothing in a diagram would ever show it.
export function checkEdges({ skills, edges, rejected }) {
	const errors = []
	const warnings = []
	const held = new Map(skills.map((s) => [s.name, s]))

	for (const e of edges) {
		const where = e.source ? ` (${e.source})` : ''
		const from = held.get(e.from)
		if (!from) {
			errors.push(`edge from "${e.from}" — no such skill is held${where}`)
			continue
		}

		const target = held.get(e.to)
		const resolves = target || rejected.has(e.to) || e.status === 'gap'
		if (!resolves) {
			errors.push(
				`${e.from} → ${e.to} — target resolves to nothing: not held, no REJECTED.md row, and not declared "status": "gap"${where}`
			)
			continue
		}

		if (e.type === 'operative') {
			if (!target) {
				errors.push(`${e.from} → ${e.to} — operative edges can only point at a held skill${where}`)
			} else if (target.manualOnly) {
				errors.push(
					`${e.from} → ${e.to} — operative edge at a manual-only skill. ${e.to} sets disable-model-invocation, so no skill can reach it and this instruction cannot fire${where}`
				)
			} else if (!from.calls.has(e.to)) {
				warnings.push(
					`${e.from} → ${e.to} — declared operative, but the prose never says: Call the Skill tool with "${e.to}"${where}`
				)
			}
		} else if (from.calls.has(e.to)) {
			warnings.push(`${e.from} → ${e.to} — prose invokes it, but the edge is typed "${e.type}"${where}`)
		}
	}

	// Drift the other way: prose naming a sibling that no edge declares.
	// Hyphenated names only — `animate` and `prototype` are ordinary English
	// and `element.animate()` is a real method, so single-word names cannot
	// be matched this way without fabricating edges. A real limit, stated
	// rather than papered over.
	const declared = new Set(edges.map((e) => `${e.from}→${e.to}`))
	const known = [...held.keys(), ...rejected].filter((n) => n.includes('-'))
	for (const s of skills) {
		for (const name of known) {
			if (name === s.name || declared.has(`${s.name}→${name}`)) continue
			if (new RegExp(`(?<![a-z0-9-])${name}(?![a-z0-9-])`).test(s.body)) {
				warnings.push(`${s.name} names "${name}" in its prose, but no edge declares the relationship`)
			}
		}
	}
	return { errors, warnings }
}

// A skill whose catalog.json category id matches nothing real. The build
// used to just fall it into a synthetic "Uncategorised" sector and keep
// going, silently — the exact silent-drop-then-crash shape a skill nobody
// can find via the index is. Refused here instead.
export function unfiledSkills(skills, catalog) {
	const filedIds = new Set((catalog.categories ?? []).map((c) => c.id))
	const catBySkill = new Map((catalog.categories ?? []).flatMap((c) => (c.skills ?? []).map((n) => [n, c.id])))
	return skills.filter((s) => !filedIds.has(catBySkill.get(s.name))).map((s) => s.name)
}

// ------------------------------------------------------------------- main

function main({ repo = LIBRARY } = {}) {
	// SK-97. Both of these were read straight into JSON.parse, because in the
	// library this was written for they always existed. Pointed at a library that
	// has neither, it answered a stranger's first run with an ENOENT stack trace
	// naming a path inside their own tree — SK-86 finding 3, found by the
	// foreign-library suite rather than by reading.
	//
	// The two are not the same kind of absent. A catalog is what this command
	// checks, so its absence is a refusal. Edges are optional — `overlap` already
	// treats them that way — so their absence is simply no declared edges.
	const catalogPath = join(repo, 'catalog.json')
	if (!existsSync(catalogPath)) {
		console.error(refusalLine(`${catalogPath} does not exist — not a skill library, or not one with a catalog`))
		process.exit(2)
	}
	const catalog = JSON.parse(readFileSync(catalogPath, 'utf8'))
	const edgesPath = join(repo, 'edges.json')
	const edges = existsSync(edgesPath) ? (JSON.parse(readFileSync(edgesPath, 'utf8')).edges ?? []) : []
	const skills = readSkillsFrom(repo)

	const unfiled = unfiledSkills(skills, catalog)
	const { errors, warnings } = checkEdges({ skills, edges, rejected: readRejectedFrom(repo) })

	for (const name of unfiled) console.log(`  unfiled: ${name} (add it to catalog.json)`)
	const catBySkill = new Map((catalog.categories ?? []).flatMap((c) => (c.skills ?? []).map((n) => [n, c.id])))
	const byName = new Set(skills.map((s) => s.name))
	for (const name of catBySkill.keys()) if (!byName.has(name)) console.log(`  missing: ${name} (in catalog.json, no such skill)`)

	if (edges.length) console.log(`\n${edges.length} edge(s) — ${errors.length} error(s), ${warnings.length} warning(s)`)
	for (const w of warnings) console.log(`  warn:  ${w}`)
	for (const e of errors) console.log(`  ERROR: ${e}`)

	if (!unfiled.length && !errors.length) {
		console.log(`\n${skills.length} skill(s), ${edges.length} edge(s) — clean`)
	}

	return errors.length || unfiled.length ? 1 : 0
}

function readSkillsFrom(repo) {
	const root = join(repo, 'skills')
	if (!existsSync(root)) return []
	return readdirSync(root)
		.filter((name) => !name.startsWith('.'))
		.filter((name) => existsSync(join(root, name, 'SKILL.md')))
		.map((name) => {
			const text = readFileSync(join(root, name, 'SKILL.md'), 'utf8')
			const fm = parseFrontmatter(text)
			return {
				name,
				manualOnly: String(fm['disable-model-invocation']) === 'true',
				calls: new Set([...text.matchAll(/Call the Skill tool with ["'`]([a-z0-9-]+)["'`]/gi)].map((m) => m[1])),
				body: text,
			}
		})
}

function readRejectedFrom(repo) {
	const path = join(repo, 'REJECTED.md')
	if (!existsSync(path)) return new Set()
	const names = new Set()
	for (const line of readFileSync(path, 'utf8').split('\n')) {
		if (!line.startsWith('|')) continue
		const m = /^\|\s*`([a-z0-9-]+)`/.exec(line)
		if (m) names.add(m[1])
	}
	return names
}

// realpath on both sides: macOS hands out /var/folders/… for a tmpdir whose
// real path is /private/var/…, and a fixture copy run from there must still
// know it is the entry point — same fix ledger.mjs carries.
function invokedAsScript() {
	if (!process.argv[1]) return false
	try {
		return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
	} catch {
		return false
	}
}

if (invokedAsScript()) process.exit(main())

export { main, readSkillsFrom as readSkills, readRejectedFrom as readRejected }
