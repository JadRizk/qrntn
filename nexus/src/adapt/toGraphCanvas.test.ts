// adapt/toGraphCanvas.ts — the measured register, as the engine receives it.
//
// taxonomy.ts states the design; this is the translation of it into the
// LinkCategory the canvas actually draws, which is where a register's
// constants become pixels and springs. The assertions are about the two
// properties a measured edge must keep to be honest, and neither is visible
// from the taxonomy alone.

import { describe, expect, it } from 'vitest'

import { LINK_CATEGORY } from './toGraphCanvas.ts'
import { EDGE_TAXONOMY } from '../data/taxonomy.ts'

describe('the measured link category', () => {
  it('exists for every kind the taxonomy names', () => {
    for (const kind of Object.keys(EDGE_TAXONOMY)) expect(LINK_CATEGORY).toHaveProperty(kind)
  })

  it('reaches the canvas dimmer and thinner than the claims it sits beside', () => {
    // Same arc, much less ink. An overlap drawn at a declaration's intensity
    // is a number this tool computed wearing the clothes of something a person
    // asserted.
    const measured = LINK_CATEGORY['overlaps']
    const claim = LINK_CATEGORY['alternative']
    expect(measured?.routing).toBe(claim?.routing)
    expect(measured?.gain).toBeLessThan(claim?.gain ?? 0)
    expect(measured?.width).toBeLessThan(claim?.width ?? 0)
    // Segmented, like the other advisory kinds: this is not binding.
    expect(measured?.dash).toBeGreaterThan(0)
  })

  it('pulls almost nothing, so the measure cannot rearrange what it measures', () => {
    // The layout is built out of what the collection declares about itself. A
    // spring strong enough to drag two skills together because their
    // descriptions share vocabulary would leave the reader looking at a
    // picture of the lexical scoring instead of at the library — and the
    // picture would then confirm the measurement by construction.
    const measured = LINK_CATEGORY['overlaps']
    for (const [kind, spec] of Object.entries(LINK_CATEGORY)) {
      if (kind === 'overlaps') continue
      expect(measured?.strength).toBeLessThan(spec.strength ?? 0)
    }
  })
})
