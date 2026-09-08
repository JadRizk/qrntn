#!/usr/bin/env node
//
// usage.mjs — count what actually fired.
//
//   node scripts/usage.mjs                 write ledger/usage.json
//   node scripts/usage.mjs --json          print to stdout, write nothing
//   node scripts/usage.mjs --now <iso>     fix "now", so windows are reproducible
//   node scripts/usage.mjs --root <dir>    read transcripts from somewhere else
//   node scripts/usage.mjs --library <dir> which skill library's ledger to write
//   node scripts/usage.mjs --report        the human-facing table: usage joined to cost
//   node scripts/usage.mjs --report --baseline    write it to ledger/baseline-<date>.md
//
// Why this exists. "Which skills earn their context slot" is otherwise a matter
// of taste, and taste defends whatever is already there. A skill that has never
// once been invoked is costing description tokens in every session and
// returning nothing, and the only way to know is to count.
//
// What it reads. Every `<root>/**/*.jsonl`, where root defaults to
// ~/.claude/projects. Each line is one JSON record; the ones that matter are
// assistant turns whose message content holds a `tool_use` block named "Skill".
// The skill's name is `input.skill`.
//
// What it deliberately does NOT read. Two things, and they are the whole
// privacy story of this script:
//
//   · No message text. Content blocks are inspected only far enough to ask
//     whether `type === 'tool_use'`; a `text` block is stepped over without its
//     contents being touched. Transcripts are conversations, and a usage
//     counter has no business reading them.
//   · No arguments. `input.args` is the prose a user typed to invoke the skill
//     — file paths, ticket numbers, whatever was on their mind. It is dropped
//     on the floor here and never reaches the output. Only the name is counted.
//
// This parses; it never executes. Nothing from a transcript is evaluated,
// spawned or imported — constraint C3.
//
// What the number means, and what it does not. A count here is "a tool_use
// block named Skill appeared in a transcript on this machine". It is NOT a
// count of times a skill auto-fired, and it is NOT a count of times someone
// typed the skill's name — the transcript does not separate those, and SK-11
// established that by measurement rather than by assumption. The field names
// below say `invocations` for that reason. commands/TRANSCRIPTS.md is the full
// statement of what is derivable and what is not; read it before drawing a
// conclusion from this ledger, and especially before deleting a skill on the
// strength of a zero.
//
// What --report adds. The ledger answers "how often", which is only half of
// "does this skill earn its context slot". The other half is what the skill
// charges: its frontmatter description is loaded into every session whether or
// not it ever fires. --report joins the two and divides — description bytes per
// invocation — and keeps three populations apart, because mixing them is how
// the arithmetic starts lying: skills this repository holds and that fired,
// skills it holds that never fired (no denominator, and the row this whole
// exercise exists to surface), and names invoked from somewhere else entirely,
// whose description cost is not paid here and is not in these totals.
//
// A note on truncation. Transcripts are appended to live, so the last line of
// an active session is routinely half-written. That is normal, not corruption:
// a bad line is skipped and counted, never thrown on. A run that dies because
// someone had a session open is a tool nobody runs twice.
//
// Exit 0 always, unless a path is refused. Plain Node, no dependencies.

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { realpathSync } from 'node:fs'
import { computeInstall, resolveInstallRoot, writeLedgerSections } from './ledger.mjs'

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

const DEFAULT_LIBRARY = resolveLibrary()
const HOME = homedir()
const DEFAULT_ROOT = join(HOME, '.claude', 'projects')
// The skills this repository holds — the only descriptions whose cost it pays
// and the only ones it can do anything about.
const DEFAULT_SKILLS = join(DEFAULT_LIBRARY, 'skills')

// The windows the ledger reports. Named here once so the summariser, the output
// shape and any later consumer cannot disagree about what "d30" means.
const WINDOWS = [
	['d7', 7],
	['d30', 30],
	['d90', 90],
]

const DAY = 86_400_000

// Written with `~` rather than expanded, for the same reason catalog.json does
// it: an absolute home path in a committed file is both a machine-specific fact
// and someone's username. Collapsing it also keeps output identical across two
// machines running the same fixture.
const tilde = (p) => (p === HOME || p.startsWith(HOME + '/') ? '~' + p.slice(HOME.length) : p)

