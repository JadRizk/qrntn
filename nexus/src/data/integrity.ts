// Pure checks shared by the runtime (soft, informational) and
// scripts/check-graph.mjs (CLI gate) — §4, §7 Tier 1.
//
// Also home to the two pure functions the §5 data pipeline needs and that
// must be independently unit-testable: parseRejectedTable (REJECTED.md's
// own minimal markdown-table parser, written fresh for Nexus — not
// scripts/atlas-vendor.mjs's parseRejectedTable) and resolveEntityKind (the
// §5 resolution order: skill dir wins, then a REJECTED.md row, then ghost).
// scripts/export-graph.mjs imports both from here rather than reimplementing
// them, so there is exactly one parser and one resolution order, each
// checked by the same tests that check everything else pure in this module.

import type { EdgeRecord, GraphSnapshot } from './types.ts'

export interface IntegrityWarning {
  code: string
  message: string
}

// ------------------------------------------------------------- dangling

// An edge whose `from` or `to` names no node in the snapshot at all — not
// even a ghost. A real ghost is the resolved, intentional "ectype of a gap"
// (§5); a dangling edge is the unresolved, unintentional kind: a typo, or a
// node that fell out of the export without its edges following it.
export function checkDanglingEdges(snapshot: GraphSnapshot): IntegrityWarning[] {
  const ids = new Set(snapshot.nodes.map((n) => n.id))
  const warnings: IntegrityWarning[] = []
  for (const edge of snapshot.edges) {
    if (!ids.has(edge.from)) {
      warnings.push({
        code: 'dangling-edge',
        message: `edge ${edge.kind} ${edge.from} -> ${edge.to} — "${edge.from}" is not a node in this snapshot`,
      })
    }
    if (!ids.has(edge.to)) {
      warnings.push({
        code: 'dangling-edge',
        message: `edge ${edge.kind} ${edge.from} -> ${edge.to} — "${edge.to}" is not a node in this snapshot`,
      })
    }
  }
  return warnings
}

// ------------------------------------------------------- manual-only + op

// Per edges.json's own comment: an 'operative' edge only works when its
// target is model-invocable. A manualOnly skill with an inbound operative
// edge is a configuration that silently never fires — non-fatal, because
// the data can still be correct about *why* someone wrote it that way, but
// worth surfacing every time.
export function checkManualOnlyOperative(snapshot: GraphSnapshot): IntegrityWarning[] {
  const manualOnlySkillIds = new Set(
    snapshot.nodes.filter((n) => n.kind === 'skill' && n.manualOnly).map((n) => n.id),
  )
  const warnings: IntegrityWarning[] = []
  for (const edge of snapshot.edges) {
    if (edge.kind === 'operative' && manualOnlySkillIds.has(edge.to)) {
      warnings.push({
        code: 'manual-only-operative',
        message: `operative edge ${edge.from} -> ${edge.to} — ${edge.to} is manualOnly, so this edge can never fire`,
      })
    }
  }
  return warnings
}

// ---------------------------------------------------------------- identity

// A node id has to be unique across the whole snapshot: GraphCanvas's
// idToIndex lookup is a `Map` keyed by id, and a duplicate key silently
// keeps only the last node written — the other one becomes unreachable by
// id (its edges, focus, and interactions all resolve to the wrong node)
// with no error anywhere. Checked once, generically, here — rather than
// export-graph.mjs having to get every node-producing branch right on its
// own, forever.
export function checkDuplicateIds(snapshot: GraphSnapshot): IntegrityWarning[] {
  const seen = new Map<string, number>()
  for (const node of snapshot.nodes) seen.set(node.id, (seen.get(node.id) ?? 0) + 1)
  const warnings: IntegrityWarning[] = []
  for (const [id, count] of seen) {
    if (count > 1) {
      warnings.push({
        code: 'duplicate-node-id',
        message: `node id "${id}" is used by ${count} nodes — only the last one is reachable by id`,
      })
    }
  }
  return warnings
}

// ------------------------------------------------------- file records

