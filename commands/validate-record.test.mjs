#!/usr/bin/env node
//
// Known-answer tests for the record validator.
//
// Each case is a record that is wrong in exactly one way, so a failure names the
// rule that stopped working rather than "something about records".

import { validateRecord, loadSchema, validate } from './validate-record.mjs'

let pass = 0
const failures = []
const check = (name, cond, detail = '') => {
	if (cond) pass++
	else failures.push(`${name}${detail ? ` — ${detail}` : ''}`)
}

const DIGEST = 'sha256:' + 'a'.repeat(64)

const VALID = {
	schemaVersion: 1,
	skill: 'tidy-notes',
	certifications: [
		{
			criterion: 'safe-to-load',
			state: 'certified',
			by: 'Jad Rizk',
			on: '2026-09-07',
			method: 'human adjudication of 3 findings',
			inventoryDigest: DIGEST,
			why: null,
		},
		{
			criterion: 'safe-to-execute',
			state: 'not-applicable',
			by: null,
			on: null,
			method: null,
			inventoryDigest: null,
			why: 'ships nothing executable',
		},
	],
	inventory: { 'SKILL.md': DIGEST },
	findings: [
		{ code: 'INSTR-HTMLCOMMENT', severity: 'review', at: 'SKILL.md:52:1', excerpt: '…', disposition: 'false-positive', why: 'documents the attack it resembles' },
	],
	notChecked: ['the links it cites were not followed'],
	exemption: null,
	provenance: { source: null, commit: null, retrieved: null, license: 'MIT', licenseBasis: 'pin' },
}

const clone = (o) => JSON.parse(JSON.stringify(o))
const errorsFor = (mutate) => {
	const r = clone(VALID)
	mutate(r)
	return validateRecord(r)
}

check('the reference record is valid', validateRecord(clone(VALID)).length === 0, JSON.stringify(validateRecord(clone(VALID))))

// ── structure ───────────────────────────────────────────────────────────────
check('a missing required field is caught', errorsFor((r) => delete r.notChecked).some((e) => /missing required field "notChecked"/.test(e)))
check('a wrong type is caught', errorsFor((r) => (r.skill = 42)).some((e) => /expected string, got number/.test(e)))
check('an unknown field is caught', errorsFor((r) => (r.verdict = 'ADOPT')).some((e) => /unknown field "verdict"/.test(e)))
check('a bad schemaVersion is caught', errorsFor((r) => (r.schemaVersion = 2)).some((e) => /expected 1/.test(e)))
check('an unknown criterion is caught', errorsFor((r) => (r.certifications[0].criterion = 'vibes')).some((e) => /expected one of/.test(e)))
check('an unknown state is caught', errorsFor((r) => (r.certifications[0].state = 'probably')).some((e) => /expected one of/.test(e)))
check('a malformed digest is caught', errorsFor((r) => (r.certifications[0].inventoryDigest = 'sha256:short')).some((e) => /does not match/.test(e)))
check('a malformed date is caught', errorsFor((r) => (r.certifications[0].on = '7 Sept')).some((e) => /does not match/.test(e)))
check('an empty certifications list is caught', errorsFor((r) => (r.certifications = [])).some((e) => /at least 1/.test(e)))
check('a nullable field accepts null', validateRecord({ ...clone(VALID), exemption: null }).length === 0)
check('an inventory digest is pattern-checked', errorsFor((r) => (r.inventory['SKILL.md'] = 'nope')).some((e) => /does not match/.test(e)))

// ── the rules the schema cannot express ─────────────────────────────────────
//
// These are the ones that carry the ticket's argument, so they are tested
// hardest: a state that is a decision has to say why, and a certification has to
// name who, when, and against which bytes.
check(
	'a certification with no author is refused',
	errorsFor((r) => (r.certifications[0].by = null)).some((e) => /must name who made it/.test(e))
)
check(
	'a certification with no date is refused',
	errorsFor((r) => (r.certifications[0].on = null)).some((e) => /must be dated/.test(e))
)
check(
	'a certification that names no bytes is refused',
	errorsFor((r) => (r.certifications[0].inventoryDigest = null)).some((e) => /must name the bytes/.test(e))
)
check(
	'not-applicable without a reason is refused',
	errorsFor((r) => (r.certifications[1].why = null)).some((e) => /must say why/.test(e))
)
check(
	'refused without a reason is refused',
	errorsFor((r) => {
		r.certifications[1].state = 'refused'
		r.certifications[1].why = null
	}).some((e) => /must say why/.test(e))
)
check(
	'an empty notChecked is refused — it claims everything was checked',
	errorsFor((r) => (r.notChecked = [])).some((e) => /claims nothing was left unchecked/.test(e))
)
check(
	'an exempt record may leave notChecked empty, because it claims nothing',
	validateRecord({ ...clone(VALID), notChecked: [], exemption: { reason: 'adopted before this tool; never audited', on: '2026-09-07' } }).length === 0
)

// ── the interpreter itself ──────────────────────────────────────────────────
check('an unsupported keyword cannot pass silently', (() => {
	// A validator that ignores what it does not understand accepts everything
	// the keyword existed to refuse. The subset is closed: anything the emitter
	// produces, the interpreter handles.
	const schema = loadSchema()
	const keywords = new Set()
	// Only keys that are schema KEYWORDS, not the field names under
	// `properties` — the first version of this walk collected both and reported
	// every field in the record as an unimplemented keyword.
	const walk = (s) => {
		if (!s || typeof s !== 'object') return
		for (const [k, v] of Object.entries(s)) {
			if (k === 'properties') {
				Object.values(v).forEach(walk)
				continue
			}
			keywords.add(k)
			if (Array.isArray(v)) v.forEach(walk)
			else if (v && typeof v === 'object') walk(v)
		}
	}
	walk(schema)
	const known = new Set(['$comment', '$schema', 'title', 'type', 'properties', 'required', 'additionalProperties', 'const', 'enum', 'items', 'minItems', 'minLength', 'pattern', 'anyOf'])
	const unknown = [...keywords].filter((k) => !known.has(k))
	return unknown.length === 0
})(), 'the emitter produced a keyword the interpreter does not implement')

check('validate() reports the path of a nested violation', validate({ ...clone(VALID), findings: [{ ...VALID.findings[0], severity: 'catastrophic' }] }, loadSchema()).some((e) => /^findings\[0\]\.severity/.test(e)))

console.log(`\n${pass} passed, ${failures.length} failed`)
for (const f of failures) console.log(`  FAIL  ${f}`)
process.exit(failures.length ? 1 : 0)
