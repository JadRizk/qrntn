// ui/ReadingPane.tsx — the reading room. READING-ROOM.html, phase 2.
//
// Opening a file replaces the drawer with this: the same right-hand slot,
// wider, full height. The header names the file and the verdict of its hash
// against the ledger; the body is the SOURCE — monospace, line-numbered,
// every concealment character shown as a named chip (reading/tokenise.ts)
// — with the audit's findings pinned under the lines they fired on and the
// human's disposition beside each. Links the exporter resolved are buttons
// that select the target node; a link to anywhere off this page is text.
//
// Nothing here is ever set as HTML. Every span is a text node built from
// the exporter's offsets over the string, and the CSP the page ships under
// (nexus/index.html, commands/view.mjs) is the belt to this brace.
//
// Colour: the accent for links and a matching hash (cleared is the accent);
// severity in critical / warning / tertiary, never the accent; escapes in
// critical because each one is a character a rendered view would hide.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { Drawer, HazardRule, SectionHeading } from '@nexus/react'
import type { FileLink, GraphNode, HashVerdict, PinnedFinding, SkillFile, TextFile } from '../data/types.ts'
import { escapedTotal, tokenise, type Line, type Token } from '../reading/tokenise.ts'

export interface Reading {
  /** The node whose bytes are open: a skill, or a declined / refused / ghost row. */
  nodeId: string
  /** The file within the skill; '' for a row with no bytes. */
  path: string
  /** A line to bring into view, when one was asked for. */
  line: number | null
}

export interface ReadingPaneProps {
  open: boolean
  reading: Reading | null
  width: number
  lookup: (id: string) => GraphNode | undefined
  onClose: () => void
  onFollow: (link: FileLink) => void
  onGoTo: (line: number) => void
  canGoBack: boolean
  onBack: () => void
}

const VERDICT: Record<HashVerdict, { label: string; colour: string }> = {
  matches: { label: 'matches ledger', colour: 'var(--nx-fg-accent)' },
  drift: { label: 'drift', colour: 'var(--nx-fg-critical)' },
  unlisted: { label: 'not in ledger', colour: 'var(--nx-fg-tertiary)' },
}
const SEVERITY_COLOUR = { block: 'var(--nx-fg-critical)', review: 'var(--nx-fg-warning)', note: 'var(--nx-fg-tertiary)' } as const

