#!/usr/bin/env node
// adopt — record the human decision about a quarantined skill.
//
//   node adopt.mjs <name>                        verdict ADOPT into inbox/<name>/AUDIT.md
//   node adopt.mjs <name> --decline --why "…"    a row under ## Declined in REJECTED.md; inbox/<name> removed
//   node adopt.mjs <name> --refuse [--why "…"]   a row under ## Refused in REJECTED.md; inbox/<name> removed
//         [--library <dir>] [--dry-run] [--json]
//
// The lifecycle's central verb, and the only place a human decision becomes a
// durable record. Until this existed the decision was a person editing two
// markdown files by hand, which is a stage without a command rather than a
// stage that does not exist — the README said so, and this is the command.
//
// IT RECORDS. IT DOES NOT MOVE. `promote` is the gate: it re-scans the adapted
// artefact, runs its tests and moves it into skills/, and it stays the only
// thing that moves bytes into the library. Two verbs that both move things is
// how they drift, so adopt writes the verdict promote already reads and stops.
// The one filesystem act it has beyond writing records is removal: a declined
// or refused skill is deleted with its row, because quarantine is a state that
// ends. That was an open question, and it was answered: the row keeps the
// reason, the scan and the pinned commit, so the source is re-fetchable at
// the same bytes and nothing the record principle needs is lost.
//
// The row it writes is read by two independent parsers — check-catalog.mjs's
// readRejected and the viewer's parseRejectedTable — and its shape is theirs,
// not this file's: `## Refused` is `name` | [repo](url) | date | blocking
// finding; `## Declined` adds a scan and a why. A row only counts when its
// first cell is a backtick-wrapped identifier, which is what tells it apart
// from a header, a separator and prose.
//
// Nothing the artefact wrote reaches the record. The scan it runs is
// `audit --no-evidence`, so the row carries counts and codes, never bytes.
//
// Plain Node, no dependencies.

