# The command surface, and what the CLI owes each script

> **Written before the split, and left as written.** This document was produced
> inside the skill library `pratiq` was built in, and every "this repository" and
> `plan/…` path below refers to *that* library, not to this one. It is a record
> of what was measured on a date, not a description of the code as it stands —
> the findings it lists are the reason the code changed, and editing it to match
> the result would destroy the only evidence that the result was earned.

SK-90, decided 2026-09-07. This sits on top of [`PORTABILITY.md`](PORTABILITY.md)
(SK-86): that document measured what each command assumes about its host; this
one decides what the CLI does about it, per command.

Like `PORTABILITY.md`, this is deliberately not in `plan/reports/`. SK-97 — the
split — is the ticket that executes this table, and it needs to survive SK-90
being accepted.

## The rule the table is answering

SK-90 asks, for each command, whether the CLI **wraps** an existing script or
**reimplements** it, "because *wraps* is a promise that the two cannot drift."

Taken literally that promise has a precondition: a wrap is only honest when
there is exactly one implementation and the wrapper invokes *it* — not a copy,
not a port, not a second file that happens to agree today. So three rows below
read **wrap, blocked on …** rather than **wrap**. A promise with an unmet
precondition is not yet a promise, and writing it as one is how the two copies
get made.

The other axis is the one `PORTABILITY.md` found: **six of seven commands
resolve their root from `import.meta.url`.** They are built to ship *inside* the
library they act on. A tool a stranger installs with `npx` and points at their
own library needs the root to come from an argument or the working directory.
That is a behavioural change, not a packaging one, so no command in this table
is a pure wrap except the one that already takes its target as an argument.

## The surface

Eight commands are named by SK-90. Three more exist in the tree and are decided
here so the list is complete rather than convenient.

| Command | What it does | Decision | Why this and not the other |
|---|---|---|---|
| `intake <source>` | fetch at a pinned ref into quarantine, without reading it | **wrap** `skill-intake/scripts/intake.mjs` | Self-contained, already takes its source from argv, and already refuses cleanly in a foreign tree. The only change it needs is where `inbox/` is — a library root, passed in. Nothing about the fetch discipline should be re-typed: the value is in what it refuses to do |
| `audit <path>` | scan every file as data; report, never edit | **wrap** `skill-audit/scripts/audit-skill.mjs` | The one pure wrap in the table. It is the only command that already takes its target as an argument and assumes nothing about the tree around it. 1,242 lines of pattern tables and adjudication rules that no one should ever fork |
| `adopt <name>` | record the human decision — adopted, declined, or refused | **reimplement — it does not exist yet** | `PORTABILITY.md` lists `adopt` as `overlap.mjs`, but overlap is a *measurement*, not the decision. The decision is a person writing dispositions into `AUDIT.md` and a permanent row into `REJECTED.md` by hand. The lifecycle's central verb has no command; naming the surface is what exposed that |
| `promote <name>` | re-scan and move it into the library, or refuse | **wrap, blocked on** the `../../../scripts/ledger.mjs` import | This is the gate. Two implementations of the gate is precisely the failure the "cannot drift" clause exists to prevent, so reimplementation is not available. But today it reaches three levels up for a sibling and dies with `ERR_MODULE_NOT_FOUND` before its own checks run (`PORTABILITY.md` finding 1). The coupling is cut in SK-97, then this is a wrap |
| `refresh [name]` | re-diff the pin against upstream; report drift, never move the pin | **wrap, blocked on** an explicit root | Same import problem, plus the worse one: run from any working directory it refreshes the tree it *lives in* and says nothing about which tree that was — it did exactly that during SK-86's own experiment and wrote ten ledger entries by accident (finding 4). Wrapping a command that silently acts on the wrong library ships the bug with a nicer name on it |
| `usage` | count what actually fired, from local transcripts | **wrap, blocked on** the `./ledger.mjs` import | Reads `~/.claude` transcripts, so the *interesting* half is already host-relative and portable. Only the ledger write needs a root. 774 lines whose whole point is what they decline to read; re-typing that is how the privacy property gets lost |
| `check` | is this library internally consistent | **reimplement** | `scripts/check.mjs` is **this repository's CI runner**, not a library check — it spawns `plan/next.mjs`, the `nexus/` workspace, the diagrams gate and the plugin-manifest gate, and in a foreign library it scores 4/8 with raw `MODULE_NOT_FOUND` traces inside gate output. `pratiq check` has to mean something a stranger can want: every held skill is filed, every declared edge resolves, every ledger entry matches the bytes on disk. Same word, different command. The repo keeps its own `check.mjs` |
| `view` | the graph, served locally | **package, not wrap** | `nexus/` is a Vite + React + three.js application. The CLI is zero-dependency plain Node and stays that way, so `view` ships a **prebuilt static bundle** and a small plain-Node static server. The user installs no build toolchain and no dependency tree; the viewer is a build artifact of the release, not something resolved on their machine |
| `overlap` | which descriptions compete for the same request | **wrap** `skill-adopt/scripts/overlap.mjs` | Self-contained, degrades correctly on an absent `edges.json`, needs only a root. It is a real command and it earns its own name — it stops being mislabelled as `adopt` |
| `ledger --check` | regenerate the derivable fields and diff them | **wrap** `scripts/ledger.mjs` | It is the schema and the only writer contract three other commands depend on. Exposed in its own right because `check` calls it and a reader who fails that gate needs to run the narrower thing |
| `manifest` | generate `.claude-plugin/plugin.json` | **does not ship** | It produces a Claude-specific artifact. `pratiq` is cross-harness — that is the argument for a CLI over a plugin in the first place — so a command that emits one harness's packaging format does not belong on its surface. It stays in this repository, which is a thing that publishes a Claude plugin. If other harnesses ever want the same treatment it returns as `pratiq export <format>`, not before |

## The drift mechanism, stated

Six rows say *wrap*, and the promise is only worth something if it is mechanical.
After SK-97 there is exactly one implementation of each command, and it lives in
`pratiq`. The three skills that ship scripts today — `skill-intake`,
`skill-audit`, `skill-adopt` — stop shipping them and cite the command instead:
their spines say `npx pratiq intake …` where they currently say
`node scripts/intake.mjs …`.

That inverts a dependency on purpose. A skill that calls `npx pratiq promote`
needs the tool present; a skill that carries `promote.mjs` and reaches
`../../../scripts/ledger.mjs` needs *this whole repository* present, which is
finding 1 of `PORTABILITY.md` and the reason `skill-adopt` is published but not
portable. `npx` resolves the first case for a stranger. Nothing resolves the
second.

## Preconditions this hands to SK-97

Three of them, all already recorded as `PORTABILITY.md` findings, now with a
consumer:

1. **Cut the `ledger.mjs` coupling** in `promote`, `refresh` and `usage`. Until
   then those three cannot be wrapped, only copied.
2. **Make the library root explicit** — an argument or the working directory,
   never `import.meta.url` — for every command except `audit`, which already
   does it right. `refresh` is the urgent one: silence here is a data-loss bug,
   not an ergonomic one.
3. **Name what was missing when a sibling is absent.** Three commands and
   several `check` gates currently answer a stranger's first run with a Node
   stack trace. Every other refusal surface in this repository is careful about
   this; these are not, because nothing had ever run them where the sibling was
   gone.

And one piece of new work that this table created rather than inherited:
**`adopt` has to be written.** It is the lifecycle's central verb, it is the
only place the human decision becomes a durable record, and today it is a
person editing two markdown files by hand.
