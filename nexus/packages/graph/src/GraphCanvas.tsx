import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import * as THREE from "three";
import { createPhysics, computeDegree } from "./physics.js";
import { computeNeighbourhood } from "./neighbourhood.js";
import { pickNode } from "./picking.js";
import { createLabelPlacer } from "./labels.js";
import type { LabelView, PlacedLabel } from "./labels.js";
import { unproject } from "./camera.js";
import type { Viewport } from "./camera.js";
import {
  NODE_VS, NODE_FS, EDGE_VS, EDGE_FS, PAD_VS, PAD_FS,
  EDGE_ATTRS, encodeRouting, DEFAULT_ARC_BOW,
  FADE_VS, FADE_FS, POST_VS, BLUR_FS, COMPOSITE_FS,
} from "./shaders.js";
import { STATE_LABEL, ORPHAN_STATE } from "./types.js";
import type {
  FitInset, GraphCanvasProps, GraphController, GraphNodeSnapshot, GraphStats, PhysicsConfig, OpticsConfig,
} from "./types.js";

/**
 * How far short of a node's centre its edges stop, as a multiple of the node
 * radius. The same at both ends: the terminal pad sits here, and an edge whose
 * two pads landed at different distances would be reading meaning into which
 * endpoint the source data happened to list first.
 */
const EDGE_END_TRIM = 1.15;

/* ============================================================================
   GraphCanvas

   Ported from NexusCyberdeck.jsx's `boot()` — the physics/shader setup,
   render loop, interaction handlers, label pool and tooltip are structurally
   unchanged. What changed is exactly what had to: every lookup that used to
   read the module-global `NODE_TYPES`/`LINK_TYPES` tables now reads the
   `nodeCategories`/`linkCategories` props instead, node/edge `id`s (now
   arbitrary, caller-supplied) get resolved to dense internal indices once
   per graph, and the imperative `nodeOn`/`linkOn`/`isolate`/`selected`
   state the original parent component owned directly are now controlled
   props flowing in through refs, the same pattern the original already used
   for `cfg`/`running`/`labelMode`.
   ========================================================================== */

// Deliberately not sourced from @nexus/tokens — this package has no
// dependency on the rest of Nexus, so its one self-contained failure state
// can't assume `var(--nx-*)` custom properties exist.
const FALLBACK_BG = "#08090A";
const FALLBACK_FG = "#DFF5C7";
const FALLBACK_CRITICAL = "#FF2E63";
const MONO = 'ui-monospace,"SF Mono",Menlo,Consolas,monospace';

// Intro sweep: the camera's live zoom starts this many times tighter than
// the real fit-to-view framing, then the frame loop's existing camT-easing
// (used for every other camera move — pan, wheel, fit, focus) pulls it back
// out. No separate animation timer needed; it's the same spring, just given
// a dramatic starting offset once, on mount. Critically, the *target* it
// eases toward is the actual measured fit from the very first frame (see
// `autoFit` below), not a placeholder that gets swapped out mid-flight —
// swapping targets after the sweep has already started is what used to
// read as a twitch.
const INTRO_ZOOM_MULTIPLIER = 6;

// Exported so a caller building its own controls (a params sidebar, say)
// has one real source for "what does this slider reset to" instead of a
// second, driftable copy of the same numbers.
export const DEFAULT_PHYSICS: PhysicsConfig = {
  repulsion: 900, linkDistance: 78, gravity: 0.028, damping: 0.62,
  cursorForce: 0, sectorForce: 0, radiusForce: 0, settle: 0,
};
export const DEFAULT_OPTICS: OpticsConfig = {
  glow: 0.8, trails: 0.16, edgeOpacity: 0.4, edgeWidth: 1.3, flowSpeed: 0.24,
  scan: 0.55, aberr: 0.5, curve: 0.55, grain: 0.45, bloom: 0.85, glitch: 0.5,
};

const hex4 = (i: number): string => (((i * 2654435761) >>> 0) % 65536).toString(16).toUpperCase().padStart(4, "0");

// Shared by the effect that pushes *later* physicsCfg changes into a live
// sim and boot()'s one-time initial push (below) — one field list instead
// of two copies that a new PhysicsConfig field could update in one place
// and silently miss in the other.
const physicsParamsOf = (cfg: PhysicsConfig): Partial<PhysicsConfig> => ({
  repulsion: cfg.repulsion, linkDistance: cfg.linkDistance,
  gravity: cfg.gravity, damping: cfg.damping,
  cursorForce: cfg.cursorForce, sectorForce: cfg.sectorForce,
  radiusForce: cfg.radiusForce, settle: cfg.settle,
});

interface InternalController {
  params?: (p: Partial<PhysicsConfig>) => void;
  refilterInternal?: () => void;
  applySelectionInternal?: (index: number) => void;
  fit?: () => void;
  /** Re-runs fit(), but only if the camera hasn't been taken over by hand — see the fitInset effect below. */
  reframe?: () => void;
  focus?: (index: number) => void;
  reheat?: (v: number) => void;
  reseed?: () => void;
  getNodeByIndex?: (index: number) => GraphNodeSnapshot | null;
}

