#!/usr/bin/env node
// Self-test: does usage.test.mjs actually catch anything?
//
// A suite that has only ever passed has not been tested. This mutates usage.mjs
// in specific ways, runs the suite against each mutant, and asserts the suite
// FAILS every time. A surviving mutation names a guard nobody is really
// checking.
//
// It matters particularly for a counter. A counter's failure mode is not a
// crash — it is a plausible number. Counting prose mentions as invocations,
// dropping the namespace off a plugin skill, letting a truncated line abort a
// file: every one of those still prints a tidy ledger, and the wrong ledger is
// then used to decide which skills get deleted.
//
// The mutant is always a copy in a temp directory. try/finally survives an
// exception but not a signal, and a Ctrl-C at the wrong moment would otherwise
// leave the shipped script silently wrong.
//
//   node scripts/usage.self-test.mjs

import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'


import { mutate } from './mutate.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const SRC = join(HERE, 'usage.mjs')
const TEST = join(HERE, 'usage.test.mjs')
const FIXTURES = join(HERE, 'fixtures')

// Each mutation is a defect a careless edit could plausibly introduce. `find`
// must appear exactly once, so a silent no-op cannot masquerade as a survivor.
//
// `expect: 'survives'` marks an inert control: a harness that can only ever say
// "caught" proves nothing about itself.
const MUTATIONS = [
	{
		name: 'any tool counts, not just Skill',
		find: "if (block.type !== 'tool_use' || block.name !== 'Skill') continue",
		replace: "if (block.type !== 'tool_use') continue",
	},
	{
		name: 'the plugin namespace is stripped off the name',
		find: "out.push({ skill, at: record.timestamp ?? null })",
		replace: "out.push({ skill: skill.split(':').pop(), at: record.timestamp ?? null })",
	},
	{
		name: 'a bad line aborts the rest of its file',
		find: `			if (parsed === null) {
				skipped++
				continue
			}`,
		replace: `			if (parsed === null) {
				skipped++
				break
			}`,
	},
	{
		name: 'a bad line is skipped but not counted',
		find: '				skipped++\n				continue',
		replace: '				continue',
	},
	{
		name: 'the d7 window is a month wide',
		find: "\t['d7', 7],",
		replace: "\t['d7', 30],",
	},
	{
		name: 'windows are open at the far end — everything lands in d7',
		find: 'return e.ms >= from && e.ms <= endMs',
		replace: 'return e.ms <= endMs',
	},
	{
		name: 'lastInvoked reports the oldest run instead of the newest',
		find: 'row.lastFired = mine.length ? new Date(Math.max(...mine.map((e) => e.ms))).toISOString() : null',
		replace: 'row.lastFired = mine.length ? new Date(Math.min(...mine.map((e) => e.ms))).toISOString() : null',
	},
	{
		name: 'skill keys come out in encounter order, so the file churns',
		find: 'const names = [...new Set(events.map((e) => e.skill))].sort()',
		replace: 'const names = [...new Set(events.map((e) => e.skill))]',
	},
	{
		name: "the invocation's arguments are carried into the ledger",
		find: "out.push({ skill, at: record.timestamp ?? null })",
		replace: "out.push({ skill, at: record.timestamp ?? null, args: block.input?.args })",
		// Nothing in summarise() copies `args` through today, so this mutation
		// leaks only if someone later spreads the event object into the output.
		// Kept because that is exactly the edit that would do it silently.
		expect: 'survives',
	},
	{
		name: 'an out-of-library --out is accepted',
		find: "	if (relative(library, out).startsWith('..')) {",
		replace: '	if (false) {',
	},
	{
		// The defect this shipped with. Nothing throws and nothing looks wrong:
		// a ledger/ appears in whatever directory the caller was standing in,
		// and the run reports success.
		name: 'a directory that is not a library is written into anyway',
		find: "		if (!existsSync(join(library, 'skills'))) {",
		replace: '		if (false) {',
	},
	{
		// The guard kept but narrowed to the aggregate, leaving the other write
		// this command makes — an unnamed baseline — unguarded.
		name: 'only the aggregate is guarded, not the baseline',
		find: "	if (!namedOut && !argv.includes('--json') && !(wantsReport && !argv.includes('--baseline'))) {",
		replace: "	if (!namedOut && !argv.includes('--json') && !wantsReport) {",
	},
	{
		name: 'a blank line counts as a corrupt one',
		find: "			if (!line.trim()) continue",
		replace: "			if (false) continue",
	},
	{
		name: 'the ledger claims it can tell who initiated an invocation',
		find: "			cannotDistinguish: ['who initiated an invocation — model-fired and user-typed read identically'],",
		replace: '			cannotDistinguish: [],',
	},
	{
		name: 'counts revert to a name that asserts auto-firing',
		find: '			lastInvoked: row.lastFired,',
		replace: '			lastFired: row.lastFired,',
	},
	{
		name: 'a window deeper than the data no longer says so',
		find: "reachesBeforeCorpus: oldest !== null && start < oldest }",
		replace: 'reachesBeforeCorpus: false }',
	},
	{
		name: 'corpus depth is reported as the window rather than the data',
		find: "		oldest && newest ? Math.round((Date.parse(newest) - Date.parse(oldest)) / DAY) : null",
		replace: '		90',
	},
	{
		name: 'the reference pointer goes stale',
		find: "			reference: 'commands/TRANSCRIPTS.md',",
		replace: "			reference: 'scripts/NOTES.md',",
	},
	// ── SK-12 · the report: usage joined to cost ──────────────────────────────
	//
	// A report's failure mode is the counter's failure mode one level up. Every
	// mutation below still prints a tidy table; each one just makes it mean
	// something else, and the wrong table is then used to decide which skills
	// get deleted.
	{
		name: 'a held skill that never fired loses its row',
		find: '	const rows = held.map((s) => {',
		replace: '	const rows = held.filter((s) => ledger.skills[s.name]).map((s) => {',
	},
	{
		name: 'a zero-invocation skill is priced at zero rather than left undefined',
		find: '			bytesPerInvocation: invocations.all > 0 ? s.descriptionBytes / invocations.all : null,',
		replace: '			bytesPerInvocation: invocations.all > 0 ? s.descriptionBytes / invocations.all : 0,',
	},
	{
		name: 'bytes-per-invocation is divided by the last seven days, not all time',
		find: '			bytesPerInvocation: invocations.all > 0 ? s.descriptionBytes / invocations.all : null,',
		replace: '			bytesPerInvocation: invocations.d7 > 0 ? s.descriptionBytes / invocations.d7 : null,',
	},
	{
		name: 'description cost is counted in characters rather than UTF-8 bytes',
		find: "			descriptionBytes: Buffer.byteLength(description, 'utf8'),",
		replace: '			descriptionBytes: description.length,',
	},
	{
		name: 'every skill reads as model-invocable',
		find: "			manualOnly: String(fm['disable-model-invocation']) === 'true',",
		replace: '			manualOnly: false,',
	},
	{
		name: 'a directory with no SKILL.md becomes a skill costing nothing',
		find: `		if (!existsSync(file)) continue
		let text
		try {
			text = readFileSync(file, 'utf8')
		} catch {
			continue
		}`,
		replace: `		let text = ''
		try {
			text = readFileSync(file, 'utf8')
		} catch {}`,
	},
	{
		name: 'names invoked but not held here are silently dropped',
		find: '		.filter(([name]) => !heldNames.has(name))',
		replace: '		.filter(([name]) => heldNames.has(name))',
	},
	{
		name: 'invocations of names this repository does not hold are counted as its own',
		find: '			heldInvocations: spread(rows),',
		replace: '			heldInvocations: spread([...rows, ...unheld]),',
	},
	{
		name: 'the unheld table is ordered by name rather than by weight',
		find: '		.sort((a, b) => b.invocations.all - a.invocations.all || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))',
		replace: '		.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))',
	},
	{
		name: 'the cheapest rows come first, burying the ones that cost most',
		find: '		if (!an && a.bytesPerInvocation !== b.bytesPerInvocation) return b.bytesPerInvocation - a.bytesPerInvocation',
		replace: '		if (!an && a.bytesPerInvocation !== b.bytesPerInvocation) return a.bytesPerInvocation - b.bytesPerInvocation',
	},
	{
		name: 'the undenominated rows sort to the bottom, where nobody reads them',
		find: '		if (an !== bn) return an ? -1 : 1',
		replace: '		if (an !== bn) return an ? 1 : -1',
	},
	{
		name: 'the never-invoked summary counts the last seven days, not all time',
		find: '	const never = rows.filter((r) => r.invocations.all === 0)',
		replace: '	const never = rows.filter((r) => r.invocations.d7 === 0)',
	},
	{
		name: 'an undated invocation reads as never invoked',
		find: "const day = (invocations, iso) => (iso ? iso.slice(0, 10) : invocations.all === 0 ? 'never' : 'undated')",
		replace: "const day = (invocations, iso) => (iso ? iso.slice(0, 10) : 'never')",
	},
	{
		name: 'a window deeper than the transcripts is no longer marked in the table',
		find: "	const short = ['d7', 'd30', 'd90'].filter((w) => ledger.windows[w]?.reachesBeforeCorpus)",
		replace: '	const short = []',
	},
	{
		name: 'the report stops saying how deep the corpus is',
		find: "			`${ledger.corpus.spanDays === null ? 'no' : ledger.corpus.spanDays} day(s) deep` +",
		replace: '			`` +',
	},
	{
		name: 'the baseline is dated from the clock rather than from the ledger',
		find: 'export const baselineName = (ledger) => `baseline-${ledger.now.slice(0, 10)}.md`',
		replace: 'export const baselineName = () => `baseline-${new Date().toISOString().slice(0, 10)}.md`',
	},
	{
		name: 'a baseline overwrites the reading it exists to be compared against',
		find: '		if (existsSync(file)) {',
		replace: '		if (false) {',
	},
	{
		name: 'the --report flag is ignored and the ledger is written instead',
		find: "	const wantsReport = argv.includes('--report')",
		replace: '	const wantsReport = false',
	},
	{
		name: '--report and --json are reconciled quietly instead of refused',
		find: "	if (wantsReport && argv.includes('--json')) {",
		replace: '	if (false) {',
	},
	{
		name: '--baseline without --report is accepted',
		find: "	if (argv.includes('--baseline') && !wantsReport) {",
		replace: '	if (false) {',
	},
	{
		name: "INERT CONTROL — the cost section's banner reworded, nothing else",
		find: '// --------------------------------------------------------------------- cost',
		replace: '// --------------------------------------------------- what a slot costs you',
		expect: 'survives',
	},
	{
		name: 'INERT CONTROL — a comment reworded, nothing else',
		find: '// ---------------------------------------------------------------- discovery',
		replace: '// ------------------------------------------------------- finding the files',
		expect: 'survives',
	},
]

