import { describe, expect, it } from 'vitest'
import { checkDanglingEdges, checkDuplicateFilePaths, checkDuplicateIds, checkManualOnlyOperative, chooseLibrary, originTitle, parseRejectedTable, resolveEntityKind } from './integrity.ts'
import type { EdgeRecord, GraphNode, GraphSnapshot } from './types.ts'

function skill(id: string, manualOnly = false): GraphNode {
  return {
    kind: 'skill',
    id,
    name: id,
    description: '',
    category: 'unfiled',
    origin: 'authored',
    manualOnly,
    words: 10,
    refWords: 0,
    usage: null,
    files: [],
    record: { source: null, commit: null, date: null, verdict: null, findings: null, dispositioned: null, reportPath: null, missing: [] },
  }
}

function edge(partial: Pick<EdgeRecord, 'kind' | 'from' | 'to'>): EdgeRecord {
  return { render: true, when: null, note: null, source: null, ...partial }
}

describe('checkDanglingEdges', () => {
  it('reports an edge whose target names no node in the snapshot', () => {
    const snapshot: GraphSnapshot = {
      nodes: [skill('animate')],
      edges: [edge({ kind: 'referential', from: 'animate', to: 'nowhere' })],
    }
    const warnings = checkDanglingEdges(snapshot)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]?.code).toBe('dangling-edge')
    expect(warnings[0]?.message).toContain('nowhere')
  })

  it('reports nothing when every edge endpoint resolves to a node', () => {
    const snapshot: GraphSnapshot = {
      nodes: [skill('animate'), skill('prototype')],
      edges: [edge({ kind: 'referential', from: 'animate', to: 'prototype' })],
    }
    expect(checkDanglingEdges(snapshot)).toEqual([])
  })
})

describe('checkManualOnlyOperative', () => {
  it('warns when an operative edge targets a manualOnly skill', () => {
    const snapshot: GraphSnapshot = {
      nodes: [skill('skill-adopt', true), skill('skill-audit')],
      edges: [edge({ kind: 'operative', from: 'skill-audit', to: 'skill-adopt' })],
    }
    const warnings = checkManualOnlyOperative(snapshot)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]?.code).toBe('manual-only-operative')
  })

  it('stays quiet for a referential edge at a manualOnly skill', () => {
    const snapshot: GraphSnapshot = {
      nodes: [skill('skill-adopt', true), skill('skill-audit')],
      edges: [edge({ kind: 'referential', from: 'skill-audit', to: 'skill-adopt' })],
    }
    expect(checkManualOnlyOperative(snapshot)).toEqual([])
  })

  it('stays quiet for an operative edge at a model-invocable skill', () => {
    const snapshot: GraphSnapshot = {
      nodes: [skill('skill-audit', false), skill('skill-adopt', false)],
      edges: [edge({ kind: 'operative', from: 'skill-adopt', to: 'skill-audit' })],
    }
    expect(checkManualOnlyOperative(snapshot)).toEqual([])
  })
})

describe('checkDuplicateIds', () => {
  it('warns when two nodes share an id', () => {
    const snapshot: GraphSnapshot = {
      nodes: [skill('animate'), skill('animate')],
      edges: [],
    }
    const warnings = checkDuplicateIds(snapshot)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]?.code).toBe('duplicate-node-id')
    expect(warnings[0]?.message).toContain('animate')
  })

  it('stays quiet when every node id is unique', () => {
    const snapshot: GraphSnapshot = {
      nodes: [skill('animate'), skill('prototype')],
      edges: [],
    }
    expect(checkDuplicateIds(snapshot)).toEqual([])
  })
})

describe('checkDuplicateFilePaths', () => {
  const file = (path: string) => ({ path, role: 'ref' as const, bytes: 1, sha256: 'a'.repeat(64), verified: 'matches' as const })

  it('warns when a skill lists one path twice', () => {
    const node = { ...skill('animate'), files: [file('references/a.md'), file('references/a.md')] } as GraphNode
    const warnings = checkDuplicateFilePaths({ nodes: [node], edges: [] })
    expect(warnings).toHaveLength(1)
    expect(warnings[0]?.code).toBe('duplicate-file-path')
    expect(warnings[0]?.message).toContain('references/a.md')
  })

  it('stays quiet when every path is listed once', () => {
    const node = { ...skill('animate'), files: [file('SKILL.md'), file('references/a.md')] } as GraphNode
    expect(checkDuplicateFilePaths({ nodes: [node], edges: [] })).toEqual([])
  })
})

describe('resolveEntityKind — §5 resolution order', () => {
  const known = {
    skillIds: new Set(['animate']),
    refusedNames: new Set(['blocked-skill']),
    declinedNames: new Set(['animation-vocabulary']),
  }

  it('a real skill dir wins first', () => {
    expect(resolveEntityKind('animate', known)).toBe('skill')
  })

  it('falls through to a REJECTED.md row — refused', () => {
    expect(resolveEntityKind('blocked-skill', known)).toBe('refused')
  })

  it('falls through to a REJECTED.md row — declined', () => {
    expect(resolveEntityKind('animation-vocabulary', known)).toBe('declined')
  })

  it('a name with no skill dir and no REJECTED.md row is a ghost', () => {
    expect(resolveEntityKind('implement-design-system', known)).toBe('ghost')
  })

  it('a skill dir wins even when the same name also appears in REJECTED.md', () => {
    const clash = {
      skillIds: new Set(['animate']),
      refusedNames: new Set(['animate']),
      declinedNames: new Set<string>(),
    }
    expect(resolveEntityKind('animate', clash)).toBe('skill')
  })
})

