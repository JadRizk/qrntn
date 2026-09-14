import { describe, expect, it } from 'vitest'

import type { FileLink } from '../data/types.ts'
import { render, type Block, type Inline } from './render.ts'
import type { Token } from './tokenise.ts'

// Inputs are built from code points, never pasted (tokenise.test.ts).
const cp = (...codes: number[]) => String.fromCodePoint(...codes)

// A readable spelling of the model, so a test states a shape in one line.
const tok = (ts: Token[]): string => ts.map((t) => {
  switch (t.kind) {
    case 'text': { const s = t.scope ? `${t.scope}⟨${t.text}⟩` : t.text; return t.bidi ? `«${s}»` : s }
    case 'escape': return `[${t.label}]`
    case 'confusable': return `{${t.text}~${t.looksLike}}`
    case 'ws': return t.mark
    case 'link': return `<${t.link.kind}:${tok(t.tokens)}>`
    case 'comment': return `/*${tok(t.tokens)}*/`
  }
}).join('')
const inl = (xs: Inline[]): string => xs.map((x) => {
  switch (x.kind) {
    case 'tokens': return tok(x.tokens)
    case 'em': return `_${inl(x.children)}_`
    case 'strong': return `**${inl(x.children)}**`
    case 'strike': return `~~${inl(x.children)}~~`
    case 'code': return `\`${tok(x.tokens)}\``
    case 'link': return `[${inl(x.children)} → ${x.link ? x.link.kind : 'none'}:${x.target}]`
    case 'image': return `[image ${x.alt} → ${x.target}]`
    case 'html': return `html(${tok(x.tokens)})`
    case 'break': return '⏎'
    case 'task': return x.checked ? '☑' : '☐'
  }
}).join('')
const blk = (b: Block): string => {
  const at = `${b.kind}@${b.from}${b.to !== b.from ? `-${b.to}` : ''}`
  switch (b.kind) {
    case 'heading': return `${at} h${b.level} ${inl(b.children)}`
    case 'paragraph': return `${at} ${inl(b.children)}`
    case 'quote': return `${at} [${b.children.map(blk).join(' ; ')}]`
    case 'list': return `${at} ${b.ordered ? `ol${b.start}` : 'ul'} [${b.items.map((i) => i.children.map(blk).join(' ; ')).join(' | ')}]`
    case 'code': return `${at} ${b.info || '-'}${b.first !== b.from ? `~${b.first}` : ''} [${b.lines.map((l) => tok(l.tokens)).join(' / ')}]`
    case 'table': return `${at} ${b.align.map((a) => a ?? '-').join(',')} [${b.header.map(inl).join(' | ')}] [${b.rows.map((r) => r.map(inl).join(' | ')).join(' ; ')}]`
    case 'frontmatter': return `${at}${b.closed ? '' : ' open'} [${b.lines.map((l) => tok(l.tokens)).join(' / ')}]`
    case 'html': case 'comment': case 'source': return `${at} [${b.lines.map((l) => tok(l.tokens)).join(' / ')}]`
    case 'rule': return at
  }
}
const blocks = (src: string, links: FileLink[] = []) => render(src, links).blocks.map(blk)

