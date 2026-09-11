// ui/DetailsDrawer.tsx — right-hand panel for the currently selected node,
// on @nexus/react's existing Drawer (packages/react/src/overlays.tsx),
// unused anywhere in the app until now.
//
// Fed straight from GraphCanvas's own onSelect payload (a GraphNodeSnapshot,
// App.tsx) rather than a fresh getNode() call — the snapshot already carries
// everything this needs, including `.groups`: adjacency grouped by edge
// kind, in a fixed non-empty-groups-only order (packages/graph/src/
// GraphCanvas.tsx's describe()). This is also where a selected skill's real
// operative/referential/alternative relationships actually become visible —
// hidden everywhere else in the default view (App.tsx's hiddenLinkCategories).
//
// Rows render as-is, not filtered against the app's hidden-kind state — a
// selected skill's `adopted`/`considered` edge to a vendor that's hidden by
// default on the canvas should still be discoverable here. The drawer is
// the one place a hidden-by-default relationship is meant to surface.

import { Drawer, SectionHeading } from '@nexus/react'
import type { GraphNodeSnapshot, LinkCategory } from '../../packages/graph/src/types.ts'
import type { GraphNode } from '../data/types.ts'
import { RecordSections } from './RecordSections.tsx'

export interface DetailsDrawerProps {
  open: boolean
  node: GraphNodeSnapshot | null
  /** The same node from the loaded snapshot — the skill's own fields, which the engine's snapshot does not carry. */
  record: GraphNode | null
  lookup: (id: string) => GraphNode | undefined
  linkCategories: Record<string, LinkCategory>
  onClose: () => void
}

/** engineCategoryId's own prefix convention (adapt/toGraphCanvas.ts) — every kind but declined/refused/ghost mints `kind:id`; those three are the bare kind name with no colon at all. Splitting on the first ':' recovers the kind either way, without a second lookup table just for display. */
function kindOf(categoryId: string): string {
  const i = categoryId.indexOf(':')
  return i < 0 ? categoryId : categoryId.slice(0, i)
}

export function DetailsDrawer(props: DetailsDrawerProps) {
  const { open, node, record, lookup, linkCategories, onClose } = props

  return (
    <Drawer open={open} onClose={onClose} title={node?.label ?? ''} subtitle={node ? `${kindOf(node.categoryId)} · degree ${node.degree}` : undefined}>
      {/* Records first, edges after: what a skill is and whether its bytes
          still match the ledger is what a reader opened the drawer for;
          the edge list is what the canvas already shows. */}
      <RecordSections node={record} lookup={lookup} />
      {node && node.groups.length === 0 && (
        <div style={{ color: 'var(--nx-fg-tertiary)', letterSpacing: 'var(--nx-track-wide)' }}>No connections</div>
      )}
      {node?.groups.map((group) => {
        const spec = linkCategories[group.categoryId]
        return (
          <div key={group.categoryId} style={{ marginBottom: 'var(--nx-space-4)' }}>
            <SectionHeading style={{ color: spec?.color }}>{spec?.label ?? group.categoryId}</SectionHeading>
            {group.rows.map((row) => (
              <div
                key={`${row.out ? 'out' : 'in'}:${row.id}`}
                style={{ display: 'flex', alignItems: 'center', gap: 'var(--nx-space-2)', padding: 'var(--nx-space-1) 0' }}
              >
                <span aria-hidden="true" style={{ color: 'var(--nx-fg-tertiary)' }}>{row.out ? '→' : '←'}</span>
                <span style={{ color: 'var(--nx-fg-default)' }}>{row.label}</span>
              </div>
            ))}
          </div>
        )
      })}
    </Drawer>
  )
}
