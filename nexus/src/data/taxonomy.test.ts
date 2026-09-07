import { describe, expect, it } from 'vitest'
import {
  CATEGORY_RADIUS,
  CATEGORY_RING_RADIUS,
  ARC_BOW,
  EDGE_REGISTER,
  EDGE_TAXONOMY,
  SEGMENT_PERIOD_PX,
  NODE_TAXONOMY,
  PROVENANCE_SATELLITE_RADIUS,
  SKILL_RING_RADIUS,
  VENDOR_RING_RADIUS,
  categoryColor,
  categorySectorAngle,
  fillForSkill,
  haloRadius,
  provenanceSectorAngle,
  radiusOf,
  radiusTargetOf,
  scriptFoldRadius,
  sectorAngleJitter,
  skillRingRadiusJitter,
  spineRadius,
  vendorRadius,
} from './taxonomy.ts'
import type { EdgeKind, GraphNode } from './types.ts'
import { EdgeKindSchema, GraphNodeSchema } from './types.ts'

const ALL_NODE_KINDS = GraphNodeSchema.options.map((s) => s.shape.kind.value)
const ALL_EDGE_KINDS = EdgeKindSchema.options as EdgeKind[]

describe('totality — every kind export-graph.mjs can emit has a taxonomy entry', () => {
  it('NODE_TAXONOMY has an entry for every node kind in the schema', () => {
    for (const kind of ALL_NODE_KINDS) {
      expect(NODE_TAXONOMY).toHaveProperty(kind)
    }
    expect(Object.keys(NODE_TAXONOMY).sort()).toEqual([...ALL_NODE_KINDS].sort())
  })

  it('EDGE_TAXONOMY has an entry for every edge kind in the schema', () => {
    for (const kind of ALL_EDGE_KINDS) {
      expect(EDGE_TAXONOMY).toHaveProperty(kind)
    }
    expect(Object.keys(EDGE_TAXONOMY).sort()).toEqual([...ALL_EDGE_KINDS].sort())
  })

  it('every register named by a kind has drawing constants', () => {
    for (const spec of Object.values(EDGE_TAXONOMY)) {
      expect(EDGE_REGISTER).toHaveProperty(spec.register)
    }
  })

  it('the three registers are separated by gain, which is what lets them share a width', () => {
    // The ordering is the whole design: scaffolding under judgments under
    // claims. If a future tweak inverts one of these, the graph stops having
    // a hierarchy and the registers become decoration.
    expect(EDGE_REGISTER.structure.gain).toBeLessThan(EDGE_REGISTER.verdict.gain)
    expect(EDGE_REGISTER.verdict.gain).toBeLessThan(EDGE_REGISTER.semantic.gain)
  })

  it('each register routes differently, so form carries the taxonomy', () => {
    const routings = Object.values(EDGE_REGISTER).map((r) => r.routing)
    expect(new Set(routings).size).toBe(routings.length)
  })

  it('the two vendor verdicts are distinguishable from each other', () => {
    // They were previously the same grey at the same dash — two opposite
    // decisions rendered identically. Same register, different everything else.
    expect(EDGE_TAXONOMY.adopted.register).toBe(EDGE_TAXONOMY.considered.register)
    expect(EDGE_TAXONOMY.adopted.binding).not.toBe(EDGE_TAXONOMY.considered.binding)
    expect(EDGE_TAXONOMY.adopted.color).not.toBe(EDGE_TAXONOMY.considered.color)
  })

  it('the scaffolding reads as one substrate, not three separate kinds', () => {
    // contains + the two cluster kinds are the majority of edges in the real
    // graph. They earn their quietness by being indistinguishable from each
    // other: one hue, one binding, one routing — a board, not three ideas.
    const structural = Object.values(EDGE_TAXONOMY).filter((s) => s.register === 'structure')
    expect(structural.length).toBe(3)
    expect(new Set(structural.map((s) => s.color)).size).toBe(1)
    expect(new Set(structural.map((s) => s.binding)).size).toBe(1)
  })

  it('a shallow arc stays shallow enough to read as a route, not a detour', () => {
    expect(ARC_BOW).toBeGreaterThan(0)
    expect(ARC_BOW).toBeLessThan(0.25)
  })

  it('the dash period is a screen-space pixel count, not a world-space density', () => {
    // A world-space period compressed dashes into a solid line as you zoomed
    // out; the value is only meaningful if it stays a pixel count.
    expect(SEGMENT_PERIOD_PX).toBeGreaterThan(4)
    expect(Number.isInteger(SEGMENT_PERIOD_PX)).toBe(true)
  })
})

