// reading/render.ts — the preview: structure from the tree, nothing hidden.
//
// READING.md allows a formatted mode as a toggle, off by default, that
// renders no raw HTML and no remote image. This is its model: the markdown
// tree (@lezer/markdown, the same parse highlight.ts colours from) walked
// into BLOCKS — heading, paragraph, list, quote, code, table — whose text is
// not the source string but the source *through tokenise.ts*. So a
// zero-width space in a rendered paragraph is still a chip, a homoglyph is
// still underlined, a link is still the exporter's resolved span, and the
// three things a renderer hides are shown as what they are: an HTML comment
// is a comment block, an HTML tag is its own source, an image is a name and
// a target, never a request.
//
// Pure: content and links in, blocks out. No DOM, no HTML string anywhere —
// ui/MarkdownPreview.tsx builds elements from these, one text node at a time.
//
// Every block carries the source lines it came from, so a finding still
// pins under its line, `#skill/path:L<n>` still scrolls to it, and the
// reader can step back to the source at the same place.

import type { SyntaxNode } from '@lezer/common'
import type { FileLink } from '../data/types.ts'
import { frontMatter, highlight, languageOfInfo, parseMarkdown } from './highlight.ts'
import { tokenise, type Line, type Token } from './tokenise.ts'

export type Inline =
  /** Prose: the exporter's links and every escape, through tokenise. Soft breaks are spaces. */
  | { kind: 'tokens'; tokens: Token[] }
  | { kind: 'em' | 'strong' | 'strike'; children: Inline[] }
  | { kind: 'code'; tokens: Token[] }
  /** `[label](target)`: the label rendered, the target resolved by the exporter or null. */
  | { kind: 'link'; link: FileLink | null; target: string; children: Inline[] }
  /** `![alt](target)`: never fetched. The alt and the target, as text. */
  | { kind: 'image'; alt: string; target: string; link: FileLink | null }
  /** An inline HTML tag, shown as its source. An inline `<!-- -->` needs no kind of its own: tokenise makes it a comment token, scanned. */
  | { kind: 'html'; tokens: Token[] }
  | { kind: 'break' }
  /** A task list marker: checked or not. */
  | { kind: 'task'; checked: boolean }

export type Block =
  | { kind: 'frontmatter'; from: number; to: number; lines: Line[]; closed: boolean }
  | { kind: 'heading'; from: number; to: number; level: 1 | 2 | 3 | 4 | 5 | 6; children: Inline[] }
  | { kind: 'paragraph'; from: number; to: number; children: Inline[] }
  | { kind: 'quote'; from: number; to: number; children: Block[] }
  | { kind: 'list'; from: number; to: number; ordered: boolean; start: number; items: ListItem[] }
  /** A fence or indented block: its lines tokenised with colour. `first` is the line number of `lines[0]` — the line after an opening fence. */
  | { kind: 'code'; from: number; to: number; first: number; info: string; lines: Line[] }
  | { kind: 'rule'; from: number; to: number }
  /** An HTML block, shown as source. */
  | { kind: 'html'; from: number; to: number; lines: Line[] }
  /** A comment block, shown as source. */
  | { kind: 'comment'; from: number; to: number; lines: Line[] }
  | { kind: 'table'; from: number; to: number; align: Align[]; header: Inline[][]; rows: Inline[][][] }
  /** Anything the model has no shape for (a link reference, a processing instruction): its source. */
  | { kind: 'source'; from: number; to: number; lines: Line[] }

export interface ListItem {
  from: number
  to: number
  children: Block[]
}

export type Align = 'left' | 'right' | 'center' | null

export interface Rendered {
  blocks: Block[]
  /** The last line number, so a line address past the end can be refused. */
  lines: number
}

/** Above this many characters the preview is not offered: a page of blocks is not windowed the way rows are. */
export const PREVIEW_LIMIT = 300_000

// What the walker reads of a node. @lezer/common's SyntaxNode is one; so is
// Shifted below, the body's tree addressed in the file's coordinates.
interface Node {
  readonly name: string
  readonly from: number
  readonly to: number
  readonly firstChild: Node | null
  readonly nextSibling: Node | null
  getChild(name: string): Node | null
}

// Marks are syntax the renderer consumes; they never become text.
const MARKS = new Set(['EmphasisMark', 'StrikethroughMark', 'CodeMark', 'LinkMark', 'HeaderMark', 'QuoteMark', 'ListMark', 'TableDelimiter'])

