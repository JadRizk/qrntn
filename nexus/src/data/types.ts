// GraphSnapshot schema — the shape of public/data/graph.json.
//
// zod schemas are the source of truth (§2): every exported type below is
// `z.infer<typeof Schema>`, never a hand-written interface that could drift
// from what loadGraph.ts actually validates at the fetch boundary.
//
// Node/edge kind are zod discriminated unions so an unhandled kind is a
// compile error at every switch, not a silent runtime no-op (§3).

import { z } from 'zod'

// The record's own enums, not restated: a finding in the graph is a finding
// from AUDIT.json, and two lists of the same six dispositions would drift.
import { DispositionSchema, SeveritySchema } from '../../packages/record/schema.ts'

// ---------------------------------------------------------------- usage

// The 3-state usage tick (§6): `null` is the real, distinct "not yet
// measured" state, never conflated with a `UsageStats` whose counts are
// zero (measured, and zero).
export const UsageStatsSchema = z.object({
  invocations: z.object({
    d7: z.number().int().nonnegative(),
    d30: z.number().int().nonnegative(),
    d90: z.number().int().nonnegative(),
    all: z.number().int().nonnegative(),
  }),
  lastInvoked: z.string().nullable(),
})
export type UsageStats = z.infer<typeof UsageStatsSchema>

// --------------------------------------------------------------- leaves

// Reference/asset files size a skill's halo (§6, CONTEXT.md). `agent` is a
// third leafKind alongside the atlas's ref/asset split: a skill's agents/
// export is neither reference prose nor a bundled asset, and folding it
// silently into one of those two is the exact bug the atlas's own history
// fixed once already (an agents/ export "counted by nothing"). Kept as its
// own leafKind here so nothing Nexus renders can repeat that silence.
export const LeafKindSchema = z.enum(['ref', 'asset', 'agent'])
export type LeafKind = z.infer<typeof LeafKindSchema>

const LeafNodeSchema = z.object({
  kind: z.literal('leaf'),
  id: z.string(),
  owner: z.string(),
  file: z.string(),
  leafKind: LeafKindSchema,
  words: z.number().int().nonnegative(),
})

const ScriptFoldNodeSchema = z.object({
  kind: z.literal('scriptFold'),
  id: z.string(),
  owner: z.string(),
  scripts: z.array(z.string()),
})

// -------------------------------------------------------------- category

const CategoryNodeSchema = z.object({
  kind: z.literal('category'),
  id: z.string(),
  title: z.string(),
  blurb: z.string(),
})

// -------------------------------------------------------------- origin

// The one synthetic root every category hangs off — see
// export-graph.mjs's originNode. Not sourced from any file the way every
// other node kind is; it exists purely so the graph reads as one connected
// whole instead of seven separate category trees with nothing tying them
// together.
const OriginNodeSchema = z.object({
  kind: z.literal('origin'),
  id: z.string(),
  title: z.string(),
})

// ----------------------------------------------------------------- skill

export const OriginKindSchema = z.enum(['authored', 'acquired'])
export type OriginKind = z.infer<typeof OriginKindSchema>

// The records, on the node (READING-ROOM.html, phase 1). A skill is a folder
// of text that becomes instructions, and the library holds — per skill — a
// sha256 for every file (ledger integrity.files) and the audit's verdict.
// Until now the graph carried none of it, so the drawer could name a skill
// and its degree and nothing about whether its bytes are still the bytes a
// human decided on. This is that, without any artefact text: the reader that
// shows the bytes themselves is phase 2, and a bigger threat surface.

// Three states, and the two that are not "matches" are not the same. `drift`
// is a file the ledger names whose bytes have changed since the ledger was
// written; `unlisted` is a file the ledger never named — added after
// promotion, or never hashed. Collapsing them would make a new file look
// like a tampered one, or the reverse.
export const HashVerdictSchema = z.enum(['matches', 'drift', 'unlisted'])
export type HashVerdict = z.infer<typeof HashVerdictSchema>

// Where a file sits in the skill: the spine, the two provenance files the
// exporter names and does not draw (AUDIT.md, ORIGIN.md), the three leaf
// kinds, scripts, and `other` — a LICENSE, a dotfile, AUDIT.json — which
// the ledger hashes and so must be listed. Provenance is not depth — AUDIT.md
// and ORIGIN.md are readable from the skill and never become nodes
// (READING-ROOM.html, decided 4).
export const FileRoleSchema = z.enum(['spine', 'audit', 'origin', 'ref', 'asset', 'agent', 'script', 'other'])
export type FileRole = z.infer<typeof FileRoleSchema>

