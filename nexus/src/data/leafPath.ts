// The one place a leaf node's file path is derived from the leaf.
//
// A leaf carries a bare filename and a kind; its path within the skill is
// the kind's folder plus that name, or the name alone for a root companion
// .md (export-graph.mjs's leaf walk). Three places used to recover it with
// `endsWith('/' + file)`, which also matched a nested, readable-not-drawn
// `references/deep/notes.md` against the `references/notes.md` leaf —
// selecting and flying the camera to the wrong node. Exact, and once.

import type { LeafNode, SkillFile, SkillNode } from './types.ts'

const FOLDER = { ref: 'references', asset: 'assets', agent: 'agents' } as const

/** The candidate paths for this leaf, in the order the exporter would have found them. */
export function leafPaths(leaf: LeafNode): string[] {
  const inFolder = `${FOLDER[leaf.leafKind]}/${leaf.file}`
  return leaf.leafKind === 'ref' ? [inFolder, leaf.file] : [inFolder]
}

/** The file on the owner that this leaf is, or undefined when the export has no such file. */
export function fileOfLeaf(owner: SkillNode, leaf: LeafNode): SkillFile | undefined {
  for (const path of leafPaths(leaf)) {
    const file = owner.files.find((f) => f.path === path)
    if (file) return file
  }
  return undefined
}

/** The leaf that is exactly this path of the skill, or undefined for a file that is not drawn. */
export function leafForPath(leaves: readonly LeafNode[], skillId: string, path: string): LeafNode | undefined {
  return leaves.find((l) => l.owner === skillId && leafPaths(l).includes(path))
}
