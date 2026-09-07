import type { CSSProperties } from "react";
import type { Viewport } from "./camera.js";

/* ============================================================================
   Public types for @nexus/graph.

   The original NexusCyberdeck.jsx hardcoded one taxonomy (ATLAS/TAG/UNRSLV/
   SOURCE/AGENT/NODE, refs/cites/tagged/mentions/contradicts) directly into
   the engine via module-global `NODE_TYPES`/`LINK_TYPES` lookup tables keyed
   by a `.type` string. Everything here replaces that with a generic
   category system: nodes/edges carry a `categoryId`, and the caller supplies
   `nodeCategories`/`linkCategories` maps describing how each category looks
   and behaves. The showcase's ATLAS/TAG/etc. vocabulary becomes sample data
   built from these types, not part of the package.
   ========================================================================== */

/** Index into the six SDF node shapes the shader supports — same order @nexus/react's `GLYPH_SHAPES` uses (circle, hexagon, diamond, ring, square, triangle). */
export type GlyphShapeIndex = 0 | 1 | 2 | 3 | 4 | 5;

/** 0=DORMANT · 1=STABLE · 2=HOT (breathing/flicker in the node shader) · 3=ORPHAN (dimmed). */
export type NodeState = 0 | 1 | 2 | 3;
export const STATE_LABEL = ["DORMANT", "STABLE", "HOT", "ORPHAN"] as const;
/** A node with zero edges is always displayed as ORPHAN, regardless of its declared state — derived from graph structure the engine already computes, not something the caller needs to set by hand. */
export const ORPHAN_STATE: NodeState = 3;

/** Zoom level at which each label tier (0-3) starts earning screen space in `labelMode: "auto"`. Tier 0 is always drawn. */
export const TIER_ZOOM = [0, 1.0, 1.8, 3.0] as const;

export interface GraphNode<T = unknown> {
  id: string | number;
  categoryId: string;
  /** Display text — on-screen label, hover tooltip, inspector title. */
  label: string;
  state?: NodeState;
  /** Opaque consumer payload. Never read internally; round-tripped through onSelect/getNode. */
  data?: T;
}

export interface GraphEdge<T = unknown> {
  a: GraphNode["id"];
  b: GraphNode["id"];
  categoryId: string;
  /**
   * Marks an endpoint that is declared but has nothing behind it. The trace
   * frays out toward that end and lands on no pad, so the gap reads on the
   * *link* rather than only on the far glyph.
   *
   * Named for the graph-level fact, not the domain's word for it: the engine
   * has no notion of a "ghost". Deliberately not "unresolved", which this file
   * already uses for the different and much duller case of an endpoint id
   * matching no node at all — those edges are dropped, not drawn.
   */
  absentEnd?: "a" | "b";
  data?: T;
}

export interface NodeCategory {
  /** Display name, e.g. "ATLAS". Not read internally — a consumer's own legend UI is the only reason this lives here rather than in a second parallel lookup. */
  label: string;
  shape: GlyphShapeIndex;
  /** Real hex — GPU-bound (Three.js `Color` parsing), can't be a CSS custom property. */
  color: string;
  /** Short class code shown in the hover tooltip, e.g. "ATL". */
  code: string;
  size: number;
  charge: number;
  mass: number;
  /** Label-visibility tier (0-3); see `TIER_ZOOM`. */
  tier: number;
  /** Radians. When set, every node of this category feels a gentle tangential pull toward this angle from the origin — see `PhysicsConfig.sectorForce` and `physics.ts`'s `PhysicsNode.sectorAngle`. Undefined means this category has no arm/sector affinity. */
  sectorAngle?: number;
  /** World units. When set, every node of this category feels a radial spring toward this distance from the origin, in place of ordinary gravity — see `PhysicsConfig.radiusForce` and `physics.ts`'s `PhysicsNode.radiusTarget`. Undefined means this category keeps ordinary gravity-to-origin. */
  radiusTarget?: number;
}