// ---------------------------------------------------------------- discovery

// Every *.jsonl under root, at any depth, sorted. Sorted because the output is
// required to be byte-identical between runs and readdir order is not promised
// to be stable across filesystems.
export function transcripts(root) {
	const found = []
	const walk = (dir) => {
		let entries
		try {
			entries = readdirSync(dir, { withFileTypes: true })
		} catch {
			// An unreadable directory is a fact about permissions, not a reason to
			// abandon the scan. Skipped silently; the file count reports the truth.
			return
		}
		for (const e of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
			if (e.name.startsWith('.')) continue
			const p = join(dir, e.name)
			if (e.isDirectory()) walk(p)
			else if (e.isFile() && e.name.endsWith('.jsonl')) found.push(p)
		}
	}
	if (existsSync(root) && statSync(root).isDirectory()) walk(root)
	return found
}

// ------------------------------------------------------------------ parsing

// One line in, zero or more invocations out. Returns null when the line cannot
// be parsed — the caller counts those rather than failing on them.
//
// Separated from the file loop so the truncation case can be tested directly,
// without a fixture on disk for every variant.
export function parseLine(line) {
	const trimmed = line.trim()
	if (!trimmed) return []

	let record
	try {
		record = JSON.parse(trimmed)
	} catch {
		return null
	}
	if (!record || typeof record !== 'object') return []

	const message = record.message
	if (!message || typeof message !== 'object') return []

	const content = message.content
	// A string here is an ordinary user turn. It cannot contain a tool_use
	// block, and it is exactly the message text this script does not read.
	if (!Array.isArray(content)) return []

	const out = []
	for (const block of content) {
		// The only branch that looks inside a block at all. Anything that is not
		// a tool_use — text, thinking, an image — is stepped over here, unread.
		if (!block || typeof block !== 'object') continue
		if (block.type !== 'tool_use' || block.name !== 'Skill') continue

		const skill = block.input?.skill
		if (typeof skill !== 'string' || !skill) continue

		// `input.args` is deliberately not carried forward. See the header.
		out.push({ skill, at: record.timestamp ?? null })
	}
	return out
}

// Just the record's timestamp. Deliberately its own tiny parse rather than a
// second field threaded out of parseLine: parseLine's contract is "invocations
// in this line", and widening it to also mean "and by the way, when" is how a
// function grows a second job nobody remembers it has.
function recordStamp(line) {
	try {
		const d = JSON.parse(line)
		return d && typeof d === 'object' && typeof d.timestamp === 'string' ? d.timestamp : null
	} catch {
		return null
	}
}

export function scan(root) {
	const files = transcripts(root)
	const events = []
	let lines = 0
	let skipped = 0
	// The oldest and newest record of ANY kind, which is the depth of the
	// sample. Without it a zero in `d90` is unreadable: it could mean the skill
	// went unused for ninety days, or that the transcripts only go back sixty.
	let oldest = null
	let newest = null

	for (const file of files) {
		let text
		try {
			text = readFileSync(file, 'utf8')
		} catch {
			continue
		}
		for (const line of text.split('\n')) {
			if (!line.trim()) continue
			lines++
			const parsed = parseLine(line)
			if (parsed === null) {
				skipped++
				continue
			}
			// A record's own timestamp, read without touching its content.
			const at = recordStamp(line)
			if (at) {
				if (oldest === null || at < oldest) oldest = at
				if (newest === null || at > newest) newest = at
			}
			events.push(...parsed)
		}
	}

	return { files: files.length, lines, skipped, events, oldest, newest }
}

// --------------------------------------------------------------- summarising

