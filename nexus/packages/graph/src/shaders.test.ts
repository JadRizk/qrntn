import { describe, expect, it } from 'vitest'
import { DEFAULT_ARC_BOW, EDGE_ATTRS, MAX_ARC_BOW, ROUTE_ETCHED, encodeRouting } from './shaders.js'

/**
 * `iP0.y` carries two things at once: which route an edge takes, and — for an
 * arc — which side it bows to. The shader dispatches on it, so these tests
 * mirror that dispatch exactly. Any change to one has to be made in both.
 */
const dispatch = (v: number): 'etched' | 'arc' | 'straight' =>
  v < -900 ? 'etched' : Math.abs(v) > 0.001 ? 'arc' : 'straight'

describe('routing is encoded into a single float without the modes colliding', () => {
  it('round-trips each routing back to itself', () => {
    expect(dispatch(encodeRouting('etched', 0))).toBe('etched')
    expect(dispatch(encodeRouting('arc', DEFAULT_ARC_BOW))).toBe('arc')
    expect(dispatch(encodeRouting('straight', 0))).toBe('straight')
  })

  it('an arc bowed to either side is still an arc', () => {
    // The regression this exists for: GraphCanvas alternates the bow's sign so
    // adjacent arcs do not overlap, and an earlier encoding marked `etched`
    // with a plain -1. Every odd-indexed arc therefore got a negative bow and
    // was silently drawn as an etched trace — half of every semantic edge.
    for (const side of [1, -1]) {
      expect(dispatch(encodeRouting('arc', DEFAULT_ARC_BOW * side))).toBe('arc')
    }
  })

  it('no bow an arc can request can reach the etched sentinel', () => {
    for (const bow of [MAX_ARC_BOW, -MAX_ARC_BOW, 10, -10, -999, -1e9]) {
      expect(dispatch(encodeRouting('arc', bow))).toBe('arc')
    }
    expect(Math.abs(ROUTE_ETCHED)).toBeGreaterThan(MAX_ARC_BOW * 100)
  })

  it('an absent routing falls back to straight, ignoring any bow', () => {
    expect(dispatch(encodeRouting(undefined, 0.9))).toBe('straight')
  })

  it('every per-edge attribute fits one vec4 slot', () => {
    // Seven attributes including `position` is the WebGL1 guaranteed minimum;
    // a program over it fails to LINK and draws nothing, silently.
    for (const size of Object.values(EDGE_ATTRS)) {
      expect(size).toBeGreaterThan(0)
      expect(size).toBeLessThanOrEqual(4)
    }
  })
})
