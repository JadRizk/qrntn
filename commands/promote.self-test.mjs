#!/usr/bin/env node
// Self-test: does promote.test.mjs actually catch anything?
//
// A suite that has only ever passed has not been tested. This mutates promote.mjs
// in specific ways, runs the suite against each mutant, and asserts the suite
// FAILS every time. A surviving mutation names a guard nobody is really checking.
//
// It matters especially here. This script's failure mode is not a crash — it is
// letting something through while printing nothing, which reads exactly like
// success. A gate that has quietly stopped refusing is worse than no gate,
// because it is the one you trust.
//
// The mutant is always a copy in a temp directory. try/finally survives an
// exception but not a signal, and a Ctrl-C at the wrong moment would otherwise
// leave the shipped gate silently wrong.
//
//   node self-test.mjs

import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const SRC = join(HERE, 'promote.mjs')
const TEST = join(HERE, 'promote.test.mjs')

// promote.test.mjs's own findCheckCatalog() looks for a copy sitting right
// next to itself before walking up from HERE — which, inside the sandbox
// below, is a tmpdir outside the repo. Locating it once here and copying it
// in is what makes that lookup succeed for every mutant.
function findCheckCatalog() {
	// SK-97: a sibling now, not something to walk up the tree for.
	return join(HERE, 'check-catalog.mjs')
}
const CHECK_CATALOG = findCheckCatalog()

// Same reasoning again. promote.mjs no longer *imports* scripts/ledger.mjs —
// SK-97 replaced that with a spawn, so the skill reaches nothing outside its
// own directory — but it still has to find the script to run it, and
// promote.test.mjs's findLedger() checks a sibling of itself before walking up,
// which inside the sandbox is this tmpdir.
function findLedger() {
	// SK-97: a sibling now, not something to walk up the tree for.
	return join(HERE, 'ledger.mjs')
}
const LEDGER = findLedger()

// promote.test.mjs's own findScanner() walks up from itself looking for
// skills/skill-audit/scripts/audit-skill.mjs, falling back to
// ~/.claude/skills/skill-audit only if that walk fails — which, inside this
// sandbox (a tmpdir with no skills/ at all), it always did, silently landing
// on whatever happens to be symlinked into the machine running this. On a
// machine that has run install.sh the fallback quietly papers over it; on a
// CI runner, which never has, findScanner() exits(2) before a single
// assertion runs, and every mutant "passes" by crashing instead of by being
// caught — the exact failure mode its own comment warns about. Seeding a
// real copy at the same relative path the walk already checks first makes
// the primary path succeed here the same way it does in the repo, so this
// suite is testing what it claims to on every machine, not just this one.
function findSkillAudit() {
	// SK-97: promote.test.mjs seeds a skill-audit directory into its fixtures, so
	// it still needs a directory shaped like one — built here from the scanner
	// that ships beside this file rather than found in a library that may not
	// exist.
	const staged = mkdtempSync(join(tmpdir(), 'promote-self-scanner-'))
	mkdirSync(join(staged, 'scripts'), { recursive: true })
	cpSync(join(HERE, 'audit-skill.mjs'), join(staged, 'scripts', 'audit-skill.mjs'))
	return staged
}
const SKILL_AUDIT = findSkillAudit()

