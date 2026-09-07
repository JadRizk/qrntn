// data/taxonomy.ts — kind -> visual spec tables, §6.
//
// Pure domain data: WHAT should be shown for each node/edge kind (shape,
// tier, fill/stroke treatment, hue role, size — as a formula where §6 gives
// one), never HOW a renderer achieves it. Deliberately render-technique-
// agnostic, because the render layer itself is not yet decided (Nexus's own
// fresh scene/shaders/* vs. a vendored copy of ../nexus's packages/graph,
// once its own in-flight refactor lands) — this table is the one input
// either path consumes without needing to change.
//
// Shape indices follow packages/graph's src/types.ts GlyphShapeIndex order
// verbatim (0 circle, 1 hexagon, 2 diamond, 3 ring, 4 square, 5 triangle) —
// not because this module reuses that package's code (it doesn't import
// anything from ../nexus), but so that if/when that engine is vendored in,
// this table's shape numbers already mean what its shader expects, with no
// translation layer required.
//
// `Record<Kind, Spec>` (not a switch/if-chain) is what makes the totality
// guarantee a compile error rather than a runtime check: TypeScript refuses
// to compile this file if a kind is missing, the same guarantee §3 asks
// switch-exhaustiveness-check to give a branching function. radiusOf()
// below still needs a real switch (each kind reads different fields to
// compute its size), so that one carries the assertNever(§3) instead.

import type { LinkRouting } from '../../packages/graph/src/types.ts'
import type { EdgeKind, GraphNode } from './types.ts'

// ------------------------------------------------------------- node shape

/**
 * 0 circle · 1 hexagon · 2 square · 3 ring · 4 diamond · 5 triangle.
 *
 * packages/graph's own types.ts documents this order as "circle, hexagon,
 * diamond, ring, square, triangle" (2=diamond, 4=square) — but its shader's
 * sdPoly(p, r, 4, rot) puts a face centre, not a corner, on the +x axis at
 * rot=0 (index 2) and a corner at rot=0.78539=45° (index 4), which is an
 * axis-aligned square at 2 and a 45°-rotated diamond at 4: the reverse of
 * the comment. Confirmed by rendering real leaf nodes at index 4 and seeing
 * diamonds, not squares. A pre-existing mislabel in the vendored source,
 * not a change made here — this table follows the shader's actual geometry
 * rather than its comment, so GLYPH.square really renders square.
 */
export type GlyphShape = 0 | 1 | 2 | 3 | 4 | 5
export const GLYPH = { circle: 0, hexagon: 1, square: 2, ring: 3, diamond: 4, triangle: 5 } as const satisfies Record<string, GlyphShape>

// @nexus/react's own GLYPH_SHAPES export (["circle","hexagon","diamond",
// "ring","square","triangle"]) carries the identical square/diamond mislabel
// this table's own comment (above) already found and fixed: packages/graph's
// shader puts a face, not a corner, on the +x axis at shape index 2, which is
// an axis-aligned square, not the "diamond" @nexus/react's array claims.
// Rather than import that array and get the same wrong shape wherever a
// GLYPH index needs to become @nexus/react's string vocabulary, this is the
// corrected mapping — index-for-index the reverse of GLYPH_SHAPES at 2 and
// 4, everywhere else identical. Shared by every consumer that renders a
// GLYPH index through @nexus/react's Glyph (ui/TypeLegend.tsx, the command
// palette's node items), so the fix lives in one place.
export const ENGINE_SHAPE_NAME: Record<GlyphShape, 'circle' | 'hexagon' | 'diamond' | 'ring' | 'square' | 'triangle'> = {
  0: 'circle',
  1: 'hexagon',
  2: 'square',
  3: 'ring',
  4: 'diamond',
  5: 'triangle',
}

export type FillStyle = 'solid' | 'outline' | 'hatched'
export type StrokeStyle = 'none' | 'dashed'

export type NodeKind = GraphNode['kind']

export interface NodeVisualSpec {
  shape: GlyphShape
  fill: FillStyle
  stroke: StrokeStyle
  /** §6's LOD tier: 0 always visible, higher tiers earn screen space on zoom/focus. */
  tier: number
}

