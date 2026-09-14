// ui/tokens.tsx — one token, one span. Shared by the source view
// (ReadingPane.tsx) and the preview (MarkdownPreview.tsx), so a chip, a
// confusable, a link or a comment is the same thing in both: the preview
// gets no renderer of its own for the characters that matter.
//
// Nothing here is ever set as HTML. Every span is a text node.

import type { CSSProperties, ReactNode } from 'react'
import type { FileLink, PinnedFinding } from '../data/types.ts'
import type { Scope } from '../reading/highlight.ts'
import type { Token } from '../reading/tokenise.ts'

export const SEVERITY_COLOUR = { block: 'var(--nx-fg-critical)', review: 'var(--nx-fg-warning)', note: 'var(--nx-fg-tertiary)' } as const

// A pinned finding is one row beneath its line, taller and fixed so the
// source view's offsets stay arithmetic; the preview uses the same row.
export const PIN_H = 92
export const GUTTER = 58

// ------------------------------------------------------------------ tokens

export const SCOPE_STYLE: Record<Scope, CSSProperties> = {
  keyword: { color: 'var(--nx-fg-default)' },
  string: { color: 'var(--nx-fg-warning)' },
  comment: { color: 'var(--nx-fg-muted)', fontStyle: 'italic' },
  literal: { color: 'var(--nx-fg-default)' },
  name: { color: 'var(--nx-fg-info)' },
  mark: { color: 'var(--nx-fg-tertiary)' },
  emphasis: { fontStyle: 'italic' },
  strong: { color: 'var(--nx-fg-default)', fontWeight: 600 },
  code: { color: 'var(--nx-fg-default)', background: 'var(--nx-bg-raised)' },
}

const chip: CSSProperties = {
  color: 'var(--nx-fg-critical)', background: 'rgba(255,46,99,.12)', padding: '0 3px',
  fontSize: 'var(--nx-text-2xs)', letterSpacing: 'var(--nx-track-tight)', verticalAlign: 'baseline',
}

export function TokenSpan({ t, onFollow }: { t: Token; onFollow: (link: FileLink) => void }) {
  switch (t.kind) {
    case 'text':
      // The bidi mark wins over any scope: a reversed run is a finding, a
      // keyword is a colour.
      if (t.bidi) return <span style={{ background: 'rgba(255,46,99,.10)', borderBottom: '1px solid var(--nx-fg-critical)' }} title="inside a bidirectional run">{t.text}</span>
      return t.scope ? <span style={SCOPE_STYLE[t.scope]}>{t.text}</span> : <>{t.text}</>
    case 'escape':
      return <span style={chip} title={`${t.cls} character ${t.label}`}>{t.label}</span>
    case 'confusable':
      return <span style={{ borderBottom: '1px dotted var(--nx-fg-warning)', color: 'var(--nx-fg-default)' }} title={`${t.label} — reads as "${t.looksLike}" but is not`}>{t.text}</span>
    case 'ws':
      return <span style={{ color: 'var(--nx-fg-tertiary)' }} title={t.label}>{t.mark}</span>
    case 'comment':
      return <span style={{ color: 'var(--nx-fg-tertiary)', fontStyle: 'italic' }} title="HTML comment — dropped by any rendered view, present in context">{t.tokens.map((s, i) => <TokenSpan key={i} t={s} onFollow={onFollow} />)}</span>
    case 'link':
      return <LinkSpan link={t.link} onFollow={onFollow}>{t.tokens.map((s, i) => <TokenSpan key={i} t={s} onFollow={onFollow} />)}</LinkSpan>
  }
}