// Events plus a fixed `now` in, the ledger out. Pure: the same arguments give
// the same object, which is what makes --now enough for byte-identical output.
export function summarise({ files, lines, skipped, events, oldest = null, newest = null }, now, root) {
	const end = new Date(now)
	if (Number.isNaN(end.getTime())) throw new Error(`--now is not a date: ${now}`)
	const endMs = end.getTime()

	const stamped = events
		.map((e) => ({ ...e, ms: e.at ? Date.parse(e.at) : NaN }))
		.filter((e) => !Number.isNaN(e.ms))
	// An event with no usable timestamp still happened. It cannot be placed in a
	// dated window, so it counts towards `all` and towards nothing else — and it
	// is reported, because a silently discarded record is the bug this ticket is
	// about.
	const undated = events.length - stamped.length

	const bounds = { all: { start: null, end: end.toISOString() } }
	for (const [name, days] of WINDOWS) {
		const start = new Date(endMs - days * DAY).toISOString()
		// `reachesBeforeCorpus` is the difference between "nothing fired in 90
		// days" and "there are not 90 days of transcripts here". Both print as a
		// zero, and only one of them is evidence about a skill.
		bounds[name] = { start, end: end.toISOString(), reachesBeforeCorpus: oldest !== null && start < oldest }
	}
	if (stamped.length) bounds.all.start = new Date(Math.min(...stamped.map((e) => e.ms))).toISOString()

	const inWindow = (e, name) => {
		if (name === 'all') return true
		const from = Date.parse(bounds[name].start)
		// Inclusive at both ends. An event exactly `now` is in every window; one
		// dated after `now` — a clock skew, or a fixture written ahead — is in
		// none of the dated ones but still counts in `all`.
		return e.ms >= from && e.ms <= endMs
	}

	const names = [...new Set(events.map((e) => e.skill))].sort()
	const skills = {}
	for (const name of names) {
		const mine = stamped.filter((e) => e.skill === name)
		const row = { all: events.filter((e) => e.skill === name).length }
		for (const [w] of WINDOWS) row[w] = mine.filter((e) => inWindow(e, w)).length
		row.lastFired = mine.length ? new Date(Math.max(...mine.map((e) => e.ms))).toISOString() : null
		// Rebuilt in a fixed order rather than however the keys happened to land,
		// because "byte-identical" includes key order.
		// `lastInvoked`, not `lastFired`. "Fired" is the verb that quietly implies
		// the model chose to fire it, which is the one thing the transcript does
		// not show — the same hoped-for meaning that would make `autoFires` a lie.
		skills[name] = {
			invocations: { d7: row.d7, d30: row.d30, d90: row.d90, all: row.all },
			lastInvoked: row.lastFired,
		}
	}

	const totals = { all: events.length }
	for (const [w] of WINDOWS) totals[w] = stamped.filter((e) => inWindow(e, w)).length

	const spanDays =
		oldest && newest ? Math.round((Date.parse(newest) - Date.parse(oldest)) / DAY) : null

	return {
		now: end.toISOString(),
		root: tilde(root),
		// Named for what was measured, not for what one would like to know. An
		// invocation is a tool_use block named Skill — nothing here separates a
		// model-initiated one from a user-typed one, so no field claims to.
		measures: {
			unit: 'invocations',
			definition: 'a tool_use block named "Skill"; input.skill is the name',
			cannotDistinguish: ['who initiated an invocation — model-fired and user-typed read identically'],
			reference: 'commands/TRANSCRIPTS.md',
		},
		// The depth of the sample. Counts are a sample, not a history: these are
		// the transcripts on this machine, and nothing else.
		corpus: { oldestRecord: oldest, newestRecord: newest, spanDays },
		scanned: { files, lines, skipped, undated },
		windows: {
			d7: bounds.d7,
			d30: bounds.d30,
			d90: bounds.d90,
			all: bounds.all,
		},
		totals: {
			invocations: { d7: totals.d7, d30: totals.d30, d90: totals.d90, all: totals.all },
			skills: names.length,
		},
		skills,
	}
}

export function report({ root = DEFAULT_ROOT, now = new Date().toISOString() } = {}) {
	return summarise(scan(root), now, root)
}

// --------------------------------------------------------------------- cost