// Nested one level under scripts/, mirroring the real repo, rather than
// flat in the sandbox root. usage.test.mjs computes its own root as
// dirname(HERE), and ledger.mjs resolved its own the same way from its file
// location — before SK-97 renamed the concept to LIBRARY and made it a thing
// the caller names
// (scripts/ledger.mjs, two dirnames up) — both intentionally point at
// whatever sits one level above the scripts/ directory. Flat, they both
// resolved to os.tmpdir() itself, since that is exactly one level above a
// bare mkdtemp result, which made "refuses a path outside the repository"
// unable to fail correctly: the escape-target path (also under
// os.tmpdir()) then read as *inside* the sandbox's own accidental "repo".
// Real bug, not a sandbox artefact — it was masked on macOS only by an
// unrelated /var → /private/var symlink making the two paths compare as
// different prefixes, and caught this on Linux, where nothing masks it.

await mutate({
	name: 'usage',
	test: TEST,
	sources: { 'usage.mjs': SRC },
	// Under scripts/, the depth the suite expects: it reaches its fixtures and
	// TRANSCRIPTS.md relative to itself.
	build: (dir, files) => {
		const scriptsDir = join(dir, 'scripts')
		mkdirSync(scriptsDir)
		cpSync(TEST, join(scriptsDir, 'usage.test.mjs'))
		cpSync(FIXTURES, join(scriptsDir, 'fixtures'), { recursive: true })
		cpSync(join(HERE, 'TRANSCRIPTS.md'), join(scriptsDir, 'TRANSCRIPTS.md'))
		cpSync(join(HERE, 'ledger.mjs'), join(scriptsDir, 'ledger.mjs'))
		writeFileSync(join(scriptsDir, 'usage.mjs'), files['usage.mjs'])
		return join(scriptsDir, 'usage.test.mjs')
	},
	mutations: MUTATIONS
})
