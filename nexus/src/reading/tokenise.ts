// reading/tokenise.ts — the source, as the reader shows it. docs/READING.md.
//
// A markdown renderer hides an HTML comment, a right-to-left override, a
// zero-width space and a Cyrillic a (U+0430) that reads as Latin — every concealment
// THREATS.md names and the scanner has a rule for. So the reader renders the
// source, and this is the one pass that decides what each character becomes:
// text, a named escape, a confusable with the letter it imitates, a
// whitespace mark, or a link span the exporter already resolved. Colour is
// the one thing it takes from elsewhere: reading/highlight.ts hands in
// ranges, and a text token carries the scope it fell under. Pure: a string,
// its links and its colour in, lines of tokens out, nothing read and no DOM.
//
// The character classes are the scanner's (commands/audit-skill.mjs), by
// range, so a character the scanner would flag is never one this pass would
// hide. Written as escapes, never as literals, for the scanner's own reason:
// the reviewer of the reader deserves the same legibility.

import type { FileLink } from '../data/types.ts'
import { CONFUSABLES } from './confusables.ts'
import type { Scope, ScopeRange } from './highlight.ts'

export type EscapeClass = 'control' | 'invisible' | 'bidi' | 'tag'

export type Token =
  | { kind: 'text'; text: string; bidi: boolean; scope?: Scope }
  | { kind: 'escape'; label: string; cls: EscapeClass; opens: boolean; closes: boolean }
  | { kind: 'confusable'; text: string; label: string; looksLike: string }
  | { kind: 'ws'; mark: string; label: string }
  | { kind: 'link'; link: FileLink; tokens: Token[] }
  /** An HTML comment: scanned like any text, so an invisible inside it is still a chip. */
  | { kind: 'comment'; tokens: Token[] }

export type LineClass = 'plain' | 'frontmatter' | 'heading' | 'fence'

export interface TokeniseOptions {
  /** The highlighter's ranges over `content` (reading/highlight.ts), sorted. */
  scopes?: readonly ScopeRange[]
  /**
   * Class lines as markdown — front matter, headings, fences. Default on,
   * because the reader's first file is SKILL.md; off for a script or a YAML
   * file, where `# x` is a comment and a leading `---` a document start.
   */
  markdown?: boolean
  /**
   * Mark trailing spaces on a line as dots. Default on — the source view;
   * off for a slice of prose, where the space before an inline element is
   * not the end of a line.
   */
  trailing?: boolean
}

export interface Line {
  n: number
  cls: LineClass
  tokens: Token[]
}

/** What the file had to escape, for the header. */
export interface Counts {
  control: number
  invisible: number
  bidi: number
  tag: number
  confusable: number
  /** Everything else above U+007F: rendered as it is, counted so the header can say so. */
  nonAscii: number
  longest: number
}

export interface Tokenised {
  lines: Line[]
  counts: Counts
}

// A scope range in the columns of one line, clipped to it.
interface LineScope {
  from: number
  to: number
  scope: Scope
}

//   200B-200F zero width & directional marks · 2060-2064 invisible operators
//   FEFF BOM · 00AD soft hyphen · 180E Mongolian vowel separator
//   2028/2029 line & paragraph separators           (the scanner's INVISIBLE_RE)
const INVISIBLE_RE = /[\u200B-\u200F\u2060-\u2064\uFEFF\u00AD\u180E\u2028\u2029]/u
//   202A-202E embedding & override · 2066-2069 isolates   (the scanner's BIDI_RE)
const BIDI_RE = /[\u202A-\u202E\u2066-\u2069]/u
//   E0000-E007F tag characters                         (the scanner's tag scan)
const TAG_RE = /[\u{E0000}-\u{E007F}]/u
//   C0 and C1 controls, tab / LF / CR excepted — those are whitespace marks
const CONTROL_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/u

// A bidi run: an embedding or override opens it, PDF (202C) or PDI (2069)
// closes it. Text inside is underlined so the reversal is visible as a span,
// not only as a chip at its start.
const BIDI_OPENS = new Set([0x202a, 0x202b, 0x202d, 0x202e, 0x2066, 0x2067, 0x2068])
const BIDI_CLOSES = new Set([0x202c, 0x2069])

