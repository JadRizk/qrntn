#!/usr/bin/env node
// Tests for intake. Run: node intake.test.mjs
//
// Sources are local git repositories built in a temp directory, so the suite
// runs offline and the fixtures are hostile on purpose. As with promote, each
// case builds a whole fake repo at the depth intake.mjs ships at, because every
// path it uses is derived from its own location.
//
// The rule from AUTHORING.md holds: a fixture must fail for the reason claimed,
// so each refusal asserts the message rather than only the exit code. A script
// whose job is refusing has to refuse for the right reason, or the next person
// removes the wrong guard.

import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const SRC = join(HERE, 'intake.mjs')
const ROOT = mkdtempSync(join(tmpdir(), 'intake-test-'))

let pass = 0
const failures = []
const check = (name, cond, detail = '') => {
	if (cond) pass++
	else failures.push(`${name}${detail ? ` — ${detail}` : ''}`)
}

const SKILL_MD = `---
name: tidy-notes
description: Rename files in a notes directory to a consistent date-prefixed form. Use when notes filenames have drifted apart.
---

# Tidy notes
`

const git = (cwd, args) => execFileSync('git', args, { cwd, stdio: 'ignore' })

/** A real local git repo to fetch from. */
function mkSource(label, files, { submodule = false, escapingLink = false } = {}) {
	const dir = join(ROOT, `src-${label}`)
	mkdirSync(dir, { recursive: true })
	for (const [rel, body] of Object.entries(files)) {
		mkdirSync(dirname(join(dir, rel)), { recursive: true })
		writeFileSync(join(dir, rel), body)
	}
	if (submodule) writeFileSync(join(dir, '.gitmodules'), '[submodule "x"]\n  path = x\n  url = https://example.com/x\n')
	if (escapingLink) symlinkSync('../../../../etc/passwd', join(dir, 'escape.md'))
	git(dir, ['init', '--quiet'])
	git(dir, ['config', 'user.email', 't@t.t'])
	git(dir, ['config', 'user.name', 't'])
	git(dir, ['add', '-A'])
	git(dir, ['commit', '--quiet', '-m', 'x'])
	return dir
}

/** A fake repo with intake.mjs at its shipping depth. */
function mkHost(label) {
	const repo = join(ROOT, `host-${label}`)
	mkdirSync(join(repo, 'skills', 'skill-intake', 'scripts'), { recursive: true })
	cpSync(join(HERE, 'intake.mjs'), join(repo, 'skills', 'skill-intake', 'scripts', 'intake.mjs'))
	return repo
}

// SK-97: intake resolves its library from the working directory now, not from
// where the script sits, so the host is passed as cwd rather than as a depth to
// copy the script into. This exercises the default path — the one a stranger
// takes when they run `npx pratiq intake` inside their own library.
function intake(host, args) {
	const r = spawnSync('node', [SRC, ...args], { cwd: host, encoding: 'utf8' })
	return { code: r.status, out: r.stdout, err: r.stderr, all: r.stdout + r.stderr }
}

// ── the happy path ──────────────────────────────────────────────────────────
{
	const src = mkSource('ok', { 'SKILL.md': SKILL_MD, 'references/depth.md': '# depth\n' })
	const host = mkHost('ok')
	const r = intake(host, [src, '--name', 'tidy-notes'])
	const dest = join(host, 'inbox', 'tidy-notes')

	check('clean source: exits 0', r.code === 0, `exit ${r.code} ${r.err}`)
	check('clean source: SKILL.md landed', existsSync(join(dest, 'SKILL.md')))
	check('clean source: nested file landed', existsSync(join(dest, 'references', 'depth.md')))
	check('clean source: ORIGIN.md written', existsSync(join(dest, 'ORIGIN.md')))
	check('clean source: .git not copied', !existsSync(join(dest, '.git')))

	const origin = readFileSync(join(dest, 'ORIGIN.md'), 'utf8')
	check('origin records a 40-char commit', /\*\*Resolved commit\*\*\s*\|\s*`[0-9a-f]{40}`/.test(origin), origin.slice(0, 200))
	const want = createHash('sha256').update(SKILL_MD).digest('hex')
	check('origin records the arrival hash', origin.includes(want), 'SKILL.md hash absent')

	// The defining property: the artefact's own text must never be echoed.
	check('nothing from the artefact is printed', !r.all.includes('Tidy notes'), r.all.slice(0, 200))
}

