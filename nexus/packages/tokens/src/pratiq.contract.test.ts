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