// §6, verbatim per row, minus colour — colour is per KIND (below), not
// modelled here, because it applies uniformly regardless of shape/fill.
// `authored`/`acquired` skill fill (solid/outline) is a per-instance
// override applied on top of this table (see fillForSkill below), not a
// second taxonomy row — a skill is one kind, not two.
export const NODE_TAXONOMY = {
  origin: { shape: GLYPH.diamond, fill: 'solid', stroke: 'none', tier: 0 },
  category: { shape: GLYPH.hexagon, fill: 'solid', stroke: 'none', tier: 0 },
  skill: { shape: GLYPH.hexagon, fill: 'solid', stroke: 'none', tier: 0 },
  leaf: { shape: GLYPH.square, fill: 'solid', stroke: 'none', tier: 2 },
  scriptFold: { shape: GLYPH.triangle, fill: 'outline', stroke: 'dashed', tier: 2 },
  vendor: { shape: GLYPH.circle, fill: 'solid', stroke: 'none', tier: 0 },
  declined: { shape: GLYPH.circle, fill: 'hatched', stroke: 'none', tier: 1 },
  refused: { shape: GLYPH.circle, fill: 'hatched', stroke: 'none', tier: 1 },
  ghost: { shape: GLYPH.ring, fill: 'outline', stroke: 'dashed', tier: 1 },
} as const satisfies Record<NodeKind, NodeVisualSpec>

/** A skill's spine renders solid if authored, outline if acquired (§6) — layered on NODE_TAXONOMY.skill.fill, not a separate table entry. */
export function fillForSkill(origin: GraphNode & { kind: 'skill' }): FillStyle {
  return origin.origin === 'authored' ? 'solid' : 'outline'
}

// ---------------------------------------------------------- kind colour

// Colour is per KIND, not per domain category (catalog.json's direction/
// motion/trust/...): every skill, every category landmark, every vendor
// reads as one colour regardless of which of the 7 domain categories it
// belongs to. That is what makes an "enable/disable this type" legend
// mean anything — a legend swatch names a colour, and a colour that meant
// something different depending on which skill it happened to be on
// couldn't be toggled as one row. Domain-category identity is still real
// data (SkillNode.category, read in the drawer/adjacency) — it just isn't
// what the graph's colour channel encodes.
//
// These eight used to be picked independently of @nexus/tokens (packages/
// tokens/src/tokens.css) — "evenly spaced, not picked by eye" among
// themselves, but not actually drawn from the app's own palette, the same
// gap the edge colours had (adapt/toGraphCanvas.ts's EDGE_HEX) before it
// got the identical fix. GPU colour still has to be a real hex (Three.js
// `Color` parsing), never a CSS custom property, but it can be the literal
// hex a token resolves to — and NexusProvider (src/main.tsx) sets
// theme="hud", so these are that variant's grey ramp specifically.
//
// The token set only has five non-restricted accent hues (acid, data,
// lime, sodium, violet) plus phosphor (the body-text colour) and alarm
// (RESTRICTED to --nx-fg-critical) — fewer than nine kinds, on purpose:
// acid is reserved for the UI's own interactive/active state (buttons,
// focus rings) and phosphor for body text, so neither leaks onto graph
// content where it would misread as "this node is focused" or "this is
// just a label." That leaves four accent hues for six landmark-or-content
// kinds sharing one colour role already: `leaf` and `scriptFold` are both
// "depth" content (§6) exactly the way `refused`/`ghost` are both
// "trust-loss" — so they share a hue too, disambiguated by shape (square
// vs. dashed-outline triangle) the same way refused/ghost already were
// (hatched circle vs. dashed ring). `declined` moves from a hand-mixed
// olive to the token system's own neutral-grey role (`--nx-fg-subtle`),
// matching §6's "stays neutral, not alarm-colored" more literally than an
// eyeballed approximation ever did.
//
// `origin` reuses `vendor`'s sodium — every non-restricted hue was already
// spoken for, and unlike `leaf`/`scriptFold` or `refused`/`ghost` sharing
// one because they're the *same kind of thing*, this pairing shares one
// because there's nothing left to give it, not because origin and vendor
// mean anything alike. In practice the two never collide: vendor nodes are
// hidden by default (App.tsx), so origin is normally the only sodium node
// on screen at all — and it's also the one shape (diamond) and one size
// (ORIGIN_RADIUS, below) nothing else uses, so shape and scale carry the
// real distinction, colour is just a bonus. `acid` was the one hue that
// stayed unclaimed, but reusing it here would break the exact rule its own
// header states two paragraphs up — origin doesn't get a carve-out.
export const NODE_KIND_COLOR = {
  origin: '#FF8A1E', // --nx-sodium — see the note above on why this, not acid
  category: '#9D7BFF', // --nx-violet — structural landmark
  skill: '#7CFF4F', // --nx-lime — primary content
  leaf: '#17E2E5', // --nx-data / --nx-fg-info — depth, loaded on demand
  scriptFold: '#17E2E5', // --nx-data — same "depth" hue as leaf; shape (dashed triangle) tells them apart
  vendor: '#FF8A1E', // --nx-sodium / --nx-fg-warning — provenance landmark
  declined: '#5E7359', // --nx-grey-500 ('hud') / --nx-fg-subtle — a judgment call, not a risk
  refused: '#FF2E63', // --nx-alarm / --nx-fg-critical — a trust signal
  ghost: '#FF2E63', // --nx-alarm — same family as refused, shape tells them apart
} as const satisfies Record<NodeKind, string>

