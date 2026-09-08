# Shipping `pratiq`

> **Written after the split, and expected to change.** Unlike
> [`PORTABILITY.md`](PORTABILITY.md) and [`SURFACE.md`](SURFACE.md), this is not
> a dated record of something measured. It is a plan, and a plan that still
> matches the tree after the work is done was not a plan, it was a description
> written late. Edit it as the work lands.

`SURFACE.md` decided **what each command becomes**. This decides **what `0.1.0`
contains, and in what order it gets built**. Every decision below was settled by
interview; the facts each one rests on were measured, and the measurement is
recorded beside the decision so a reader can disagree with the evidence rather
than with the conclusion.

## `0.1.0` is nine verbs

`adopt` and `view` do **not** ship in it. The pipeline is finished and gated
today; `adopt` is unwritten and `view` is the largest item in the plan. Holding
a working tool behind its two least-finished parts buys nothing.

| Verb | Runs | State |
|---|---|---|
| `init` | **new — §3** | ninth verb, added because day one currently fails |
| `intake` | `commands/intake.mjs` | wrap |
| `audit` | `commands/audit-skill.mjs` | wrap |
| `promote` | `commands/promote.mjs` | wrap |
| `refresh` | `commands/refresh.mjs` | wrap |
| `usage` | `commands/usage.mjs` | wrap |
| `overlap` | `commands/overlap.mjs` | wrap |
| `ledger` | `commands/ledger.mjs` | wrap |
| `check` | **new — §2** | composition over `check-catalog.mjs` and `ledger --check` |
| `adopt` | — | **0.2** |
| `view` | — | **0.2** |
| `manifest` | — | does not ship, per `SURFACE.md` |

**Ordering.** `0.1.0` is published to npm on the `latest` tag. Then the skills
library migrates onto the published package (`SURFACE.md`'s drift mechanism, and
the other half of the split). Then `1.0.0`. The migration cannot come first —
`npx pratiq intake …` in a skill's spine needs the package to exist — and
validating it against `npm link` would exercise a resolution path nobody else
uses. `0.x` carries the "surface may move" signal in semver; no `next` or `beta`
tag, because a dist-tag nobody is told about mostly hides the release from the
people who would report bugs.

**The name is available.** `https://registry.npmjs.org/pratiq` returns 404.
Bare, not scoped: availability is the perishable part, and every `npx`
invocation in the README stays short.

## Where it actually stands

**The pipeline is done.** All seven wrapped commands take their library from
`--library`, then `SKILL_LIBRARY`, then the working directory; the
`../../../scripts/ledger.mjs` coupling is cut; absent siblings produce named
refusals. `foreign-library.test.mjs` and `round-trip.test.mjs` hold both
properties, and the whole pipeline has been run end to end against a library
containing no copy of the tool.

**Day one does not work.** Measured against what a stranger actually has — a
folder of skills, no `catalog.json`, no `ledger/`, not a git repository:

```
check-catalog   exit 2   refused: catalog.json does not exist — not a skill library
ledger --check  exit 1   1 mismatch: no ledger/tidy-notes.json for a held skill
overlap         exit 0   works
refresh         exit 0   works
usage           exit 0   works
promote         exit 1   refuses correctly (nothing in inbox)
```

Nothing was written into the folder — the read-only commands stayed read-only.
But `check`, composed of the first two, fails twice on every first run, for
reasons about the library not being pratiq-shaped rather than about it being
inconsistent. That is the "reason about itself" failure `foreign-library.test.mjs`
exists to prevent, one level above the code that suite tests. §3 is the answer.

## The work

### 1 · The package and the front door

Root `package.json`: `pratiq`, `"type": "module"`, Apache-2.0, **zero
dependencies**, `bin: { "pratiq": "./bin/pratiq.mjs" }`, `engines: ">=20"`.

Node 20 is what this was built on and went end-of-life in April 2026; the floor
is what the code needs, and the tested matrix is what is actually supported.
Those are allowed to differ. Nothing here uses an exotic API — `cpSync`,
`rmSync`, `mkdtempSync` and nothing newer.

A `files` allowlist, not an `.npmignore`; allowlists fail closed. It excludes
`*.test.mjs`, `*.self-test.mjs` and `fixtures/`. **Nothing at runtime references
them** — `promote.mjs:346` and `ledger.mjs:213` look for `*.test.mjs` inside the
*artefact being promoted*, never their own — so this is safe rather than merely
tidy. And `check.mjs`, the thing that runs them, is explicitly not shipping
either: a tarball with tests and no runner is half a gesture.