export function codepointLabel(cp: number): string {
  return `U+${cp.toString(16).toUpperCase().padStart(4, '0')}`
}

function classify(ch: string): EscapeClass | null {
  if (CONTROL_RE.test(ch)) return 'control'
  if (BIDI_RE.test(ch)) return 'bidi'
  if (INVISIBLE_RE.test(ch)) return 'invisible'
  if (TAG_RE.test(ch)) return 'tag'
  return null
}

interface Scan {
  counts: Counts
  bidi: boolean
}

// One run of characters, no links in it: text with escapes, confusables and
// whitespace marks broken out. `trailingFrom` is the column where trailing
// whitespace begins on this line (or Infinity), so the dots land only there.
// `scopes` is the highlighter's colour for this line, sorted; a text token
// ends where its scope does, and nothing else about the run changes — a
// scope is a tint on characters the scan has already decided to show.
function scanRun(run: string, colStart: number, trailingFrom: number, scan: Scan, scopes: readonly LineScope[] = []): Token[] {
  const out: Token[] = []
  let text = ''
  let scope: Scope | undefined
  const flush = () => {
    if (text) out.push(scope ? { kind: 'text', text, bidi: scan.bidi, scope } : { kind: 'text', text, bidi: scan.bidi })
    text = ''
  }
  let col = colStart
  let si = 0
  for (const ch of run) {
    const cp = ch.codePointAt(0) ?? 0
    while (si < scopes.length && (scopes[si]?.to ?? 0) <= col) si++
    const here = scopes[si] && (scopes[si]?.from ?? Infinity) <= col ? scopes[si]?.scope : undefined
    if (here !== scope) { flush(); scope = here }
    const cls = classify(ch)
    if (cls) {
      flush()
      const opens = cls === 'bidi' && BIDI_OPENS.has(cp)
      const closes = cls === 'bidi' && BIDI_CLOSES.has(cp)
      out.push({ kind: 'escape', label: codepointLabel(cp), cls, opens, closes })
      scan.counts[cls]++
      if (opens) scan.bidi = true
      if (closes) scan.bidi = false
    } else if (ch === '\t') {
      flush()
      out.push({ kind: 'ws', mark: '→', label: 'tab' })
    } else if (ch === '\r') {
      flush()
      out.push({ kind: 'ws', mark: '␍', label: 'carriage return' })
    } else if (ch === '\u00A0') {
      flush()
      out.push({ kind: 'ws', mark: '⍽', label: 'no-break space U+00A0' })
    } else if (ch === ' ' && col >= trailingFrom) {
      flush()
      out.push({ kind: 'ws', mark: '·', label: 'trailing space' })
    } else if (CONFUSABLES.has(ch)) {
      flush()
      out.push({ kind: 'confusable', text: ch, label: codepointLabel(cp), looksLike: CONFUSABLES.get(ch) ?? '' })
      scan.counts.confusable++
    } else {
      if (cp > 0x7f) scan.counts.nonAscii++
      text += ch
    }
    col += ch.length
  }
  flush()
  return out
}

// HTML comments, which a rendered view drops entirely. Marked as their own
// token so they read as present-but-not-prose; a comment may span lines, so
// the open state carries from one line to the next.
function splitComments(line: string, open: boolean): { segments: Array<{ text: string; col: number; comment: boolean }>; open: boolean } {
  const segments: Array<{ text: string; col: number; comment: boolean }> = []
  let i = 0
  let inComment = open
  while (i < line.length) {
    if (inComment) {
      const end = line.indexOf('-->', i)
      const stop = end === -1 ? line.length : end + 3
      segments.push({ text: line.slice(i, stop), col: i, comment: true })
      i = stop
      if (end !== -1) inComment = false
    } else {
      const start = line.indexOf('<!--', i)
      const stop = start === -1 ? line.length : start
      if (stop > i) segments.push({ text: line.slice(i, stop), col: i, comment: false })
      i = stop
      if (start !== -1) inComment = true
    }
  }
  return { segments, open: inComment }
}