// Display order and copy for anything that lists every kind as one row —
// ui/TypeLegend.tsx's toggle list and the command palette's per-kind filter
// actions both want the same order and the same words, so both read from
// here rather than keeping their own copy.
export const KIND_ORDER: readonly NodeKind[] = ['origin', 'category', 'vendor', 'skill', 'scriptFold', 'leaf', 'declined', 'refused', 'ghost']

export const KIND_LABEL: Record<NodeKind, string> = {
  origin: 'Origin',
  category: 'Category',
  vendor: 'Vendor',
  skill: 'Skill',
  scriptFold: 'Scripts',
  leaf: 'Reference/asset',
  declined: 'Declined',
  refused: 'Refused',
  ghost: 'Ghost',
}

// -------------------------------------------------------------- node size

// §6's Size column, ported fresh (not scripts/atlas-render.mjs's rSpine/
// rHalo — a deliberately different formula, matching what SPEC.md §6
// itself specifies: `sqrt(words)` spine, `sqrt(words+refWords)` halo,
// additive to spine, not the atlas's `5.6 + sqrt(words)/7.4`).
// Bigger than every category landmark, on purpose and unconditionally —
// there's exactly one of these ever, and it's the root everything else
// hangs off, so it's the one shape allowed to read as "biggest on screen"
// (§6's own hierarchy already reserves that role for a landmark tier; this
// just adds one rank above `category` for the single node that contains
// them all).
export const ORIGIN_RADIUS = 20
export const CATEGORY_RADIUS = 14 // landmark constant
export const LEAF_RADIUS = 2.4 // fixed small
export const DECLINED_RADIUS = 3.4 // fixed small
export const REFUSED_RADIUS = 3.4 // fixed small
export const GHOST_RADIUS = 3.4 // fixed small

// A raw, uncapped sqrt(words) let a handful of reference-heavy real skills
// (design-direction, skill-audit — both with a halo several thousand words
// deep) render *larger than every category landmark*, inverting the
// category-hub/skill-satellite/leaf-orbit hierarchy §6 describes. The
// vendored engine's own reference showcase (../Nexus's NexusCyberdeck.tsx,
// sampleData.ts NODE_CATEGORIES) never lets this happen: every one of its
// content-tier kinds (`note`, `source`, `tag`, ...) sizes from one fixed
// constant per category, only nudged by degree — its "landmark" tier
// (`moc`) is unconditionally the largest shape on screen. CONTENT_RADIUS_CAP
// is this codebase's version of that same guarantee, applied on top of the
// still-genuinely-word-driven formula below (unlike the reference, size
// here does keep tracking real content weight) — a skill can still read as
// "bigger = more content," it just can never cross into landmark territory.
const CONTENT_RADIUS_CAP = CATEGORY_RADIUS * 0.75

// Scale constants tune sqrt-word-count and sqrt-count formulas into a
// legible radius range; not carried over from the atlas's own 7.4/7.8
// divisors (those size a different formula — see the comment above).
const SKILL_SCALE = 0.16
const VENDOR_SCALE = 3.2
const FOLD_SCALE = 1.6

export function spineRadius(words: number): number {
  return Math.min(Math.sqrt(words) * SKILL_SCALE, CONTENT_RADIUS_CAP)
}

