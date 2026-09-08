# What a transcript can and cannot prove

Reference for `scripts/usage.mjs`. Where a question came back negative, the
negative is recorded here so nobody derives it twice.

**Every number below is a reading taken on 2026-08-24**, against 312 transcript
files holding 112 Skill invocations and spanning 2026-06-08 to 2026-08-24. They
are dated observations, not live facts, and they will drift — deliberately not
restated by hand anywhere that matters. The current figures come from
`ledger/usage.json`: `corpus.spanDays` is the depth, and each window carries
`reachesBeforeCorpus`. What does not drift is the *conclusions*, which is what
this document is for.

Read this before drawing a conclusion from `ledger/usage.json`, and especially
before deleting a skill on the strength of a zero.

---

## The one thing that is derivable

**That a skill was invoked, and when.** A `tool_use` block whose `name` is
`"Skill"` carries `input.skill`, and its record carries a `timestamp`. That is
the measurement, and it is a good one: it is exact, it is per-invocation, and it
cannot be confused with a mention in prose.

Everything in the ledger is a count of those blocks. Nothing else.

## What is not derivable, and why

### Who initiated an invocation

**Not separable. This is the headline negative result.**

`caller.type` looked like the field for it. It is not:

| Field | Distinct values across 112 invocations |
|---|---|
| `caller.type` | `"direct"` — 112 of 112 |

A field with one value across the whole corpus carries no information. It does
not separate a model's own decision to invoke from a person typing the name.

The candidate signal named in SK-11 was a `<command-name>` element in the user
message preceding the invocation. It was tested in both directions and fails
both:

**Forwards** — of 112 invocations, the number with a `<command-name>` anywhere
in the preceding three records: **0**. Widened to the whole file, 50 invocations
share a file with some `<command-name>`, but the nearest preceding one names the
skill actually invoked in **1** case.

**Backwards** — for the two names that appear both as a typed command and as an
invoked skill:

| Typed | Times typed | Followed anywhere in the same file by a matching invocation |
|---|---|---|
| `/review-like-tech-lead` | 3 | 0 |
| `/ship-ticket` | 1 | 1 |
| `/loop` | 21 | 0 |
| `/plan-task` | 14 | 0 |

The two mechanisms are very nearly disjoint. Of 11 distinct `<command-name>`
values seen, 9 are not skills at all — `/exit`, `/model`, `/clear`, `/login`,
`/mcp` are CLI commands, `/plan-task` and `/loop` are project slash commands.
Meanwhile `review-like-tech-lead` was invoked 8 times as a skill and typed 3
times, and none of the 8 lines up with any of the 3.

So `<command-name>` is neither necessary nor sufficient. **It is not
implemented, and it should not be attempted again on this evidence.**

There is a corollary worth stating plainly, because it is a risk rather than a
proven fact: if typing `/<skill>` does not reliably produce a `Skill` tool_use
record, then user-typed invocations are partly **invisible** to this counter,
and the ledger under-counts by an unknown amount. On this corpus a typed command
naming a skill was followed by a matching invocation in 1 case out of 4. That is
too few to quantify the gap and too many to dismiss it.

### Whether a skill was useful

Never derivable from here, and worth saying out loud because the ledger will be
used to argue about it. An invocation is not a success. A skill invoked ten
times and abandoned nine reads exactly like one invoked ten times and relied on.

### Anything about a session that is not on this machine

Cloud sessions, another laptop, and — as far as this has been tested — sub-agent
invocations do not appear. The counter reads one directory on one disk.

---

## The retention window

**Counts are a sample, not a history.**

| | |
|---|---|
| Oldest record | 2026-06-08 |
| Newest record | 2026-08-24 |
| Span | 77 days |
| Files | 312 |

Records by month: June 2,431 · July 37,151 · August 41,622. June is thin. That
is consistent either with less use or with pruning at the far end, and this data
cannot tell those apart — so no retention *policy* is claimed here, only the
observed depth.

The consequence is concrete and it changes how the ledger reads:

**`d90` is not a 90-day figure on this machine.** The window starts before the
transcripts do, so `d90` equals all-time — 112 either way. A skill showing zero
in `d90` has not been quiet for ninety days; it has been quiet for as long as
there is data, which is 77 days.

This is why every window in the ledger carries `reachesBeforeCorpus`, why
`corpus.spanDays` sits next to the counts, and why the CLI prints a line about
it on any run where it is true. A window deeper than its data is the commonest
way to misread this output.

---

## Why the field names are what they are

SK-11 required that names describe the measurement rather than the hoped-for
meaning. Two consequences in `ledger/usage.json`:

- Counts live under **`invocations`**, never `autoFires`, `modelFired` or
  `userTyped`. Those three would each be a claim this data cannot support.
- **`lastInvoked`**, not `lastFired`. "Fired" is the verb that quietly implies
  the model chose to fire it — the same hoped-for meaning, one word shorter.

The ledger also carries a `measures` block stating the unit, the definition and
what cannot be distinguished, so a consumer reading the JSON alone still gets
the caveat. A file that has to be read alongside a document to avoid being
misread will eventually be read alone.