describe('parseRejectedTable', () => {
  it('parses zero rows from an empty table\'s placeholder row', () => {
    const text = `
## Refused

| Skill | Source | Date | Blocking finding |
|---|---|---|---|
| — | — | — | *nothing refused yet* |

## Declined
`
    const { refused, declined } = parseRejectedTable(text)
    expect(refused).toEqual([])
    expect(declined).toEqual([])
  })

  it('parses a real declined row', () => {
    const text = `
## Refused

## Declined

| Skill | Source | Date | Scan | Why not |
|---|---|---|---|---|
| \`animation-vocabulary\` | [\`emilkowalski/skills\`](https://github.com/emilkowalski/skills) @ \`de33dbe\` | 2026-08-05 | clean | Auto-triggers. |
`
    const { declined } = parseRejectedTable(text)
    expect(declined).toHaveLength(1)
    expect(declined[0]).toMatchObject({
      name: 'animation-vocabulary',
      repo: 'emilkowalski/skills',
      date: '2026-08-05',
      scan: 'clean',
    })
  })

  it('parses a real refused row', () => {
    const text = `
## Refused

| Skill | Source | Date | Blocking finding |
|---|---|---|---|
| \`bad-skill\` | [\`someone/repo\`](https://github.com/someone/repo) | 2026-08-01 | prompt injection in a hidden comment |

## Declined
`
    const { refused } = parseRejectedTable(text)
    expect(refused).toHaveLength(1)
    expect(refused[0]).toMatchObject({ name: 'bad-skill', repo: 'someone/repo' })
  })

  it('does not misclassify a name mentioned only in another row\'s prose', () => {
    const text = `
## Refused

## Declined

| Skill | Source | Date | Scan | Why not |
|---|---|---|---|---|
| \`improve-animations\` | [\`emilkowalski/skills\`](https://github.com/emilkowalski/skills) | 2026-08-05 | clean | Overlaps both \`review-animations\` and \`animate\`. |
`
    const { declined } = parseRejectedTable(text)
    const names = declined.map((r) => r.name)
    expect(names).toEqual(['improve-animations'])
    expect(names).not.toContain('review-animations')
    expect(names).not.toContain('animate')
  })

  it('skips header and separator rows', () => {
    const text = `
## Refused

| Skill | Source | Date | Blocking finding |
|---|---|---|---|

## Declined
`
    const { refused } = parseRejectedTable(text)
    expect(refused).toEqual([])
  })
})

// ── §5's library resolution ─────────────────────────────────────────────────
//
// scripts/export-graph.mjs used to fix its input root three directories up
// from its own file, so it could only ever export the tree it lived in. These
// cover the decision it makes instead — the same order every verb in commands/
// follows, and the same refusal.

describe('chooseLibrary', () => {
  const noEnv = {}

  it('takes --library first', () => {
    expect(chooseLibrary(['--library', '/tmp/lib'], { SKILL_LIBRARY: '/env' }, '/cwd')).toEqual({
      ok: true, path: '/tmp/lib', from: 'flag',
    })
  })

  it('falls back to SKILL_LIBRARY, then the working directory', () => {
    expect(chooseLibrary([], { SKILL_LIBRARY: '/env' }, '/cwd')).toEqual({ ok: true, path: '/env', from: 'env' })
    expect(chooseLibrary([], noEnv, '/cwd')).toEqual({ ok: true, path: '/cwd', from: 'cwd' })
  })

  it('refuses --library with no value rather than silently using the cwd', () => {
    // The dangerous failure: falling through would export a DIFFERENT library
    // than the one the caller named, and say nothing about it.
    expect(chooseLibrary(['--library'], noEnv, '/cwd')).toEqual({ ok: false, error: '--library needs a directory' })
    expect(chooseLibrary(['--library', '--json'], noEnv, '/cwd')).toEqual({
      ok: false, error: '--library needs a directory',
    })
  })

  it('ignores an empty SKILL_LIBRARY instead of resolving to nothing', () => {
    expect(chooseLibrary([], { SKILL_LIBRARY: '' }, '/cwd')).toEqual({ ok: true, path: '/cwd', from: 'cwd' })
  })
})

describe('originTitle', () => {
  it('prefers a catalog that names itself', () => {
    expect(originTitle('Cortex', 'qrn-lib')).toBe('Cortex')
    expect(originTitle('  Cortex  ', 'qrn-lib')).toBe('Cortex')
  })

  it('falls back to the library directory', () => {
    expect(originTitle(undefined, 'qrn-lib')).toBe('qrn-lib')
    expect(originTitle('', 'qrn-lib')).toBe('qrn-lib')
    expect(originTitle('   ', 'qrn-lib')).toBe('qrn-lib')
    expect(originTitle(42, 'qrn-lib')).toBe('qrn-lib')
  })

  it('never names this tool', () => {
    // The whole point. The origin is the library being VIEWED; labelling it
    // with the viewer's name stamped our product across a stranger's data,
    // and read as a fact because there was only ever one possible input.
    const answers = [
      originTitle(undefined, 'someone-elses-library'),
      originTitle('Their Library', 'whatever'),
      originTitle(undefined, ''),
    ]
    for (const a of answers) expect(a.toLowerCase()).not.toMatch(/nexus|qrntn/)
  })
})
