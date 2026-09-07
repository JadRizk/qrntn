// fetch + zod-validate public/data/graph.json (§4, §8 step 1).
//
// TypeScript types vanish at runtime; this is the one place the committed
// snapshot crosses from "file on disk" to "data this app trusts" (§2), so
// it validates rather than casts.

import { GraphSnapshotSchema, type GraphSnapshot } from './types.ts'

export class GraphLoadError extends Error {}

export async function loadGraph(url = '/data/graph.json'): Promise<GraphSnapshot> {
  const response = await fetch(url)
  if (!response.ok) {
    throw new GraphLoadError(`fetching ${url} — ${response.status} ${response.statusText}`)
  }

  const json: unknown = await response.json()
  const result = GraphSnapshotSchema.safeParse(json)
  if (!result.success) {
    throw new GraphLoadError(`${url} failed validation — ${result.error.message}`)
  }
  return result.data
}
