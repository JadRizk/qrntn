#!/usr/bin/env node
//
// export-graph.mjs — the data export, §5. Repo root is resolved from this
// module's own URL, never cwd, because it must work the same way whether
// `npm run export:data` is invoked from nexus/ or from the repo root.
//
// The ONLY place Nexus touches files outside its own directory, and it only
// reads them: edges.json, catalog.json, ledger/*.json, skills/*/SKILL.md
// (+ references/assets/scripts/agents listings), REJECTED.md.
//
// Hard rule (§5): does not import, port, or reuse code from
// scripts/atlas-*.mjs, scripts/build-index.mjs, or scripts/ledger.mjs — not
// even their safe, side-effect-free exports. Where Nexus needs the same
// fact one of those modules computes, it computes that fact fresh, here.
// The two pieces of that fresh logic pure enough to unit test on their own
// (the REJECTED.md table parser, the §5 resolution order) live in
// src/data/integrity.ts and are imported from there, not reimplemented.

import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { GraphSnapshotSchema } from '../src/data/types.ts'
import { parseRejectedTable, resolveEntityKind } from '../src/data/integrity.ts'

const REPO_ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))))
const OUT_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'data', 'graph.json')

// ------------------------------------------------------------------ utils

function readJSON(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function readTextOrEmpty(path) {
  return existsSync(path) ? readFileSync(path, 'utf8') : ''
}

function listFiles(dir) {
  if (!existsSync(dir)) return []
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && !e.name.startsWith('.'))
    .map((e) => e.name)
    .sort()
}

function wordCount(text) {
  return text.trim().split(/\s+/).filter(Boolean).length
}

// Minimal, single-line-value frontmatter reader — every SKILL.md in this
// repo writes `key: value` on one line each, never block scalars. Good
// enough for the three fields Nexus needs (name, description,
// disable-model-invocation); anything richer than that is a fact this
// script doesn't need to know.
function parseSkillMd(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text)
  const fmText = m ? m[1] : ''
  const body = m ? text.slice(m[0].length) : text
  const fields = {}
  for (const line of fmText.split('\n')) {
    const kv = /^([a-z][a-z0-9-]*):\s*(.*)$/i.exec(line)
    if (kv) fields[kv[1]] = kv[2].trim()
  }
  return {
    name: fields.name ?? null,
    description: fields.description ?? '',
    manualOnly: fields['disable-model-invocation'] === 'true',
    body,
  }
}

