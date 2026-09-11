# Developing

Three things, in the order you need them: a loop that is fast enough to use on
every change, a table saying which gate answers which question, and the one
question no gate but the last can answer.

## The loop

```sh
source dev.sh
```

Sourced, not executed — the point is what it leaves behind in the shell you are
standing in, and `./dev.sh` would set three variables, exit, and leave you where
you started. It refuses if you try.

What you get:

| | |
|---|---|
| `qrntn <verb>` | the real binary, run from a symlinked install |
| `qrntn-real <verb>` | the same, against your real `HOME` |
| `qrntn-lib-reset [names…]` | throw the library away and build a new one |
| `qrntn-relink` | rebuild the symlinked install |
| `qrntn-env` | what is set, and against what |
| `qrntn-off` | put the shell back |

`npm install <path>` symlinks a local directory rather than copying it, so the
binary in the sandbox **is** this checkout: edit `commands/adopt.mjs`, run
`qrntn adopt`, see the change. Nothing is re-packed, and nothing is rebuilt —
`view/` is the only build output, and only the viewer needs it.

`SKILL_LIBRARY` is set, so `--library` is optional on every verb. The library it
points at is a throwaway outside the repository, and `qrntn-lib-reset` is the
important verb in that table: half the pipeline mutates the library on purpose
— `promote` moves a directory, `adopt` ends a quarantine — so what you want is
not a library you keep clean but one you can discard mid-experiment.

`HOME` is **not** exported. The smoke gate points it at an empty directory
because `promote.test.mjs` once passed twice on a borrowed
`~/.claude/skills/skill-audit` that happened to be installed on the machine, and
only failed when that install disappeared mid-session. The same protection is
wanted in the loop, but exporting `HOME` into an interactive shell breaks git,
npm and ssh. So a shim on `PATH` overrides it per invocation and nothing else
does. **`qrntn-real` is the same shim without the override** — how you test the
install path on purpose.

The shim `exec`s rather than wrapping, and it is a script rather than a shell
function, for the sake of the one verb that does not exit: `qrntn view &` then
`kill -INT $!` has to reach the dispatcher, and through a backgrounded function
it reaches a forked shell that ignores it instead.

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

## The gates

| when | command | what it costs |
|---|---|---|
| changed one command | `node commands/<name>.test.mjs` | seconds |
| before a commit | `npm run test:quick` | ~1 min · 17 gates |
| touched what ships | `npm run smoke` | packs and installs |
| before publishing | `npm test` | minutes · everything |

`npm run gates` names them without running them, which is the honest way to see
what `--quick` is skipping.

Suites are **discovered, not listed** — `check.mjs` reads `commands/` for
`*.test.mjs` and `*.self-test.mjs`. A new suite is picked up by existing, and
there is no list to forget to add it to. That is the same reason the catalog is
generated and the record schema is gate-checked against its source.

A gate that cannot run says so and is counted as skipped, never as passed. The
three that need the viewer's toolchain skip with `nexus/node_modules absent —
run npm ci --prefix nexus`, because a suite that quietly stops covering
something is worse than one that fails.

## The question only `smoke` can answer

Everything above runs out of the checkout, where every file exists whether or
not `package.json` says it ships. `smoke.mjs` reduces the tree to what `npm
pack` produces, installs it into a directory that has never seen this project
with `HOME` pointed somewhere empty, and drives every verb from there.

So a file missing from the `files` allowlist passes every other gate in the
project and is broken for everyone who installs. The development loop above is
symlinked and therefore blind to it by construction. This is the only thing that
looks.

## Packing

`view/` is gitignored, listed in `files`, and built at publish time — a
generated file that is committed is a file that drifts. The cost was a footgun:
`npm pack` on a checkout where the bundle was never built produces a tarball
whose `view` verb refuses as a packaging fault, and nothing said so until
someone installed it.

`prepack.mjs` closes it — the build is a step npm takes rather than a step a
person remembers. It **skips rather than refuses** when `nexus/node_modules` is
absent, and says which happened: `smoke.mjs` asserts both the with-bundle and
the without-bundle case and decides which by the tree, so refusing would delete
half that coverage, and npm runs `prepack` for git dependencies too, where the
toolchain cannot be made to exist.
