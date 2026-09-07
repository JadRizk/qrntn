// commands/types.ts — the two kinds of row the palette can show, both
// PaletteItem so @nexus/react's CommandPalette/rankItems work unmodified.
//
// A discriminated union rather than one interface with optional fields: the
// palette's onSelect switches on `kind`, and TypeScript needs that switch to
// be exhaustive-checkable (§3's assertNever pattern, same as taxonomy.ts).

import type { PaletteItem } from '@nexus/react'
import type { NodeKind } from '../data/taxonomy.ts'
import type { ActionIconName } from './icons.tsx'

export interface ActionItem extends PaletteItem {
  kind: 'action'
  /** Which commands/icons.tsx glyph to show — the row's "another look" from a graph node's taxonomy shape. */
  icon: ActionIconName
  run: () => void
}

/** A graph node, surfaced as a searchable palette row — selecting it does what clicking the node in the canvas does. */
export interface NodeItem extends PaletteItem {
  kind: 'node'
  nodeId: string
  /** The node's taxonomy kind, carried so whoever handles the selection can tell whether the type filter is currently hiding it (App.tsx) — the palette lists every node, including kinds toggled off in the legend. */
  nodeKind: NodeKind
}

export type CommandItem = ActionItem | NodeItem
