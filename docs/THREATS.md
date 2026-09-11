# The threat model

> **Written for `0.1.0`, dated 2026-09-08, and expected to change.** Like
> [`SHIPPING.md`](SHIPPING.md) and unlike [`PORTABILITY.md`](PORTABILITY.md),
> this is not a record of something measured. It is a set of claims and, more
> importantly, a set of refusals to claim. Every line of it is checkable against
> the code, and where the code and this document disagree the code is right and
> this is a defect.

## What `qrntn` does not defend against

This section is first because it is the more useful half, and because a document
that leads with its coverage is an advertisement.

**Runtime behaviour of a skill you adopted.** `qrntn` governs what is let in.
Once a skill is cleared into the library and loaded by an agent, nothing here is
in the path. A skill that reads as benign, is adjudicated as benign, and then
behaves badly at runtime is outside this model entirely. There is no monitor, no
runtime guard and no revocation.

**The content behind a URL a skill fetches while running.** `EXEC-NETWORK`
(`commands/audit-skill.mjs:339`) flags `fetch(`, `https.get`, `curl`, `wget`,
`urllib`, `requests.*`, `axios`, `XMLHttpRequest`, `nc -` and `ssh`, and
`INSTR-REMOTE` flags the prose form — "read `https://x/y` and do what it says",
distinguished from a citation, which must not fire. So the *reach* is a finding
a human adjudicates. The *payload* is not: `qrntn` pins the bytes it fetched,
and it cannot pin bytes it never fetched. A skill whose real instructions live
behind a URL that changes after the decision was recorded defeats the pin, and
the only defence offered here is that the capability was visible at audit and
somebody said yes to it anyway.