// Usage is half the question. A held skill charges rent whether or not it ever
// fires: its frontmatter `description` is loaded into every session, and that
// is the one cost this repository actually controls. Bytes-per-invocation is
// the ratio that turns "earns its context slot" from taste into arithmetic.
//
// Frontmatter is parsed here rather than imported from a sibling: every
// script in this repo that reads a SKILL.md parses it itself, so that no two
// scripts that otherwise run independently share a dependency. Twenty lines
// of duplication beats that (AUTHORING.md's "no dependencies" is about more
// than npm).
function frontmatter(text) {
	if (!text.startsWith('---')) return {}
	const end = text.indexOf('\n---', 3)
	if (end === -1) return {}
	const out = {}
	for (const line of text.slice(4, end).split('\n')) {
		const colon = line.indexOf(':')
		// An indented line is a continuation or a nested key. Neither is a shape
		// this needs, and guessing at one is how a parser starts lying.
		if (colon === -1 || /^\s/.test(line)) continue
		const key = line.slice(0, colon).trim()
		if (!key) continue
		out[key] = line
			.slice(colon + 1)
			.trim()
			.replace(/^["']|["']$/g, '')
	}
	return out
}

// Every skill this repository holds, with what its description costs. A
// directory without a SKILL.md is not a skill and is stepped over.
export function heldSkills(dir = DEFAULT_SKILLS) {
	let entries
	try {
		entries = readdirSync(dir, { withFileTypes: true })
	} catch {
		// No skills directory is a real answer, not an error: it means every
		// invoked name in the corpus is one this repository does not hold.
		return []
	}
	const out = []
	for (const e of entries) {
		if (e.name.startsWith('.') || !e.isDirectory()) continue
		const file = join(dir, e.name, 'SKILL.md')
		if (!existsSync(file)) continue
		let text
		try {
			text = readFileSync(file, 'utf8')
		} catch {
			continue
		}
		const fm = frontmatter(text)
		const description = typeof fm.description === 'string' ? fm.description : ''
		out.push({
			name: fm.name || e.name,
			dir: e.name,
			// Bytes, not characters. These descriptions are full of em dashes and
			// each one is three bytes; counting characters understates the bill by
			// the width of the author's punctuation habits.
			descriptionBytes: Buffer.byteLength(description, 'utf8'),
			// `disable-model-invocation: true`. The description is loaded every
			// session exactly as any other, but the model cannot invoke the skill —
			// so the count in the row is a count of times a person typed the name.
			// Same numerator, different denominator, and the report says so.
			manualOnly: String(fm['disable-model-invocation']) === 'true',
		})
	}
	return out.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
}

// The join, as data. Pure — ledger and held list in, rows out — so the numbers
// can be tested without going through the rendering, and so `--now` is enough
// to make the whole report reproducible.
//
// Three populations, kept apart on purpose:
//
//   · held and invoked        — a real bytes-per-invocation figure
//   · held and never invoked  — cost with no denominator; the point of this
//   · invoked but not held    — plugin and project skills. Their description is
//                               paid for somewhere else and is not measured
//                               here. Folding them in would inflate the
//                               invocation total against a byte total that does
//                               not include them; dropping them silently would
//                               hide most of the corpus. So: listed, counted,
//                               and never mixed.
export function reportModel(ledger, held) {
	const heldNames = new Set(held.map((s) => s.name))

	const rows = held.map((s) => {
		const found = ledger.skills[s.name]
		const invocations = found ? found.invocations : { d7: 0, d30: 0, d90: 0, all: 0 }
		return {
			name: s.name,
			manualOnly: s.manualOnly,
			descriptionBytes: s.descriptionBytes,
			invocations,
			lastInvoked: found ? found.lastInvoked : null,
			// `null`, not zero and not Infinity. Zero would read as "free", which is
			// the exact opposite of what a never-invoked skill is; Infinity is a
			// number and invites arithmetic on a quantity that has no denominator.
			// The renderer prints an em dash and the notes explain it.
			bytesPerInvocation: invocations.all > 0 ? s.descriptionBytes / invocations.all : null,
		}
	})

	// Dearest first, with the undefined rows above them all — those are the
	// skills paying rent for nothing, and they are what this report is for.
	// Name breaks every tie, so the order is total and the output is stable.
	rows.sort((a, b) => {
		const an = a.bytesPerInvocation === null
		const bn = b.bytesPerInvocation === null
		if (an !== bn) return an ? -1 : 1
		if (!an && a.bytesPerInvocation !== b.bytesPerInvocation) return b.bytesPerInvocation - a.bytesPerInvocation
		return a.name < b.name ? -1 : a.name > b.name ? 1 : 0
	})

	const unheld = Object.entries(ledger.skills)
		.filter(([name]) => !heldNames.has(name))
		.map(([name, s]) => ({ name, invocations: s.invocations, lastInvoked: s.lastInvoked }))
		.sort((a, b) => b.invocations.all - a.invocations.all || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))

	const sum = (list, w) => list.reduce((n, r) => n + r.invocations[w], 0)
	const spread = (list) => ({ d7: sum(list, 'd7'), d30: sum(list, 'd30'), d90: sum(list, 'd90'), all: sum(list, 'all') })
	const never = rows.filter((r) => r.invocations.all === 0)

	return {
		rows,
		unheld,
		totals: {
			held: rows.length,
			heldDescriptionBytes: rows.reduce((n, r) => n + r.descriptionBytes, 0),
			heldInvocations: spread(rows),
			neverInvoked: never.length,
			neverInvokedBytes: never.reduce((n, r) => n + r.descriptionBytes, 0),
			unheld: unheld.length,
			unheldInvocations: spread(unheld),
		},
	}
}

// ------------------------------------------------------------------ rendering

// Columns sized to their widest cell, so nothing is truncated and nothing is
// padded to a width guessed at now and wrong later.
function table(columns, rows) {
	const widths = columns.map((c, i) => Math.max(c.head.length, ...rows.map((r) => String(r[i]).length)))
	const line = (cells) =>
		'  ' +
		cells
			.map((cell, i) => (columns[i].left ? String(cell).padEnd(widths[i]) : String(cell).padStart(widths[i])))
			.join('  ')
			.trimEnd()
	return [line(columns.map((c) => c.head)), ...rows.map(line)].join('\n')
}

// Three states, not two. A row with invocations but no usable timestamp is not
// a row that never fired — it fired from a record carrying no `timestamp`, and
// printing "never" there would turn a gap in the data into a claim about a
// skill. That is the substitution SK-11 spent a whole ticket refusing.
const day = (invocations, iso) => (iso ? iso.slice(0, 10) : invocations.all === 0 ? 'never' : 'undated')

// One decimal, always. A bare integer reads as exact and a full float reads as
// noise; the figure is a ratio over a sample either way.
const ratio = (n) => (n === null ? '—' : n.toFixed(1))

// The baseline file's name, derived from the ledger's own `now` rather than
// from the clock or from an argument. A dated artefact whose name disagrees
// with the instant inside it is worse than an undated one, and under `--now`
// this makes the run reproducible down to the filename.
export const baselineName = (ledger) => `baseline-${ledger.now.slice(0, 10)}.md`

export function renderReport(ledger, held) {
	const model = reportModel(ledger, held)
	const t = model.totals
	const out = []

	// A window whose start is older than the oldest record cannot be read as a
	// full-window figure, and it prints as an ordinary zero unless something
	// says so. Marked in the column header itself, then explained in the notes:
	// SK-11 exists because this is the commonest way to misread these counts.
	const short = ['d7', 'd30', 'd90'].filter((w) => ledger.windows[w]?.reachesBeforeCorpus)
	const head = (w) => (short.includes(w) ? `${w}*` : w)

	out.push('usage · report')
	out.push(`  now       ${ledger.now}`)
	out.push(
		`  corpus    ${ledger.root} — ${ledger.scanned.files} file(s), ` +
			`${ledger.corpus.spanDays === null ? 'no' : ledger.corpus.spanDays} day(s) deep` +
			(ledger.corpus.oldestRecord
				? ` (${ledger.corpus.oldestRecord.slice(0, 10)} → ${ledger.corpus.newestRecord.slice(0, 10)})`
				: '')
	)
	out.push(`  counted   ${ledger.totals.invocations.all} invocation(s) of ${ledger.totals.skills} distinct name(s)`)
	out.push('')

	out.push(
		`held skills — ${t.held}, costing ${t.heldDescriptionBytes} description byte(s) in every session, ` +
			`invoked ${t.heldInvocations.all} time(s) in this corpus`
	)
	out.push('')
	out.push(
		table(
			[
				{ head: 'skill', left: true },
				{ head: head('d7') },
				{ head: head('d30') },
				{ head: head('d90') },
				{ head: 'all' },
				{ head: 'last', left: true },
				{ head: 'desc' },
				{ head: 'bytes/inv' },
			],
			model.rows.map((r) => [
				r.name + (r.manualOnly ? ' (manual)' : ''),
				r.invocations.d7,
				r.invocations.d30,
				r.invocations.d90,
				r.invocations.all,
				day(r.invocations, r.lastInvoked),
				r.descriptionBytes,
				ratio(r.bytesPerInvocation),
			])
		)
	)
	out.push('')
	if (t.neverInvoked)
		out.push(
			`  ${t.neverInvoked} of ${t.held} held skill(s) were never invoked in this corpus — ` +
				`${t.neverInvokedBytes} byte(s) of description loaded every session, returning nothing measurable here.`
		)
	out.push('')

	out.push(
		`invoked but not held here — ${t.unheld} name(s), ${t.unheldInvocations.all} invocation(s)`
	)
	out.push('')
	if (model.unheld.length)
		out.push(
			table(
				[
					{ head: 'name', left: true },
					{ head: head('d7') },
					{ head: head('d30') },
					{ head: head('d90') },
					{ head: 'all' },
					{ head: 'last', left: true },
				],
				model.unheld.map((r) => [
					r.name,
					r.invocations.d7,
					r.invocations.d30,
					r.invocations.d90,
					r.invocations.all,
					day(r.invocations, r.lastInvoked),
				])
			)
		)
	out.push('')
	out.push(
		'  Plugin and project skills. They have no row above because this repository\n' +
			'  does not hold their description — that cost is paid wherever they are\n' +
			'  defined, and none of it is in the byte totals above. They are listed\n' +
			'  rather than dropped because they are most of the corpus, and a report\n' +
			'  that quietly showed only held skills would read as the whole picture.'
	)
	out.push('')

	out.push('notes')
	out.push('')
	out.push('  bytes/inv is description bytes ÷ all-time invocations in this corpus.')
	out.push(
		'  —         the ratio is undefined: no invocations, so no denominator. Not\n' +
			'            zero, which would read as free, and not infinity, which would\n' +
			'            invite arithmetic. Those rows sort first because they are the\n' +
			'            ones worth looking at.'
	)
	out.push(
		'  (manual)  disable-model-invocation: true. The description is loaded every\n' +
			'            session like any other, but the model cannot invoke it — the\n' +
			'            count is of times a person typed the name. Comparing that\n' +
			'            denominator with a model-invocable skill is not like for like.'
	)
	if (short.length)
		out.push(
			// Padded to the same column the other note labels use, so the marker
			// lines up whether it is one window or three.
			`  ${short.map((w) => `${w}*`).join(', ').padEnd(10)}` +
				`start${short.length === 1 ? 's' : ''} before the oldest record in the corpus.\n` +
				`            The transcripts are ${ledger.corpus.spanDays} day(s) deep, so a zero there means\n` +
				`            "not in ${ledger.corpus.spanDays} days", not "not in 90". Those are not full-window figures.`
		)
	out.push(
		'  An invocation is not a success, and these are the transcripts on one\n' +
			'  machine — a sample, not a history. A single reading is a snapshot and not\n' +
			'  a trend; two readings a week apart are the least a decision should rest\n' +
			'  on. Read commands/TRANSCRIPTS.md before acting on any number here.'
	)
	return out.join('\n') + '\n'
}

// ---------------------------------------------------------------------- main

const USAGE = `usage — count which skills actually fired

  node scripts/usage.mjs [--json | --report] [--now <iso>] [--root <dir>] [--library <dir>]
                         [--skills <dir>] [--out <path>] [--baseline]
                         [--install [--install-root <dir>]]

  --json         print the ledger to stdout and write nothing
  --report       print the human-facing table — usage joined to description
                 cost, with bytes-per-invocation — and write nothing
  --baseline     with --report, write it to ledger/baseline-<date>.md instead.
                 Refuses to overwrite: a baseline is a record, and the whole
                 value of the second reading is that the first still says what
                 it said.
  --now <iso>    treat this instant as now, so the windows are reproducible
  --root <dir>   where the transcripts are (default ~/.claude/projects)
  --library <dir> which skill library's ledger to write (default: this tree)
  --skills <dir> where the held skills are (default skills/)
  --out <path>   where to write (default ledger/usage.json, must stay in-repo)
  --install      also refresh each entry's install section from a live
                 filesystem. Off by default: without it this writes nothing
                 about install and leaves what is already recorded alone.
  --install-root <dir>
                 where installed skills live, when --install is passed.
                 Defaults to SKILL_INSTALL_ROOT, then ~/.claude/skills.

Reads only. Never opens message text, never carries an invocation's arguments.
`

function main(argv) {
	if (argv.includes('--help') || argv.includes('-h')) {
		process.stdout.write(USAGE)
		return 0
	}

	const flag = (name) => {
		const i = argv.indexOf(name)
		if (i === -1) return null
		const v = argv[i + 1]
		if (v === undefined || v.startsWith('--')) {
			process.stderr.write(`error: ${name} needs a value\n`)
			process.exit(2)
		}
		return v
	}

	const root = resolve(flag('--root') ?? DEFAULT_ROOT)
	const now = flag('--now') ?? new Date().toISOString()

	// Opt-in, and the same resolution order ledger.mjs freezes — one
	// implementation of it, imported, because two would drift the moment one
	// of them learned about a new location.
	if (argv.includes('--install-root') && !argv.includes('--install')) {
		process.stderr.write('error: --install-root without --install — nothing would look there\n')
		return 2
	}
	let installRoot = null
	if (argv.includes('--install')) {
		const resolved = resolveInstallRoot(argv)
		if (resolved.error) {
			process.stderr.write(`error: ${resolved.error}\n`)
			return 2
		}
		installRoot = resolved.root
	}
	// Which library's ledger this writes into. `--root` is already taken here,
	// and means something else entirely — where the transcripts are — so the
	// library flag is `--library`, the same name `refresh` and `ledger` use.
	// Defaulting to this script's own tree keeps every existing invocation
	// byte-identical; passing it moves the aggregate and the per-skill entries
	// together, which is the only coherent pair.
	const library = resolve(flag('--library') ?? process.env.SKILL_LIBRARY ?? DEFAULT_LIBRARY)
	const defaultOut = join(library, 'ledger', 'usage.json')
	const out = resolve(flag('--out') ?? defaultOut)
	const wantsReport = argv.includes('--report')

	// Two output shapes, one of them machine-readable and one of them not.
	// Silently preferring either would make a scripted caller that passed both
	// get an answer it cannot parse, or a human get JSON. Refuse instead.
	if (wantsReport && argv.includes('--json')) {
		process.stderr.write('error: --report and --json are different outputs; pass one\n')
		return 2
	}
	if (argv.includes('--baseline') && !wantsReport) {
		process.stderr.write('error: --baseline writes the report; pass --report too\n')
		return 2
	}

	// The one thing this script must never do. Checked against the resolved
	// path, so `--out ../../etc/x` is refused rather than normalised into place.
	//
	// Measured against the library, not against this script's own tree. Those
	// were the same directory until `--library` existed, and the containment
	// this guard is for — never write outside the library you were pointed at —
	// is the same either way. Keeping `DEFAULT_LIBRARY` here would have made the guard
	// refuse every legitimate `--library` run while still permitting anything
	// inside the tree the script happens to live in, which is the wrong-root
	// assumption SK-86 catalogued, one layer down.
	if (relative(library, out).startsWith('..')) {
		process.stderr.write(`error: --out must stay inside the library: ${out}\n`)
		return 2
	}

	let ledger
	try {
		ledger = summarise(scan(root), now, root)
	} catch (e) {
		process.stderr.write(`error: ${e.message}\n`)
		return 2
	}

	if (wantsReport) {
		const text = renderReport(ledger, heldSkills(resolve(flag('--skills') ?? DEFAULT_SKILLS)))
		if (!argv.includes('--baseline')) {
			process.stdout.write(text)
			return 0
		}
		// The date comes off the ledger rather than off the clock or off a hand
		// typed argument, so the name of the file and the instant inside it
		// cannot disagree. Under --now the whole thing is reproducible.
		const file = flag('--out') === null ? join(DEFAULT_LIBRARY, 'ledger', baselineName(ledger)) : out
		// A baseline is the fixed end of a comparison. Overwriting one turns the
		// second reading into a second first reading, and nothing says so.
		if (existsSync(file)) {
			process.stderr.write(`error: ${relative(DEFAULT_LIBRARY, file)} already exists; a baseline is not overwritten\n`)
			return 2
		}
		mkdirSync(dirname(file), { recursive: true })
		writeFileSync(file, text)
		process.stdout.write(`${relative(DEFAULT_LIBRARY, file)} — ${text.split('\n').length - 1} line(s)\n`)
		return 0
	}

	const json = JSON.stringify(ledger, null, 2) + '\n'

	if (argv.includes('--json')) {
		process.stdout.write(json)
		return 0
	}

	mkdirSync(dirname(out), { recursive: true })
	writeFileSync(out, json)

	// The one section of ledger/<name>.json this script owns (SK-30). A
	// section-merging write, never a fresh file — origin/integrity/audit/
	// contract belong to promote.mjs, and this must never touch them. install
	// is refreshed here too, when asked: it is live filesystem state outside the
	// repo, and this is the writer that actually runs again after a skill is
	// installed, where promote.mjs's one-time write at promotion time is
	// necessarily stale — installing is a later, separate step, and since §5 it
	// is not a script this project ships or names.
	//
	// Gated on `out === defaultOut`, the same signal usage.test.mjs already
	// relies on to keep the aggregate file test-safe. Until SK-97 the sentence
	// here read that ledger.mjs writes ledger/<name>.json under the REAL repo
	// root regardless of this script's flags, because it derived that path from
	// its own file location — which was true, and was the bug: a destination
	// nobody could redirect. writeLedgerSections now takes the library, so the
	// entries land where `--library` says. A test run against fixtures always
	// redirects --out, and real, unredirected runs are still the only ones this
	// loop acts on, or every test invocation would corrupt the real ledger with
	// fixture skills.
	if (out === defaultOut) {
		for (const s of heldSkills(resolve(flag('--skills') ?? join(library, 'skills')))) {
			const entry = ledger.skills[s.name]
			// `install` is written only when this run was asked to look for it
			// (SK-97 §4). Omitting the key is not the same as writing null:
			// writeLedgerSections merges at the top level, so an absent key
			// leaves whatever an earlier --install run recorded, where a null
			// would erase it on every unflagged usage run. This script refreshes
			// install because it is the writer that runs again after an install
			// step does — that is a reason to keep the value current, never a
			// reason to overwrite it with a claim this run did not make.
			const sections = {
				usage: entry ? { invocations: entry.invocations, lastInvoked: entry.lastInvoked } : null
			}
			if (installRoot) sections.install = computeInstall(s.dir, installRoot)
			writeLedgerSections(s.dir, sections, library)
		}
	}

	const { d7, d30, d90, all } = ledger.totals.invocations
	const { skills } = ledger.totals
	process.stdout.write(
		`${relative(DEFAULT_LIBRARY, out)} — ${all} invocation(s) of ${skills} skill(s) across ${ledger.scanned.files} transcript(s)\n` +
			`  last 7 days ${d7} · 30 days ${d30} · 90 days ${d90} · all time ${all}\n`
	)
	// Printed, not buried in the file. A window deeper than the data is the
	// commonest way to misread this output, so it is said out loud every run.
	const short = Object.entries(ledger.windows).filter(([, w]) => w.reachesBeforeCorpus).map(([k]) => k)
	if (short.length)
		process.stdout.write(
			`  ${short.join(', ')} reach${short.length === 1 ? 'es' : ''} back further than the transcripts do` +
				` (${ledger.corpus.spanDays} days on this machine) — those counts are not full-window figures\n`
		)
	if (ledger.scanned.skipped)
		process.stdout.write(`  ${ledger.scanned.skipped} unparseable line(s) skipped (open sessions are appended live)\n`)
	if (ledger.scanned.undated) process.stdout.write(`  ${ledger.scanned.undated} invocation(s) with no timestamp\n`)
	return 0
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

export const _url = pathToFileURL(fileURLToPath(import.meta.url)).href
