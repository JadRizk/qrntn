// pratiq.contract.test.ts — brand/PALETTE.md and pratiq.css must agree.
//
// WHY THIS EXISTS, stated plainly because it is a correction rather than a
// precaution. PALETTE.md's own header calls the role table "the contract" an
// implementation reads to emit tokens. It shipped naming 23 `--pq-*` tokens of
// which 4 existed. Every colour in it was measured, reproducible and correct —
// and an implementation following it would have written `var(--pq-ink)` and got
// nothing, because the *names* were never checked against anything.
//
// The colours had a validator. The vocabulary had nobody. This is the missing
// half, and it is the same shape as the record-schema gate: a document that is
// committed and not checked is a document that drifts.
//
// It reads both files as text on purpose. Importing the CSS would prove only
// that a bundler can parse it, not that the token a human is told to type is
// one a browser will resolve.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { contrast, themeMeetsAA, WCAG } from './index.ts'

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')

const CSS = read('./pratiq.css')
const PALETTE = read('../../../../brand/PALETTE.md')
const INDEX_HTML = read('../../../index.html')

/** Tokens the stylesheet actually DECLARES — `--pq-foo:`, not a mention. */
const declared = new Set(
  [...CSS.matchAll(/(--pq-[a-z0-9-]+)\s*:/g)].map((m) => m[1] as string)
)

/**
 * Tokens the document NAMES. Deliberately greedy: prose counts. A document that
 * spells a variable a reader could copy is making a promise about it, and the
 * fix for a mention that is not a promise is to not spell it — which is why
 * PALETTE.md says "no `line-strong` colour token" rather than naming one.
 */
const documented = new Set(
  [...PALETTE.matchAll(/(--pq-[a-z0-9-]+)/g)].map((m) => m[1] as string)
)

describe('the --pq-* contract', () => {
  it('declares something at all — a silent regex is not a passing gate', () => {
    expect(declared.size).toBeGreaterThan(20)
    expect(documented.size).toBeGreaterThan(20)
  })

  it('declares every token PALETTE.md tells an implementation to use', () => {
    const missing = [...documented].filter((t) => !declared.has(t)).sort()
    expect(missing, `documented in PALETTE.md, declared nowhere: ${missing.join(', ')}`).toEqual([])
  })

  it('documents every token it declares', () => {
    // The other direction, and not symmetry for its own sake: an undeclared
    // token is a broken instruction, an undocumented one is a private API that
    // consumers will find and depend on anyway.
    const undocumented = [...declared].filter((t) => !documented.has(t)).sort()
    expect(undocumented, `declared in pratiq.css, documented nowhere: ${undocumented.join(', ')}`).toEqual([])
  })
})