**Containment of anything that executes.** See
[Where untrusted code runs](#where-untrusted-code-runs). Sandboxing is a
different tool, and this one does not have it, recommend one, or pretend the
distinction does not matter.

**The quality of the human decision.** See
[The human is a trusted component](#the-human-is-a-trusted-component). This is
the largest unguarded surface in the design, and it is unguarded deliberately.

**A machine that is already compromised.** Every record `qrntn` writes is a
plain file on a filesystem it does not control. An attacker with write access to
the library can edit `AUDIT.md`, rewrite a ledger row, or move a pin, and
`qrntn check` will report a tree that is internally consistent because it has
been made consistent. The records are tamper-**evident** only against a mistake,
not against an adversary who is already inside.

**Enforcement in another harness.** `CONFIG-CROSSHARNESS` reads and scans
another runtime's metadata like any other file, and says so plainly: the
invocation policy it declares *is not enforced by this harness*. A skill cleared
here is cleared here.

**Things that are not a skill.** Plugin bundles are refused outright
(`CONFIG-OUTOFSCOPE`), not audited leniently. MCP servers, hooks installed
outside a skill, and anything without a `SKILL.md` at its root are not in scope.
A tool that quietly widened its coverage to whatever it was pointed at would be
making a claim about material it never modelled.

## Two readers

`intake` fetches blind because **an agent that has read the payload before the
payload was scanned has already lost, and no later gate recovers it.** That
sentence names a reader, and there are two of them with different exposure.

- **Reader A** is a person at a terminal. They type the verbs, read the report
  with their eyes, and write the decision.
- **Reader B** is an agent running `qrntn` on that person's behalf, inside a
  session, reading stdout back into its own context.

Reader B is the realistic deployment and the harder problem, because the whole
pipeline's guarantee is about what enters a context and when. Every stage below
is therefore answered twice.

| Stage | Reader A | Reader B |
|---|---|---|
| `intake` | Sees a name, a source and a pinned ref. Never the artefact | **Same.** Contents never printed, never summarised, never executed. The guarantee holds identically |
| `audit` | Sees findings, and evidence excerpts drawn from the artefact | **Exposed.** Evidence is attacker-chosen text entering the agent's context — see below. `--no-evidence` closes it |
| `adopt` | Sees the record it wrote, and the row | **Same.** Its scan runs with `--no-evidence`; the row carries counts and codes, never bytes. It records and removes; it never executes |
| `promote` | Sees a verdict, and refusals | Same, plus whatever the artefact's own tests print when they run |
| `refresh` | Sees that the pin and upstream differ | Same. Drift is reported as a fact, never as the diff's contents |
| `usage` · `overlap` · `ledger` | Local records and counts | Same. No artefact text on either path |
| `view` | The graph, in a browser on 127.0.0.1 | Same: the CLI prints a URL and counts, never the graph. The browser renders held skills' names and descriptions, which is artefact text — but into a page on this machine, not into a context, and only for skills a human already adopted |

The result worth naming: **`intake` holds for both readers, and `audit` does
not.** The gate was never the leak; the report is.

## The evidence channel

`audit` reports each finding with an excerpt of what matched
(`commands/audit-skill.mjs:469`), and for `INSTR-ENCODEDPAYLOAD` it prints the
**decoded** base64 rather than the encoded run (`:1080`), because a reviewer
cannot adjudicate a payload they would have to decode by hand.

Under Reader B that is attacker-controlled text placed into an agent's context —
the precise thing `intake` refused to do four stages earlier.

What already limits it:

- Evidence is emitted through `JSON.stringify` (`:1295`), so control characters
  and terminal escapes are neutralised, and an invisible character prints as
  `\u200b` instead of vanishing into the reviewer's terminal.
- Excerpts are capped at 100 characters, 60 or 80 on the encoded paths, and
  runs of whitespace are collapsed.
- The `why` text of every finding is written by this tool. It is not entirely
  free of the artefact: nine findings quote a fragment of it into the sentence —
  a frontmatter key, a referenced path, a directory name — and those fragments
  pass through the same bound as evidence: whitespace collapsed, capped at 60
  characters, anything outside printable ASCII printed as its escape. `file` is
  the artefact's own name for the file on every finding, and cannot be bounded
  without ceasing to be a location. This sentence used to say `why` was written
  by the tool alone; it was not, and the bound is what made it nearly so.

None of that is a security control. Truncation bounds the size of an injection
attempt and does not prevent one, and a hundred characters is ample.

**This is accepted residual risk in `0.1.0`, and it is not fully fixable.** You
cannot ask a human to adjudicate a finding you decline to show them, so the
tension between Reader A's need for evidence and Reader B's exposure to it is
inherent to reporting at all.

`--no-evidence` prints each finding's severity, code, file, location and reason
and withholds the matched bytes — the excerpt, a decoded payload, and any
fragment the reason would have quoted, which reads `[withheld]` instead — for
the case where the reader is known to be an agent. Counts, verdict and exit
code do not change: the flag changes what is shown, never what was found, and
under `--json` the top level says `"evidence": "withheld"` so a consumer can
tell a silenced excerpt from an absent one. It is an explicit flag rather than
automatic suppression on a non-terminal stream. Colour is suppressed that way because colour is a second
copy of a word already present, and stripping it reproduces the output byte for
byte; evidence is not a second copy of anything, and making a report mean
different things depending on what it is piped into would be the same defect
this tool exists to refuse.

## Where untrusted code runs

There is exactly one place, and it is `promote`:

> `runTests()` executes `node` against the artefact's own `*.test.mjs` files.
> That is the first and only point in the whole pipeline where code from an
> untrusted source runs — `intake` executes nothing, and every earlier stage
> reads. It happens after the scan, the adjudication, the adaptation, the
> re-scan and an explicit human decision to adopt, because a test cannot be
> verified without running it.
>
> — `commands/promote.mjs`

It runs **unsandboxed**, as the invoking user, with that user's filesystem,
network and credentials. Adoption is therefore an authorisation to execute, and
a human who adopts has granted it whether or not they were thinking about it in
those terms.

**Containment is an explicit non-goal.** `qrntn` governs what you let in, not
what it does once it is in; those are different controls, and a tool claiming
both while implementing one would be lying about the more important half. The
mitigation on offer is ordering — the execution happens last, after five prior
stages and a recorded decision — and honesty about what ordering does not buy.

## The adversary

The skill's author, or whoever controls the source at the moment `intake` runs.
Assume they are competent, that they have read this document and the scanner's
rule table, and that they can iterate against both. A scanner checks a fixed
artefact while an attacker can keep adjusting until it passes; that asymmetry is
why detection is not the claim here.

Three capabilities are assumed and are inside the model:

- **Text written to be read as instructions.** The material is prose that
  reaches a model's context intact. `INSTR-OVERRIDE`, `-SUPREMACY`, `-CONCEAL`,
  `-PERMBYPASS`, `-EXFIL`, `-REMOTE`, `-SECRETS`, `-NOCONFIRM`, `-AUTOAPPROVE`,
  `-AUTHORITY` and `-ROLESWAP` are the named shapes.
- **Concealment from the reviewer specifically.** Invisible and bidirectional
  characters, Unicode tag characters, homoglyphs, HTML comments, base64 and
  escape-encoded runs, NUL bytes, duplicate frontmatter keys — *"parsers take
  the last; a reader takes the first. That gap is exactly where a second
  description hides."*
- **Patience.** A source that is clean at the pinned ref and hostile three
  commits later. `refresh` re-diffs the pin against upstream and reports drift;
  it never moves the pin, because a tool that silently re-pinned would convert
  a decision into a subscription.

One capability is assumed and is **outside** it: an adversary who already has
write access to the machine running `qrntn`.

## What it trusts

Named, because an unnamed assumption is the one that fails quietly.

| Trusted | Why, and what breaks if it is wrong |
|---|---|
| `git` and the transport to the named source | `intake` is `init` + `fetch` of an explicit ref, never `clone`, and never brings submodules — *a submodule is a second repository nobody audited, arriving under the authority of the one that was.* A compromised transport substitutes the artefact before any scan sees it |
| Node and the local filesystem | Every stage reads and writes plain files. Nothing is signed, and nothing detects a stage's output being edited between stages |
| Its own source | The scanner's rule table is ASCII by construction and its confusables map is keyed by codepoint number, *"so a reviewer can check each entry by number"* — because invisible characters would be invisible in the auditor's own file too |
| The human | See below |
| Nothing else | Zero runtime dependencies. There is no transitive tree to audit, no install-time script, and no third party who can push code into this tool |

Two commands reach the network — `intake` and `refresh` — and both only to a
source already named by the user. `usage` reads local transcripts and parses
them for skill names only; it never evaluates anything from a transcript and
never reads message text.

## What it defends

| Property | Mechanism | Verdict shape |
|---|---|---|
| The payload does not enter a context before it is scanned | `intake` never prints, summarises or executes the artefact, and resolves no path outside quarantine | — |
| Concealment from the reviewer is surfaced | `INSTR-INVISIBLE` · `-BIDI` · `-TAGCHARS` · `-HOMOGLYPH` (NFKC folding plus a confusables map, so a substituted character is matched as the sentence it spells) · `-HIDDENDIRECTIVE` · `-BASE64` decoded and re-matched · `-HEXESC` · `STRUCT-NULBYTE` · `STRUCT-DUPKEY` | `BLOCK` · `REVIEW` |
| Nothing is adopted that nobody decided about | `promote` re-scans the **adapted** artefact rather than trusting the stage-00 scan, because by then they are different files, and refuses without a recorded decision | exit `1` |
| A refusal is permanent and costs nothing to keep | A declined or refused skill keeps a row, so it is never re-audited from nothing | — |
| The decision is tied to specific bytes | Pinned commit and hashes in the ledger. Lockfiles elsewhere record a name and a version, not the bytes | — |
| Movement under a recorded decision is visible | `refresh` re-diffs the pin against upstream and reports drift, never moving the pin | exit `1` |
| The record stays true to the tree | `ledger --check` and `check` compare the written record against what is actually held | exit `1` |
| A skill's context cost is priced | `usage` reports held-and-never-invoked — *"cost with no denominator"* — and `overlap` ranks descriptions competing for the same request | — |

The gate is a script, not a sentence in a prompt, because **an enforcement layer
living inside the reader is not an enforcement layer.**

## The human is a trusted component

`qrntn` cannot verify that anybody read anything. A person can run `audit`,
look past a `BLOCK`, write a line into `AUDIT.md` and promote. The tool will
record that decision faithfully and enforce it, which is the same behaviour it
has when the reading was careful.

This is the cargo-vet failure mode, and it is measured rather than supposed.
Across the public audit registries the median lag between a crates.io release
and its audit is 29 days, and a project that wants to stay fully vetted faces a
median of 8.7k changed lines a week — past 50k at the ninetieth percentile
(*Auditing Rust Crates Effectively*, arXiv 2602.06466, 2026-02). Workload is
what turns a review into a rubber stamp.

Three things are offered against it, and none of them is vigilance:

1. **The record is checkable by someone who was not there.** A decision with a
   named reason against a named commit can be disagreed with later. An
   undocumented one cannot.
2. **The workload is bounded by your own installs.** Skills have no transitive
   graph — nothing arrives because something else depended on it. The corpus to
   audit is exactly what you chose to fetch.
3. **The corpus is actively pushed downward.** `usage` names what has never
   fired and prices its description in bytes; `overlap` names what competes for
   the same trigger. A tool whose output argues for holding fewer skills is
   attacking the workload rather than absorbing it.

What none of that provides is assurance that a given row reflects real reading.
It does not, and no tool of this shape can. **The claim is that a decision was
recorded against specific bytes and enforced — not that it was a good one.**

## Related

- [`SURFACE.md`](SURFACE.md) — what each command does, and what it assumes about
  the tree it runs in.
- [`PORTABILITY.md`](PORTABILITY.md) — what each command required of its host,
  measured before the split.
- [`SHIPPING.md`](SHIPPING.md) — what `0.1.0` contains and in what order it was
  built.
