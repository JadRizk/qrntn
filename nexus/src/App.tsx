import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CommandPalette, HazardRule, Panel, useHotkey } from '@nexus/react'
import { DEFAULT_OPTICS, DEFAULT_PHYSICS, GraphCanvas } from '../packages/graph/src/index.ts'
import { loadGraph } from './data/loadGraph.ts'
import { categoryIdsByKind, toGraphCanvasProps } from './adapt/toGraphCanvas.ts'
import { createDomOverlay, type DomOverlay } from './a11y/domOverlay.ts'
import { useCommandActions, useRegisteredActions } from './commands/CommandContext.tsx'
import { ActionIcon } from './commands/icons.tsx'
import { buildNodeItems } from './commands/nodeItems.ts'
import type { ActionItem, CommandItem } from './commands/types.ts'
import { ControlsPanel } from './ui/ControlsPanel.tsx'
import { TypeLegend } from './ui/TypeLegend.tsx'
import { StatsPanel } from './ui/StatsPanel.tsx'
import { DetailsDrawer } from './ui/DetailsDrawer.tsx'
import { DOCK_WIDTH, LeftDock } from './ui/LeftDock.tsx'
import { PratiqWordmark } from './ui/PratiqWordmark.tsx'
import type { GraphSnapshot } from './data/types.ts'
import { KIND_LABEL, KIND_ORDER, type NodeKind } from './data/taxonomy.ts'
import type { FrameGeometry, GraphController, GraphNodeSnapshot, GraphStats, OpticsConfig, PhysicsConfig } from '../packages/graph/src/types.ts'

// The vendored engine's own DEFAULT_PHYSICS leaves sectorForce/radiusForce
// at 0 (inert — a generic consumer that never sets a category's
// sectorAngle/radiusTarget shouldn't see any behavior change). This app's
// every node *does* carry both (adapt/toGraphCanvas.ts), so Nexus's own
// resting default turns the bias on — the category-hub/skill-arm/
// document-orbit structure should be what you see on first load, not a
// slider you have to discover. Fixed — the app exposes no physics controls.
const physics: PhysicsConfig = { ...DEFAULT_PHYSICS, sectorForce: 0.06, radiusForce: 0.05 }

// The real, hand-authored skill relationships (edges.json) are the one thing
// deliberately hidden until you select the one skill they belong to — see
// the module header on why (a default view trying to show category
// structure AND every relationship at once was unreadable). Module-level,
// not inline in JSX: GraphCanvas's own refilter effect is keyed by array
// *identity* (hiddenNodeCategories/hiddenLinkCategories/isolateId), so a
// fresh array literal on every App render would re-run it for no reason —
// same reasoning hiddenNodeCategories below is already useMemo'd for.
const HIDDEN_RELATIONSHIP_KINDS: readonly string[] = ['operative', 'referential', 'alternative']
const EMPTY_LINK_CATEGORIES: readonly string[] = []

// DetailsDrawer's own width, plus the --nx-space-5 it insets from the right
// edge and the same again as breathing room — how much of the canvas's right
// side is covered while a node is selected. Duplicated from @nexus/react's
// Drawer default rather than measured: the drawer *slides*, so a measured
// width would arrive mid-transition and drag the camera along with it.
const DRAWER_INSET = 296 + 12 + 12
// ui/LeftDock.tsx's own --nx-space-5 offset from the left edge, counted twice:
// once for the gutter the dock sits in, once so the graph doesn't press right
// up against it.
const DOCK_INSET = DOCK_WIDTH + 12 * 2

