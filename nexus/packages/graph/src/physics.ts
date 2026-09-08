/* ============================================================================
   PHYSICS

   Moved from NexusCyberdeck.jsx. The stepping numerics are byte-for-byte
   identical to the original — the only real change is the input shape:
   the original `createPhysics(G)` read `NODE_TYPES[G.nodes[i].type]` and
   `LINK_TYPES[G.edges[e].type]` directly from module-global lookup tables,
   which made it silently coupled to one specific taxonomy despite already
   being framework-agnostic (Float32Array-based) everywhere else. This
   version takes already-resolved per-node charge/mass and per-edge
   dist/strength instead, and computes `degree` itself from the edge list
   (previously computed by the caller and passed in) rather than requiring
   the consumer to precompute a graph-structural property the physics
   already needs to derive for itself.
   ========================================================================== */

export interface PhysicsNode {
  charge: number;
  mass: number;
  /** Radians. When set, the node feels a gentle tangential force rotating it toward this angle (measured from the origin) — a soft "stay in your arm/sector" bias, layered on top of repulsion/spring/gravity rather than replacing them. Radius is untouched; only angular position is nudged. Undefined means no bias, so a consumer that never sets this (e.g. the generic showcase) sees no behavior change. */
  sectorAngle?: number;
  /** World units. When set, the node feels a radial spring toward this distance from the origin — the "which ring" counterpart to sectorAngle's "which arm". A node that has one uses this instead of the generic linear gravity (see radiusForce), not in addition to it: two separate always-on inward pulls competing over the same radius would just settle at neither. Undefined means no target, so the node keeps ordinary gravity-to-origin. */
  radiusTarget?: number;
}

export interface PhysicsEdge {
  /** Node index, not id — the caller resolves ids to dense indices. */
  a: number;
  b: number;
  dist: number;
  strength: number;
}

export interface PhysicsGraph {
  nodes: readonly PhysicsNode[];
  edges: readonly PhysicsEdge[];
}

export interface PhysicsParams {
  repulsion: number;
  linkDistance: number;
  gravity: number;
  damping: number;
  cursorForce: number;
  /** Strength of the per-node sectorAngle bias (0 disables it outright, regardless of which nodes carry a sectorAngle). */
  sectorForce: number;
  /** Strength of the per-node radiusTarget spring (0 disables it — a node with a radiusTarget falls back to ordinary gravity when this is 0, same as if it had no target at all). */
  radiusForce: number;
}

export interface Physics {
  /** Live position buffer, `[x0, y0, x1, y1, ...]`. Mutated in place by step(). */
  pos: Float32Array;
  /** Advances one fixed timestep. Returns false when settled and idle (nothing to redraw). */
  step(): boolean;
  isSettled(): boolean;
  /** Partial physics params, plus an optional `settle` alpha-target (0 = come to rest, >0 = keep simmering). */
  setParams(p: Partial<PhysicsParams> & { settle?: number }): void;
  reheat(v: number): void;
  /** Re-randomizes every node's position (same seeding formula as initial layout) and un-settles the solver — a fresh arrangement of the same graph. */
  reseed(): void;
  /** i < 0 releases the pin. */
  pin(i: number, x: number, y: number): void;
  cursor(x: number, y: number, on: boolean): void;
}

/** Edge count touching each node index. Shared by createPhysics (edge stiffness) and GraphCanvas (node radius, orphan-state derivation) so there's exactly one place this gets computed. */
export function computeDegree(edges: ReadonlyArray<{ a: number; b: number }>, nodeCount: number): Uint16Array {
  const degree = new Uint16Array(nodeCount);
  for (const e of edges) { degree[e.a]!++; degree[e.b]!++; }
  return degree;
}

