#!/usr/bin/env node
// Tests for refresh.mjs. Run: node refresh.test.mjs
//
// Black box against the CLI, same reasoning as this repo's other SK-3x
// tests. The "upstream" in every fixture is a real local git repository —
// `git clone` treats a local path exactly like a remote one, so this
// exercises the genuine clone-and-diff path with no network access and no
// flakiness. Only manual verification against the real six adopted skills
// touches the network — see ARCHITECTURE.html §04 for why that stays
// outside CI by design.
//
// Expected values are derived by hand from the fixture, never captured from
// an earlier run of this tool.

import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const SRC = join(HERE, 'refresh.mjs')
const LEDGER = join(HERE, 'ledger.mjs')
const ROOT = mkdtempSync(join(tmpdir(), 'refresh-test-'))

let pass = 0
const failures = []
const check = (name, cond, detail = '') => {
	if (cond) pass++
	else failures.push(`${name}${detail ? ` — ${detail}` : ''}`)
}

const sha256 = (s) => createHash('sha256').update(s).digest('hex')

function gitRepo(dir) {
	mkdirSync(dir, { recursive: true })
	execFileSync('git', ['init', '--quiet'], { cwd: dir })
	execFileSync('git', ['config', 'user.email', 't@t.t'], { cwd: dir })
	execFileSync('git', ['config', 'user.name', 't'], { cwd: dir })
}

function gitCommit(dir, msg) {
	execFileSync('git', ['add', '-A'], { cwd: dir })
	execFileSync('git', ['commit', '--quiet', '-m', msg], { cwd: dir })
}

/** A local "upstream" repo with `skills/<name>/` holding `files`. */
function mkUpstream(label, files) {
	const dir = join(ROOT, `${label}-upstream`)
	gitRepo(dir)
	const subdir = join(dir, 'skills', 'foo')
	mkdirSync(subdir, { recursive: true })
	for (const [rel, body] of Object.entries(files)) writeFileSync(join(subdir, rel), body)
	gitCommit(dir, 'init')
	return dir
}

const ORIGIN_MD = (source, files) => `# Origin

| | |
|---|---|
| **Source** | ${source} |
| **Subpath** | skills/foo |
| **Resolved commit** | \`0000000000000000000000000000000000000000\` |

## Inventory as it arrived

| Path | Size | sha256 |
|---|---|---|
${Object.entries(files)
	.map(([p, body]) => `| \`${p}\` | ${Buffer.byteLength(body)} B | \`${sha256(body)}\` |`)
	.join('\n')}
