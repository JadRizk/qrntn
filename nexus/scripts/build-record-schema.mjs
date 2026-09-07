// Emit commands/record.schema.json from the zod schema.
//
// SK-94, criterion 7: the shape is written once, in TypeScript with zod, and
// nexus imports it directly. This compiles that same schema into a JSON Schema
// subset the zero-dependency commands validate against, so neither runtime
// gains a dependency — nexus already has zod, and the commands get JSON plus a
// small interpreter with no imports at all.
//
// Hand-rolled rather than pulling in zod-to-json-schema: that would add a
// dependency to produce an artefact whose whole purpose is avoiding one, and it
// emits far more of the specification than the interpreter on the other side
// supports. Every construct below is one this schema actually uses; anything
// else throws rather than emitting something the interpreter would silently
// mis-read.
//
//   npx tsx scripts/build-record-schema.mjs [--check]

import { writeFileSync, readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { AuditRecordSchema } from '../packages/record/schema.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const OUT = join(HERE, '..', '..', 'commands', 'record.schema.json')

function convert(schema) {
	const def = schema._def
	switch (def.typeName) {
		case 'ZodObject': {
			const shape = def.shape()
			const properties = {}
			const required = []
			for (const [key, value] of Object.entries(shape)) {
				properties[key] = convert(value)
				required.push(key)
			}
			return { type: 'object', properties, required, additionalProperties: false }
		}
		case 'ZodString': {
			const out = { type: 'string' }
			for (const c of def.checks ?? []) {
				if (c.kind === 'min') out.minLength = c.value
				if (c.kind === 'regex') out.pattern = c.regex.source
			}
			return out
		}
		case 'ZodLiteral':
			return { const: def.value }
		case 'ZodEnum':
			return { enum: [...def.values] }
		case 'ZodArray': {
			const out = { type: 'array', items: convert(def.type) }
			if (def.minLength) out.minItems = def.minLength.value
			return out
		}
		case 'ZodRecord':
			return { type: 'object', additionalProperties: convert(def.valueType) }
		case 'ZodNullable':
			return { anyOf: [convert(def.innerType), { type: 'null' }] }
		default:
			throw new Error(`unsupported zod construct: ${def.typeName} — teach the interpreter first`)
	}
}

const schema = {
	$comment:
		'GENERATED from nexus/packages/record/schema.ts. Do not edit. ' +
		'Run `npx tsx nexus/scripts/build-record-schema.mjs` and commit the result.',
	$schema: 'https://json-schema.org/draft/2020-12/schema',
	title: 'pratiq audit record',
	...convert(AuditRecordSchema),
}

const text = JSON.stringify(schema, null, '\t') + '\n'

if (process.argv.includes('--check')) {
	const current = existsSync(OUT) ? readFileSync(OUT, 'utf8') : ''
	if (current === text) {
		console.log('record.schema.json matches what regenerating it would produce')
		process.exit(0)
	}
	console.error('record.schema.json is stale — run: npx tsx nexus/scripts/build-record-schema.mjs')
	process.exit(1)
}

writeFileSync(OUT, text)
console.log(`wrote commands/record.schema.json — ${Object.keys(schema.properties).length} top-level field(s)`)
