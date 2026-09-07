#!/usr/bin/env node
//
// One command's output is the next command's input.
//
// Every other suite here hand-authors the record that the command under test
// reads. `promote.test.mjs` writes its own ORIGIN.md, `refresh.test.mjs` writes
// its own, `ledger.test.mjs` writes its own — each one a plausible file that no
// command in this pipeline has ever produced. They agree with each other and
// they do not have to agree with `intake.mjs`, which is the only thing that
// writes an ORIGIN.md in earnest.
//
// They did not agree. `intake.mjs` formats a local source as inline code and a
// remote URL bare; the fixtures all write the bare form, so two readers of the
// Source row — `ledger.mjs` and `refresh.mjs` — captured the backticks as part
// of the path for every path-sourced skill and nothing noticed. `intake.mjs`
// writes the words "repository root" in the Subpath row when a skill came from
// a whole repository; `refresh.mjs` read that as a directory name, so the
// ordinary case reported `subpath-missing` — a false drift report — on every
// refresh. And `refresh.mjs` walked the clone including `.git`, which
// `intake.mjs` excludes twice, so the two halves of the diff were never
// gathered the same way.
//
// Four defects, none reachable by any suite that writes its own fixture. So:
// nothing hand-authored except the skill itself and the human's verdict, and
// one question — does the record each command writes survive being read by the
// command that comes after it?
//
//   node round-trip.test.mjs

import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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

const run = (script, args, cwd) => {
	const r = spawnSync(process.execPath, [join(HERE, script), ...args], { cwd, encoding: 'utf8' })
	return { code: r.status, out: r.stdout ?? '', err: r.stderr ?? '', all: (r.stdout ?? '') + (r.stderr ?? '') }
}

const git = (args, cwd) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' })

// A round trip stops at its first broken hand-off, and everything after it is
// unaskable rather than failing. Say which stage did not produce what the next
// one needed — a suite that answers a broken pipeline with an ENOENT trace is
// the failure mode this repository refuses everywhere else.
class Halt extends Error {}
const needs = (path, why) => {
	if (!existsSync(path)) throw new Halt(why)
	return path
}

const SKILL_MD = `---
name: tidy-notes
description: Rename files in a notes directory to a consistent date-prefixed form. Use when notes filenames have drifted apart.
---

# Tidy notes

## 1 · Read → the notes are read
## 2 · Write → the notes are written

See [references/depth.md](references/depth.md) for the naming rules.
`

// The human's half of the lifecycle, and the only file here that a person
// writes. Everything else is produced by a command and consumed by the next.
const AUDIT_MD = `# Audit · \`tidy-notes\`

| | |
|---|---|
| **Verdict** | ADOPT |
| **Audited** | 2026-09-07 |

## Findings

None.
`

