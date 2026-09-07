# pratiq

**`pratiq` records and gates a human decision about a skill before it is allowed
to load.**

An agent skill is a folder with a `SKILL.md` in it — instructions that Claude
Code, Codex, Cursor, Copilot, Gemini CLI and around forty other products read
straight into an agent's context. Installing one is closer to hiring than to
adding a dependency: the text becomes instructions before any code runs.

`pratiq` is a local, dependency-free command-line tool for taking those in,
auditing them, deciding about them, and keeping the decision. It ships with a
browser-based graph viewer that shows the whole library at once — every skill,
where it came from, what the audit found, whether it has ever fired, whether its
upstream has moved.

## It is not a scanner

Scanners exist. Cisco, NVIDIA, Socket, Snyk and VirusTotal all ship one, along
with eight open-source projects, and every one of them has been bypassed on
record. `pratiq` has a scanner inside it, and that is not the claim.

The claim is that **a human decision is recorded against specific bytes, and a
gate enforces that decision without being able to be argued with.** Nothing is
adopted because an agent concluded it looked fine. The closest thing in any
ecosystem is Mozilla's `cargo-vet` for Rust crates: in-tree audit records, named
criteria, a tool that certifies and never edits.

Put plainly: before a skill you downloaded from a stranger runs inside your
agent, someone has to have actually read it. `pratiq` turns that reading into a
permanent record tied to specific bytes, and refuses to install anything that
does not have one.

## The lifecycle

| Stage | What happens |
|---|---|
| **intake** | fetch from a link at a pinned commit, *without reading it*, into quarantine |
| **audit** | scan every file as data; a human adjudicates every finding; report only, never edit |
| **adopt / decline / refuse** | the human decides. A declined or refused skill keeps a permanent row, so it is never re-audited from nothing |
| **promote** | a script re-scans and moves it into the library — or refuses |
| **ledger** | one machine-written record per held skill: origin, hashes, audit verdict, contract, install, usage |
| **refresh** | re-diff the pinned commit against upstream; report drift, never move the pin |
| **usage** | count what actually fired, from local transcripts, reading no message text |
| **view** | the graph, served locally against any skill library |

```
npx pratiq intake https://github.com/someone/skills/tree/main/foo
npx pratiq audit foo
npx pratiq adopt foo --decline "does three things, two of them badly"
npx pratiq promote foo
npx pratiq refresh
npx pratiq view
```

## The principles it is built on

- **Fetch blind.** Never read what you fetch. An agent that has read the payload
  before the payload was scanned has already lost, and no later gate recovers it.
- **The record makes the decision checkable** — by someone who was not there.
- **The gate cannot be reasoned with.** It is a script, not a sentence in a
  prompt, because the material being processed is untrusted text written to be
  read as instructions.
- **Declining is a success.** A refused skill with a written reason is a finished
  piece of work, not a failure.
- **Nothing leaves the machine.** Two commands reach the network — `intake` and
  `refresh` — and both only to a source you already named. Usage counting reads
  local transcripts and never message text.

## Where the code lives

`commands/` holds the pipeline — intake, audit, promote, overlap, ledger,
refresh, usage and the catalog check — with every test and mutation self-test
beside the script it covers. `nexus/` is the viewer. `check.mjs` runs the lot.

It was written inside the skill library it was built for, and moved out of it,
in that order and deliberately: co-locating a tool with its only consumer is how
you never discover what the tool assumes about its host. Those assumptions were
measured before the move rather than guessed at after it —
[`docs/PORTABILITY.md`](docs/PORTABILITY.md) is the table of what each command
required of the tree it ran in, and [`docs/SURFACE.md`](docs/SURFACE.md) is what
each command does about it.

The finding that shaped the result: six of seven commands resolved their library
from their own file location, so they could only ever act on the tree they lived
in. They now take it from `--library`, then `SKILL_LIBRARY`, then the working
directory — named, or the place you are standing, never inferred from where the
tool happens to be installed.

## Status

**Nothing is published.** There is no npm package, no release and no
installation instruction that works yet. The pipeline runs here, on this
library, and the work of making it run on anyone else's is scheduled, scoped and
partly measured. The name was chosen on 2026-09-07 and is recorded in SK-90.

## The name

*Free pratique* is the clearance a ship is granted after inspection — entered in
its papers, without which nobody boards and nobody disembarks. A vessel
requesting it flies signal flag Q, a plain yellow rectangle with nothing on it.

It is a recorded permission against a specific arrival, which is the whole tool
in one word. It is pronounced *prah-teek*, and yes, you have to be told that.