// Each mutation is a defect a careless edit could plausibly introduce. `find`
// must appear exactly once, so a silent no-op cannot masquerade as a survivor.
//
// `expect: 'survives'` marks an inert control: a harness that can only ever say
// "caught" proves nothing about itself.
const MUTATIONS = [
	{
		name: 'a missing audit record no longer refused',
		find: "refuse('no AUDIT.md', 'nothing has been adjudicated",
		replace: "return null; refuse('no AUDIT.md', 'nothing has been adjudicated"
	},
	{
		name: 'template placeholders no longer detected',
		find: 'const PLACEHOLDERS = [',
		replace: 'const PLACEHOLDERS = [];\nconst UNUSED_PLACEHOLDERS = ['
	},
	{
		name: 'verdict parsing narrows back to a bare cell, refusing the house format',
		find: "|[\\s*]*(ADOPT|REVISE|REJECT)\\b/i",
		replace: "|\\s*(ADOPT|REVISE|REJECT)\\b/i"
	},
	{
		name: 'a REJECT verdict promotes anyway',
		find: "else if (verdict === 'REJECT')",
		replace: 'else if (false)'
	},
	{
		name: 'any disposition text accepted, including none',
		find: 'const DISPOSITIONS = /^(real|accepted|false positive|fixed|removed|n\\/a)\\b/i',
		replace: 'const DISPOSITIONS = /(?:)/'
	},
	{
		name: 'adapted bytes no longer require an adaptation log',
		find: 'if (!/##\\s*Changes applied/i.test(audit.text)) {',
		replace: 'if (false) {'
	},
	{
		name: 'blocking findings in the re-scan ignored',
		find: "const blocking = (parsed.findings ?? []).filter((f) => f.sev === 'BLOCK' || extraBlocking.includes(f.code))",
		replace: 'const blocking = []'
	},
	{
		name: 'an authored skill is treated as acquired, so a missing record is never checked',
		find: "} else if (!existsSync(join(dir, 'ORIGIN.md')) && !existsSync(join(dir, 'AUDIT.md'))) {",
		replace: '} else if (false) {'
	},
	{
		name: 'an authored over-long description no longer blocks',
		find: "rescan(dir, ['STRUCT-LONGDESC', 'STRUCT-LONGBODY'])",
		replace: 'rescan(dir, [])'
	},
	{
		name: 'a missing catalog.json entry no longer refuses an authored skill',
		find: "if (!filed.has(name)) {\n\t\trefuse('no catalog.json entry'",
		replace: "if (false) {\n\t\trefuse('no catalog.json entry'"
	},
	{
		name: 'a failing catalog check no longer refuses an authored skill',
		find: "if (r.status !== 0) {\n\t\trefuse('the catalog check exits non-zero'",
		replace: "if (false) {\n\t\trefuse('the catalog check exits non-zero'"
	},
	{
		name: 'the "ships nothing executable" statement is honoured even with no such statement written',
		find: 'const shipsNothingExecutable = skillMdText != null && /ships nothing executable/i.test(skillMdText)',
		replace: 'const shipsNothingExecutable = true'
	},
	{
		name: 'failing tests no longer refuse',
		find: 'if (r.status !== 0) refuse(',
		replace: 'if (false) refuse('
	},
	{
		name: 'an executable with no tests waved through',
		find: 'if (computes && !tests.length) {',
		replace: 'if (false) {'
	},
	{
		name: 'promotion overwrites a skill already held',
		find: 'existsSync(join(SKILLS, name))',
		replace: 'false'
	},
	{
		// The defect this suite was blind to for its whole first life: every
		// passing case used --dry-run, so the line that does the work was never
		// run once.
		name: 'the move never happens, while the report still claims it did',
		find: 'if (!refusals.length && !DRY) {',
		replace: 'if (false) {'
	},
	{
		name: 'the destination is never staged',
		find: "execFileSync('git', ['add', join('skills', name), join('ledger', `${name}.json`)], { cwd: LIBRARY, stdio: 'pipe' })",
		replace: 'void 0'
	},
	{
		name: 'the ledger entry is written but never staged, so it never reaches the commit',
		find: "join('skills', name), join('ledger', `${name}.json`)",
		replace: "join('skills', name)"
	},
	{
		name: 'the ledger is never written on a real promotion',
		find: 'writeLedgerEntry(name, to, new Date().toISOString().slice(0, 10))',
		replace: 'void 0'
	},
	{
		name: 'the mutation layer is no longer required of a skill that computes',
		find: 'if (computes && !selfTest) {',
		replace: 'if (false) {'
	},
	{
		name: 'walk follows symlinks again, so a broken one crashes the gate',
		find: 'const st = lstatSync(abs)',
		replace: 'const st = statSync(abs)'
	},
	{
		name: 'exit code always reports success',
		find: 'process.exit(refusals.length ? 1 : 0)',
		replace: 'process.exit(0)'
	},
	{
		name: 'INERT CONTROL — a comment reworded, nothing else',
		find: '// ── main ─────────────────────────────────────────────────────────────────────',
		replace: '// ── main entry point ─────────────────────────────────────────────────────────',
		expect: 'survives'
	}
]

const dir = mkdtempSync(join(tmpdir(), 'promote-self-'))
const sandboxSrc = join(dir, 'promote.mjs')
const sandboxTest = join(dir, 'promote.test.mjs')
cpSync(TEST, sandboxTest)
cpSync(CHECK_CATALOG, join(dir, 'check-catalog.mjs'))
cpSync(LEDGER, join(dir, 'ledger.mjs'))
cpSync(SKILL_AUDIT, join(dir, 'skills', 'skill-audit'), { recursive: true })
const original = readFileSync(SRC, 'utf8')

let asExpected = 0
let unexpected = 0

try {
	for (const m of MUTATIONS) {
		const expectSurvival = m.expect === 'survives'
		const occurrences = original.split(m.find).length - 1
		if (occurrences !== 1) {
			console.error(
				`  ERROR     "${m.name}" — anchor found ${occurrences} times, expected exactly 1.\n` +
					'            The source has drifted; update the mutation before trusting this run.'
			)
			unexpected++
			continue
		}
		writeFileSync(sandboxSrc, original.replace(m.find, m.replace))
		const r = spawnSync('node', [sandboxTest], { encoding: 'utf8' })
		const survived = r.status === 0
		if (survived === expectSurvival) {
			asExpected++
			const failed = (r.stdout.match(/(\d+) failed/) ?? [])[1] ?? '0'
			console.log(`  ${expectSurvival ? 'survived  ' : 'caught    '}${m.name}${expectSurvival ? '' : `  (${failed} assertion(s))`}`)
		} else {
			unexpected++
			console.error(
				expectSurvival
					? `  BROKE     ${m.name} — an inert change failed the suite, so the suite tests something it should not.`
					: `  SURVIVED  ${m.name}`
			)
		}
	}
} finally {
	rmSync(dir, { recursive: true, force: true })
}

if (readFileSync(SRC, 'utf8') !== original) {
	console.error('  ERROR     the shipped script changed during this run — it should never be written.')
	unexpected++
}

const clean = spawnSync('node', [TEST], { encoding: 'utf8' })
console.log(`\nclean run: ${clean.status === 0 ? 'PASS' : 'FAIL'}`)
console.log(`self-test: ${asExpected} as expected, ${unexpected} not`)
if (unexpected || clean.status !== 0) {
	console.error('\nA surviving mutation means the suite is not checking what it appears to.\nAdd the assertion that would have caught it.')
	process.exit(1)
}