// ── refusals ────────────────────────────────────────────────────────────────
{
	const r = intake(mkHost('http'), ['http://example.com/x/y', '--name', 'x'])
	check('plain http: refused', /use https/.test(r.err), r.all.slice(0, 160))
	check('plain http: exits 2', r.code === 2, `exit ${r.code}`)
}
{
	const r = intake(mkHost('notgit'), [join(ROOT, 'nope'), '--name', 'x'])
	check('not a git source: refused', /not a source this understands/.test(r.err), r.all.slice(0, 160))
}
{
	const src = mkSource('badname', { 'SKILL.md': SKILL_MD })
	const r = intake(mkHost('badname'), [src, '--name', '../escape'])
	check('name escaping the inbox: refused', /unusable skill name/.test(r.err), r.all.slice(0, 160))
}
{
	const src = mkSource('badsub', { 'SKILL.md': SKILL_MD })
	const r = intake(mkHost('badsub'), [src, '--name', 'x', '--subpath', '../../etc'])
	check('subpath escaping the repo: refused', /subpath must stay inside/.test(r.err), r.all.slice(0, 160))
}
{
	const src = mkSource('sub', { 'SKILL.md': SKILL_MD }, { submodule: true })
	const r = intake(mkHost('sub'), [src, '--name', 'x'])
	check('submodules: refused', /submodules/.test(r.err), r.all.slice(0, 160))
	check('submodules: exits 2', r.code === 2, `exit ${r.code}`)
}
{
	const src = mkSource('link', { 'SKILL.md': SKILL_MD }, { escapingLink: true })
	const r = intake(mkHost('link'), [src, '--name', 'x'])
	check('symlink leaving the artefact: refused', /symlink escapes/.test(r.err), r.all.slice(0, 160))
	check('symlink leaving the artefact: nothing landed', !existsSync(join(ROOT, 'host-link', 'inbox', 'x', 'SKILL.md')))
}
{
	// Never merge a second fetch onto a first — the result would be bytes from
	// two refs under one hash, and the record would describe neither.
	const src = mkSource('twice', { 'SKILL.md': SKILL_MD })
	const host = mkHost('twice')
	const first = intake(host, [src, '--name', 'tidy-notes'])
	const second = intake(host, [src, '--name', 'tidy-notes'])
	check('first fetch succeeds', first.code === 0, first.all.slice(0, 160))
	check('second fetch onto the same name: refused', /already exists/.test(second.err), second.all.slice(0, 160))
}
{
	const src = mkSource('missing', { 'SKILL.md': SKILL_MD })
	const r = intake(mkHost('missing'), [src, '--name', 'x', '--subpath', 'skills/nope'])
	check('absent subpath: refused', /subpath not present/.test(r.err), r.all.slice(0, 160))
}
{
	const src = mkSource('twoargs', { 'SKILL.md': SKILL_MD })
	const r = intake(mkHost('twoargs'), [src, src, '--name', 'x'])
	check('two sources at once: refused', /one source at a time/.test(r.err), r.all.slice(0, 160))
}

