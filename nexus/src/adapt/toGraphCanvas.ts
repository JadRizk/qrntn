// adapt/toGraphCanvas.ts — bridges Nexus's own domain graph (data/types.ts,
// data/taxonomy.ts) to @nexus/graph's GraphCanvas (packages/graph), the
// vendored engine.
//
// packages/graph's category system assumes a FIXED size per categoryId
// (its own `NodeCategory.size` is a constant, only scaled by a node's
// degree inside GraphCanvas itself) — but Nexus's own taxonomy gives
// several kinds a *dynamic*, per-node size formula (a skill's sqrt(words),
// a vendor's sqrt(adopted.length+1), a fold's sqrt(scriptCount)). Nothing
// in the vendored engine requires categoryId cardinality to match colour
// cardinality, though — a categoryId is just a lookup key — so nodes whose
// *size* is genuinely per-instance still mint their own one-node categoryId
// (`skill:animate`, `vendor:emilkowalski/skills`, ...), even though their
// *colour* (NODE_KIND_COLOR, taxonomy.ts) is the same for every node of
// that kind. Two different things happen to share the lookup key mechanism
// packages/graph exposes; they don't have to share cardinality with each
// other. categoryIdsByKind (below) is what lets a caller build an
// "enable/disable this type" legend against that same key, in one place.
//
// Authored-vs-acquired (solid vs. outline spine, §6) has no shape-level
// "outline fill" axis in the engine's 6-shape vocabulary today — a real gap
// noted for whenever the vendored shader itself gets adapted. For now,
// acquired skills render at a dimmed version of the skill kind's colour
// instead of a true outline; a visibly real, honest simplification, not a
// silent one.

import type { GraphNode as DomainNode, GraphSnapshot } from '../data/types.ts'
import {
  ARC_BOW,
  EDGE_REGISTER,
  EDGE_TAXONOMY,
  SEGMENT_PERIOD_PX,
  NODE_KIND_COLOR,
  NODE_TAXONOMY,
  assertNever,
  categorySectorAngle,
  fillForSkill,
  provenanceSectorAngle,
  radiusOf,
  radiusTargetOf,
  sectorAngleJitter,
  type EdgeColorRole,
  type NodeKind,
} from '../data/taxonomy.ts'
import type { GraphCanvasProps, GraphEdge, GraphNode, LinkCategory, NodeCategory } from '../../packages/graph/src/types.ts'

// -------------------------------------------------------------- palette

// These four hexes were picked independently of @nexus/tokens (packages/
// tokens/src/tokens.css) — close to its palette by eye, but never actually
// it, which is exactly why the links read as off-theme once they were
// finally visible (GraphCanvas.tsx's `side: THREE.DoubleSide` fix). GPU
// colour has to be a real hex (Three.js `Color` parsing, this module's own
// header), never a CSS custom property — but nothing stops it being the
// *same* hex the token resolves to. Each role now maps to the literal
// value behind the semantic name a component elsewhere in this app would
// reach for in the same situation: an energetic state reads the sodium
// primitive, an informational one `--nx-fg-info`, and NexusProvider
// (src/main.tsx) sets `theme="pratiq-hud"`, so the three ramp greys below
// are THAT variant's resolved values specifically — not "pratiq"'s AA ones,
// which are several steps lighter and would turn the etched substrate into
// visible lines.
//
// `hot` used to be documented as `--nx-fg-warning`. Under pratiq it is not:
// the warning role moved to rust (#BF6408) to fix a severity inversion, and
// sodium stayed behind as a graph CONTENT hue. The hex is unchanged and the
// name it is reached by is not — an edge is content, never status.
const EDGE_HEX: Record<EdgeColorRole, string> = {
  hot: '#FF8A1E', // --nx-sodium, a content hue under pratiq — mid-run invocation reads as "active", not "critical" (--nx-alarm is reserved for refused/ghost)
  cool: '#17E2E5', // --nx-data, i.e. --nx-fg-info — "points a human onward"
  alt: '#9D7BFF', // --nx-violet — no dedicated fg-* alias, but the same primary-palette primitive every accent here is drawn from
  affirmed: '#87806C', // --nx-grey-600 ('pratiq-hud'), i.e. --nx-fg-muted — a verdict that landed: the lighter of the two greys, so `adopted` and `considered` stop being the same colour
  neutral: '#736D5C', // --nx-grey-500 ('pratiq-hud'), i.e. --nx-fg-subtle — a verdict that didn't, reading exactly as dim as the UI's own de-emphasized text
  etch: '#4C483D', // --nx-grey-300 ('pratiq-hud'), i.e. --nx-fg-disabled — the etched substrate, which you read as shape rather than as lines
}