/**
 * How an edge is drawn between its two endpoints. Form is a channel in its own
 * right: giving each register its own routing means weight does not have to
 * carry the distinction, which is what lets every kind stay thin.
 *
 * - `straight` — a plain chord.
 * - `arc` — a shallow bow through open space, bowed by `curve`.
 * - `etched` — axis, 45 degrees, axis, like a circuit trace. No 90 degree
 *   corner appears anywhere in the route, and the diagonal shrinks
 *   continuously to zero as the chord approaches 45 degrees, so a route never
 *   pops sides while the solver is moving a node.
 */
export type LinkRouting = "straight" | "arc" | "etched";

export interface LinkCategory {
  /** Display name, e.g. "LINK". Not read internally — same status as NodeCategory.label. */
  label: string;
  color: string;
  /** Half-width of the drawn conductor, in CSS px. Constant: it never changes with hover or selection. */
  width: number;
  /** Rest distance, as a multiplier of `PhysicsConfig.linkDistance`. */
  dist: number;
  strength: number;
  /**
   * Intensity multiplier for this category, folded into `OpticsConfig.edgeOpacity`.
   * This is the channel that separates a structural scaffold from a semantic
   * claim, so that both can stay the same width. Defaults to 1.
   *
   * Not a coverage alpha, and not bounded at 1: what a usable value looks like
   * depends on how much of a dim edge the CRT composite leaves behind, which
   * is a thing to measure rather than to reason about.
   */
  gain?: number;
  /** Dash period in SCREEN pixels — constant at any zoom. 0 or absent draws an unbroken conductor. */
  dash?: number;
  /** Path the edge takes between its endpoints. Defaults to `"straight"`. */
  routing?: LinkRouting;
  /** Packet-flow speed/direction along the edge; negative reverses direction. 0 disables the flow animation. */
  flow?: number;
  /** Bow amount for `routing: "arc"`. Ignored by the other two routings. */
  curve?: number;
  /** Jitter amount for the "contradicts"-style unstable-edge look. */
  jit?: number;
}

export interface PhysicsConfig {
  repulsion: number;
  linkDistance: number;
  gravity: number;
  damping: number;
  cursorForce: number;
  /** Strength of each node's pull toward its category's `sectorAngle`, if it has one. 0 disables the effect outright. */
  sectorForce: number;
  /** Strength of each node's pull toward its category's `radiusTarget`, if it has one. 0 disables the effect outright (falls back to ordinary gravity for every node, targeted or not). */
  radiusForce: number;
  /** Alpha target the solver simmers toward; 0 lets it settle to rest. */
  settle: number;
}

export interface OpticsConfig {
  /** Node glow intensity. */
  glow: number;
  /** Frame-persistence trail amount, 0-1. */
  trails: number;
  edgeOpacity: number;
  edgeWidth: number;
  flowSpeed: number;
  /** CRT scanline intensity. */
  scan: number;
  /** Chromatic aberration amount. */
  aberr: number;
  /** Barrel curvature; 0 disables the warp entirely. */
  curve: number;
  grain: number;
  bloom: number;
  glitch: number;
}

export interface GraphNodeSnapshot {
  id: GraphNode["id"];
  categoryId: string;
  label: string;
  /** Deterministic 4-hex-digit display id derived from the node's index. */
  hex: string;
  state: (typeof STATE_LABEL)[number];
  degree: number;
  /** Adjacent nodes, grouped by link category id — mirrors the original inspector's "adjacency" list. */
  groups: ReadonlyArray<{
    categoryId: string;
    rows: ReadonlyArray<{ id: GraphNode["id"]; label: string; categoryId: string; out: boolean }>;
  }>;
}

/**
 * Live per-frame geometry, for a consumer that needs to place its own DOM
 * over the canvas in sync with it — an accessible focus overlay, say. Every
 * array is a reference GraphCanvas keeps reusing frame to frame: read the
 * values synchronously inside the onFrame callback, never retain the
 * array itself past that call.
 */
