import { describe, expect, it } from "vitest";
import { createPhysics } from "./physics.js";

describe("createPhysics", () => {
  it("settles to a stop when there are no forces at all", () => {
    const sim = createPhysics({
      nodes: [{ charge: 1, mass: 1 }, { charge: 1, mass: 1 }],
      edges: [],
    });
    sim.setParams({ repulsion: 0, linkDistance: 1, gravity: 0, damping: 0.5, cursorForce: 0 });
    let steps = 0;
    while (sim.step() && steps < 2000) steps++;
    expect(sim.isSettled()).toBe(true);
  });

  it("pulls two linked nodes toward the configured rest distance", () => {
    const sim = createPhysics({
      nodes: [{ charge: 1, mass: 1 }, { charge: 1, mass: 1 }],
      edges: [{ a: 0, b: 1, dist: 1, strength: 1 }],
    });
    sim.setParams({ repulsion: 0, linkDistance: 50, gravity: 0, damping: 0.6, cursorForce: 0 });
    for (let i = 0; i < 500; i++) sim.step();
    const dx = sim.pos[2]! - sim.pos[0]!, dy = sim.pos[3]! - sim.pos[1]!;
    const d = Math.sqrt(dx * dx + dy * dy);
    // rest distance = eRest(1) * linkDistance(50) = 50 — generous band around it,
    // this is checking convergence toward the target, not exact equilibrium.
    expect(d).toBeGreaterThan(30);
    expect(d).toBeLessThan(70);
  });

  it("repulsion alone pushes two nodes further apart over time", () => {
    const sim = createPhysics({
      nodes: [{ charge: 1, mass: 1 }, { charge: 1, mass: 1 }],
      edges: [],
    });
    sim.setParams({ repulsion: 900, linkDistance: 1, gravity: 0, damping: 0.6, cursorForce: 0 });
    const before = Math.hypot(sim.pos[2]! - sim.pos[0]!, sim.pos[3]! - sim.pos[1]!);
    for (let i = 0; i < 200; i++) sim.step();
    const after = Math.hypot(sim.pos[2]! - sim.pos[0]!, sim.pos[3]! - sim.pos[1]!);
    expect(after).toBeGreaterThan(before);
  });

  it("gravity alone pulls a node back toward the origin", () => {
    const sim = createPhysics({ nodes: [{ charge: 1, mass: 1 }], edges: [] });
    sim.pin(-1, 0, 0); // no-op, just confirms pin(-1,...) doesn't throw
    sim.setParams({ repulsion: 0, linkDistance: 1, gravity: 0.05, damping: 0.6, cursorForce: 0 });
    const before = Math.hypot(sim.pos[0]!, sim.pos[1]!);
    for (let i = 0; i < 300; i++) sim.step();
    const after = Math.hypot(sim.pos[0]!, sim.pos[1]!);
    expect(after).toBeLessThan(before);
  });

  it("pin locks a node's position through subsequent steps", () => {
    const sim = createPhysics({
      nodes: [{ charge: 1, mass: 1 }, { charge: 1, mass: 1 }],
      edges: [{ a: 0, b: 1, dist: 1, strength: 1 }],
    });
    sim.setParams({ repulsion: 900, linkDistance: 78, gravity: 0.02, damping: 0.6, cursorForce: 0 });
    sim.pin(0, 123, -45);
    for (let i = 0; i < 50; i++) sim.step();
    expect(sim.pos[0]).toBeCloseTo(123);
    expect(sim.pos[1]).toBeCloseTo(-45);
  });

  it("radius force pulls a node toward its target ring instead of the origin, overriding plain gravity", () => {
    const sim = createPhysics({ nodes: [{ charge: 1, mass: 1, radiusTarget: 150 }], edges: [] });
    sim.pin(0, 400, 0); // start well outside the target ring
    sim.step();
    sim.pin(-1, 0, 0);
    sim.setParams({ repulsion: 0, linkDistance: 1, gravity: 0.05, damping: 0.6, cursorForce: 0, radiusForce: 0.05 });
    for (let i = 0; i < 400; i++) sim.step();
    const r = Math.hypot(sim.pos[0]!, sim.pos[1]!);
    expect(r).toBeGreaterThan(100); // didn't collapse to the origin despite gravity being on
    expect(r).toBeLessThan(200); // converged near its 150-unit target, not still out at 400
  });

  // The bound above is deliberately loose (it only proves "moved most of the
  // way"); this one proves the thing that actually matters — that the ring
  // spring *converges*, rather than running out of schedule partway there.
  // It's the regression guard for sectorForce/radiusForce having their own
  // slower decay: put them back on the shared `alpha` and a node this far
  // out stalls ~9 units short, and the shortfall grows with displacement.
  it("radius force converges from a large displacement, not just partway", () => {
    for (const start of [500, 900, 1400]) {
      const sim = createPhysics({ nodes: [{ charge: 1, mass: 1, radiusTarget: 150 }], edges: [] });
      sim.pin(0, start, 0);
      sim.step();
      sim.pin(-1, 0, 0);
      sim.setParams({ repulsion: 0, linkDistance: 1, gravity: 0.05, damping: 0.62, cursorForce: 0, radiusForce: 0.05 });
      let steps = 0;
      while (sim.step() && steps < 5000) steps++;
      const r = Math.hypot(sim.pos[0]!, sim.pos[1]!);
      // Within 1% of the target ring, regardless of how far out it started —
      // the residual must not scale with the initial displacement.
      expect(Math.abs(r - 150)).toBeLessThan(1.5);
    }
  });

  // The radial spring's stability depends on `damping`, which is a
  // consumer-set prop: the critical stiffness is (1-sqrt(damp))^2/damp, so
  // radiusForce 0.05 is merely sluggish at the default 0.62 but sits far
  // above critical at 0.90. Without the radial damping term this overshoots
  // the ring by ~66 units before springing back.
  it("radius force does not overshoot its ring, even at low-friction damping", () => {
    const sim = createPhysics({ nodes: [{ charge: 1, mass: 1, radiusTarget: 150 }], edges: [] });
    sim.pin(0, 650, 0);
    sim.step();
    sim.pin(-1, 0, 0);
    sim.setParams({ repulsion: 0, linkDistance: 1, gravity: 0.05, damping: 0.9, cursorForce: 0, radiusForce: 0.05 });
    let steps = 0, minR = Infinity;
    while (sim.step() && steps < 5000) {
      minR = Math.min(minR, Math.hypot(sim.pos[0]!, sim.pos[1]!));
      steps++;
    }
    // Approaches from outside and stops — never crosses meaningfully past
    // the ring on its way in.
    expect(minR).toBeGreaterThan(150 - 5);
    expect(Math.abs(Math.hypot(sim.pos[0]!, sim.pos[1]!) - 150)).toBeLessThan(1.5);
  });

  it("radius force is inert at zero, even on a node carrying a radiusTarget — falls back to plain gravity", () => {
    const sim = createPhysics({ nodes: [{ charge: 1, mass: 1, radiusTarget: 150 }], edges: [] });
    sim.pin(0, 400, 0);
    sim.step();
    sim.pin(-1, 0, 0);
    sim.setParams({ repulsion: 0, linkDistance: 1, gravity: 0.05, damping: 0.6, cursorForce: 0, radiusForce: 0 });
    const before = Math.hypot(sim.pos[0]!, sim.pos[1]!);
    for (let i = 0; i < 300; i++) sim.step();
    const after = Math.hypot(sim.pos[0]!, sim.pos[1]!);
    expect(after).toBeLessThan(before); // gravity, not a 150-unit ring, is pulling it in
  });

  it("sector force rotates a node's angle toward its target while roughly preserving its radius", () => {
    const sim = createPhysics({ nodes: [{ charge: 1, mass: 1, sectorAngle: Math.PI / 2 }], edges: [] });
    sim.pin(0, 100, 0); // place it on the +x axis — 90° from its +y-axis target
    sim.step();
    sim.pin(-1, 0, 0); // release
    sim.setParams({ repulsion: 0, linkDistance: 1, gravity: 0, damping: 0.6, cursorForce: 0, sectorForce: 0.02 });
    const before = { x: sim.pos[0]!, y: sim.pos[1]! };
    for (let i = 0; i < 300; i++) sim.step();
    const after = { x: sim.pos[0]!, y: sim.pos[1]! };
    const angleBefore = Math.atan2(before.y, before.x), angleAfter = Math.atan2(after.y, after.x);
    expect(Math.abs(Math.PI / 2 - angleAfter)).toBeLessThan(Math.abs(Math.PI / 2 - angleBefore));
    // Not merely closer — actually arrived. Within 2 degrees of the target
    // arm; on the shared `alpha` schedule a 90-degree correction stalls
    // short instead of completing.
    expect(Math.abs(Math.PI / 2 - angleAfter)).toBeLessThan((2 * Math.PI) / 180);
    const rBefore = Math.hypot(before.x, before.y), rAfter = Math.hypot(after.x, after.y);
    expect(rAfter).toBeGreaterThan(rBefore * 0.5);
    expect(rAfter).toBeLessThan(rBefore * 1.5);
  });

  it("sector force is inert at zero, even on a node carrying a sectorAngle", () => {
    const sim = createPhysics({ nodes: [{ charge: 1, mass: 1, sectorAngle: Math.PI / 2 }], edges: [] });
    sim.pin(0, 100, 0);
    sim.step();
    sim.pin(-1, 0, 0);
    sim.setParams({ repulsion: 0, linkDistance: 1, gravity: 0, damping: 0.6, cursorForce: 0, sectorForce: 0 });
    for (let i = 0; i < 100; i++) sim.step();
    expect(sim.pos[1]).toBeCloseTo(0, 5); // never nudged off the x-axis
  });

  it("reheat un-settles a settled simulation", () => {
    const sim = createPhysics({ nodes: [{ charge: 1, mass: 1 }], edges: [] });
    sim.setParams({ repulsion: 0, linkDistance: 1, gravity: 0, damping: 0.5, cursorForce: 0 });
    while (sim.step()) { /* run to settled */ }
    expect(sim.isSettled()).toBe(true);
    sim.reheat(1);
    expect(sim.isSettled()).toBe(false);
  });
});
