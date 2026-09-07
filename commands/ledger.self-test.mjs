#!/usr/bin/env node
// Self-test: does ledger.test.mjs actually catch anything?
//
// Same reasoning as promote.mjs's and usage.mjs's self-test.mjs: this mutates
// ledger.mjs in specific ways, runs the suite against each mutant, and asserts
// the suite FAILS every time. A surviving mutation names a check nobody is
// really making — and this script's whole job is checking that a hand-edited
// ledger file cannot reach main, so a mutation that silently stops it
// checking is the one failure mode that matters most here.
//
//   node scripts/ledger.self-test.mjs

import { spawnSync } from 'node:child_process'
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const SRC = join(HERE, 'ledger.mjs')
const TEST = join(HERE, 'ledger.test.mjs')

const MUTATIONS = [
	{
		name: 'a hand-edited field no longer fails the comparison',
		find: 'if (stableStringify(onDiskValue) !== stableStringify(freshValue)) {',
		replace: 'if (false) {'
	},
	{
		name: 'a held skill missing its ledger entry is no longer refused',
		find: 'errors.push(`${name}: no ledger/${name}.json for a held skill`)',
		replace: 'void 0'
	},
	{
		name: 'an orphaned ledger entry for a skill no longer held goes unflagged',
		find: 'if (!held.has(name)) errors.push(`ledger/${f}: no held skill named "${name}" — orphaned ledger entry`)',
		replace: 'void 0'
	},
	{
		name: 'usage.json is no longer exempt, so every real repo fails --check on it forever',
		find: "if (!f.endsWith('.json') || f === 'usage.json') continue",
		replace: "if (!f.endsWith('.json')) continue"
	},
	{
		name: 'origin.date is regenerated and compared, so a real recorded date reads as corruption',
		find: 'freshValue.date = onDiskValue.date',
		replace: 'freshValue.date = null'
	},
	{
		name: 'integrity.lastVerified is regenerated and compared, so every check fails on its own timestamp',
		find: 'if (section === \'integrity\') freshValue.lastVerified = onDiskValue.lastVerified',
		replace: 'if (false) freshValue.lastVerified = onDiskValue.lastVerified'
	},
	{
		name: 'a skill with AUDIT.md is no longer classified acquired',
		find: 'if (!hasAudit) {',
		replace: 'if (true) {'
	},
	{
		name: 'the house bolded-verdict format narrows back to a bare cell',
		find: '/\\|\\s*\\*\\*Verdict\\*\\*\\s*\\|[\\s*]*(ADOPT|REVISE|REJECT)\\b/i',
		replace: '/\\|\\s*(ADOPT|REVISE|REJECT)\\b/i'
	},
	{
		name: 'any disposition text counts as decided, including none',
		find: "const DISPOSITIONS = /^(real|accepted|false positive|fixed|removed|n\\/a)\\b/i",
		replace: 'const DISPOSITIONS = /(?:)/'
	},
	{
		name: 'modelInvocable reads true even when disable-model-invocation is set',
		find: "modelInvocable: String(fm['disable-model-invocation']).toLowerCase() !== 'true',",
		replace: 'modelInvocable: true,'
	},
	{
		name: 'gated reads true even when a stage has no gate',
		find: 'gated: stages.length === 0 ? null : stages.every((s) => s.gate.length > 0),',
		replace: 'gated: stages.length === 0 ? null : true,'
	},
	{
		name: 'a symlink is hashed instead of skipped, and a broken one crashes integrity',
		find: 'if (st.isSymbolicLink()) continue',
		replace: 'if (false) continue'
	},
	{
		name: 'writeLedgerSections stops merging and overwrites the whole entry',
		find: 'const next = { ...current, ...sections }',
		replace: 'const next = { ...sections }'
	},
	{
		name: 'a second backfill run rewrites an entry that already exists',
		find: 'if (!force && readLedger(name)) {',
		replace: 'if (false) {'
	},
	{
		name: 'exit code always reports success',
		find: 'return errors.length ? 1 : 0',
		replace: 'return 0'
	},
	{
		name: 'INERT CONTROL — a comment reworded, nothing else',
		find: '// ------------------------------------------------------------------------ check',
		replace: '// ------------------------------------------------------------------------ the check pass',
		expect: 'survives'
	}
]

const dir = mkdtempSync(join(tmpdir(), 'ledger-self-'))
const sandboxSrc = join(dir, 'ledger.mjs')
const sandboxTest = join(dir, 'ledger.test.mjs')
cpSync(TEST, sandboxTest)
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
		const r = spawnSync(process.execPath, [sandboxTest], { encoding: 'utf8' })
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

const clean = spawnSync(process.execPath, [TEST], { encoding: 'utf8' })
console.log(`\nclean run: ${clean.status === 0 ? 'PASS' : 'FAIL'}`)
console.log(`self-test: ${asExpected} as expected, ${unexpected} not`)
if (unexpected || clean.status !== 0) {
	console.error('\nA surviving mutation means the suite is not checking what it appears to.\nAdd the assertion that would have caught it.')
	process.exit(1)
}
