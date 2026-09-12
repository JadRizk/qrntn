import { describe, expect, it } from 'vitest'

import { fileOfLeaf, leafForPath, leafPaths } from './leafPath.ts'
import type { LeafNode, SkillNode } from './types.ts'

const leaf = (file: string, leafKind: LeafNode['leafKind'] = 'ref'): LeafNode => ({ kind: 'leaf', id: `s/${file}`, owner: 's', file, leafKind, words: 1 })
const file = (path: string, role: 'ref' | 'asset' | 'other' = 'ref') => ({ kind: 'text' as const, path, role, bytes: 1, sha256: 'a'.repeat(64), verified: 'matches' as const, content: '', links: [], anchors: [] })
const owner = {
  kind: 'skill', id: 's', name: 's', description: '', category: 'c', origin: 'authored', manualOnly: false, words: 1, refWords: 0, usage: null,
  files: [file('SKILL.md'), file('references/notes.md'), file('references/deep/notes.md'), file('STANDARDS.md'), file('assets/notes.md', 'asset')],
  record: { source: null, commit: null, date: null, verdict: null, findings: null, dispositioned: null, reportPath: null, missing: [] },
  findings: [],
} as SkillNode

describe('leafPath — a leaf is exactly one path', () => {
  it('a reference is references/<file>, or the root companion of that name', () => {
    expect(leafPaths(leaf('notes.md'))).toEqual(['references/notes.md', 'notes.md'])
    expect(leafPaths(leaf('notes.md', 'asset'))).toEqual(['assets/notes.md'])
    expect(fileOfLeaf(owner, leaf('notes.md'))?.path).toBe('references/notes.md')
    expect(fileOfLeaf(owner, leaf('STANDARDS.md'))?.path).toBe('STANDARDS.md')
    expect(fileOfLeaf(owner, leaf('notes.md', 'asset'))?.path).toBe('assets/notes.md')
  })

  it('a nested file with the same basename is nobody\'s leaf', () => {
    const leaves = [leaf('notes.md'), leaf('notes.md', 'asset')]
    expect(leafForPath(leaves, 's', 'references/notes.md')?.leafKind).toBe('ref')
    expect(leafForPath(leaves, 's', 'assets/notes.md')?.leafKind).toBe('asset')
    expect(leafForPath(leaves, 's', 'references/deep/notes.md')).toBeUndefined()
    expect(leafForPath(leaves, 'other-skill', 'references/notes.md')).toBeUndefined()
  })
})