class Walker {
  private readonly lineStarts: number[]

  constructor(private readonly content: string, private readonly links: readonly FileLink[]) {
    this.lineStarts = [0]
    for (let i = 0; i < content.length; i++) if (content.charCodeAt(i) === 10) this.lineStarts.push(i + 1)
  }

  /** 1-based line of an offset. */
  lineOf(offset: number): number {
    let lo = 0, hi = this.lineStarts.length - 1
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if ((this.lineStarts[mid] ?? 0) <= offset) lo = mid; else hi = mid - 1 }
    return lo + 1
  }

  /** The last line a node touches: a node ending at a newline ends on the line before it. */
  endLineOf(to: number): number {
    return this.lineOf(Math.max(0, to - 1))
  }

  /**
   * A slice of the source as tokens: through tokenise, so the exporter's
   * links inside it are link spans and every escape is a chip. Multi-line
   * slices come back one Line per source line; the caller decides what a
   * line break is (a space in prose, a row in code).
   */
  lines(from: number, to: number, opts: { scopes?: boolean; info?: string; prose?: boolean } = {}): Line[] {
    if (to <= from) return []
    const slice = this.content.slice(from, to)
    const startLine = this.lineOf(from)
    const startCol = from - (this.lineStarts[startLine - 1] ?? 0)
    const inside: FileLink[] = []
    for (const l of this.links) {
      // A stale offset (a line the file no longer has) never corrupts a slice.
      if (l.line < 1 || l.line > this.lineStarts.length) continue
      const abs = (this.lineStarts[l.line - 1] ?? 0) + l.col
      if (abs < from || abs + l.len > to) continue
      inside.push({ ...l, line: l.line - startLine + 1, col: l.line === startLine ? l.col - startCol : l.col })
    }
    const lang = opts.scopes ? languageOfInfo(opts.info ?? '') : null
    const scopes = lang && lang !== 'markdown' ? highlight(slice, lang) : []
    return tokenise(slice, inside, { scopes, markdown: false, trailing: !opts.prose }).lines
  }

  /**
   * Prose: the lines of a slice joined by a space at each soft break, a
   * continuation line's indent dropped — layout, as a renderer treats it.
   * Nothing else is dropped: an HTML comment's tokens are inside a comment
   * token, an escape is a chip, a link is a span.
   */
  prose(from: number, to: number): Token[] {
    const out: Token[] = []
    const atLineStart = this.lineStarts[this.lineOf(from) - 1] === from
    this.lines(from, to, { prose: true }).forEach((l, i) => {
      const tokens = l.tokens.slice()
      if (i > 0) out.push({ kind: 'text', text: ' ', bidi: false })
      // A line's indent is layout — on a continuation line, and on a line
      // that begins a run (after a hard break).
      if (i > 0 || atLineStart) {
        const first = tokens[0]
        if (first?.kind === 'text') {
          const text = first.text.replace(/^[ \t]+/, '')
          if (text) tokens[0] = { ...first, text }
          else tokens.shift()
        }
      }
      out.push(...tokens)
    })
    return out
  }

  text(node: Node): string {
    return this.content.slice(node.from, node.to)
  }

  // ---- inline

  inlines(node: Node, from = node.from, to = node.to): Inline[] {
    const out: Inline[] = []
    let cursor = from
    const gap = (upto: number) => {
      if (upto > cursor) out.push({ kind: 'tokens', tokens: this.prose(cursor, upto) })
      cursor = Math.max(cursor, upto)
    }
    for (let child = node.firstChild; child; child = child.nextSibling) {
      if (child.from < from || child.to > to) continue
      if (child.from < cursor) continue
      gap(child.from)
      const inline = this.inline(child)
      if (inline) out.push(inline)
      cursor = child.to
    }
    gap(to)
    return out
  }

  private inline(node: Node): Inline | null {
    if (MARKS.has(node.name)) return null
    switch (node.name) {
      case 'Emphasis': return { kind: 'em', children: this.inlines(node) }
      case 'StrongEmphasis': return { kind: 'strong', children: this.inlines(node) }
      case 'Strikethrough': return { kind: 'strike', children: this.inlines(node) }
      case 'InlineCode': {
        const marks = children(node, 'CodeMark')
        const open = marks[0], close = marks[marks.length - 1]
        const from = open ? open.to : node.from, to = close && close !== open ? close.from : node.to
        return { kind: 'code', tokens: this.prose(from, to) }
      }
      case 'Link': case 'Image': {
        const marks = children(node, 'LinkMark')
        const labelFrom = marks[0]?.to ?? node.from
        const labelTo = marks[1]?.from ?? node.to
        const url = node.getChild('URL')
        const target = url ? this.text(url) : ''
        const link = url ? this.linkAt(url.from, url.to) : null
        if (node.name === 'Image') return { kind: 'image', alt: this.content.slice(labelFrom, labelTo), target, link }
        return { kind: 'link', link, target, children: this.inlines(node, labelFrom, labelTo) }
      }
      case 'Autolink': {
        const inner = this.text(node).replace(/^<|>$/g, '')
        return { kind: 'link', link: this.linkAt(node.from, node.to), target: inner, children: [{ kind: 'tokens', tokens: this.prose(node.from + 1, node.to - 1) }] }
      }
      case 'HTMLTag': case 'ProcessingInstruction': return { kind: 'html', tokens: this.prose(node.from, node.to) }
      case 'Escape': return { kind: 'tokens', tokens: this.prose(node.from + 1, node.to) }
      case 'HardBreak': return { kind: 'break' }
      case 'TaskMarker': return { kind: 'task', checked: /\[[xX]\]/.test(this.text(node)) }
      // A comment (tokenise's own comment token, scanned), an entity, or
      // anything else: its source, as written.
      default: return { kind: 'tokens', tokens: this.prose(node.from, node.to) }
    }
  }

  /** The exporter's link whose span lies inside [from, to), if any. */
  private linkAt(from: number, to: number): FileLink | null {
    for (const l of this.links) {
      if (l.line < 1 || l.line > this.lineStarts.length) continue
      const abs = (this.lineStarts[l.line - 1] ?? 0) + l.col
      if (abs >= from && abs + l.len <= to) return l
    }
    return null
  }

  // ---- block

  blocks(node: Node): Block[] {
    const out: Block[] = []
    for (let child = node.firstChild; child; child = child.nextSibling) {
      const b = this.block(child)
      if (b) out.push(b)
    }
    return out
  }

  private block(node: Node): Block | null {
    if (MARKS.has(node.name)) return null
    const from = this.lineOf(node.from), to = this.endLineOf(node.to)
    const heading = /^(?:ATX|Setext)Heading([1-6])$/.exec(node.name)
    if (heading) {
      const level = Number(heading[1]) as 1 | 2 | 3 | 4 | 5 | 6
      // ATX: content after the opening mark, before a closing mark if any.
      // Setext: content before the underline mark.
      const marks = children(node, 'HeaderMark')
      let cFrom = node.from, cTo = node.to
      if (node.name.startsWith('ATX')) {
        cFrom = marks[0]?.to ?? node.from
        if (marks.length > 1) cTo = marks[marks.length - 1]?.from ?? node.to
      } else if (marks[0]) {
        cTo = marks[0].from
      }
      return { kind: 'heading', from, to, level, children: trim(this.inlines(node, cFrom, cTo)) }
    }
    switch (node.name) {
      case 'Paragraph': case 'Task':
        return { kind: 'paragraph', from, to, children: trim(this.inlines(node)) }
      case 'Blockquote':
        return { kind: 'quote', from, to, children: this.blocks(node) }
      case 'BulletList': case 'OrderedList': {
        const items: ListItem[] = []
        for (let item = node.firstChild; item; item = item.nextSibling) {
          if (item.name !== 'ListItem') continue
          items.push({ from: this.lineOf(item.from), to: this.endLineOf(item.to), children: this.blocks(item) })
        }
        const firstMark = node.firstChild?.getChild('ListMark')
        const start = node.name === 'OrderedList' && firstMark ? Number.parseInt(this.text(firstMark), 10) || 1 : 1
        return { kind: 'list', from, to, ordered: node.name === 'OrderedList', start, items }
      }
      case 'FencedCode': {
        const info = node.getChild('CodeInfo')
        const body = node.getChild('CodeText')
        const infoText = info ? this.text(info) : ''
        return { kind: 'code', from, to, first: body ? this.lineOf(body.from) : from + 1, info: infoText, lines: body ? this.lines(body.from, body.to, { scopes: true, info: infoText }) : [] }
      }
      case 'CodeBlock': {
        const body = node.getChild('CodeText')
        return { kind: 'code', from, to, first: from, info: '', lines: body ? this.lines(body.from, body.to) : [] }
      }
      case 'HorizontalRule':
        return { kind: 'rule', from, to }
      case 'HTMLBlock':
        return { kind: 'html', from, to, lines: this.lines(node.from, node.to) }
      case 'CommentBlock':
        return { kind: 'comment', from, to, lines: this.lines(node.from, node.to) }
      case 'Table': {
        const header: Inline[][] = []
        const rows: Inline[][][] = []
        let align: Align[] = []
        for (let row = node.firstChild; row; row = row.nextSibling) {
          if (row.name === 'TableHeader') header.push(...this.cells(row))
          else if (row.name === 'TableRow') rows.push(this.cells(row))
          else if (row.name === 'TableDelimiter') align = this.text(row).split('|').filter((c) => c.trim()).map((c) => {
            const s = c.trim()
            return s.startsWith(':') && s.endsWith(':') ? 'center' : s.endsWith(':') ? 'right' : s.startsWith(':') ? 'left' : null
          })
        }
        return { kind: 'table', from, to, align, header, rows }
      }
      default:
        return { kind: 'source', from, to, lines: this.lines(node.from, node.to) }
    }
  }

  private cells(row: Node): Inline[][] {
    const out: Inline[][] = []
    for (let cell = row.firstChild; cell; cell = cell.nextSibling) if (cell.name === 'TableCell') out.push(trim(this.inlines(cell)))
    return out
  }
}