describe('render — the preview hides nothing', () => {
  it('blocks come out with their source lines', () => {
    expect(blocks('# T\n\npara\nmore\n\n- a\n- b\n\n> q\n\n---\n')).toEqual([
      'heading@1 h1 T', 'paragraph@3-4 para more', 'list@6-7 ul [paragraph@6 a | paragraph@7 b]', 'quote@9 [paragraph@9 q]', 'rule@11',
    ])
  })

  it('inline shapes: emphasis, strong, code, escape, hard break, entity as written', () => {
    expect(blocks('a *b* **c** `d` \\* e  \nf &amp;\n')).toEqual(['paragraph@1-2 a _b_ **c** `d` * e⏎f &amp;'])
  })

  it('front matter is YAML lines, then the body from the line after; unclosed runs to the end', () => {
    expect(blocks('---\nname: x\n---\n# T\n')).toEqual(['frontmatter@1-3 [name⟨name⟩mark⟨:⟩ x]', 'heading@4 h1 T'])
    expect(blocks('---\nname: x\n')).toEqual(['frontmatter@1-2 open [name⟨name⟩mark⟨:⟩ x]'])
  })

  it('a fence is numbered code, coloured by its info string; an unknown info is text; indented code is code', () => {
    expect(blocks('x\n\n```js\nlet a = 1\n```\n\n```sh\nls\n```\n\n    tab\n')).toEqual([
      'paragraph@1 x', 'code@3-5 js~4 [keyword⟨let⟩ name⟨a⟩ = literal⟨1⟩]', 'code@7-9 sh~8 [ls]', 'code@11 - [tab]',
    ])
  })

  it('a link resolves to the exporter\'s span by the target\'s position; one the export did not see is labelled with its target', () => {
    const src = 'see [guide](refs/g.md) and [x](nowhere)\n'
    const link: FileLink = { line: 1, col: 12, len: 9, raw: 'refs/g.md', kind: 'file', to: 'refs/g.md' }
    expect(blocks(src, [link])).toEqual(['paragraph@1 see [guide → file:refs/g.md] and [x → none:nowhere]'])
  })

  it('a link the exporter found in plain prose is a span inside the tokens', () => {
    const src = 'Call the Skill tool with "helper" now\n'
    const link: FileLink = { line: 1, col: 26, len: 6, raw: 'helper', kind: 'node', to: 'helper' }
    expect(blocks(src, [link])).toEqual(['paragraph@1 Call the Skill tool with "<node:helper>" now'])
  })

  it('an image is its alt and its target, never a request', () => {
    expect(blocks('![logo](https://evil.example/beacon.png)\n')).toEqual(['paragraph@1 [image logo → https://evil.example/beacon.png]'])
    const r = render('![logo](https://evil.example/beacon.png)\n', [])
    expect(JSON.stringify(r)).not.toMatch(/<img/)
  })

  it('HTML is shown as source, inline and as a block; a comment is a comment block', () => {
    expect(blocks('a <b>x</b> c\n\n<div>\nhi\n</div>\n\n<!-- gone\nwhen rendered -->\n')).toEqual([
      'paragraph@1 a html(<b>)xhtml(</b>) c', 'html@3-5 [<div> / hi / </div>]', 'comment@7-8 [/*<!-- gone*/ / /*when rendered -->*/]',
    ])
  })

  it('what a renderer hides is a chip in the preview too: an invisible in prose, in a comment, in a fence; a homoglyph; a bidi run', () => {
    const src = `a${cp(0x200b)}b <!-- c${cp(0x200b)}d --> ${cp(0x0430)}bc\n\n\`\`\`js\nlet s = "x${cp(0x202e)}y"\n\`\`\`\n`
    expect(blocks(src)).toEqual([
      `paragraph@1 a[U+200B]b /*<!-- c[U+200B]d -->*/ {${cp(0x0430)}~a}bc`,
      'code@3-5 js~4 [keyword⟨let⟩ name⟨s⟩ = string⟨"x⟩[U+202E]«string⟨y"⟩»]',
    ])
  })

  it('lists: ordered start, task markers, nested blocks; a table with alignment', () => {
    expect(blocks('3. a\n4. b\n\n- [x] done\n- [ ] todo\n\n| h1 | h2 |\n|:--|--:|\n| *a* | b |\n')).toEqual([
      'list@1-2 ol3 [paragraph@1 a | paragraph@2 b]',
      'list@4-5 ul [paragraph@4 ☑ done | paragraph@5 ☐ todo]',
      'table@7-9 left,right [h1 | h2] [_a_ | b]',
    ])
  })

  it('a setext heading and a closed ATX heading keep only their text', () => {
    expect(blocks('Title\n=====\n\n## Two ##\n')).toEqual(['heading@1-2 h1 Title', 'heading@4 h2 Two'])
  })

  it('soft breaks are spaces and a continuation indent is dropped; no trailing-space dots in prose', () => {
    expect(blocks('- one\n  two  \n  three\n')).toEqual(['list@1-3 ul [paragraph@1-3 one two⏎three]'])
    expect(blocks('a *b* c\n')).toEqual(['paragraph@1 a _b_ c'])
  })

  it('a line address on a fence line lands on the code block', () => {
    const [, code] = render('x\n\n```js\nlet a\n```\n', []).blocks
    expect(code && code.from <= 3 && 3 <= code.to && code.from <= 5 && 5 <= code.to).toBe(true)
  })

  it('a link reference is shown as source, not dropped', () => {
    expect(blocks('[ref]: https://x.example\n')).toEqual(['source@1 [[ref]: https://x.example]'])
  })

  it('a link offset on a line the file no longer has is ignored', () => {
    const stale: FileLink = { line: 40, col: 2, len: 3, raw: 'x', kind: 'node', to: 'x' }
    expect(blocks('see [x](y.md)\n', [stale])).toEqual(['paragraph@1 see [x → none:y.md]'])
  })

  it('an empty file is no blocks and one line', () => {
    expect(render('', [])).toEqual({ blocks: [], lines: 1 })
  })
})