describe('the ramps', () => {
  // Both ramps, because the viewer ships the immersive one and PALETTE.md
  // originally tabled only the AA one — so a reader checking what runs got the
  // wrong numbers with no way to know.
  const ramps = {
    pratiq: ['#38352D', '#625E4F', '#7F7966', '#8E8772', '#A09A89', '#BDB9AD'],
    'pratiq-hud': ['#22201B', '#36342C', '#4C483D', '#5C5749', '#736D5C', '#87806C'],
  } as const

  // Locating the block by SELECTOR is not enough: the shared primitives rule is
  // written across two lines, so `[data-nx-theme="pratiq-hud"] {` occurs there
  // too and a naive indexOf finds that one instead. Identify the ramp block by
  // what it declares — only the ramps carry --nx-grey-100.
  const withoutComments = CSS.replace(/\/\*[\s\S]*?\*\//g, '')
  const rampBlockFor = (theme: string): string => {
    for (const [, selector, body] of withoutComments.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (selector.includes(`"${theme}"`) && body.includes('--nx-grey-100:')) return body
    }
    throw new Error(`no ramp block found for ${theme}`)
  }

  for (const [theme, hexes] of Object.entries(ramps)) {
    it(`${theme}: every step in the stylesheet appears in PALETTE.md`, () => {
      const inBlock = rampBlockFor(theme)
      for (const hex of hexes) {
        expect(inBlock, `${theme} should declare ${hex}`).toContain(hex)
        expect(PALETTE, `PALETTE.md should document ${hex} (${theme})`).toContain(hex)
      }
    })
  }
})

describe('the brand faces', () => {
  // A direct pin on a regression that shipped: the font block existed in the
  // first draft of this theme and was dropped when the theme moved into this
  // package, so the viewer rendered in nexus's original stack and never asked
  // for IBM Plex Mono at all. Nothing failed, because nothing looked.
  it('names IBM Plex Mono first, ahead of the inherited stack', () => {
    const decl = /--nx-font-mono:\s*([^;]+);/.exec(CSS)?.[1] ?? ''
    expect(decl, 'pratiq.css must declare --nx-font-mono').not.toEqual('')
    expect(decl).toMatch(/^"IBM Plex Mono"/)
    // The fallbacks stay, so a machine without the face renders what it did
    // before rather than dropping to a serif.
    expect(decl).toContain('ui-monospace')
    expect(decl).toContain('monospace')
  })

  it('names Archivo for display, with a real fallback stack', () => {
    const decl = /--nx-font-stencil:\s*([^;]+);/.exec(CSS)?.[1] ?? ''
    expect(decl).toMatch(/^"Archivo"/)
    expect(decl).toContain('sans-serif')
  })

  it('exposes both through the brand vocabulary, which BRAND.md promises', () => {
    expect(declared.has('--pq-font-mono')).toBe(true)
    expect(declared.has('--pq-font-display')).toBe(true)
  })
})

describe('the favicon', () => {
  // The mark's geometry lives in more places than is comfortable — the brand
  // originals, the social card, the wordmark component, the site. This pins the
  // one copy that is a COPY rather than a separate drawing: the viewer serves
  // its own file out of public/, so nothing stops the two diverging silently
  // and nobody looks at a favicon closely enough to notice a 2px difference.
  const brandOriginal = read('../../../../brand/assets/logo/favicon.svg')
  const served = read('../../../public/favicon.svg')

  it('the viewer serves a byte-identical copy of the brand original', () => {
    expect(served).toEqual(brandOriginal)
  })

  it('is the flag: a yellow field on the void, and nothing on it', () => {
    // Not a snapshot — the two claims that make it flag Q rather than a
    // yellow rectangle someone nudged. Quebec's hex, and only two shapes.
    expect(served).toContain('#FEDD00')
    expect(served).toContain('#08090A')
    expect(served.match(/<rect/g) ?? []).toHaveLength(2)
  })

  it('is referenced as a file, not re-inlined as a data URI', () => {
    // The data: URI it replaced was a third copy of the geometry, and Safari
    // does not reliably render an SVG favicon from one.
    expect(INDEX_HTML).toContain('<link rel="icon" href="/favicon.svg" type="image/svg+xml" />')
    expect(INDEX_HTML).not.toContain('href="data:image/svg+xml')
  })
})

describe('the viewer head', () => {
  it('declares a dark colour-scheme, since there is no light theme to switch to', () => {
    // Without this the browser paints native scrollbars and the pre-paint
    // canvas light, over a page whose ground is #08090A.
    expect(INDEX_HTML).toContain('<meta name="color-scheme" content="dark" />')
    // BOTH, and the second is not redundant. The meta sets the document's used
    // colour scheme and leaves the CSS property at `normal` — measured in the
    // running viewer, where getComputedStyle(documentElement).colorScheme came
    // back "normal" with only the meta present.
    expect(INDEX_HTML).toMatch(/html\s*\{[^}]*color-scheme:\s*dark/)
  })

  it('paints browser chrome with the canvas colour, not a near-miss', () => {
    const theme = /<meta name="theme-color" content="([^"]+)"/.exec(INDEX_HTML)?.[1]
    const canvas = /--nx-void:\s*(#[0-9A-Fa-f]{6})/.exec(CSS)?.[1]
    expect(theme?.toUpperCase()).toEqual(canvas?.toUpperCase())
  })

  it('carries a description, and does not carry link-preview tags', () => {
    expect(INDEX_HTML).toMatch(/<meta\s+name="description"/)
    // The viewer is served on localhost. og:/twitter: tags would be a preview
    // for a link nobody can follow — decoration that looks like configuration.
    expect(INDEX_HTML).not.toMatch(/property="og:|name="twitter:/)
  })
})

// ── the numbers, re-derived rather than trusted ─────────────────────────────
//
// THE ROOT CAUSE THIS EXISTS FOR. Every contrast ratio in this system was
// published in four places — pratiq.css comments, PALETTE.md's tables,
// index.ts's `contrast` map, and BRAND.md's prose — and derived in none. Each
// was typed by hand from a tool's stdout, and that tool had a bug: solve-ramp
// measured the colour it had SOLVED for (a float) and printed the hex it had
// ROUNDED to, so four published figures described a colour that was not the
// one shipped.
//
// It survived because the only check was "re-run the command printed beside
// the table", and the printed command was the buggy one. Self-referential
// verification reproduces a wrong number perfectly.
//
// Worse, index.ts's map is what themeMeetsAA() reads — a predicate exported so
// "a consuming app can assert its own colour choices in a test rather than
// discovering the problem in an audit". A hand-typed number underneath a
// safety assertion is the assertion lying with a straight face.
//
// So: parse the hexes out of the stylesheet and recompute. This cannot share
// solve-ramp's bug because it never sees a float — the hex IS the input.

