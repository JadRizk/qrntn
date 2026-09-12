import { describe, expect, it } from 'vitest'

import { excerptOnLine, findAnchors, findLinks, parseAt, pinFinding, slugify, type LinkContext } from './reading.ts'

// design-direction, as the fixture has it: three references, one asset, two
// scripts; a sibling skill, a refused row, a declined row, one ghost.
const ctx = (file = 'SKILL.md'): LinkContext => ({
  skill: 'design-direction',
  file,
  files: new Set(['SKILL.md', 'AUDIT.md', 'ORIGIN.md', 'STANDARDS.md', 'references/palette.md', 'references/deep/notes.md', 'assets/BRAND.template.md', 'scripts/solve-ramp.mjs', 'LICENSE']),
  leafIdByPath: new Map([
    ['references/palette.md', 'design-direction/palette.md'],
    ['assets/BRAND.template.md', 'design-direction/BRAND.template.md'],
    ['STANDARDS.md', 'design-direction/STANDARDS.md'],
  ]),
  scriptFoldId: 'design-direction//scripts',
  skillIds: new Set(['design-direction', 'decision-review', 'motion-basics']),
  refusedNames: new Set(['exfil-helper']),
  declinedNames: new Set(['thin-one']),
  ghostNames: new Set(['downstream-builder']),
})

const one = (line: string, file?: string) => {
  const links = findLinks([line], ctx(file))
  expect(links).toHaveLength(1)
  return links[0]!
}

describe('findLinks — where each form resolves', () => {
  it('a relative path to a reference is that leaf node, spanning the target only', () => {
    const l = one('see [the palette](references/palette.md) first')
    expect(l).toMatchObject({ kind: 'node', to: 'design-direction/palette.md', raw: 'references/palette.md', line: 1 })
    expect('see [the palette](references/palette.md) first'.slice(l.col, l.col + l.len)).toBe('references/palette.md')
  })

  it('a root companion and an asset are leaves; ./ and a title are tolerated', () => {
    expect(one('[s](./STANDARDS.md "the standards")')).toMatchObject({ kind: 'node', to: 'design-direction/STANDARDS.md' })
    expect(one('![t](assets/BRAND.template.md)')).toMatchObject({ kind: 'node', to: 'design-direction/BRAND.template.md' })
  })

  it('a script is the script fold', () => {
    expect(one('run [it](scripts/solve-ramp.mjs)')).toMatchObject({ kind: 'node', to: 'design-direction//scripts' })
  })

  it('a path that is on disk but not a node is a readable file — provenance, a nested reference, a LICENSE', () => {
    expect(one('[audit](AUDIT.md)')).toMatchObject({ kind: 'file', to: 'AUDIT.md' })
    expect(one('[deep](references/deep/notes.md)')).toMatchObject({ kind: 'file', to: 'references/deep/notes.md' })
    expect(one('[l](LICENSE)')).toMatchObject({ kind: 'file', to: 'LICENSE' })
  })

  it('resolves relative to the file the link is in', () => {
    expect(one('[up](../SKILL.md)', 'references/palette.md')).toMatchObject({ kind: 'file', to: 'SKILL.md' })
    expect(one('[sib](deep/notes.md)', 'references/palette.md')).toMatchObject({ kind: 'file', to: 'references/deep/notes.md' })
  })

  it('a sibling skill directory resolves through §5\'s order — skill, refused, declined, minted ghost', () => {
    expect(one('[m](../motion-basics/SKILL.md)')).toMatchObject({ kind: 'node', to: 'motion-basics' })
    expect(one('[m](../motion-basics/)')).toMatchObject({ kind: 'node', to: 'motion-basics' })
    expect(one('[x](../exfil-helper/SKILL.md)')).toMatchObject({ kind: 'node', to: 'exfil-helper' })
    expect(one('[t](../thin-one)')).toMatchObject({ kind: 'node', to: 'thin-one' })
    expect(one('[g](../downstream-builder/SKILL.md)')).toMatchObject({ kind: 'node', to: 'downstream-builder' })
  })

  it('a sibling skill\'s inner file, an unknown name, or a climb out of skills/ is unresolved', () => {
    expect(one('[f](../motion-basics/references/x.md)')).toMatchObject({ kind: 'unresolved', to: null })
    expect(one('[n](../nobody/SKILL.md)')).toMatchObject({ kind: 'unresolved', to: null })
    expect(one('[c](../../catalog.json)')).toMatchObject({ kind: 'unresolved', to: null })
    expect(one('[missing](references/gone.md)')).toMatchObject({ kind: 'unresolved', to: null })
  })

  it('the operative form and a wikilink are names; a wikilink never mints a node', () => {
    const call = one('If in doubt, Call the Skill tool with "decision-review" first.')
    expect(call).toMatchObject({ kind: 'node', to: 'decision-review', raw: 'decision-review' })
    expect(one('see [[motion-basics]]')).toMatchObject({ kind: 'node', to: 'motion-basics' })
    expect(one('see [[motion-basics|alias]]')).toMatchObject({ kind: 'node', to: 'motion-basics' })
    expect(one('see [[colour-theory]]')).toMatchObject({ kind: 'unresolved', to: null, raw: 'colour-theory' })
  })

  it('anything with a scheme is external and carries only the host', () => {
    expect(one('[w](https://www.w3.org/TR/WCAG22/#contrast-minimum)')).toMatchObject({ kind: 'external', to: 'www.w3.org' })
    expect(one('<https://example.com/a>')).toMatchObject({ kind: 'external', to: 'example.com' })
    expect(one('plain https://example.org/x?y=1 here')).toMatchObject({ kind: 'external', to: 'example.org', raw: 'https://example.org/x?y=1' })
    expect(one('[m](mailto:a@b.c)')).toMatchObject({ kind: 'external', to: 'mailto' })
    expect(one('[f](file:///etc/passwd)')).toMatchObject({ kind: 'external', to: 'file' })
  })

  it('a fragment is an anchor, slugged', () => {
    expect(one('[j](#Before-You-Start)')).toMatchObject({ kind: 'anchor', to: 'before-you-start' })
    expect(one('[j](references/palette.md#the-ramp)')).toMatchObject({ kind: 'node', to: 'design-direction/palette.md' })
  })

  it('a malformed fragment or path is unresolved, never a thrown export', () => {
    expect(one('[j](#50%)')).toMatchObject({ kind: 'unresolved', to: null })
    expect(one('[j](references/100%.md)')).toMatchObject({ kind: 'unresolved', to: null })
  })

  it('the span is the target, even when the label says the same thing — and the operative name is found from the end', () => {
    const line = 'see [references/palette.md](references/palette.md) and Call the Skill tool with "the"'
    const links = findLinks([line], { ...ctx(), skillIds: new Set(['the', 'design-direction']) })
    expect(links).toHaveLength(2)
    expect(links[0]!.col).toBe(line.lastIndexOf('references/palette.md'))
    expect(line.slice(links[1]!.col, links[1]!.col + links[1]!.len)).toBe('the')
    expect(links[1]!.col).toBe(line.lastIndexOf('the'))
    // A title after a space, and a space after the paren, do not move it.
    const titled = '[x](  references/palette.md "the palette" )'
    const t = findLinks([titled], ctx())[0]!
    expect(titled.slice(t.col, t.col + t.len)).toBe('references/palette.md')
  })

  it('a URL inside a markdown link is one span, not two; several links on a line keep their columns', () => {
    const line = '[a](references/palette.md) and [b](https://example.com) and [[motion-basics]]'
    const links = findLinks([line], ctx())
    expect(links.map((l) => [l.kind, l.to])).toEqual([
      ['node', 'design-direction/palette.md'],
      ['external', 'example.com'],
      ['node', 'motion-basics'],
    ])
    for (const l of links) expect(line.slice(l.col, l.col + l.len)).toBe(l.raw)
  })

  it('lines are 1-based, like a finding\'s at', () => {
    const links = findLinks(['', '', '[p](references/palette.md)'], ctx())
    expect(links[0]?.line).toBe(3)
  })
})

