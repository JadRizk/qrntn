// a11y/domOverlay.ts — one focusable element per visible domain entity
// (§4, §8 step 6). Not per rendered node: Nexus never models a skill's
// halo as its own node (radiusOf() folds it into the skill's own size —
// see data/taxonomy.ts), so "no separate a11y entry for a halo" (§6) falls
// out of the data model already, with nothing extra to exclude here.
//
// Imperative DOM module, deliberately not React state — same reasoning as
// labelPool.ts's own "DOM mutation only" in SPEC.md §4: GraphCanvas's
// render loop calls sync() every frame via its onFrame callback (packages/
// graph's own extension, added for exactly this), and pushing that through
// React state would mean a re-render at animation-frame rate.
//
// "Synced to the same visible-entity set labels use" (§8 step 6) is read
// here as *structural* visibility — hidden by isolate or a
// hiddenNodeCategories filter (FrameGeometry.hidden) — not the label
// system's own further zoom/tier-based decluttering. A keyboard-only user
// has no way to zoom in before tabbing, so gating tab stops on whichever
// labels currently have text at the current zoom would make entities
// reachable to a sighted mouse user (pan and zoom in) permanently
// unreachable to a keyboard user. Every structurally visible entity gets a
// tab stop; the label layer's own decluttering is a separate, visual-only
// concern.

import type { EdgeRecord, GraphNode as DomainNode, GraphSnapshot } from '../data/types.ts'
import { KIND_ORDER } from '../data/taxonomy.ts'
import { glyphRadiusPx, project } from '../../packages/graph/src/camera.ts'
import type { FrameGeometry } from '../../packages/graph/src/types.ts'

// Tab order is the legend's order, derived rather than restated: this used
// to be a hand-maintained second copy of taxonomy.ts's KIND_ORDER, so
// inserting a kind (or moving `ghost`) meant remembering to edit both, and
// keyboard tab order would silently drift from what the legend shows.
const KIND_RANK: Record<DomainNode['kind'], number> =
  Object.fromEntries(KIND_ORDER.map((k, i) => [k, i])) as Record<DomainNode['kind'], number>

// Deliberately NOT taxonomy.ts's KIND_LABEL, and deliberately not unified
// with it. Those are Title Case legend chips read on their own ('Ghost',
// 'Reference/asset'); these get spoken mid-sentence by a screen reader
// ('foo.md, reference of bar'), so they're lowercase and spelled out —
// 'unresolved reference' says something out loud that 'Ghost' does not.
// Two audiences, two wordings; the *ordering* is shared (KIND_RANK above),
// the phrasing is not.
const A11Y_KIND_LABEL: Record<DomainNode['kind'], string> = {
  origin: 'origin',
  category: 'category',
  skill: 'skill',
  leaf: 'reference',
  scriptFold: 'scripts',
  vendor: 'vendor',
  declined: 'declined candidate',
  refused: 'refused candidate',
  ghost: 'unresolved reference',
}

export function ariaLabelFor(node: DomainNode): string {
  switch (node.kind) {
    case 'origin':
      return `${node.title}, ${A11Y_KIND_LABEL.origin}`
    case 'category':
      return `${node.title}, ${A11Y_KIND_LABEL.category}`
    case 'skill':
      return `${node.name}, ${node.origin} ${A11Y_KIND_LABEL.skill}`
    case 'leaf':
      return `${node.file}, ${A11Y_KIND_LABEL.leaf} of ${node.owner}`
    case 'scriptFold':
      return `${node.scripts.length} scripts, ${node.owner}`
    case 'vendor':
      return `${node.repo}, ${A11Y_KIND_LABEL.vendor}, ${node.adopted.length} adopted`
    case 'declined':
      return `${node.name}, ${A11Y_KIND_LABEL.declined}${node.why ? ` — ${node.why}` : ''}`
    case 'refused':
      return `${node.name}, ${A11Y_KIND_LABEL.refused}${node.blockingFinding ? ` — ${node.blockingFinding}` : ''}`
    case 'ghost': {
      const refs = node.referencedBy.length ? ` — referenced by ${node.referencedBy.join(', ')}` : ''
      return `${node.name}, ${A11Y_KIND_LABEL.ghost}${refs}`
    }
  }
}

export function buildAdjacency(edges: readonly EdgeRecord[]): Map<string, string[]> {
  const adj = new Map<string, Set<string>>()
  const add = (a: string, b: string) => {
    if (!adj.has(a)) adj.set(a, new Set())
    adj.get(a)!.add(b)
  }
  for (const e of edges) {
    if (!e.render) continue // every edge kind sets render:true today (data/types.ts) — kept as a real gate, not a dead check, since a future physics-only kind would need the same exclusion category-clusters-skill once did
    add(e.from, e.to)
    add(e.to, e.from)
  }
  const sorted = new Map<string, string[]>()
  for (const [id, set] of adj) sorted.set(id, [...set].sort())
  return sorted
}

