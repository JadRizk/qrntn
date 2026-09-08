# What every command assumes about its host

> **Written before the split, and left as written.** This document was produced
> inside the skill library `qrntn` was built in, and every "this repository" and
> `plan/…` path below refers to *that* library, not to this one. It is a record
> of what was measured on a date, not a description of the code as it stands —
> the findings it lists are the reason the code changed, and editing it to match
> the result would destroy the only evidence that the result was earned.

SK-86. Measured 2026-09-06 against a foreign skill library — a git repository
containing `skills/tidy-notes/SKILL.md`, an empty `inbox/`, a `scripts/`
directory and nothing else. No `ledger/`, no `catalog.json`, no `edges.json`,
no `plan/`, no `.claude-plugin/`.

This document is deliberately not in `plan/reports/`. Reports are retired when
their ticket is accepted, and SK-97 — the split — depends on this surviving.

## The two structural findings

**Six of seven commands resolve their root from `import.meta.url`, not from an
argument and not from the working directory.** Only `audit` takes a target
path. This was demonstrated rather than inferred: `refresh` and `check-catalog`
were executed with the working directory set to the foreign repository, and
both reported on *this* repository's skills. A command cannot be pointed at
another tree; it can only be copied into one.

That property is deliberate and is relied on — `check-catalog.mjs`'s header
says a copy dropped into a fixture repo checks that fixture, and
`promote.test.mjs` depends on it. It is the right design for a script that
ships *inside* the thing it checks. It is the wrong design for a tool a
stranger installs and points at their own library, which is what SK-97 makes
this become.

**Three of seven cannot be copied at all without a sibling.** `promote`,
`usage` and `refresh` import `ledger.mjs`. `promote` reaches up three levels
for it — `../../../scripts/ledger.mjs` — so `skill-adopt` is not a portable
skill but a repo-coupled one, despite being published in this repository's own
plugin manifest. Installed anywhere else, its `promote.mjs` cannot start.

In every one of those three cases the failure is a raw Node
`ERR_MODULE_NOT_FOUND` stack trace, not a named refusal. Every other refusal
surface in this repository is careful about this; these three are not, because
nothing has ever run them where the sibling was missing.

## The table

| Command | Root from | Self-contained | Requires of the tree | Run in a foreign library |
|---|---|---|---|---|
| `intake` | own file location | yes | `inbox/`, and the network to fetch | **Refuses cleanly.** `refused: usage: intake.mjs <source> …` with no arguments; `refused: could not fetch HEAD from …` with an unreachable source. Does not create `inbox/` until it has something to put in it |
| `audit` | **argv — the target is passed in** | yes | nothing but the directory it is given | **Works.** Audited the foreign skill correctly and reported no findings. The only command already designed for a tree that is not this one |
| `adopt` (`overlap.mjs`) | own file location | yes | `skills/*/SKILL.md`; `edges.json` optional | **Works, degrades correctly.** Ranked the foreign library's skills and reported no declared edges rather than failing on the absent `edges.json` |
| `promote` | own file location | **no** — `../../../scripts/ledger.mjs` | `inbox/<name>`, `skills/`, `catalog.json`, `scripts/check-catalog.mjs`, `skills/skill-audit/scripts/audit-skill.mjs` | **Crashes.** `ERR_MODULE_NOT_FOUND` before any of its own checks run. Not a refusal — a stack trace |
| `refresh` | own file location | **no** — `./ledger.mjs` | `skills/`, `ledger/<name>.json` with `origin.source`, and the network | **Crashes** when copied without its sibling. Run from a foreign working directory, it silently refreshed *this* repository instead |
| `usage` | own file location | **no** — `./ledger.mjs` | `skills/`, `ledger/`, `~/.claude` transcripts | **Crashes.** `ERR_MODULE_NOT_FOUND` |
| `check` | own file location | as a file yes; as a command **no** | `skills/`, and every sibling its gates spawn: `check-catalog.mjs`, `ledger.mjs`, `manifest.mjs`, `plan/next.mjs`, `nexus/` | **Runs, 4/8.** Degrades correctly where it was written to (`no plan/next.mjs`, empty `inbox/`); hard-fails on `catalog`, `ledger`, `manifest` and `exemptions`; surfaces missing siblings as raw `MODULE_NOT_FOUND` traces inside gate output |

## Assumptions recorded, not fixed

Per SK-86's third criterion, the list is the deliverable. Changing the code to
need less is downstream work with its own evidence. Four findings are worth
carrying into SK-97 specifically:

1. **`skill-adopt` is published but not portable.** It is in this repository's
   plugin manifest and its `promote.mjs` cannot start outside this tree. Either
   the import is removed, or the skill is honest that it is repo-coupled.

2. **The `exemptions` gate is hardcoded to this repository.** `SELF_MATCH` in
   `check.mjs` names `skill-audit`'s four self-matching files by path. In a
   foreign library the gate fails and advises the reader to "re-sign the list
   or drop the entry" — advice that means nothing there. An exemption list is
   per-library data, not tool source.

3. **Absent siblings produce stack traces, not refusals.** Three commands and
   several `check` gates fail this way. A tool a stranger runs first should
   name what it wanted and where it looked.

4. **`refresh` acting on the wrong repository is silent.** Run from anywhere,
   it refreshes the tree it lives in and says nothing about which tree that
   was. During this ticket's own experiment it refreshed this repository by
   accident, wrote ten ledger entries, and the only reason that was noticed is
   that someone read `git status` afterwards. Committed separately as
   `43c7a2d`.

## What was not exercised

`intake`'s successful path. It refuses correctly on a bad source, which
establishes that it parses arguments and reaches its own error handling in a
foreign tree, but no real fetch was performed and no artefact was placed in a
foreign `inbox/`. The network path is therefore untested outside this
repository.
