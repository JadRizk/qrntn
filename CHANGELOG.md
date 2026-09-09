# Changelog

Newest first. Versions are written bare here (`0.1.0`, never `v0.1.0`) per
`brand/BRAND.md`; the git tags carry the `v`, because that is what tooling
reads and the two are allowed to differ as long as it is written down.

`0.x` carries the "surface may move" signal in semver, and it means it. The
four contracts that do not move — where the library is, what a refusal is,
what leaves the machine, and what the record contains — are enumerated in the
README, and a change to any of them appears here as its own line before it
appears in a release.

A version that only refuses better still gets an entry. Declining is a success,
and a release that made a refusal clearer shipped something.

## 0.2.0 — unreleased

**`audit --no-evidence`.** Each finding keeps its severity, code, file,
location and reason; the matched bytes are withheld — the excerpt, a decoded
payload, and any fragment the reason would have quoted from the artefact, which
reads `[withheld]` instead. Counts, verdict and exit code are identical with and
without the flag. Under `--json` every finding's `evidence` is `null` and the
top level gains `"evidence": "withheld"`, so a consumer can tell a silenced
excerpt from an absent one. For the reader that is an agent: an excerpt is text
the artefact's author chose, and printing it into an agent's context is the
thing `intake` kept out of it. A flag, not a test of whether stdout is a
terminal — [`docs/THREATS.md`](docs/THREATS.md) says why.

**A quoted fragment is bounded.** Nine findings quote the artefact into their
reason — a frontmatter key, a referenced path, a directory name — and until now
those quotes were unbounded and unescaped, outside the cap and the
`JSON.stringify` that evidence goes through. They now pass through the same
bound: whitespace collapsed, 60 characters, anything outside printable ASCII
printed as its escape. `THREATS.md` said the reason was written by the tool
alone; it was not, and now says so.

## 0.1.1 — 2026-09-09

**Documentation only.** `bin/`, `commands/` and the `files` allowlist are
byte-identical to `0.1.0`. Nothing behaves differently and there is nothing to
upgrade for.

**The package's own page said the package did not exist.** npm snapshots the
README at publish time, so `0.1.0` went up on the registry opening with
*"Nothing is published. There is no npm package and no release, so none of the
`npx` lines above run yet."* True when it was written, false the second it was
uploaded, and printed on the one page most people will ever read. A registry
README cannot be corrected without a version, so this is the version.

The `status` badge said `not published` in the palette's warning colour. It is
removed rather than flipped: `brand/BRAND.md` has no success ink by decision,
so there was no honest colour to turn it, and the npm badge beside it answers
the question anyway. That badge is now live rather than a hand-typed `0.1.0`,
for the reason the tarball's file count stopped being written down in
`docs/SHIPPING.md` — a number maintained by hand is a number that goes stale,
and this one would have gone stale at `0.2`.

## 0.1.0 — 2026-09-09

First publish. The pipeline, extracted from the skill library it was written
inside and made to run against any library but its own.

**Nine verbs.** `init`, `intake`, `audit`, `promote`, `refresh`, `usage`,
`overlap`, `ledger`, `check`. Every one resolves its library from `--library`,
then `SKILL_LIBRARY`, then the working directory — named, or the place you are
standing, never inferred from where the tool happens to be installed. Six of
the seven wrapped commands could not do this before; they resolved from their
own file location and could only ever act on the tree they lived in.

**Two stages ship without a verb.** The decision itself is written by hand into
`AUDIT.md` or `REJECTED.md`, and the graph viewer runs from a checkout. Both
appear in the README's lifecycle table marked as such, because a stage without
a command is a thing you do by hand rather than a thing that does not exist.
`adopt` and `view` are `0.2`.

**Nothing reaches the network but `intake` and `refresh`**, and both only to a
source you already named. Usage counting reads local transcripts and never
message text.

**Publishing is manual by decision, not by omission.** A publish pipeline
debugged during the first publish is two problems at once —
`.github/workflows/check.yml` and `docs/SHIPPING.md` carry the reasoning.