interface Entry {
  el: HTMLButtonElement
  radius: number
  visible: boolean
}

export interface DomOverlay {
  sync: (geometry: FrameGeometry) => void
  dispose: () => void
}

export function createDomOverlay(
  container: HTMLElement,
  snapshot: GraphSnapshot,
  onActivate: (id: string) => void,
): DomOverlay {
  const order = [...snapshot.nodes].sort((a, b) => KIND_RANK[a.kind] - KIND_RANK[b.kind] || a.id.localeCompare(b.id))
  const adjacency = buildAdjacency(snapshot.edges)
  const entries = new Map<string, Entry>()

  function focusAdjacent(fromId: string, dir: 1 | -1) {
    const neighbors = adjacency.get(fromId)
    if (!neighbors || neighbors.length === 0) return
    // Cycle from whichever neighbor currently holds focus, if any — so
    // repeated arrow presses walk the neighbor list instead of bouncing
    // back to the same one every time.
    const active = document.activeElement
    const activeId = active instanceof HTMLElement ? active.dataset['entityId'] : undefined
    const i = activeId ? neighbors.indexOf(activeId) : -1
    const next = neighbors[(i < 0 ? (dir === 1 ? 0 : neighbors.length - 1) : (i + dir + neighbors.length) % neighbors.length)]!
    entries.get(next)?.el.focus()
  }

  for (const node of order) {
    const el = document.createElement('button')
    el.type = 'button'
    el.className = 'nx-entity'
    el.dataset['entityId'] = node.id
    el.setAttribute('aria-label', ariaLabelFor(node))
    el.style.cssText =
      'position:absolute;left:0;top:0;transform:translate3d(-9999px,-9999px,0);' +
      'width:0;height:0;padding:0;margin:0;border:0;background:transparent;' +
      'pointer-events:none;visibility:hidden;'
    el.addEventListener('click', () => onActivate(node.id))
    el.addEventListener('keydown', (ev) => {
      if (ev.key === 'ArrowRight' || ev.key === 'ArrowDown') {
        ev.preventDefault()
        focusAdjacent(node.id, 1)
      } else if (ev.key === 'ArrowLeft' || ev.key === 'ArrowUp') {
        ev.preventDefault()
        focusAdjacent(node.id, -1)
      }
    })
    container.appendChild(el)
    entries.set(node.id, { el, radius: 0, visible: false })
  }

  function sync(geometry: FrameGeometry): void {
    for (let i = 0; i < geometry.ids.length; i++) {
      const id = geometry.ids[i]
      if (typeof id !== 'string') continue
      const entry = entries.get(id)
      if (!entry) continue

      const hidden = (geometry.hidden[i] ?? 0) > 0.5
      if (hidden) {
        if (entry.visible) {
          entry.visible = false
          entry.el.tabIndex = -1
          entry.el.setAttribute('aria-hidden', 'true')
          entry.el.style.visibility = 'hidden'
          entry.el.style.pointerEvents = 'none'
          // A keyboard user's focus can sit on this exact button right as
          // it's hidden — selecting a node now crops the view via isolateId
          // (App.tsx), which can hide whatever was focused before the
          // selection, not just this one. Left alone, focus stays parked on
          // an invisible, unreachable element until the user tabs away.
          if (document.activeElement === entry.el) entry.el.blur()
        }
        continue
      }

      const wx = geometry.positions[i * 2] ?? 0
      const wy = geometry.positions[i * 2 + 1] ?? 0
      const [sx, sy] = project(wx, wy, geometry.camera.zoom, geometry.camera.x, geometry.camera.y, geometry.viewport)
      const r = glyphRadiusPx(geometry.radii[i] ?? 0, geometry.camera.zoom)

      entry.el.style.transform = `translate3d(${(sx - r).toFixed(1)}px,${(sy - r).toFixed(1)}px,0)`
      entry.el.style.width = `${(r * 2).toFixed(1)}px`
      entry.el.style.height = `${(r * 2).toFixed(1)}px`

      if (!entry.visible) {
        entry.visible = true
        entry.el.tabIndex = 0
        entry.el.removeAttribute('aria-hidden')
        entry.el.style.visibility = 'visible'
        // pointer-events stays 'none' even while visible: the canvas's own
        // picking already owns mouse hover/click at this screen position
        // (see module header). A focused-and-activated button still fires
        // `click` from Enter/Space — that dispatch is keyboard-triggered,
        // not a pointer event, so pointer-events:none never blocks it.
      }
    }
  }

  function dispose(): void {
    for (const entry of entries.values()) entry.el.remove()
    entries.clear()
  }

  return { sync, dispose }
}