/** A real git repository to fetch from, so intake takes its ordinary path. */
function sourceRepo() {
	const src = mkdtempSync(join(tmpdir(), 'round-trip-src-'))
	writeFileSync(join(src, 'SKILL.md'), SKILL_MD)
	writeFileSync(join(src, 'LICENSE'), 'MIT\n')
	mkdirSync(join(src, 'references'), { recursive: true })
	writeFileSync(join(src, 'references', 'depth.md'), '# Depth\n')
	git(['init', '-q', '.'], src)
	git(['add', '-A'], src)
	git(['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'init'], src)
	return src
}

/** A library, filing the name so the catalog check has nothing to say about it. */
function library({ asGitRepo = false } = {}) {
	const lib = mkdtempSync(join(tmpdir(), 'round-trip-lib-'))
	mkdirSync(join(lib, 'skills'), { recursive: true })
	writeFileSync(
		join(lib, 'catalog.json'),
		JSON.stringify({ categories: [{ id: 'fixture', title: 'Fixture', blurb: 'x', skills: ['tidy-notes'] }] }, null, 2)
	)
	writeFileSync(join(lib, 'edges.json'), JSON.stringify({ edges: [] }, null, 2))
	if (asGitRepo) {
		git(['init', '-q', '.'], lib)
		git(['add', '-A'], lib)
		git(['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'init'], lib)
	}
	return lib
}

const src = sourceRepo()
// Deliberately not a git repository. Version control is the library's choice,
// and `promote` used to abort on `git add` — after the move and the ledger
// write — leaving the work done and the command reporting failure.
const lib = library()

try {
	// ── intake ───────────────────────────────────────────────────────────────
	{
		const r = run('intake.mjs', [src, '--name', 'tidy-notes', '--library', lib])
		check('intake: --library takes a value rather than counting as a second source', !/one source at a time/.test(r.all), r.all.slice(0, 200))
		check('intake: landed in the library it was named, not the one it lives in', existsSync(join(lib, 'inbox', 'tidy-notes', 'SKILL.md')), r.all.slice(0, 300))
		check('intake: wrote the arrival record', existsSync(join(lib, 'inbox', 'tidy-notes', 'ORIGIN.md')), r.all.slice(0, 200))
		check('intake: excluded the clone machinery', !existsSync(join(lib, 'inbox', 'tidy-notes', '.git')))
	}

	// ── audit ────────────────────────────────────────────────────────────────
	{
		const bare = run('audit-skill.mjs', [join(lib, 'inbox', 'tidy-notes')])
		check('audit: read the artefact intake produced', /verdict/i.test(bare.all), bare.all.slice(0, 200))

		// Scanned bare, the only finding is against ORIGIN.md — intake's own
		// arrival record, whose inventory of sha256 hashes reads as long
		// base64-like runs. That is the scanner working: the record is a file in
		// the directory and nothing here exempts a file for having been written
		// by this tool. `--exclude` is how a reader says so, and it still scans
		// and still counts, it only moves where the finding is attributed.
		check('audit: the bare scan flags the record intake wrote, not the skill', /ORIGIN\.md/.test(bare.all), bare.all.slice(-300))

		const r = run('audit-skill.mjs', [join(lib, 'inbox', 'tidy-notes'), '--exclude', 'ORIGIN.md'])
		check('audit: found nothing to block on a benign skill', r.code === 0, r.all.slice(-300))
	}

	needs(join(lib, 'inbox', 'tidy-notes'), 'intake produced no inbox artefact — every later stage is unaskable')
	writeFileSync(join(lib, 'inbox', 'tidy-notes', 'AUDIT.md'), AUDIT_MD)

	// ── promote ──────────────────────────────────────────────────────────────
	let json = null
	{
		// `--library` first, on purpose: its value is a bare path in argv and it
		// is not the skill name. `promote` took the first non-flag argument.
		const r = run('promote.mjs', ['--library', lib, 'tidy-notes', '--json'])
		try { json = JSON.parse(r.out) } catch { /* asserted below */ }
		check('promote: --library before the name still targets the name', json?.name === 'tidy-notes', JSON.stringify(json?.name) + r.all.slice(0, 200))
		check('promote: promoted the artefact intake and audit produced', json?.promoted === true, r.all.slice(0, 400))
		check('promote: moved it into the library', existsSync(join(lib, 'skills', 'tidy-notes', 'SKILL.md')))
		check('promote: emptied the inbox entry', !existsSync(join(lib, 'inbox', 'tidy-notes')))
	}

	// ── promote, on a library that is not a git repository ───────────────────
	{
		check('promote: did not throw when git add could not run', json !== null && !/execFileSync|ENOENT|Uint8Array/.test(JSON.stringify(json ?? {})))
		check('promote: reported the staging failure rather than raising it', json?.staged === false, JSON.stringify(json?.staged))
		check('promote: named why nothing was staged', /not a git repository/.test(json?.stageError ?? ''), JSON.stringify(json?.stageError))
	}

	// ── the ledger entry promote wrote, read as data ──────────────────────────
	{
		const p = needs(join(lib, 'ledger', 'tidy-notes.json'), 'promote wrote no ledger entry — the source it recorded cannot be read back')
		const entry = JSON.parse(readFileSync(p, 'utf8'))
		check('ledger: recorded the source exactly as given', entry.origin?.source === src, JSON.stringify(entry.origin?.source))
		check('ledger: kept no markdown out of the source', !/`/.test(entry.origin?.source ?? ''), JSON.stringify(entry.origin?.source))
		check('ledger: pinned a commit', /^[0-9a-f]{40}$/.test(entry.origin?.commit ?? ''), JSON.stringify(entry.origin?.commit))
	}

	// ── refresh, against the record the pipeline itself wrote ────────────────
	{
		const r = run('refresh.mjs', ['--library', lib, '--json'])
		let out = null
		try { out = JSON.parse(r.out) } catch { /* asserted below */ }
		const result = out?.results?.[0]
		check('refresh: produced a report', result != null, r.all.slice(0, 300))
		check('refresh: reached upstream, rather than fetching a backticked path', result?.status !== 'fetch-failed', JSON.stringify(result))
		check('refresh: did not read "repository root" as a directory name', result?.status !== 'subpath-missing', JSON.stringify(result))
		check('refresh: diffed the pin', result?.status === 'diffed', JSON.stringify(result?.status))
		check('refresh: an untouched upstream reads as clean', result?.clean === true, JSON.stringify(result))
		check('refresh: did not report the clone machinery as upstream content', !(result?.addedUpstream ?? []).some((p) => p.startsWith('.git')), JSON.stringify(result?.addedUpstream))
		check('refresh: the pin matches upstream HEAD', result?.movedCommit === false, JSON.stringify(result?.movedCommit))
	}

	// ── the same promotion, in a library that IS a git repository ────────────
	//
	// The guard above must not have turned staging off for everyone. A silently
	// disabled courtesy is worse than the crash it replaced.
	{
		const gitLib = library({ asGitRepo: true })
		try {
			run('intake.mjs', [src, '--name', 'tidy-notes', '--library', gitLib])
			writeFileSync(join(gitLib, 'inbox', 'tidy-notes', 'AUDIT.md'), AUDIT_MD)
			const r = run('promote.mjs', ['tidy-notes', '--library', gitLib, '--json'])
			let g = null
			try { g = JSON.parse(r.out) } catch { /* asserted below */ }
			check('promote: still stages where there is a git repository to stage into', g?.staged === true, r.all.slice(0, 300))
			const staged = git(['diff', '--cached', '--name-only'], gitLib)
			check('promote: staged the skill', staged.includes('skills/tidy-notes/SKILL.md'), staged)
			check('promote: staged the ledger entry alongside it', staged.includes('ledger/tidy-notes.json'), staged)
		} finally {
			rmSync(gitLib, { recursive: true, force: true })
		}
	}
} catch (e) {
	if (!(e instanceof Halt)) throw e
	failures.push(`round trip stopped — ${e.message}`)
} finally {
	rmSync(src, { recursive: true, force: true })
	rmSync(lib, { recursive: true, force: true })
}

console.log(`\n${pass} passed, ${failures.length} failed`)
for (const f of failures) console.log(`  FAIL  ${f}`)
process.exit(failures.length ? 1 : 0)
