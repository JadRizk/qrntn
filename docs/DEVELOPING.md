# Developing

What is here, in the order you need it: a loop fast enough to use on every
change; how to point that loop at your own library, and which verbs write to
it; the four layers of testing and the question each one answers that the
one below cannot; a table of which gate to run when; how to write a suite for
a new verb; how to reproduce a pull request's CI on your machine; and the two
facts about packing that are not obvious from the tree.

## The loop

```sh
source dev.sh                      # sandbox: a throwaway library, a sandbox HOME
source dev.sh --library <dir>      # real: that library, your HOME — every write is real
source dev.sh --clone <dir>        # a disposable git clone of <dir>, sandbox HOME
```

Sourced, not executed — the point is what it leaves behind in the shell you are
standing in, and `./dev.sh` would set three variables, exit, and leave you where
you started. It refuses if you try.

What you get:

| | |
|---|---|
| `qrntn <verb>` | the real binary, run from a symlinked install |
| `qrntn-real <verb>` | the same, always against your real `HOME` |
| `qrntn-lib-reset [names…]` | the library back to its start — rebuilt in sandbox mode, re-cloned in clone mode, refused in real mode |
| `qrntn-relink` | rebuild the symlinked install |
| `qrntn-env` | what is set, and against what |
| `qrntn-off` | put the shell back |

`npm install <path>` symlinks a local directory rather than copying it, so the
binary in the sandbox **is** this checkout: edit `commands/adopt.mjs`, run
`qrntn adopt`, see the change. Nothing is re-packed, and nothing is rebuilt —
`view/` is the only build output, and only the viewer needs it.

`SKILL_LIBRARY` is set, so `--library` is optional on every verb.
`qrntn-lib-reset` is the important verb in that table: half the pipeline
mutates the library on purpose — `promote` moves a directory, `adopt` ends a
quarantine — so what you want is not a library you keep clean but one you can
discard mid-experiment.

`HOME` is **not** exported. The smoke gate points it at an empty directory
because `promote.test.mjs` once passed twice on a borrowed
`~/.claude/skills/skill-audit` that happened to be installed on the machine, and
only failed when that install disappeared mid-session. The same protection is
wanted in the loop, but exporting `HOME` into an interactive shell breaks git,
npm and ssh. So a shim on `PATH` overrides it per invocation and nothing else
does. `qrntn-real` is the same shim without the override.

The shim `exec`s rather than wrapping, and it is a script rather than a shell
function, for the sake of the one verb that does not exit: `qrntn view &` then
`kill -INT $!` has to reach the dispatcher, and through a backgrounded function
it reaches a forked shell that ignores it instead. Ctrl-C at a prompt never
showed this, because it hits the whole foreground group.

## Your own library

Three modes, named, never inferred — the same rule every verb follows for the
library it acts on. **Sandbox** is the default because it is the only mode in
which nothing you own can be touched. **Real** is for using the tool on your
library, which is what it is for. **Clone** is for exercising every verb on
your real data with none of it being real: a `git clone` of the library inside
the sandbox, re-cloned by `qrntn-lib-reset`, and the mutating verbs run against
it with a sandbox `HOME`.

A library is a directory with `skills/<name>/SKILL.md` and a `catalog.json`.
The folder your agent loads from is usually not one — `~/.claude/skills` is
flat, has no catalog, and is typically symlinks into the library — and pointing
`--library` at its parent would treat it as `skills/`. Point at the repository
those links resolve into.

What each verb does to a library, so real mode holds no surprises:

| | verbs | what real mode means |
|---|---|---|
| read only | `check`, `ledger --check`, `overlap`, `audit`, `view` | nothing |
| rewrite `ledger/` | `usage`, `refresh` | regenerable output, but a diff in a git-tracked file — commit it or check it out |
| move or write | `intake`, `adopt`, `promote` | exactly what they say: `inbox/` gains a directory, `AUDIT.md` gets a verdict, `REJECTED.md` gets a permanent row, `skills/` gains a directory and `inbox/` loses one |
| idempotent | `init` | keeps a catalog that exists and ledger entries that exist, and says so |