export function LinkSpan({ link, onFollow, children }: { link: FileLink; onFollow: (link: FileLink) => void; children: ReactNode }) {
  const base: CSSProperties = { font: 'inherit', background: 'none', border: 0, padding: 0, margin: 0, cursor: 'pointer', color: 'var(--nx-fg-accent)' }
  switch (link.kind) {
    case 'node':
      // Dotted for a file in this skill, solid for another node in the graph.
      return (
        <button type="button" onClick={() => onFollow(link)} title={`open ${link.to}`}
          style={{ ...base, borderBottom: `1px ${link.to?.includes('/') ? 'dotted' : 'solid'} var(--nx-border-default)` }}>
          {children}
        </button>
      )
    case 'file':
      return <button type="button" onClick={() => onFollow(link)} title={`read ${link.to} — a file of this skill, not drawn`} style={{ ...base, borderBottom: '1px dotted var(--nx-border-default)' }}>{children}</button>
    case 'anchor':
      return <button type="button" onClick={() => onFollow(link)} title={`jump to #${link.to}`} style={{ ...base, color: 'var(--nx-fg-muted)', borderBottom: '1px solid var(--nx-border-default)' }}>{children}</button>
    case 'external':
      // Never an <a>. Nothing leaves the machine; the string can be copied.
      return (
        <span title={`external — never opened from here · ${link.to}`}
          style={{ color: 'var(--nx-fg-muted)', borderBottom: '1px dashed var(--nx-border-default)', cursor: 'text' }}>
          {children}<span aria-hidden="true" style={{ color: 'var(--nx-fg-tertiary)', fontSize: 'var(--nx-text-2xs)', letterSpacing: 'var(--nx-track-wide)' }}> ↗ INERT</span>
        </span>
      )
    case 'unresolved':
      return <span title="no node or file this export knows">{children}<span aria-hidden="true" style={{ color: 'var(--nx-fg-tertiary)', fontSize: 'var(--nx-text-2xs)', letterSpacing: 'var(--nx-track-wide)' }}> · NO NODE</span></span>
  }
}

// -------------------------------------------------------------------- pin

export function PinRow({ finding, onGoTo }: { finding: PinnedFinding; onGoTo?: (line: number) => void }) {
  const colour = SEVERITY_COLOUR[finding.severity]
  return (
    <div style={{ height: PIN_H, display: 'grid', gridTemplateColumns: `${GUTTER}px minmax(0, 1fr)`, whiteSpace: 'normal' }}>
      <span />
      <div style={{
        margin: '2px 12px 6px 6px', borderLeft: `2px solid ${colour}`, background: 'var(--nx-bg-raised)', padding: '5px 10px',
        fontSize: 'var(--nx-text-xs)', lineHeight: 1.45, overflow: 'auto', maxWidth: 520,
      }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'baseline', flexWrap: 'wrap' }}>
          <span style={{ color: 'var(--nx-fg-default)', fontWeight: 600 }}>{finding.code}</span>
          <span style={{ color: colour, fontSize: 'var(--nx-text-2xs)', letterSpacing: 'var(--nx-track-wide)', textTransform: 'uppercase' }}>{finding.severity}</span>
          <span style={{ fontSize: 'var(--nx-text-2xs)', letterSpacing: 'var(--nx-track-wide)', textTransform: 'uppercase', border: 'var(--nx-hairline) solid var(--nx-border-default)', padding: '0 5px', color: 'var(--nx-fg-muted)' }}>{finding.disposition}</span>
          {finding.line === null
            ? <span style={{ color: 'var(--nx-fg-warning)', fontSize: 'var(--nx-text-2xs)', letterSpacing: 'var(--nx-track-wide)' }}>{finding.at} · LINE GONE</span>
            : onGoTo
              ? <button type="button" onClick={() => onGoTo(finding.line ?? 1)} style={{ font: 'inherit', background: 'none', border: 0, padding: 0, color: 'var(--nx-fg-tertiary)', cursor: 'pointer' }}>{finding.at}</button>
              : <span style={{ color: 'var(--nx-fg-tertiary)' }}>{finding.at}{finding.excerptMatches ? '' : ' · LINE MOVED'}</span>}
        </div>
        <div style={{ color: 'var(--nx-fg-muted)', marginTop: 2 }}>{finding.why}</div>
      </div>
    </div>
  )
}

