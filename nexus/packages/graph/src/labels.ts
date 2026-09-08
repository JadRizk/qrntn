/* ============================================================================
   LABELS — placement (not rendering)

   Moved out of GraphCanvas.tsx's `frame()` label block, plus the `labelWidth`
   measurement cache. Decides which nodes earn a label this frame, at what
   screen position, and at what opacity — a placement snapshot, nothing more.
   The DOM pool (which of `POOL` reusable elements shows which label, so
   labels don't flicker between DOM nodes as the placement changes) stays in
   GraphCanvas: it mutates the DOM and nothing else, and consumes this
   module's output rather than being part of the decision.

   Anchored via project(), so a label sits at its node's *drawn* position and
   its gap from the node is a constant number of pixels at any zoom.
   ========================================================================== */

import { glyphRadiusPx, project } from "./camera.js";
import type { Viewport } from "./camera.js";
import { TIER_ZOOM } from "./types.js";

const MONO = 'ui-monospace,"SF Mono",Menlo,Consolas,monospace';

export type LabelMode = "off" | "all" | "key" | "auto";

/** Score bumps that make the hovered/selected node's label always win the collision test, regardless of its earned score. Named for what they do, not what they are — see EXTRACT-PROMPT.md cluster 3. */
const SCORE_HOVER_OVERRIDE = 1e4;
const SCORE_SELECT_OVERRIDE = 2e4;

/** Raw text-measurement, injected: canvas `measureText` in production, a fixed-width stub in tests. Returns the unpadded pixel width of `text` set in `font` — the placer owns the cache and the padding math. */
export type MeasureText = (text: string, font: string) => number;

export interface LabelView {
  count: number;
  /** length count*2, interleaved x,y. */
  pos: Float32Array;
  /** length count. 1 = hidden, 0 = visible. */
  hidden: Float32Array;
  /** length count, per-node draw radius (world units). */
  radii: Float32Array;
  /** length count. computeNeighbourhood's per-node depth: >= 0 means "in the active neighbourhood", -1 means not. */
  depth: Float32Array;
  /** length count, per-node category tier (0 = landmark .. 3). */
  tier: Float32Array;
  label: (i: number) => string;
  zoom: number;
  /** camera position, world units. */
  cx: number;
  cy: number;
  viewport: Viewport;
  mode: LabelMode;
  selIdx: number;
  hoverIdx: number;
}

/** [screenX, screenY, opacity]. */
export type PlacedLabel = [number, number, number];

export interface LabelPlacerOptions {
  poolSize: number;
  /** collision-box height, screen px. Not the rendered font size. */
  labelHeight: number;
  measure: MeasureText;
}

export interface LabelPlacer {
  /** Clears `out`, decides this frame's placements, and writes them in. Returns the count placed. */
  place(view: LabelView, out: Map<number, PlacedLabel>): number;
}

