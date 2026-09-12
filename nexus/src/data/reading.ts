// Pure pieces of the reading room's export — READING-ROOM.html, phase 2.
//
// What in a file is a link, where it points, which heading a `#fragment`
// names, and which line a finding's `at` pins to. All of it runs once, in
// scripts/export-graph.mjs, and ships on the file as offsets; the viewer
// colours spans it is handed and never parses markdown. SHIPPING.md §8
// again: the one place that knows which name is a skill, which a refused
// row and which a ghost is the one place a link is resolved, so there is no
// second resolution order to drift.
//
// Nothing here reads a file. The exporter walks and decodes; this decides.

import { posix } from 'node:path'

import { resolveEntityKind } from './integrity.ts'
import type { Finding } from '../../packages/record/schema.ts'
import type { FileLink, LinkKind, PinnedFinding } from './types.ts'

// ------------------------------------------------------------- anchors

export interface Anchor {
  slug: string
  line: number
}

// GitHub's heading-to-fragment rule, near enough for skills that link to
// their own sections: lowercase, drop everything but letters, digits,
// spaces and hyphens, spaces to hyphens, and a `-n` suffix on repeats.
export function slugify(heading: string): string {
  return heading
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s+/g, '-')
}

export function findAnchors(lines: readonly string[]): Anchor[] {
  const seen = new Map<string, number>()
  const anchors: Anchor[] = []
  for (let i = 0; i < lines.length; i++) {
    const m = /^#{1,6}\s+(.+?)\s*#*\s*$/.exec(lines[i] ?? '')
    if (!m) continue
    const base = slugify(m[1] ?? '')
    const n = seen.get(base) ?? 0
    seen.set(base, n + 1)
    anchors.push({ slug: n === 0 ? base : `${base}-${n}`, line: i + 1 })
  }
  return anchors
}

// --------------------------------------------------------------- links

/** What the resolver knows about the library, handed in rather than looked up. */
export interface LinkContext {
  /** The skill this file belongs to. */
  skill: string
  /** This file's path within the skill, posix. */
  file: string
  /** Every file path in this skill (the walk), posix. */
  files: ReadonlySet<string>
  /** Leaf node ids in this skill keyed by path — `references/x.md` → `<skill>/x.md`. */
  leafIdByPath: ReadonlyMap<string, string>
  /** The skill's scriptFold node id, if it has scripts. */
  scriptFoldId: string | null
  skillIds: ReadonlySet<string>
  refusedNames: ReadonlySet<string>
  declinedNames: ReadonlySet<string>
  /** Ghost nodes the export minted — from edges and operative calls, never from a link. */
  ghostNames: ReadonlySet<string>
}

interface Span {
  col: number
  len: number
  raw: string
  /** How the target was written: a path or fragment, a name, or a URL. */
  form: 'path' | 'name' | 'url'
}