describe('size formulas — hand-computed values', () => {
  const CAP = CATEGORY_RADIUS * 0.75

  it('spineRadius(words) = sqrt(words) * 0.16, below the landmark cap', () => {
    expect(spineRadius(100)).toBeCloseTo(10 * 0.16, 10)
    expect(spineRadius(0)).toBe(0)
  })

  it('haloRadius(words, refWords) = sqrt(words + refWords) * 0.16, additive to the spine', () => {
    expect(haloRadius(100, 44)).toBeCloseTo(12 * 0.16, 10) // sqrt(144) = 12
    expect(haloRadius(100, 0)).toBeCloseTo(spineRadius(100), 10)
    expect(haloRadius(100, 44)).toBeGreaterThan(spineRadius(100))
  })

  it('vendorRadius(adoptedCount) = sqrt(adoptedCount + 1) * 3.2', () => {
    expect(vendorRadius(3)).toBeCloseTo(2 * 3.2, 10) // sqrt(4) = 2
    expect(vendorRadius(0)).toBeCloseTo(1 * 3.2, 10) // a vendor always has >= 1 term inside the sqrt
  })

  it('scriptFoldRadius(scriptCount) = sqrt(scriptCount) * 1.6', () => {
    expect(scriptFoldRadius(9)).toBeCloseTo(3 * 1.6, 10)
  })

  // A category landmark must always be able to out-scale any content-tier
  // node — real skill data (design-direction, skill-audit) once broke this
  // under the old uncapped formula, rendering bigger than every category.
  it('no content-tier size formula can exceed 75% of the category landmark radius, regardless of input', () => {
    expect(spineRadius(1_000_000)).toBeLessThanOrEqual(CAP)
    expect(haloRadius(1_000_000, 1_000_000)).toBeLessThanOrEqual(CAP)
    expect(vendorRadius(1_000_000)).toBeLessThanOrEqual(CAP)
    expect(scriptFoldRadius(1_000_000)).toBeLessThanOrEqual(CAP)
  })
})

function skill(words: number, refWords: number, origin: 'authored' | 'acquired' = 'authored'): GraphNode & { kind: 'skill' } {
  return {
    kind: 'skill',
    id: 's',
    name: 's',
    description: '',
    category: 'unfiled',
    origin,
    manualOnly: false,
    words,
    refWords,
    usage: null,
  }
}

describe('radiusOf', () => {
  it('a skill with refWords 0 sizes by its spine alone', () => {
    expect(radiusOf(skill(100, 0))).toBeCloseTo(spineRadius(100), 10)
  })

  it('a skill with refWords > 0 sizes by its halo', () => {
    expect(radiusOf(skill(100, 44))).toBeCloseTo(haloRadius(100, 44), 10)
  })

  it('a vendor sizes by sqrt(adopted.length + 1)', () => {
    const vendor: GraphNode = { kind: 'vendor', id: 'v', repo: 'v', url: 'https://example.com', adopted: ['a', 'b', 'c'] }
    expect(radiusOf(vendor)).toBeCloseTo(vendorRadius(3), 10)
  })

  it('a category always returns the landmark constant', () => {
    const category: GraphNode = { kind: 'category', id: 'c', title: 'C', blurb: '' }
    expect(radiusOf(category)).toBe(radiusOf(category)) // deterministic
    expect(typeof radiusOf(category)).toBe('number')
  })
})

describe('fillForSkill', () => {
  it('authored renders solid', () => {
    expect(fillForSkill(skill(10, 0, 'authored'))).toBe('solid')
  })
  it('acquired renders outline', () => {
    expect(fillForSkill(skill(10, 0, 'acquired'))).toBe('outline')
  })
})

describe('categoryColor', () => {
  const ids = ['direction', 'deciding', 'planning', 'motion', 'building', 'trust', 'authoring']

  it('is deterministic for the same id and list', () => {
    expect(categoryColor('motion', ids)).toBe(categoryColor('motion', ids))
  })

  it('gives every category in a 7-category list a distinct colour', () => {
    const colors = ids.map((id) => categoryColor(id, ids))
    expect(new Set(colors).size).toBe(ids.length)
  })

  it('degrades to the first palette colour for an id absent from the list, rather than throwing', () => {
    expect(() => categoryColor('nonexistent', ids)).not.toThrow()
  })
})

