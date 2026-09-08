#!/usr/bin/env node
//
// refresh.mjs — has upstream moved, for a skill this repo adopted?
//
//   node scripts/refresh.mjs                 refresh every acquired skill
//   node scripts/refresh.mjs <name>           refresh just one
//   node scripts/refresh.mjs --json           print the report, write nothing
//   node scripts/refresh.mjs --dry-run        print what would be written, write nothing
//
// Reports only, the same rule as skill-audit and the same evidentiary
// reason: this clones the source at HEAD into a temp directory, diffs it
// against the hashes recorded at arrival, and writes exactly two fields
// into ledger/<name>.json — origin.upstreamHead and integrity.lastVerified.
// It never touches skills/<name>/ and never updates a pin. A pin is a
// decision someone made about what was audited; this can only ever report
// that the ground under it moved, never decide the pin should move too.
//
// This is the third and last writer ledger/<name>.json gets. promote.mjs
// writes everything at promotion; usage.mjs refreshes `usage` and `install`
// on every run; this refreshes exactly the two fields neither of those
// could ever have written, because neither one reaches the network.
//
// The network call this makes is a shallow `git clone` of a URL this repo
// already recorded as the skill's own source — the same request
// skill-intake already made once, at adoption. Nothing here fetches
// anything this repo does not already point at by name.
//
// What "has it moved" means, precisely. Only ORIGIN.md's arrival inventory
// (full sha256 per file, written by skill-intake) is ever diffed
// file-by-file — that is "the recorded hashes" the ticket means. Where a
// skill predates that convention (five of six held acquisitions do; see
// SK-30's own report) and only carries the older AUDIT.md provenance table,
// the per-file hashes it prints are deliberately truncated for a human to
// eyeball, not full digests, so they are never treated as comparable — this
// falls back to a commit-level check only, and says so.
//
// Plain Node, no dependencies, in keeping with AUTHORING.md.

import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, lstatSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { realpathSync } from 'node:fs'
import { heldSkills, readLedger, writeLedgerSections } from './ledger.mjs'

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

const OWN_LIBRARY = resolveLibrary()

// Which library this acts on, and why it is said out loud.
//
// SK-86 ran this from a foreign working directory and it refreshed *this*
// tree instead, silently, writing ten ledger entries that were noticed only
// because someone read `git status` afterwards. The root was never wrong by
// accident — it was never expressible. So: `--library`, then `SKILL_LIBRARY`,
// then the tree this script lives in, and the answer is printed on every run
// including `--json`. A default that cannot be seen is the bug.
function resolveRoot(argv) {
	const i = argv.indexOf('--library')
	const explicit = i !== -1 ? argv[i + 1] : (process.env.SKILL_LIBRARY ?? null)
	if (i !== -1 && !explicit) {
		console.error(refusalLine('--library needs a directory'))
		process.exit(2)
	}
	const root = explicit ? resolve(explicit) : OWN_LIBRARY
	if (!existsSync(join(root, 'skills'))) {
		console.error(refusalLine(`${root} has no skills/ — not a skill library`))
		process.exit(2)
	}
	return root
}

let LIBRARY = OWN_LIBRARY
let SKILLS_DIR = join(LIBRARY, 'skills')

// ---------------------------------------------------------------- provenance

// firstMatch and the DISPOSITIONS-style regex-tolerance below mirror
// ledger.mjs's own computeOrigin — this needs richer data than that
// function extracts (a subpath, a full per-file inventory where one
// exists), so it re-reads the record itself rather than reaching into the
// ledger for a summary that was deliberately kept thin.
function firstMatch(text, res) {
	for (const re of res) {
		const m = re.exec(text)
		if (m) return m[1].trim()
	}
	return null
}

