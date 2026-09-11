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

import { cpSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'


import { mutate } from './mutate.mjs'

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

await mutate({
	name: 'ledger',
	test: TEST,
	sources: { 'ledger.mjs': SRC },
	build: (dir, files) => {
		cpSync(TEST, join(dir, 'ledger.test.mjs'))
		writeFileSync(join(dir, 'ledger.mjs'), files['ledger.mjs'])
		return join(dir, 'ledger.test.mjs')
	},
	mutations: MUTATIONS
})