**Nothing installs.** `qrntn` records and checks; it never writes to where your
agent loads from. `promote` ends by telling you the symlink is yours to make,
and `ledger --check --install` is a *diff* of the ledger's install section
against the live `~/.claude/skills`, not an installer.

In real mode `qrntn` itself does not override `HOME`, for two reasons that are
both read-only: `usage` reads transcripts from `HOME`, and `ledger --check
--install` compares against `HOME`'s `~/.claude/skills`. A sandbox `HOME` there
would count nothing and report every held skill uninstalled.

Every verb has been driven in clone mode against a fifteen-skill library, two
of them over the network: `init` left an initialised library alone, `intake`
fetched a real upstream at a pinned commit, `adopt` recorded and `promote`
moved, `--decline` wrote the tenth `REJECTED.md` row, `refresh` found one
upstream had moved, `qrntn-real usage` counted 198 invocations across 583
transcripts into the clone's ledger, and `view` served 68 nodes.

### The viewer

```sh
npm run dev:view
```

Vite with HMR, against the fixture in `nexus/public/data/`. Also wired as the
`nexus` entry in `.claude/launch.json`.

To point the dev server at a real library you have to regenerate that fixture,
and `export:data` with no `--out` writes over it — and it is git-tracked. Pass
`--out` somewhere else, or `git checkout nexus/public/data/graph.json` after.

`npm run build:view` makes the bundle `qrntn view` serves. You need it only when
you want to drive the thing the tarball ships rather than the dev server; the
two are the same source.

## Four layers, and what each one can see

Each layer answers a question the one below it cannot.

**`commands/<verb>.test.mjs` — does the command do what it says.** Plain Node,
no framework: a `check(name, cond, detail)` accumulator, sandboxes built in
`tmpdir`, `N passed, M failed`, exit 1 on any failure. Suites take no filter
argument; you run the whole file, which is seconds.

**`commands/<verb>.self-test.mjs` — is the suite actually asserting anything.**
A suite that has only ever passed has not been tested. The self-test rewrites
the command's source in a sandbox copy, in specific ways, runs the suite
against each mutant, and asserts the suite **fails every time**. A mutation
that survives names a check nobody is making.

It matters most where a defect fails silently in the reader's favour. Delete
the one assertion in `view.test.mjs` that guards "a fixture planted in the
bundle is still refused" and the suite still reports `54 passed, 0 failed` —
green, with the rule that a fixture must never be served now unchecked, and
nothing in the output to say so. The self-test reports `SURVIVED anything under
/data/ is served, so a fixture could answer` and exits 1. A server that serves
too much looks exactly like a server that works; only mutating the source can
tell them apart.

Four disciplines keep a self-test honest, and every one here has them:

- **Inert controls.** An entry marked `expect: 'survives'` — a reworded
  comment. A harness that can only ever report "caught" has proved nothing
  about itself.
- **Anchors match exactly once.** If the source drifted so the mutation's
  `find` string appears zero or two times, the entry errors out rather than
  silently no-op'ing and reporting a pass.
- **The source is unchanged afterwards.** Asserted explicitly; the shipped
  script is never written to.
- **The clean run must also pass.** A suite that fails on unmutated source
  would "catch" everything.

A fifth, worth copying: `view.self-test.mjs` carries an entry marked
`REDUNDANT ON POSIX` that survives for a known reason — the normalisation one
line earlier already does the work — recorded rather than deleted, and rather
than faking an assertion to make it "caught". A test documenting a real limit
beats one taking credit for coverage nobody wrote.

**`smoke.mjs` — does it work for someone who installs it.** See below.

**CI — was any of that passing on borrowed state.** `.github/workflows/check.yml`
runs every gate on Node 20, 22 and 24 with no viewer toolchain, plus a `viewer`
job that installs it and runs everything with the bundle present, a `tarball`
job that prints what `npm pack` would ship, and a changelog gate on pull
requests. A clean runner has no `~/.claude`, no library, and no copy of this
tool but the checkout — the environment that catches the class of defect the
whole project exists to worry about, and one a local run cannot ask about.

## The gates