// Only a table row of the exact shape skill-intake writes — `| `path` | N B
// | `64-hex` |` — ever populates arrivalFiles. The older AUDIT.md format's
// "Files" row prints previews like `` `SKILL.md` `2a99870e61971553…` `` —
// an ellipsis, not a digest — and is never parsed as one; a truncated
// prefix that happens to match is a false "unchanged" waiting to happen,
// which is exactly what this ticket's own gate forbids.
function parseInventoryTable(text) {
	const files = new Map()
	for (const line of text.split('\n')) {
		const m = /^\|\s*`([^`]+)`\s*\|\s*\d+ B\s*\|\s*`([0-9a-f]{64})`\s*\|/.exec(line)
		if (m) files.set(m[1], m[2])
	}
	return files.size ? files : null
}

// The sentinel intake.mjs writes when a skill came from a whole repository.
// Compared case-insensitively and whitespace-loosely because it is prose in a
// markdown cell, not a value anyone promised to keep stable.
const subpathOrRoot = (v) => (v && /^repository root$/i.test(v.trim()) ? null : v)

export function resolveProvenance(skillDir) {
	const originPath = join(skillDir, 'ORIGIN.md')
	if (existsSync(originPath)) {
		const text = readFileSync(originPath, 'utf8')
		return {
			// Backticks stripped, as the Subpath row below has always done.
			// intake.mjs writes a local source as inline code and a remote URL
			// bare, so without the `?` spans this captured ``/path/to/src``
			// whole and the clone below asked git for a repository whose name
			// started with a backtick. Every fixture writes the URL form, which
			// is why the two rows could disagree for as long as they did.
			source: firstMatch(text, [/\|\s*\*\*Source\*\*\s*\|\s*`?([^\n|`]+?)`?\s*\|/]),
			// intake.mjs writes the Subpath cell for a human: a backticked path
			// when there is one, and the words "repository root" when there is
			// not. Read as a path that sentinel becomes `<clone>/repository
			// root`, which never exists, so every skill taken from a whole
			// repository — the ordinary case — reported `subpath-missing`:
			// "upstream no longer has repository root — moved or renamed". A
			// false drift report on every refresh, for the majority of records.
			// The reader is the right side to fix. ORIGIN.md files already
			// written say this, they are meant to be permanent, and the prose
			// is correct for the person the row was written for.
			subpath: subpathOrRoot(firstMatch(text, [/\|\s*\*\*Subpath\*\*\s*\|\s*`?([^\n|`]+?)`?\s*\|/])),
			commit: firstMatch(text, [/\*\*Resolved commit\*\*\s*\|\s*`([0-9a-f]{7,40})`/i]),
			arrivalFiles: parseInventoryTable(text),
			recordPath: 'ORIGIN.md'
		}
	}
	const auditPath = join(skillDir, 'AUDIT.md')
	if (existsSync(auditPath)) {
		const text = readFileSync(auditPath, 'utf8')
		// The older format folds the subpath into the Source cell itself:
		// "`https://…/skills` → `skills/animate/`". Both sides are optional
		// backtick spans; only the arrow means there is a second one.
		const sourceRow = /\|\s*\*\*Source\*\*\s*\|\s*`?([^\n|`]+?)`?(?:\s*→\s*`?([^\n|`]+?)`?)?\s*\|/.exec(text)
		return {
			source: sourceRow?.[1]?.trim() ?? null,
			subpath: sourceRow?.[2]?.trim() ?? null,
			commit: firstMatch(text, [/\*\*Upstream commit\*\*\s*\|\s*`([0-9a-f]{7,40})`/i, /\*\*Clone HEAD\*\*\s*\|\s*`([0-9a-f]{7,40})`/i]),
			// The single-file shape (apple-design): one full SHA-256, and the
			// subpath itself names the one file it belongs to.
			arrivalFiles: (() => {
				const hash = /\*\*SHA-256\*\*\s*\|\s*`([0-9a-f]{64})`/i.exec(text)?.[1]
				const sub = sourceRow?.[2]?.trim()
				return hash && sub ? new Map([[basename(sub), hash]]) : null
			})(),
			recordPath: 'AUDIT.md'
		}
	}
	return null
}

// ------------------------------------------------------------------- fetch

const sha256 = (p) => createHash('sha256').update(readFileSync(p)).digest('hex')

function walkFiles(dir, root = dir, acc = new Map()) {
	for (const e of readdirSync(dir)) {
		// `.git` is the clone's own machinery, never upstream content. intake.mjs
		// excludes it twice — once when it copies the fetched tree and once when
		// it builds the arrival inventory — so a walk that includes it is
		// comparing two different things and reports every object in the
		// repository as "upstream added since you pinned". The two sides of this
		// diff have to be gathered the same way or the diff means nothing.
		if (e === '.git') continue
		const abs = join(dir, e)
		const st = lstatSync(abs)
		if (st.isSymbolicLink()) continue
		if (st.isDirectory()) walkFiles(abs, root, acc)
		else acc.set(relative(root, abs), sha256(abs))
	}
	return acc
}