**`bin/pratiq.mjs` spawns, and does not import.** The reason is not that the
commands have top-level side effects — six of the eight already carry an
`invokedAsScript()` guard and export their internals; only `intake.mjs` and
`promote.mjs` do not, and making them match would be a small change. The reason
is that **every suite in this repository tests these as spawned CLIs.** `run()`
in `foreign-library.test.mjs`, `round-trip.test.mjs` and the rest all
`spawnSync` a script path. An importing dispatcher would create a second
invocation path that nothing tests, reaching the exit codes and refusal output
those suites assert by a different route in production than in test.

`spawnSync(process.execPath, [script, ...rest], { stdio: 'inherit' })`, exit
code propagated. That is what `SURFACE.md` means by *wrap*: one implementation,
invoked, never copied. An unknown verb names the verbs — a refusal, not a usage
dump, never a stack trace.

**Size:** small. **Blocks:** everything below.

### 2 · `pratiq check`

`SURFACE.md`: *every held skill is filed, every declared edge resolves, every
ledger entry matches the bytes on disk.* All three exist — `check-catalog.mjs`
answers the first two, `ledger.mjs --check` the third. This is composition and a
report, not new logic, and it is explicitly **not** `check.mjs`, which is this
repository's own CI runner and stays here.

On a library that has never been `init`'d it **refuses and names `pratiq init`**,
rather than reporting a library-shaped problem it does not have.

**Exit codes carry the distinction:** `2` for *not set up*, `1` for *set up and
inconsistent*. A script consuming `check` has to tell those apart, and
collapsing them is how a CI gate starts lying about which problem it found.

**Size:** small.

### 3 · `pratiq init`

The ninth verb, added because the measurement above says day one is a refusal.
It is smaller than it looks:

- **`edges.json` is already optional.** `check-catalog.mjs:169` reads it with
  `existsSync`, and the comment at `:161` says absence *"is simply no declared
  edges."* `init` never writes one — an empty file asserts "no edges declared"
  where absence already says exactly that, and inventing a claim is the thing
  this tool does not do.
- **The ledger half already exists.** `ledger --backfill` (`ledger.mjs:495`)
  writes a structural entry per held skill, uses a recorded arrival date where
  one exists, leaves unknowables `null` rather than inventing them, and already
  skips skills that have an entry unless `--force`.

So `init` writes one file and calls code that is written and gated: a
`catalog.json` filing every held skill into one category, **only if absent**,
then a backfill of only the missing ledger entries. It is idempotent and it
reports what it created versus what it left alone. A library with a catalog but
no ledger is a normal state, so a flat refusal on re-run would be hostile.

**Size:** small. **Blocks:** §2's refusal has somewhere to point.

### 4 · The `~/.claude` flip

`SURFACE.md` excludes `manifest` from the surface because *"it produces a
Claude-specific artifact"* and pratiq is cross-harness. Three shipping commands
reach into `~/.claude` anyway:

| Where | What | Disposition |
|---|---|---|
| `ledger.mjs:348` | diffs install state against `~/.claude/skills`, **on by default** | **flip to opt-in** |
| `promote.mjs:208` | scanner fallback | already fixed in `603821b` |
| `usage.mjs:92` | reads Claude transcripts | **stays, and says so** |

The install diff becomes opt-in: `--install` turns it on, replacing the current
`--no-install` opt-out. The location is configurable via `--install-root <dir>`
and `SKILL_INSTALL_ROOT`, defaulting to `~/.claude/skills` when `--install` is
passed bare — Claude-aware as a default, not as an assumption.

`usage` stays Claude-specific and the README says so plainly. It reads Claude
transcripts; that is its whole job, and pretending otherwise would be worse than
the coupling.

Without this, `SURFACE.md`'s argument for excluding `manifest` does not survive
contact with what is actually shipping.

**Size:** small, but it changes a published flag's polarity — do it before
`0.1.0`, never after.

**Landed.** `--no-install` is gone; `--install` turns the diff on, in both
`ledger` and `usage`. Location resolves `--install-root`, then
`SKILL_INSTALL_ROOT`, then `~/.claude/skills`. `--install-root` without
`--install` is refused rather than ignored or silently honoured — the latter
would be the opt-out default returning through a side door — and
`SKILL_INSTALL_ROOT` sets the location without turning the look on, for the
same reason.

