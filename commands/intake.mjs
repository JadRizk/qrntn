#!/usr/bin/env node
// intake — fetch an untrusted skill into quarantine without reading it.
//
//   node intake.mjs <source> [--name X] [--subpath P] [--ref R] [--json]
//
// The whole point of this script is what it does NOT do. It never prints the
// artefact's contents, never summarises what the skill claims to be, never
// executes anything from it, and never resolves a path outside the quarantine
// directory. The artefact reaches disk without passing through anyone's
// context — an agent that has read the payload before the payload was scanned
// has already lost, and no later gate recovers that.
//
// Not `git clone`: init + fetch of an explicit ref, which resolves a branch, a
// tag and a bare SHA through one path and never brings submodules along. A
// submodule is a second repository nobody audited, arriving under the
// authority of the one that was.
//
// Plain Node, no dependencies, in keeping with AUTHORING.md.

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
	cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync,
	readdirSync, readlinkSync, realpathSync, rmSync, writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

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
			console.error('refused: --library needs a directory')
			process.exit(2)
		}
		return resolve(value)
	}
	return resolve(process.env.SKILL_LIBRARY ?? process.cwd())
}

const LIBRARY = resolveLibrary()
const INBOX = join(LIBRARY, 'inbox')

class Refusal extends Error {}
const refuse = (msg) => { throw new Refusal(msg) }

// ── source ───────────────────────────────────────────────────────────────────

// Every git invocation passes an argument array, never a shell string, so a
// source containing shell metacharacters is inert rather than clever. The
// validation below is a second line, not the only one.
const HTTPS_REMOTE = /^https:\/\/[a-zA-Z0-9._-]+\/[a-zA-Z0-9._\/-]+?(?:\.git)?$/
const SAFE_NAME = /^[a-z0-9][a-z0-9-]*$/
const SAFE_REF = /^[A-Za-z0-9._\/-]+$/

function classifySource(src) {
	if (HTTPS_REMOTE.test(src)) return { kind: 'remote', url: src.replace(/\.git$/, '') }
	if (src.startsWith('http://')) refuse('plain http source — use https, or clone it yourself and pass the path')
	const abs = resolve(src)
	if (existsSync(join(abs, '.git'))) return { kind: 'local', url: abs }
	refuse(`not a source this understands: expected an https git URL or a local git checkout, got "${src}"`)
}

// ── fetch ────────────────────────────────────────────────────────────────────

const git = (cwd, args) =>
	execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()

function fetchAt(source, ref) {
	const work = mkdtempSync(join(tmpdir(), 'skill-intake-'))
	git(work, ['init', '--quiet'])
	git(work, ['remote', 'add', 'origin', source.url])
	try {
		git(work, ['fetch', '--depth', '1', '--quiet', 'origin', ref ?? 'HEAD'])
	} catch {
		rmSync(work, { recursive: true, force: true })
		refuse(`could not fetch ${ref ?? 'HEAD'} from ${source.url}`)
	}
	git(work, ['checkout', '--quiet', 'FETCH_HEAD'])
	const sha = git(work, ['rev-parse', 'HEAD'])

	// A moving branch is the rug pull: what was audited and what is installed
	// are then different bytes under the same name. The resolved SHA is the
	// only identity worth recording.
	if (existsSync(join(work, '.gitmodules'))) {
		rmSync(work, { recursive: true, force: true })
		refuse('source declares submodules — a second unaudited repository. Vendor the subpath directly instead.')
	}
	return { work, sha }
}

// ── containment ──────────────────────────────────────────────────────────────

function walk(dir, root, acc = []) {
	for (const entry of readdirSync(dir)) {
		if (entry === '.git') continue
		const abs = join(dir, entry)
		const st = lstatSync(abs)
		if (st.isSymbolicLink()) {
			const target = resolve(dirname(abs), readlinkSync(abs))
			const inside = !relative(root, target).startsWith('..')
			acc.push({ rel: relative(root, abs), symlink: readlinkSync(abs), inside })
			continue
		}
		if (st.isDirectory()) walk(abs, root, acc)
		else acc.push({ rel: relative(root, abs), bytes: st.size })
	}
	return acc
}

