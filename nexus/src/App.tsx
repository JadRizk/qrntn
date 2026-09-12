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
import { ReadingPane, type Reading } from './ui/ReadingPane.tsx'
import { DOCK_WIDTH, LeftDock } from './ui/LeftDock.tsx'
import { QrntnWordmark } from './ui/QrntnWordmark.tsx'
import type { FileLink, GraphNode, GraphSnapshot, LeafNode } from './data/types.ts'
import { fileOfLeaf, leafForPath } from './data/leafPath.ts'
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
// The reading pane: wider than the drawer, and the width the graph does not
// need while a file is open (READING-ROOM.html). At the viewer's 12 px mono
// a column is ≈7.2 px, so 560 holds ~66 columns after the gutter and 760
// ~96. Same +12 +12 as the drawer, for the same reason.
const paneWidthFor = (viewport: number) => Math.round(Math.min(760, Math.max(560, viewport * 0.44)))
const PANE_GUTTERS = 12 + 12

// The file a node opens on. A skill reads from its spine; a leaf is one of
// its owner's files; a script fold opens its first script; a declined,
// refused or ghost node has no bytes and the pane shows the row instead.
function readingFor(node: GraphNode, lookup: (id: string) => GraphNode | undefined): Reading | null {
  switch (node.kind) {
    case 'skill': return { nodeId: node.id, path: 'SKILL.md', line: null }
    case 'leaf': {
      const owner = lookup(node.owner)
      const file = owner?.kind === 'skill' ? fileOfLeaf(owner, node) : undefined
      return file ? { nodeId: node.owner, path: file.path, line: null } : null
    }
    case 'scriptFold': {
      const first = node.scripts[0]
      return first ? { nodeId: node.owner, path: `scripts/${first}`, line: null } : null
    }
    case 'declined': case 'refused': case 'ghost': return { nodeId: node.id, path: '', line: null }
    default: return null
  }
}