// A distinct, named outcome for every way this can end — never a thrown
// stack trace, and never a status that could be mistaken for "unchanged"
// when what actually happened is "could not tell".
export function refreshOne(name) {
	const skillDir = join(SKILLS_DIR, name)
	if (!existsSync(skillDir)) return { name, status: 'not-held' }

	const prov = resolveProvenance(skillDir)
	if (!prov?.source) return { name, status: 'no-provenance' }

	const tmp = mkdtempSync(join(tmpdir(), 'refresh-'))
	try {
		const clone = spawnSync('git', ['clone', '--quiet', '--depth', '1', prov.source, tmp], { encoding: 'utf8' })
		if (clone.status !== 0) {
			return { name, status: 'fetch-failed', detail: (clone.stderr || '').trim().split('\n').slice(-3).join(' · ') }
		}

		const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: tmp, encoding: 'utf8' }).trim()
		const moved = prov.commit ? prov.commit !== head : null

		const subRoot = prov.subpath ? join(tmp, prov.subpath) : tmp
		if (!existsSync(subRoot)) return { name, status: 'subpath-missing', subpath: prov.subpath, upstreamHead: head, movedCommit: moved }

		const st = statSync(subRoot)
		const upstreamFiles = st.isDirectory() ? walkFiles(subRoot) : new Map([[basename(subRoot), sha256(subRoot)]])

		if (!prov.arrivalFiles) {
			return { name, status: 'commit-only', upstreamHead: head, pinnedCommit: prov.commit, movedCommit: moved, recordPath: prov.recordPath }
		}

		const adapted = adaptedFilesSet(skillDir)
		const changed = [],
			removedUpstream = []
		for (const [path, hash] of prov.arrivalFiles) {
			if (!upstreamFiles.has(path)) removedUpstream.push(path)
			else if (upstreamFiles.get(path) !== hash) changed.push(path)
		}
		const addedUpstream = [...upstreamFiles.keys()].filter((p) => !prov.arrivalFiles.has(p))
		const genuineDivergence = changed.filter((p) => !adapted.has(p))
		const inconclusive = changed.filter((p) => adapted.has(p))

		return {
			name,
			status: 'diffed',
			upstreamHead: head,
			pinnedCommit: prov.commit,
			movedCommit: moved,
			genuineDivergence,
			inconclusive,
			removedUpstream,
			addedUpstream,
			clean: genuineDivergence.length === 0 && removedUpstream.length === 0 && addedUpstream.length === 0
		}
	} finally {
		rmSync(tmp, { recursive: true, force: true })
	}
}

