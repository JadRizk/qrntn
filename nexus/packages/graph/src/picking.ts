/* ============================================================================
   PICKING

   Moved out of GraphCanvas.tsx's `pickNode(wx, wy)`. Nearest node whose
   distance is inside `radius + grab`, where `grab` is a screen-space grab
   margin that shrinks as you zoom in and stops shrinking at a 5-unit floor.
   ========================================================================== */

/**
 * @param x world-space x.
 * @param y world-space y.
 * @param count number of nodes.
 * @param pos length count*2, interleaved x,y per node.
 * @param radii length count, per-node radius.
 * @param hidden length count. 1 = hidden, 0 = visible. A hidden node is never picked.
 * @param zoom current camera zoom.
 * @returns the picked node's index, or -1.
 */
export function pickNode(x: number, y: number, count: number, pos: Float32Array, radii: Float32Array, hidden: Float32Array, zoom: number): number {
  let best = -1, bd = Infinity;
  const grab = Math.max(5, 12 / zoom);
  for (let i = 0; i < count; i++) {
    if (hidden[i] !== 0) continue;
    const dx = pos[i * 2]! - x, dy = pos[i * 2 + 1]! - y;
    const d2 = dx * dx + dy * dy, r = radii[i]! + grab;
    if (d2 < r * r && d2 < bd) { bd = d2; best = i; }
  }
  return best;
}
