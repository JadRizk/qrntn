# Shipping `pratiq`

> **Written after the split, and expected to change.** Unlike
> [`PORTABILITY.md`](PORTABILITY.md) and [`SURFACE.md`](SURFACE.md), this is not
> a dated record of something measured. It is a plan, and a plan that still
> matches the tree after the work is done was not a plan, it was a description
> written late. Edit it as the work lands.

`SURFACE.md` decided **what each command becomes**. This decides **what has to
exist for a stranger to run one**, in the order it has to exist.

## Definition of done

A person who has never seen this repository runs

```
npx pratiq intake https://github.com/someone/skills/tree/main/foo --library ~/skills
```

on a machine with no toolchain beyond Node, and it works — including `view`,
which needs no build step on their side. Every verb in the README's command
block resolves. Nothing in the package reaches for a file outside it.

Three things stand between here and there, and only one of them is packaging.

## Where it actually stands

**The hard part is done.** All seven commands take their library from
`--library`, then `SKILL_LIBRARY`, then the working directory; the
`../../../scripts/ledger.mjs` coupling is cut; absent siblings produce named
refusals. `commands/foreign-library.test.mjs` and `commands/round-trip.test.mjs`
hold both properties, and the full pipeline has been run end to end against a
library that contains no copy of the tool.

**What is missing is a front door and two commands.** There is no root
`package.json`, no `bin`, and no dispatcher — every entry point is still
`node commands/<name>.mjs`. `adopt` has never existed. `view` cannot run outside
this tree.

## The work

### 1 · The package and the front door

A root `package.json`: `pratiq`, `"type": "module"`, Apache-2.0, **zero
dependencies**, `bin: { "pratiq": "./bin/pratiq.mjs" }`.

`bin/pratiq.mjs` **spawns**, and does not import. Every command in `commands/`
is a script with top-level side effects — `promote.mjs` runs its whole gate at
module load — so a dispatcher that imported them would execute one on the way to
choosing another. `spawnSync(process.execPath, [script, ...rest], { stdio: 'inherit' })`
and propagate the exit code, which also preserves each command's own refusal
surface and exit codes exactly as its tests assert them. That is what
`SURFACE.md` means by *wrap*: one implementation, invoked, never copied.

| Verb | Runs |
|---|---|
| `intake` | `commands/intake.mjs` |
| `audit` | `commands/audit-skill.mjs` |
| `adopt` | **§3** |
| `promote` | `commands/promote.mjs` |
| `refresh` | `commands/refresh.mjs` |
| `usage` | `commands/usage.mjs` |
| `overlap` | `commands/overlap.mjs` |
| `ledger` | `commands/ledger.mjs` |
| `check` | **§2** |
| `view` | **§4** |
| `manifest` | does not ship — `SURFACE.md` |

An unknown verb names the verbs, in the house style: a refusal, not a usage
dump, and never a stack trace.

**Size:** small. **Blocks:** everything below.

### 2 · `pratiq check`

`SURFACE.md`: *every held skill is filed, every declared edge resolves, every
ledger entry matches the bytes on disk.* All three already exist —
`check-catalog.mjs` answers the first two, `ledger.mjs --check` the third. This
is composition and a report, not new logic, and it is explicitly **not**
`check.mjs`, which is this repository's own CI runner and stays here.

**Size:** small.

### 3 · `adopt` — the lifecycle's central verb

The one genuinely unwritten command. Today the decision is a person hand-editing
`AUDIT.md` dispositions and hand-writing a `REJECTED.md` row.

**It is far less open than it looks.** `REJECTED.md`'s format is already pinned
by two independent readers, and a writer has to satisfy both:

- `commands/check-catalog.mjs:209` — `readRejectedFrom`, matching a
  backtick-wrapped identifier in the first cell.
- `nexus/src/data/integrity.ts:163` — `parseRejectedTable`, which additionally
  knows the two sections and their columns:
  - `## Refused` — `` `name` `` | `[repo](url)` | date | blocking finding
  - `## Declined` — `` `name` `` | `[repo](url)` | date | scan | why

`promote.mjs:109` already refuses a `REJECT` verdict with *"a rejected skill is
deleted with a REJECTED.md row, never promoted"* — so the shape of the outcome
is decided too. `adopt` writes the row that sentence assumes someone writes.

