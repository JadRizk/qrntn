// GraphSnapshot schema — the shape of public/data/graph.json.
//
// zod schemas are the source of truth (§2): every exported type below is
// `z.infer<typeof Schema>`, never a hand-written interface that could drift
// from what loadGraph.ts actually validates at the fetch boundary.
//
// Node/edge kind are zod discriminated unions so an unhandled kind is a
// compile error at every switch, not a silent runtime no-op (§3).

import { z } from 'zod'

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