`

/** A local "our repo" with `repo/scripts/refresh.mjs` (real, copied). */
function mkRepo(label, { source, arrivalFiles, auditText, ledger } = {}) {
	const repo = join(ROOT, label)
	mkdirSync(join(repo, 'scripts'), { recursive: true })
	cpSync(SRC, join(repo, 'scripts', 'refresh.mjs'))
	cpSync(LEDGER, join(repo, 'scripts', 'ledger.mjs'))
	const skillDir = join(repo, 'skills', 'foo')
	mkdirSync(skillDir, { recursive: true })
	writeFileSync(join(skillDir, 'SKILL.md'), '---\nname: foo\ndescription: fixture\n---\n\n# foo\n')
	if (source !== false) writeFileSync(join(skillDir, 'ORIGIN.md'), ORIGIN_MD(source, arrivalFiles ?? {}))
	if (auditText) writeFileSync(join(skillDir, 'AUDIT.md'), auditText)
	mkdirSync(join(repo, 'ledger'), { recursive: true })
	writeFileSync(
		join(repo, 'ledger', 'foo.json'),
		JSON.stringify(
			ledger ?? {
				origin: { kind: 'acquired', source: null, commit: null, date: null, upstreamHead: null },
				integrity: { fileCount: 0, files: {}, lastVerified: null },
				audit: { verdict: null, counts: null, dispositioned: null, reportPath: null },
				contract: { modelInvocable: true, descBytes: 8, stages: 0, gated: null, tests: null },
				install: { symlinked: false, path: null },
				usage: null
			},
			null,
			2
		)
	)
	return repo
}

// SK-97: the library is named, not inferred from where the script sits.
function run(repo, args = []) {
	const r = spawnSync(process.execPath, [join(repo, 'scripts', 'refresh.mjs'), ...args], { cwd: repo, encoding: 'utf8' })
	return { code: r.status, out: r.stdout, err: r.stderr, raw: r.stdout + r.stderr }
}

function runJson(repo, args = []) {
	const r = run(repo, [...args, '--json'])
	let json = null
	try { json = JSON.parse(r.out) } catch { /* asserted by caller */ }
	return { ...r, json }
}

const readLedgerFile = (repo) => JSON.parse(readFileSync(join(repo, 'ledger', 'foo.json'), 'utf8'))

// ── the clean case: pinned hashes match what upstream has at HEAD ─────────
{
	const files = { 'SKILL.md': 'original\n' }
	const upstream = mkUpstream('clean', files)
	const repo = mkRepo('clean', { source: upstream, arrivalFiles: files })
	const r = runJson(repo)
	check('clean: exits 0', r.code === 0, r.raw)
	check('clean: reported as diffed and clean', r.json?.results?.[0]?.status === 'diffed' && r.json.results[0].clean === true, JSON.stringify(r.json))
	check('clean: no divergence lists populated', r.json.results[0].genuineDivergence.length === 0, JSON.stringify(r.json.results[0]))
}
{
	// The nuance a real run against emilkowalski/skills surfaced: the repo can
	// gain commits elsewhere while the specific files a skill depends on stay
	// byte-identical. movedCommit and clean are independent facts — this
	// asserts both console output and JSON say so, not just one or the other.
	const files = { 'SKILL.md': 'original\n' }
	const upstream = mkUpstream('clean-but-moved', files)
	// Outside skills/foo/ entirely — a sibling skill in the same monorepo
	// changing does not touch this one's subpath at all.
	writeFileSync(join(upstream, 'skills', 'unrelated-sibling.md'), 'a different skill entirely\n')
	gitCommit(upstream, 'unrelated change elsewhere in the repo')
	const repo = mkRepo('clean-but-moved', { source: upstream, arrivalFiles: files })
	const r = runJson(repo)
	check('clean but moved: still reported clean', r.json?.results?.[0]?.clean === true, JSON.stringify(r.json?.results?.[0]))
	check('clean but moved: movedCommit is true even though content is clean', r.json.results[0].movedCommit === true, JSON.stringify(r.json.results[0]))
	const text = run(repo).out
	check('clean but moved: console output names both facts, not just one', /clean/.test(text) && /new commits since/.test(text), text)
}

// ── genuine divergence: upstream changed a file we never touched ──────────
{
	const files = { 'SKILL.md': 'original\n' }
	const upstream = mkUpstream('genuine', files)
	writeFileSync(join(upstream, 'skills', 'foo', 'SKILL.md'), 'upstream changed this\n')
	gitCommit(upstream, 'upstream update')
	const repo = mkRepo('genuine', { source: upstream, arrivalFiles: files })
	const r = runJson(repo)
	check('genuine divergence: not clean', r.json?.results?.[0]?.clean === false, JSON.stringify(r.json))
	check('genuine divergence: SKILL.md flagged as genuine, not inconclusive', r.json.results[0].genuineDivergence.includes('SKILL.md') && r.json.results[0].inconclusive.length === 0, JSON.stringify(r.json.results[0]))
}

// ── inconclusive: upstream changed a file we ALSO adapted ─────────────────
{
	const files = { 'SKILL.md': 'original\n' }
	const upstream = mkUpstream('inconclusive', files)
	writeFileSync(join(upstream, 'skills', 'foo', 'SKILL.md'), 'upstream changed this too\n')
	gitCommit(upstream, 'upstream update')
	const repo = mkRepo('inconclusive', {
		source: upstream,
		arrivalFiles: files,
		auditText: '# Audit\n\n## Changes applied\n\nRewrote `SKILL.md` for clarity.\n'
	})
	const r = runJson(repo)
	check(
		'inconclusive: a file we adapted is separated from genuine divergence',
		r.json?.results?.[0]?.inconclusive?.includes('SKILL.md') && r.json.results[0].genuineDivergence.length === 0,
		JSON.stringify(r.json?.results?.[0])
	)
}

// ── upstream removed a file we still have pinned ───────────────────────────
{
	const files = { 'SKILL.md': 'original\n', 'GONE.md': 'will be removed\n' }
	const upstream = mkUpstream('removed', files)
	execFileSync('git', ['rm', '--quiet', 'skills/foo/GONE.md'], { cwd: upstream })
	gitCommit(upstream, 'remove a file')
	const repo = mkRepo('removed', { source: upstream, arrivalFiles: files })
	const r = runJson(repo)
	check('removed upstream: GONE.md reported', r.json?.results?.[0]?.removedUpstream?.includes('GONE.md'), JSON.stringify(r.json?.results?.[0]))
}

// ── upstream added a file since we pinned ──────────────────────────────────
{
	const files = { 'SKILL.md': 'original\n' }
	const upstream = mkUpstream('added', files)
	writeFileSync(join(upstream, 'skills', 'foo', 'NEW.md'), 'brand new\n')
	gitCommit(upstream, 'add a file')
	const repo = mkRepo('added', { source: upstream, arrivalFiles: files })
	const r = runJson(repo)
	check('added upstream: NEW.md reported', r.json?.results?.[0]?.addedUpstream?.includes('NEW.md'), JSON.stringify(r.json?.results?.[0]))
}

// ── the older AUDIT.md-only format: commit-level check, no per-file diff ──
{
	const files = { 'SKILL.md': 'original\n' }
	const upstream = mkUpstream('legacy', files)
	const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: upstream, encoding: 'utf8' }).trim()
	const repo = mkRepo('legacy', {
		source: false, // no ORIGIN.md at all
		auditText: `# Audit