// `#<skill>/<path>:L<n>` — a line is an address on this machine. Read once
// on load, written on every change; the browser's history is not used.
function readHash(hash: string): Reading | null {
  // A malformed address is no address: a stray `%` must not take the
  // whole viewer down with a URIError thrown from the load effect.
  let decoded: string
  try {
    decoded = decodeURIComponent(hash)
  } catch {
    return null
  }
  const m = /^#([^/]+)\/(.+?)(?::L(\d+))?$/.exec(decoded)
  if (!m) return null
  return { nodeId: m[1] ?? '', path: m[2] ?? '', line: m[3] ? Number(m[3]) : null }
}
function writeHash(r: Reading | null) {
  const next = r && r.path ? `#${encodeURIComponent(r.nodeId)}/${r.path}${r.line ? `:L${r.line}` : ''}` : ''
  if (window.location.hash !== next) history.replaceState(null, '', next || window.location.pathname)
}
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

  // The full node by id, for the drawer's record sections. The engine's own
  // GraphNodeSnapshot carries none of a skill's fields (description, files,
  // record), and widening the vendored engine's type for them would be the
  // wrong seam — one Map over the loaded snapshot instead (READING-ROOM.html).
  const nodesById = useMemo(() => new Map(snapshot?.nodes.map((n) => [n.id, n]) ?? []), [snapshot])
  const lookupNode = useCallback((id: string) => nodesById.get(id), [nodesById])
  const leaves = useMemo(() => (snapshot?.nodes ?? []).filter((n): n is LeafNode => n.kind === 'leaf'), [snapshot])

  // The reading room. Selection stays the single source of truth; the pane
  // is a view of the selected node's bytes, and every interaction below is a
  // change to selectedId plus this. History is the pane's own, walked by
  // alt+← — the URL hash is a read-out, not a router.
  const [reading, setReading] = useState<Reading | null>(null)
  const historyRef = useRef<Reading[]>([])
  const [historyDepth, setHistoryDepth] = useState(0)
  const [viewport, setViewport] = useState(() => window.innerWidth)
  useEffect(() => {
    const on = () => setViewport(window.innerWidth)
    window.addEventListener('resize', on)
    return () => window.removeEventListener('resize', on)
  }, [])
  const paneWidth = paneWidthFor(viewport)

  const reveal = useCallback((node: GraphNode) => {
    // The palette's rule: a node you reach must be drawn, so its kind is
    // revealed if the legend had it off.
    setHiddenKinds((prev) => {
      if (!prev.has(node.kind)) return prev
      const next = new Set(prev)
      next.delete(node.kind)
      return next
    })
  }, [])

  // The current reading, readable without a render: the history push has
  // to happen once per open, and a state updater is not once — StrictMode
  // runs updaters twice, and a push inside one doubled every entry.
  const readingRef = useRef<Reading | null>(null)
  readingRef.current = reading
  const openReading = useCallback((next: Reading | null, push = true) => {
    const prev = readingRef.current
    if (push && prev && (prev.nodeId !== next?.nodeId || prev.path !== next?.path)) {
      historyRef.current = [...historyRef.current.slice(-49), prev]
      setHistoryDepth(historyRef.current.length)
    }
    readingRef.current = next
    setReading(next)
  }, [])

  // A file row in the drawer, or a palette action.
  const readFile = useCallback((skillId: string, path: string) => {
    const owner = lookupNode(skillId)
    if (owner?.kind !== 'skill') return
    // Selection follows the file when the file is a node; else the skill.
    const leaf = leafForPath(leaves, skillId, path)
    if (leaf) reveal(leaf)
    setSelectedId(leaf ? leaf.id : skillId)
    openReading({ nodeId: skillId, path, line: null })
  }, [lookupNode, leaves, reveal, openReading])

  // A link in the pane. Node links select the target and open its primary
  // file; a file link stays in the skill; an anchor scrolls; external and
  // unresolved links do nothing, by design.
  const follow = useCallback((link: FileLink) => {
    if (link.kind === 'node' && link.to) {
      const target = lookupNode(link.to)
      if (!target) return
      reveal(target)
      setSelectedId(target.id)
      openReading(readingFor(target, lookupNode))
    } else if (link.kind === 'file' && link.to && reading) {
      openReading({ nodeId: reading.nodeId, path: link.to, line: null })
    } else if (link.kind === 'anchor' && link.to && reading) {
      const owner = lookupNode(reading.nodeId)
      const file = owner?.kind === 'skill' ? owner.files.find((f) => f.path === reading.path) : undefined
      const anchor = file?.kind === 'text' ? file.anchors.find((a) => a.slug === link.to) : undefined
      if (anchor) setReading({ ...reading, line: anchor.line })
    }
  }, [lookupNode, reveal, openReading, reading])

  const goBack = useCallback(() => {
    const prev = historyRef.current.pop()
    setHistoryDepth(historyRef.current.length)
    if (!prev) return
    const node = lookupNode(prev.nodeId)
    if (node) { reveal(node); setSelectedId(prev.nodeId) }
    openReading(prev, false)
  }, [lookupNode, reveal, openReading])

  const closeReading = useCallback(() => openReading(null, false), [openReading])
  const goToLine = useCallback((line: number) => setReading((r) => (r ? { ...r, line } : r)), [])

  // [ and ] step the open file's pinned findings; alt+← walks history.
  const stepFinding = useCallback((dir: 1 | -1) => {
    if (!reading) return
    const owner = lookupNode(reading.nodeId)
    if (owner?.kind !== 'skill') return
    const lines = owner.findings.filter((f) => f.file === reading.path && f.line !== null).map((f) => f.line as number).sort((a, b) => a - b)
    if (lines.length === 0) return
    const cur = reading.line ?? 0
    const next = dir === 1 ? (lines.find((l) => l > cur) ?? lines[0]) : ([...lines].reverse().find((l) => l < cur) ?? lines[lines.length - 1])
    if (next !== undefined) setReading({ ...reading, line: next })
  }, [reading, lookupNode])
  useHotkey(']', () => stepFinding(1))
  useHotkey('[', () => stepFinding(-1))
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      // The same guard useHotkey applies: alt+← in the palette's input is a
      // caret move, not a step back through the reader.
      const t = e.target as HTMLElement | null
      const typing = !!t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable)
      if (typing) return
      if (e.altKey && e.key === 'ArrowLeft' && historyRef.current.length > 0) { e.preventDefault(); goBack() }
    }
    window.addEventListener('keydown', on)
    return () => window.removeEventListener('keydown', on)
  }, [goBack])

  // The hash on load, once the graph is here — a line is an address. Read
  // before it is ever written: the write-out below runs on the first
  // render too, with nothing open, and would clear the address it was
  // about to honour.
  const hashReadRef = useRef(false)
  useEffect(() => { if (hashReadRef.current) writeHash(reading) }, [reading])
  // A selection made from the hash lands before the engine's intro sweep,
  // which owns the camera until the layout first settles — so the focus()
  // the selection effect issued is swept away. Re-issue it once, on the
  // first settled frame, if the address is still what is open.
  const settledOnceRef = useRef(false)
  useEffect(() => {
    if (!stats?.settled || settledOnceRef.current) return
    settledOnceRef.current = true
    if (selectedId !== null && reading) controllerRef.current?.focus(selectedId)
  }, [stats?.settled, selectedId, reading])
  useEffect(() => {
    if (!snapshot || hashReadRef.current) return
    hashReadRef.current = true
    const r = readHash(window.location.hash)
    const node = r ? nodesById.get(r.nodeId) : undefined
    if (r && node) { reveal(node); setSelectedId(node.id); setReading(r) }
  }, [snapshot, nodesById, reveal])

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

  // Selecting a leaf or a script fold opens the pane straight on the file —
  // the drawer's edge list for a leaf is one row and not worth a stop. A
  // skill keeps the drawer (its files are a click away); clearing the
  // selection closes whatever was open. A selection the pane already shows
  // (a link followed, a row clicked) is left alone.
  useEffect(() => {
    if (selectedId === null) { if (readingRef.current) openReading(null, false); return }
    const node = nodesById.get(selectedId)
    if (!node) return
    const r = readingRef.current
    if (node.kind === 'leaf' || node.kind === 'scriptFold') {
      const next = readingFor(node, lookupNode)
      if (r && next && r.nodeId === next.nodeId && r.path === next.path) return
      openReading(next)
      return
    }
    // A skill or a row: keep the pane only if it is already showing this node.
    if (r && r.nodeId !== selectedId) openReading(null, false)
  }, [selectedId, nodesById, lookupNode, openReading])

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
    () => ({ left: DOCK_INSET, right: reading ? paneWidth + PANE_GUTTERS : selectedId !== null ? DRAWER_INSET : 0 }),
    [selectedId, reading, paneWidth],
  )
  // Opening or closing the pane moves the right inset without moving the
  // selection, so the focus() the selection effect issued framed the node
  // for the drawer's width. Re-issue it for the new width — an explicit
  // focus, so the engine's "a panel must not yank a hand-framed camera"
  // rule (types.ts:245) is honoured by the auto-fit and overridden here
  // only because the reader asked for this node.
  useEffect(() => {
    if (selectedId !== null) controllerRef.current?.focus(selectedId)
  }, [fitInset.right]) // eslint-disable-line react-hooks/exhaustive-deps

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

  // The reading room's own scope: the selected skill's files by name, and
  // the finding steps while a file is open.
  const readerActions = useMemo<ActionItem[]>(() => {
    const items: ActionItem[] = []
    const selected = selectedId ? nodesById.get(selectedId) : undefined
    const skillId = selected?.kind === 'skill' ? selected.id : selected?.kind === 'leaf' || selected?.kind === 'scriptFold' ? selected.owner : null
    const skill = skillId ? nodesById.get(skillId) : undefined
    if (skill?.kind === 'skill') {
      for (const f of skill.files.filter((f) => f.role === 'spine' || f.role === 'audit' || f.role === 'origin')) {
        items.push({ id: `action:read:${skill.id}:${f.path}`, kind: 'action', icon: 'read', label: `Read ${f.path} of ${skill.id}`, run: () => readFile(skill.id, f.path) })
      }
    }
    if (reading) {
      items.push({ id: 'action:finding:next', kind: 'action', icon: 'read', label: 'Next finding', run: () => stepFinding(1) })
      items.push({ id: 'action:finding:prev', kind: 'action', icon: 'read', label: 'Previous finding', run: () => stepFinding(-1) })
      items.push({ id: 'action:reader:close', kind: 'action', icon: 'read', label: 'Close reader', run: closeReading })
    }
    return items
  }, [selectedId, nodesById, reading, readFile, stepFinding, closeReading])
  useCommandActions('reader', readerActions)

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
            <QrntnWordmark size="1.5rem" />
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
          open={selectedId !== null && reading === null}
          node={selectedNode}
          record={selectedId === null ? null : (nodesById.get(selectedId) ?? null)}
          lookup={lookupNode}
          onRead={readFile}
          linkCategories={canvasProps.linkCategories}
          onClose={() => setSelectedId(null)}
        />
        <ReadingPane
          open={reading !== null}
          reading={reading}
          width={paneWidth}
          lookup={lookupNode}
          onClose={closeReading}
          onFollow={follow}
          onGoTo={goToLine}
          canGoBack={historyDepth > 0}
          onBack={goBack}
        />
      </main>
    </div>
  )
}
