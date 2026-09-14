// ui/MarkdownPreview.tsx — the formatted mode. docs/READING.md, "Preview".
//
// A toggle, off by default; the source view is the reader. This lays out
// reading/render.ts's blocks — headings as headings, lists as lists, fences
// as numbered code — and puts every character through the same TokenSpan
// the source view uses, so the preview hides nothing the source shows: an
// invisible is a chip inside a paragraph, a homoglyph is underlined, an HTML
// comment is a comment, an image is its alt and its target and never a
// request, an HTML tag is its own source. No element here is ever built
// from an HTML string.
//
// A block knows its source lines, so findings pin under the block that
// holds their line and a line address lands on its block. Blocks are not
// windowed — the pane refuses the preview above PREVIEW_LIMIT instead.

import { useEffect, useRef } from 'react'
import type { CSSProperties } from 'react'
import type { FileLink, PinnedFinding } from '../data/types.ts'
import type { Align, Block, Inline, Rendered } from '../reading/render.ts'
import type { Line } from '../reading/tokenise.ts'
import { LinkSpan, PinRow, SEVERITY_COLOUR, TokenSpan } from './tokens.tsx'

export interface MarkdownPreviewProps {
  rendered: Rendered
  findings: PinnedFinding[]
  /** The line asked for, if any: its block is banded and brought into view. */
  line: number | null
  /** Changes when a new scroll is asked for — the pane's request string. */
  request: string
  onFollow: (link: FileLink) => void
  onGoTo: (line: number) => void
}

const HEADING_SIZE: Record<1 | 2 | 3 | 4 | 5 | 6, string> = {
  1: 'var(--nx-text-xl)', 2: 'var(--nx-text-lg)', 3: 'var(--nx-text-md)', 4: 'var(--nx-text-sm)', 5: 'var(--nx-text-sm)', 6: 'var(--nx-text-xs)',
}

const prose: CSSProperties = { whiteSpace: 'normal', wordBreak: 'break-word', lineHeight: 1.55, color: 'var(--nx-fg-muted)', margin: 0 }
const mono: CSSProperties = { whiteSpace: 'pre', overflowX: 'auto', fontSize: 'var(--nx-text-xs)', lineHeight: '18px' }
const label: CSSProperties = { color: 'var(--nx-fg-tertiary)', fontSize: 'var(--nx-text-2xs)', letterSpacing: 'var(--nx-track-wide)', textTransform: 'uppercase' }

function Inlines({ items, onFollow }: { items: Inline[]; onFollow: (link: FileLink) => void }) {
  return <>{items.map((x, i) => <InlineView key={i} x={x} onFollow={onFollow} />)}</>
}

function InlineView({ x, onFollow }: { x: Inline; onFollow: (link: FileLink) => void }) {
  switch (x.kind) {
    case 'tokens': return <>{x.tokens.map((t, i) => <TokenSpan key={i} t={t} onFollow={onFollow} />)}</>
    case 'em': return <em><Inlines items={x.children} onFollow={onFollow} /></em>
    case 'strong': return <strong style={{ color: 'var(--nx-fg-default)', fontWeight: 600 }}><Inlines items={x.children} onFollow={onFollow} /></strong>
    case 'strike': return <s><Inlines items={x.children} onFollow={onFollow} /></s>
    case 'code': return <code style={{ font: 'inherit', color: 'var(--nx-fg-default)', background: 'var(--nx-bg-raised)', padding: '0 3px' }}>{x.tokens.map((t, i) => <TokenSpan key={i} t={t} onFollow={onFollow} />)}</code>
    case 'link':
      // The exporter resolved it: the same button or inert span the source
      // shows. It did not (a title-only or empty target): the label, and the
      // target named beside it so nothing is silently a link to nowhere.
      return x.link
        ? <LinkSpan link={x.link} onFollow={onFollow}><Inlines items={x.children} onFollow={onFollow} /></LinkSpan>
        : <span title={`link target not resolved by the export · ${x.target}`}><Inlines items={x.children} onFollow={onFollow} /><span aria-hidden="true" style={label}> · {x.target || 'NO TARGET'}</span></span>
    case 'image':
      // Never fetched. READING.md: no remote images — and no local ones
      // either, because a fetch is a request and the rule is none.
      return (
        <span style={{ border: 'var(--nx-hairline) dashed var(--nx-border-default)', padding: '0 6px', color: 'var(--nx-fg-muted)' }} title={`image — never loaded · ${x.target}`}>
          <span style={label}>image </span>{x.alt || '(no alt)'}<span style={label}> → {x.target}</span>
        </span>
      )
    case 'html':
      return <code style={{ font: 'inherit', color: 'var(--nx-fg-tertiary)' }} title="HTML — shown as source, never rendered">{x.tokens.map((t, i) => <TokenSpan key={i} t={t} onFollow={onFollow} />)}</code>
    case 'break': return <br />
    case 'task': return <span aria-label={x.checked ? 'done' : 'to do'} style={{ color: 'var(--nx-fg-tertiary)', marginRight: 6 }}>{x.checked ? '☑' : '☐'}</span>
  }
}