export function App() {
  const [snapshot, setSnapshot] = useState<GraphSnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [selectedNode, setSelectedNode] = useState<GraphNodeSnapshot | null>(null)
  const [optics, setOptics] = useState<OpticsConfig>(DEFAULT_OPTICS)
  // vendor/declined/refused/ghost start hidden — provenance/trust-signal
  // nodes that don't belong to the default category tree and would just
  // compete for space with it. One click each in the legend brings any of
  // them back; nothing here is deleted, only not shown by default.
  const [hiddenKinds, setHiddenKinds] = useState<ReadonlySet<NodeKind>>(
    () => new Set<NodeKind>(['vendor', 'declined', 'refused', 'ghost']),
  )

  // The diagnostics readout. onStats fires ~2x/second, so this re-renders App
  // at 2Hz — cheap, because every memo below is keyed on values that don't
  // change with it and GraphCanvas reads its callbacks through refs.
  const [stats, setStats] = useState<GraphStats | null>(null)
  const onStats = useCallback((next: GraphStats) => setStats(next), [])

  const overlayContainerRef = useRef<HTMLDivElement>(null)
  const overlayRef = useRef<DomOverlay | null>(null)
  const controllerRef = useRef<GraphController>(null)

  useEffect(() => {
    loadGraph()
      .then(setSnapshot)
      .catch((err: unknown) => setError(String(err instanceof Error ? err.message : err)))
  }, [])

  const canvasProps = useMemo(() => (snapshot ? toGraphCanvasProps(snapshot) : null), [snapshot])

  const idsByKind = useMemo(() => (snapshot ? categoryIdsByKind(snapshot) : null), [snapshot])
  const kindCounts = useMemo(() => {
    const counts: Record<NodeKind, number> = { origin: 0, category: 0, skill: 0, leaf: 0, scriptFold: 0, vendor: 0, declined: 0, refused: 0, ghost: 0 }
    if (snapshot) for (const n of snapshot.nodes) counts[n.kind]++
    return counts
  }, [snapshot])
  const hiddenNodeCategories = useMemo(() => {
    if (!idsByKind) return []
    return [...hiddenKinds].flatMap((kind) => idsByKind[kind])
  }, [idsByKind, hiddenKinds])
  const hiddenLinkCategories = useMemo(
    () => (selectedId === null ? HIDDEN_RELATIONSHIP_KINDS : EMPTY_LINK_CATEGORIES),
    [selectedId],
  )

  useEffect(() => {
    const container = overlayContainerRef.current
    if (!snapshot || !container) return
    const overlay = createDomOverlay(container, snapshot, setSelectedId)
    overlayRef.current = overlay
    return () => {
      overlay.dispose()
      overlayRef.current = null
    }
  }, [snapshot])

  const onFrame = useCallback((geometry: FrameGeometry) => {
    overlayRef.current?.sync(geometry)
  }, [])

  // The wordmark's "go home" action, for a single-view app: clear whatever
  // is selected and fit the (visible) graph back into frame, same as
  // landing on the app fresh.
  const goHome = useCallback(() => {
    setSelectedId(null)
    controllerRef.current?.fit()
  }, [])

  // Camera follows selection: zoom to the selected node, zoom back out to
  // fit the whole (visible) graph the moment nothing is selected. Skipped
  // on the very first render (selectedId starts null, and there's nothing
  // to fit to yet — GraphCanvas's own intro sweep owns that framing).
  const isFirstSelectionRef = useRef(true)
  useEffect(() => {
    if (isFirstSelectionRef.current) {
      isFirstSelectionRef.current = false
      return
    }
    if (selectedId !== null) controllerRef.current?.focus(selectedId)
    else controllerRef.current?.fit()
  }, [selectedId])

  // The drawer's content follows selectedId too, from whichever path set it
  // — a canvas click (GraphCanvas's own onSelect, below, already hands over
  // a full snapshot, but the DOM overlay's keyboard activation and Escape
  // only ever have an id, so one lookup here covers every path instead of
  // threading a getNode() call through each of them separately.
  useEffect(() => {
    setSelectedNode(selectedId === null ? null : (controllerRef.current?.getNode(selectedId) ?? null))
  }, [selectedId])

  const toggleKind = useCallback((kind: NodeKind) => {
    setHiddenKinds((prev) => {
      const next = new Set(prev)
      if (next.has(kind)) next.delete(kind)
      else next.add(kind)
      return next
    })
  }, [])

  // What the canvas's auto-fit must frame *around*. The dock's width is
  // measured rather than assumed (a collapsed window is only as wide as its
  // label), and the drawer's is a constant — see DRAWER_INSET on why measuring
  // a sliding panel would be worse than not.
  //
  // Ordering note for the right side: selecting a node changes this inset and
  // calls focus() in the same commit. GraphCanvas's re-frame effect is a
  // child's, so it runs first, and the focus() below lands last and wins.
  const fitInset = useMemo(
    () => ({ left: DOCK_INSET, right: selectedId !== null ? DRAWER_INSET : 0 }),
    [selectedId],
  )

  const reseed = useCallback(() => {
    setSelectedId(null)
    controllerRef.current?.reseed()
  }, [])

  // Command palette (mod+k) — §"structure for cmdK actions": a scoped
  // registry (commands/CommandContext.tsx) rather than one hardcoded list,
  // so a future second page can register its own actions the same way this
  // single view registers 'global' (app-wide, always live) and 'graph'
  // (this view's own fit/reseed/filter). Node search rides the same list —
  // a node found this way is exactly what clicking it in the canvas does.
  const [paletteOpen, setPaletteOpen] = useState(false)
  const togglePalette = useCallback(() => setPaletteOpen((o) => !o), [])
  useHotkey('mod+k', togglePalette)

  const globalActions = useMemo<ActionItem[]>(() => [
    { id: 'action:home', kind: 'action', icon: 'home', label: 'Go home', run: goHome },
  ], [goHome])
  useCommandActions('global', globalActions)

  const graphActions = useMemo<ActionItem[]>(() => [
    { id: 'action:fit', kind: 'action', icon: 'fit', label: 'Fit to view', run: () => controllerRef.current?.fit() },
    { id: 'action:reseed', kind: 'action', icon: 'reseed', label: 'Reseed layout', run: reseed },
    ...KIND_ORDER.map((kind): ActionItem => ({
      id: `action:filter:${kind}`,
      kind: 'action',
      icon: 'filter',
      label: hiddenKinds.has(kind) ? `Show ${KIND_LABEL[kind]}` : `Hide ${KIND_LABEL[kind]}`,
      run: () => toggleKind(kind),
    })),
  ], [reseed, hiddenKinds, toggleKind])
  useCommandActions('graph', graphActions)

  const nodeItems = useMemo(() => (snapshot ? buildNodeItems(snapshot) : []), [snapshot])
  const registeredActions = useRegisteredActions()
  const paletteItems = useMemo<CommandItem[]>(() => [...registeredActions, ...nodeItems], [registeredActions, nodeItems])

  const onCommandSelect = useCallback((item: CommandItem) => {
    if (item.kind === 'action') item.run()
    else {
      // The palette lists every node, including kinds the legend has toggled
      // off (vendor/declined/refused/ghost are off by default) — searching is
      // exactly how you reach something you can't currently see, so filtering
      // those rows out would be the wrong fix. What can't stand is selecting
      // one and having the camera fly to a node that is never drawn: focus()
      // pans and zooms to it while refilter() still hides it. So picking a
      // hidden node reveals its kind, and the legend's toggle flips on to say
      // so. Kinds already visible are left untouched (same Set identity, no
      // re-filter).
      setHiddenKinds((prev) => {
        if (!prev.has(item.nodeKind)) return prev
        const next = new Set(prev)
        next.delete(item.nodeKind)
        return next
      })
      setSelectedId(item.nodeId)
    }
    setPaletteOpen(false)
  }, [])

  if (error) {
    return (
      <div style={{ padding: 24, font: '13px ui-monospace, monospace', color: '#FF6A3D' }}>
        graph.json failed to load — {error}
      </div>
    )
  }
  if (!snapshot || !canvasProps) {
    return <div style={{ padding: 24, font: '13px ui-monospace, monospace', color: '#7A8878' }}>loading graph…</div>
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', width: '100vw', height: '100vh' }}>
      {/* skip link — first tab stop, WCAG 2.4.1 */}
      <a href="#main" className="nx-skip">Skip to content</a>

      <CommandPalette<CommandItem>
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        items={paletteItems}
        onSelect={onCommandSelect}
        placeholder="ACTIONS & NODES"
        renderIcon={(item) => (item.kind === 'action' ? <ActionIcon name={item.icon} size={10} /> : null)}
      />

      {/* Real flex sibling, not a floating panel: unlike TypeLegend/Sidebar
          (optional HUD chrome the canvas paints underneath), this is a hard
          boundary the graph console must reserve layout space above —
          matching the design system showcase's own Shell header
          (../Nexus/apps/showcase/src/App.tsx). */}
      <Panel corners="none" padded={false} style={{ flexShrink: 0, border: 0 }}>
        <div style={{
          display: 'flex', alignItems: 'center',
          padding: 'var(--nx-space-4) var(--nx-space-6)', flexWrap: 'wrap', gap: 'var(--nx-space-4)',
        }}>
          <button
            type="button"
            onClick={goHome}
            aria-label="Go to home"
            style={{ display: 'flex', background: 'none', border: 0, padding: 0, margin: 0, cursor: 'pointer' }}
          >
            <PratiqWordmark size="1.5rem" />
          </button>
        </div>
        <HazardRule />
      </Panel>

      {/* The graph console's own relative/overlay bounds — TypeLegend and
          Sidebar's `position: absolute` offsets are relative to this box,
          so they land in the remaining viewport under the navbar rather
          than under it. */}
      <main id="main" style={{ position: 'relative', flex: 1, minHeight: 0 }}>
        <GraphCanvas
          ref={controllerRef}
          {...canvasProps}
          physics={physics}
          optics={optics}
          hiddenNodeCategories={hiddenNodeCategories}
          hiddenLinkCategories={hiddenLinkCategories}
          isolateId={selectedId}
          selectedId={selectedId}
          fitInset={fitInset}
          onSelect={(node) => setSelectedId(node ? String(node.id) : null)}
          onFrame={onFrame}
          onStats={onStats}
          style={{ width: '100%', height: '100%' }}
        />
        <div
          ref={overlayContainerRef}
          role="group"
          aria-label="Skills collection graph"
          onKeyDown={(ev) => {
            if (ev.key === 'Escape') setSelectedId(null)
          }}
          style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
        />
        <LeftDock>
          <TypeLegend counts={kindCounts} hiddenKinds={hiddenKinds} onToggle={toggleKind} />
          <ControlsPanel
            optics={optics}
            onOpticsChange={setOptics}
            onFit={() => controllerRef.current?.fit()}
            onReseed={reseed}
          />
          <StatsPanel stats={stats} />
        </LeftDock>
        <DetailsDrawer
          open={selectedId !== null}
          node={selectedNode}
          linkCategories={canvasProps.linkCategories}
          onClose={() => setSelectedId(null)}
        />
      </main>
    </div>
  )
}
