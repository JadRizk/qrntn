#!/usr/bin/env node
//
// Known-answer tests for the usage counter.
//
// Every expected number here was decided when the fixtures were written, from
// timestamps placed at chosen distances from a fixed `now` — one day, ten days,
// sixty days, two hundred days. None of it was read back off a run of this
// tool, which would only prove the tool agrees with itself.
//
// The fixed instant is 2026-08-24T12:00:00.000Z. Change it and every window
// assertion below changes with it, which is the point: the windows are the
// arithmetic under test.
//
//   node scripts/usage.test.mjs

import { spawnSync } from 'node:child_process'
import { readFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { baselineName, heldSkills, parseLine, renderReport, reportModel, scan, summarise, transcripts } from './usage.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = dirname(HERE)
const FIXTURES = join(HERE, 'fixtures', 'transcripts')
const NOW = '2026-08-24T12:00:00.000Z'

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

const eq = (got, want, what = '') => {
	const g = JSON.stringify(got)
	const w = JSON.stringify(want)
	if (g !== w) throw new Error(`${what} expected ${w}, got ${g}`)
}

const ok = (cond, msg) => {
	if (!cond) throw new Error(msg)
}

const ledger = () => summarise(scan(FIXTURES), NOW, FIXTURES)

// ─────────────────────────────────────────────────────────── what is counted ──

check('a project where no skill ever fired contributes nothing', () => {
	const only = summarise(scan(join(FIXTURES, 'quiet-project')), NOW, FIXTURES)
	eq(only.totals.invocations.all, 0, 'invocations')
	eq(only.totals.skills, 0, 'distinct skills')
	eq(only.skills, {}, 'the skills table')
	// The window bounds still have to be reported. A run over a quiet corpus is
	// a real answer — "nothing fired in 90 days" — not an empty one.
	eq(only.windows.d30.start, '2026-07-25T12:00:00.000Z', 'd30 start')
	eq(only.windows.all.start, null, 'all-time start with no events')
})

check('a skill named in prose is not an invocation', () => {
	// The finding this whole ticket exists to make measurable: what a transcript
	// *mentions* and what it *ran* are different numbers, and only one of them
	// says whether a skill earns its context slot.
	const only = summarise(scan(join(FIXTURES, 'prose-only')), NOW, FIXTURES)
	eq(only.totals.invocations.all, 0, 'invocations in a file that names two skills in prose')
	ok(!('dataviz' in only.skills), 'dataviz was named in text, not invoked')
})

check('a non-Skill tool whose input mentions a skill is not an invocation', () => {
	// prose-only also holds a Bash call whose command contains "dataviz" and a
	// Task call whose subagent_type is "dataviz". Matching on input rather than
	// on `name === "Skill"` would count both.
	const raw = readFileSync(join(FIXTURES, 'prose-only', 'session.jsonl'), 'utf8')
	ok(/"subagent_type":\s*"dataviz"/.test(raw), 'fixture no longer holds the Task decoy')
	ok(raw.includes('echo dataviz'), 'fixture no longer holds the Bash decoy')
	eq(summarise(scan(join(FIXTURES, 'prose-only')), NOW, FIXTURES).totals.invocations.all, 0, 'decoys counted')
})

check('a non-Skill tool carrying a skill field is not an invocation', () => {
	// The decoy fixture holds a Task call with `input.skill` and a SkillSearch
	// call with `input.skill`. Matching on the input rather than on
	// `name === "Skill"` counts both, and the ledger then reports skills that
	// were looked up rather than run.
	const only = summarise(scan(join(FIXTURES, 'decoys')), NOW, FIXTURES)
	eq(only.totals.invocations.all, 0, 'invocations among the decoys')
	eq(only.skills, {}, 'the skills table')
})

check('a plugin-namespaced name is counted under its full name', () => {
	const l = ledger()
	eq(l.skills['figma:implement-design'].invocations.all, 2, 'figma:implement-design')
	eq(l.skills['code-review:code-review'].invocations.all, 1, 'code-review:code-review')
	// Not split on the colon, not folded into a bare `implement-design`.
	ok(!('implement-design' in l.skills), 'the namespace was stripped somewhere')
	ok(!('figma' in l.skills), 'the name was split on its colon')
})

check('two skills in one assistant turn both count', () => {
	const l = ledger()
	eq(l.skills.run.invocations.all, 1, 'run')
	ok(l.skills.dataviz.invocations.all >= 1, 'dataviz from the same turn')
})

// ───────────────────────────────────────────────────────────────── truncation ──

check('a truncated final line is skipped and counted, never thrown on', () => {
	const l = summarise(scan(join(FIXTURES, 'live-session')), NOW, FIXTURES)
	eq(l.scanned.skipped, 2, 'skipped lines')
	// One of the two bad lines is in the MIDDLE of the file, with good records
	// after it. Bailing on the file at the first bad line loses those silently,
	// which is why the fixture is shaped this way rather than with the damage
	// only at the tail where `break` and `continue` look identical.
	eq(l.totals.invocations.all, 3, 'invocations either side of the mid-file truncation')
	eq(l.skills.dataviz.invocations.all, 2, 'dataviz')
	eq(l.skills['artifact-design'].invocations.all, 1, 'the record after the bad line')
})

check('parseLine returns null for a bad line and [] for an uninteresting one', () => {
	eq(parseLine('{"type":"assistant"'), null, 'truncated JSON')
	eq(parseLine('not json at all'), null, 'not JSON')
	eq(parseLine(''), [], 'a blank line is not a defect')
	eq(parseLine('   '), [], 'whitespace is not a defect')
	eq(parseLine('null'), [], 'valid JSON that is not a record')
	eq(parseLine('{"message":{"content":"a plain string turn"}}'), [], 'string content')
	eq(parseLine('{"message":{"content":[{"type":"text","text":"hi"}]}}'), [], 'a text block')
})

check('a blank line is not counted as skipped', () => {
	// Otherwise every file ending in a newline reports phantom corruption, and
	// the number that is supposed to mean "something is wrong" means nothing.
	const dir = mkdtempSync(join(tmpdir(), 'usage-blank-'))
	writeFileSync(join(dir, 'a.jsonl'), '\n\n\n')
	const l = summarise(scan(dir), NOW, dir)
	eq(l.scanned.skipped, 0, 'skipped')
	eq(l.scanned.lines, 0, 'lines')
	rmSync(dir, { recursive: true, force: true })
})

// ─────────────────────────────────────────────────────────────────── windows ──

check('the windows bucket by age, measured from --now', () => {
	// Scoped to the fixture built for this: in `mixed`, artifact-design fired 1,
	// 10, 60 and 200 days before NOW and nowhere else. Asserting against the
	// whole corpus would fold in live-session's copy and make the arithmetic
	// unreadable.
	const a = summarise(scan(join(FIXTURES, 'mixed')), NOW, FIXTURES).skills['artifact-design']
	eq(a.invocations.d7, 1, 'd7')
	eq(a.invocations.d30, 2, 'd30')
	eq(a.invocations.d90, 3, 'd90')
	eq(a.invocations.all, 4, 'all')
	eq(a.lastInvoked, '2026-08-23T12:00:00.000Z', 'lastInvoked')
})

check('each window reports its own start and end', () => {
	const w = ledger().windows
	eq(w.d7.start, '2026-08-17T12:00:00.000Z', 'd7 start')
	eq(w.d30.start, '2026-07-25T12:00:00.000Z', 'd30 start')
	eq(w.d90.start, '2026-05-26T12:00:00.000Z', 'd90 start')
	for (const k of ['d7', 'd30', 'd90', 'all']) eq(w[k].end, NOW, `${k} end`)
	// All-time starts at the oldest event actually seen, not at an epoch.
	eq(w.all.start, '2026-02-05T12:00:00.000Z', 'all start')
})

check('an invocation with no timestamp counts in all and in no dated window', () => {
	const l = ledger()
	eq(
		l.skills['undated-skill'],
		{ invocations: { d7: 0, d30: 0, d90: 0, all: 1 }, lastInvoked: null },
		'undated-skill'
	)
	eq(l.scanned.undated, 1, 'undated count is reported, not hidden')
})

check('totals agree with the per-skill rows', () => {
	// A total that does not add up is the failure mode nobody notices, because
	// each number looks plausible alone.
	const l = ledger()
	for (const w of ['d7', 'd30', 'd90', 'all']) {
		const summed = Object.values(l.skills).reduce((n, s) => n + s.invocations[w], 0)
		eq(l.totals.invocations[w], summed, `${w} total vs sum of skills`)
	}
	eq(l.totals.skills, Object.keys(l.skills).length, 'distinct skill count')
})

// ────────────────────────────────────────────────────────── shape and safety ──

check('arguments never reach the output', () => {
	// input.args is whatever the user typed. The fixtures put a marker string in
	// every one of them; none of it may appear in the ledger.
	const raw = readFileSync(join(FIXTURES, 'mixed', 'session.jsonl'), 'utf8')
	ok(raw.includes('never counted, never emitted'), 'fixture no longer carries an args marker')
	ok(!JSON.stringify(ledger()).includes('never counted'), "an invocation's arguments leaked into the ledger")
})

check('message text never reaches the output', () => {
	const raw = readFileSync(join(FIXTURES, 'prose-only', 'session.jsonl'), 'utf8')
	ok(raw.includes('You could use dataviz'), 'fixture no longer carries prose')
	ok(!JSON.stringify(ledger()).includes('You could use'), 'message text leaked into the ledger')
})

check('skill keys come out sorted, so the file is stable', () => {
	const keys = Object.keys(ledger().skills)
	eq(keys, [...keys].sort(), 'skill order')
})

check('transcripts() finds every .jsonl at any depth, and nothing else', () => {
	const found = transcripts(FIXTURES).map((p) => p.slice(FIXTURES.length + 1))
	eq(found.length, 6, 'fixture transcripts found')
	ok(
		found.every((p) => p.endsWith('.jsonl')),
		'a non-jsonl file was picked up'
	)
	eq(found, [...found].sort(), 'file order is sorted')
})

check('a missing root is an empty answer, not a crash', () => {
	const l = summarise(scan(join(FIXTURES, 'no-such-directory')), NOW, FIXTURES)
	eq(l.totals.invocations.all, 0, 'invocations')
	eq(l.scanned.files, 0, 'files')
})

check('an unparseable --now is refused rather than silently becoming NaN', () => {
	let threw = null
	try {
		summarise({ files: 0, lines: 0, skipped: 0, events: [] }, 'not-a-date', FIXTURES)
	} catch (e) {
		threw = e.message
	}
	ok(threw && /not a date/.test(threw), `expected a refusal, got ${threw}`)
})

// ──────────────────────────────────────── what the names claim (SK-11) ──

// Names are the whole deliverable of SK-11: a ledger that says `autoFires` is
// asserting something the transcript cannot show, and it will be believed
// because it is in a JSON file next to numbers that are true.
const FORBIDDEN = ['autoFires', 'autoFired', 'modelFired', 'userTyped', 'userInvoked', 'lastFired', 'triggers']

check('no field name claims a distinction the transcript cannot make', () => {
	const walk = (node, path = '') => {
		if (!node || typeof node !== 'object') return []
		if (Array.isArray(node)) return node.flatMap((v, i) => walk(v, `${path}[${i}]`))
		return Object.entries(node).flatMap(([k, v]) => [
			...(FORBIDDEN.includes(k) ? [`${path}.${k}`] : []),
			...walk(v, `${path}.${k}`),
		])
	}
	eq(walk(ledger()), [], 'field names asserting an underivable distinction')
})

check('counts are named invocations, and the ledger says what that means', () => {
	const l = ledger()
	eq(l.measures.unit, 'invocations', 'the unit')
	ok(/tool_use block named "Skill"/.test(l.measures.definition), `definition: ${l.measures.definition}`)
	ok(l.measures.cannotDistinguish.length > 0, 'nothing recorded as undistinguishable')
	ok(
		l.measures.cannotDistinguish.some((s) => /who initiated/.test(s)),
		'the initiator result is the one negative that must survive in the file'
	)
	// A consumer reading the JSON alone still gets the caveat. A file that has
	// to be read alongside a document to avoid being misread is read alone.
	eq(l.measures.reference, 'commands/TRANSCRIPTS.md', 'the reference')
	for (const row of Object.values(l.skills)) {
		eq(Object.keys(row).sort(), ['invocations', 'lastInvoked'], 'a skill row')
		eq(Object.keys(row.invocations).sort(), ['all', 'd30', 'd7', 'd90'], 'the windows on a row')
	}
})

check('the reference the ledger names actually exists and answers the question', () => {
	// Otherwise `measures.reference` is a pointer at nothing, which is worse
	// than no pointer: it reads as though the caveat has been written down.
	// Resolved as a sibling of usage.mjs, not as REPO/scripts/…. Under the
	// mutation self-test the suite runs from a temp directory where REPO is the
	// shared tmpdir, and a path built from it points at something this test does
	// not own — the same mistake the --out test made, and it showed up the same
	// way: the inert control failing for a reason unrelated to any mutation.
	const doc = join(HERE, 'TRANSCRIPTS.md')
	ok(existsSync(doc), 'commands/TRANSCRIPTS.md is missing')
	const text = readFileSync(doc, 'utf8')
	ok(/caller\.type/.test(text), 'the caller.type result is not recorded')
	ok(/command-name/.test(text), 'the <command-name> negative result is not recorded')
	ok(/[Rr]etention/.test(text), 'the retention window is not stated')
})

// ──────────────────────────────────────────── the sample, and its depth ──

check('the corpus reports its own depth', () => {
	// Counts are a sample, not a history. Without this a zero in a window is
	// unreadable: unused, or simply older than the transcripts.
	const l = ledger()
	eq(l.corpus.oldestRecord, '2026-02-05T12:00:00.000Z', 'oldest record')
	eq(l.corpus.newestRecord, '2026-08-24T08:02:00.000Z', 'newest record')
	eq(l.corpus.spanDays, 200, 'span in days')
})

const corpusOf = (stamps) => {
	const dir = mkdtempSync(join(tmpdir(), 'usage-span-'))
	writeFileSync(
		join(dir, 'a.jsonl'),
		stamps
			.map((timestamp) =>
				JSON.stringify({
					type: 'assistant',
					timestamp,
					message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Skill', input: { skill: 'x' } }] },
				})
			)
			.join('\n') + '\n'
	)
	const l = summarise(scan(dir), NOW, dir)
	rmSync(dir, { recursive: true, force: true })
	return l
}

check('a window reaching back past the data says so', () => {
	// The boundary is the point. A corpus 23 days deep contains a whole d7 and
	// cannot contain a d30, so exactly one of those flags flips — which is the
	// difference between "nothing fired in 30 days" and "there are not 30 days
	// of transcripts here". Both print as a zero.
	const deep = corpusOf(['2026-08-01T12:00:00.000Z', '2026-08-24T00:00:00.000Z'])
	eq(deep.corpus.spanDays, 23, 'span')
	eq(deep.windows.d7.reachesBeforeCorpus, false, 'd7 fits inside 23 days of data')
	eq(deep.windows.d30.reachesBeforeCorpus, true, 'd30 does not')
	eq(deep.windows.d90.reachesBeforeCorpus, true, 'nor does d90')

	// And with a single record, every window reaches past the data.
	const thin = corpusOf(['2026-08-20T12:00:00.000Z'])
	eq(thin.corpus.spanDays, 0, 'a one-record corpus spans no days')
	for (const w of ['d7', 'd30', 'd90'])
		eq(thin.windows[w].reachesBeforeCorpus, true, `${w} against a 4-day-old single record`)
})

check('an empty corpus reports no depth rather than a fake one', () => {
	const l = summarise(scan(join(FIXTURES, 'quiet-project')), NOW, FIXTURES)
	// quiet-project has records but no invocations — depth is real, counts are 0.
	ok(l.corpus.oldestRecord !== null, 'a corpus with records has a depth')
	const none = summarise(scan(join(FIXTURES, 'no-such-directory')), NOW, FIXTURES)
	eq(none.corpus, { oldestRecord: null, newestRecord: null, spanDays: null }, 'an absent corpus')
})

// ───────────────────────────────────────────────────── the CLI, as a contract ──

const cli = (args) => spawnSync(process.execPath, [join(HERE, 'usage.mjs'), ...args], { cwd: REPO, encoding: 'utf8' })

check('--now against the fixtures is byte-identical on repeat runs', () => {
	// The gate. Two runs, same bytes — otherwise the ledger churns in every diff
	// and nobody can see a real change in it.
	const args = ['--root', FIXTURES, '--now', NOW, '--json']
	const a = cli(args)
	const b = cli(args)
	eq(a.status, 0, 'exit code')
	ok(a.stdout.length > 0, 'no output')
	ok(a.stdout === b.stdout, 'two runs with the same --now produced different bytes')
	// And it really is parsing the fixtures, not returning a constant.
	const parsed = JSON.parse(a.stdout)
	eq(parsed.totals.invocations.all, 13, 'total invocations in the fixture corpus')
})

check('--json writes nothing', () => {
	const out = join(REPO, 'ledger', 'usage.json')
	const before = existsSync(out) ? readFileSync(out, 'utf8') : null
	cli(['--root', FIXTURES, '--now', NOW, '--json'])
	const after = existsSync(out) ? readFileSync(out, 'utf8') : null
	eq(after, before, '--json changed ledger/usage.json')
})

check('--out is refused when it points outside the library', () => {
	// The escape target is unique to this process and removed either side of the
	// run. An earlier version used a fixed name in the repository's parent, so a
	// mutant that DID write it left the file behind and every later run — the
	// mutation self-test's inert control included — failed on the leftover.
	const escapee = join(tmpdir(), `usage-escaped-${process.pid}.json`)
	rmSync(escapee, { force: true })
	try {
		const r = cli(['--root', FIXTURES, '--now', NOW, '--out', escapee])
		eq(r.status, 2, 'exit code')
		ok(/must stay inside the library/.test(r.stderr), `expected a refusal, got ${r.stderr}`)
		ok(!existsSync(escapee), 'the file was written anyway')
	} finally {
		rmSync(escapee, { force: true })
	}
})

check('writing the ledger produces the same bytes as --json', () => {
	const dir = mkdtempSync(join(tmpdir(), 'usage-out-'))
	try {
		const out = join(REPO, 'ledger', '.usage-test.json')
		const printed = cli(['--root', FIXTURES, '--now', NOW, '--json']).stdout
		const r = cli(['--root', FIXTURES, '--now', NOW, '--out', out])
		eq(r.status, 0, 'exit code')
		eq(readFileSync(out, 'utf8'), printed, 'written bytes differ from printed bytes')
		rmSync(out, { force: true })
	} finally {
		rmSync(dir, { recursive: true, force: true })
	}
})

// ────────────────────────────────────────── cost: what a held skill charges ──

// The fixture skills under scripts/fixtures/skills/ were written to counted
// lengths before any of this ran; their README states each one. Resolved as a
// sibling of this file, never as REPO/scripts/… — under the mutation self-test
// the suite runs from a temp directory where REPO is the shared tmpdir, and a
// path built from it points at something this test does not own.
const SKILLS = join(HERE, 'fixtures', 'skills')

const held = () => heldSkills(SKILLS)
const model = () => reportModel(ledger(), held())

check('heldSkills reads every SKILL.md under the directory and nothing else', () => {
	const h = held()
	eq(
		h.map((s) => s.name),
		['artifact-design', 'dataviz', 'never-fired', 'no-description', 'run', 'undated-skill'],
		'held skill names, sorted'
	)
	// A directory with no SKILL.md is not a skill. Counting it would put a row
	// in the table costing zero bytes and invoked zero times — an accusation
	// against something that does not exist.
	ok(
		!h.some((s) => s.name === 'not-a-skill'),
		'a directory without a SKILL.md was counted as a skill'
	)
	// README.md sits beside the directories and is not one.
	ok(!h.some((s) => s.name === 'README.md'), 'a loose file was counted as a skill')
})

check('description cost is measured in UTF-8 bytes, not characters', () => {
	// `Alpha — beta.` is thirteen characters and fifteen bytes; the gap is the
	// em dash. Every description in the real skills/ is full of them, so
	// counting characters would understate the bill by the width of the
	// author's punctuation habits.
	const raw = readFileSync(join(SKILLS, 'artifact-design', 'SKILL.md'), 'utf8')
	ok(raw.includes('Alpha — beta.'), 'fixture description changed; the byte counts below are stale')
	const by = Object.fromEntries(held().map((s) => [s.name, s.descriptionBytes]))
	eq(by['artifact-design'], 15, 'artifact-design (13 chars)')
	eq(by.dataviz, 17, 'dataviz (15 chars)')
	eq(by.run, 8, 'run (ASCII, so chars and bytes agree)')
	eq(by['never-fired'], 19, 'never-fired (17 chars)')
	// Zero, not absent. A skill with no description costs nothing and can never
	// be chosen; that is a real state and it must read as a number.
	eq(by['no-description'], 0, 'no-description')
})

check('manual-only is read off the frontmatter, not guessed', () => {
	const manual = held()
		.filter((s) => s.manualOnly)
		.map((s) => s.name)
	eq(manual, ['run'], 'skills carrying disable-model-invocation: true')
})

check('a missing skills directory is an empty answer, not a crash', () => {
	eq(heldSkills(join(SKILLS, 'no-such-directory')), [], 'held skills')
})

check('every held skill gets a row, including the ones with no ledger entry', () => {
	// The row this whole report exists to produce. A skill that never fired has
	// no key in ledger.skills at all, and a join that only walks the ledger
	// drops exactly the rows worth looking at.
	const names = model().rows.map((r) => r.name)
	ok(names.includes('never-fired'), 'a held skill absent from the ledger lost its row')
	ok(names.includes('no-description'), 'a held skill absent from the ledger lost its row')
	eq(names.length, 6, 'one row per held skill')
})

check('bytes-per-invocation divides description bytes by all-time invocations', () => {
	const by = Object.fromEntries(model().rows.map((r) => [r.name, r]))
	eq(by['artifact-design'].bytesPerInvocation, 3, '15 bytes ÷ 5 invocations')
	eq(by.dataviz.bytesPerInvocation, 17 / 3, '17 bytes ÷ 3 invocations')
	eq(by.run.bytesPerInvocation, 8, '8 bytes ÷ 1 invocation')
	// All-time, not d7. artifact-design fired twice in the last seven days and
	// five times in the corpus; the denominator that changes with the window is
	// not a property of the skill.
	eq(by['artifact-design'].invocations.d7, 2, 'the d7 count, for contrast')
})

check('a held skill with zero invocations has no ratio — not zero, not infinity', () => {
	// Division by zero is the interesting row, not an error. `null` is the only
	// honest value: 0 would read as free, which is the exact opposite of the
	// truth, and Infinity is a number that invites arithmetic on a quantity
	// with no denominator.
	const by = Object.fromEntries(model().rows.map((r) => [r.name, r]))
	eq(by['never-fired'].bytesPerInvocation, null, 'never-fired')
	eq(by['no-description'].bytesPerInvocation, null, 'no-description, which also has a zero numerator')
	for (const r of model().rows) ok(r.bytesPerInvocation !== Infinity, `${r.name} rendered as Infinity`)
})

check('rows sort dearest first, with the undenominated ones above them all', () => {
	eq(
		model().rows.map((r) => r.name),
		['never-fired', 'no-description', 'undated-skill', 'run', 'dataviz', 'artifact-design'],
		'row order'
	)
	// The two nulls are ordered by name, so the file is stable; the rest run
	// 17.0, 8.0, 5.7, 3.0 — descending, dearest first.
	const rest = model()
		.rows.filter((r) => r.bytesPerInvocation !== null)
		.map((r) => r.bytesPerInvocation)
	eq(
		rest,
		[...rest].sort((a, b) => b - a),
		'defined ratios are not in descending order'
	)
})

check('names invoked but not held are kept, counted, and never mixed in', () => {
	// Roughly 26 of 29 names on the real machine are plugin or project skills.
	// Dropping them hides most of the corpus; folding them into the held table
	// divides an invocation count by a byte total that never included them.
	const m = model()
	eq(
		m.unheld.map((r) => r.name),
		['figma:implement-design', 'code-review:code-review'],
		'unheld names, busiest first'
	)
	const heldNames = m.rows.map((r) => r.name)
	for (const r of m.unheld) ok(!heldNames.includes(r.name), `${r.name} appears in both populations`)
})

check('the two populations partition the corpus exactly', () => {
	// If these ever stop adding up, one of the two tables is quietly lying and
	// each number still looks plausible on its own.
	const l = ledger()
	const t = reportModel(l, held()).totals
	for (const w of ['d7', 'd30', 'd90', 'all'])
		eq(t.heldInvocations[w] + t.unheldInvocations[w], l.totals.invocations[w], `${w} held + unheld vs the corpus`)
	eq(t.held + t.unheld >= l.totals.skills, true, 'every name in the ledger landed in one of the two tables')
	eq(t.heldInvocations.all, 10, 'invocations of skills this repository holds')
	eq(t.unheldInvocations.all, 3, 'invocations of names it does not')
})

check('the totals count the cost, not just the calls', () => {
	const t = model().totals
	eq(t.held, 6, 'held skills')
	eq(t.heldDescriptionBytes, 15 + 17 + 8 + 19 + 0 + 17, 'description bytes loaded every session')
	// All-time zero, not seven-day zero. undated-skill fired once and lands in
	// no dated window; calling it never-invoked would be a claim the data does
	// not make.
	eq(t.neverInvoked, 2, 'held skills never invoked in this corpus')
	eq(t.neverInvokedBytes, 19, 'bytes paid for nothing')
})

// ─────────────────────────────────────────────────────────── the report, read ──

const rendered = () => renderReport(ledger(), held())

check('the report prints every held skill with its counts, cost and ratio', () => {
	const text = rendered()
	const row = text.split('\n').find((l) => l.trim().startsWith('artifact-design'))
	ok(row, 'artifact-design has no row')
	eq(row.trim().split(/\s+/), ['artifact-design', '2', '3', '4', '5', '2026-08-24', '15', '3.0'], 'the row')
	const never = text.split('\n').find((l) => l.trim().startsWith('never-fired'))
	eq(never.trim().split(/\s+/), ['never-fired', '0', '0', '0', '0', 'never', '19', '—'], 'the zero-invocation row')
})

check('a manual-only skill is marked in the table, not silently equated', () => {
	const text = rendered()
	ok(/^\s+run \(manual\)\s/m.test(text), 'run is not marked manual')
	ok(!/^\s+dataviz \(manual\)/m.test(text), 'a model-invocable skill was marked manual')
	ok(/disable-model-invocation/.test(text), 'the marker is never explained')
})

check('an invocation with no timestamp reads as undated, not as never', () => {
	const row = rendered()
		.split('\n')
		.find((l) => l.trim().startsWith('undated-skill'))
	eq(row.trim().split(/\s+/), ['undated-skill', '0', '0', '0', '1', 'undated', '17', '17.0'], 'the undated row')
})

check('the report names the corpus depth in its own header', () => {
	// Without it every count in the table is unreadable: a zero could be a quiet
	// skill or a shallow corpus, and they print identically.
	const text = rendered()
	ok(/200 day\(s\) deep/.test(text), 'the corpus depth is not printed')
	ok(/2026-02-05 → 2026-08-24/.test(text), 'the corpus bounds are not printed')
})

// A ledger is cheap to build by hand, and the window flag needs a corpus
// shallower than the fixtures are. Same shape summarise() emits.
const ledgerWith = (over) => ({
	now: NOW,
	root: '~/fake',
	corpus: { oldestRecord: '2026-08-01T12:00:00.000Z', newestRecord: '2026-08-24T00:00:00.000Z', spanDays: 23 },
	scanned: { files: 1, lines: 2, skipped: 0, undated: 0 },
	windows: {
		d7: { start: '2026-08-17T12:00:00.000Z', end: NOW, reachesBeforeCorpus: false },
		d30: { start: '2026-07-25T12:00:00.000Z', end: NOW, reachesBeforeCorpus: true },
		d90: { start: '2026-05-26T12:00:00.000Z', end: NOW, reachesBeforeCorpus: true },
		all: { start: '2026-08-01T12:00:00.000Z', end: NOW },
	},
	totals: { invocations: { d7: 0, d30: 0, d90: 0, all: 0 }, skills: 0 },
	skills: {},
	...over,
})

check('a window deeper than the corpus is marked in the column and explained', () => {
	// SK-11 exists to prevent exactly this misreading, and a report that printed
	// a d90 column without surfacing it would reintroduce it in a nicer font.
	const text = renderReport(ledgerWith(), held())
	ok(/d30\*/.test(text), 'd30 is not marked')
	ok(/d90\*/.test(text), 'd90 is not marked')
	ok(!/d7\*/.test(text), 'd7 was marked although the corpus covers it')
	ok(/starts? before the oldest record/.test(text), 'the marker is never explained')
	ok(/not in 23 days/.test(text), 'the note does not say how deep the corpus actually is')
})

check('a corpus deeper than every window is marked nowhere', () => {
	// The flag has to be able to be off, or it is decoration rather than a
	// measurement — and a reader who sees it on every report stops reading it.
	const text = rendered()
	for (const w of ['d7', 'd30', 'd90']) ok(!new RegExp(`${w}\\*`).test(text), `${w} was marked on a 200-day corpus`)
})

check('the report says an invocation is not a success and points at the caveats', () => {
	const text = rendered()
	ok(/not a success/.test(text), 'the report does not say what a count is not')
	ok(/commands\/TRANSCRIPTS\.md/.test(text), 'the report does not point at the reference')
	// One reading is a snapshot. The whole design of SK-12 is that the second
	// reading is what makes the first mean anything.
	ok(/snapshot/.test(text) && /trend/.test(text), 'the report does not say a single reading is not a trend')
})

check('the report is deterministic — same ledger, same bytes', () => {
	eq(rendered(), rendered(), 'two renders of the same ledger differ')
})

check('the baseline is named from the ledger, not from the clock', () => {
	// Deliberately not today. A name taken off the system clock passes when the
	// two happen to agree, which is every day you run it by hand and no day you
	// re-run an old reading.
	eq(baselineName({ now: '2021-03-04T09:00:00.000Z' }), 'baseline-2021-03-04.md', 'the derived name')
	eq(baselineName({ now: NOW }), 'baseline-2026-08-24.md', 'the fixture instant')
})

// ─────────────────────────────────────────────────── the report, as a contract ──

const reportArgs = ['--root', FIXTURES, '--skills', SKILLS, '--now', NOW, '--report']

// Every CLI run below gets an --out inside a directory this test owns, even
// the runs that must not write at all. The default --out is REPO/ledger/…, and
// under the mutation self-test REPO is the shared tmpdir the suite was copied
// into — a mutant's stray write there would outlive its own run and skew the
// next one. Two bugs of exactly that shape have already been found here.
const owned = (fn) => {
	const dir = mkdtempSync(join(HERE, '.report-'))
	try {
		return fn(dir)
	} finally {
		rmSync(dir, { recursive: true, force: true })
	}
}

check('--report is byte-identical on repeat runs under --now', () => {
	owned((dir) => {
		const args = [...reportArgs, '--out', join(dir, 'unused.json')]
		const a = cli(args)
		const b = cli(args)
		eq(a.status, 0, 'exit code')
		ok(a.stdout.includes('bytes/inv'), 'no table')
		ok(a.stdout === b.stdout, 'two runs with the same --now produced different bytes')
	})
})

check('--report prints and writes nothing', () => {
	owned((dir) => {
		const target = join(dir, 'should-not-exist.json')
		const r = cli([...reportArgs, '--out', target])
		eq(r.status, 0, 'exit code')
		ok(r.stdout.includes('held skills'), 'no report on stdout')
		ok(!existsSync(target), '--report wrote a file')
	})
})

check('--report and --json are refused together rather than one winning quietly', () => {
	owned((dir) => {
		const r = cli([...reportArgs, '--json', '--out', join(dir, 'unused.json')])
		eq(r.status, 2, 'exit code')
		ok(/different outputs/.test(r.stderr), `expected a refusal, got ${r.stderr}`)
		ok(!existsSync(join(dir, 'unused.json')), 'it wrote something anyway')
	})
})

check('--baseline without --report is refused', () => {
	owned((dir) => {
		const target = join(dir, 'ledger.json')
		const r = cli(['--root', FIXTURES, '--skills', SKILLS, '--now', NOW, '--baseline', '--out', target])
		eq(r.status, 2, 'exit code')
		ok(/--report/.test(r.stderr), `expected a refusal naming --report, got ${r.stderr}`)
		ok(!existsSync(target), 'it wrote something anyway')
	})
})

check('--baseline writes the report, and refuses to overwrite one', () => {
	// A baseline is the fixed end of a comparison. Overwriting it turns the
	// second reading into a second first reading, and nothing says so.
	owned((dir) => {
		const target = join(dir, 'baseline.md')
		const first = cli([...reportArgs, '--baseline', '--out', target])
		eq(first.status, 0, 'exit code on the first write')
		const written = readFileSync(target, 'utf8')
		eq(written, cli([...reportArgs, '--out', join(dir, 'unused.json')]).stdout, 'the baseline differs from the printed report')

		const second = cli([...reportArgs, '--baseline', '--out', target])
		eq(second.status, 2, 'exit code on the second write')
		ok(/not overwritten/.test(second.stderr), `expected a refusal, got ${second.stderr}`)
		eq(readFileSync(target, 'utf8'), written, 'the baseline was overwritten anyway')
	})
})

check('the ledger schema is untouched by any of this', () => {
	// --report is a rendering, not a new field. SK-10 and SK-11 fixed the shape
	// of ledger/usage.json and every consumer of it reads that shape.
	const l = ledger()
	eq(Object.keys(l).sort(), ['corpus', 'measures', 'now', 'root', 'scanned', 'skills', 'totals', 'windows'], 'top level')
	for (const row of Object.values(l.skills)) eq(Object.keys(row).sort(), ['invocations', 'lastInvoked'], 'a skill row')
})

// ──────────────────────────────────────────────────────────────── the library ──
//
// SK-97. This script's own comment used to record, as settled fact, that
// ledger.mjs writes ledger/<name>.json under the real repo root "regardless of
// --root or --skills, because it derives that path from its own file location".
// That was true and it was the defect: a write destination nobody could
// redirect. `--library` names it. `--root` could not be reused — here it
// already means where the transcripts are.
check('--library is a distinct flag from --root, which means transcripts', () => {
	const help = cli(['--help'])
	const text = help.stdout + help.stderr
	ok(/--library/.test(text), 'the library flag is undocumented')
	ok(/--root <dir>\s+where the transcripts are/.test(text), '--root no longer documents the transcripts root')
})

check('--library writes the aggregate into that library, not this tree', () => {
	const lib = mkdtempSync(join(tmpdir(), 'usage-library-'))
	mkdirSync(join(lib, 'skills'), { recursive: true })
	const r = cli(['--root', FIXTURES, '--now', NOW, '--library', lib])
	eq(r.status, 0, `exit code — ${r.stderr.slice(0, 200)}`)
	ok(existsSync(join(lib, 'ledger', 'usage.json')), 'nothing was written into the named library')
	rmSync(lib, { recursive: true, force: true })
})

// ─────────────────────────────────────────────────────────────────── report ──

console.log(`\n  ${pass} passed · ${failures.length} failed\n`)
for (const f of failures) console.log(`  FAIL  ${f}`)
process.exit(failures.length ? 1 : 0)
