import { describe, expect, it } from 'vitest'
import { ariaLabelFor, buildAdjacency } from './domOverlay.ts'
import type { EdgeRecord, GraphNode } from '../data/types.ts'

function edge(from: string, to: string, render = true): EdgeRecord {
  return { kind: 'referential', from, to, render, when: null, note: null, source: null }
}

describe('buildAdjacency', () => {
  it('is symmetric — an edge makes each endpoint the other\'s neighbour', () => {
    const adj = buildAdjacency([edge('animate', 'pick-ui-library')])
    expect(adj.get('animate')).toEqual(['pick-ui-library'])
    expect(adj.get('pick-ui-library')).toEqual(['animate'])
  })

  it('excludes render:false edges — a physics-only relationship, not a perceivable one', () => {
    const adj = buildAdjacency([edge('a', 'b', false)])
    expect(adj.has('a')).toBe(false)
    expect(adj.has('b')).toBe(false)
  })

  it('deduplicates and sorts neighbours', () => {
    const adj = buildAdjacency([edge('animate', 'review-animations'), edge('animate', 'improve-animations'), edge('review-animations', 'animate')])
    expect(adj.get('animate')).toEqual(['improve-animations', 'review-animations'])
  })
})

describe('ariaLabelFor', () => {
  it('names a skill with its origin', () => {
    const node: GraphNode = {
      kind: 'skill', id: 'animate', name: 'animate', description: '', category: 'motion',
      origin: 'acquired', manualOnly: false, words: 10, refWords: 0, usage: null,
      files: [], record: { source: null, commit: null, date: null, verdict: null, findings: null, dispositioned: null, reportPath: null, missing: [] }, findings: [],
    }
    expect(ariaLabelFor(node)).toBe('animate, acquired skill')
  })

  it('surfaces a ghost\'s referencing skills, not just its name', () => {
    const node: GraphNode = { kind: 'ghost', id: 'implement-design-system', name: 'implement-design-system', referencedBy: ['design-direction'] }
    expect(ariaLabelFor(node)).toContain('design-direction')
  })

  it('never returns an empty label for any node kind', () => {
    const declined: GraphNode = { kind: 'declined', id: 'x', name: 'x', vendorId: null, date: null, scan: null, why: null }
    const refused: GraphNode = { kind: 'refused', id: 'y', name: 'y', vendorId: null, date: null, blockingFinding: null }
    for (const node of [declined, refused]) expect(ariaLabelFor(node).length).toBeGreaterThan(0)
  })
})