function dim(hex: string, factor: number): string {
  const n = parseInt(hex.slice(1), 16)
  const r = Math.round(((n >> 16) & 0xff) * factor)
  const g = Math.round(((n >> 8) & 0xff) * factor)
  const b = Math.round((n & 0xff) * factor)
  return `#${[r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('')}`
}

// ------------------------------------------------------------- labels

export function labelOf(node: DomainNode): string {
  switch (node.kind) {
    case 'origin':
      return node.title
    case 'category':
      return node.title
    case 'skill':
      return node.name
    case 'leaf':
      return node.file
    case 'scriptFold':
      return `${node.owner}/scripts`
    case 'vendor':
      return node.repo
    case 'declined':
      return node.name
    case 'refused':
      return node.name
    case 'ghost':
      return node.name
    default:
      return assertNever(node)
  }
}

export const CODE: Record<DomainNode['kind'], string> = {
  origin: 'ORG',
  category: 'CAT',
  skill: 'SKL',
  leaf: 'LEA',
  scriptFold: 'FLD',
  vendor: 'VEN',
  declined: 'DEC',
  refused: 'REF',
  ghost: 'GHO',
}

// ---------------------------------------------------------- categoryId

/** Nodes with a fixed §6 size and one shared sector-arm target (declined, refused, ghost — all three share the provenance arm regardless of which node it is) share one engine categoryId per kind; nodes sized by a §6 formula, or whose sector angle genuinely differs per instance, mint one categoryId per node — see this module's header. `category` is fixed-size too but kept per-instance regardless, for the same reason a legend still lists each category's own name in the drawer later. `leaf` used to share one id like declined/refused/ghost (it's fixed-size too), but each leaf's *owning skill* puts it on a different arm — sharing an id would mean every leaf on screen inherits whichever leaf's angle happened to be computed last, so it mints per-node now, same as scriptFold already did for the same reason. */
function engineCategoryId(node: DomainNode): string {
  switch (node.kind) {
    case 'origin':
      return 'origin' // exactly one instance ever — bare kind name, same as declined/refused/ghost below
    case 'category':
      return `category:${node.id}`
    case 'skill':
      return `skill:${node.id}`
    case 'vendor':
      return `vendor:${node.id}`
    case 'scriptFold':
      return `scriptFold:${node.id}`
    case 'leaf':
      return `leaf:${node.id}`
    case 'declined':
      return 'declined'
    case 'refused':
      return 'refused'
    case 'ghost':
      return 'ghost'
    default:
      return assertNever(node)
  }
}

// --------------------------------------------------------- sector angles

interface SectorContext {
  allCategoryIds: readonly string[]
  /** skill id -> its domain category id, so a leaf/scriptFold can inherit its owning skill's arm one hop removed. */
  skillCategoryById: ReadonlyMap<string, string>
}

function buildSectorContext(snapshot: GraphSnapshot): SectorContext {
  const allCategoryIds = snapshot.nodes.filter((n) => n.kind === 'category').map((n) => n.id)
  const skillCategoryById = new Map<string, string>()
  for (const n of snapshot.nodes) if (n.kind === 'skill') skillCategoryById.set(n.id, n.category)
  return { allCategoryIds, skillCategoryById }
}