// Lines of code, front matter, HTML or an unshaped block: the source view's
// row, numbered by the file's own line numbers.
function SourceLines({ lines, from, onFollow, tone }: { lines: Line[]; from: number; onFollow: (link: FileLink) => void; tone?: 'comment' | 'html' }) {
  return (
    <div style={{ ...mono, background: 'rgba(255,255,255,.02)', padding: '6px 0', borderLeft: 'var(--nx-hairline) solid var(--nx-border-default)' }}>
      {lines.map((l) => (
        <div key={l.n} style={{ display: 'grid', gridTemplateColumns: '44px minmax(0, 1fr)', color: tone === 'comment' ? 'var(--nx-fg-tertiary)' : 'var(--nx-fg-muted)', fontStyle: tone === 'comment' ? 'italic' : undefined }}>
          <span aria-hidden="true" style={{ color: 'var(--nx-fg-tertiary)', textAlign: 'right', paddingRight: 10, userSelect: 'none', fontVariantNumeric: 'tabular-nums' }}>{from + l.n - 1}</span>
          <span style={{ paddingLeft: 6 }}>{l.tokens.map((t, i) => <TokenSpan key={i} t={t} onFollow={onFollow} />)}</span>
        </div>
      ))}
    </div>
  )
}

function BlockView({ b, onFollow, depth }: { b: Block; onFollow: (link: FileLink) => void; depth: number }) {
  switch (b.kind) {
    case 'frontmatter':
      return (
        <div>
          <div style={label}>front matter{b.closed ? '' : ' · never closed'}</div>
          <SourceLines lines={b.lines} from={2} onFollow={onFollow} />
        </div>
      )
    case 'heading': {
      const Tag = `h${b.level}` as const
      return <Tag style={{ ...prose, color: 'var(--nx-fg-default)', fontSize: HEADING_SIZE[b.level], fontWeight: 600, lineHeight: 1.3, marginTop: depth === 0 ? 'var(--nx-space-3)' : 0 }}><Inlines items={b.children} onFollow={onFollow} /></Tag>
    }
    case 'paragraph':
      return <p style={prose}><Inlines items={b.children} onFollow={onFollow} /></p>
    case 'quote':
      return (
        <blockquote style={{ margin: 0, paddingLeft: 12, borderLeft: '2px solid var(--nx-border-default)', color: 'var(--nx-fg-muted)' }}>
          <Blocks blocks={b.children} onFollow={onFollow} depth={depth + 1} />
        </blockquote>
      )
    case 'list': {
      const Tag = b.ordered ? 'ol' : 'ul'
      return (
        <Tag start={b.ordered ? b.start : undefined} style={{ ...prose, paddingLeft: 22, display: 'grid', gap: 2 }}>
          {b.items.map((item, i) => <li key={i}><Blocks blocks={item.children} onFollow={onFollow} depth={depth + 1} /></li>)}
        </Tag>
      )
    }
    case 'code':
      return (
        <div>
          {b.info && <div style={label}>{b.info}</div>}
          <SourceLines lines={b.lines} from={b.first} onFollow={onFollow} />
        </div>
      )
    case 'rule':
      return <hr style={{ border: 0, borderTop: 'var(--nx-hairline) solid var(--nx-border-default)', margin: 'var(--nx-space-2) 0' }} />
    case 'html':
      return (
        <div>
          <div style={label}>html · shown as source, never rendered</div>
          <SourceLines lines={b.lines} from={b.from} onFollow={onFollow} tone="html" />
        </div>
      )
    case 'comment':
      return (
        <div>
          <div style={label}>html comment · dropped by any rendered view, present in context</div>
          <SourceLines lines={b.lines} from={b.from} onFollow={onFollow} tone="comment" />
        </div>
      )
    case 'source':
      return <SourceLines lines={b.lines} from={b.from} onFollow={onFollow} />
    case 'table': {
      const cell = (align: Align): CSSProperties => ({
        padding: '3px 10px', textAlign: align ?? 'left', borderBottom: 'var(--nx-hairline) solid var(--nx-border-default)', verticalAlign: 'top', whiteSpace: 'normal',
      })
      return (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', fontSize: 'var(--nx-text-xs)', lineHeight: 1.5, color: 'var(--nx-fg-muted)' }}>
            {b.header.length > 0 && (
              <thead><tr>{b.header.map((c, i) => <th key={i} style={{ ...cell(b.align[i] ?? null), color: 'var(--nx-fg-default)', fontWeight: 600 }}><Inlines items={c} onFollow={onFollow} /></th>)}</tr></thead>
            )}
            <tbody>{b.rows.map((row, r) => <tr key={r}>{row.map((c, i) => <td key={i} style={cell(b.align[i] ?? null)}><Inlines items={c} onFollow={onFollow} /></td>)}</tr>)}</tbody>
          </table>
        </div>
      )
    }
  }
}