/** Additive to the spine, per §6 ("halo") — the full outer radius, not a ring width. Zero halo words still returns >= spineRadius, so a skill with nothing deferred to references has no halo ring to draw at all (caller's job: only draw the halo when refWords > 0). Capped the same as spineRadius — a deep reference halo still can't outsize a category landmark. */
export function haloRadius(words: number, refWords: number): number {
  return Math.min(Math.sqrt(words + refWords) * SKILL_SCALE, CONTENT_RADIUS_CAP)
}

export function vendorRadius(adoptedCount: number): number {
  return Math.min(Math.sqrt(adoptedCount + 1) * VENDOR_SCALE, CONTENT_RADIUS_CAP)
}

export function scriptFoldRadius(scriptCount: number): number {
  return Math.min(Math.sqrt(scriptCount) * FOLD_SCALE, CONTENT_RADIUS_CAP)
}

export function assertNever(x: never): never {
  throw new Error(`taxonomy: unhandled kind ${JSON.stringify(x)}`)
}

/** The node's own outer radius — for a skill, this is its halo (or spine, when refWords is 0), matching §6's "size" column read as one number per node. */
export function radiusOf(node: GraphNode): number {
  switch (node.kind) {
    case 'origin':
      return ORIGIN_RADIUS
    case 'category':
      return CATEGORY_RADIUS
    case 'skill':
      return node.refWords > 0 ? haloRadius(node.words, node.refWords) : spineRadius(node.words)
    case 'leaf':
      return LEAF_RADIUS
    case 'scriptFold':
      return scriptFoldRadius(node.scripts.length)
    case 'vendor':
      return vendorRadius(node.adopted.length)
    case 'declined':
      return DECLINED_RADIUS
    case 'refused':
      return REFUSED_RADIUS
    case 'ghost':
      return GHOST_RADIUS
    default:
      return assertNever(node)
  }
}

// ------------------------------------------------------------ categories

// A fixed, ordered palette — distinct hues, colour-blind separable by
// construction (evenly spaced around the wheel rather than picked by eye).
// `categoryColor` is pure: given the *same* ordered list of category ids
// every caller derives from the loaded graph (categories, in catalog.json's
// own order), the same id always resolves to the same colour — no hidden
// global registry, no I/O.
const CATEGORY_PALETTE = [
  '#6e56cf', // violet
  '#3aa676', // green
  '#c2792a', // amber-brown
  '#3a8fc2', // blue
  '#c2445f', // rose
  '#8a7a3a', // olive
  '#3ac2b0', // teal
] as const

export function categoryColor(categoryId: string, allCategoryIds: readonly string[]): string {
  const i = allCategoryIds.indexOf(categoryId)
  const palette = CATEGORY_PALETTE as readonly string[]
  return palette[(i < 0 ? 0 : i) % palette.length] as string
}

// --------------------------------------------------------- sector angles

// Categories read as landmarks (the size section above) but nothing about
// their *position* said "category hub, skills radiating out of it,
// documents orbiting the skill" — physics only pulled a skill loosely
// toward its category (adapt/toGraphCanvas.ts's category-clusters-skill
// spring), with no constraint on *which direction*, so the graph still
// settled into an undirected cloud. categorySectorAngle gives every
// category its own angular slot, evenly spaced around a full turn; a skill
// (and its leaves/folds, by inheriting their owning skill's slot) shares
// its category's angle, so the whole graph settles into radiating arms —
// paired with packages/graph's sectorForce (physics.ts), a gentle bias
// toward that angle rather than a rigid pinned position, so it still
// composes with organic repulsion/spring jitter instead of freezing it.
// One slot is reserved (provenanceSectorAngle) for the handful of nodes
// with no domain category at all (vendor, declined, refused, ghost), so
// they get their own arm rather than silently piling onto whichever
// category happens to be first in catalog.json.
export function categorySectorAngle(categoryId: string, allCategoryIds: readonly string[]): number {
  const slots = allCategoryIds.length + 1
  const i = allCategoryIds.indexOf(categoryId)
  return ((i < 0 ? 0 : i) / slots) * Math.PI * 2
}

/** The shared arm for nodes with no domain category — see categorySectorAngle. */
export function provenanceSectorAngle(allCategoryIds: readonly string[]): number {
  const slots = allCategoryIds.length + 1
  return (allCategoryIds.length / slots) * Math.PI * 2
}

