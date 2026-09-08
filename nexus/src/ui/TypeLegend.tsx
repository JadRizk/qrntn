// ui/TypeLegend.tsx — a panel toggling whole node TYPES on and off, mirroring
// ../nexus's showcase demo (NexusCyberdeck.tsx's "/// entity class" panel) —
// same Panel/SectionHeading/ToggleRow/Glyph primitives from the vendored
// @nexus/react, not hand-rolled markup.
//
// Owns its Panel but not its position: it used to hardcode `absolute top-left`,
// which is exactly what left no room for a second or third panel. ui/LeftDock.tsx
// places it now.
//
// Node colour is per kind (data/taxonomy.ts's NODE_KIND_COLOR) precisely so
// this legend means something — a swatch names one colour, and a colour that
// varied per domain category couldn't be toggled as a single row.

import { Glyph, Panel, SectionHeading, ToggleRow } from '@nexus/react'
import type { NodeKind } from '../data/taxonomy.ts'
import { ENGINE_SHAPE_NAME, KIND_LABEL, KIND_ORDER, NODE_KIND_COLOR, NODE_TAXONOMY } from '../data/taxonomy.ts'

export interface TypeLegendProps {
  counts: Record<NodeKind, number>
  hiddenKinds: ReadonlySet<NodeKind>
  onToggle: (kind: NodeKind) => void
}

export function TypeLegend(props: TypeLegendProps) {
  const { counts, hiddenKinds, onToggle } = props

  return (
    <Panel>
      <SectionHeading>/// entity types</SectionHeading>
      {KIND_ORDER.map((kind) => {
        const hidden = hiddenKinds.has(kind)
        const count = counts[kind]
        return (
          <ToggleRow
            key={kind}
            checked={!hidden}
            onChange={() => onToggle(kind)}
            icon={<Glyph shape={ENGINE_SHAPE_NAME[NODE_TAXONOMY[kind].shape]} colour={NODE_KIND_COLOR[kind]} muted={hidden || count === 0} />}
            label={KIND_LABEL[kind]}
            meta={count}
            style={count === 0 ? { opacity: 0.4, pointerEvents: 'none' } : undefined}
          />
        )
      })}
    </Panel>
  )
}