## Provenance

| | |
|---|---|
| **Source** | \`${upstream}\` → \`skills/foo/\` |
| **Clone HEAD** | \`${head}\`, 2026-01-01T00:00:00Z |
| **Files** | \`SKILL.md\` \`${sha256('original\n').slice(0, 16)}…\` |
`
	})
	const r = runJson(repo)
	check('legacy format: falls back to commit-only', r.json?.results?.[0]?.status === 'commit-only', JSON.stringify(r.json?.results?.[0]))
	check('legacy format: pinned commit matches upstream HEAD, unmoved', r.json.results[0].movedCommit === false, JSON.stringify(r.json.results[0]))
}
{
	// Same legacy shape, but upstream has moved since — the "Clone HEAD" this
	// repo recorded no longer matches upstream's real HEAD.
	const files = { 'SKILL.md': 'original\n' }
	const upstream = mkUpstream('legacy-moved', files)
	const pinnedHead = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: upstream, encoding: 'utf8' }).trim()
	writeFileSync(join(upstream, 'skills', 'foo', 'SKILL.md'), 'moved on\n')
	gitCommit(upstream, 'moved on')
	const repo = mkRepo('legacy-moved', {
		source: false,
		auditText: `# Audit

| | |
|---|---|
| **Source** | \`${upstream}\` → \`skills/foo/\` |
| **Clone HEAD** | \`${pinnedHead}\`, 2026-01-01T00:00:00Z |
`
	})
	const r = runJson(repo)
	check('legacy format: detects the commit moved even with no per-file data', r.json?.results?.[0]?.movedCommit === true, JSON.stringify(r.json?.results?.[0]))
}

// ── error paths: never a stack trace, never a false "unchanged" ────────────
{
	const repo = mkRepo('unreachable', { source: '/nonexistent/path/nothing-here' })
	const r = runJson(repo)
	check('unreachable source: status is fetch-failed, not a crash', r.json?.results?.[0]?.status === 'fetch-failed', r.raw)
	check('unreachable source: process exits non-zero', r.code === 1, `exit ${r.code}`)
	check('unreachable source: a detail message is present', typeof r.json.results[0].detail === 'string' && r.json.results[0].detail.length > 0, JSON.stringify(r.json.results[0]))
}
{
	// A failed fetch must not read as "verified" — lastVerified means the
	// check actually completed, not that it was attempted.
	const repo = mkRepo('unreachable-no-write', { source: '/nonexistent/path/nothing-here' })
	const before = readLedgerFile(repo)
	run(repo, [])
	const after = readLedgerFile(repo)
	check(
		'unreachable source: a real run does not bump lastVerified on a fetch failure',
		after.integrity.lastVerified === before.integrity.lastVerified,
		JSON.stringify({ before: before.integrity, after: after.integrity })
	)
	check('unreachable source: upstreamHead is not set on a fetch failure', after.origin.upstreamHead === before.origin.upstreamHead, JSON.stringify(after.origin))
}
{
	const upstream = mkUpstream('subpath-gone', { 'SKILL.md': 'x\n' })
	const repo = mkRepo('subpath-gone', { source: upstream, arrivalFiles: { 'SKILL.md': 'x\n' } })
	// Rewrite ORIGIN.md's subpath to point at a directory that was never there.
	const originPath = join(repo, 'skills', 'foo', 'ORIGIN.md')
	writeFileSync(originPath, readFileSync(originPath, 'utf8').replace('skills/foo', 'skills/does-not-exist'))
	const r = runJson(repo)
	check('a moved/renamed subpath is reported, not crashed', r.json?.results?.[0]?.status === 'subpath-missing', r.raw)
	check('a moved/renamed subpath still exits 0 (a report, not a fetch failure)', r.code === 0, `exit ${r.code}`)
}
{
	const repo = mkRepo('no-provenance', { source: false })
	const r = runJson(repo)
	check('no ORIGIN.md/AUDIT.md at all: reported, not crashed', r.json?.results?.[0]?.status === 'no-provenance', r.raw)
}
{
	const repo = mkRepo('clean-for-not-held')
	const r = runJson(repo, ['does-not-exist'])
	check('naming a skill that is not held: reported, not crashed', r.json?.results?.[0]?.status === 'not-held', r.raw)
}

