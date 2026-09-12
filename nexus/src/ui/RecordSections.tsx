// ui/RecordSections.tsx — what the records say about the selected node, in
// the drawer, beneath its edges. READING-ROOM.html, phase 1.
//
// The engine's GraphNodeSnapshot carries id, label, category, degree and
// adjacency — none of the skill's own fields. Rather than widen the vendored
// engine's type to carry them, App.tsx looks the full GraphNode up by id in
// the loaded snapshot and hands it here (READING-ROOM.html, "one builder-
// level choice"). This renders records and never artefact text: the reader
// that shows the bytes is phase 2, and a bigger threat surface.
//
// Colour follows BRAND.md's one rule about the accent: it marks live state,
// focus and a granted clearance, and never data. A hash that matches the
// ledger is the bytes a human cleared, so it takes the accent; drift is
// critical; a file the ledger never named is neither, and sits in the
// tertiary grey. There is no green anywhere, for the two reasons BRAND.md
// gives.

import { KeyValue, SectionHeading } from '@nexus/react'
import type { GraphNode, HashVerdict, SkillFile, SkillRecord } from '../data/types.ts'

export interface RecordSectionsProps {
  node: GraphNode | null
  /** Full node by id — the loaded snapshot, not the engine's. A leaf reads its owner's file row through this. */
  lookup: (id: string) => GraphNode | undefined
  /** Open a file of the selected skill in the reading pane (phase 2). Absent: rows are not buttons. */
  onRead?: ((skillId: string, path: string) => void) | undefined
}

// BRAND.md: commits at seven characters, digests truncated with their
// algorithm kept.
const shortCommit = (sha: string) => sha.slice(0, 7)
const shortDigest = (hex: string) => `sha256:${hex.slice(0, 4)}…${hex.slice(-4)}`

const VERDICT_COLOUR: Record<HashVerdict, string> = {
  matches: 'var(--nx-fg-accent)',
  drift: 'var(--nx-fg-critical)',
  unlisted: 'var(--nx-fg-tertiary)',
}
// Chrome labels, in the port's vocabulary — not "ok / modified / new".
const VERDICT_LABEL: Record<HashVerdict, string> = {
  matches: 'matches ledger',
  drift: 'drift',
  unlisted: 'not in ledger',
}

function sizeOf(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  return `${(bytes / 1024).toFixed(bytes < 10240 ? 1 : 0)} KB`
}

// A path breaks at its slashes and nowhere else: a 296 px drawer holds
// about 30 columns, and "assets/PALETTE.template.md" split mid-word is a
// path nobody can read back.
function BreakablePath({ path }: { path: string }) {
  const parts = path.split('/')
  return (
    <>
      {parts.map((part, i) => (
        <span key={i}>{i > 0 && <>/<wbr /></>}{part}</span>
      ))}
    </>
  )
}