import { spawnSync } from 'node:child_process'
import { existsSync, lstatSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// ── colour, which is optional ───────────────────────────────────────────────
//
// Guarded, like every command here: these scripts have been deployed by copying
// one file into a skill's scripts/ folder, where no sibling is beside them. The
// fallback is the same string tint.mjs produces on anything that is not a
// terminal.
let refusalLine = (message) => `refused: ${message}`
let tint = { state: (t) => t, warn: (t) => t, alarm: (t) => t, dim: (t) => t, enabled: () => false }
try {
	const mod = await import('./tint.mjs')
	refusalLine = mod.refusalLine
	tint = mod.tint
} catch {
	// Deployed alone. Plain text is correct, not a failure.
}

let invokedAs = () => `node ${basename(fileURLToPath(import.meta.url))}`
try {
	const mod = await import('./invoked-as.mjs')
	invokedAs = () => mod.invokedAs(import.meta.url)
} catch {
	// Deployed alone. Naming the file is correct, not a failure.
}

let checkFlags = () => null
try {
	const mod = await import('./argv.mjs')
	checkFlags = mod.checkFlags
} catch {
	// Deployed alone. No validation, which is where this started.
}

// ── the two siblings this verb cannot do without ────────────────────────────
//
// Guarded so that their absence is reported as what it is — a packaging fault,
// the tarball missing a file — rather than as an ERR_MODULE_NOT_FOUND trace.
// There is no degraded mode for either: the AUDIT.md contract is the one
// promote enforces and typing it again here is the drift this file exists to
// avoid, and the REJECTED.md reader is the one `check` uses, for the same
// reason.
let record = null
try {
	record = await import('./audit-record.mjs')
} catch {
	// Reported below, once there is somewhere to report it.
}
let readRejected = null
try {
	readRejected = (await import('./check-catalog.mjs')).readRejected
} catch {
	// Same.
}

const FLAGS = {
	boolean: ['--decline', '--refuse', '--dry-run', '--json', '--help', '-h'],
	valued: ['--library', '--why']
}

const HERE = dirname(fileURLToPath(import.meta.url))
const TOOL = HERE

// The library: named, or the place you are standing, never inferred from
// where this file sits. Same order and same refusal as every other verb.
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

// The same rule intake applies to a name before it becomes a path. This verb
// removes a directory under the library, so the name is checked before any
// path is built from it, not after.
const SAFE_NAME = /^[a-z0-9][a-z0-9-]*$/

const today = () => new Date().toISOString().slice(0, 10)

// A cell must not break the row. Both readers split a row on the bare bar —
// neither honours markdown's `\|` escape, and teaching them to would be a
// change to two parsers for the sake of one character — so a bar inside a
// reason becomes a broken bar, which reads the same and splits nothing.
const cell = (text) => String(text).replace(/\|/g, '¦').trim()

// ── the arrival record ──────────────────────────────────────────────────────

// github.com/org/repo, stripping a trailing .git/slash/query/fragment. Fresh
// here — the viewer computes the same fact for its vendor nodes and the two
// necessarily agree on the one correct answer.
function repoSlug(url) {
	const m = /github\.com\/([^/]+\/[^/]+?)(?:\.git)?\/?(?:$|[?#])/.exec(url ?? '')
	if (m) return m[1]
	// A local checkout: its directory name. Anything else: the url without its
	// scheme, which is at least a name a reader can recognise.
	if (!/^[a-z]+:\/\//.test(url ?? '')) return basename(url ?? '') || 'unknown'
	return url.replace(/^[a-z]+:\/\//, '')
}

function readOrigin(dir) {
	const path = join(dir, 'ORIGIN.md')
	const text = readFileSync(path, 'utf8')
	// `| **Source** | https://… |` for a remote, `| **Source** | `path` |` for a
	// local checkout — intake writes both shapes.
	const source = /\|\s*\*\*Source\*\*\s*\|\s*`?([^`|\n]+?)`?\s*\|/.exec(text)?.[1]?.trim() ?? null
	const commit = /\*\*Resolved commit\*\*\s*\|\s*`([0-9a-f]{7,40})`/.exec(text)?.[1] ?? null
	return { source, commit }
}

// `[repo](url) @ `commit``. The viewer's parser reads the link and ignores the
// trailing pin; check-catalog's reads only the name cell. The pin is there for
// the person who re-fetches: seven characters, per brand/BRAND.md, and enough
// for git to resolve.
function sourceCell(origin) {
	const url = (origin.source ?? 'unknown').replace(/\)/g, '%29')
	const pin = origin.commit ? ` @ \`${origin.commit.slice(0, 7)}\`` : ''
	return `[${cell(repoSlug(origin.source))}](${url})${pin}`
}

// ── the scan ────────────────────────────────────────────────────────────────

// `--no-evidence`, so nothing the artefact wrote enters this process or the
// record. The scanner's exit code is its verdict, not a failure, so only the
// absence of parseable output is one.
function scan(dir) {
	const scanner = join(TOOL, 'audit-skill.mjs')
	if (!existsSync(scanner)) {
		return { error: { why: 'audit-skill.mjs is missing beside this script', detail: `expected ${scanner} — a packaging fault, not something you did; please report it` } }
	}
	const r = spawnSync(process.execPath, [scanner, dir, '--json', '--no-evidence', '--exclude', 'AUDIT.md', '--exclude', 'ORIGIN.md'], { encoding: 'utf8' })
	let parsed = null
	try {
		parsed = JSON.parse(r.stdout)
	} catch {
		/* refused below */
	}
	if (!parsed) {
		const out = ((r.stdout ?? '') + (r.stderr ?? '')).trim().split('\n').slice(-3).join(' · ')
		return { error: { why: 'the scan produced no readable result', detail: out || (r.error ? `${r.error.code ?? r.error.name}: ${r.error.message}` : `exit ${r.status}, no output`) } }
	}
	const counts = parsed.counts ?? {}
	const blocking = (parsed.findings ?? []).filter((f) => f.sev === 'BLOCK' && !f.excluded)
	return {
		counts,
		summary: `${counts.BLOCK ?? 0} block · ${counts.REVIEW ?? 0} review · ${counts.NOTE ?? 0} note`,
		blocking: blocking.map((f) => ({ code: f.code, file: f.file }))
	}
}

// ── REJECTED.md ─────────────────────────────────────────────────────────────

const SECTIONS = {
	Refused: {
		lead: 'A blocking finding the human agreed with.',
		header: '| Skill | Source | Date | Blocking finding |',
		separator: '|---|---|---|---|'
	},
	Declined: {
		lead: 'The scan was clear, or acceptable, and the human said no anyway.',
		header: '| Skill | Source | Date | Scan | Why |',
		separator: '|---|---|---|---|---|'
	}
}

const TEMPLATE = `# Rejected

Skills that were considered and not adopted. A row here is permanent: the name
is known, the decision is recorded with its reason against a pinned commit, and
\`check\` resolves an edge to it without holding it. Written by \`qrntn adopt\`;
read by \`qrntn check\` and by the viewer.
`

/**
 * Put a row inside the right section — after the last table line of that
 * section, never at the end of the file. A row appended at the end lands in
 * whichever section is last, which silently turns a refusal into a decline.
 * Returns the new text.
 */
export function insertRejectedRow(text, section, row) {
	const spec = SECTIONS[section]
	// A fresh file carries both sections, each with its header and no rows, so
	// the next decision of the other kind finds its table already there and a
	// reader sees the whole shape at once.
	const fresh = () =>
		TEMPLATE +
		['Refused', 'Declined'].map((s) => `\n## ${s}\n\n${SECTIONS[s].lead}\n\n${SECTIONS[s].header}\n${SECTIONS[s].separator}\n`).join('')
	const lines = (text || fresh()).replace(/\n+$/, '').split('\n')
	const heading = `## ${section}`
	const at = lines.findIndex((l) => l.trim() === heading)

	if (at === -1) {
		// No such section yet. Refused goes before Declined when Declined is the
		// only one present, so the file reads in the order the parsers expect.
		const other = section === 'Refused' ? lines.findIndex((l) => l.trim() === '## Declined') : -1
		const block = ['', heading, '', spec.lead, '', spec.header, spec.separator, row]
		if (other === -1) lines.push(...block)
		else lines.splice(other, 0, ...block, '')
		return lines.join('\n') + '\n'
	}

	let end = lines.length
	for (let i = at + 1; i < lines.length; i++) {
		if (/^##\s/.test(lines[i].trim())) {
			end = i
			break
		}
	}
	let last = -1
	for (let i = at + 1; i < end; i++) if (lines[i].trim().startsWith('|')) last = i

	if (last !== -1) {
		lines.splice(last + 1, 0, row)
	} else {
		// A section with prose and no table: the table goes after the prose,
		// before the blank lines that lead into the next heading.
		let insertAt = end
		while (insertAt > at + 1 && lines[insertAt - 1].trim() === '') insertAt--
		lines.splice(insertAt, 0, '', spec.header, spec.separator, row)
	}
	return lines.join('\n') + '\n'
}

// ── main ────────────────────────────────────────────────────────────────────

function synopsis() {
	return `usage: ${invokedAs()} <name> [--decline --why "…" | --refuse [--why "…"]] [--library <dir>] [--dry-run] [--json]

  <name>          a skill in inbox/, as intake named it
  (no flag)       record the verdict ADOPT in inbox/<name>/AUDIT.md — then promote it
  --decline       a row under ## Declined in REJECTED.md; the reason is required
  --refuse        a row under ## Refused; the blocking finding comes from a fresh
                  scan, or from --why
  --why <text>    the reason, one line, into the row
  --dry-run       say what would be recorded and write nothing
  --json          machine-readable result

A declined or refused skill is removed from inbox/ with its row. The row keeps
the source, the pinned commit, the scan and the reason, so it is re-fetchable
at the same bytes and never re-audited from nothing.

Exit codes:  0 recorded · 1 refused to record, and says why · 2 could not run
`
}

const args = process.argv.slice(2)

if (args.includes('--help') || args.includes('-h')) {
	console.log(synopsis())
	process.exit(0)
}

{
	const bad = checkFlags(args, FLAGS)
	if (bad) {
		console.error(refusalLine(`unknown option ${bad.flag}`))
		console.error(bad.suggestion ? `  did you mean ${bad.suggestion}?` : `  run \`${invokedAs()} --help\` for what this verb takes`)
		process.exit(2)
	}
}

const usageError = (message) => {
	console.error(refusalLine(message))
	console.error(`  run \`${invokedAs()} --help\` for what this verb takes`)
	process.exit(2)
}

const valueOf = (flag) => {
	const i = args.indexOf(flag)
	if (i === -1) return null
	const v = args[i + 1]
	if (v === undefined || v.startsWith('--')) usageError(`${flag} needs a value`)
	return v
}

const LIBRARY = resolveLibrary(args)
const INBOX = join(LIBRARY, 'inbox')
const SKILLS = join(LIBRARY, 'skills')

// The positional is the name — not the value that follows --library or --why.
const valued = new Set(FLAGS.valued.map((f) => args.indexOf(f)).filter((i) => i !== -1).map((i) => i + 1))
const name = args.find((a, i) => !a.startsWith('--') && !valued.has(i))
const DECLINE = args.includes('--decline')
const REFUSE = args.includes('--refuse')
const DRY = args.includes('--dry-run')
const JSON_OUT = args.includes('--json')
const why = valueOf('--why')

if (!name) {
	console.error(synopsis())
	process.exit(2)
}
if (!SAFE_NAME.test(name)) usageError(`unusable skill name: "${name}" — lowercase letters, digits and hyphens`)
if (DECLINE && REFUSE) usageError('--decline and --refuse are two different decisions — pick one')
if (DECLINE && !why) usageError('--decline needs --why — a decline without a reason cannot be disagreed with later')
if (why !== null && /[\r\n]/.test(why)) usageError('--why is one line — the row it goes into has no second one')

if (!record) {
	console.error(refusalLine('audit-record.mjs is missing beside this script'))
	console.error(`  expected ${join(HERE, 'audit-record.mjs')}\n  This is a packaging fault, not something you did — please report it.`)
	process.exit(2)
}
if (!readRejected) {
	console.error(refusalLine('check-catalog.mjs is missing beside this script'))
	console.error(`  expected ${join(HERE, 'check-catalog.mjs')}\n  This is a packaging fault, not something you did — please report it.`)
	process.exit(2)
}

const action = DECLINE ? 'decline' : REFUSE ? 'refuse' : 'adopt'
const dir = join(INBOX, name)
const auditPath = join(dir, 'AUDIT.md')

const refusals = []
const refuse = (why, detail) => refusals.push({ why, detail })

let row = null
let section = null
let origin = null
let scanned = null
let priorRow = false

if (!existsSync(dir)) {
	refuse(`inbox/${name} does not exist`, 'nothing to decide about')
} else if (existsSync(join(SKILLS, name))) {
	refuse(`skills/${name} already exists`, 'it is held — a decision about it was already recorded and enforced')
} else if (!existsSync(join(dir, 'ORIGIN.md'))) {
	refuse('no ORIGIN.md', 'provenance is missing — an authored skill has no arrival to decide about; promote it directly')
} else if (action === 'adopt') {
	// ── adopt: the verdict, into the record the human already wrote ──────────
	priorRow = readRejected(LIBRARY).has(name)
	if (!existsSync(auditPath)) {
		refuse('no AUDIT.md', 'nothing has been adjudicated; write the record, then adopt')
	} else {
		const text = readFileSync(auditPath, 'utf8')
		const verdict = record.readVerdict(text)
		if (verdict) {
			refuse(`AUDIT.md already records a verdict: ${verdict}`, 'a decision is not overwritten by a command — edit the record by hand and say why')
		} else {
			for (const p of record.checkAuditRecord(text, { verdictOpen: true })) refuse(p.why, p.detail)
			const m = record.VERDICT_ROW.exec(text)
			if (!m) {
				refuse('AUDIT.md has no Verdict row', 'add `| **Verdict** | |` to its table, then adopt')
			} else if (m[2].trim() !== '' && !record.VERDICT_MENU.test(m[2])) {
				refuse(`AUDIT.md's Verdict cell says "${cell(m[2])}"`, 'not a verdict this tool knows — clear it, or write ADOPT, REVISE or REJECT by hand')
			} else if (!refusals.length && !DRY) {
				writeFileSync(auditPath, text.replace(record.VERDICT_ROW, `$1 **ADOPT** — ${today()} $3`))
			}
		}
	}
} else {
	// ── decline / refuse: a row, then the bytes go ──────────────────────────
	if (lstatSync(dir).isSymbolicLink()) {
		refuse(`inbox/${name} is a symlink`, 'this verb removes what it decides about and will not follow a link out of the library — remove it by hand')
	} else {
		if (readRejected(LIBRARY).has(name)) {
			refuse(`REJECTED.md already carries a row for ${name}`, 'a repeated row is a collision, not a record — edit the existing one by hand')
		}
		if (existsSync(auditPath)) {
			const verdict = record.readVerdict(readFileSync(auditPath, 'utf8'))
			if (verdict && verdict !== 'REJECT') {
				refuse(`AUDIT.md records ${verdict}`, 'a decision is not overwritten by a command — edit the record by hand and say why')
			}
		}
		origin = readOrigin(dir)
		if (!origin.commit) refuse('ORIGIN.md records no resolved commit', 'a branch name is not an identity')

		scanned = scan(dir)
		if (scanned.error) {
			refuse(scanned.error.why, scanned.error.detail)
		} else if (action === 'refuse') {
			const first = scanned.blocking[0]
			const finding = why ?? (first ? `${first.code} ${first.file}` : null)
			if (!finding) {
				refuse('nothing blocks', 'the scan found no blocking finding — name the reason with --why, or decline instead')
			} else {
				section = 'Refused'
				row = `| \`${name}\` | ${sourceCell(origin)} | ${today()} | ${cell(finding)} |`
			}
		} else {
			section = 'Declined'
			row = `| \`${name}\` | ${sourceCell(origin)} | ${today()} | ${scanned.summary} | ${cell(why)} |`
		}

		if (!refusals.length && !DRY) {
			// The row first, then the removal. A crash between the two leaves a
			// record and the bytes, which is recoverable; the other order leaves
			// neither.
			const path = join(LIBRARY, 'REJECTED.md')
			writeFileSync(path, insertRejectedRow(existsSync(path) ? readFileSync(path, 'utf8') : '', section, row))
			rmSync(dir, { recursive: true, force: true })
		}
	}
}

const recorded = !refusals.length && !DRY

if (JSON_OUT) {
	console.log(
		JSON.stringify(
			{
				name,
				decision: action,
				recorded,
				dryRun: DRY,
				record: action === 'adopt' ? `inbox/${name}/AUDIT.md` : 'REJECTED.md',
				section,
				row,
				removed: recorded && action !== 'adopt',
				scan: scanned && !scanned.error ? { counts: scanned.counts, blocking: scanned.blocking } : null,
				priorRow,
				refusals
			},
			null,
			2
		)
	)
} else if (refusals.length) {
	console.log(`\nrefused to record ${name} — ${refusals.length} unmet condition(s)\n`)
	for (const r of refusals) {
		console.log(`  ${tint.alarm('✗')} ${r.why}`)
		if (r.detail) console.log(`      ${r.detail}`)
	}
	console.log('')
} else {
	const next = invokedAs().replace(/adopt(\.mjs)?$/, 'promote$1')
	console.log(`\nadopt · ${name}${DRY ? ' · dry run' : ''}\n`)
	if (action === 'adopt') {
		console.log(`  ${tint.state('ADOPT')}${DRY ? ' would be' : ''} recorded in inbox/${name}/AUDIT.md`)
		if (priorRow) console.log(`  ${tint.dim(`note: REJECTED.md carries an earlier row for ${name} — the held skill will resolve first`)}`)
		console.log(`\n${DRY ? 'Then' : 'Next'}: ${next} ${name}\n`)
	} else {
		const word = action === 'refuse' ? tint.alarm('refused') : tint.warn('declined')
		console.log(`  ${word} — ${DRY ? 'would write' : 'wrote'} a row under ## ${section} in REJECTED.md`)
		console.log(`  ${tint.dim(row)}`)
		console.log(`  inbox/${name}${DRY ? ' would be' : ''} removed — re-fetchable at \`${origin.commit.slice(0, 7)}\`\n`)
	}
}

process.exit(refusals.length ? 1 : 0)