// A skill's `files` is keyed by path in everything that reads it — the
// drawer's rows, phase 2's reader — so a path listed twice is the same
// collision checkDuplicateIds catches for nodes: one row reachable, one
// silently shadowed. export-graph.mjs lists a root companion .md once and
// a references/ file once, but the invariant is checked here rather than
// trusted to stay that way as the walk grows (READING-ROOM.html, decided 3).
export function checkDuplicateFilePaths(snapshot: GraphSnapshot): IntegrityWarning[] {
  const warnings: IntegrityWarning[] = []
  for (const node of snapshot.nodes) {
    if (node.kind !== 'skill') continue
    const seen = new Map<string, number>()
    for (const f of node.files) seen.set(f.path, (seen.get(f.path) ?? 0) + 1)
    for (const [path, count] of seen) {
      if (count > 1) {
        warnings.push({
          code: 'duplicate-file-path',
          message: `skill "${node.id}" lists "${path}" ${count} times — only one row is reachable by path`,
        })
      }
    }
  }
  return warnings
}

export function checkIntegrity(snapshot: GraphSnapshot): IntegrityWarning[] {
  return [
    ...checkDanglingEdges(snapshot),
    ...checkDuplicateIds(snapshot),
    ...checkManualOnlyOperative(snapshot),
    ...checkDuplicateFilePaths(snapshot),
  ]
}

// -------------------------------------------------------- rejected table

export interface RefusedRow {
  name: string
  repo: string | null
  url: string | null
  date: string | null
  blockingFinding: string | null
}

export interface DeclinedRow {
  name: string
  repo: string | null
  url: string | null
  date: string | null
  scan: string | null
  why: string | null
}

export interface ParsedRejected {
  refused: RefusedRow[]
  declined: DeclinedRow[]
}

// A row only counts if its Skill cell is a backtick-wrapped identifier —
// `` `name` `` — exactly. That is what tells a header row, a separator row,
// and the sentinel placeholder row (`| — | — | — | *nothing refused yet* |`)
// apart from a real entry, and it is what stops a name mentioned only in
// another row's prose (e.g. "overlaps both `review-animations` and
// `animate`") from being misread as its own row: prose lives in a cell that
// isn't the first, and the first cell of a prose line never matches this
// pattern on its own.
const SKILL_CELL = /^`([a-z0-9][a-z0-9-]*)`$/

