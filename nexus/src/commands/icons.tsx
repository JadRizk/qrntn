// commands/icons.tsx — the command palette's action row gets its own glyph
// vocabulary, distinct from a graph node's taxonomy shape (data/taxonomy.ts):
// an action isn't a node kind, so it has no shape/colour to inherit, and
// forcing one of the six GLYPH shapes onto it would make "there's a hexagon
// in the results" stop meaning "there's a category node in the results".
//
// Same visual language as @nexus/react's own Glyph (primitives.tsx) —
// 14x14 viewBox, glow via drop-shadow — so an action row and a node row
// read as one family despite the different shape source.

import type { ReactNode } from 'react'

export type ActionIconName = 'home' | 'crt' | 'fit' | 'reseed' | 'filter'

// Every path below draws unfilled (the <g> in ActionIcon carries fill="none"
// once, rather than each path repeating it) — the one exception, `fit`'s
// centre dot, overrides back to a real fill itself.
const PATH: Record<ActionIconName, ReactNode> = {
  home: (
    <path d="M2 7 L7 2.6 L12 7 M3.4 6.2V11.4H10.6V6.2" strokeLinecap="round" strokeLinejoin="round" />
  ),
  crt: (
    <>
      <rect x="2" y="3" width="10" height="6.6" rx="0.8" />
      <path d="M5 11.6H9" strokeLinecap="round" />
    </>
  ),
  fit: (
    <>
      <path d="M2 5V2.4H4.6 M9.4 2.4H12V5 M12 9V11.6H9.4 M4.6 11.6H2V9" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="7" cy="7" r="1.5" fill="currentColor" stroke="none" />
    </>
  ),
  reseed: (
    <path d="M3 5.2A4.1 4.1 0 0111 5 M11 5V2.2 M11 5H8.2 M11 8.8A4.1 4.1 0 013 9 M3 9V11.8 M3 9H5.8" strokeLinecap="round" strokeLinejoin="round" />
  ),
  filter: (
    <path d="M2.2 3H11.8L8.1 7.4V11L5.9 12V7.4Z" strokeLinejoin="round" />
  ),
}

export interface ActionIconProps {
  name: ActionIconName
  colour?: string
  size?: number
}

export function ActionIcon({ name, colour = 'var(--nx-fg-accent)', size = 13 }: ActionIconProps) {
  return (
    <svg
      width={size} height={size} viewBox="0 0 14 14" aria-hidden="true"
      style={{ flexShrink: 0, color: colour, filter: `drop-shadow(0 0 4px ${colour})` }}
    >
      <g stroke={colour} strokeWidth="1.3" fill="none">{PATH[name]}</g>
    </svg>
  )
}