const srgb = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
const luminance = (hex: string) => {
  const n = parseInt(hex.slice(1), 16)
  return 0.2126 * srgb(((n >> 16) & 255) / 255) + 0.7152 * srgb(((n >> 8) & 255) / 255) + 0.0722 * srgb((n & 255) / 255)
}
const ratio = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

/** The ground every ratio in this system is measured against. Read, not assumed. */
const GROUND = (/--nx-panel:\s*(#[0-9A-Fa-f]{6})/.exec(CSS)?.[1] ?? '').toUpperCase()

const WCAG_FLOORS = [4.5, 3, 7]

const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '')
const blockFor = (theme: string) =>
  [...stripComments(CSS).matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter(([, sel]) => sel.includes(`"${theme}"`))
    .map(([, , body]) => body)
    .join('\n')
const hexFor = (theme: string, key: string) =>
  new RegExp(`--nx-${key}:\\s*(#[0-9A-Fa-f]{6})`).exec(blockFor(theme))?.[1]

describe('every published ratio equals the ratio of the hex beside it', () => {
  it('reads the ground out of the stylesheet', () => {
    expect(GROUND).toBe('#0A0C0B')
  })

  it('pratiq.css: each annotated colour matches its own comment', () => {
    const rows = [...CSS.matchAll(/--[\w-]+:\s*(#[0-9A-Fa-f]{6});\s*\/\*\s*([\d.]+):1/g)]
    expect(rows.length, 'no annotated colours found — the regex has gone stale').toBeGreaterThan(6)
    for (const [, hex, claimed] of rows) {
      expect(ratio(hex, GROUND), `${hex} is annotated ${claimed}:1`).toBeCloseTo(Number(claimed), 2)
    }
  })

  it('PALETTE.md: each table row matches its own colour', () => {
    // The LAST number before ":1" is the measured column; the one before it is
    // the target, which is deliberately different and must not be compared.
    const rows = [...PALETTE.matchAll(/`(#[0-9A-Fa-f]{6})`[^|\n]*\|[^|\n]*\|\s*([\d.]+):1/g)]
    expect(rows.length, 'no measured rows found — the table shape has changed').toBeGreaterThan(6)
    for (const [, hex, claimed] of rows) {
      expect(ratio(hex, GROUND), `PALETTE.md publishes ${claimed}:1 for ${hex}`).toBeCloseTo(Number(claimed), 2)
    }
  })
})

describe('the contrast map underneath themeMeetsAA', () => {
  for (const theme of ['pratiq', 'pratiq-hud'] as const) {
    it(`${theme}: every entry equals the ratio of its declared colour`, () => {
      const entries = contrast[theme] as unknown as Record<string, number>
      let checked = 0
      for (const [key, claimed] of Object.entries(entries)) {
        const hex = hexFor(theme, key)
        if (!hex) continue
        checked++
        expect(ratio(hex, GROUND), `${theme}.${key} claims ${claimed} for ${hex}`).toBeCloseTo(claimed, 2)
      }
      expect(checked, 'nothing was actually checked').toBeGreaterThan(5)
    })

    it(`${theme}: the map never claims a pass the colour does not have`, () => {
      // The property that matters more than the digits: a published number and
      // its real value must fall on the SAME SIDE of every WCAG floor. Two
      // tokens clear a floor by less than solve-ramp's worst-case quantisation
      // error (0.0655) — #7F7966 by 0.012, #625E4F by 0.021 — so an error of
      // the size that actually shipped could have inverted either.
      const entries = contrast[theme] as unknown as Record<string, number>
      for (const [key, claimed] of Object.entries(entries)) {
        const hex = hexFor(theme, key)
        if (!hex) continue
        const actual = ratio(hex, GROUND)
        for (const floor of WCAG_FLOORS) {
          expect(
            actual >= floor,
            `${theme}.${key} (${hex}): map says ${claimed}, actual ${actual.toFixed(4)}, floor ${floor}`
          ).toBe(claimed >= floor)
        }
      }
    })
  }

  it('themeMeetsAA agrees with the stylesheet, not merely with the map', () => {
    for (const theme of ['pratiq', 'pratiq-hud'] as const) {
      const truth =
        ratio(hexFor(theme, 'grey-300')!, GROUND) >= WCAG.AA_TEXT &&
        ratio(hexFor(theme, 'grey-200')!, GROUND) >= WCAG.AA_NON_TEXT
      expect(themeMeetsAA(theme), `${theme}: predicate vs recomputed`).toBe(truth)
    }
  })
})