// github.com/org/repo, stripping a trailing .git/slash/query/fragment.
// Fresh here (§5's hard rule) — not scripts/atlas-vendor.mjs's repoSlug,
// though it necessarily agrees on the one correct answer.
function repoSlug(url) {
  const m = /github\.com\/([^/]+\/[^/]+?)(?:\.git)?\/?(?:$|[?#])/.exec(url ?? '')
  return m ? m[1] : (url ?? 'unknown')
}

// The canonical operative form (matching scripts/build-index.mjs's own
// regex, because it names the same real convention every SKILL.md in this
// repo follows — not imported from it).
const CALLS_RE = /Call the Skill tool with ["'`]([a-z0-9-]+)["'`]/gi

function findCalls(body) {
  return new Set([...body.matchAll(CALLS_RE)].map((m) => m[1]))
}

const PROVENANCE_FILES = new Set(['SKILL.md', 'AUDIT.md', 'ORIGIN.md'])

// ------------------------------------------------------------ categories

const catalog = readJSON(join(REPO_ROOT, 'catalog.json'))
const categories = catalog.categories.map((c) => ({ id: c.id, title: c.title, blurb: c.blurb }))
const skillToCategory = new Map()
for (const c of catalog.categories) {
  for (const name of c.skills) skillToCategory.set(name, c.id)
}
const filedIds = new Set(categories.map((c) => c.id))

// ----------------------------------------------------------------- edges

const rawEdges = readJSON(join(REPO_ROOT, 'edges.json')).edges

// ---------------------------------------------------------------- skills

const skillsRoot = join(REPO_ROOT, 'skills')
const skillDirs = readdirSync(skillsRoot, { withFileTypes: true })
  .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
  .map((e) => e.name)
  .filter((name) => existsSync(join(skillsRoot, name, 'SKILL.md')))
  .sort()

const skills = skillDirs.map((dir) => {
  const skillPath = join(skillsRoot, dir)
  const raw = readFileSync(join(skillPath, 'SKILL.md'), 'utf8')
  const fm = parseSkillMd(raw)

  // A companion .md at the skill root (RECIPES.md, STANDARDS.md, ...) does
  // the same job as a file under references/ — depth loaded on demand.
  // Provenance (AUDIT.md, ORIGIN.md) is not depth (CONTEXT.md's own
  // ambiguity note on this exact distinction) and is excluded.
  const rootCompanions = listFiles(skillPath).filter((f) => f.endsWith('.md') && !PROVENANCE_FILES.has(f))
  const leafFiles = [
    ...listFiles(join(skillPath, 'references')).map((file) => ({ file, leafKind: 'ref', path: join(skillPath, 'references', file) })),
    ...rootCompanions.map((file) => ({ file, leafKind: 'ref', path: join(skillPath, file) })),
    ...listFiles(join(skillPath, 'assets')).map((file) => ({ file, leafKind: 'asset', path: join(skillPath, 'assets', file) })),
    ...listFiles(join(skillPath, 'agents')).map((file) => ({ file, leafKind: 'agent', path: join(skillPath, 'agents', file) })),
  ]
  const scriptFiles = listFiles(join(skillPath, 'scripts'))
  const refWordsTotal = leafFiles.reduce((n, l) => n + wordCount(readTextOrEmpty(l.path)), 0)

  const ledgerPath = join(REPO_ROOT, 'ledger', `${dir}.json`)
  if (!existsSync(ledgerPath)) {
    throw new Error(`export-graph: skills/${dir} has no ledger/${dir}.json — every held skill must have a ledger entry`)
  }
  const ledger = readJSON(ledgerPath)
  if (ledger.origin?.kind !== 'authored' && ledger.origin?.kind !== 'acquired') {
    throw new Error(`export-graph: ledger/${dir}.json — origin.kind must be "authored" or "acquired", got ${JSON.stringify(ledger.origin?.kind)}`)
  }

  return {
    id: dir,
    name: fm.name ?? dir,
    description: fm.description,
    category: skillToCategory.get(dir) ?? 'unfiled',
    origin: ledger.origin.kind,
    origin_source: ledger.origin.source ?? null,
    manualOnly: fm.manualOnly,
    words: wordCount(fm.body),
    refWords: refWordsTotal,
    usage: ledger.usage ?? null,
    calls: findCalls(fm.body),
    leaves: leafFiles,
    scripts: scriptFiles,
  }
})

const skillIds = new Set(skills.map((s) => s.id))

// A skill whose catalog.json category id matches nothing real falls to
// 'unfiled' (CONTEXT.md) — the human-facing bucket is 'Uncategorised'. No
// skill needs this today (every one of them is filed), but the synthetic
// category node only exists when one actually does, so a category-clusters-
// skill edge can never dangle by construction rather than by luck.
const hasUnfiled = skills.some((s) => !filedIds.has(s.category))
if (hasUnfiled) categories.push({ id: 'unfiled', title: 'Uncategorised', blurb: '' })

// -------------------------------------------------------------- rejected

const { refused, declined } = parseRejectedTable(readTextOrEmpty(join(REPO_ROOT, 'REJECTED.md')))
const refusedNames = new Set(refused.map((r) => r.name))
const declinedNames = new Set(declined.map((r) => r.name))

// ----------------------------------------------------------------- ghost

// Every name referenced by an edge's `to`, or by any skill's prose `calls`
// — resolved through §5's order. Anything that resolves to 'ghost' is a
// genuine unresolved gap; the rest just confirm they already have a node.
const referenced = new Map() // name -> Set(referencing skill ids)
for (const e of rawEdges) {
  if (!referenced.has(e.to)) referenced.set(e.to, new Set())
  referenced.get(e.to).add(e.from)
}
for (const s of skills) {
  for (const called of s.calls) {
    if (!referenced.has(called)) referenced.set(called, new Set())
    referenced.get(called).add(s.id)
  }
}

const ghosts = []
for (const [name, referencedBy] of referenced) {
  const kind = resolveEntityKind(name, { skillIds, refusedNames, declinedNames })
  if (kind === 'ghost') {
    ghosts.push({ id: name, name, referencedBy: [...referencedBy].sort() })
  }
}
ghosts.sort((a, b) => a.name.localeCompare(b.name))

// ---------------------------------------------------------------- vendor

// §5: vendor discovery is from ledger origin.source on acquired skills
// only. A source whose every candidate was declined/refused (zero adopted)
// does not become a vendor node here — a known, deliberately deferred gap,
// not a bug (§5's own note).
const vendorGroups = new Map() // source -> skill ids
for (const s of skills) {
  if (s.origin !== 'acquired' || !s.origin_source) continue
  if (!vendorGroups.has(s.origin_source)) vendorGroups.set(s.origin_source, [])
  vendorGroups.get(s.origin_source).push(s.id)
}

const vendors = [...vendorGroups.entries()]
  .map(([source, adopted]) => ({
    id: repoSlug(source),
    repo: repoSlug(source),
    url: source,
    adopted: adopted.sort(),
  }))
  .sort((a, b) => a.id.localeCompare(b.id))

const vendorIdBySlug = new Map(vendors.map((v) => [v.id, v.id]))
const vendorIdForRow = (row) => (row.repo && vendorIdBySlug.has(repoSlug(row.url ?? row.repo)) ? repoSlug(row.url ?? row.repo) : null)

// §5's resolution order (skill wins, then refused, then declined) applies
// here too: a REJECTED.md row only gets its own node if that's genuinely
// what its name resolves to. Without this, a stale row for a skill later
// adopted under the same name — or a name copy-pasted into both tables —
// would mint a node id a skill (or the other table) already owns, and the
// two nodes would silently collide (see checkDuplicateIds). Deduplicated
// by name within each table for the same reason: a repeated row is the
// same collision by another route.
const dedupeByName = (rows) => rows.filter((row, i, arr) => arr.findIndex((r) => r.name === row.name) === i)

const declinedNodes = dedupeByName(declined)
  .filter((row) => resolveEntityKind(row.name, { skillIds, refusedNames, declinedNames }) === 'declined')
  .map((row) => ({
    id: row.name,
    name: row.name,
    vendorId: vendorIdForRow(row),
    date: row.date,
    scan: row.scan,
    why: row.why,
  }))
const refusedNodes = dedupeByName(refused)
  .filter((row) => resolveEntityKind(row.name, { skillIds, refusedNames, declinedNames }) === 'refused')
  .map((row) => ({
    id: row.name,
    name: row.name,
    vendorId: vendorIdForRow(row),
    date: row.date,
    blockingFinding: row.blockingFinding,
  }))

// ------------------------------------------------------------------ origin

// The one synthetic root every category connects to (data/types.ts's
// OriginNodeSchema) — not sourced from any file, unlike every other node
// here. Exists purely so the graph reads as one connected whole instead of
// several separate category trees with nothing tying them together.
const originNode = { kind: 'origin', id: 'origin', title: 'Nexus' }

// ------------------------------------------------------------------ nodes

const nodes = [
  originNode,
  ...categories.map((c) => ({ kind: 'category', ...c })),
  ...skills.map((s) => ({
    kind: 'skill',
    id: s.id,
    name: s.name,
    description: s.description,
    category: s.category,
    origin: s.origin,
    manualOnly: s.manualOnly,
    words: s.words,
    refWords: s.refWords,
    usage: s.usage,
  })),
  ...skills.flatMap((s) =>
    s.leaves.map((l) => ({
      kind: 'leaf',
      id: `${s.id}/${l.file}`,
      owner: s.id,
      file: l.file,
      leafKind: l.leafKind,
      words: wordCount(readTextOrEmpty(l.path)),
    })),
  ),
  ...skills.filter((s) => s.scripts.length > 0).map((s) => ({
    kind: 'scriptFold',
    id: `${s.id}//scripts`,
    owner: s.id,
    scripts: s.scripts,
  })),
  ...vendors.map((v) => ({ kind: 'vendor', ...v })),
  ...declinedNodes.map((d) => ({ kind: 'declined', ...d })),
  ...refusedNodes.map((r) => ({ kind: 'refused', ...r })),
  ...ghosts.map((g) => ({ kind: 'ghost', ...g })),
]

// ------------------------------------------------------------------ edges

const semanticEdges = rawEdges.map((e) => ({
  kind: e.type,
  from: e.from,
  to: e.to,
  render: true,
  when: e.when ?? null,
  note: e.note ?? null,
  source: e.source ?? null,
}))

const containsEdges = skills.flatMap((s) => [
  ...s.leaves.map((l) => ({
    kind: 'contains',
    from: s.id,
    to: `${s.id}/${l.file}`,
    render: true,
    when: null,
    note: null,
    source: null,
  })),
  ...(s.scripts.length
    ? [{ kind: 'contains', from: s.id, to: `${s.id}//scripts`, render: true, when: null, note: null, source: null }]
    : []),
])

const adoptedEdges = vendors.flatMap((v) =>
  v.adopted.map((skillId) => ({ kind: 'adopted', from: v.id, to: skillId, render: true, when: null, note: null, source: null })),
)

const consideredEdges = [...declinedNodes, ...refusedNodes]
  .filter((n) => n.vendorId)
  .map((n) => ({ kind: 'considered', from: n.vendorId, to: n.id, render: true, when: null, note: null, source: null }))

const clusterEdges = skills.map((s) => ({
  kind: 'category-clusters-skill',
  from: s.category,
  to: s.id,
  render: true,
  when: null,
  note: null,
  source: null,
}))

// Every category (including the synthetic 'unfiled' one, if it exists —
// same "by construction, not by luck" reasoning as clusterEdges above)
// connects back to the one root, so the graph is a single connected tree
// instead of one disjoint tree per category.
const originEdges = categories.map((c) => ({
  kind: 'origin-clusters-category',
  from: originNode.id,
  to: c.id,
  render: true,
  when: null,
  note: null,
  source: null,
}))

const edges = [...semanticEdges, ...containsEdges, ...adoptedEdges, ...consideredEdges, ...clusterEdges, ...originEdges]

// ------------------------------------------------------------------ write

const snapshot = GraphSnapshotSchema.parse({ nodes, edges })

mkdirSync(dirname(OUT_PATH), { recursive: true })
// Stable key order + trailing newline: a deterministic byte stream for
// identical input, checked by review diffs rather than trusted (§5).
writeFileSync(OUT_PATH, `${JSON.stringify(snapshot, null, 2)}\n`)

console.log(
	`export-graph: wrote ${nodes.length} nodes (${skills.length} skills, ${categories.length} categories, ` +
		`${vendors.length} vendors, ${declinedNodes.length} declined, ${refusedNodes.length} refused, ${ghosts.length} ghost) ` +
		`and ${edges.length} edges -> ${OUT_PATH}`,
)