// The canonical operative form — export-graph.mjs's own CALLS_RE, restated
// here because this file colours the span and that one mints the edge, and
// the two must agree on what the form is.
const CALL_RE = /Call the Skill tool with ["'`]([a-z0-9-]+)["'`]/gi
const MD_LINK_RE = /!?\[[^\]]*\]\(\s*(<[^>]*>|[^)\s]+)(?:\s+(?:"[^"]*"|'[^']*'))?\s*\)/g
const AUTOLINK_RE = /<((?:https?|mailto|file|ftp):[^>\s]+)>/g
const BARE_URL_RE = /\bhttps?:\/\/[^\s<>()[\]"'`]+/g
const WIKILINK_RE = /\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]/g

function spansOf(line: string): Span[] {
  const spans: Span[] = []
  for (const m of line.matchAll(MD_LINK_RE)) {
    const target = m[1] ?? ''
    const inner = target.startsWith('<') ? target.slice(1, -1) : target
    // The target starts after `](` and any space — not at the first place
    // its text occurs, which for `[references/x.md](references/x.md)` is
    // the label.
    const open = m[0].indexOf('](') + 2
    const at = m.index + open + (m[0].slice(open).length - m[0].slice(open).trimStart().length) + (target.startsWith('<') ? 1 : 0)
    spans.push({ col: at, len: inner.length, raw: inner, form: 'path' })
  }
  for (const m of line.matchAll(AUTOLINK_RE)) {
    spans.push({ col: m.index + 1, len: (m[1] ?? '').length, raw: m[1] ?? '', form: 'url' })
  }
  for (const m of line.matchAll(BARE_URL_RE)) {
    spans.push({ col: m.index, len: m[0].length, raw: m[0], form: 'url' })
  }
  for (const m of line.matchAll(CALL_RE)) {
    const name = m[1] ?? ''
    // The name is the last thing in the match, inside its quotes — found
    // from the end, because a skill called `the` occurs in the phrase first.
    spans.push({ col: m.index + m[0].lastIndexOf(name), len: name.length, raw: name, form: 'name' })
  }
  for (const m of line.matchAll(WIKILINK_RE)) {
    const name = m[1] ?? ''
    spans.push({ col: m.index + 2, len: name.length, raw: name, form: 'name' })
  }
  // Earliest wins; a bare URL inside a markdown link is the same span twice.
  // An empty destination — `[x](<>)`, legal CommonMark — is no span at all.
  spans.sort((a, b) => a.col - b.col || b.len - a.len)
  const kept: Span[] = []
  let end = -1
  for (const s of spans) {
    if (s.len === 0 || s.col < end) continue
    kept.push(s)
    end = s.col + s.len
  }
  return kept
}

const SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i

function hostOf(url: string): string {
  try {
    return new URL(url).host || (url.split(':')[0] ?? url)
  } catch {
    return url.split(':')[0] ?? url
  }
}

/** A name that the export already has a node for, through §5's order; a link never mints one. */
function resolveName(name: string, ctx: LinkContext): string | null {
  if (ctx.ghostNames.has(name)) return name
  const kind = resolveEntityKind(name, { skillIds: ctx.skillIds, refusedNames: ctx.refusedNames, declinedNames: ctx.declinedNames })
  return kind === 'ghost' ? null : name
}

export function resolveTarget(span: Span, ctx: LinkContext): { kind: LinkKind; to: string | null } {
  if (span.form === 'url') return { kind: 'external', to: hostOf(span.raw) }
  if (span.form === 'name') {
    const to = resolveName(span.raw, ctx)
    return to === null ? { kind: 'unresolved', to: null } : { kind: 'node', to }
  }

  const raw = span.raw
  if (raw.startsWith('#')) {
    // A stray `%` in a fragment is a malformed link, not a reason to abort
    // the export of every other file: it resolves to nothing.
    try {
      return { kind: 'anchor', to: slugify(decodeURIComponent(raw.slice(1))) }
    } catch {
      return { kind: 'unresolved', to: null }
    }
  }
  if (SCHEME_RE.test(raw)) return { kind: 'external', to: hostOf(raw) }

  // A path, relative to this file, kept inside the skill's own tree or
  // pointing at a sibling skill's directory. Nothing else resolves.
  const bare = raw.replace(/[?#].*$/, '')
  let target: string
  try {
    target = posix.normalize(posix.join(posix.dirname(ctx.file), decodeURIComponent(bare)))
  } catch {
    return { kind: 'unresolved', to: null }
  }
  if (target.startsWith('../')) {
    const [, sibling, ...rest] = target.split('/')
    if (!sibling || rest.some((seg) => seg === '..')) return { kind: 'unresolved', to: null }
    const inside = rest.join('/')
    if (inside === '' || inside === 'SKILL.md') {
      const to = resolveName(sibling, ctx)
      return to === null ? { kind: 'unresolved', to: null } : { kind: 'node', to }
    }
    return { kind: 'unresolved', to: null }
  }
  if (target === '.' || target === '') return { kind: 'unresolved', to: null }

  const leaf = ctx.leafIdByPath.get(target)
  if (leaf) return { kind: 'node', to: leaf }
  if (target.startsWith('scripts/') && ctx.scriptFoldId && ctx.files.has(target)) return { kind: 'node', to: ctx.scriptFoldId }
  if (ctx.files.has(target)) return { kind: 'file', to: target }
  return { kind: 'unresolved', to: null }
}

export function findLinks(lines: readonly string[], ctx: LinkContext): FileLink[] {
  const links: FileLink[] = []
  for (let i = 0; i < lines.length; i++) {
    for (const span of spansOf(lines[i] ?? '')) {
      const { kind, to } = resolveTarget(span, ctx)
      links.push({ line: i + 1, col: span.col, len: span.len, raw: span.raw, kind, to })
    }
  }
  return links
}

// ------------------------------------------------------------ findings

// `at` as the record writes it: `SKILL.md:52:1`, or without a column, or a
// bare path. A line the file no longer has pins nowhere (`line: null`)
// rather than to a wrong line — the record's disposition `fixed` or
// `removed` says the bytes moved, and the pane says so instead of pointing.
export function parseAt(at: string): { file: string; line: number | null; col: number | null } {
  const m = /^(.*?)(?::(\d+))?(?::(\d+))?$/.exec(at)
  if (!m) return { file: at, line: null, col: null }
  return { file: m[1] ?? at, line: m[2] ? Number(m[2]) : null, col: m[3] ? Number(m[3]) : null }
}

// The scanner's excerpt() collapses runs of whitespace to one space and
// ends a truncated excerpt with `…` (commands/audit-skill.mjs), so the line
// is folded the same way before the comparison, and an elided excerpt only
// has to be a prefix of what it quoted. A hand-written excerpt with none of
// that is compared as it is.
export function excerptOnLine(excerpt: string, line: string): boolean {
  const folded = line.replace(/\s+/g, ' ').trim()
  let needle = excerpt.replace(/\s+/g, ' ').trim()
  if (needle === '') return false
  if (needle.endsWith('…')) needle = needle.slice(0, -1).trimEnd()
  return needle !== '' && folded.includes(needle)
}

export function pinFinding(finding: Finding, linesByFile: ReadonlyMap<string, readonly string[]>): PinnedFinding {
  const { file, line, col } = parseAt(finding.at)
  const lines = linesByFile.get(file)
  const onLine = line !== null && lines !== undefined && line >= 1 && line <= lines.length ? line : null
  const excerptMatches = onLine !== null && excerptOnLine(finding.excerpt, lines?.[onLine - 1] ?? '')
  return {
    code: finding.code,
    severity: finding.severity,
    at: finding.at,
    file,
    line: onLine,
    col: onLine === null ? null : col,
    excerpt: finding.excerpt,
    excerptMatches,
    disposition: finding.disposition,
    why: finding.why,
  }
}