| when | command | what it costs |
|---|---|---|
| changed one command | `node commands/<name>.test.mjs` | seconds |
| before a commit | `npm run test:quick` | ~1 min · 18 gates |
| touched what ships | `npm run smoke` | packs and installs |
| before publishing | `npm test` | ~10 min · 32 gates, everything |

`npm run gates` names them without running them, which is the honest way to see
what `--quick` is skipping: the self-tests, the bundle build, smoke, and the
two `nexus` gates.

Suites are **discovered, not listed** — `check.mjs` reads `commands/` for
`*.test.mjs` and `*.self-test.mjs`. A new suite is picked up by existing, and
there is no list to forget to add it to. That is the same reason the catalog is
generated and the record schema is gate-checked against its source.

A gate that cannot run says so and is counted as skipped, never as passed. The
three that need the viewer's toolchain skip with `nexus/node_modules absent —
run npm ci --prefix nexus`, because a suite that quietly stops covering
something is worse than one that fails.

## Writing a suite for a new verb

Name the files and they are found: `commands/<verb>.test.mjs`, and
`commands/<verb>.self-test.mjs` beside it. Copy the shape of a neighbour — a
`check` accumulator, a sandbox under `mkdtempSync`, a `MUTATIONS` list with
the four disciplines above — rather than a framework; there is none, and the
zero-dependency claim is the reason.

One rule for a suite that spawns something long-running. `view` is the only
verb that does not exit, and `qrntn.test.mjs` spawns the **dispatcher** and
signals it, so the verb is a grandchild — one process further than `p.kill`
reaches. Every outcome that test exists to catch is one where the dispatcher
ends and the verb does not, and under the self-test those are the mutations:
each one left two `view` servers reparented to init, holding a port, in pairs
twenty seconds apart. Twelve were found on one machine. Spawn with `detached:
true` so the child leads a group the grandchild inherits, and sweep the group
with `process.kill(-p.pid, 'SIGKILL')` on **every** exit path, not only the
timeout. Measured: the unfixed suite leaves two servers per self-test run; the
fixed one leaves none, with the same twelve mutations caught.

## Reproducing a pull request's CI locally

| CI job | locally |
|---|---|
| `node 20 / 22 / 24` | `npm test` — with `nvm use` for each rung; the floor is what `engines` declares |
| `viewer` | `npm test` with `nexus/node_modules` present — a local run is the superset of this job and the matrix |
| `tarball` | `npm pack --dry-run` |
| `changelog` | the script is inline in `check.yml`; run it against `git diff --name-only origin/main...HEAD` |

The changelog gate derives "shipped code" from the `.mjs` entries in `files`,
so a change to a suite, a workflow, or `dev.sh` needs no entry — and should not
get one. A README edit is not a behaviour change, and a gate that makes it
pretend to be one becomes noise the next person adds a bypass for.

`gh pr checks <n>` reads the remote result; `gh pr checks <n> --watch` waits
for it. A full run is ten to twelve minutes, almost all of it the mutation
self-tests.

## The question only `smoke` can answer

Everything above runs out of the checkout, where every file exists whether or
not `package.json` says it ships. `smoke.mjs` reduces the tree to what `npm
pack` produces, installs it into a directory that has never seen this project
with `HOME` pointed somewhere empty, and drives every verb from there.

So a file missing from the `files` allowlist passes every other gate in the
project and is broken for everyone who installs. The development loop above is
symlinked and therefore blind to it by construction. This is the only thing that
looks. `node smoke.mjs --keep` leaves the sandbox behind to inspect.

## Packing

`view/` is gitignored, listed in `files`, and built at publish time — a
generated file that is committed is a file that drifts. The cost was a footgun:
`npm pack` on a checkout where the bundle was never built produces a tarball
whose `view` verb refuses as a packaging fault, and nothing said so until
someone installed it.

`prepack.mjs` closes it — the build is a step npm takes rather than a step a
person remembers, and `npm pack --dry-run` takes it too. It **skips rather than
refuses** when `nexus/node_modules` is absent, and says which happened:
`smoke.mjs` asserts both the with-bundle and the without-bundle case and
decides which by the tree, so refusing would delete half that coverage, and npm
runs `prepack` for git dependencies too, where the toolchain cannot be made to
exist.