// A link found in a file, as offsets the viewer colours and never re-derives.
// `node` points at a node id; `file` at a path in the same skill that is
// readable but not drawn (AUDIT.md, ORIGIN.md, a nested reference —
// READING-ROOM.html, decided 3 and 4); `anchor` at a heading slug in this
// file; `external` carries only the host, because nothing navigates off the
// page; `unresolved` is a link to nothing this export knows, and stays text.
export const LinkKindSchema = z.enum(['node', 'file', 'anchor', 'external', 'unresolved'])
export type LinkKind = z.infer<typeof LinkKindSchema>

export const FileLinkSchema = z.object({
  line: z.number().int().positive(), // 1-based, like a finding's `at`
  col: z.number().int().nonnegative(), // 0-based UTF-16 offset into the line
  len: z.number().int().positive(),
  raw: z.string(), // the target as written
  kind: LinkKindSchema,
  to: z.string().nullable(),
})
export type FileLink = z.infer<typeof FileLinkSchema>

export const AnchorSchema = z.object({ slug: z.string(), line: z.number().int().positive() })

const fileBase = {
  path: z.string(), // relative to the skill's directory, posix separators — the ledger's own key
  role: FileRoleSchema,
  bytes: z.number().int().nonnegative(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  verified: HashVerdictSchema,
}

// The bytes a decision was recorded against. `content` is the file decoded
// as UTF-8 and nothing else — no normalisation, no CRLF folding, no BOM
// stripped; a file that does not decode is `binary` and the reader never
// guesses an encoding. Never truncated: a hundred thousand newlines is a
// fact about the file, and the header states the count.
const TextFileSchema = z.object({
  kind: z.literal('text'),
  ...fileBase,
  content: z.string(),
  links: z.array(FileLinkSchema),
  anchors: z.array(AnchorSchema),
})
const BinaryFileSchema = z.object({
  kind: z.literal('binary'),
  ...fileBase,
})
export const SkillFileSchema = z.discriminatedUnion('kind', [TextFileSchema, BinaryFileSchema])
export type SkillFile = z.infer<typeof SkillFileSchema>
export type TextFile = z.infer<typeof TextFileSchema>

// A finding from AUDIT.json, pinned to the line its `at` names. The record's
// own fields, unchanged, plus where the exporter found that line to be —
// `line: null` when the file no longer has it, `excerptMatches: false` when
// the line is there but no longer says what the record quoted. The reader
// shows the pin where it lands and says when it did not.
export const PinnedFindingSchema = z.object({
  code: z.string(),
  severity: SeveritySchema,
  at: z.string(),
  file: z.string(),
  line: z.number().int().positive().nullable(),
  col: z.number().int().nonnegative().nullable(),
  excerpt: z.string(),
  excerptMatches: z.boolean(),
  disposition: DispositionSchema,
  why: z.string(),
})
export type PinnedFinding = z.infer<typeof PinnedFindingSchema>

// What ledger/<name>.json says, carried as it says it. Every field nullable
// because the ledger writer leaves each null when nothing establishes it
// (commands/ledger.mjs's shape comment), and a viewer that defaulted a null
// commit to "" would be asserting a pin nobody recorded.
export const SkillRecordSchema = z.object({
  source: z.string().nullable(), // origin.source — URL, null for authored
  commit: z.string().nullable(), // origin.commit — the resolved commit, or never recorded
  date: z.string().nullable(), // origin.date — arrival or promotion, ISO
  verdict: z.string().nullable(), // audit.verdict
  findings: z.number().int().nonnegative().nullable(), // audit.counts.findings
  dispositioned: z.boolean().nullable(), // audit.dispositioned
  reportPath: z.string().nullable(), // audit.reportPath
  // Paths the ledger hashes that are no longer on disk. The fourth state a
  // per-file verdict cannot carry, because there is no file to carry it.
  missing: z.array(z.string()),
})
export type SkillRecord = z.infer<typeof SkillRecordSchema>

const SkillNodeSchema = z.object({
  kind: z.literal('skill'),
  id: z.string(),
  name: z.string(),
  description: z.string(),
  category: z.string(), // a real category id, or 'unfiled' (CONTEXT.md)
  origin: OriginKindSchema,
  manualOnly: z.boolean(),
  words: z.number().int().nonnegative(), // spine
  refWords: z.number().int().nonnegative(), // halo, additive to spine
  usage: UsageStatsSchema.nullable(),
  files: z.array(SkillFileSchema), // every file on disk — the ledger's own walk — spine first, provenance next, then by path
  record: SkillRecordSchema,
  findings: z.array(PinnedFindingSchema), // from AUDIT.json when the skill has one; else empty
})

// ---------------------------------------------------------------- vendor

const VendorNodeSchema = z.object({
  kind: z.literal('vendor'),
  id: z.string(), // repo slug, e.g. "emilkowalski/skills"
  repo: z.string(),
  url: z.string(),
  adopted: z.array(z.string()), // skill ids
})

// ------------------------------------------------------ declined/refused

const DeclinedNodeSchema = z.object({
  kind: z.literal('declined'),
  id: z.string(),
  name: z.string(),
  vendorId: z.string().nullable(), // null when the source didn't resolve to a known vendor
  date: z.string().nullable(),
  scan: z.string().nullable(),
  why: z.string().nullable(),
})

const RefusedNodeSchema = z.object({
  kind: z.literal('refused'),
  id: z.string(),
  name: z.string(),
  vendorId: z.string().nullable(),
  date: z.string().nullable(),
  blockingFinding: z.string().nullable(),
})

// ----------------------------------------------------------------- ghost

// Only for a name with no skill dir and no REJECTED.md row (§5's
// resolution order) — a genuine unresolved gap.
const GhostNodeSchema = z.object({
  kind: z.literal('ghost'),
  id: z.string(),
  name: z.string(),
  referencedBy: z.array(z.string()), // skill ids whose edges/prose named this ghost
})

// ------------------------------------------------------------------ node

export const GraphNodeSchema = z.discriminatedUnion('kind', [
  OriginNodeSchema,
  CategoryNodeSchema,
  SkillNodeSchema,
  LeafNodeSchema,
  ScriptFoldNodeSchema,
  VendorNodeSchema,
  DeclinedNodeSchema,
  RefusedNodeSchema,
  GhostNodeSchema,
])
export type GraphNode = z.infer<typeof GraphNodeSchema>
export type OriginNode = z.infer<typeof OriginNodeSchema>
export type CategoryNode = z.infer<typeof CategoryNodeSchema>
export type SkillNode = z.infer<typeof SkillNodeSchema>
export type LeafNode = z.infer<typeof LeafNodeSchema>
export type ScriptFoldNode = z.infer<typeof ScriptFoldNodeSchema>
export type VendorNode = z.infer<typeof VendorNodeSchema>
export type DeclinedNode = z.infer<typeof DeclinedNodeSchema>
export type RefusedNode = z.infer<typeof RefusedNodeSchema>
export type GhostNode = z.infer<typeof GhostNodeSchema>

// ------------------------------------------------------------------ edge

// §6's taxonomy, verbatim as the discriminant's literal values so the data
// file reads the same vocabulary the spec does.
export const EdgeKindSchema = z.enum([
  'operative',
  'referential',
  'alternative',
  'contains',
  'adopted',
  'considered',
  'category-clusters-skill',
  'origin-clusters-category',
])
export type EdgeKind = z.infer<typeof EdgeKindSchema>

export const EdgeRecordSchema = z.object({
  kind: EdgeKindSchema,
  from: z.string(),
  to: z.string(),
  // Was false for category-clusters-skill (a physics-only clustering spring,
  // once invisible on purpose) until that edge became a real visible line —
  // the category tree the graph now shows by default, rather than only
  // implying it through node proximity. Every edge kind sets this true now,
  // making the field itself vestigial (a11y/domOverlay.ts's buildAdjacency
  // still reads it, so it stays rather than becoming a silent assumption).
  render: z.boolean(),
  when: z.string().nullable(),
  note: z.string().nullable(),
  source: z.string().nullable(),
})
export type EdgeRecord = z.infer<typeof EdgeRecordSchema>

// -------------------------------------------------------------- snapshot

// No build timestamp: the atlas's own history found `built ${builtAt}`
// falsifies its own "byte-identical for identical input" determinism claim
// (TRIAGE.md's log, finding 5). graph.json carries none, on purpose.
export const GraphSnapshotSchema = z.object({
  nodes: z.array(GraphNodeSchema),
  edges: z.array(EdgeRecordSchema),
})
export type GraphSnapshot = z.infer<typeof GraphSnapshotSchema>