export const GraphCanvas = forwardRef<GraphController, GraphCanvasProps>(function GraphCanvas(props, ref) {
  const {
    nodes, edges, nodeCategories, linkCategories,
    physics: physicsProp, optics: opticsProp,
    labelMode = "auto",
    hiddenNodeCategories, hiddenLinkCategories, isolateId = null, selectedId = null,
    fitInset,
    running = true,
    onSelect, onFrame, onStats, onFatal,
    className, style,
  } = props;

  const mountRef = useRef<HTMLDivElement>(null);
  const labelRef = useRef<HTMLDivElement>(null);
  const api = useRef<InternalController>({});
  const [fatal, setFatal] = useState<string | null>(null);

  const physicsCfg: PhysicsConfig = { ...DEFAULT_PHYSICS, ...physicsProp };
  const opticsCfg: OpticsConfig = { ...DEFAULT_OPTICS, ...opticsProp };

  // Normalized once so applyFit never has to branch on a missing side, and
  // so the re-frame effect below has four stable numbers to depend on rather
  // than a prop object a consumer would have to remember to memoize.
  const fitTop = fitInset?.top ?? 0, fitRight = fitInset?.right ?? 0;
  const fitBottom = fitInset?.bottom ?? 0, fitLeft = fitInset?.left ?? 0;
  const fitInsetRef = useRef<FitInset>({ top: fitTop, right: fitRight, bottom: fitBottom, left: fitLeft });
  fitInsetRef.current = { top: fitTop, right: fitRight, bottom: fitBottom, left: fitLeft };

  const opticsRef = useRef(opticsCfg); opticsRef.current = opticsCfg;
  const runRef = useRef(running); runRef.current = running;
  const labelModeRef = useRef(labelMode); labelModeRef.current = labelMode;
  const hiddenNodeRef = useRef(hiddenNodeCategories); hiddenNodeRef.current = hiddenNodeCategories;
  const hiddenLinkRef = useRef(hiddenLinkCategories); hiddenLinkRef.current = hiddenLinkCategories;
  const isolateRef = useRef(isolateId); isolateRef.current = isolateId;
  const onFrameRef = useRef(onFrame); onFrameRef.current = onFrame;
  const onStatsRef = useRef(onStats); onStatsRef.current = onStats;

  useImperativeHandle(ref, () => ({
    fit: () => api.current.fit?.(),
    focus: (id) => {
      const idx = idToIndexRef.current.get(id);
      if (idx !== undefined) api.current.focus?.(idx);
    },
    reheat: (v = 1.0) => api.current.reheat?.(v),
    reseed: () => api.current.reseed?.(),
    getNode: (id) => {
      const idx = idToIndexRef.current.get(id);
      return idx !== undefined ? (api.current.getNodeByIndex?.(idx) ?? null) : null;
    },
  }), []);

  // Populated fresh by the mount effect below; read by the imperative handle
  // above between mounts, so it has to live outside the effect's closure.
  const idToIndexRef = useRef<Map<unknown, number>>(new Map());

  // Re-frame when the consumer's chrome changes shape — a dock window
  // collapsing, a detail drawer sliding in. api.current.reframe is a no-op
  // once the reader has taken the camera over by hand, so this can't yank a
  // deliberate pan back to centre.
  useEffect(() => {
    api.current.reframe?.();
  }, [fitTop, fitRight, fitBottom, fitLeft]);

  useEffect(() => {
    api.current.params?.(physicsParamsOf(physicsCfg));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    physicsCfg.repulsion, physicsCfg.linkDistance, physicsCfg.gravity, physicsCfg.damping,
    physicsCfg.cursorForce, physicsCfg.sectorForce, physicsCfg.radiusForce, physicsCfg.settle,
  ]);

  useEffect(() => {
    api.current.refilterInternal?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hiddenNodeCategories, hiddenLinkCategories, isolateId]);

  useEffect(() => {
    const idx = selectedId === null ? -1 : (idToIndexRef.current.get(selectedId) ?? -1);
    api.current.applySelectionInternal?.(idx);
  }, [selectedId]);

  useEffect(() => {
    const mount = mountRef.current, lab = labelRef.current;
    if (!mount || !lab) return;
    // Populated as boot() creates each disposable resource, not just at its
    // end — so a resource created right before boot() throws (bad data
    // partway through setup) still gets torn down instead of leaking a
    // WebGL context that nothing will ever dispose.
    const disposers: Array<() => void> = [];
    const runDisposers = () => {
      while (disposers.length) {
        try { disposers.pop()!(); } catch (e) { console.error(e); }
      }
      api.current = {};
    };
    try { boot(mount, lab, disposers); }
    catch (err) {
      runDisposers();
      const message = String((err as Error)?.message ?? err);
      console.error(err);
      setFatal(message);
      onFatal?.(message);
    }
    return runDisposers;

    function boot(mountEl: HTMLDivElement, labelEl: HTMLDivElement, disposers: Array<() => void>) {
      const n = nodes.length;
      const idToIndex = new Map<unknown, number>(nodes.map((node, i) => [node.id, i]));
      idToIndexRef.current = idToIndex;
      const denseIds = nodes.map((node) => node.id);

      const nCategoryId = nodes.map((node) => node.categoryId);

      // An edge whose endpoint doesn't resolve to a known node (stale/typo'd
      // id in the source data) is dropped here, once, rather than left to
      // surface as an out-of-range array index somewhere downstream —
      // every index built below (eA/eB, inc, physics, render buffers) is
      // sized from `m` and is only ever valid if it stays in range.
      const liveEdges = edges.filter((edge) => idToIndex.has(edge.a) && idToIndex.has(edge.b));
      if (liveEdges.length !== edges.length) {
        console.warn(
          `GraphCanvas: dropping ${edges.length - liveEdges.length} edge(s) whose endpoint id matches no node`,
          edges.filter((edge) => !idToIndex.has(edge.a) || !idToIndex.has(edge.b)),
        );
      }
      const m = liveEdges.length;

      const eCategoryId = liveEdges.map((edge) => edge.categoryId);
      const linkCategoryIds = Object.keys(linkCategories);
      const eA = new Int32Array(m), eB = new Int32Array(m);
      for (let e = 0; e < m; e++) {
        eA[e] = idToIndex.get(liveEdges[e]!.a)!;
        eB[e] = idToIndex.get(liveEdges[e]!.b)!;
      }
      const degree = computeDegree(
        Array.from({ length: m }, (_, e) => ({ a: eA[e]!, b: eB[e]! })),
        n,
      );
      // A node with no edges is always ORPHAN, regardless of its declared
      // state — derived from graph structure the engine already has, not
      // something the caller needs to remember to set by hand.
      const nState = new Uint8Array(n);
      for (let i = 0; i < n; i++) nState[i] = degree[i] === 0 ? ORPHAN_STATE : (nodes[i]!.state ?? 1);

      const sim = createPhysics({
        nodes: nodes.map((node) => {
          const cat = nodeCategories[node.categoryId]!;
          // Conditional spread, not `sectorAngle: cat.sectorAngle` — under
          // exactOptionalPropertyTypes an explicit `undefined` isn't the
          // same as an omitted key, and PhysicsNode.sectorAngle/
          // radiusTarget need the key genuinely absent (not
          // present-but-undefined) to mean "no bias" (physics.ts checks
          // `!== undefined` to opt a node in at all).
          return {
            charge: cat.charge,
            mass: cat.mass,
            ...(cat.sectorAngle === undefined ? {} : { sectorAngle: cat.sectorAngle }),
            ...(cat.radiusTarget === undefined ? {} : { radiusTarget: cat.radiusTarget }),
          };
        }),
        edges: Array.from({ length: m }, (_, e) => {
          const cat = linkCategories[eCategoryId[e]!]!;
          return { a: eA[e]!, b: eB[e]!, dist: cat.dist, strength: cat.strength };
        }),
      });
      // createPhysics() itself only takes {nodes, edges} — every tunable
      // param starts at physics.ts's own hardcoded defaults until
      // setParams() is called. The effect below (api.current.params)
      // exists to push *later* physicsCfg changes through, but on first
      // mount it fires before this effect (declared earlier in the
      // component) has anywhere to send them, since api.current.params
      // isn't assigned until a few lines down — same class of "consumer
      // can set this from first mount" gap selectedId has, applied
      // explicitly below. Applying physicsCfg here, once, up front, means
      // the sim starts configured correctly regardless of effect order.
      sim.setParams(physicsParamsOf(physicsCfg));
      const pos = sim.pos;

      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "high-performance" });
      // Four full-screen passes at dpr 2 is a lot of fill for little gain;
      // the CRT grille and grain hide the difference anyway.
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.6));
      renderer.setClearColor(new THREE.Color(FALLBACK_BG), 1);
      renderer.autoClear = false;
      mountEl.appendChild(renderer.domElement);
      renderer.domElement.style.cssText =
        "display:block;touch-action:none;width:100%;height:100%";
      disposers.push(() => {
        renderer.dispose();
        if (renderer.domElement.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement);
      });

      const scene = new THREE.Scene();
      const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -10, 10);
      camera.position.z = 5;
      let camZoom = 1;

      const nRadius = new Float32Array(n), nShape = new Float32Array(n);
      const nColor = new Float32Array(n * 3), nSeed = new Float32Array(n);
      const nDepth = new Float32Array(n).fill(-1);
      const nSel = new Float32Array(n), nHide = new Float32Array(n);
      const nTier = new Float32Array(n); // per-node category tier, for the label placer's view
      const tc = new THREE.Color();
      for (let i = 0; i < n; i++) {
        const cat = nodeCategories[nCategoryId[i]!]!;
        nRadius[i] = cat.size * (1 + Math.min(1.4, Math.log2(1 + degree[i]!) * 0.16));
        nShape[i] = cat.shape; tc.set(cat.color);
        nColor[i * 3] = tc.r; nColor[i * 3 + 1] = tc.g; nColor[i * 3 + 2] = tc.b;
        nSeed[i] = Math.random();
        nTier[i] = cat.tier;
      }
      const eAPos = new Float32Array(m * 2), eBPos = new Float32Array(m * 2);
      const eColor = new Float32Array(m * 3);
      // Sized from the layout shaders.ts declares, so the two are one statement.
      const eP0 = new Float32Array(m * EDGE_ATTRS.iP0);   // width, curve, dash, gain
      const eP1 = new Float32Array(m * EDGE_ATTRS.iP1);   // flow, seed, radA, radB
      const eP2 = new Float32Array(m * EDGE_ATTRS.iP2);   // tier, hide, jit, fray
      const A_TIER = 0, A_HIDE = 1, A_JIT = 2, A_FRAY = 3;
      for (let e = 0; e < m; e++) {
        const cat = linkCategories[eCategoryId[e]!]!;
        tc.set(cat.color);
        eColor[e * 3] = tc.r; eColor[e * 3 + 1] = tc.g; eColor[e * 3 + 2] = tc.b;
        eP0[e * 4] = cat.width;
        // Routing shares `curve`'s float, so it costs no attribute. The
        // encoding lives in shaders.ts next to the dispatch that reads it —
        // writing the float here by hand is what let an earlier version hand
        // every odd-indexed arc a negative bow and draw it as an etched trace.
        // The alternating sign keeps adjacent arcs from overlapping.
        eP0[e * 4 + 1] = encodeRouting(cat.routing, (cat.curve ?? DEFAULT_ARC_BOW) * (e % 2 === 0 ? 1 : -1));
        eP0[e * 4 + 2] = cat.dash ?? 0;
        eP0[e * 4 + 3] = cat.gain ?? 1;
        eP1[e * 4] = cat.flow ?? 0;
        eP1[e * 4 + 1] = Math.random();
        // Symmetric: the b end used to be trimmed further back to leave room
        // for the arrowhead, and that geometry is gone. Keeping the asymmetry
        // would land the two terminal pads of one edge at visibly different
        // distances, decided by nothing but which endpoint the source data
        // happened to call `a`.
        eP1[e * 4 + 2] = nRadius[eA[e]!]! * EDGE_END_TRIM;
        eP1[e * 4 + 3] = nRadius[eB[e]!]! * EDGE_END_TRIM;
        eP2[e * 4 + A_JIT] = cat.jit ?? 0;
        const absent = liveEdges[e]!.absentEnd;
        eP2[e * 4 + A_FRAY] = absent === "b" ? 1 : absent === "a" ? 2 : 0;
      }
      const dyn = (arr: Float32Array, size: number) => {
        const a = new THREE.InstancedBufferAttribute(arr, size);
        a.setUsage(THREE.DynamicDrawUsage); return a;
      };
      const stat = (arr: Float32Array, size: number) => new THREE.InstancedBufferAttribute(arr, size);

      /**
       * Hands a geometry a bounding sphere instead of letting three compute one.
       *
       * Every geometry here declares `position` with itemSize 2 — these are 2D
       * quads and ribbon templates fed to RawShaderMaterials whose vertex
       * shaders declare `attribute vec2 position`. There is no third component
       * and there shouldn't be. But BufferGeometry.computeBoundingSphere()
       * reads each vertex through Vector3.fromBufferAttribute(), which calls
       * getZ(i) — `array[i * 2 + 2]`, i.e. the *next* vertex's x, and past the
       * end of the buffer on the last one. That `undefined` poisons the radius
       * to NaN and three logs "Computed radius is NaN. The position attribute
       * is likely to have NaN values." The position data is fine; the reader
       * assumes 3 components.
       *
       * frustumCulled = false doesn't prevent this. It only skips the frustum
       * *test* — WebGLRenderer.projectObject still needs a sphere centre for
       * the render list's depth sort key, and calls computeBoundingSphere()
       * whenever geometry.boundingSphere is null. Supplying one short-circuits
       * that, and an Infinity radius is three's own "unbounded" sentinel (it
       * uses exactly that for GLBufferAttribute geometries it can't measure).
       */
      const unbounded = <T extends THREE.BufferGeometry>(geo: T): T => {
        geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), Infinity);
        return geo;
      };

      const SEG = 24;
      const ev = new Float32Array((SEG + 1) * 4); const ei: number[] = [];
      for (let s = 0; s <= SEG; s++) {
        const t = s / SEG;
        ev[s * 4] = t; ev[s * 4 + 1] = -1; ev[s * 4 + 2] = t; ev[s * 4 + 3] = 1;
      }
      for (let s = 0; s < SEG; s++) { const b = s * 2; ei.push(b, b + 1, b + 2, b + 2, b + 1, b + 3); }
      const edgeGeo = unbounded(new THREE.InstancedBufferGeometry());
      edgeGeo.setAttribute("position", new THREE.BufferAttribute(ev, 2));
      edgeGeo.setIndex(ei);
      const aEA = dyn(eAPos, 2), aEB = dyn(eBPos, 2), aEP2 = dyn(eP2, 4);
      edgeGeo.setAttribute("iA", aEA);
      edgeGeo.setAttribute("iB", aEB);
      edgeGeo.setAttribute("iColor", stat(eColor, 3));
      edgeGeo.setAttribute("iP0", stat(eP0, 4));
      edgeGeo.setAttribute("iP1", stat(eP1, 4));
      edgeGeo.setAttribute("iP2", aEP2);
      edgeGeo.instanceCount = m;
      const edgeUniforms = () => ({
        uPx: { value: 1 }, uWidth: { value: opticsCfg.edgeWidth }, uTime: { value: 0 },
        uOpacity: { value: opticsCfg.edgeOpacity }, uFlowSpeed: { value: opticsCfg.flowSpeed },
        uFocus: { value: 0 }, uSignal: { value: 1 }, uPass: { value: 0 },
      });
      const edgeMat = new THREE.RawShaderMaterial({
        vertexShader: EDGE_VS, fragmentShader: EDGE_FS,
        // The ribbon's winding flips with curve direction (SPEC.md's own
        // note on this, from the POC that validated this shader) — every
        // RawShaderMaterial defaults to front-face-only culling, so without
        // DoubleSide roughly half of any curved edge set silently drops
        // (sometimes all of it, depending which way the winding lands),
        // with no error surfaced anywhere: the draw call, program link,
        // and buffers all report success, only the rasterizer discards it.
        side: THREE.DoubleSide,
        // The RESTING layer composites (premultiplied), so two crossing edges
        // stay as dark as one instead of summing toward white and lighting up
        // exactly where the picture is already busiest.
        transparent: true, depthTest: false, depthWrite: false, premultipliedAlpha: true,
        blending: THREE.CustomBlending, blendEquation: THREE.AddEquation,
        blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
        uniforms: edgeUniforms(),
      });
      const edgeMesh = new THREE.Mesh(edgeGeo, edgeMat);
      edgeMesh.frustumCulled = false; edgeMesh.renderOrder = 0; scene.add(edgeMesh);

      // The LIVE layer stays additive so it still blooms like phosphor. Same
      // geometry and same instance buffers; `uPass` makes each program discard
      // the other's instances, which is cheaper to reason about than
      // maintaining two partitioned instance ranges as hover moves.
      const edgeLiveMat = new THREE.RawShaderMaterial({
        vertexShader: EDGE_VS, fragmentShader: EDGE_FS,
        side: THREE.DoubleSide,
        transparent: true, depthTest: false, depthWrite: false,
        blending: THREE.CustomBlending, blendEquation: THREE.AddEquation,
        blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
        uniforms: { ...edgeUniforms(), uPass: { value: 1 } },
      });
      const edgeLiveMesh = new THREE.Mesh(edgeGeo, edgeLiveMat);
      edgeLiveMesh.frustumCulled = false; edgeLiveMesh.renderOrder = 2; scene.add(edgeLiveMesh);

      // Terminal pads: two quads per edge, sharing the ribbon's instance
      // buffers. A trace lands on a pad and never touches the glyph.
      const padGeo = unbounded(new THREE.InstancedBufferGeometry());
      const pv = new Float32Array(8 * 3); const pIdx: number[] = [];
      for (let end = 0; end < 2; end++) {
        const b = end * 4, o = b * 3;
        const corners = [[-1, -1], [1, -1], [-1, 1], [1, 1]];
        for (let c = 0; c < 4; c++) {
          pv[o + c * 3] = corners[c]![0]!; pv[o + c * 3 + 1] = corners[c]![1]!; pv[o + c * 3 + 2] = end;
        }
        pIdx.push(b, b + 1, b + 2, b + 2, b + 1, b + 3);
      }
      padGeo.setAttribute("aPad", new THREE.BufferAttribute(pv, 3));
      padGeo.setIndex(pIdx);
      padGeo.setAttribute("iA", aEA);
      padGeo.setAttribute("iB", aEB);
      padGeo.setAttribute("iColor", stat(eColor, 3));
      padGeo.setAttribute("iP0", stat(eP0, 4));
      padGeo.setAttribute("iP1", stat(eP1, 4));
      padGeo.setAttribute("iP2", aEP2);
      padGeo.instanceCount = m;
      const padMat = new THREE.RawShaderMaterial({
        vertexShader: PAD_VS, fragmentShader: PAD_FS,
        side: THREE.DoubleSide,
        transparent: true, depthTest: false, depthWrite: false, premultipliedAlpha: true,
        blending: THREE.CustomBlending, blendEquation: THREE.AddEquation,
        blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
        uniforms: {
          uPx: { value: 1 }, uWidth: { value: opticsCfg.edgeWidth },
          uOpacity: { value: opticsCfg.edgeOpacity }, uFocus: { value: 0 },
        },
      });
      const padMesh = new THREE.Mesh(padGeo, padMat);
      padMesh.frustumCulled = false; padMesh.renderOrder = 1; scene.add(padMesh);   // fade -10 < edges 0 < pads 1 < live 2 < nodes 3

      const nodeGeo = unbounded(new THREE.InstancedBufferGeometry());
      nodeGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), 2));
      nodeGeo.setIndex([0, 1, 2, 2, 1, 3]);
      // The JS logic keeps its readable per-node arrays; syncNodes() mirrors
      // them into the packed GPU buffers so only the upload path changed.
      const nN0 = new Float32Array(n * 4), nN1 = new Float32Array(n * 4);
      for (let i = 0; i < n; i++) {
        nN0[i * 4] = nRadius[i]!; nN0[i * 4 + 1] = nShape[i]!; nN0[i * 4 + 2] = nSeed[i]!;
        nN1[i * 4] = nState[i]!;
      }
      const aPos = dyn(pos, 2), aN0 = dyn(nN0, 4), aN1 = dyn(nN1, 4);
      function syncNodes() {
        for (let i = 0; i < n; i++) {
          nN0[i * 4 + 3] = nDepth[i]!;
          nN1[i * 4 + 1] = nSel[i]!;
          nN1[i * 4 + 2] = nHide[i]!;
        }
        aN0.needsUpdate = true; aN1.needsUpdate = true;
      }
      syncNodes();
      nodeGeo.setAttribute("iPos", aPos);
      nodeGeo.setAttribute("iColor", stat(nColor, 3));
      nodeGeo.setAttribute("iN0", aN0);
      nodeGeo.setAttribute("iN1", aN1);
      nodeGeo.instanceCount = n;
      const nodeMat = new THREE.RawShaderMaterial({
        vertexShader: NODE_VS, fragmentShader: NODE_FS,
        transparent: true, depthTest: false, depthWrite: false,
        blending: THREE.CustomBlending, blendEquation: THREE.AddEquation,
        blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
        uniforms: {
          uTime: { value: 0 }, uPx: { value: 1 }, uHlStart: { value: -999 },
          uGlow: { value: opticsCfg.glow }, uFocus: { value: 0 },
        },
      });
      const nodeMesh = new THREE.Mesh(nodeGeo, nodeMat);
      nodeMesh.frustumCulled = false; nodeMesh.renderOrder = 3; scene.add(nodeMesh);

      const vc = new THREE.Color(FALLBACK_BG);
      const fadeGeo = unbounded(new THREE.BufferGeometry());
      fadeGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array([-1, -1, 3, -1, -1, 3]), 2));
      const fadeMat = new THREE.RawShaderMaterial({
        vertexShader: FADE_VS, fragmentShader: FADE_FS,
        transparent: true, depthTest: false, depthWrite: false,
        uniforms: { uColor: { value: new THREE.Vector3(vc.r, vc.g, vc.b) }, uAlpha: { value: 1 } },
      });
      const fadeMesh = new THREE.Mesh(fadeGeo, fadeMat);
      fadeMesh.frustumCulled = false; fadeMesh.renderOrder = -10; scene.add(fadeMesh);

      const rtOpts = { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, format: THREE.RGBAFormat, depthBuffer: false, stencilBuffer: false };
      const sceneRT = new THREE.WebGLRenderTarget(2, 2, rtOpts);
      const bloomA = new THREE.WebGLRenderTarget(2, 2, rtOpts);
      const bloomB = new THREE.WebGLRenderTarget(2, 2, rtOpts);

      const fsGeo = unbounded(new THREE.BufferGeometry());
      fsGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array([-1, -1, 3, -1, -1, 3]), 2));
      fsGeo.setAttribute("uv", new THREE.BufferAttribute(new Float32Array([0, 0, 2, 0, 0, 2]), 2));
      const blurMat = new THREE.RawShaderMaterial({
        vertexShader: POST_VS, fragmentShader: BLUR_FS, depthTest: false, depthWrite: false,
        uniforms: {
          uTex: { value: null }, uTexel: { value: new THREE.Vector2() },
          uDir: { value: new THREE.Vector2(1, 0) }, uThresh: { value: 0.34 },
        },
      });
      const compMat = new THREE.RawShaderMaterial({
        vertexShader: POST_VS, fragmentShader: COMPOSITE_FS, depthTest: false, depthWrite: false,
        uniforms: {
          uScene: { value: null }, uBloom: { value: null },
          uRes: { value: new THREE.Vector2(1, 1) }, uTime: { value: 0 },
          uScan: { value: opticsCfg.scan }, uAberr: { value: opticsCfg.aberr }, uCurve: { value: opticsCfg.curve },
          uGrain: { value: opticsCfg.grain }, uBloomAmt: { value: opticsCfg.bloom }, uGlitch: { value: 0 },
        },
      });
      const fsQuad = new THREE.Mesh(fsGeo, compMat);
      fsQuad.frustumCulled = false;
      const postScene = new THREE.Scene(); postScene.add(fsQuad);
      const postCam = new THREE.Camera();
      disposers.push(() => {
        [nodeGeo, edgeGeo, padGeo, fadeGeo, fsGeo].forEach((g) => g.dispose());
        [nodeMat, edgeMat, edgeLiveMat, padMat, fadeMat, blurMat, compMat].forEach((mm) => mm.dispose());
        [sceneRT, bloomA, bloomB].forEach((rt) => rt.dispose());
      });

      /* --------------------------------------------------------- label pool */
      const POOL = 60;
      const labels: HTMLDivElement[] = [], owner = new Int32Array(POOL).fill(-1);
      for (let i = 0; i < POOL; i++) {
        const el = document.createElement("div");
        el.style.cssText =
          "position:absolute;left:0;top:0;pointer-events:none;white-space:nowrap;" +
          `font:600 9.5px/1 ${MONO};letter-spacing:.09em;text-transform:uppercase;` +
          "text-shadow:1px 0 rgba(255,46,99,.4),-1px 0 rgba(23,226,229,.4),0 0 7px rgba(0,0,0,.98);" +
          "transform:translate3d(-9999px,-9999px,0);will-change:transform;opacity:0;transition:opacity .1s";
        labelEl.appendChild(el);
        labels.push(el);
      }
      const LAB_H = 11;

      // Raw text measurement only — the placer owns the per-node cache and
      // the padding math (see labels.ts). Measuring once per node instead of
      // guessing from character count: the collision test is only as good as
      // the box it is given.
      const meas = document.createElement("canvas").getContext("2d")!;
      const labelPlacer = createLabelPlacer({
        poolSize: POOL, labelHeight: LAB_H,
        measure: (text, font) => { meas.font = font; return meas.measureText(text).width; },
      });

      // Imperative tooltip. Driving this through React state re-rendered the
      // whole tree on every pointermove — 60 reconciles a second while hovering.
      // Its chrome colours (border, secondary text) are hardcoded defaults,
      // same status as FALLBACK_BG above — this package has no theme system
      // of its own, only per-category colours the caller already supplies.
      const tip = document.createElement("div");
      tip.style.cssText =
        "position:absolute;left:0;top:0;pointer-events:none;white-space:nowrap;max-width:270px;" +
        "overflow:hidden;text-overflow:ellipsis;background:rgba(8,10,9,.95);border:1px solid #1B2318;" +
        "border-left-width:2px;padding:4px 7px;font:600 9px/1.4 " + MONO + ";letter-spacing:.11em;" +
        "text-transform:uppercase;opacity:0;transition:opacity .1s;" +
        "transform:translate3d(-9999px,-9999px,0);will-change:transform;z-index:5";
      labelEl.appendChild(tip);
      disposers.push(() => {
        labels.forEach((l) => l.remove());
        tip.remove();
      });

      let W = 1, H = 1, px = 1;
      const bufSize = new THREE.Vector2();
      const camT = { x: 0, y: 0, zoom: 1 };
      // True from mount (and again after a reseed) until the user first
      // takes the camera over by hand — see the frame loop and
      // onDown/onWheel below.
      let autoFit = true;
      // Node index the camera is riding along with, or -1. Set by focus(),
      // cleared by any hand-driven camera move and once the layout stops
      // moving under it (a settled node no longer needs following).
      let follow = -1;
      // The auto-fit's own view of the graph's bounds, eased independently
      // of (and slower than) camT's usual camera-follows-target smoothing
      // below. The physics solver doesn't expand monotonically — a node
      // easing into its sector/ring can overshoot and spring back — so
      // feeding the raw instantaneous bounds straight into camT every
      // frame made the camera visibly zoom in and out along with it. This
      // low-pass stage absorbs that kind of transient before it ever
      // reaches the camera, while still tracking a genuine, sustained
      // expansion within about a second.
      let fitX0 = 0, fitY0 = 0, fitX1 = 0, fitY1 = 0;
      const viewport: Viewport = { width: 1, height: 1, curve: opticsCfg.curve };
      // Mutated per frame rather than rebuilt — the typed arrays are the same
      // long-lived buffers `frame()` already writes into elsewhere.
      const labelView: LabelView = {
        count: n, pos, hidden: nHide, radii: nRadius, depth: nDepth, tier: nTier,
        label: (i) => nodes[i]!.label,
        zoom: 1, cx: 0, cy: 0, viewport, mode: "auto", selIdx: -1, hoverIdx: -1,
      };
      function resize() {
        W = mountEl.clientWidth || 1; H = mountEl.clientHeight || 1;
        viewport.width = W; viewport.height = H;
        // updateStyle must stay on: with it off three sets canvas.width = W*dpr
        // but no CSS size, so the element lays out at W*dpr and every DOM
        // overlay is in a coordinate space half the size of the canvas.
        renderer.setSize(W, H);
        camera.left = -W / 2; camera.right = W / 2;
        camera.top = H / 2; camera.bottom = -H / 2;
        camera.updateProjectionMatrix();
        renderer.getDrawingBufferSize(bufSize);
        const bw = Math.max(2, bufSize.x | 0), bh = Math.max(2, bufSize.y | 0);
        sceneRT.setSize(bw, bh);
        const sw = Math.max(2, (bw / 3) | 0), sh = Math.max(2, (bh / 3) | 0);
        bloomA.setSize(sw, sh); bloomB.setSize(sw, sh);
        compMat.uniforms['uRes']!.value.set(bw, bh);
        blurMat.uniforms['uTexel']!.value.set(1 / sw, 1 / sh);
        renderer.setRenderTarget(sceneRT); renderer.clear(); renderer.setRenderTarget(null);
      }
      resize();
      const ro = new ResizeObserver(resize);
      ro.observe(mountEl);
      disposers.push(() => ro.disconnect());

      const toWorld = (sx: number, sy: number) => {
        viewport.curve = opticsRef.current.curve;
        return unproject(sx, sy, camZoom, camera.position.x, camera.position.y, viewport);
      };

      const inc: Array<Array<{ e: number; other: number; categoryId: string; out: boolean }>> =
        Array.from({ length: n }, () => []);
      for (let e = 0; e < m; e++) {
        inc[eA[e]!]!.push({ e, other: eB[e]!, categoryId: eCategoryId[e]!, out: true });
        inc[eB[e]!]!.push({ e, other: eA[e]!, categoryId: eCategoryId[e]!, out: false });
      }
      const neighbourhoodGraph = { inc, eA, eB, hidden: nHide };
      const eTierBuf = new Float32Array(m); // scratch: computeNeighbourhood's dense per-edge tier output, scattered into eP2 below

      let selIdx = -1, hoverIdx = -1, clock = 0, glitchUntil = -1, drawnLinks = m, drawnNodes = n;

      // If the edge program ever fails to link again, this makes it obvious
      // instead of silent: compare slots used against what the driver allows.
      const glc = renderer.getContext();
      const glCaps = {
        attribs: glc.getParameter(glc.MAX_VERTEX_ATTRIBS) as number,
        ver: renderer.capabilities.isWebGL2 ? 2 : 1,
      };
      const kick = (d: number) => { glitchUntil = clock + d; };

      function refilter() {
        const hiddenNode = new Set(hiddenNodeRef.current ?? []);
        const hiddenLink = new Set(hiddenLinkRef.current ?? []);
        const isoId = isolateRef.current;
        const iso = isoId === null || isoId === undefined ? -1 : (idToIndex.get(isoId) ?? -1);
        let allow: Set<number> | null = null;
        if (iso >= 0 && iso < n) {
          allow = new Set([iso]);
          for (const it of inc[iso]!) allow.add(it.other);
        }
        let shownNodes = 0;
        for (let i = 0; i < n; i++) {
          nHide[i] = (hiddenNode.has(nCategoryId[i]!) || (allow !== null && !allow.has(i))) ? 1 : 0;
          if (!nHide[i]) shownNodes++;
        }
        drawnNodes = shownNodes;
        let shown = 0;
        for (let e = 0; e < m; e++) {
          const vis = !hiddenLink.has(eCategoryId[e]!) && !nHide[eA[e]!] && !nHide[eB[e]!];
          eP2[e * 4 + A_HIDE] = vis ? 0 : 1;
          if (vis) shown++;
        }
        drawnLinks = shown;
        syncNodes(); aEP2.needsUpdate = true;
      }
      refilter();

      // Seeds the camera on the real, measured bounds of the (still
      // spiral-seeded) graph instead of a placeholder guess — see
      // `fitToView`/`autoFit` below for how it keeps tracking those bounds
      // as physics spreads the layout out.
      fitToView();
      camZoom = camT.zoom * INTRO_ZOOM_MULTIPLIER;

      function highlight(idx: number) {
        computeNeighbourhood(neighbourhoodGraph, idx, nDepth, eTierBuf);
        for (let e = 0; e < m; e++) eP2[e * 4 + A_TIER] = eTierBuf[e]!;
        if (idx >= 0) {
          nodeMat.uniforms['uHlStart']!.value = clock;
        }
        syncNodes(); aEP2.needsUpdate = true;
        const f = idx >= 0 ? 1 : 0;
        nodeMat.uniforms['uFocus']!.value = f;
        edgeMat.uniforms['uFocus']!.value = f;
        edgeLiveMat.uniforms['uFocus']!.value = f;
        padMat.uniforms['uFocus']!.value = f;
      }
      function showTip(idx: number, sx: number, sy: number) {
        if (idx < 0 || idx === selIdx) { tip.style.opacity = "0"; tip.dataset['k'] = ""; return; }
        const cat = nodeCategories[nCategoryId[idx]!]!;
        if (tip.dataset['k'] !== String(idx)) {
          tip.dataset['k'] = String(idx);
          tip.textContent = "";
          const a = document.createElement("span");
          a.style.color = cat.color; a.textContent = nodes[idx]!.label;
          const b = document.createElement("span");
          b.style.color = "#3D4C39"; b.textContent = " · " + cat.code + " · " + degree[idx];
          tip.appendChild(a); tip.appendChild(b);
          tip.style.borderLeftColor = cat.color;
        }
        tip.style.transform = "translate3d(" + ((sx + 16) | 0) + "px," + ((sy + 14) | 0) + "px,0)";
        tip.style.opacity = "1";
      }

      function marks() {
        nSel.fill(0);
        if (hoverIdx >= 0) nSel[hoverIdx] = 1;
        if (selIdx >= 0) nSel[selIdx] = 2;
        syncNodes();
      }
      function applySelection(idx: number) {
        selIdx = idx;
        if (idx >= 0) kick(0.22);
        marks();
        highlight(idx >= 0 ? idx : hoverIdx);
        if (idx >= 0 && idx === hoverIdx) showTip(-1, 0, 0);
      }
      const describe = (i: number): GraphNodeSnapshot => {
        // Iterates every declared link category in a fixed order (not
        // discovery order), then drops the empty ones — so the same
        // category always appears in the same position across different
        // nodes' adjacency lists, matching the original's `LINK_KEYS.map()`.
        const groups = linkCategoryIds
          .map((categoryId) => ({
            categoryId,
            rows: inc[i]!
              .filter((it) => it.categoryId === categoryId)
              .map((it) => ({ id: nodes[it.other]!.id, label: nodes[it.other]!.label, categoryId: nCategoryId[it.other]!, out: it.out }))
              .sort((a, b) => a.label.localeCompare(b.label)),
          }))
          .filter((g) => g.rows.length > 0);
        return {
          id: nodes[i]!.id, categoryId: nCategoryId[i]!, label: nodes[i]!.label, hex: hex4(i),
          state: STATE_LABEL[nState[i]!]!, degree: degree[i]!, groups,
        };
      };

      api.current.params = (p) => sim.setParams(p);
      api.current.refilterInternal = () => { refilter(); highlight(selIdx >= 0 ? selIdx : hoverIdx); kick(0.14); };
      api.current.applySelectionInternal = (i) => applySelection(i);
      api.current.reheat = (v) => { sim.reheat(v); kick(0.3); };
      api.current.reseed = () => {
        sim.reseed(); aPos.needsUpdate = true; dirty = true; kick(0.3);
        // A reseed re-scrambles the layout as much as first mount does, so
        // it earns the same auto-tracking sweep back into view — even if
        // the user had already taken the camera over by hand since. Snap
        // the fit filter (not just camT) to the fresh seed's bounds too,
        // or the low-pass in frame() would spend its first second easing
        // away from wherever the old layout happened to leave it.
        autoFit = true; follow = -1;
        fitToView();
        camZoom = camT.zoom * INTRO_ZOOM_MULTIPLIER;
      };
      api.current.getNodeByIndex = (i) => (i >= 0 && i < n ? describe(i) : null);
      function computeBounds(): [number, number, number, number] | null {
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, any = false;
        for (let i = 0; i < n; i++) {
          if (nHide[i]) continue;
          any = true;
          const x = pos[i * 2]!, y = pos[i * 2 + 1]!;
          if (x < x0) x0 = x; if (x > x1) x1 = x;
          if (y < y0) y0 = y; if (y > y1) y1 = y;
        }
        return any ? [x0, y0, x1, y1] : null;
      }
      function applyFit(x0: number, y0: number, x1: number, y1: number) {
        const gw = Math.max(1, x1 - x0), gh = Math.max(1, y1 - y0);
        // Fit into the box the consumer's floating chrome leaves free, not
        // into the whole canvas. Clamped to 64px a side so a dock wider than
        // the viewport degrades to a cramped frame instead of an inverted
        // box (and a division by ~0).
        const ins = fitInsetRef.current;
        const availW = Math.max(64, W - ins.left - ins.right);
        const availH = Math.max(64, H - ins.top - ins.bottom);
        const zoom = Math.min(16, Math.max(0.12, Math.min(availW / (gw * 1.35), availH / (gh * 1.35))));
        // Where that free box's centre sits relative to the canvas centre, in
        // CSS px. Backing the camera off by it is what lands the graph's
        // centre in the middle of the free box rather than the middle of the
        // canvas. dy flips sign because screen +y is down and world +y is up
        // (camera.ts's project()).
        const dx = (ins.left - ins.right) / 2, dy = (ins.top - ins.bottom) / 2;
        camT.zoom = zoom;
        camT.x = (x0 + x1) / 2 - dx / zoom;
        camT.y = (y0 + y1) / 2 + dy / zoom;
      }
      // Function declaration (hoisted), not the arrow-function-on-api
      // pattern used elsewhere here: it's called directly, above, to seed
      // the camera (and the fit filter) before the intro sweep even
      // starts — not just exposed for the consumer's imperative "Fit"
      // button. Applies the exact current bounds, no smoothing: an
      // explicit fit request (or the very first frame) should snap, not
      // ease into place a second time on top of the camera's own easing.
      function fitToView() {
        const b = computeBounds();
        if (!b) return;
        // Releasing the follow is part of fitting, not an extra: framing the
        // whole graph and riding one node are two different camera targets,
        // and the follow block in frame() runs *after* this on every
        // subsequent frame. Left set, it would pan camT straight back onto
        // the followed node — the fit would look like it never happened, for
        // as long as the layout stayed unsettled (right after load, or after
        // a reseed). Same reason onDown/onWheel clear it.
        follow = -1;
        applyFit(b[0], b[1], b[2], b[3]);
        fitX0 = b[0]; fitY0 = b[1]; fitX1 = b[2]; fitY1 = b[3];
      }
      api.current.fit = fitToView;
      // The inset-changed re-frame (see the effect on fitTop/Right/Bottom/Left
      // above the mount effect). Gated on autoFit — the same flag onDown/
      // onWheel clear the moment the reader takes the camera by hand.
      api.current.reframe = () => { if (autoFit) fitToView(); };
      api.current.focus = (i) => {
        if (i < 0 || i >= n) return;
        // Same as onDown's pan branch and onWheel: taking the camera means
        // taking it off the auto-fit leash, or the block in frame() just
        // overwrites camT from the graph bounds on the very next frame
        // (visible as a zoom-to-node that silently does nothing when the
        // layout is still unsettled — right after load, or after reseed()).
        autoFit = false;
        // ...but dropping auto-fit is only half of it: on an unsettled
        // layout the node keeps moving after the click, and a one-shot
        // camT would park the camera on the empty spot the node has since
        // left. Track it per frame instead (see frame()) until it settles
        // or the reader takes the camera by hand.
        follow = i;
        camT.x = pos[i * 2]!; camT.y = pos[i * 2 + 1]!;
        camT.zoom = Math.max(camT.zoom, 2.6);
      };
      // hiddenNodeCategories/hiddenLinkCategories/isolateId are already
      // reflected by the unconditional refilter() call above (the refs it
      // reads are kept current every render, including the first). Initial
      // selectedId still needs applying explicitly: unlike the original,
      // where `selected` always started null in the same component,
      // selectedId is a prop a consumer can pass non-null from first mount.
      applySelection(selectedId === null || selectedId === undefined ? -1 : (idToIndex.get(selectedId) ?? -1));

      let drag = -1, panning = false, moved = false, lastP = { x: 0, y: 0 };
      const el = renderer.domElement;
      const onMove = (ev: PointerEvent) => {
        const rc = el.getBoundingClientRect();
        const sx = ev.clientX - rc.left, sy = ev.clientY - rc.top, w = toWorld(sx, sy);
        sim.cursor(w.x, w.y, true);
        if (drag >= 0) { sim.pin(drag, w.x, w.y); moved = true; return; }
        if (panning) {
          camera.position.x -= (sx - lastP.x) / camZoom;
          camera.position.y += (sy - lastP.y) / camZoom;
          camT.x = camera.position.x; camT.y = camera.position.y;
          lastP = { x: sx, y: sy }; moved = true; return;
        }
        const idx = pickNode(w.x, w.y, n, pos, nRadius, nHide, camZoom);
        if (idx !== hoverIdx) {
          hoverIdx = idx;
          marks();
          if (selIdx < 0) highlight(idx);
          el.style.cursor = idx >= 0 ? "crosshair" : "grab";
        }
        showTip(idx, sx, sy);
      };
      const onDown = (ev: PointerEvent) => {
        try { el.setPointerCapture(ev.pointerId); } catch { /* noop */ }
        const rc = el.getBoundingClientRect();
        const w = toWorld(ev.clientX - rc.left, ev.clientY - rc.top);
        const idx = pickNode(w.x, w.y, n, pos, nRadius, nHide, camZoom);
        moved = false;
        if (idx >= 0) { drag = idx; sim.pin(idx, w.x, w.y); }
        else {
          // Only panning actually moves the camera — dragging a single
          // node doesn't touch it, and un-pausing auto-fit here would let
          // one drag permanently freeze the intro's tracking while the
          // rest of the still-unsettled layout keeps rearranging around it.
          autoFit = false; follow = -1;
          panning = true; lastP = { x: ev.clientX - rc.left, y: ev.clientY - rc.top };
        }
        el.style.cursor = "grabbing";
      };
      const onUp = () => {
        if (drag >= 0) sim.pin(-1, 0, 0);
        drag = -1; panning = false;
        el.style.cursor = hoverIdx >= 0 ? "crosshair" : "grab";
      };
      const onClick = (ev: MouseEvent) => {
        if (moved) return;
        const rc = el.getBoundingClientRect();
        const w = toWorld(ev.clientX - rc.left, ev.clientY - rc.top);
        const idx = pickNode(w.x, w.y, n, pos, nRadius, nHide, camZoom);
        const next = idx >= 0 && idx !== selIdx ? idx : -1;
        onSelect?.(next >= 0 ? describe(next) : null);
      };
      const onWheel = (ev: WheelEvent) => {
        ev.preventDefault();
        autoFit = false; follow = -1;
        const rc = el.getBoundingClientRect();
        const sx = ev.clientX - rc.left, sy = ev.clientY - rc.top;
        // Anchor against the TARGET camera, not the smoothed one. Solving
        // against a lagging camera makes fast scrolls compound their error.
        viewport.curve = opticsRef.current.curve;
        const b = unproject(sx, sy, camT.zoom, camT.x, camT.y, viewport);
        camT.zoom = Math.min(16, Math.max(0.12, camT.zoom * Math.exp(-ev.deltaY * 0.0015)));
        const a = unproject(sx, sy, camT.zoom, camT.x, camT.y, viewport);
        camT.x += b.x - a.x;
        camT.y += b.y - a.y;
      };
      const onLeave = () => {
        sim.cursor(0, 0, false); hoverIdx = -1; marks(); showTip(-1, 0, 0);
        if (selIdx < 0) highlight(-1);
      };
      el.addEventListener("pointermove", onMove);
      el.addEventListener("pointerdown", onDown);
      window.addEventListener("pointerup", onUp);
      el.addEventListener("click", onClick);
      el.addEventListener("pointerleave", onLeave);
      el.addEventListener("wheel", onWheel, { passive: false });
      el.style.cursor = "grab";
      disposers.push(() => {
        el.removeEventListener("pointermove", onMove);
        el.removeEventListener("pointerdown", onDown);
        window.removeEventListener("pointerup", onUp);
        el.removeEventListener("click", onClick);
        el.removeEventListener("pointerleave", onLeave);
        el.removeEventListener("wheel", onWheel);
      });

      let raf = 0, last = performance.now(), accum = 0, dirty = true;
      let fA = 0, fN = 0, fT = 0;
      const screenPos = new Map<number, PlacedLabel>();

      function frame(now: number) {
        raf = requestAnimationFrame(frame);
        const dt = Math.min(0.05, (now - last) / 1000);
        last = now; clock += dt;
        const t0 = performance.now();
        const c = opticsRef.current;
        viewport.curve = c.curve;

        let didStep = false;
        if (runRef.current || drag >= 0) {
          accum += dt; let s = 0;
          while (accum >= 1 / 60 && s < 3) { if (sim.step()) didStep = true; accum -= 1 / 60; s++; }
          if (didStep) { aPos.needsUpdate = true; dirty = true; }
        } else accum = 0;

        // Keeps camT (the target the smoothing below eases toward) tracking
        // the graph's real bounds for as long as the layout is still moving
        // and nobody's grabbed the camera (and only on frames physics
        // actually stepped — with running={false} nothing moved, so the
        // O(n) computeBounds() scan would be pure waste) — the intro sweep is just this
        // running from the first frame, and it stops needing any
        // special-cased "now fit once" call from a consumer because the
        // target it's already tracking lands on the right place on its own.
        // Goes through its own slower low-pass (fitX0../fitY0..) before
        // reaching camT, not the raw instantaneous bounds — see its
        // declaration above for why.
        // Ride the focused node while the layout is still rearranging
        // under it. Once nothing is moving the node won't drift again, so
        // the follow releases and the camera behaves as a plain static
        // target from then on (leaving pan/zoom fully in the reader's
        // hands without needing them to click anything to break out).
        if (follow >= 0) {
          if (sim.isSettled()) follow = -1;
          else if (didStep) { camT.x = pos[follow * 2]!; camT.y = pos[follow * 2 + 1]!; }
        }

        if (autoFit && didStep && !sim.isSettled()) {
          const b = computeBounds();
          if (b) {
            const fsp = 1 - Math.pow(0.25, dt);
            fitX0 += (b[0] - fitX0) * fsp; fitY0 += (b[1] - fitY0) * fsp;
            fitX1 += (b[2] - fitX1) * fsp; fitY1 += (b[3] - fitY1) * fsp;
            applyFit(fitX0, fitY0, fitX1, fitY1);
          }
        }

        const sp = 1 - Math.pow(0.0045, dt);
        camera.position.x += (camT.x - camera.position.x) * sp;
        camera.position.y += (camT.y - camera.position.y) * sp;
        camZoom += (camT.zoom - camZoom) * sp;
        camera.zoom = camZoom; camera.updateProjectionMatrix();
        px = 1 / camZoom;

        onFrameRef.current?.({
          ids: denseIds,
          positions: pos,
          hidden: nHide,
          radii: nRadius,
          camera: { x: camera.position.x, y: camera.position.y, zoom: camZoom },
          viewport,
        });

        if (dirty) {
          for (let e = 0; e < m; e++) {
            const a = eA[e]!, b = eB[e]!;
            eAPos[e * 2] = pos[a * 2]!; eAPos[e * 2 + 1] = pos[a * 2 + 1]!;
            eBPos[e * 2] = pos[b * 2]!; eBPos[e * 2 + 1] = pos[b * 2 + 1]!;
          }
          aEA.needsUpdate = true; aEB.needsUpdate = true;
          dirty = didStep;
        }

        nodeMat.uniforms['uTime']!.value = clock;
        nodeMat.uniforms['uPx']!.value = px;
        nodeMat.uniforms['uGlow']!.value = c.glow;
        for (const mm of [edgeMat, edgeLiveMat]) {
          mm.uniforms['uTime']!.value = clock;
          mm.uniforms['uPx']!.value = px;
          mm.uniforms['uWidth']!.value = c.edgeWidth;
          mm.uniforms['uOpacity']!.value = c.edgeOpacity;
          mm.uniforms['uFlowSpeed']!.value = c.flowSpeed;
        }
        padMat.uniforms['uPx']!.value = px;
        padMat.uniforms['uWidth']!.value = c.edgeWidth;
        padMat.uniforms['uOpacity']!.value = c.edgeOpacity;
        fadeMat.uniforms['uAlpha']!.value = 1 - c.trails * 0.94;

        if (c.glitch > 0 && clock > glitchUntil && Math.random() < 0.0022 * c.glitch) kick(0.10 + Math.random() * 0.22);
        const gActive = clock < glitchUntil ? c.glitch : 0;

        renderer.setRenderTarget(sceneRT);
        renderer.render(scene, camera);

        blurMat.uniforms['uTex']!.value = sceneRT.texture;
        blurMat.uniforms['uDir']!.value.set(1, 0);
        blurMat.uniforms['uThresh']!.value = 0.34;
        fsQuad.material = blurMat;
        renderer.setRenderTarget(bloomA); renderer.clear(); renderer.render(postScene, postCam);
        blurMat.uniforms['uTex']!.value = bloomA.texture;
        blurMat.uniforms['uDir']!.value.set(0, 1);
        blurMat.uniforms['uThresh']!.value = 0.0;
        renderer.setRenderTarget(bloomB); renderer.clear(); renderer.render(postScene, postCam);

        compMat.uniforms['uScene']!.value = sceneRT.texture;
        compMat.uniforms['uBloom']!.value = bloomB.texture;
        compMat.uniforms['uTime']!.value = clock;
        compMat.uniforms['uScan']!.value = c.scan;
        compMat.uniforms['uAberr']!.value = c.aberr;
        compMat.uniforms['uCurve']!.value = c.curve;
        compMat.uniforms['uGrain']!.value = c.grain;
        compMat.uniforms['uBloomAmt']!.value = c.bloom;
        compMat.uniforms['uGlitch']!.value = gActive;
        fsQuad.material = compMat;
        renderer.setRenderTarget(null); renderer.clear(); renderer.render(postScene, postCam);

        /* ------------------------------------------------- label placement
           Anchored via project(), so the label sits at the node's *drawn*
           position and its gap is a constant number of pixels at any zoom.
           A leader tick makes the association explicit when nodes crowd.   */
        labelView.zoom = camZoom;
        labelView.cx = camera.position.x; labelView.cy = camera.position.y;
        labelView.mode = labelModeRef.current;
        labelView.selIdx = selIdx; labelView.hoverIdx = hoverIdx;
        labelPlacer.place(labelView, screenPos);
        for (let k = 0; k < POOL; k++) {
          if (owner[k]! >= 0 && !screenPos.has(owner[k]!)) { owner[k] = -1; labels[k]!.style.opacity = "0"; }
        }
        const held = new Set<number>();
        for (let k = 0; k < POOL; k++) if (owner[k]! >= 0) held.add(owner[k]!);
        let free = 0;
        for (const id of screenPos.keys()) {
          if (held.has(id)) continue;
          while (free < POOL && owner[free]! >= 0) free++;
          if (free >= POOL) break;
          owner[free] = id;
          const cat3 = nodeCategories[nCategoryId[id]!]!;
          const L3 = labels[free]!;
          L3.textContent = nodes[id]!.label;
          L3.style.color = cat3.color;
          // Landmarks read heavier so the eye can find structure without
          // parsing every name on screen.
          L3.style.fontSize = cat3.tier === 0 ? "10.5px" : "9px";
          L3.style.fontWeight = cat3.tier === 0 ? "700" : "500";
          L3.style.letterSpacing = cat3.tier === 0 ? ".16em" : ".08em";
          held.add(id);
        }
        for (let k = 0; k < POOL; k++) {
          const id = owner[k]!;
          if (id < 0) continue;
          const p = screenPos.get(id)!;
          labels[k]!.style.transform = `translate3d(${p[0] | 0}px,${p[1] | 0}px,0)`;
          labels[k]!.style.opacity = String(p[2]);
        }

        fA += 1 / Math.max(dt, 1e-4); fN++; fT += dt;
        if (fT > 0.5) {
          const stats: GraphStats = {
            fps: Math.round(fA / fN), nodes: n, edges: m,
            frameMs: +(performance.now() - t0).toFixed(2), settled: sim.isSettled(),
            drawnNodes, drawnEdges: drawnLinks, vertexAttribs: glCaps.attribs, webglVersion: glCaps.ver as 1 | 2,
          };
          onStatsRef.current?.(stats);
          fA = 0; fN = 0; fT = 0;
        }
      }
      raf = requestAnimationFrame(frame);
      disposers.push(() => cancelAnimationFrame(raf));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, edges, nodeCategories, linkCategories]);

  if (fatal) {
    return (
      <div style={{
        width: "100%", height: "100%", background: FALLBACK_BG, color: FALLBACK_FG,
        padding: 40, font: `400 12px/1.8 ${MONO}`, ...style,
      }} className={className}>
        <div style={{ color: FALLBACK_CRITICAL, letterSpacing: ".24em", marginBottom: 12 }}>▚ SYSTEM HALT</div>
        <div>{fatal}</div>
      </div>
    );
  }

  return (
    <div style={{ position: "relative", width: "100%", height: "100%", background: FALLBACK_BG, overflow: "hidden", ...style }} className={className}>
      <div ref={mountRef} style={{ position: "absolute", inset: 0 }} />
      <div ref={labelRef} style={{ position: "absolute", inset: 0, pointerEvents: "none" }} />
    </div>
  );
});