function Blocks({ blocks, onFollow, depth }: { blocks: Block[]; onFollow: (link: FileLink) => void; depth: number }) {
  return <>{blocks.map((b, i) => <BlockView key={i} b={b} onFollow={onFollow} depth={depth} />)}</>
}

export function MarkdownPreview({ rendered, findings, line, request, onFollow, onGoTo }: MarkdownPreviewProps) {
  // Top-level blocks are the pin and scroll unit: a finding pins under the
  // block holding its line, a line address lands on its block.
  const holder = (n: number) => rendered.blocks.findIndex((b) => b.from <= n && n <= b.to)
  const pinned = new Map<number, PinnedFinding[]>()
  for (const f of findings) {
    if (f.line === null) continue
    const i = holder(f.line)
    if (i === -1) continue
    pinned.set(i, [...(pinned.get(i) ?? []), f])
  }
  const target = line === null ? -1 : holder(line)

  // Scroll on a request and only then — the same rule as the source view:
  // a line to its block, no line to the top; a re-render moves nobody.
  const rootRef = useRef<HTMLDivElement | null>(null)
  const refs = useRef<Array<HTMLDivElement | null>>([])
  const requestRef = useRef('')
  useEffect(() => {
    if (request === requestRef.current) return
    requestRef.current = request
    if (line === null) rootRef.current?.scrollIntoView({ block: 'start' })
    else if (target !== -1) refs.current[target]?.scrollIntoView({ block: 'center' })
  }, [request, target, line])

  return (
    <div ref={rootRef} style={{ padding: 'var(--nx-space-4) var(--nx-space-5)', maxWidth: 760, display: 'grid', gap: 'var(--nx-space-3)', fontSize: 'var(--nx-text-sm)' }}>
      {rendered.blocks.map((b, i) => {
        const pins = pinned.get(i) ?? []
        const worst = pins.reduce<PinnedFinding['severity'] | null>((acc, f) => (acc === 'block' ? acc : f.severity === 'block' ? 'block' : acc === 'review' ? acc : f.severity), null)
        return (
          <div
            key={i}
            ref={(el) => { refs.current[i] = el }}
            data-lines={`${b.from}-${b.to}`}
            style={{
              margin: '0 calc(-1 * var(--nx-space-3))', padding: '2px var(--nx-space-3)',
              background: target === i ? 'rgba(254,221,0,.08)' : worst === 'block' ? 'rgba(255,46,99,.06)' : worst ? 'rgba(255,255,255,.03)' : undefined,
              borderLeft: worst ? `2px solid ${SEVERITY_COLOUR[worst]}` : '2px solid transparent',
            }}
          >
            <BlockView b={b} onFollow={onFollow} depth={0} />
            {pins.length > 0 && (
              <div style={{ margin: '4px 0 0 -58px' }}>
                {pins.map((f, k) => <PinRow key={`${f.code}:${f.at}:${k}`} finding={f} onGoTo={onGoTo} />)}
              </div>
            )}
          </div>
        )
      })}
      {rendered.blocks.length === 0 && <span style={label}>empty file</span>}
    </div>
  )
}