// Whether `path` was named in AUDIT.md's own "## Changes applied" section —
// a substring check against backtick-quoted mentions, not a structured
// list, because the section is written in prose. Loose on purpose: missing
// a genuine mention (a false "not adapted") is the wrong direction to err —
// a human reads the full report either way — while a false "adapted" would
// silently swallow a real upstream change.
function adaptedFilesSet(skillDir) {
	const path = join(skillDir, 'AUDIT.md')
	if (!existsSync(path)) return new Set()
	const text = readFileSync(path, 'utf8')
	const start = text.search(/^##\s*Changes applied/im)
	if (start === -1) return new Set()
	// Skip past the heading's own line before hunting for the next one — a
	// naive search from `start` matches the "## Changes applied" heading
	// itself at offset 0, ending the section before it began.
	const afterHeadingLine = text.indexOf('\n', start)
	const rest = afterHeadingLine === -1 ? '' : text.slice(afterHeadingLine + 1)
	const end = rest.search(/^##\s/m)
	const section = end === -1 ? rest : rest.slice(0, end)
	const mentioned = new Set()
	for (const m of section.matchAll(/`([a-zA-Z0-9_.\/-]+\.[a-zA-Z0-9]+)`/g)) mentioned.add(m[1])
	return mentioned
}

// -------------------------------------------------------------------- write

// The only two fields this writes, merged into whatever promote.mjs and
// usage.mjs already hold — never a fresh section, or the other writer's
// fields would be lost.
export function recordResult(name, result) {
	const current = readLedger(name, LIBRARY)
	if (!current) return
	const today = new Date().toISOString().slice(0, 10)
	writeLedgerSections(
		name,
		{
			origin: { ...current.origin, upstreamHead: result.upstreamHead ?? current.origin.upstreamHead },
			integrity: { ...current.integrity, lastVerified: today }
		},
		LIBRARY
	)
}

// ---------------------------------------------------------------------- main

function acquiredSkills() {
	return heldSkills(LIBRARY).filter((n) => {
		const ledger = readLedger(n, LIBRARY)
		return ledger?.origin?.kind === 'acquired'
	})
}

function main(argv) {
	// Answered BEFORE the library is resolved, which is the whole bug. Asking a
	// tool how to use it is not a question about a library, and this refused
	// with `not a skill library` and exit 2 — telling a caller who had not yet
	// named a directory that their directory was wrong. Every other verb
	// answers --help from anywhere; this one could only answer it from inside a
	// library it had not been told about.
	if (argv.includes('--help') || argv.includes('-h')) {
		console.log(`usage: ${invokedAs()} [<name>] [--library <dir>] [--json] [--dry-run]`)
		console.log('  with no <name>, refreshes every acquired skill; reports drift, never moves a pin')
		return 0
	}
	const JSON_OUT = argv.includes('--json')
	const DRY = argv.includes('--dry-run')
	LIBRARY = resolveRoot(argv)
	SKILLS_DIR = join(LIBRARY, 'skills')

	// `--library <dir>` puts a bare path in argv; it is not the skill name. Guard
	// the -1 case: without the explicit check, `indexOf` returning -1 makes
	// `libraryAt + 1` equal 0 and silently excludes the first positional, turning
	// every `refresh <name>` into a refresh of everything.
	const libraryAt = argv.indexOf('--library')
	const named = argv.find((a, i) => !a.startsWith('--') && (libraryAt === -1 || i !== libraryAt + 1))
	const targets = named ? [named] : acquiredSkills()

	if (!targets.length) {
		if (JSON_OUT) console.log(JSON.stringify({ library: LIBRARY, results: [] }, null, 2))
		else console.log(`library: ${LIBRARY}\nno acquired skills to refresh`)
		return 0
	}

	if (!JSON_OUT) console.log(`library: ${LIBRARY}`)

	const results = targets.map((name) => refreshOne(name))

	if (!JSON_OUT && !DRY) {
		for (const r of results) if (r.upstreamHead) recordResult(r.name, r)
	}

	if (JSON_OUT) {
		console.log(JSON.stringify({ library: LIBRARY, results }, null, 2))
	} else {
		for (const r of results) {
			if (r.status === 'not-held') console.log(`  ${r.name.padEnd(20)} not a held skill`)
			else if (r.status === 'no-provenance') console.log(`  ${r.name.padEnd(20)} no origin.source recorded — authored, or provenance lost`)
			else if (r.status === 'fetch-failed') console.log(`  ${r.name.padEnd(20)} FETCH FAILED — ${r.detail}`)
			else if (r.status === 'subpath-missing') console.log(`  ${r.name.padEnd(20)} upstream no longer has ${r.subpath} — moved or renamed`)
			else if (r.status === 'commit-only')
				console.log(
					`  ${r.name.padEnd(20)} commit-level only (no per-file arrival hashes in ${r.recordPath}) — ${
						r.movedCommit === null ? 'no pinned commit to compare' : r.movedCommit ? `upstream moved: ${r.pinnedCommit ?? '?'} → ${r.upstreamHead}` : 'unchanged'
					}`
				)
			else if (r.status === 'diffed') {
				if (r.clean) {
					const note = r.movedCommit ? ' (the repo has new commits since, but nothing this skill uses changed)' : ''
					console.log(`  ${r.name.padEnd(20)} clean — matches what was pinned${note}`)
				}
				else {
					console.log(`  ${r.name.padEnd(20)} DIVERGED`)
					for (const f of r.genuineDivergence) console.log(`    upstream changed, you did not adapt it: ${f}`)
					for (const f of r.inconclusive) console.log(`    upstream may have changed — you also adapted it, check by hand: ${f}`)
					for (const f of r.removedUpstream) console.log(`    upstream no longer has: ${f}`)
					for (const f of r.addedUpstream) console.log(`    upstream added since you pinned: ${f}`)
				}
			}
		}
		console.log(DRY ? '\n(--dry-run: nothing written)' : '')
	}

	const hardFailures = results.filter((r) => r.status === 'fetch-failed')
	return hardFailures.length ? 1 : 0
}

function invokedAsScript() {
	if (!process.argv[1]) return false
	try {
		return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
	} catch {
		return false
	}
}

if (invokedAsScript()) process.exit(main(process.argv.slice(2)))
