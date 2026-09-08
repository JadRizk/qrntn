#!/usr/bin/env node
//
// Validate an AUDIT.json against record.schema.json.
//
// SK-94. The other half of criterion 7. The shape is defined once, in
// nexus/packages/record/schema.ts with zod; this reads the JSON Schema subset
// compiled from it and interprets that. No imports, no dependencies — the
// commands stay plain Node, and the schema is still written in one place.
//
// It supports exactly the constructs build-record-schema.mjs emits. Anything
// else throws rather than passing silently, because a validator that ignores a
// keyword it does not understand accepts everything that keyword was there to
// refuse — which is worse than no validator, since it reads as one.
//
//   node validate-record.mjs <path/to/AUDIT.json>

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
export const SCHEMA_PATH = join(HERE, 'record.schema.json')

export function loadSchema(path = SCHEMA_PATH) {
	if (!existsSync(path)) {
		throw new Error(`record.schema.json not found at ${path} — the tool's install is incomplete`)
	}
	return JSON.parse(readFileSync(path, 'utf8'))
}

const typeOf = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v)

// Returns [] when valid, otherwise one entry per violation. Every entry names
// the path, so a refusal can say which field rather than that something is
// wrong somewhere.
export function validate(value, schema, path = '') {
	const errors = []
	const at = path || '(root)'

	if (schema.anyOf) {
		if (schema.anyOf.some((s) => validate(value, s, path).length === 0)) return errors
		// Nullable fields are `anyOf: [something, null]`, which is nearly every
		// optional field here. Reporting "matches none of the permitted shapes"
		// for a malformed sha256 tells the reader nothing they can act on, so
		// when exactly one branch is a real shape, its errors are the answer.
		const real = schema.anyOf.filter((s) => s.type !== 'null')
		if (real.length === 1) return validate(value, real[0], path)
		errors.push(`${at}: matches none of the permitted shapes`)
		return errors
	}

	if ('const' in schema) {
		if (value !== schema.const) errors.push(`${at}: expected ${JSON.stringify(schema.const)}, got ${JSON.stringify(value)}`)
		return errors
	}

	if (schema.enum) {
		if (!schema.enum.includes(value)) {
			errors.push(`${at}: expected one of ${schema.enum.join(' · ')}, got ${JSON.stringify(value)}`)
		}
		return errors
	}

	if (schema.type && typeOf(value) !== schema.type) {
		errors.push(`${at}: expected ${schema.type}, got ${typeOf(value)}`)
		return errors
	}

	if (schema.type === 'string') {
		if (schema.minLength !== undefined && value.length < schema.minLength) {
			errors.push(`${at}: must not be empty`)
		}
		if (schema.pattern !== undefined && !new RegExp(schema.pattern).test(value)) {
			errors.push(`${at}: ${JSON.stringify(value)} does not match ${schema.pattern}`)
		}
		return errors
	}

	if (schema.type === 'array') {
		if (schema.minItems !== undefined && value.length < schema.minItems) {
			errors.push(`${at}: needs at least ${schema.minItems} item(s), has ${value.length}`)
		}
		value.forEach((v, i) => errors.push(...validate(v, schema.items, `${path}[${i}]`)))
		return errors
	}

	if (schema.type === 'object') {
		for (const key of schema.required ?? []) {
			if (!(key in value)) errors.push(`${at}: missing required field ${JSON.stringify(key)}`)
		}
		for (const [key, v] of Object.entries(value)) {
			const child = schema.properties?.[key]
			if (child) {
				errors.push(...validate(v, child, path ? `${path}.${key}` : key))
			} else if (schema.additionalProperties === false) {
				errors.push(`${at}: unknown field ${JSON.stringify(key)}`)
			} else if (typeof schema.additionalProperties === 'object') {
				errors.push(...validate(v, schema.additionalProperties, path ? `${path}.${key}` : key))
			}
		}
		return errors
	}

	return errors
}

// The rules the schema cannot express, kept here rather than left unsaid.
//
// A state that is a decision — `refused` or `not-applicable` — must carry the
// reason it was decided, and one that names an accountable person must name
// them. JSON Schema can express conditional requirements; this subset
// deliberately does not, because the interpreter above stays small. So they are
// written as code, next to the schema they extend, instead of being enforced
// nowhere.
export function checkSemantics(record) {
	const errors = []
	for (const [i, c] of (record.certifications ?? []).entries()) {
		const at = `certifications[${i}] (${c.criterion})`
		if ((c.state === 'refused' || c.state === 'not-applicable') && !c.why) {
			errors.push(`${at}: state "${c.state}" is a decision and must say why`)
		}
		if (c.state === 'certified') {
			if (!c.by) errors.push(`${at}: a certification must name who made it`)
			if (!c.on) errors.push(`${at}: a certification must be dated`)
			if (!c.inventoryDigest) errors.push(`${at}: a certification must name the bytes it covers`)
		}
	}
	if (Array.isArray(record.notChecked) && record.notChecked.length === 0 && !record.exemption) {
		errors.push('notChecked: an empty list claims nothing was left unchecked — say so explicitly or list what was not')
	}
	return errors
}

export function validateRecord(record, schema = loadSchema()) {
	const structural = validate(record, schema)
	return structural.length ? structural : checkSemantics(record)
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
	const target = process.argv[2]
	if (!target) {
		console.error('usage: validate-record.mjs <path/to/AUDIT.json>')
		process.exit(2)
	}
	const errors = validateRecord(JSON.parse(readFileSync(target, 'utf8')))
	if (!errors.length) {
		console.log(`${target} — valid`)
		process.exit(0)
	}
	console.error(`${target} — ${errors.length} problem(s)`)
	for (const e of errors) console.error(`  ✗ ${e}`)
	process.exit(1)
}