/** Which arm (taxonomy.ts's categorySectorAngle) a node belongs to: a category is its own arm's anchor; a skill inherits its domain category's arm; a leaf/scriptFold inherits its *owning skill's* category, one hop further; everything with no domain category at all (vendor, declined, refused, ghost) shares the provenance arm. A skill filed under 'unfiled' (no real category — CONTEXT.md) falls back to the provenance arm too, same as a genuinely unowned node, rather than resolving to categorySectorAngle's own index-not-found fallback (slot 0), which would silently pile it onto whichever category happens to be first. Real relationships (operative/referential/alternative) don't influence position at all — they're hidden by default and only shown, per-node, when that node is selected (App.tsx's isolateId/hiddenLinkCategories wiring), so they never compete with this always-true category structure for screen space. */
function sectorAngleOf(node: DomainNode, ctx: SectorContext): number {
  switch (node.kind) {
    case 'origin':
      // Irrelevant, not just unset: sectorForce's tangential nudge scales
      // with radius (physics.ts), and origin has no radiusTarget pulling it
      // outward at all — it sits at r≈0, where any angle produces the same
      // ~zero nudge. Returned anyway because sectorAngleOf can't return
      // undefined; 0 is as good as any other value here.
      return 0
    case 'category':
      return categorySectorAngle(node.id, ctx.allCategoryIds)
    case 'skill':
      return ctx.allCategoryIds.includes(node.category)
        ? categorySectorAngle(node.category, ctx.allCategoryIds)
        : provenanceSectorAngle(ctx.allCategoryIds)
    case 'leaf':
    case 'scriptFold': {
      const ownerCategory = ctx.skillCategoryById.get(node.owner)
      return ownerCategory !== undefined && ctx.allCategoryIds.includes(ownerCategory)
        ? categorySectorAngle(ownerCategory, ctx.allCategoryIds)
        : provenanceSectorAngle(ctx.allCategoryIds)
    }
    case 'vendor':
    case 'declined':
    case 'refused':
    case 'ghost':
      return provenanceSectorAngle(ctx.allCategoryIds)
    default:
      return assertNever(node)
  }
}

function nodeCategorySpec(node: DomainNode, ctx: SectorContext): NodeCategory {
  const spec = NODE_TAXONOMY[node.kind]
  const size = radiusOf(node)
  const code = CODE[node.kind]

  // Colour is per KIND (this module's header) — every skill one colour,
  // regardless of which domain category it belongs to. Acquired skills
  // dim that one colour rather than getting a second, since the engine's
  // shape vocabulary has no true outline-fill axis today (§6 gap, noted
  // above).
  let color: string = NODE_KIND_COLOR[node.kind]
  if (node.kind === 'skill' && fillForSkill(node) === 'outline') color = dim(color, 0.55)

  // A whole category's worth of skills sharing one exact angle draws as a
  // ruler-straight spoke — jitter it into a loose wedge (taxonomy.ts). Not
  // applied to `category` itself (the arms' own stable anchor), `origin`
  // (irrelevant at r≈0, same reasoning as sectorAngleOf's own origin case
  // above), or declined/refused/ghost (they share one categoryId per kind —
  // see engineCategoryId above — so a per-node jitter would only ever
  // reflect whichever instance happened to be processed last, not a real
  // per-node value).
  const jitter =
    node.kind === 'origin' || node.kind === 'category' || node.kind === 'declined' || node.kind === 'refused' || node.kind === 'ghost'
      ? 0
      : sectorAngleJitter(node.id)
  const radiusTarget = radiusTargetOf(node)

  // Physics tuning, not domain data — bigger nodes push harder and settle
  // slower, scaled off the same radius the shader draws, so a vendor
  // landmark doesn't get shoved around by the skills clustered under it.
  return {
    label: labelOf(node),
    shape: spec.shape,
    color,
    code,
    size,
    charge: size * 1.6,
    mass: 1 + size * 0.4,
    tier: spec.tier,
    sectorAngle: sectorAngleOf(node, ctx) + jitter,
    // undefined for leaf/scriptFold (this module's header on
    // exactOptionalPropertyTypes: the key must be genuinely absent, not
    // present-but-undefined, for physics.ts to read it as "no target").
    ...(radiusTarget === undefined ? {} : { radiusTarget }),
  }
}

// -------------------------------------------------------------- edges

const EDGE_LABEL: Record<keyof typeof EDGE_TAXONOMY, string> = {
  operative: 'Operative',
  referential: 'Referential',
  alternative: 'Alternative',
  contains: 'Contains',
  adopted: 'Adopted',
  considered: 'Considered',
  'category-clusters-skill': 'Category',
  'origin-clusters-category': 'Origin',
}

