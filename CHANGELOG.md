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

## 0.3.0 — unreleased

**`view` reads.** Select a skill and the drawer now says what the records
say: origin, pinned commit, verdict, and every file in the skill with its
sha256 checked against the ledger — `matches`, `drift`, or `not in ledger`,
and a path the ledger hashes that is no longer on disk named as `missing`.
Open a file and a reading pane replaces the drawer with the **source**:
line-numbered, never wrapped, every control, invisible, bidirectional and tag
character rendered as a named chip (`U+202E`), a bidirectional run underlined
to its terminator, a confusable shown with the letter it imitates, HTML
comments present and dimmed, tabs and trailing spaces marked. The character
classes are the scanner's own, and the confusables table is asserted equal to
the scanner's by test. Findings from a skill's `AUDIT.json` are pinned to the
lines their `at` names, with the human's disposition beside each; a finding
whose line is gone says so instead of pointing at the wrong one.

Links in a file resolve once, at export, to nodes in the graph — a reference,
a script, a sibling skill through the same order that resolves everything
else — or to a readable file, an anchor, an external host, or nothing. A link
never mints a node or an edge. Following one selects the target and opens its
bytes; `[` and `]` step the findings; `alt+←` walks back; a line is an
address, `#<skill>/<path>:L<n>`. An external link is text with its host and
is never navigable.

**Why source and not markdown**, since a "README viewer" is what this looks
like from a distance: a rendered view hides an HTML comment addressed to the
model, a right-to-left override, a zero-width space and a Cyrillic `а` — the
concealments `docs/THREATS.md` names and the scanner exists to catch. The
reader renders what `cat` renders, and more. `docs/READING.md` decided this;
`docs/READING-ROOM.html` specified it.

**What leaves the machine.** Nothing, still — and now under a policy rather
than a promise. The viewer renders held skills' full artefact text, so the
page ships under one `Content-Security-Policy` that admits no remote source,
set as a header by `view` and carried as a `<meta>` by the page, asserted
identical by test; every response carries `X-Content-Type-Options: nosniff`
and `Referrer-Policy: no-referrer`. The `view` row in `docs/THREATS.md` is
rewritten accordingly.

**The graph carries the bytes.** `graph.json` gains, per skill, `files[]`,
`record`, `findings[]`, and per text file its `content`, `links[]` and
`anchors[]`. The fixture grows from 28 KB to under 100 KB; `check-graph`
warns past 4 MB and names the files that got it there. Not a change to any
of the four contracts.

## 0.2.0 — 2026-09-11

**`view`.** The eleventh verb: the graph, served locally against any skill
library. `qrntn view --library <dir>` exports the graph for that library,
serves it on `127.0.0.1` with the viewer, prints the URL and runs until
Ctrl-C, which exits `0`. Nothing leaves the machine and no browser is opened.
The viewer is `nexus/`, a Vite + React + three.js application, and the CLI
stays zero-dependency: the package now carries `view/`, the viewer's build
plus `nexus/scripts/export-graph.mjs` bundled to one plain-Node file, made at
publish time from the one implementation — `docs/SHIPPING.md` §8 rejected a
second one on the record — and never committed. The viewer's own
`public/data/graph.json`, a fixture of the library this was extracted from,
does not ship and is never served; nothing under `/data/` is answered but the
graph exported for the library you named.

The exporter resolved its library from `--library`, `SKILL_LIBRARY` and the
working directory already; it now takes `--out` as well, because a bundle
running from a tarball has no `public/data/` beside it to write into.

**The tarball is bigger, and says what it carries.** `package.json` still
declares no dependencies because none are resolved on your machine; `view/`
brings three.js, React and zod compiled in, about 880 KB, and `NOTICE` now
lists them. A tool about what enters a library should be plain about what it
brings with it.

**Gates.** `check.mjs` builds the bundle when the viewer's toolchain is
installed, so the smoke gate drives the real tarball; without it, the smoke
gate asserts that `view` refuses as a packaging fault rather than serving
anything else. CI gains a `viewer` job for the same reason, and the release
workflow builds the bundle before it publishes.

**`adopt`.** The tenth verb, and the lifecycle's central one: the human
decision, recorded by a command instead of by hand. `qrntn adopt <name>` writes
the verdict `ADOPT` into `inbox/<name>/AUDIT.md`, in the row `promote` already
reads, and refuses when the record is unfinished — a placeholder left in, a
finding with no disposition — or already decided. `--decline --why "…"` and
`--refuse` write a permanent row into `REJECTED.md`, under `## Declined` or
`## Refused`, in the shape `check` and the viewer already parse: the name, the
source as `[repo](url)` with the pinned commit, the date, and for a decline
the scan counts and the reason, for a refusal the blocking finding. Then the
artefact is removed from `inbox/`. That was one of two questions left open in
`docs/SHIPPING.md` §8 and is answered there: quarantine is a state that ends,
and the row keeps everything needed to fetch the same bytes again. The other
is answered the same way: `adopt` records and never moves; `promote` stays the
only thing that moves bytes into the library.

Nothing the artefact wrote reaches the record. The scan `adopt` runs is
`audit --no-evidence`, so the row carries counts and codes, never bytes — and
the one field that is still the artefact's to choose, a finding's file name, is
bounded the way the scanner bounds a quoted fragment: whitespace collapsed,
capped, anything outside printable ASCII written as its escape. Found by review
before release rather than after: a skill carrying a 200-character file name
with an ANSI escape in it put the whole thing into `REJECTED.md` and printed
the live escape to the terminal, and a file name containing a newline could
have written a second, forged row naming a skill nobody decided about. The
same bound now applies in `adopt`'s `--json`, and in the two `promote`
refusals that quote file names from the artefact — the re-scan's blocking
findings and the files that diverged from `ORIGIN.md` — which had the same
exposure since `0.1.0` and were found by the second review pass.

**`adopt` reports a removal that fails rather than crashing on it.** The row
is written first and is the decision; if `inbox/<name>` then will not go — a
permission, another process holding it — the result is a recorded decision
with a named leftover and exit `0`, not a stack trace, an empty `--json` and a
library nobody can tell the state of. The output says what to remove by hand,
because a second run refuses on the row that already exists.

**The `AUDIT.md` contract has one home.** The placeholders, the disposition
rule and the verdict row moved out of `promote.mjs` into
`commands/audit-record.mjs`, which `adopt` and `promote` both read. Typing it
twice is how a record one verb accepts becomes one the other refuses.

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
