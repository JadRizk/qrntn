// zod and the interpreter must agree.
//
// SK-94, criterion 7. The record's shape is written once, in
// packages/record/schema.ts, and consumed twice: nexus validates with zod, the
// zero-dependency commands validate against record.schema.json compiled from
// it. "One schema" is only true if those two accept and reject the same things.
//
// Without this test the claim is decorative: the JSON could drift a keyword, or
// the compiler could drop a constraint, and each side would go on being
// internally consistent while disagreeing about what a valid record is. That is
// exactly the failure mode SK-97 found in prose — two descriptions of one thing,
// nothing checking they still match.

import { describe, expect, it } from 'vitest'

import { AuditRecordSchema } from '@nexus/record'
// @ts-expect-error — plain JS, deliberately untyped: it is what ships to the
// commands, and typing it here would be a third description of the same shape.
import { validateRecord } from '../../../commands/validate-record.mjs'

const DIGEST = `sha256:${'a'.repeat(64)}`

const VALID = {
	schemaVersion: 1,
	skill: 'tidy-notes',
	certifications: [
		{ criterion: 'safe-to-load', state: 'certified', by: 'Jad Rizk', on: '2026-09-07', method: 'read it', inventoryDigest: DIGEST, why: null },
	],
	inventory: { 'SKILL.md': DIGEST },
	findings: [],
	notChecked: ['nothing downstream of the links was followed'],
	exemption: null,
	provenance: { source: null, commit: null, retrieved: null, license: 'MIT', licenseBasis: 'pin' },
}

const clone = <T>(o: T): T => JSON.parse(JSON.stringify(o))

// Each case is a record and the verdict both validators must reach. Semantic
// rules the JSON subset cannot express (a certification must name its author)
// live in checkSemantics, so cases exercising those are marked structural-only.
const CASES: Array<{ name: string; make: () => unknown; valid: boolean; structuralOnly?: boolean }> = [
	{ name: 'the reference record', make: () => clone(VALID), valid: true },
	{ name: 'a missing required field', make: () => { const r = clone(VALID) as any; delete r.skill; return r }, valid: false },
	{ name: 'a wrong scalar type', make: () => ({ ...clone(VALID), skill: 42 }), valid: false },
	{ name: 'an unknown enum member', make: () => { const r = clone(VALID) as any; r.certifications[0].state = 'maybe'; return r }, valid: false },
	{ name: 'a malformed digest', make: () => { const r = clone(VALID) as any; r.inventory['SKILL.md'] = 'nope'; return r }, valid: false },
	{ name: 'a malformed date', make: () => { const r = clone(VALID) as any; r.certifications[0].on = '7 Sept'; return r }, valid: false },
	{ name: 'an empty certifications array', make: () => ({ ...clone(VALID), certifications: [] }), valid: false },
	{ name: 'a wrong literal version', make: () => ({ ...clone(VALID), schemaVersion: 2 }), valid: false },
	{ name: 'an unknown field', make: () => ({ ...clone(VALID), verdict: 'ADOPT' }), valid: false },
	{ name: 'an empty string where content is required', make: () => ({ ...clone(VALID), skill: '' }), valid: false },
	{ name: 'a null in a nullable field', make: () => ({ ...clone(VALID), exemption: null }), valid: true },
	{
		name: 'an exempt record',
		make: () => ({ ...clone(VALID), notChecked: [], exemption: { reason: 'predates the tool', on: '2026-09-07' } }),
		valid: true,
	},
]

describe('the record schema has one definition', () => {
	for (const c of CASES) {
		it(`agrees on ${c.name}`, () => {
			const record = c.make()
			const zodOk = AuditRecordSchema.safeParse(record).success
			const jsOk = (validateRecord as (r: unknown) => string[])(record).length === 0

			expect(zodOk, `zod disagreed about "${c.name}"`).toBe(c.valid)
			if (!c.structuralOnly) {
				expect(jsOk, `the interpreter disagreed about "${c.name}"`).toBe(c.valid)
			}
		})
	}
})