// Exported (not module-private) so a consumer building its own view of an
// edge — e.g. ui/DetailsDrawer.tsx's per-group header, which needs a link
// kind's label/color the same way the canvas itself does — reads the same
// one table instead of keeping a second copy that could drift.
export const LINK_CATEGORY: Record<string, LinkCategory> = Object.fromEntries(
  Object.entries(EDGE_TAXONOMY).map(([kind, spec]) => {
    const label = EDGE_LABEL[kind as keyof typeof EDGE_TAXONOMY]
    const reg = EDGE_REGISTER[spec.register]
    // Every EDGE_TAXONOMY row is visible:true now (category-clusters-skill
    // was the last physics-only/invisible one — see taxonomy.ts) — no
    // remaining `!spec.visible` branch to build a near-zero-alpha spring for.
    const isSemantic = spec.register === 'semantic'
    // Width, gain and routing all come from the register rather than being
    // set per kind: that's what makes the three tiers of ink a system rather
    // than eight independent decisions. `dash` is derived from `binding` and
    // its period is in SCREEN pixels, so it holds its rhythm at any zoom.
    //
    // exactOptionalPropertyTypes (§3): an optional field is omitted, never
    // explicitly set to undefined — hence the conditional spreads.
    const spec2: LinkCategory = {
      label,
      color: EDGE_HEX[spec.color],
      width: reg.half,
      gain: reg.gain,
      routing: reg.routing,
      dist: isSemantic ? 1.6 : kind === 'contains' ? 0.32 : 1.1,
      strength: kind === 'contains' ? 0.9 : 0.4,
      ...(spec.binding === 'segmented' ? { dash: SEGMENT_PERIOD_PX } : {}),
      ...(spec.flowAnimated ? { flow: 0.6 } : {}),
      ...(reg.routing === 'arc' ? { curve: ARC_BOW } : {}),
    }
    return [kind, spec2]
  }),
)

// ---------------------------------------------------------------- build

export function toGraphCanvasProps(
  snapshot: GraphSnapshot,
): Pick<GraphCanvasProps, 'nodes' | 'edges' | 'nodeCategories' | 'linkCategories'> {
  const nodes: GraphNode<DomainNode>[] = snapshot.nodes.map((n) => ({
    id: n.id,
    categoryId: engineCategoryId(n),
    label: labelOf(n),
    data: n,
  }))

  // A `ghost` is a name an edge points at with nothing behind it. The engine
  // has no notion of the domain's kinds, so the fact is handed over as the
  // graph-level one it needs: which endpoint doesn't resolve. Without this the
  // gap is only visible once you reach the far end and read the glyph —
  // nothing about the link itself says it arrives nowhere.
  const ghosts = new Set(snapshot.nodes.filter((n) => n.kind === 'ghost').map((n) => n.id))
  const edges: GraphEdge[] = snapshot.edges.map((e) => ({
    a: e.from,
    b: e.to,
    categoryId: e.kind,
    ...(ghosts.has(e.to) ? { absentEnd: 'b' as const } : ghosts.has(e.from) ? { absentEnd: 'a' as const } : {}),
  }))

  const sectorCtx = buildSectorContext(snapshot)
  const nodeCategories: Record<string, NodeCategory> = {}
  for (const n of snapshot.nodes) nodeCategories[engineCategoryId(n)] = nodeCategorySpec(n, sectorCtx)

  return { nodes, edges, nodeCategories, linkCategories: LINK_CATEGORY }
}

/**
 * Every engine categoryId a snapshot's nodes actually use, grouped by
 * domain kind — what an "enable/disable this type" legend needs to turn
 * one checkbox into the right set of ids for GraphCanvasProps'
 * `hiddenNodeCategories` (many per kind for skill/vendor/scriptFold, one
 * for everything else — see this module's header).
 */
export function categoryIdsByKind(snapshot: GraphSnapshot): Record<NodeKind, string[]> {
  const byKind: Record<NodeKind, Set<string>> = {
    origin: new Set(),
    category: new Set(),
    skill: new Set(),
    leaf: new Set(),
    scriptFold: new Set(),
    vendor: new Set(),
    declined: new Set(),
    refused: new Set(),
    ghost: new Set(),
  }
  for (const n of snapshot.nodes) byKind[n.kind].add(engineCategoryId(n))
  return Object.fromEntries(Object.entries(byKind).map(([k, ids]) => [k, [...ids]])) as Record<NodeKind, string[]>
}