// ── writing: exactly two fields, never on --dry-run or --json ─────────────
{
	const files = { 'SKILL.md': 'original\n' }
	const upstream = mkUpstream('writes', files)
	const repo = mkRepo('writes', { source: upstream, arrivalFiles: files })
	const before = readLedgerFile(repo)

	run(repo, ['--json'])
	check('write: --json writes nothing', JSON.stringify(readLedgerFile(repo)) === JSON.stringify(before), 'ledger changed under --json')

	run(repo, ['--dry-run'])
	check('write: --dry-run writes nothing', JSON.stringify(readLedgerFile(repo)) === JSON.stringify(before), 'ledger changed under --dry-run')

	run(repo, [])
	const after = readLedgerFile(repo)
	check('write: a real run sets origin.upstreamHead', typeof after.origin.upstreamHead === 'string' && after.origin.upstreamHead.length > 0, JSON.stringify(after.origin))
	check('write: a real run sets integrity.lastVerified', typeof after.integrity.lastVerified === 'string', JSON.stringify(after.integrity))
	check('write: every other section is untouched', JSON.stringify(after.contract) === JSON.stringify(before.contract) && JSON.stringify(after.install) === JSON.stringify(before.install) && after.usage === before.usage, 'a section this script does not own changed')
	check('write: origin.kind is untouched', after.origin.kind === before.origin.kind, JSON.stringify(after.origin))
}
{
	// Reports only — the skill's own files must never be touched, no matter
	// what the diff finds.
	const files = { 'SKILL.md': 'original\n' }
	const upstream = mkUpstream('never-touches-skill', files)
	writeFileSync(join(upstream, 'skills', 'foo', 'SKILL.md'), 'upstream changed this\n')
	gitCommit(upstream, 'upstream update')
	const repo = mkRepo('never-touches-skill', { source: upstream, arrivalFiles: files })
	const skillMdBefore = readFileSync(join(repo, 'skills', 'foo', 'SKILL.md'), 'utf8')
	run(repo, [])
	const skillMdAfter = readFileSync(join(repo, 'skills', 'foo', 'SKILL.md'), 'utf8')
	check('reports only: the skill directory itself is never modified', skillMdBefore === skillMdAfter, 'skills/foo/SKILL.md changed')
}

// ── which library it acts on ─────────────────────────────────────────────────
//
// SK-86 finding 4: run from a foreign working directory this refreshed the tree
// it lived in and said nothing about it. The root is now expressible and, more
// to the point, always stated.
{
	const files = { 'SKILL.md': 'original\n' }
	const upstream = mkUpstream('rooted', files)
	const host = mkRepo('rooted-host', { source: upstream, arrivalFiles: files })
	const target = mkRepo('rooted-target', { source: upstream, arrivalFiles: files })

	const r = runJson(host, ['--library', target])
	check('library: --library is honoured over the script\'s own tree', r.json?.library === target, r.raw.slice(0, 200))
	check('library: the library is named in --json output', typeof r.json?.library === 'string', r.raw.slice(0, 200))

	const plain = run(host, ['--dry-run'])
	check('library: the default library is stated, not assumed silently', /^library: /m.test(plain.out), plain.raw.slice(0, 200))

	const bad = run(host, ['--library', join(ROOT, 'not-a-library')])
	check('library: a directory with no skills/ is refused', /not a skill library/.test(bad.err), bad.raw.slice(0, 160))
	check('library: refusing a bad root exits 2', bad.code === 2, `exit ${bad.code}`)

	const missing = run(host, ['--library'])
	check('library: --library with no value is refused', /--library needs a directory/.test(missing.err), missing.raw.slice(0, 160))

	// The regression this suite actually caught: with --root absent, indexOf
	// returns -1 and the naive positional filter excluded argv[0], turning
	// `refresh <name>` into a refresh of everything.
	const named = runJson(host, ['does-not-exist'])
	check('library: a named skill is still one target, with no --library present', named.json?.results?.length === 1, named.raw.slice(0, 200))
}

console.log(`\n${pass} passed, ${failures.length} failed`)
for (const f of failures) console.log(`  FAIL  ${f}`)
process.exit(failures.length ? 1 : 0)
