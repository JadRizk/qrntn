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

## 0.1.0 — unreleased

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
