import { describe, expect, it } from 'vitest'

import type { FileLink } from '../data/types.ts'
import { escapedTotal, tokenise, type Token } from './tokenise.ts'

// Test inputs are built from code points, never pasted: a literal in this
// file would be as invisible here as in the artefact.
const cp = (...codes: number[]) => String.fromCodePoint(...codes)

const flat = (tokens: Token[]): string =>
  tokens.map((t) => {
    switch (t.kind) {
      case 'text': return t.bidi ? `«${t.text}»` : t.text
      case 'escape': return `[${t.label}]`
      case 'confusable': return `{${t.text}~${t.looksLike}}`
      case 'ws': return t.mark
      case 'link': return `<${t.link.kind}:${flat(t.tokens)}>`
      case 'comment': return `/*${t.text}*/`
    }
  }).join('')

describe('tokenise — what the reader shows', () => {
  it('plain text is one token per line, numbered from 1, trailing newline dropped', () => {
    const { lines } = tokenise('one\ntwo\n', [])
    expect(lines.map((l) => [l.n, flat(l.tokens)])).toEqual([[1, 'one'], [2, 'two']])
  })

  it('an empty file is one empty line, not zero lines', () => {
    expect(tokenise('', []).lines).toHaveLength(1)
  })

  it('front matter, headings and fences are classed by line', () => {
    const src = '---\nname: x\n---\n# Title\n```\n# not a heading\n```\ntext'
    expect(tokenise(src, []).lines.map((l) => l.cls)).toEqual(['frontmatter', 'frontmatter', 'frontmatter', 'heading', 'fence', 'fence', 'fence', 'plain'])
  })

  it('every invisible in the scanner\'s class becomes a named chip and is counted', () => {
    const { lines, counts } = tokenise(`a${cp(0x200b)}b${cp(0xfeff)}c${cp(0x00ad)}d${cp(0x2062)}`, [])
    expect(flat(lines[0]!.tokens)).toBe('a[U+200B]b[U+FEFF]c[U+00AD]d[U+2062]')
    expect(counts.invisible).toBe(4)
    expect(escapedTotal(counts)).toBe(4)
  })

  it('a bidi override opens a run that is marked until PDF, and the chip names the codepoint', () => {
    const { lines, counts } = tokenise(`s${cp(0x202e)}ediug${cp(0x202c)}.md`, [])
    expect(flat(lines[0]!.tokens)).toBe('s[U+202E]«ediug»[U+202C].md')
    expect(counts.bidi).toBe(2)
  })

  it('an unterminated run marks to the end of the line and no further', () => {
    const { lines } = tokenise(`a${cp(0x2067)}b\nc`, [])
    expect(flat(lines[0]!.tokens)).toBe('a[U+2067]«b»')
    expect(flat(lines[1]!.tokens)).toBe('c')
  })

  it('tag characters and C0/C1 controls are chips; tab, LF and CR are not controls', () => {
    const { lines, counts } = tokenise(`x${cp(0xe0041)}y${cp(0x01)}z${cp(0x9f)}\tq\r`, [])
    expect(flat(lines[0]!.tokens)).toBe('x[U+E0041]y[U+0001]z[U+009F]→q␍')
    expect(counts.tag).toBe(1)
    expect(counts.control).toBe(2)
  })

  it('a confusable is shown as itself with the letter it imitates; other non-ASCII is text, counted', () => {
    const { lines, counts } = tokenise(`${cp(0x0430)}udit Δ`, [])
    expect(flat(lines[0]!.tokens)).toBe(`{${cp(0x0430)}~a}udit Δ`)
    expect(counts.confusable).toBe(1)
    expect(counts.nonAscii).toBe(1)
  })

  it('trailing spaces are dots, inner spaces are spaces, NBSP is marked anywhere', () => {
    const { lines } = tokenise(`a b${cp(0xa0)}c  `, [])
    expect(flat(lines[0]!.tokens)).toBe('a b⍽c··')
  })

  it('trailing spaces are still dots on a CRLF line', () => {
    const { lines } = tokenise('text   \r\nnext\r\n', [])
    expect(flat(lines[0]!.tokens)).toBe('text···␍')
    expect(flat(lines[1]!.tokens)).toBe('next␍')
  })

  it('an HTML comment is its own token, across lines', () => {
    const { lines } = tokenise('a <!-- hidden\nstill --> b', [])
    expect(flat(lines[0]!.tokens)).toBe('a /*<!-- hidden*/')
    expect(flat(lines[1]!.tokens)).toBe('/*still -->*/ b')
  })

  it('a link span is the exporter\'s offsets, with escapes inside it still escaped', () => {
    const line = `see [x](references/s${cp(0x202e)}ediug.md) now`
    const link: FileLink = { line: 1, col: 8, len: 21, raw: `references/s${cp(0x202e)}ediug.md`, kind: 'unresolved', to: null }
    const { lines } = tokenise(line, [link])
    // The override is never closed, so the run carries past the link to the end of the line.
    expect(flat(lines[0]!.tokens)).toBe('see [x](<unresolved:references/s[U+202E]«ediug.md»>«) now»')
  })

  it('a link offset that no longer fits the line is ignored rather than corrupting it', () => {
    const link: FileLink = { line: 1, col: 40, len: 5, raw: 'x', kind: 'node', to: 'y' }
    expect(flat(tokenise('short', [link]).lines[0]!.tokens)).toBe('short')
  })

  it('the longest line is reported, so a 100,000-newline file states its shape', () => {
    const { lines, counts } = tokenise(`${'\n'.repeat(999)}${'x'.repeat(401)}`, [])
    expect(lines).toHaveLength(1000)
    expect(counts.longest).toBe(401)
  })
})
