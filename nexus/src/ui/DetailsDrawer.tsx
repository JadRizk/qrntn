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

import { useMemo } from 'react'
import { Drawer, SectionHeading } from '@nexus/react'
import type { GraphNodeSnapshot, LinkCategory } from '../../packages/graph/src/types.ts'
import type { EdgeRecord, GraphNode } from '../data/types.ts'
import { RecordSections } from './RecordSections.tsx'

export interface DetailsDrawerProps {
  open: boolean
  node: GraphNodeSnapshot | null
  /** The same node from the loaded snapshot — the skill's own fields, which the engine's snapshot does not carry. */
  record: GraphNode | null
  lookup: (id: string) => GraphNode | undefined
  onRead?: ((skillId: string, path: string) => void) | undefined
  linkCategories: Record<string, LinkCategory>
  /**
   * The snapshot's own edges, because the engine's per-row payload carries
   * only an endpoint and a direction — enough to draw a list, not enough to
   * say what the edge holds. Two things live on an EdgeRecord and were
   * reachable from nowhere in the app until now: the `note` a person wrote in
   * edges.json when they declared the relationship, and the `weight` an
   * `overlaps` edge carries. The second is the one that makes the measured
   * layer honest — a violet arc drawn for each skill's nearest coverer looks
   * identical at 12% and at 2%, and the number is the whole difference
   * between "read these two" and "these two happen to share a word".
   */
  edges: readonly EdgeRecord[]
  onClose: () => void
}

/** engineCategoryId's own prefix convention (adapt/toGraphCanvas.ts) — every kind but declined/refused/ghost mints `kind:id`; those three are the bare kind name with no colon at all. Splitting on the first ':' recovers the kind either way, without a second lookup table just for display. */
function kindOf(categoryId: string): string {
  const i = categoryId.indexOf(':')
  return i < 0 ? categoryId : categoryId.slice(0, i)
}

export function DetailsDrawer(props: DetailsDrawerProps) {
  const { open, node, record, lookup, onRead, linkCategories, edges, onClose } = props

  // kind|from|to. The engine's group categoryId IS the domain edge kind
  // (adapt/toGraphCanvas.ts sets `categoryId: e.kind`), and a row's direction
  // recovers the ordered pair, so the three together address exactly one
  // record — no pair-wise search, and no collapsing of two kinds that join the
  // same two nodes.
  const annotations = useMemo(() => {
    const by = new Map<string, EdgeRecord>()
    for (const e of edges) by.set(`${e.kind}|${e.from}|${e.to}`, e)
    return by
  }, [edges])

  return (
    <Drawer open={open} onClose={onClose} title={node?.label ?? ''} subtitle={node ? `${kindOf(node.categoryId)} · degree ${node.degree}` : undefined}>
      {/* Records first, edges after: what a skill is and whether its bytes
          still match the ledger is what a reader opened the drawer for;
          the edge list is what the canvas already shows. */}
      <RecordSections node={record} lookup={lookup} onRead={onRead} />
      {node && node.groups.length === 0 && (
        <div style={{ color: 'var(--nx-fg-tertiary)', letterSpacing: 'var(--nx-track-wide)' }}>No connections</div>
      )}
      {node?.groups.map((group) => {
        const spec = linkCategories[group.categoryId]
        return (
          <div key={group.categoryId} style={{ marginBottom: 'var(--nx-space-4)' }}>
            <SectionHeading style={{ color: spec?.color }}>{spec?.label ?? group.categoryId}</SectionHeading>
            {group.rows.map((row) => {
              const annotation = annotations.get(
                `${group.categoryId}|${row.out ? node.id : row.id}|${row.out ? row.id : node.id}`,
              )
              return (
                <div key={`${row.out ? 'out' : 'in'}:${row.id}`} style={{ padding: 'var(--nx-space-1) 0' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--nx-space-2)' }}>
                    <span aria-hidden="true" style={{ color: 'var(--nx-fg-tertiary)' }}>{row.out ? '→' : '←'}</span>
                    <span style={{ color: 'var(--nx-fg-default)' }}>{row.label}</span>
                    {/* Rounded to a whole percent. The measure is a ratio over
                        a handful of descriptions and a second decimal would be
                        precision the corpus does not have. */}
                    {annotation?.weight != null && (
                      <span style={{ marginLeft: 'auto', color: 'var(--nx-fg-tertiary)' }}>{`${Math.round(annotation.weight * 100)}%`}</span>
                    )}
                  </div>
                  {/* The note, which until now reached no screen at all: on a
                      declared edge it is the sentence someone wrote when they
                      argued for the relationship, and on a measured one the
                      terms driving the score. Both are the same job — the
                      number says read these two, this says where to look. */}
                  {annotation?.note && (
                    <div
                      style={{
                        color: 'var(--nx-fg-tertiary)',
                        fontSize: 'var(--nx-text-2xs)',
                        paddingLeft: 'var(--nx-space-5)',
                      }}
                    >
                      {annotation.note}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )
      })}
    </Drawer>
  )
}
