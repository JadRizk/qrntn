import { describe, expect, it } from "vitest";
import { pickNode } from "./picking.js";

describe("pickNode", () => {
  it("picks a node when the point is inside its radius, and misses when well outside", () => {
    const pos = new Float32Array([0, 0]);
    const radii = new Float32Array([10]);
    const hidden = new Float32Array([0]);
    expect(pickNode(2, 0, 1, pos, radii, hidden, 1)).toBe(0);
    expect(pickNode(500, 500, 1, pos, radii, hidden, 1)).toBe(-1);
  });

  it("with two overlapping candidates, the nearer centre wins, not the first in index order", () => {
    // Index 0 is farther from the query point than index 1, but both
    // radii cover it — the distance comparison, not iteration order, must decide.
    const pos = new Float32Array([0, 0, 5, 0]);
    const radii = new Float32Array([20, 20]);
    const hidden = new Float32Array([0, 0]);
    expect(pickNode(5, 0, 2, pos, radii, hidden, 1)).toBe(1);
  });

  it("never picks a hidden node, even when it is nearest and a visible node is further away", () => {
    const pos = new Float32Array([0, 0, 20, 0]);
    const radii = new Float32Array([10, 10]);
    const hidden = new Float32Array([1, 0]); // node 0 (nearest) hidden
    expect(pickNode(2, 0, 2, pos, radii, hidden, 1)).toBe(1);
  });

  it("the grab margin scales with zoom, and stops shrinking at the 5-unit floor", () => {
    const pos = new Float32Array([0, 0]);
    const radii = new Float32Array([10]);
    const hidden = new Float32Array([0]);
    // 3 units outside the radius (13 total): at zoom 1, grab = 12, well within reach.
    expect(pickNode(13, 0, 1, pos, radii, hidden, 1)).toBe(0);
    // At high zoom (60), 12/zoom -> 0.2, floored to 5: still within the 5-unit margin...
    expect(pickNode(14.5, 0, 1, pos, radii, hidden, 60)).toBe(0);
    // ...but not beyond it, and the floor stops it from shrinking further.
    expect(pickNode(16, 0, 1, pos, radii, hidden, 60)).toBe(-1);
    expect(pickNode(16, 0, 1, pos, radii, hidden, 6000)).toBe(-1);
  });
});
