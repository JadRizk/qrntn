// The reader's confusables and the scanner's must be one table.
//
// The scanner (commands/audit-skill.mjs) cannot be imported — it is a script
// that runs on import — so its table is restated in confusables.ts. This
// rebuilds the scanner's map from the scanner's own source text, by running
// exactly the lines that build it, and asserts equality entry by entry. The
// same idea as record.agreement.test.ts: two descriptions of one thing,
// something checking they still match.

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { CONFUSABLES } from './confusables.ts'

const SCANNER = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'commands', 'audit-skill.mjs')

function scannersTable(): Map<string, string> {
  const source = readFileSync(SCANNER, 'utf8')
  const start = source.indexOf('const CONFUSABLES = new Map();')
  const end = source.indexOf('// ── instruction surface', start)
  expect(start, 'the scanner still declares CONFUSABLES where this test looks').toBeGreaterThan(-1)
  expect(end, 'the instruction-surface section still follows the table').toBeGreaterThan(start)
  // The extracted lines are the scanner's own table builder and nothing
  // else: a Map, a helper, and calls to it. Run as written.
  const build = new Function(`${source.slice(start, end)}\nreturn CONFUSABLES;`) as () => Map<string, string>
  return build()
}

describe('confusables agreement', () => {
  it('the reader\'s table is the scanner\'s table, entry for entry', () => {
    const theirs = scannersTable()
    expect(theirs.size).toBeGreaterThan(60)
    expect([...CONFUSABLES.entries()].sort()).toEqual([...theirs.entries()].sort())
  })
})