// `[`repo`](url)` or `[repo](url)`, with an optional trailing `` @ `commit` ``
// that this parser ignores — Nexus's node model has no use for the pinned
// commit (that's the vendor card's job, not the graph's).
const SOURCE_CELL = /\[`?([^\]`]+)`?\]\(([^)]+)\)/

function splitRow(line: string): string[] | null {
  if (!line.trim().startsWith('|')) return null
  const cells = line.split('|').slice(1, -1).map((c) => c.trim())
  return cells.length >= 3 ? cells : null
}

function parseSource(cell: string | undefined): { repo: string | null; url: string | null } {
  const m = SOURCE_CELL.exec(cell ?? '')
  return { repo: m?.[1] ?? null, url: m?.[2] ?? null }
}

// Slices out the text between a `## <heading>` line and the next `## `
// heading (or end of file). REJECTED.md's own two tables (Refused,
// Declined) are the only sections this parser needs to find.
function section(text: string, heading: string): string {
  const lines = text.split('\n')
  const startIdx = lines.findIndex((l) => l.trim() === `## ${heading}`)
  if (startIdx === -1) return ''
  const rest = lines.slice(startIdx + 1)
  const endIdx = rest.findIndex((l) => /^##\s+/.test(l.trim()))
  return (endIdx === -1 ? rest : rest.slice(0, endIdx)).join('\n')
}

// Fresh, independent of scripts/atlas-vendor.mjs's parseRejectedTable (§5's
// hard rule) — same guard (backtick-identifier match on the Skill cell),
// arrived at separately because it is the only correct guard, not because
// it was copied.
export function parseRejectedTable(text: string): ParsedRejected {
  const refused: RefusedRow[] = []
  for (const line of section(text, 'Refused').split('\n')) {
    const cells = splitRow(line)
    if (!cells) continue
    const nameM = SKILL_CELL.exec(cells[0] ?? '')
    if (!nameM) continue
    const { repo, url } = parseSource(cells[1])
    refused.push({
      name: nameM[1] as string,
      repo,
      url,
      date: cells[2] || null,
      blockingFinding: cells[3] || null,
    })
  }

  const declined: DeclinedRow[] = []
  for (const line of section(text, 'Declined').split('\n')) {
    const cells = splitRow(line)
    if (!cells) continue
    const nameM = SKILL_CELL.exec(cells[0] ?? '')
    if (!nameM) continue
    const { repo, url } = parseSource(cells[1])
    declined.push({
      name: nameM[1] as string,
      repo,
      url,
      date: cells[2] || null,
      scan: cells[3] || null,
      why: cells[4] || null,
    })
  }

  return { refused, declined }
}

// ------------------------------------------------------------ resolution

export type ResolvedEntityKind = 'skill' | 'refused' | 'declined' | 'ghost'

// §5's resolution order, run in this sequence and no other: a real
// `skills/<name>/` directory wins first; only then does a REJECTED.md table
// row (matched by the Skill column, via parseRejectedTable above — never a
// substring match against the file's prose) resolve it to `refused` or
// `declined`; only if neither matches does it become a `ghost`.
export function resolveEntityKind(
  name: string,
  known: { skillIds: ReadonlySet<string>; refusedNames: ReadonlySet<string>; declinedNames: ReadonlySet<string> },
): ResolvedEntityKind {
  if (known.skillIds.has(name)) return 'skill'
  if (known.refusedNames.has(name)) return 'refused'
  if (known.declinedNames.has(name)) return 'declined'
  return 'ghost'
}

// Every edge target name, deduplicated — the raw material export-graph.mjs
// resolves one at a time via resolveEntityKind.
export function referencedNames(edges: ReadonlyArray<Pick<EdgeRecord, 'to'>>): string[] {
  return [...new Set(edges.map((e) => e.to))]
}

// ── §5's library resolution, and what the root is called ────────────────────
//
// export-graph.mjs used to fix its root three directories up from its own
// file, so it could only ever export the tree it lived in — the exact defect
// SK-97 found in six of seven commands and fixed there ("named, or the place
// you are standing, never inferred from where the tool happens to be
// installed"). This script never got that fix, which is why `qrntn view`
// could not be pointed at anybody else's library.
//
// Pure and string-only on purpose: this module is bundled for the browser, so
// it must not import node:path. The caller resolves the path and takes the
// basename; what lives here is the DECISION, which is the part worth testing.

export type LibrarySource = 'flag' | 'env' | 'cwd'

export type LibraryChoice =
  | { readonly ok: true; readonly path: string; readonly from: LibrarySource }
  | { readonly ok: false; readonly error: string }

/**
 * `--library <dir>`, then `SKILL_LIBRARY`, then the working directory — the
 * same order, and the same refusal, as every verb in commands/.
 */
export function chooseLibrary(
  argv: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
  cwd: string
): LibraryChoice {
  const i = argv.indexOf('--library')
  if (i !== -1) {
    const value = argv[i + 1]
    // A flag with no value is a usage error, not a silent fall-through to the
    // working directory — that would export a different library than the one
    // the caller asked for and say nothing about it.
    if (!value || value.startsWith('--')) return { ok: false, error: '--library needs a directory' }
    return { ok: true, path: value, from: 'flag' }
  }
  const env_ = env['SKILL_LIBRARY']
  if (env_) return { ok: true, path: env_, from: 'env' }
  return { ok: true, path: cwd, from: 'cwd' }
}

/**
 * What the synthetic origin node is called.
 *
 * It is the LIBRARY's name, not this tool's. The node used to read "Nexus",
 * which named the viewer rather than the thing being viewed — so pointing the
 * viewer at a stranger's library stamped our product across the middle of
 * their data. A catalog may name itself; otherwise the honest answer is the
 * directory you are standing in, which is the same fallback the library
 * resolution above ends on.
 */
export function originTitle(catalogTitle: unknown, libraryName: string): string {
  if (typeof catalogTitle === 'string' && catalogTitle.trim() !== '') return catalogTitle.trim()
  if (libraryName.trim() !== '') return libraryName.trim()
  // Only reachable for a filesystem root, where basename() is empty. Naming
  // the tool here would be the bug this function exists to remove.
  return 'library'
}