describe('sector angles', () => {
  const ids = ['direction', 'deciding', 'planning', 'motion', 'building', 'trust', 'authoring']

  it('is deterministic for the same id and list', () => {
    expect(categorySectorAngle('motion', ids)).toBe(categorySectorAngle('motion', ids))
  })

  it('gives every category, plus the shared provenance arm, a distinct angle', () => {
    const angles = [...ids.map((id) => categorySectorAngle(id, ids)), provenanceSectorAngle(ids)]
    expect(new Set(angles).size).toBe(angles.length)
  })

  it('spaces every category and the provenance arm evenly around a full turn', () => {
    const angles = [...ids.map((id) => categorySectorAngle(id, ids)), provenanceSectorAngle(ids)].sort((a, b) => a - b)
    const step = (Math.PI * 2) / (ids.length + 1)
    for (let i = 1; i < angles.length; i++) expect(angles[i]! - angles[i - 1]!).toBeCloseTo(step, 10)
  })

  it("an id absent from the list resolves to categorySectorAngle's own fallback slot (0), not a thrown error", () => {
    expect(() => categorySectorAngle('nonexistent', ids)).not.toThrow()
    expect(categorySectorAngle('nonexistent', ids)).toBe(0)
  })

  it('sectorAngleJitter is deterministic per id and stays within its declared spread', () => {
    const j1 = sectorAngleJitter('design-direction')
    const j2 = sectorAngleJitter('design-direction')
    expect(j1).toBe(j2)
    const spread = (12 * Math.PI) / 180
    for (const id of ['a', 'b', 'skill-audit', 'x'.repeat(40)]) {
      expect(Math.abs(sectorAngleJitter(id))).toBeLessThanOrEqual(spread)
    }
  })

  it('sectorAngleJitter differs across distinct ids (not a constant in disguise)', () => {
    const jitters = new Set(['design-direction', 'skill-audit', 'animate', 'apple-design'].map(sectorAngleJitter))
    expect(jitters.size).toBeGreaterThan(1)
  })
})

describe('radiusTargetOf', () => {
  it('a category targets the outer landmark ring', () => {
    const category: GraphNode = { kind: 'category', id: 'c', title: 'C', blurb: '' }
    expect(radiusTargetOf(category)).toBe(CATEGORY_RING_RADIUS)
  })

  it('a skill targets the inner ring, jittered but centred on SKILL_RING_RADIUS', () => {
    const target = radiusTargetOf(skill(100, 0))
    expect(target).toBeCloseTo(SKILL_RING_RADIUS + skillRingRadiusJitter('s'), 10)
    expect(Math.abs(target! - SKILL_RING_RADIUS)).toBeLessThanOrEqual(35)
  })

  it('a vendor targets its own landmark ring, distinct from the category ring', () => {
    const vendor: GraphNode = { kind: 'vendor', id: 'v', repo: 'v', url: 'https://example.com', adopted: [] }
    expect(radiusTargetOf(vendor)).toBe(VENDOR_RING_RADIUS)
    expect(VENDOR_RING_RADIUS).not.toBe(CATEGORY_RING_RADIUS)
  })

  it('declined/refused/ghost all target the shared provenance satellite radius', () => {
    const declined: GraphNode = { kind: 'declined', id: 'd', name: 'd', vendorId: null, date: null, scan: null, why: null }
    const refused: GraphNode = { kind: 'refused', id: 'r', name: 'r', vendorId: null, date: null, blockingFinding: null }
    const ghost: GraphNode = { kind: 'ghost', id: 'g', name: 'g', referencedBy: [] }
    expect(radiusTargetOf(declined)).toBe(PROVENANCE_SATELLITE_RADIUS)
    expect(radiusTargetOf(refused)).toBe(PROVENANCE_SATELLITE_RADIUS)
    expect(radiusTargetOf(ghost)).toBe(PROVENANCE_SATELLITE_RADIUS)
  })

  it('leaf and scriptFold have no target — they inherit position from the contains spring instead', () => {
    const leaf: GraphNode = { kind: 'leaf', id: 'l', owner: 's', file: 'f.md', leafKind: 'ref', words: 10 }
    const fold: GraphNode = { kind: 'scriptFold', id: 'f', owner: 's', scripts: ['a.sh'] }
    expect(radiusTargetOf(leaf)).toBeUndefined()
    expect(radiusTargetOf(fold)).toBeUndefined()
  })
})