export function tokenise(content: string, links: readonly FileLink[], options: TokeniseOptions = {}): Tokenised {
  const { scopes = [], markdown = true, trailing = true } = options
  const raw = content.split('\n')
  // A trailing newline is the file ending, not an empty last line.
  if (raw.length > 1 && raw[raw.length - 1] === '') raw.pop()

  const counts: Counts = { control: 0, invisible: 0, bidi: 0, tag: 0, confusable: 0, nonAscii: 0, longest: 0 }
  const linksByLine = new Map<number, FileLink[]>()
  for (const l of links) {
    const list = linksByLine.get(l.line) ?? []
    list.push(l)
    linksByLine.set(l.line, list)
  }

  const lines: Line[] = []
  let inFrontmatter = markdown && raw[0] === '---'
  let inFence = false
  let commentOpen = false
  // The highlighter's ranges are offsets into `content`; each line takes the
  // ones that touch it, in its own columns. Sorted in, so one cursor walks
  // them once for the whole file.
  let lineStart = 0
  let scopeIdx = 0

  for (let i = 0; i < raw.length; i++) {
    const line = raw[i] ?? ''
    const n = i + 1
    counts.longest = Math.max(counts.longest, line.length)

    const lineEnd = lineStart + line.length
    while (scopeIdx < scopes.length && (scopes[scopeIdx]?.to ?? 0) <= lineStart) scopeIdx++
    const lineScopes: LineScope[] = []
    for (let k = scopeIdx; k < scopes.length; k++) {
      const r = scopes[k]
      if (!r || r.from >= lineEnd) break
      lineScopes.push({ from: Math.max(0, r.from - lineStart), to: Math.min(line.length, r.to - lineStart), scope: r.scope })
    }
    lineStart = lineEnd + 1

    let cls: LineClass = 'plain'
    if (!markdown) {
      // A script's lines are lines; colour, if any, is the highlighter's.
    } else if (inFrontmatter) {
      cls = 'frontmatter'
      if (i > 0 && line === '---') {
        inFrontmatter = false
      }
    } else if (/^\s*(```|~~~)/.test(line)) {
      cls = 'fence'
      inFence = !inFence
    } else if (inFence) {
      cls = 'fence'
    } else if (/^#{1,6}\s/.test(line)) {
      cls = 'heading'
    }

    const scan: Scan = { counts, bidi: false }
    // Trailing whitespace ends where the line's text ends, before a CR if
    // the file is CRLF — the \r is its own mark and must not hide the dots.
    const trailingFrom = trailing ? line.replace(/[ \t]+\r?$/, '').length : Infinity
    const tokens: Token[] = []

    // Links first (the exporter's offsets are authoritative), comments in
    // the gaps, characters inside both.
    const spans = (linksByLine.get(n) ?? []).slice().sort((a, b) => a.col - b.col)
    let cursor = 0
    const gap = (from: number, to: number) => {
      if (to <= from) return
      const { segments, open } = splitComments(line.slice(from, to), commentOpen)
      commentOpen = open
      for (const seg of segments) {
        const scanned = scanRun(seg.text, from + seg.col, trailingFrom, scan, lineScopes)
        if (seg.comment) tokens.push({ kind: 'comment', tokens: scanned })
        else tokens.push(...scanned)
      }
    }
    for (const link of spans) {
      if (link.col < cursor || link.col + link.len > line.length) continue // a stale offset never corrupts the line
      gap(cursor, link.col)
      const inner = line.slice(link.col, link.col + link.len)
      tokens.push({ kind: 'link', link, tokens: scanRun(inner, link.col, trailingFrom, scan, lineScopes) })
      cursor = link.col + link.len
    }
    gap(cursor, line.length)

    lines.push({ n, cls, tokens })
  }

  return { lines, counts }
}

/** How many characters the view had to escape or mark — the header's number. */
export function escapedTotal(counts: Counts): number {
  return counts.control + counts.invisible + counts.bidi + counts.tag + counts.confusable
}