export interface FrameGeometry {
  /** Node ids, dense-index order — positions/hidden/radii are parallel to this. */
  ids: ReadonlyArray<GraphNode["id"]>;
  /** [x0, y0, x1, y1, ...], world space. */
  positions: Float32Array;
  /** 1 = hidden by isolate or a hiddenNodeCategories filter, 0 = visible. */
  hidden: Float32Array;
  /** World-space node radius, parallel to ids. */
  radii: Float32Array;
  camera: { x: number; y: number; zoom: number };
  viewport: Viewport;
}

export interface GraphStats {
  fps: number;
  /** Every node in the graph, filtered or not. */
  nodes: number;
  edges: number;
  /** Nodes surviving `hiddenNodeCategories` *and* `isolateId` — the count actually on screen, the node-side counterpart of `drawnEdges`. A consumer can't derive this from its own filter state: isolate is resolved here, against adjacency only the engine holds. */
  drawnNodes: number;
  drawnEdges: number;
  frameMs: number;
  settled: boolean;
  vertexAttribs: number;
  webglVersion: 1 | 2;
}

/**
 * Screen-edge padding, in CSS pixels, that fit-to-view keeps the graph clear
 * of. For a consumer whose own chrome *floats over* the canvas rather than
 * taking layout space beside it: the canvas is still full-bleed (that's the
 * point — you can pan the graph underneath a HUD panel), but the framing the
 * camera chooses on its own shouldn't park nodes where a panel covers them.
 */
export interface FitInset {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface GraphController {
  /** Frames the camera to fit every currently-visible node. */
  fit(): void;
  focus(id: GraphNode["id"]): void;
  /** Nudges the solver back above rest; `v` is the alpha floor (default matches the original UI's Reheat button). */
  reheat(v?: number): void;
  /** Re-randomizes node positions and re-runs the layout from scratch. */
  reseed(): void;
  getNode(id: GraphNode["id"]): GraphNodeSnapshot | null;
}

export interface GraphCanvasProps {
  nodes: readonly GraphNode[];
  edges: readonly GraphEdge[];
  nodeCategories: Record<string, NodeCategory>;
  linkCategories: Record<string, LinkCategory>;
  physics?: Partial<PhysicsConfig>;
  optics?: Partial<OpticsConfig>;
  labelMode?: "auto" | "key" | "all" | "off";
  /** Category ids to hide. Replaces the original's imperative `nodeOn`/`refilter()` — this is a controlled prop instead. */
  hiddenNodeCategories?: readonly string[];
  hiddenLinkCategories?: readonly string[];
  /** When set, only this node and its immediate neighbours are shown. */
  isolateId?: GraphNode["id"] | null;
  /** Currently selected node, controlled — mirrors `isolateId`. The canvas notifies clicks via `onSelect`; the consumer owns the actual state (same pattern the original's own `useEffect(() => api.current.select(...), [selected])` already implied, just made explicit as a controlled prop instead of an imperative-only sync). */
  selectedId?: GraphNode["id"] | null;
  /** Pauses the physics solver (dragging still works) when false. Default true. */
  running?: boolean;
  /** Edges the consumer's own floating chrome covers, in CSS pixels — `fit()` and the auto-fit sweep frame the graph into what's *left* instead of into the whole canvas. Omitted sides are 0. Changing it re-frames, but only while the camera still belongs to the auto-fit: once the reader has panned or zoomed by hand, their framing is theirs and a panel opening must not yank it back. */
  fitInset?: Partial<FitInset>;

  /** Fires when the user clicks a node (or clicks empty space, with `null`) — update `selectedId` in response. */
  onSelect?: (node: GraphNodeSnapshot | null) => void;
  /** Fires every rendered frame with live position/camera geometry — for a consumer syncing its own DOM to the canvas (an accessible focus overlay). Read synchronously; the arrays are reused, not reallocated, next frame. */
  onFrame?: (geometry: FrameGeometry) => void;
  onStats?: (stats: GraphStats) => void;
  /** Called once if WebGL setup throws — the canvas renders nothing further after this. */
  onFatal?: (message: string) => void;
  className?: string;
  style?: CSSProperties;
}