export function createLabelPlacer(opts: LabelPlacerOptions): LabelPlacer {
  const { poolSize, labelHeight: LAB_H, measure } = opts;

  // Scratch, sized to the node count and reused frame to frame — reallocated
  // only when that count changes (a data reload), never per frame.
  let cap = -1;
  let wCache = new Float32Array(0);
  const candIdx: number[] = [];
  let candScore = new Float32Array(0);

  // Placed-box scratch, reused frame to frame rather than reallocated — a
  // flat parallel-array stand-in for what was `Array<[number, number,
  // number]>`, so testing a candidate against every already-placed box
  // allocates nothing. Plain `number[]`, not a typed array: these hold
  // double-precision screen coordinates compared with strict `<`/`>` at
  // collision boundaries, and Float32Array's rounding is enough to flip a
  // boundary case — an actual behaviour change the "verbatim" move can't
  // afford, not just a style choice.
  const boxX: number[] = [], boxY: number[] = [], boxW: number[] = [];
  let boxCount = 0;

  // Reused output tuple for project() — see camera.ts's own doc comment on
  // why it takes one.
  const PROJECTED: [number, number] = [0, 0];

  function ensureCapacity(n: number) {
    if (n === cap) return;
    cap = n;
    wCache = new Float32Array(n).fill(-1);
    candScore = new Float32Array(n);
  }

  function labelWidth(i: number, text: string, landmark: boolean): number {
    if (wCache[i]! < 0) {
      const font = landmark ? `700 10.5px ${MONO}` : `500 9px ${MONO}`;
      wCache[i] = measure(text, font) + text.length * (landmark ? 1.47 : 0.72) + 7;
    }
    return wCache[i]!;
  }

  function place(view: LabelView, out: Map<number, PlacedLabel>): number {
    const { count: n, pos, hidden, radii, depth, tier, label, zoom, cx, cy, viewport, mode, selIdx, hoverIdx } = view;
    ensureCapacity(n);

    boxCount = 0;
    out.clear();
    if (mode === "off") return 0;

    const W = viewport.width, H = viewport.height;
    const px = 1 / zoom;
    const hw = (W / 2) * px * 1.15, hh = (H / 2) * px * 1.15;
    const focused = selIdx >= 0 || hoverIdx >= 0;

    candIdx.length = 0;
    for (let i = 0; i < n; i++) {
      if (hidden[i] !== 0) continue;
      const x = pos[i * 2]!, y = pos[i * 2 + 1]!;
      if (Math.abs(x - cx) > hw || Math.abs(y - cy) > hh) continue;

      const t = tier[i]!;
      const isTarget = i === selIdx || i === hoverIdx;
      const inFlow = depth[i]! >= 0; // inside the active neighbourhood
      const landmark = t === 0;

      // Three ways to earn a name: you're the target, you're in the active
      // flow, or your tier has come into range at this zoom.
      let earns: boolean;
      if (mode === "all") earns = true;
      else if (mode === "key") earns = landmark || isTarget || depth[i] === 1;
      else earns = isTarget || inFlow || zoom >= TIER_ZOOM[t]!;
      if (!earns) continue;

      // While something is focused, everything outside the flow steps back
      // — except landmarks, which you need to keep your bearings.
      if (focused && !inFlow && !isTarget && !landmark) continue;

      let sc = radii[i]! + (3 - t) * 9;
      if (inFlow) sc += depth[i] === 1 ? 70 : 30;
      if (i === hoverIdx) sc += SCORE_HOVER_OVERRIDE;
      if (i === selIdx) sc += SCORE_SELECT_OVERRIDE;
      candScore[i] = sc;
      candIdx.push(i);
    }
    // Stable: equal scores keep insertion order, i.e. ascending node index —
    // load-bearing, pinned by a test. Sorting an index array preserves it the
    // same way sorting an array of [score, index] tuples would.
    candIdx.sort((a, b) => candScore[b]! - candScore[a]!);

    for (let k = 0; k < candIdx.length && out.size < poolSize; k++) {
      const i = candIdx[k]!;
      const sp = project(pos[i * 2]!, pos[i * 2 + 1]!, zoom, cx, cy, viewport, PROJECTED);
      const sx = sp[0], sy = sp[1];
      if (sx < -60 || sx > W + 60 || sy < -24 || sy > H + 24) continue;
      const t = tier[i]!, landmark = t === 0;
      const bx = sx + glyphRadiusPx(radii[i]!, zoom) + 8;
      const by = sy - LAB_H * 0.5;
      const bw = labelWidth(i, label(i), landmark);
      let hit = false;
      for (let q = 0; q < boxCount; q++) {
        if (bx < boxX[q]! + boxW[q]! && bx + bw > boxX[q]! && by < boxY[q]! + LAB_H && by + LAB_H > boxY[q]!) { hit = true; break; }
      }
      if (hit) continue;
      const op = i === selIdx || i === hoverIdx ? 1
        : depth[i]! >= 0 ? 0.92
        : focused ? 0.28 // landmark, holding position
        : landmark ? 0.82 : 0.52;
      boxX[boxCount] = bx; boxY[boxCount] = by; boxW[boxCount] = bw; boxCount++;
      out.set(i, [bx, by, op]);
    }
    return out.size;
  }

  return { place };
}