// A whole category sharing one exact angle would draw as a perfectly
// straight spoke — every skill in it stacked on the same ray, separated
// only by radius. sectorAngleJitter spreads a node a few degrees off its
// arm's centreline, deterministically (same node id -> same jitter, every
// render, every reseed — no flicker), so a spoke reads as a loose wedge
// rather than a ruler-straight line. Categories themselves are never
// jittered (see adapt/toGraphCanvas.ts) — they're the stable frame the
// arms are measured from.
const SECTOR_JITTER_SPREAD = (12 * Math.PI) / 180 // +/-12 degrees

/** Deterministic pseudo-random unit value in [0, 1) for a string — same input, same output, every render/reseed, no Math.random() flicker. `salt` decorrelates two jitters derived from the same node id (angle vs. radius) so they don't move in lockstep. */
function deterministicUnit(id: string, salt: string): number {
  let h = 0
  const s = salt + id
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0
  return (h >>> 0) % 10000 / 10000
}

export function sectorAngleJitter(id: string): number {
  return (deterministicUnit(id, 'angle:') - 0.5) * 2 * SECTOR_JITTER_SPREAD
}

// -------------------------------------------------------------- ring radii

// The angular arms above only answer "which direction" — they say nothing
// about "how far out", so a category and its own skills could still end up
// at the same distance from the origin, muddying the hub/spoke read. These
// give every kind a target *ring*: categories anchor a wide outer ring
// (the arms' hub), skills sit on a narrower inner ring along their arm,
// and the vendor/declined/refused/ghost provenance arm gets its own
// landmark-plus-satellites pair, mirroring the category/skill split.
// Paired with packages/graph's radiusForce (physics.ts), a spring toward
// this radius that *replaces* generic gravity for a targeted node rather
// than competing with it — see PhysicsNode.radiusTarget's own comment for
// why. Leaves/script-folds get no target at all: the existing `contains`
// spring already holds them tight to their owning skill's position, which
// is itself now anchored, so they inherit a sensible radius for free.
export const CATEGORY_RING_RADIUS = 260
export const SKILL_RING_RADIUS = 150
export const VENDOR_RING_RADIUS = 220
export const PROVENANCE_SATELLITE_RADIUS = 150

// Every skill sharing one exact radius would draw as a ruler-straight arc
// — spread it a little, same deterministic-per-id approach as the angle
// jitter above (with its own salt, so a node's angle and radius jitter
// don't move together).
const RADIUS_JITTER_SPREAD = 35 // world units

export function skillRingRadiusJitter(id: string): number {
  return (deterministicUnit(id, 'radius:') - 0.5) * 2 * RADIUS_JITTER_SPREAD
}

/** Which ring a node's radiusTarget anchors to. Pure — unlike sectorAngleOf's kind-specific angle (adapt/toGraphCanvas.ts), which ring a node belongs to depends only on its own kind, never on which domain category or skill owns it. undefined (leaf, scriptFold) means no target at all — see this section's header. */
export function radiusTargetOf(node: GraphNode): number | undefined {
  switch (node.kind) {
    case 'origin':
      // No target — origin has no ring to sit on, it's the hub every ring
      // is measured from. Ordinary gravity-to-world-origin already pulls it
      // to (0,0), which is exactly where it belongs; a radiusTarget would
      // be pulling it toward the same point a second, redundant way.
      return undefined
    case 'category':
      return CATEGORY_RING_RADIUS
    case 'skill':
      return SKILL_RING_RADIUS + skillRingRadiusJitter(node.id)
    case 'vendor':
      return VENDOR_RING_RADIUS
    case 'declined':
    case 'refused':
    case 'ghost':
      return PROVENANCE_SATELLITE_RADIUS
    case 'leaf':
    case 'scriptFold':
      return undefined
    default:
      return assertNever(node)
  }
}

// -------------------------------------------------------------- edge kind

/**
 * Which of the three tiers of ink an edge kind belongs to. This is the
 * distinction that lets every kind stay the same thin width: the register
 * picks the *routing*, so form carries the taxonomy and weight doesn't have
 * to.
 *
 * - `structure` — 40 of the 66 edges in the real graph (`contains` plus the
 *   two cluster kinds). Layout scaffolding you read as *shape*, never as
 *   individual objects. Drawn as an etched trace: the board the graph is
 *   printed on.
 * - `semantic` — the claims the collection actually makes about itself.
 *   Drawn as an arc through open space.
 * - `verdict` — a vendor's judgment on a candidate. Drawn dead straight.
 */
