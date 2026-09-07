// ui/StatsPanel.tsx — the `ui/hud.ts` readout SPEC.md §8 step 8 calls for, on
// GraphCanvas's existing onStats callback (it fires every ~0.5s from the frame
// loop and had no consumer until now).
//
// Last in the left dock, under the two panels you actually steer the view
// with. It briefly lived bottom-right, which put it under DetailsDrawer (fixed,
// full-height, right edge) the moment a node was selected — the same collision
// that drove the controls panel off that corner. In the dock it stays readable
// while the drawer is open.
//
// Owns its Panel but not its position; ui/LeftDock.tsx places it.

import { KeyValue, Panel, SectionHeading } from '@nexus/react'
import type { GraphStats } from '../../packages/graph/src/types.ts'

export interface StatsPanelProps {
  /** Null until the canvas has rendered its first half-second. */
  stats: GraphStats | null
}

export function StatsPanel(props: StatsPanelProps) {
  const { stats } = props

  return (
    <Panel>
      <SectionHeading>/// diagnostics</SectionHeading>
      {stats ? (
        <>
          {/* Both counts come from the engine's own post-filter tallies, not
              one from here and one from there: `entities` used to be counted
              in App from the type filter alone, which ignored isolateId — so
              selecting a node dropped `relations` to its neighbourhood while
              `entities` still claimed the whole unfiltered set, two adjacent
              rows disagreeing about the same view. */}
          <KeyValue label="entities" value={`${stats.drawnNodes}/${stats.nodes}`} />
          <KeyValue label="relations" value={`${stats.drawnEdges}/${stats.edges}`} />
          <KeyValue label="layout" value={stats.settled ? 'settled' : 'solving'} />
          <KeyValue label="fps" value={stats.fps} />
          <KeyValue label="frame" value={`${stats.frameMs}ms`} />
          <KeyValue label="renderer" value={`webgl ${stats.webglVersion}`} />
        </>
      ) : (
        <div style={{ color: 'var(--nx-fg-tertiary)', letterSpacing: 'var(--nx-track-wide)' }}>measuring…</div>
      )}
    </Panel>
  )
}
