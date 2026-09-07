// The audit record — the shape of AUDIT.json.
//
// SK-94. This is the source of truth, and the only place the shape is written.
// nexus imports these types directly; the zero-dependency commands validate
// against `record.schema.json`, which build.mjs emits from exactly this file.
// Neither runtime gains a dependency: nexus already has zod, and the commands
// get JSON plus a small interpreter that has no imports at all.
//
// Every exported type is `z.infer`, never a hand-written interface — the same
// rule nexus/src/data/types.ts already follows, for the same reason: an
// interface beside a schema is a second definition that drifts.

import { z } from 'zod'

// ─────────────────────────────────────────────────────────────── criteria ──

// Named criteria replace the single verdict. A verdict is a word one person
// means something by; a set of certified criteria is something a second person
// can accept or reject one at a time, which is the whole reason cargo-vet's
// audits can be imported and a paragraph cannot.
//
// `house-style` is third and separable on purpose. It is the criterion that is
// taste, and nobody importing an audit should have to accept somebody else's.
export const CriterionSchema = z.enum(['safe-to-load', 'safe-to-execute', 'house-style'])
export type Criterion = z.infer<typeof CriterionSchema>

// Four states, and the two that are not "yes" are not the same.
//
// `not-applicable` is a judgement someone made — a skill that ships nothing
// executable cannot be unsafe to execute — and it is not the same as
// `not-assessed`, which is an admission that nobody looked. Collapsing them is
// how an un-audited library comes to look audited, and it is the same
// distinction `licenseBasis` had to draw in SK-91 between a licence read at the
// pin and one inferred from a window.
export const CertificationStateSchema = z.enum(['certified', 'refused', 'not-applicable', 'not-assessed'])
export type CertificationState = z.infer<typeof CertificationStateSchema>

export const CertificationSchema = z.object({
	criterion: CriterionSchema,
	state: CertificationStateSchema,
	// Who is answerable. Absent only when nobody is — `not-assessed`.
	by: z.string().min(1).nullable(),
	on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
	// How it was reached, in a sentence. "migrated from AUDIT.md prose" is a
	// legitimate value and a reader must be able to tell it from a real one.
	method: z.string().min(1).nullable(),
	// The bytes this certification is about. A certification that does not name
	// what it certifies is a sentiment.
	inventoryDigest: z.string().regex(/^sha256:[0-9a-f]{64}$/).nullable(),
	// Required when the state is `not-applicable` or `refused`: both are
	// decisions, and a decision without a reason cannot be checked by anyone.
	why: z.string().min(1).nullable(),
}).strict()
export type Certification = z.infer<typeof CertificationSchema>

// ─────────────────────────────────────────────────────────────── findings ──

export const SeveritySchema = z.enum(['block', 'review', 'note'])
export const DispositionSchema = z.enum(['real', 'accepted', 'false-positive', 'fixed', 'removed', 'not-applicable'])

export const FindingSchema = z.object({
	code: z.string().min(1),
	severity: SeveritySchema,
	at: z.string().min(1),
	excerpt: z.string(),
	disposition: DispositionSchema,
	why: z.string().min(1),
}).strict()
export type Finding = z.infer<typeof FindingSchema>

// ────────────────────────────────────────────────────────────── the record ──

export const ProvenanceSchema = z.object({
	source: z.string().nullable(),
	commit: z.string().nullable(),
	retrieved: z.string().nullable(),
	license: z.string().nullable(),
	licenseBasis: z.string().nullable(),
}).strict()

// Every object here is `.strict()`. zod's default is to STRIP unknown keys and
// succeed, which the compiled JSON Schema does not do — it emits
// `additionalProperties: false` — and the agreement test caught the two sides
// disagreeing on exactly that. Strict is the right side of the disagreement: a
// record carrying a field this tool does not understand may be making a claim
// its reader believes is enforced, and silently dropping it is how that happens.
export const AuditRecordSchema = z.object({
	schemaVersion: z.literal(1),
	skill: z.string().min(1),
	certifications: z.array(CertificationSchema).min(1),
	// Path → digest, for every file the certification covers.
	inventory: z.record(z.string(), z.string().regex(/^sha256:[0-9a-f]{64}$/)),
	findings: z.array(FindingSchema),

	// The field that makes an imported audit worth anything.
	//
	// Required, and empty only explicitly: `[]` is a claim that nothing was left
	// unchecked, and a migrated record must not make it. "The original audit did
	// not say what it left unchecked" is itself an entry — the honest one.
	notChecked: z.array(z.string().min(1)),

	// Present when the skill predates the tool. `pratiq init` writes one for
	// every skill already held, so a library with fifty un-audited skills can
	// adopt the tool without a cliff — and so that an un-audited skill is a
	// recorded fact rather than a silence.
	exemption: z
		.object({
			reason: z.string().min(1),
			on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
		})
		.strict()
		.nullable(),

	provenance: ProvenanceSchema,
}).strict()
export type AuditRecord = z.infer<typeof AuditRecordSchema>