export function createPhysics(graph: PhysicsGraph): Physics {
  const n = graph.nodes.length, m = graph.edges.length;
  const degree = computeDegree(graph.edges, n);

  const pos = new Float32Array(n * 2), vel = new Float32Array(n * 2);
  const fx = new Float32Array(n), fy = new Float32Array(n);
  const charge = new Float32Array(n), mass = new Float32Array(n);
  const sector = new Float32Array(n), hasSector = new Uint8Array(n);
  const radiusTarget = new Float32Array(n), hasRadiusTarget = new Uint8Array(n);
  const eA = new Uint32Array(m), eB = new Uint32Array(m);
  const eRest = new Float32Array(m), eK = new Float32Array(m);
  const eWA = new Float32Array(m), eWB = new Float32Array(m);

  // A node with a sectorAngle/radiusTarget seeds *near* that polar
  // position instead of the generic spiral — sectorForce/radiusForce alone
  // aren't enough to guarantee it gets there: both are alpha-scaled like
  // every other force here, so they only get a few seconds of real effect
  // before the solver calls itself settled (see the `alpha` decay below),
  // and a category or skill that repulsion happened to fling far from its
  // ring during that window has no time left to migrate back. Starting
  // close means physics only has to do local relaxation (spacing,
  // un-overlapping) — the ring/arm structure is correct from frame one,
  // not something the sim has to fight its way back to. Nodes with no
  // target (leaf, scriptFold) keep the old generic spiral; they converge
  // fast regardless, via the short/stiff `contains` spring to their parent.
  //
  // "Near", not "at": the jitter below is real random spread (±20 degrees
  // of arc, ±35 units of radius — a good third of a typical wedge/ring),
  // re-rolled on every call. reseed() calls this same function, so a
  // reseed reshuffles each node to a new spot within its own wedge/ring —
  // genuinely different every time — rather than snapping back to
  // essentially one fixed point with only cosmetic wobble, which is what a
  // small fixed cartesian nudge here would produce for any node whose
  // sectorAngle/radiusTarget don't themselves change between reseeds.
  const SEED_ANGLE_JITTER = (40 * Math.PI) / 180;
  const SEED_RADIUS_JITTER = 70;
  function seedPositions(): void {
    for (let i = 0; i < n; i++) {
      const node = graph.nodes[i]!;
      const hasTarget = node.sectorAngle !== undefined || node.radiusTarget !== undefined;
      const baseA = node.sectorAngle ?? (i / n) * Math.PI * 10;
      const baseR = node.radiusTarget ?? 30 + Math.sqrt(i) * 9;
      const a = hasTarget ? baseA + (Math.random() - 0.5) * SEED_ANGLE_JITTER : baseA;
      const r = hasTarget ? baseR + (Math.random() - 0.5) * SEED_RADIUS_JITTER : baseR;
      pos[i * 2] = Math.cos(a) * r + (hasTarget ? 0 : (Math.random() - 0.5) * 20);
      pos[i * 2 + 1] = Math.sin(a) * r + (hasTarget ? 0 : (Math.random() - 0.5) * 20);
    }
  }
  for (let i = 0; i < n; i++) {
    const node = graph.nodes[i]!;
    charge[i] = node.charge; mass[i] = node.mass;
    if (node.sectorAngle !== undefined) { sector[i] = node.sectorAngle; hasSector[i] = 1; }
    if (node.radiusTarget !== undefined) { radiusTarget[i] = node.radiusTarget; hasRadiusTarget[i] = 1; }
  }
  seedPositions();
  // Stiffness normalised by degree, or a 35-link hub diverges under Euler.
  for (let e = 0; e < m; e++) {
    const edge = graph.edges[e]!, a = edge.a, b = edge.b;
    const da = Math.max(1, degree[a]!), db = Math.max(1, degree[b]!);
    eA[e] = a; eB[e] = b; eRest[e] = edge.dist;
    eK[e] = edge.strength / Math.min(da, db);
    eWA[e] = db / (da + db); eWB[e] = da / (da + db);
  }

  let alpha = 1, alphaTarget = 0, settled = false;
  const A_MIN = 0.0015, A_DECAY = 0.0208;
  // sectorForce/radiusForce run on their own, slower-decaying schedule
  // rather than sharing `alpha` with repulsion/links/gravity. Those three
  // are exploratory — `alpha` is an annealing temperature, and decaying it
  // is what makes the layout stop wandering and freeze. The other two are
  // structural *constraints*: "this node belongs on that ring, in that
  // arm" stays just as true at second five as at second one, so annealing
  // them away means a node still travelling toward its ring loses the
  // force carrying it there before it arrives. Measured, at damping 0.62
  // with radiusForce 0.05: a node 500 units off its ring stalled ~9 units
  // short, one 750 units off stalled ~20 short, and the residual grew with
  // displacement — it never converged, it just ran out of alpha.
  //
  // Still decays, just ~6x slower, and that matters: repulsion is what
  // keeps nodes sharing one arm *and* one ring from stacking on the exact
  // same point, and it dies on the `alpha` schedule. A constraint force
  // that outlived it entirely would squeeze a category's skills together
  // into a single dot. Six is the measured knee — fast enough to converge
  // well inside the settle window, slow enough that nearest-neighbour
  // spacing within a ring is unchanged from before this schedule existed.
  const S_DECAY = A_DECAY / 6;
  let structAlpha = 1;
  const P: PhysicsParams = { repulsion: 900, linkDistance: 78, gravity: 0.028, damping: 0.62, cursorForce: 0, sectorForce: 0, radiusForce: 0 };
  let pinIdx = -1, pinX = 0, pinY = 0, curX = 0, curY = 0, curOn = false;

  function step(): boolean {
    if (settled && pinIdx < 0 && !(curOn && P.cursorForce !== 0)) return false;
    fx.fill(0); fy.fill(0);
    const k = P.repulsion * alpha;
    for (let i = 0; i < n; i++) {
      const xi = pos[i * 2]!, yi = pos[i * 2 + 1]!, ci = charge[i]!;
      for (let j = i + 1; j < n; j++) {
        let dx = pos[j * 2]! - xi, dy = pos[j * 2 + 1]! - yi;
        let d2 = dx * dx + dy * dy;
        if (d2 < 1e-3) { dx = Math.random() - 0.5; dy = Math.random() - 0.5; d2 = dx * dx + dy * dy + 1e-3; }
        const f = (k * ci * charge[j]!) / (d2 * Math.sqrt(d2));
        const ax = dx * f, ay = dy * f;
        fx[i]! -= ax; fy[i]! -= ay; fx[j]! += ax; fy[j]! += ay;
      }
    }
    for (let e = 0; e < m; e++) {
      const a = eA[e]!, b = eB[e]!;
      let dx = pos[b * 2]! - pos[a * 2]!, dy = pos[b * 2 + 1]! - pos[a * 2 + 1]!;
      let d = Math.sqrt(dx * dx + dy * dy);
      if (d < 1e-4) { dx = Math.random() - 0.5; dy = Math.random() - 0.5; d = 1e-2; }
      const f = ((d - eRest[e]! * P.linkDistance) / d) * eK[e]! * alpha;
      fx[a]! += dx * f * eWA[e]!; fy[a]! += dy * f * eWA[e]!;
      fx[b]! -= dx * f * eWB[e]!; fy[b]! -= dy * f * eWB[e]!;
    }
    const g = P.gravity * alpha, damp = P.damping, cf = P.cursorForce;
    const sf = P.sectorForce * structAlpha;
    const rf = P.radiusForce * structAlpha;
    let maxS = 0;
    for (let i = 0; i < n; i++) {
      const x = pos[i * 2]!, y = pos[i * 2 + 1]!;
      // A node with a radiusTarget gets a spring toward that ring instead
      // of the generic linear pull-to-origin — see radiusTarget's own
      // comment on why these two don't stack. rf === 0 (radiusForce off)
      // still falls through to ordinary gravity, so a target with no force
      // behind it behaves exactly like having no target at all.
      if (rf !== 0 && hasRadiusTarget[i] !== 0) {
        const r = Math.sqrt(x * x + y * y);
        if (r > 1e-3) {
          const nx = x / r, ny = y / r;
          const pull = (r - radiusTarget[i]!) * rf;
          fx[i]! -= nx * pull; fy[i]! -= ny * pull;
          // Anti-overshoot, on the radial axis only. This spring's
          // stability depends on `damping`, which is a consumer-set prop
          // on a reusable package, not a constant: solving the step
          // recurrence gives a critical stiffness of (1-sqrt(damp))^2/damp
          // — 0.073 at the default damping 0.62, but only 0.003 at damping
          // 0.90. So the same radiusForce that is merely sluggish at the
          // default *rings* at low friction (measured: a node released 500
          // units out overshoots its ring by 66 units at damping 0.90).
          // Cancel that with a velocity term sized to critically damp the
          // radial mode at whatever damping is actually in force.
          //
          // Clamped at zero, deliberately. Below the critical stiffness the
          // exact solution wants a *negative* coefficient — it would speed
          // convergence by cancelling part of the global friction, and in a
          // one-node test that looks free. It isn't: this node also carries
          // repulsion and link springs on the same axis, and quietly
          // removing their friction trades a settling bug for a stability
          // one. Under-damping is a slow ring; anti-damping is a blow-up.
          // Convergence is the schedule's job (see S_DECAY above); this
          // term's only job is to never overshoot.
          const dk = damp * (rf / mass[i]!);
          const c = dk < 1 ? 1 - Math.pow(1 - Math.sqrt(dk), 2) / damp : 1;
          if (c > 0) {
            const vr = vel[i * 2]! * nx + vel[i * 2 + 1]! * ny;
            const f = c * vr * mass[i]!;
            fx[i]! -= nx * f; fy[i]! -= ny * f;
          }
        }
      } else {
        fx[i]! -= x * g; fy[i]! -= y * g;
      }
      if (curOn && cf !== 0) {
        const dx = x - curX, dy = y - curY, d2 = dx * dx + dy * dy + 60;
        const inv = (cf * 14000) / (d2 * Math.sqrt(d2));
        fx[i]! += dx * inv; fy[i]! += dy * inv;
      }
      // Sector bias: a torque-like nudge toward this node's assigned arm
      // angle, magnitude scaled by radius (so the correction is roughly
      // rotation-consistent regardless of how far out the node sits) and
      // clamped past 260 units to keep far-flung outliers from getting an
      // outsized shove. Purely tangential — never touches radial distance,
      // so it composes with repulsion/gravity instead of fighting them.
      if (sf !== 0 && hasSector[i] !== 0) {
        const r = Math.sqrt(x * x + y * y);
        if (r > 1e-3) {
          const theta = Math.atan2(y, x);
          let d = sector[i]! - theta;
          d -= Math.PI * 2 * Math.round(d / (Math.PI * 2));
          const mag = sf * d * Math.min(r, 260);
          fx[i]! += -Math.sin(theta) * mag;
          fy[i]! += Math.cos(theta) * mag;
        }
      }
      const im = 1 / mass[i]!;
      let vx = (vel[i * 2]! + fx[i]! * im) * damp, vy = (vel[i * 2 + 1]! + fy[i]! * im) * damp;
      const s2 = vx * vx + vy * vy;
      if (s2 > 400) { const s = 20 / Math.sqrt(s2); vx *= s; vy *= s; }
      if (s2 > maxS) maxS = s2;
      vel[i * 2] = vx; vel[i * 2 + 1] = vy;
      pos[i * 2] = x + vx; pos[i * 2 + 1] = y + vy;
    }
    if (pinIdx >= 0) {
      pos[pinIdx * 2] = pinX; pos[pinIdx * 2 + 1] = pinY;
      vel[pinIdx * 2] = 0; vel[pinIdx * 2 + 1] = 0;
    }
    alpha += (alphaTarget - alpha) * A_DECAY;
    structAlpha += (alphaTarget - structAlpha) * S_DECAY;
    if ((alpha < A_MIN || (Math.sqrt(maxS) < 0.004 && alpha < 0.06)) && alphaTarget < A_MIN) {
      settled = true; vel.fill(0);
    }
    return true;
  }
  return {
    pos, step,
    isSettled: () => settled,
    setParams(p) {
      Object.assign(P, p);
      if ("settle" in p) alphaTarget = p.settle ?? 0;
      settled = false; alpha = Math.max(alpha, 0.28); structAlpha = Math.max(structAlpha, 0.28);
    },
    reheat(v) { settled = false; alpha = Math.max(alpha, v); structAlpha = Math.max(structAlpha, v); },
    reseed() {
      pinIdx = -1;
      seedPositions();
      vel.fill(0);
      settled = false; alpha = 1; structAlpha = 1;
    },
    pin(i, x, y) { pinIdx = i; pinX = x; pinY = y; if (i >= 0) { settled = false; alpha = Math.max(alpha, 0.35); structAlpha = Math.max(structAlpha, 0.35); } },
    cursor(x, y, on) { curX = x; curY = y; curOn = on; },
  };
}