Wire it to the same catalog and ledger checks `promote` uses, so the two verbs
cannot disagree about what a filed skill is.

**Size:** medium, and it carries the open decisions in the next section.
**Blocks:** the README's command block being honest.

### 4 · `view` — the expensive one

Three separate problems, none of them packaging.

**The exporter is not portable.** `nexus/scripts/export-graph.mjs:26` resolves
`REPO_ROOT` from `import.meta.url`. That is precondition 2 of `SURFACE.md` —
the finding that shaped the whole split — still live in the viewer, untouched
because SK-97 scoped itself to `commands/`. Until it takes a library root,
`view` can only ever graph the tree it was installed into.

**The exporter cannot run in a zero-dependency CLI.** It imports
`src/data/types.ts` and `src/data/integrity.ts`, runs under `tsx`, and pulls in
`zod`. Two ways out:

- **Bundle it at publish time** into a plain-JS `dist/export-graph.mjs`.
  One source, no drift, no toolchain on the user's machine. *Recommended.*
- Reimplement it in plain Node in the CLI. This is a second implementation of
  the resolution order, which is exactly the drift `SURFACE.md`'s "cannot drift"
  clause exists to prevent. Listed only to be rejected on the record.

**The committed data is somebody else's library.** `nexus/public/data/graph.json`
is a 49-node snapshot of the library this was extracted from. It is fine as a
fixture and must never ship as truth — `view` generates the graph for the
library it is pointed at, at the moment it is pointed there.

Then: ship `nexus/dist/` prebuilt, serve it with a small plain-Node static
server, and the user installs no build toolchain and no dependency tree.

**Size:** large. **Independent of §3** — these can proceed in parallel.

### 5 · Release mechanics, and the gate that catches the packaging bug

- `prepublishOnly` runs `node check.mjs` and the nexus build. A publish that
  skips the gates is how the gates stop meaning anything.
- A `files` allowlist, not an `.npmignore`. Allowlists fail closed.
- **A packaging smoke test**, and this is the one that matters:
  `npm pack` → install the tarball into a clean directory → run every verb
  against a throwaway library. It is the packaging analogue of
  `foreign-library.test.mjs` — same question, one level up. *Does the command
  fail for a reason about the artefact, or for a reason about itself?* A file
  missing from `files` is invisible to every suite in this repository and
  obvious to this one, on the first run.

### 6 · The other half of the split

`SURFACE.md`'s drift mechanism, and the sentence in the extraction commit: *"the
split is not finished until the library consumes this rather than contains
it."* `skill-intake`, `skill-audit` and `skill-adopt` stop shipping scripts and
cite `npx pratiq …` where they say `node scripts/…` today.

Out of this repository, but it is what SK-97 being done means. Nothing here can
close it.

## Open decisions

These change what gets built, not how. They are the reason this document stops
where it does.

1. **Does `adopt --decline` keep the bytes or delete them?** `promote.mjs:109`
   says a rejected skill is *deleted* with a row. A declined one is a different
   verdict and the README calls declining a success. If the bytes go, the row
   and the ledger are the whole memory — which is the design, but it should be
   chosen rather than inherited from a sentence about `REJECT`.
2. **Does `adopt` move the artefact, or only record the decision** and leave
   `promote` to move it? Two verbs that both move things is how they drift.
3. **Do the tests ship in the tarball?** They live beside the scripts on
   purpose, and nothing at runtime needs them. Recommend excluding them and the
   fixtures via `files`; the repository stays where they live.
4. **Engine floor.** Nothing here uses an exotic API — `cpSync`, `rmSync`,
   `mkdtempSync` and nothing newer. Node 20 is what this was built on and is
   past end-of-life as of April 2026; Node 22 is Active LTS. `>=20` ships to
   more people, `>=22` is the one to test against.
5. **The npm name.** `pratiq` is unverified on the registry. Check before the
   README promises `npx pratiq`.

## Order

§1 first, because nothing is reachable without it. §2 immediately after, because
it is small and it makes the front door provably real. §3 and §4 are independent
of each other and are the bulk of the work. §5 last, and it is the gate that
decides whether any of it actually shipped.