const sha256 = (p) => createHash('sha256').update(readFileSync(p)).digest('hex')

// ── licence ──────────────────────────────────────────────────────────────────

// A licence is a fact about the commit that was taken, so it is read here, at
// the pin, and never later from upstream's HEAD — SK-91 measured the reason:
// one of the skills this repo already holds was taken at a commit whose LICENSE
// named a different copyright holder than the same file names today.
//
// This reads and classifies; it does not print the licence body, in keeping
// with everything else here. The notice line travels because MIT and BSD both
// require the copy to carry it, and a notice nobody recorded is a term nobody
// can honour.
const LICENCE_FILES = ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'LICENCE', 'LICENCE.md', 'COPYING']

const LICENCE_PATTERNS = [
	[/\bApache License\b[\s\S]{0,120}?Version 2\.0/i, 'Apache-2.0'],
	[/\bMIT License\b/i, 'MIT'],
	[/\bPermission is hereby granted, free of charge\b/i, 'MIT'],
	[/\bISC License\b/i, 'ISC'],
	[/\bMozilla Public License Version 2\.0\b/i, 'MPL-2.0'],
	[/\bGNU AFFERO GENERAL PUBLIC LICENSE\b/i, 'AGPL-3.0'],
	[/\bGNU GENERAL PUBLIC LICENSE\b/i, 'GPL-3.0'],
	[/\bRedistribution and use in source and binary forms\b/i, 'BSD']
]

function detectLicence(work) {
	for (const file of LICENCE_FILES) {
		const abs = join(work, file)
		if (!existsSync(abs)) continue
		const text = readFileSync(abs, 'utf8')
		const id = LICENCE_PATTERNS.find(([re]) => re.test(text))?.[1] ?? null
		const notice = /^\s*(Copyright\b.*)$/im.exec(text)?.[1]?.trim() ?? null
		return { id, notice, path: file }
	}
	return { id: null, notice: null, path: null }
}

// ── record ───────────────────────────────────────────────────────────────────

function writeOrigin(dest, { source, sha, subpath, ref, files, name, licence }) {
	const inventory = files
		.map((f) =>
			f.symlink
				? `| \`${f.rel}\` | symlink → \`${f.symlink}\` | — |`
				: `| \`${f.rel}\` | ${f.bytes} B | \`${sha256(join(dest, f.rel))}\` |`
		)
		.join('\n')

	writeFileSync(
		join(dest, 'ORIGIN.md'),
		`# Origin · \`${name}\`

Written by \`skill-intake\`. Facts about where this came from, nothing about
what it claims to do — the repository's own description is written by whoever
wrote the payload, so the account of this skill's purpose comes out of the
audit and not out of the source.

| | |
|---|---|
| **Source** | ${source.kind === 'remote' ? source.url : '`' + source.url + '`'} |
| **Ref requested** | ${ref ? '`' + ref + '`' : 'default branch'} |
| **Resolved commit** | \`${sha}\` |
| **License** | ${licence.id ? '`' + licence.id + '`' : '**none found at this commit** — an absent licence is not permission'} |
| **Licence basis** | ${licence.path ? 'pin — read from `' + licence.path + '` at the resolved commit' : 'no licence file at the repository root of the resolved commit'} |${licence.notice ? '\n| **Notice at that pin** | `' + licence.notice + '` |' : ''}
| **Subpath** | ${subpath ? '`' + subpath + '`' : 'repository root'} |
| **Fetched** | ${new Date().toISOString().slice(0, 10)} |
| **Files** | ${files.length} |

## Inventory as it arrived

Hashes are the arrival state. They are expected to stop matching once the skill
is adapted — that divergence is what obliges an adaptation log in \`AUDIT.md\`,
and \`promote.mjs\` refuses when bytes have changed and nothing records why.

| Path | Size | sha256 |
|---|---|---|
${inventory}
`
	)
}

