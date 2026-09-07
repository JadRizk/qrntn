// ui/ControlsPanel.tsx — the only runtime controls the app exposes (SPEC.md
// §8 step 8 originally specced a full physics/optics tuning surface; that's
// been stripped back to just the three used day-to-day).
//
// Was ui/Sidebar.tsx, floating bottom-right. Renamed and moved into the left
// dock for a concrete reason, not tidiness: DetailsDrawer is `position: fixed`
// down the whole right edge, so selecting a node covered Fit and Reseed
// completely — the controls were unreachable at exactly the moment you'd reach
// for them. Nothing about it was ever a sidebar either.
//
// Owns its Panel but not its position; ui/LeftDock.tsx places it.

import { Button, Panel, SectionHeading } from '@nexus/react'
import type { OpticsConfig } from '../../packages/graph/src/types.ts'

const ABERRATION_VALUE = 0.5

export interface ControlsPanelProps {
  optics: OpticsConfig
  onOpticsChange: (optics: OpticsConfig) => void
  /** Frames the camera to fit every currently-visible node (GraphController.fit()). */
  onFit: () => void
  /** Re-randomizes node positions and re-runs the layout from scratch (GraphController.reseed()). */
  onReseed: () => void
}

export function ControlsPanel(props: ControlsPanelProps) {
  const { optics, onOpticsChange, onFit, onReseed } = props

  return (
    <Panel>
      <SectionHeading>/// controls</SectionHeading>

      <Button
        active={optics.aberr > 0}
        style={{ width: '100%' }}
        onClick={() => onOpticsChange({ ...optics, aberr: optics.aberr > 0 ? 0 : ABERRATION_VALUE })}
      >
        Aberration: {optics.aberr > 0 ? 'On' : 'Off'}
      </Button>

      <div style={{ display: 'flex', gap: 'var(--nx-space-2)', marginTop: 'var(--nx-space-3)' }}>
        <Button style={{ flex: 1 }} onClick={onFit}>
          Fit
        </Button>
        <Button style={{ flex: 1 }} onClick={onReseed}>
          Reseed
        </Button>
      </div>
    </Panel>
  )
}