const shortDigest = (hex: string) => `sha256:${hex.slice(0, 4)}…${hex.slice(-4)}`
const shortCommit = (sha: string) => sha.slice(0, 7)
const sizeOf = (bytes: number) => (bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(bytes < 10240 ? 1 : 0)} KB`)

// Row geometry the windowing relies on. A line is one row; a pinned finding
// is one row beneath its line, taller and fixed so offsets stay arithmetic.
const LINE_H = 20
const PIN_H = 92
const GUTTER = 58

// ------------------------------------------------------------------ tokens

const chip: CSSProperties = {
  color: 'var(--nx-fg-critical)', background: 'rgba(255,46,99,.12)', padding: '0 3px',
  fontSize: 'var(--nx-text-2xs)', letterSpacing: 'var(--nx-track-tight)', verticalAlign: 'baseline',
}

function TokenSpan({ t, onFollow }: { t: Token; onFollow: (link: FileLink) => void }) {
  switch (t.kind) {
    case 'text':
      return t.bidi
        ? <span style={{ background: 'rgba(255,46,99,.10)', borderBottom: '1px solid var(--nx-fg-critical)' }} title="inside a bidirectional run">{t.text}</span>
        : <>{t.text}</>
    case 'escape':
      return <span style={chip} title={`${t.cls} character ${t.label}`}>{t.label}</span>
    case 'confusable':
      return <span style={{ borderBottom: '1px dotted var(--nx-fg-warning)', color: 'var(--nx-fg-default)' }} title={`${t.label} — reads as "${t.looksLike}" but is not`}>{t.text}</span>
    case 'ws':
      return <span style={{ color: 'var(--nx-fg-tertiary)' }} title={t.label}>{t.mark}</span>
    case 'comment':
      return <span style={{ color: 'var(--nx-fg-tertiary)', fontStyle: 'italic' }} title="HTML comment — dropped by any rendered view, present in context">{t.text}</span>
    case 'link':
      return <LinkSpan link={t.link} onFollow={onFollow}>{t.tokens.map((s, i) => <TokenSpan key={i} t={s} onFollow={onFollow} />)}</LinkSpan>
  }
}

function LinkSpan({ link, onFollow, children }: { link: FileLink; onFollow: (link: FileLink) => void; children: ReactNode }) {
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

// -------------------------------------------------------------------- rows

type Row = { kind: 'line'; line: Line; pinned: PinnedFinding[] } | { kind: 'pin'; finding: PinnedFinding; n: number }

function LineRow({ row, onFollow, highlighted }: { row: Extract<Row, { kind: 'line' }>; onFollow: (link: FileLink) => void; highlighted: boolean }) {
  const { line, pinned } = row
  const worst = pinned.reduce<PinnedFinding['severity'] | null>((acc, f) => (acc === 'block' ? acc : f.severity === 'block' ? 'block' : acc === 'review' ? acc : f.severity), null)
  const lineColour = line.cls === 'frontmatter' ? 'var(--nx-fg-tertiary)' : line.cls === 'heading' ? 'var(--nx-fg-default)' : 'var(--nx-fg-muted)'
  return (
    <div
      id={`L${line.n}`}
      style={{
        display: 'grid', gridTemplateColumns: `${GUTTER - 18}px 18px minmax(0, 1fr)`, height: LINE_H, lineHeight: `${LINE_H}px`,
        whiteSpace: 'pre', minWidth: 'max-content', paddingRight: 'var(--nx-space-4)',
        background: highlighted ? 'rgba(254,221,0,.08)' : worst === 'block' ? 'rgba(255,46,99,.06)' : worst ? 'rgba(255,255,255,.03)' : undefined,
        fontWeight: line.cls === 'heading' ? 600 : 400, color: lineColour,
      }}
    >
      <span aria-hidden="true" style={{ color: 'var(--nx-fg-tertiary)', textAlign: 'right', paddingRight: 8, userSelect: 'none', fontVariantNumeric: 'tabular-nums' }}>{line.n}</span>
      <span aria-hidden="true" style={{ color: worst ? SEVERITY_COLOUR[worst] : undefined, textAlign: 'center', userSelect: 'none', fontSize: 'var(--nx-text-2xs)' }}>{worst ? '■' : ''}</span>
      <span style={{ paddingLeft: 6 }}>{line.tokens.map((t, i) => <TokenSpan key={i} t={t} onFollow={onFollow} />)}</span>
    </div>
  )
}

function PinRow({ finding, onGoTo }: { finding: PinnedFinding; onGoTo?: (line: number) => void }) {
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

// ------------------------------------------------------------------- pane

export function ReadingPane(props: ReadingPaneProps) {
  const { open, reading, width, lookup, onClose, onFollow, onGoTo, canGoBack, onBack } = props
  const node = reading ? lookup(reading.nodeId) : undefined
  const skill = node?.kind === 'skill' ? node : null
  const file: SkillFile | null = skill && reading ? skill.files.find((f) => f.path === reading.path) ?? null : null
  const text: TextFile | null = file?.kind === 'text' ? file : null

  const tokenised = useMemo(() => (text ? tokenise(text.content, text.links) : null), [text])
  const findings = useMemo(() => (skill && reading ? skill.findings.filter((f) => f.file === reading.path) : []), [skill, reading])
  const unpinned = useMemo(() => findings.filter((f) => f.line === null), [findings])

  // Lines and pins, interleaved, with prefix offsets so a window and a
  // scroll-to-line are both arithmetic. Findings pin under their line.
  const { rows, offsets, total } = useMemo(() => {
    const rows: Row[] = []
    const byLine = new Map<number, PinnedFinding[]>()
    for (const f of findings) if (f.line !== null) byLine.set(f.line, [...(byLine.get(f.line) ?? []), f])
    for (const line of tokenised?.lines ?? []) {
      const pinned = byLine.get(line.n) ?? []
      rows.push({ kind: 'line', line, pinned })
      for (const f of pinned) rows.push({ kind: 'pin', finding: f, n: line.n })
    }
    const offsets = new Array<number>(rows.length + 1)
    offsets[0] = 0
    rows.forEach((r, i) => { offsets[i + 1] = (offsets[i] ?? 0) + (r.kind === 'line' ? LINE_H : PIN_H) })
    return { rows, offsets, total: offsets[rows.length] ?? 0 }
  }, [tokenised, findings])

  // Windowing: only the rows near the viewport are in the DOM. A 100,000-
  // line file is a fact the header states, not a page the browser chokes on.
  // The scroller is the Drawer's own body — the element above this one —
  // because a nested scroller cannot resolve a percentage height inside a
  // flex item, and two scrollers fighting is worse than one reached by
  // parentElement.
  const scrollRef = useRef<HTMLElement | null>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewH, setViewH] = useState(600)
  const bodyRef = useCallback((el: HTMLDivElement | null) => { scrollRef.current = el?.parentElement ?? null }, [])
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el || !open) return
    const onScroll = () => setScrollTop(el.scrollTop)
    const ro = new ResizeObserver(() => setViewH(el.clientHeight))
    ro.observe(el)
    setViewH(el.clientHeight)
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => { ro.disconnect(); el.removeEventListener('scroll', onScroll) }
  }, [open])

  const [first, last] = useMemo(() => {
    if (rows.length === 0) return [0, 0]
    let lo = 0, hi = rows.length
    while (lo < hi) { const mid = (lo + hi) >> 1; if ((offsets[mid + 1] ?? 0) < scrollTop) lo = mid + 1; else hi = mid }
    const start = Math.max(0, lo - 20)
    let end = start
    while (end < rows.length && (offsets[end] ?? 0) < scrollTop + viewH) end++
    return [start, Math.min(rows.length, end + 20)]
  }, [rows, offsets, scrollTop, viewH])

  // Scroll to the asked-for line: on open, on a finding step, on an anchor.
  useEffect(() => {
    const el = scrollRef.current
    if (!el || !reading) return
    if (reading.line === null) { el.scrollTop = 0; return }
    const idx = rows.findIndex((r) => r.kind === 'line' && r.line.n === reading.line)
    if (idx === -1) return
    el.scrollTop = Math.max(0, (offsets[idx] ?? 0) - viewH / 3)
  }, [reading, rows, offsets, viewH])

  // ---- header

  const crumbs: ReactNode = reading && (
    <span style={{ letterSpacing: 'var(--nx-track-wide)', textTransform: 'uppercase', fontSize: 'var(--nx-text-2xs)' }}>
      {reading.nodeId}{skill && <> · files {skill.files.length} · findings {skill.findings.length}</>}
    </span>
  )
  const verdict = file ? VERDICT[file.verified] : null
  const escaped = tokenised ? escapedTotal(tokenised.counts) : 0

  const subtitle: ReactNode = reading && (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {crumbs}
      {file && (
        <>
          <span style={{ color: verdict?.colour, letterSpacing: 'var(--nx-track-wide)', fontSize: 'var(--nx-text-2xs)', textTransform: 'uppercase' }} title={shortDigest(file.sha256)}>
            {shortDigest(file.sha256)} · {verdict?.label}
          </span>
          <span style={{ color: 'var(--nx-fg-tertiary)', letterSpacing: 'var(--nx-track-normal)', textTransform: 'none' }}>
            {tokenised ? `${tokenised.lines.length.toLocaleString()} lines · ` : ''}{sizeOf(file.bytes)}{file.kind === 'binary' ? ' · binary' : ' · utf-8'}
            {tokenised && tokenised.counts.longest > 400 ? ` · longest line ${tokenised.counts.longest.toLocaleString()}` : ''}
            {skill?.record.commit ? ` · pinned ${shortCommit(skill.record.commit)}` : ''}
          </span>
          {tokenised && (escaped > 0 || tokenised.counts.nonAscii > 0) && (
            <span style={{ color: escaped > 0 ? 'var(--nx-fg-warning)' : 'var(--nx-fg-tertiary)', letterSpacing: 'var(--nx-track-wide)', fontSize: 'var(--nx-text-2xs)', textTransform: 'uppercase' }}>
              {escaped > 0 ? `${escaped} character${escaped === 1 ? '' : 's'} this view escapes` : ''}
              {escaped > 0 && tokenised.counts.nonAscii > 0 ? ' · ' : ''}
              {tokenised.counts.nonAscii > 0 ? `non-ascii ${tokenised.counts.nonAscii}` : ''}
            </span>
          )}
        </>
      )}
    </div>
  )

  const title = reading ? (reading.path || reading.nodeId) : ''

  // ---- footer: the key hints, in the palette's own idiom

  const hint = (k: string, what: string) => (
    <span key={k} style={{ color: 'var(--nx-fg-tertiary)', fontSize: 'var(--nx-text-2xs)', letterSpacing: 'var(--nx-track-wide)', textTransform: 'uppercase' }}>
      <kbd style={{ font: 'inherit', color: 'var(--nx-fg-muted)', border: 'var(--nx-hairline) solid var(--nx-border-default)', padding: '0 4px', marginRight: 5, textTransform: 'none' }}>{k}</kbd>{what}
    </span>
  )
  const footer = (
    <div style={{ display: 'flex', gap: 'var(--nx-space-4)', flexWrap: 'wrap', alignItems: 'center', width: '100%' }}>
      {findings.some((f) => f.line !== null) && hint('[ ]', 'finding')}
      {canGoBack && (
        <button type="button" className="nx-btn" onClick={onBack} style={{ padding: '2px 8px' }}>← back</button>
      )}
      {hint('esc', 'close')}
      {hint('⌘k', 'files')}
    </div>
  )

  // ---- body

  let body: ReactNode
  if (!reading) body = null
  else if (node && node.kind !== 'skill') body = <RowView node={node} />
  else if (!skill) body = <Empty>no such node</Empty>
  else if (!file) body = <Empty>no such file in {skill.id}</Empty>
  else if (file.kind === 'binary') body = <Empty>binary · {sizeOf(file.bytes)} · {shortDigest(file.sha256)} · {verdict?.label}</Empty>
  else body = (
    <>
      {unpinned.length > 0 && (
        <div style={{ padding: 'var(--nx-space-3) var(--nx-space-4) 0' }}>
          <SectionHeading>Findings this file no longer has a line for</SectionHeading>
          {unpinned.map((f, i) => <div key={i} style={{ marginLeft: -GUTTER }}><PinRow finding={f} /></div>)}
        </div>
      )}
      <div style={{ height: total, position: 'relative' }}>
        <div style={{ position: 'absolute', top: offsets[first] ?? 0, left: 0, right: 0 }}>
          {rows.slice(first, last).map((r) =>
            r.kind === 'line'
              ? <LineRow key={`l${r.line.n}`} row={r} onFollow={onFollow} highlighted={reading.line === r.line.n} />
              : <PinRow key={`p${r.n}:${r.finding.code}:${r.finding.at}`} finding={r.finding} onGoTo={onGoTo} />,
          )}
        </div>
      </div>
    </>
  )

  return (
    <Drawer open={open} onClose={onClose} title={title} subtitle={subtitle} width={width} footer={footer} accent="var(--nx-fg-default)">
      {/* The Drawer pads its body; the source wants the full width, so the
          padding is undone here. The body scrolls in both axes — lines never
          wrap — and the window above reads that scroll. */}
      <div ref={bodyRef} style={{ margin: 'calc(-1 * var(--nx-space-5))', fontSize: 'var(--nx-text-sm)', minWidth: 'max-content' }}>
        {body}
      </div>
    </Drawer>
  )
}

function Empty({ children }: { children: ReactNode }) {
  return <div style={{ padding: 'var(--nx-space-5)', color: 'var(--nx-fg-tertiary)', letterSpacing: 'var(--nx-track-wide)' }}>{children}</div>
}

// A declined or refused row, or a ghost: nothing to read — the bytes were
// removed with the row, by design (adopt.mjs: quarantine is a state that
// ends) — so the pane shows the row.
function RowView({ node }: { node: GraphNode }) {
  const kv = (label: string, value: ReactNode) => (
    <div style={{ display: 'flex', gap: 'var(--nx-space-4)', padding: 'var(--nx-space-1) 0' }}>
      <span style={{ color: 'var(--nx-fg-tertiary)', letterSpacing: 'var(--nx-track-wide)', width: 90, flexShrink: 0 }}>{label}</span>
      <span style={{ color: 'var(--nx-fg-default)' }}>{value}</span>
    </div>
  )
  return (
    <div style={{ padding: 'var(--nx-space-5)' }}>
      <HazardRule style={{ marginBottom: 'var(--nx-space-4)' }} />
      {node.kind === 'declined' && (
        <>
          <SectionHeading>Declined — nothing to read</SectionHeading>
          {kv('date', node.date ?? '—')}{kv('scan', node.scan ?? '—')}{kv('why', node.why ?? '—')}
        </>
      )}
      {node.kind === 'refused' && (
        <>
          <SectionHeading>Refused — nothing to read</SectionHeading>
          {kv('date', node.date ?? '—')}{kv('blocking', node.blockingFinding ?? '—')}
        </>
      )}
      {node.kind === 'ghost' && (
        <>
          <SectionHeading>Unresolved — no skill, no row</SectionHeading>
          {kv('referenced by', node.referencedBy.join(' · '))}
        </>
      )}
      {node.kind !== 'declined' && node.kind !== 'refused' && node.kind !== 'ghost' && <Empty>nothing to read for a {node.kind}</Empty>}
      <p style={{ color: 'var(--nx-fg-tertiary)', marginTop: 'var(--nx-space-4)', lineHeight: 1.5 }}>
        The bytes left with the row. The source is re-fetchable at the pinned commit in <code>REJECTED.md</code>; it is not held here.
      </p>
    </div>
  )
}