// ── main ─────────────────────────────────────────────────────────────────────

function main(argv) {
	const args = argv.slice(2)
	const TAKES_VALUE = new Set(['--name', '--subpath', '--ref'])
	const flags = {}
	const positional = []
	for (let i = 0; i < args.length; i++) {
		if (TAKES_VALUE.has(args[i])) {
			if (i + 1 >= args.length) refuse(`${args[i]} needs a value`)
			flags[args[i]] = args[++i]
		} else if (args[i].startsWith('--')) {
			flags[args[i]] = true
		} else {
			positional.push(args[i])
		}
	}
	const flag = (n) => (typeof flags[n] === 'string' ? flags[n] : null)
	const src = positional[0]
	if (!src) refuse('usage: intake.mjs <source> [--name X] [--subpath P] [--ref R]')
	if (positional.length > 1) refuse(`one source at a time, got ${positional.length}`)

	const ref = flag('--ref')
	if (ref && !SAFE_REF.test(ref)) refuse(`unusable ref: "${ref}"`)
	const subpath = flag('--subpath')
	if (subpath && (subpath.includes('..') || subpath.startsWith('/'))) refuse(`subpath must stay inside the repo: "${subpath}"`)

	const source = classifySource(src)
	const name = flag('--name') ?? basename(subpath ?? source.url)
	if (!SAFE_NAME.test(name)) refuse(`unusable skill name: "${name}" — lowercase letters, digits and hyphens`)

	const dest = join(INBOX, name)
	// Never merge a second attempt onto a first: the result would be bytes from
	// two different refs under one hash, and the record would describe neither.
	if (existsSync(dest)) refuse(`inbox/${name} already exists — resolve or delete it first, never merge onto it`)

	const { work, sha } = fetchAt(source, ref)
	const licence = detectLicence(work)
	try {
		const from = subpath ? join(work, subpath) : work
		if (!existsSync(from)) refuse(`subpath not present at ${sha.slice(0, 7)}: ${subpath}`)

		const staged = walk(from, from)
		const escaping = staged.filter((f) => f.symlink && !f.inside)
		if (escaping.length) {
			refuse(`symlink escapes the artefact: ${escaping.map((f) => f.rel).join(', ')}`)
		}

		mkdirSync(INBOX, { recursive: true })
		cpSync(from, dest, { recursive: true, dereference: false, filter: (s) => basename(s) !== '.git' })
		rmSync(join(dest, '.git'), { recursive: true, force: true })

		const landed = walk(dest, dest)
		// Belt and braces: the copy is re-walked and re-checked, because the
		// containment claim has to hold for the bytes that actually landed.
		if (!relative(INBOX, realpathSync(dest)).startsWith(name)) refuse('quarantine escape after copy')

		writeOrigin(dest, { source, sha, subpath, ref, files: landed, name, licence })

		return {
			name, sha, files: landed.length,
			skillFile: existsSync(join(dest, 'SKILL.md')),
			symlinks: landed.filter((f) => f.symlink).length,
			dest: `inbox/${name}`
		}
	} finally {
		rmSync(work, { recursive: true, force: true })
	}
}

try {
	const r = main(process.argv)
	if (process.argv.includes('--json')) {
		console.log(JSON.stringify(r, null, 2))
	} else {
		console.log(`\nlanded  ${r.dest}  ${r.files} file(s)  @ ${r.sha.slice(0, 12)}`)
		if (!r.skillFile) console.log('  note: no SKILL.md at the root — this may not be a skill')
		if (r.symlinks) console.log(`  note: ${r.symlinks} symlink(s), all resolving inside the artefact`)
		console.log('\nNothing was executed and nothing was read. Run /skill-adopt next,')
		console.log('in a fresh session.\n')
	}
} catch (e) {
	if (e instanceof Refusal) {
		console.error(`refused: ${e.message}`)
		process.exit(2)
	}
	throw e
}