function children(node: Node, name: string): Node[] {
  const out: Node[] = []
  for (let c = node.firstChild; c; c = c.nextSibling) if (c.name === name) out.push(c)
  return out
}

// Leading and trailing spaces of a block's prose are layout, not content;
// trailing-space dots belong to the source view. Inner tokens are untouched.
function trim(inlines: Inline[]): Inline[] {
  const first = inlines[0], last = inlines[inlines.length - 1]
  if (first?.kind === 'tokens') {
    const t = first.tokens[0]
    if (t?.kind === 'text') t.text = t.text.replace(/^[ \t]+/, '')
    if (t?.kind === 'text' && t.text === '') first.tokens.shift()
  }
  if (last?.kind === 'tokens') {
    const t = last.tokens[last.tokens.length - 1]
    if (t?.kind === 'text') t.text = t.text.replace(/[ \t]+$/, '')
    if (t?.kind === 'text' && t.text === '') last.tokens.pop()
  }
  return inlines.filter((i) => i.kind !== 'tokens' || i.tokens.length > 0)
}

/** The file as blocks. Front matter first, as coloured YAML lines; then the body's tree. */
export function render(content: string, links: readonly FileLink[]): Rendered {
  const w = new Walker(content, links)
  const blocks: Block[] = []
  const fm = frontMatter(content)
  let bodyStart = 0
  if (fm) {
    blocks.push({
      kind: 'frontmatter',
      from: 1,
      to: fm.close !== null ? w.lineOf(fm.close) : w.endLineOf(content.length),
      lines: w.lines(fm.yamlFrom, fm.yamlTo, { scopes: true, info: 'yaml' }),
      closed: fm.close !== null,
    })
    bodyStart = fm.bodyStart
  }
  if (bodyStart < content.length) {
    // The body is parsed on its own, so offsets in its tree are shifted by
    // where it starts — the walker sees the whole file, the tree a suffix.
    const tree = parseMarkdown(content.slice(bodyStart))
    blocks.push(...w.blocks(new Shifted(tree.topNode, bodyStart)))
  }
  const lines = content.split('\n').length - (content.endsWith('\n') ? 1 : 0)
  return { blocks, lines: Math.max(1, lines) }
}

// A SyntaxNode with every offset moved by `base`: the body's tree,
// addressed in the file's coordinates.
class Shifted implements Node {
  constructor(private readonly node: Node, private readonly base: number) {}
  get name() { return this.node.name }
  get from() { return this.node.from + this.base }
  get to() { return this.node.to + this.base }
  get firstChild(): Shifted | null { const c = this.node.firstChild; return c ? new Shifted(c, this.base) : null }
  get nextSibling(): Shifted | null { const c = this.node.nextSibling; return c ? new Shifted(c, this.base) : null }
  getChild(name: string): Shifted | null { const c = this.node.getChild(name); return c ? new Shifted(c, this.base) : null }
}