One decision was taken here that this section did not specify, because the
write path reached `~/.claude` as well as the diff, and flipping only the diff
would have left the claim half true. **`install` is now nullable, and `null`
means no run has looked.** It is not the same claim as `{ symlinked: false }`,
which is a finding and requires having looked. `EMPTY_ENTRY.install` changed
from `{ symlinked: false, path: null }` to `null` to match, and `usage` omits
the key entirely rather than writing null, so an unflagged run leaves what an
earlier `--install` run recorded instead of erasing it. This is the same
convention the header already stated for `usage` and `origin.upstreamHead` —
*"null is a real value throughout"* — applied to the one section that was
defaulting instead.

`ledger.test.mjs` gained 15 assertions, every one against an install root
under the fixture; nothing in the suite reads the real `~/.claude`, which is
the property being tested as much as it is a way of testing it. Reverting the
polarity fails two of them, checked rather than assumed.

### 5 · What `promote` says when it finishes

`promote.mjs:480` currently prints *"Add it to catalog.json, declare its edges,
then ./install.sh"*. **There is no `install.sh` in this repository** — it
belongs to the library this was extracted from. Every successful promotion ends
with an instruction that cannot be followed.

For `0.1.0` the wording becomes harness-generic: name the step ("symlink or copy
it where your agent loads skills from") without naming one product's directory.
A `pratiq install` verb is a real thing worth having and belongs with the same
decision as §4 — deferred, not forgotten.

**Size:** trivial. Listed separately because it is user-facing and easy to miss.

### 6 · The README

Three changes, and the shape of each was argued rather than assumed.

**The lifecycle table keeps every row.** It describes *stages*, and every stage
still exists — a human still adopts or declines, by hand, into `AUDIT.md` and
`REJECTED.md`. What is missing is a command, not a stage. The two whose command
lands in `0.2` are marked as such, and the README says the decision is written
by hand today. Deleting a real stage to make the command list look complete is
precisely the move this tool exists to refuse.

**The viewer claim is qualified, not deleted.** *"It ships with a browser-based
graph viewer"* is false in `0.1.0`, but the viewer is not vapour — `nexus/`
builds and runs from a checkout. The only false word is "ships". Say it runs
from a checkout and that `pratiq view` lands in `0.2`.

**The frozen contracts are stated, not left to inference.** See below.

### 7 · Release mechanics, and the gate that catches the packaging bug

- `prepublishOnly: node check.mjs`. A publish that skips the gates is how the
  gates stop meaning anything.
- **GitHub Actions on Node 20, 22 and 24.** There is no CI today. The argument
  here is stronger than the usual one, and this repository produced it:
  `promote.test.mjs` passed two consecutive full runs on **borrowed state from
  one machine** — `~/.claude/skills/skill-audit` — and only failed when that
  install disappeared mid-session. A clean runner with no `~/.claude` is exactly
  the environment that catches that class, and it is the class this whole
  project exists to worry about. A local-only gate cannot ask the question.
- The `nexus` gate stays `skip`, and must not block: `view` is not in `0.1.0`.
- **Publishing is manual for `0.1.0`.** Automate on a `v*` tag once there is a
  second release to be consistent with; a publish pipeline debugged during the
  first publish is two problems at once.

**The packaging smoke test.** The gate that decides whether any of this actually
shipped: `npm pack` → install the tarball into a clean directory → **run it with
`HOME` pointed somewhere empty** → then assert

1. all nine verbs run, and every failure is about the artefact rather than about
   the tool — the same question `foreign-library.test.mjs` asks, one level up;
2. `init` on a bare folder of skills makes `check` pass;
3. the full round trip completes — intake, audit, promote, refresh;
4. nothing is written outside the install directory and the target library.

The empty `HOME` is the load-bearing part. It is exactly what would have caught
the scanner defect, and nothing else in this plan asks that question.

### 8 · After `0.1.0`

**The library migration.** `SURFACE.md`'s drift mechanism, and the sentence in
the extraction commit: *"the split is not finished until the library consumes
this rather than contains it."* `skill-intake`, `skill-audit` and `skill-adopt`
stop shipping scripts and cite `npx pratiq …`. Outside this repository, but it
is what SK-97 being done means, and `1.0.0` waits behind it.

**`adopt`** — the lifecycle's central verb, and much less open than
`SURFACE.md` makes it sound. `REJECTED.md`'s format is already pinned by two
independent readers a writer has to satisfy: `check-catalog.mjs:209`
(`readRejectedFrom`) and `nexus/src/data/integrity.ts:163`
(`parseRejectedTable`), the latter knowing both sections and all their columns —
`## Refused` is `` `name` `` | `[repo](url)` | date | blocking finding, and
`## Declined` adds a scan and a why. And `promote.mjs:109` already refuses a
`REJECT` with *"a rejected skill is deleted with a REJECTED.md row, never
promoted"*, so the shape of the outcome is decided too. Two questions remain
open and were deliberately not settled here: whether `--decline` keeps or
deletes the bytes, and whether `adopt` moves the artefact or only records the
decision and leaves the move to `promote`. Two verbs that both move things is
how they drift.

**`view`** — three problems, none of them packaging:

- `nexus/scripts/export-graph.mjs:26` resolves `REPO_ROOT` from
  `import.meta.url`. That is precondition 2 of `SURFACE.md` — the finding that
  shaped the entire split — still live in the viewer, untouched because SK-97
  scoped itself to `commands/`. Until it takes a library root, `view` can only
  graph the tree it was installed into.
- The exporter's dependency is **shallower than it first appears**.
  `integrity.ts` has *zero* zod references — 223 lines of pure logic. Only
  `types.ts` uses zod, and `export-graph.mjs` imports exactly one thing from it:
  `GraphSnapshotSchema`, validating its own output. The dependency is one schema
  check, not a toolchain. Bundle the exporter to plain JS at publish time — one
  source, no drift. Reimplementing it in the CLI would be a second
  implementation of the resolution order, which is the drift `SURFACE.md`'s
  "cannot drift" clause exists to prevent; recorded here only to be rejected.
- `nexus/public/data/graph.json` is a 49-node snapshot of the library this was
  extracted from. Fine as a fixture, and it must never ship as truth — `view`
  generates the graph for the library it is pointed at, when it is pointed
  there.

## The frozen contracts

`0.x` means the surface may move, and the README says so. These do not:

| Contract | Why it is frozen |
|---|---|
| `--library` | §8's migration writes it into three skills' spines |
| `SKILL_LIBRARY` | same, and it is what SK-97 was fought over |
| `SKILL_INSTALL_ROOT`, `--install-root` | named to match `SKILL_LIBRARY`, not `PRATIQ_*` — two naming conventions in one surface, decided at different times for no recoverable reason, is its own defect |
| exit `0` / `1` / `2` | see below |

**The exit convention already exists and is already consistent** across all
eight commands; nothing writes it down:

```
0   clean
1   ran, and the answer is no      — promote refused, ledger found a mismatch
2   could not run                  — usage error, not a library, no catalog
```

Publishing freezes it whether or not it is documented, and an undocumented
convention that is nonetheless real is the more dangerous state: a later change
to one command's exit looks local and harmless, and there is no line anywhere it
visibly violates. It goes in the README as a table.

`--json` shapes are **explicitly unstable in `0.x`**, and the README says that
too. Seven of the eight commands emit JSON, and `promote`'s shape gained
`staged` and `stageError` in `603821b` — these are demonstrably still moving.

## Corrections to the dated records

`PORTABILITY.md` and `SURFACE.md` are dated records and are **not edited** —
their prefaces explain why. Where later work contradicts them, the correction
lives here.

- **`SURFACE.md`, on `manifest`:** the claim that pratiq is cross-harness, used
  to justify excluding `manifest`, was not true of what was shipping.
  `ledger.mjs:348` read `~/.claude/skills` by default. §4 makes the claim true;
  until §4 lands it is aspirational.
- **`SURFACE.md`, precondition 2:** described as satisfied for the command
  surface, which it is. It was never applied to `nexus/scripts/export-graph.mjs`,
  which still resolves its root from `import.meta.url`.
- **`PORTABILITY.md`, "What was not exercised":** intake's successful path in a
  foreign tree is now exercised, by `round-trip.test.mjs`.

## Order

§1 first — nothing is reachable without it. §3 next, because §2's refusal needs
somewhere to point. Then §2. §4 and §5 are small, independent, and both change
user-visible behaviour, so they land before anything is published rather than
after. §6 once the verb list and exit codes are final. §7 last, and it is the
gate that decides whether any of it actually shipped.