function FileRow({ file, missing = false, onOpen }: { file: Pick<SkillFile, 'path' | 'bytes' | 'sha256'> & { verified?: HashVerdict }; missing?: boolean; onOpen?: (() => void) | undefined }) {
  const verified = file.verified ?? 'unlisted'
  const colour = missing ? 'var(--nx-fg-critical)' : VERDICT_COLOUR[verified]
  const label = missing ? 'missing' : VERDICT_LABEL[verified]
  // The word is spent on the exception. A row that matches its ledger hash
  // says so with the accent alone; drift, unlisted and missing are the
  // states a reader has to act on, and they are spelled out. The label is
  // always in the accessible name, so colour is never the only carrier.
  const spelled = missing || verified !== 'matches'
  return (
    <div
      role="group"
      aria-label={`${file.path} — ${label}${missing ? '' : `, ${sizeOf(file.bytes)}`}`}
      title={missing ? 'the ledger hashes this path and it is not on disk' : `${label} · ${shortDigest(file.sha256)}`}
      style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--nx-space-3)', padding: 'var(--nx-space-1) 0' }}
    >
      <span aria-hidden="true" style={{ color: colour, flexShrink: 0 }}>{missing ? '✕' : verified === 'drift' ? '▲' : verified === 'unlisted' ? '□' : '■'}</span>
      {onOpen
        ? (
          <button type="button" onClick={onOpen} title={`read ${file.path}`}
            style={{ font: 'inherit', background: 'none', border: 0, padding: 0, margin: 0, textAlign: 'left', cursor: 'pointer', color: 'var(--nx-fg-default)', flex: 1, minWidth: 0, borderBottom: 'var(--nx-hairline) dotted var(--nx-border-default)' }}>
            <BreakablePath path={file.path} />
          </button>
        )
        : <span style={{ color: 'var(--nx-fg-default)', flex: 1, minWidth: 0 }}><BreakablePath path={file.path} /></span>}
      {spelled && (
        <span aria-hidden="true" style={{ color: colour, letterSpacing: 'var(--nx-track-wide)', fontSize: 'var(--nx-text-2xs)', textTransform: 'uppercase', flexShrink: 0 }}>{label}</span>
      )}
      {!missing && (
        <span aria-hidden="true" style={{ color: 'var(--nx-fg-tertiary)', fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>{sizeOf(file.bytes)}</span>
      )}
    </div>
  )
}

function RecordSection({ record, origin, description }: { record: SkillRecord; origin: 'authored' | 'acquired'; description: string }) {
  // Cleared is rendered in the accent (BRAND.md). No verdict is a fact, not
  // a warning: an authored skill may never have been audited by this tool.
  const verdictColour = record.verdict ? 'var(--nx-fg-accent)' : 'var(--nx-fg-tertiary)'
  const rowStyle = { padding: 'var(--nx-space-1) 0' }
  return (
    <div style={{ marginBottom: 'var(--nx-space-4)' }}>
      <SectionHeading>Record</SectionHeading>
      {description && (
        <p style={{ margin: '0 0 var(--nx-space-3)', color: 'var(--nx-fg-muted)', lineHeight: 1.5 }}>{description}</p>
      )}
      <KeyValue style={rowStyle} label="origin" value={origin} />
      {record.source && <KeyValue style={rowStyle} label="source" value={<span style={{ overflowWrap: 'anywhere', textAlign: 'right' }}>{record.source}</span>} />}
      <KeyValue style={rowStyle} label="pinned" value={record.commit ? shortCommit(record.commit) : <span style={{ color: 'var(--nx-fg-tertiary)' }}>not recorded</span>} />
      {record.date && <KeyValue style={rowStyle} label="since" value={record.date} />}
      <KeyValue
        style={rowStyle}
        label="verdict"
        value={<span style={{ color: verdictColour, letterSpacing: 'var(--nx-track-wide)' }}>{record.verdict ?? 'none'}</span>}
      />
      <KeyValue
        style={rowStyle}
        label="findings"
        value={record.findings === null ? <span style={{ color: 'var(--nx-fg-tertiary)' }}>not counted</span> : record.findings}
      />
      {record.dispositioned !== null && (
        <KeyValue style={rowStyle} label="dispositioned" value={record.dispositioned ? 'every finding' : <span style={{ color: 'var(--nx-fg-warning)' }}>not every finding</span>} />
      )}
    </div>
  )
}

export function RecordSections({ node, lookup, onRead }: RecordSectionsProps) {
  if (!node) return null

  if (node.kind === 'skill') {
    return (
      <>
        <RecordSection record={node.record} origin={node.origin} description={node.description} />
        <div style={{ marginBottom: 'var(--nx-space-4)' }}>
          <SectionHeading>Files · {node.files.length}</SectionHeading>
          <div aria-hidden="true" style={{ color: 'var(--nx-fg-tertiary)', fontSize: 'var(--nx-text-2xs)', letterSpacing: 'var(--nx-track-wide)', marginBottom: 'var(--nx-space-2)' }}>
            <span style={{ color: 'var(--nx-fg-accent)' }}>■</span> matches · <span style={{ color: 'var(--nx-fg-critical)' }}>▲</span> drift · □ unlisted
          </div>
          {node.files.map((f) => <FileRow key={f.path} file={f} onOpen={onRead ? () => onRead(node.id, f.path) : undefined} />)}
          {node.record.missing.map((path) => (
            <FileRow key={`missing:${path}`} file={{ path, bytes: 0, sha256: '' }} missing />
          ))}
        </div>
      </>
    )
  }

  // A leaf is one of its owner's files; show that one row. The engine's
  // categoryId encodes the leaf kind, but the file's role and path are on
  // the owner's record, which is the source and needs no second table.
  if (node.kind === 'leaf') {
    const owner = lookup(node.owner)
    if (owner?.kind !== 'skill') return null
    const file = owner.files.find((f) => f.role === node.leafKind && f.path.endsWith(`/${node.file}`))
      ?? owner.files.find((f) => f.path === node.file)
    if (!file) return null
    return (
      <div style={{ marginBottom: 'var(--nx-space-4)' }}>
        <SectionHeading>File</SectionHeading>
        <FileRow file={file} onOpen={onRead ? () => onRead(owner.id, file.path) : undefined} />
        <div style={{ color: 'var(--nx-fg-tertiary)', fontVariantNumeric: 'tabular-nums', marginTop: 'var(--nx-space-1)' }}>{shortDigest(file.sha256)}</div>
      </div>
    )
  }

  return null
}
