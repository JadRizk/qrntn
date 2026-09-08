// commands/CommandContext.tsx — the scoped action registry.
//
// A "scope" is just a caller-chosen key (e.g. 'global', 'graph'): whoever
// mounts calls useCommandActions(scope, actions) and their rows appear in
// the palette for as long as they stay mounted, gone the instant they
// unmount — no page/route concept required. When Nexus grows a second page,
// that page registers its own scope the same way and the graph's actions
// disappear on their own; nothing here has to change.
//
// Callers must memoize the `actions` array they pass (useMemo) — it's an
// effect dependency, so a fresh array literal every render would re-register
// every render. The existing App.tsx already memoizes everything else this
// heavily (canvasProps, idsByKind, kindCounts), so this matches house style
// rather than introducing a new one.

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { ActionItem } from './types.ts'

interface CommandContextValue {
  register: (scope: string, actions: readonly ActionItem[]) => () => void
  actions: readonly ActionItem[]
}

const Ctx = createContext<CommandContextValue | null>(null)

export function CommandActionsProvider({ children }: { children: ReactNode }) {
  const [scopes, setScopes] = useState<ReadonlyMap<string, readonly ActionItem[]>>(new Map())

  // Stable identity (empty deps): `register` closes over `setScopes` only,
  // never over `scopes` itself (every update below is the functional-setState
  // form). If this depended on `scopes` instead, calling it would produce a
  // new `register` on every scope change — and since useCommandActions's
  // effect lists `register` as a dependency, that new identity would re-run
  // the effect, which calls register again, which changes scopes again:
  // React's "Maximum update depth exceeded" loop, seen live wiring this up.
  const register = useCallback((scope: string, actions: readonly ActionItem[]) => {
    setScopes((prev) => new Map(prev).set(scope, actions))
    return () => setScopes((prev) => {
      if (!prev.has(scope)) return prev
      const next = new Map(prev)
      next.delete(scope)
      return next
    })
  }, [])

  const actions = useMemo(() => [...scopes.values()].flat(), [scopes])
  const value = useMemo<CommandContextValue>(() => ({ register, actions }), [register, actions])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

function useCommandContext(): CommandContextValue {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('commands: used outside <CommandActionsProvider>')
  return ctx
}

/** Contributes `actions` under `scope` for as long as the calling component is mounted. `actions` must be a memoized array (see header). */
export function useCommandActions(scope: string, actions: readonly ActionItem[]): void {
  const { register } = useCommandContext()
  useEffect(() => register(scope, actions), [register, scope, actions])
}

/** Every action currently registered by any mounted scope, for whoever renders the palette itself. */
export function useRegisteredActions(): readonly ActionItem[] {
  return useCommandContext().actions
}