// ── a pasted browser url ────────────────────────────────────────────────────
//
// The url in the address bar when someone finds a skill is the repository url
// with /tree/<ref>/<subpath> on the end, and the README documents intake in
// exactly that form. It used to be handed to git whole and fail on a fetch that
// could never have worked.
//
// Every case here resolves before a single byte leaves the machine — the split,
// the reconciliation and the name derivation all run ahead of fetchAt — so the
// suite stays offline. `example.invalid` is reserved by RFC 2606 and is never
// reached; if one of these ever hangs, something has moved in front of the
// checks and that is itself the finding.
{
	const host = mkHost('weburl')

	// The split, proved by what the name is derived from. With the ref and
	// subpath still on the url, `basename` would take "main" and go to the
	// network; taking it from the repository is only possible after the split.
	const bare = intake(host, ['https://example.invalid/someone/Skills_Repo/tree/main'])
	check(
		'tree url without a subpath: the name comes from the repository',
		/unusable skill name: "Skills_Repo"/.test(bare.err),
		bare.all.slice(0, 200)
	)

	// A flag that disagrees with the url is refused rather than resolved. Both
	// values appear in the message, because the caller has to see which halves
	// of what they typed were in conflict.
	const refClash = intake(host, ['https://example.invalid/someone/skills/tree/main/foo', '--ref', 'v2'])
	check(
		'--ref disagreeing with the url: refused',
		/--ref says "v2" and the url says "main"/.test(refClash.err),
		refClash.all.slice(0, 200)
	)
	check('--ref disagreeing with the url: exits 2', refClash.code === 2, `exit ${refClash.code}`)

	const subClash = intake(host, ['https://example.invalid/someone/skills/tree/main/foo', '--subpath', 'bar'])
	check(
		'--subpath disagreeing with the url: refused',
		/--subpath says "bar" and the url says "foo"/.test(subClash.err),
		subClash.all.slice(0, 200)
	)

	// Agreeing is not disagreeing. This one gets past the reconciliation and
	// fails later, on the name, which is how we know it was allowed through.
	const agree = intake(host, ['https://example.invalid/someone/skills/tree/main/Ok_Name', '--ref', 'main'])
	check(
		'a flag that agrees with the url is not a conflict',
		/unusable skill name/.test(agree.err) && !/pass one or the other/.test(agree.err),
		agree.all.slice(0, 200)
	)

	// A subpath lifted out of a url is no more trusted than one typed as a flag.
	const escaping = intake(host, ['https://example.invalid/someone/skills/tree/main/../../etc'])
	check(
		'a subpath escaping the repo is refused wherever it came from',
		/subpath must stay inside the repo/.test(escaping.err),
		escaping.all.slice(0, 200)
	)

	// A blob url names a file. Guessing at its parent directory would be intake
	// inferring the artefact's boundary from a url.
	const blob = intake(host, ['https://example.invalid/someone/skills/blob/main/foo/SKILL.md'])
	check(
		'blob url: refused, and says why',
		/names a file, not a skill directory/.test(blob.err),
		blob.all.slice(0, 200)
	)

	// GitLab renders the same view one segment further along. Subgroups mean the
	// repository part cannot be a segment count, so the marker has to end it.
	const gitlab = intake(host, ['https://example.invalid/group/sub/Proj/-/tree/main'])
	check(
		'gitlab /-/tree/ with a subgroup path: split at the marker',
		/unusable skill name: "Proj"/.test(gitlab.err),
		gitlab.all.slice(0, 200)
	)

	// A plain repository url still has no ref and no subpath in it, and a repo
	// whose own path contains "tree" is not a tree view.
	const plain = intake(host, ['https://example.invalid/someone/Tree_Things'])
	check(
		'a plain repository url is untouched by the split',
		/unusable skill name: "Tree_Things"/.test(plain.err),
		plain.all.slice(0, 200)
	)
}

// ── the licence, read at the pin ────────────────────────────────────────────
//
// SK-91. The licence has to be captured at intake or it is captured never: read
// later from upstream's HEAD it is a different fact, and this repo already
// holds a skill taken at a commit whose LICENSE named a different copyright
// holder than the same file names today.
{
	const MIT = 'MIT License\n\nCopyright (c) 2026 Some Author\n\nPermission is hereby granted, free of charge, to any person obtaining a copy\n'
	const src = mkSource('licensed', { 'SKILL.md': SKILL_MD, 'LICENSE': MIT })
	const host = mkHost('licensed')
	const r = intake(host, [src, '--name', 'tidy-notes'])
	const origin = readFileSync(join(host, 'inbox', 'tidy-notes', 'ORIGIN.md'), 'utf8')

	check('licence: identified as MIT', /\*\*License\*\*\s*\|\s*`MIT`/.test(origin), origin.slice(0, 400))
	check('licence: basis says it was read at the pin', /\*\*Licence basis\*\*\s*\|\s*pin — read from `LICENSE`/.test(origin), origin.slice(0, 400))
	check('licence: the notice travels', origin.includes('Copyright (c) 2026 Some Author'), origin.slice(0, 400))
	check('licence: the licence body is not echoed', !r.all.includes('Permission is hereby granted'), r.all.slice(0, 200))
}
{
	const src = mkSource('unlicensed', { 'SKILL.md': SKILL_MD })
	const host = mkHost('unlicensed')
	intake(host, [src, '--name', 'tidy-notes'])
	const origin = readFileSync(join(host, 'inbox', 'tidy-notes', 'ORIGIN.md'), 'utf8')

	check('no licence: recorded as a finding', /none found at this commit/.test(origin), origin.slice(0, 400))
	check('no licence: absence is not read as permission', /not permission/.test(origin), origin.slice(0, 400))
	check('no licence: basis says why', /no licence file at the repository root/.test(origin), origin.slice(0, 400))
}

console.log(`\n${pass} passed, ${failures.length} failed`)
for (const f of failures) console.log(`  FAIL  ${f}`)
process.exit(failures.length ? 1 : 0)
