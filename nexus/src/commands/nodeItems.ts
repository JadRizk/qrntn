// commands/nodeItems.ts — every graph node as a searchable palette row,
// carrying the exact shape/colour/code ui/TypeLegend.tsx renders for the
// same kind, so a node found through the palette reads as the same object
// found by looking at the canvas.

import { CODE, labelOf } from '../adapt/toGraphCanvas.ts'
import { ENGINE_SHAPE_NAME, NODE_KIND_COLOR, NODE_TAXONOMY } from '../data/taxonomy.ts'
import type { GraphSnapshot } from '../data/types.ts'
import type { NodeItem } from './types.ts'

export function buildNodeItems(snapshot: GraphSnapshot): NodeItem[] {
  return snapshot.nodes.map((n) => ({
    id: n.id,
    kind: 'node',
    nodeId: n.id,
    nodeKind: n.kind,
    label: labelOf(n),
    code: CODE[n.kind],
    shape: ENGINE_SHAPE_NAME[NODE_TAXONOMY[n.kind].shape],
    colour: NODE_KIND_COLOR[n.kind],
  }))
}