export type EdgeRegister = 'structure' | 'semantic' | 'verdict'

/**
 * One orthogonal channel, on top of register: how binding the relationship
 * is. `solid` is a structural fact or a real invocation; `segmented` is
 * advisory, or a judgment that went the other way.
 *
 * A third value doesn't live here, because it isn't a property of the kind:
 * an edge whose *target* doesn't resolve frays out and lands on no pad, and
 * that's derived from the endpoint node in the adapter.
 */
export type EdgeBinding = 'solid' | 'segmented'

export type EdgeColorRole = 'hot' | 'cool' | 'alt' | 'affirmed' | 'neutral' | 'etch'

/**
 * Per-register drawing constants. `gain` is an intensity multiplier folded
 * into `OpticsConfig.edgeOpacity`, not a coverage alpha — and it is not
 * bounded at 1, because what a usable value looks like depends on how much
 * of a dim edge the CRT composite leaves behind. These three were measured
 * off the rendered scene buffer rather than chosen: an earlier set, tuned
 * against a software mock with no scanline/grille/vignette chain, came out
 * roughly 2.4x too dark and left the structural register invisible.
 */
export const EDGE_REGISTER = {
  structure: { half: 1.15, gain: 0.55, routing: 'etched' },
  semantic: { half: 1.55, gain: 2.2, routing: 'arc' },
  verdict: { half: 1.25, gain: 1.0, routing: 'straight' },
} as const satisfies Record<EdgeRegister, { half: number; gain: number; routing: LinkRouting }>

/** Dash period for `segmented`, in SCREEN pixels — constant at any zoom. Was a per-kind free number measured against the world-space chord, which compressed dashes into a solid line as you zoomed out. */
export const SEGMENT_PERIOD_PX = 13

/** Bow for `routing: 'arc'`, as a fraction of the chord. Shallow on purpose: enough to separate an arc from a straight assertion at a glance, not enough to cost screen space. */
export const ARC_BOW = 0.115

export interface EdgeVisualSpec {
  register: EdgeRegister
  color: EdgeColorRole
  binding: EdgeBinding
  flowAnimated: boolean
  /** Whether this edge kind ever reaches the screen. Mirrors the data layer's own per-edge `render` flag (true for every kind — see data/types.ts's EdgeRecordSchema) — kept here too so a renderer can filter by kind alone without re-reading every edge record. */
  visible: boolean
}

// Arrowheads and a width split were tried and removed for reading as busy;
// that judgment holds, and the engine's arrowhead path no longer exists (its
// attribute slot became the register gain — see shaders.ts's EDGE_ATTRS).
// Direction rides the flow packet instead, which costs no extra ink.
//
// `dash` is gone as a free per-kind number: it is now a consequence of
// `binding`, and its period is fixed in screen pixels by the adapter. A row
// can no longer quietly pick its own dash density.
//
// `adopted` and `considered` used to be the same grey at the same dash — two
// opposite decisions rendered identically. They now split on binding (a
// verdict that landed is unbroken; one that didn't is segmented) and on hue,
// while sharing the `verdict` register so both still read as judgments.
export const EDGE_TAXONOMY = {
  operative: { register: 'semantic', color: 'hot', binding: 'solid', flowAnimated: true, visible: true },
  referential: { register: 'semantic', color: 'cool', binding: 'segmented', flowAnimated: false, visible: true },
  alternative: { register: 'semantic', color: 'alt', binding: 'segmented', flowAnimated: false, visible: true },
  contains: { register: 'structure', color: 'etch', binding: 'solid', flowAnimated: false, visible: true },
  adopted: { register: 'verdict', color: 'affirmed', binding: 'solid', flowAnimated: false, visible: true },
  considered: { register: 'verdict', color: 'neutral', binding: 'segmented', flowAnimated: false, visible: true },
  'category-clusters-skill': { register: 'structure', color: 'etch', binding: 'solid', flowAnimated: false, visible: true },
  'origin-clusters-category': { register: 'structure', color: 'etch', binding: 'solid', flowAnimated: false, visible: true },
} as const satisfies Record<EdgeKind, EdgeVisualSpec>
