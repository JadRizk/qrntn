// ui/LeftDock.tsx — the left column the graph console's HUD panels stack in.
//
// Replaces the previous arrangement, where each panel hardcoded its own corner
// (TypeLegend top-left, the controls panel bottom-right) and none knew about
// the others. Two things that cost: a third panel had nowhere to go, and the
// controls panel sat exactly where DetailsDrawer slides in — so selecting a
// node, the moment you most want Fit, buried Fit.
//
// Still floating (position: absolute) over the canvas rather than a flex
// sibling, for the reason TypeLegend's own header already gave: HUD chrome you
// can pan the graph underneath, not a boundary the canvas has to reserve space
// for. What's new is that the canvas is now *told* how much of its left edge is
// covered (App.tsx's fitInset -> GraphCanvas.applyFit), so auto-fit frames the
// graph into the free part instead of centring it under the dock.

import type { ReactNode } from 'react'

/** The column's width. Exported because App.tsx feeds it straight back to the
 *  canvas as its left fitInset — the number has to be one number, not a
 *  constant here and a duplicate there. */
export const DOCK_WIDTH = 210

export interface LeftDockProps {
  children: ReactNode
}

export function LeftDock({ children }: LeftDockProps) {
  return (
    <div
      className="nx-dock"
      style={{
        position: 'absolute',
        top: 'var(--nx-space-5)',
        left: 'var(--nx-space-5)',
        width: DOCK_WIDTH,
        maxHeight: 'calc(100% - var(--nx-space-7))',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--nx-space-3)',
      }}
    >
      {children}
    </div>
  )
}
