import { describe, expect, it } from 'vitest'
import { buildNodeItems } from './nodeItems.ts'
import { ENGINE_SHAPE_NAME, NODE_KIND_COLOR, NODE_TAXONOMY } from '../data/taxonomy.ts'
import type { GraphNode, GraphSnapshot } from '../data/types.ts'

// One of every kind — same fixture shapes as data/taxonomy.test.ts and
// adapt/toGraphCanvas.test.ts, so this reads as one node per kind rather
// than reinventing a third set of fixtures.
const NODES: GraphNode[] = [
  { kind: 'category', id: 'c', title: 'Category title', blurb: '' },
  { kind: 'skill', id: 's', name: 'skill-name', description: '', category: 'c', origin: 'authored', manualOnly: false, words: 10, refWords: 0, usage: null, files: [], record: { source: null, commit: null, date: null, verdict: null, findings: null, dispositioned: null, reportPath: null, missing: [] }, findings: [] },
  { kind: 'leaf', id: 'l', owner: 's', file: 'f.md', leafKind: 'ref', words: 10 },
  { kind: 'scriptFold', id: 'f', owner: 's', scripts: ['a.sh'] },
  { kind: 'vendor', id: 'v', repo: 'v/repo', url: 'https://example.com', adopted: [] },
  { kind: 'declined', id: 'd', name: 'declined-name', vendorId: null, date: null, scan: null, why: null },
  { kind: 'refused', id: 'r', name: 'refused-name', vendorId: null, date: null, blockingFinding: null },
  { kind: 'ghost', id: 'g', name: 'ghost-name', referencedBy: [] },
]

function snapshot(nodes: GraphNode[]): GraphSnapshot {
  return { nodes, edges: [] }
}

describe('buildNodeItems', () => {
  it('produces one item per node, in snapshot order', () => {
    const items = buildNodeItems(snapshot(NODES))
    expect(items).toHaveLength(NODES.length)
    expect(items.map((it) => it.nodeId)).toEqual(NODES.map((n) => n.id))
  })

  it('every item carries kind "node" and its shape/colour/code match the same kind\'s taxonomy entry — the same visual the graph and TypeLegend already render', () => {
    for (const [item, node] of buildNodeItems(snapshot(NODES)).map((it, i) => [it, NODES[i]!] as const)) {
      expect(item.kind).toBe('node')
      expect(item.shape).toBe(ENGINE_SHAPE_NAME[NODE_TAXONOMY[node.kind].shape])
      expect(item.colour).toBe(NODE_KIND_COLOR[node.kind])
    }
  })

  // App.tsx reads this to reveal a kind the legend has toggled off when one
  // of its nodes is picked — without it, selecting a hidden node focuses the
  // camera on something that is never drawn.
  it('every item carries its own taxonomy kind, not just its id', () => {
    for (const [item, node] of buildNodeItems(snapshot(NODES)).map((it, i) => [it, NODES[i]!] as const)) {
      expect(item.nodeKind).toBe(node.kind)
    }
  })

  it('an empty snapshot produces no items', () => {
    expect(buildNodeItems(snapshot([]))).toEqual([])
  })
})