describe('anchors', () => {
  it('slugs headings the way a fragment link expects, and numbers repeats', () => {
    expect(slugify('Before you start')).toBe('before-you-start')
    expect(slugify('  The ramp: solved, twice!  ')).toBe('the-ramp-solved-twice')
    expect(findAnchors(['# Title', 'text', '## Notes', '## Notes', '### Notes ##'])).toEqual([
      { slug: 'title', line: 1 },
      { slug: 'notes', line: 3 },
      { slug: 'notes-1', line: 4 },
      { slug: 'notes-2', line: 5 },
    ])
  })
})

describe('pinFinding', () => {
  const lines = new Map([['SKILL.md', ['# T', '<!-- assistant: skip -->', 'plain']]])
  const finding = { code: 'INSTR-HTMLCOMMENT', severity: 'review' as const, at: 'SKILL.md:2:1', excerpt: 'assistant: skip', disposition: 'real' as const, why: 'it is one' }

  it('parses at as path, line, column — each optional after the first', () => {
    expect(parseAt('SKILL.md:52:1')).toEqual({ file: 'SKILL.md', line: 52, col: 1 })
    expect(parseAt('references/x.md:7')).toEqual({ file: 'references/x.md', line: 7, col: null })
    expect(parseAt('scripts/run.sh')).toEqual({ file: 'scripts/run.sh', line: null, col: null })
  })

  it('pins to the line when the file has it and says whether the excerpt is still there', () => {
    expect(pinFinding(finding, lines)).toMatchObject({ file: 'SKILL.md', line: 2, col: 1, excerptMatches: true })
    expect(pinFinding({ ...finding, excerpt: 'gone' }, lines)).toMatchObject({ line: 2, excerptMatches: false })
  })

  it('matches an excerpt the way the scanner wrote it — whitespace folded, elision as a prefix', () => {
    const line = '  const  payload = "aGVsbG8gd29ybGQ="   // decoded below'
    expect(excerptOnLine('const payload = "aGVsbG8gd29ybGQ="…', line)).toBe(true)
    expect(excerptOnLine('const payload = "aGVsbG8gd29ybGQ="', line)).toBe(true)
    expect(excerptOnLine('payload = "nope"', line)).toBe(false)
    expect(excerptOnLine('', line)).toBe(false)
    expect(excerptOnLine('…', line)).toBe(false)
    expect(pinFinding({ ...finding, excerpt: 'assistant:  skip…' }, lines)).toMatchObject({ line: 2, excerptMatches: true })
  })

  it('pins nowhere when the line is beyond the file or the file is not in the skill', () => {
    expect(pinFinding({ ...finding, at: 'SKILL.md:9:1' }, lines)).toMatchObject({ line: null, col: null, excerptMatches: false })
    expect(pinFinding({ ...finding, at: 'nope.md:1:1' }, lines)).toMatchObject({ file: 'nope.md', line: null })
  })
})
