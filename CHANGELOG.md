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

## 0.5.0 — 2026-09-15

**`overlap` grew two consumers.** It measured which descriptions compete for
the same request and printed a table, and nothing read it — not `adopt`, not
`check`, not the graph. A number nobody consumes cannot be wrong, which is the
problem: the ranking was a lexical prediction that no part of this tool ever
tested against what actually happened. Both entries below import the one
implementation in `commands/overlap.mjs` rather than restating the measure,
for the reason `SURFACE.md` gives: a second copy agrees today and drifts
tomorrow, and the graph would then draw a number `qrntn overlap` does not
print. Both reduce the ranking the same way, and the reduction is a rank
rather than a cutoff — for each skill, the one description that claims most of
its distinctive vocabulary. There is no constant to tune anywhere in either,
which was the whole objection to letting a score select anything. Found in
review: the ranking reports each pair once, in the swallowing direction, and a
reduction that read only that direction never gave a coverer to the wider
description of any pair — two near-twins, one claiming 100% of the other and
the other claiming 77% back, explained whichever never fired only when it was
the narrower one. Each pair now carries the other direction as `reverse` in
`--json`, and the reduction considers both; the table is unchanged.

**`usage --report` says why a zero is a zero.** A skill that never fired has
always had a row here — cost with no denominator, the row the report exists to
produce. What it could never say was *why*, and "nobody wanted it" and "nobody
could reach it" are opposite findings with opposite fixes. A fourth population
now names, for each never-invoked skill, the routable description that covers
it and how often THAT one fired: a lexical prediction with the count that
confirms or refutes it beside it. Manual-only skills appear in neither column
— nothing routes to them, so nothing can swallow their triggers — and pairs
already declared in `edges.json` are left out, because someone wrote that
relationship down. The section prints only when something was measured: a
heading over an empty table reads as "nothing covers anything", which is a
claim, and none was made.

**The graph draws what nobody declared.** A new `overlaps` edge, measured
rather than read out of a file a person edited, pointing from the description
doing the covering to the one being covered — the direction the phenomenon
has. It is the first edge in a fourth register: `measured` shares `semantic`'s
arc, because an overlap is about meaning, at a fraction of its intensity,
because it is nobody's claim; the drawer prints the share beside the name and
the terms that drove it underneath. Drawn only where it touches the selected
node — a step further back than the declared relationships, which any
selection reveals graph-wide: those are sparse, and this one exists at nearly
every skill, so selecting the origin drew a violet arc at all of them at once.
Never drawn for a pair `edges.json` already joins — a declaration drawn twice
would read as a finding against the person who made it — and, the other way
round, `check` and the exporter both refuse an `edges.json` that declares an
edge *as* `overlaps`: drawn, it would be a measurement with no measure behind
it, and it would silence the real one. The spring is near zero on purpose, so
the measure cannot rearrange the thing it is measuring. The export says how
many pairs it did not draw; the rest are in `qrntn overlap`.

**The reader has a preview.** `p`, or the footer button, on a markdown file:
headings as headings, lists, quotes, tables, fences as numbered code — built
from the same parse the colour comes from, and with every run of text put
through the same tokeniser as the source view. So the preview hides nothing
the source shows: an invisible is still a chip inside a paragraph, a link is
still the exporter's resolved span, an HTML comment is a labelled block, HTML
is its own source, an image is its alt and target and never a request. Off
by default; the source is the reader. `docs/READING.md` §Preview. Found on
the way: an HTML comment's contents were kept raw in the source view, so an
invisible inside a comment did not chip — it does now.

**The reader colours the source.** Markdown, JavaScript and YAML files —
and JS, TS and YAML inside a markdown fence — are read through a Lezer parser
and tinted by scope: keywords, strings, comments, literals, names, marks. The
rendering is the same source it was: every byte on screen, every escape a
chip, every link the exporter's offset, and colour laid over that. Lezer
because it emits a tree and never HTML, so the page's *nothing is set as
HTML* and its CSP are untouched. And the markdown line classes — front
matter, heading, fence — now apply to markdown only: before this, `# section`
in a script read as a bold heading and a YAML file opening with `---` was
greyed as front matter to its end. `docs/READING.md` §Colour.

**Records and refusals name this tool's verbs, not the skills it was cut
from.** `ORIGIN.md` opened *"Written by `skill-intake`"* on every skill this
tool fetched, and cited `promote.mjs`; `promote` refused a skill with no
`ORIGIN.md` as one that *"did not come through skill-intake"*, and a missing
scanner as *"skill-audit not found"*. Those are the names of the skills this
was extracted from and the filenames behind the verbs, neither of which a
user of the package has. They say `qrntn intake`, `qrntn promote` and *"the
audit scanner is missing"* now — the last of them naming the file expected and
calling it a packaging fault, which is what it is. The README also said eight
verbs colour `refused:`, a count from before `adopt` and `view`; it says ten,
and `qrntn.test.mjs` now derives the number from the scripts, so it cannot
drift again.

**`install` can say "in place".** The ledger's install section was written
for one layout — the library somewhere of its own, `<install-root>/<name>` a
symlink into it — and `{ symlinked: false, path: null }` meant not installed.
The first library made outside the one this was written in sits at `~/.claude`
itself, so its skills load from exactly where they are held, and `ledger
--check --install` called all twenty of them not installed. The section now
carries `inPlace: boolean`: true when the install root *is* the library's
`skills/` directory, compared by realpath and as a property of the two
directories rather than of where an entry points, so a link into the library
from a root of its own stays what it was. Always written, never implied by
absence. A record from before the key made no claim about it, so `--check
--install` does not fail such a record for a fresh `false` — and does fail it
for a fresh `true`, which is the layout having changed under it.

## 0.4.0 — 2026-09-13

**`view` has an address.** `qrntn view` serves at `http://localhost:7768/`
— one port, remembered, `q r n t` on a telephone keypad and unassigned at
IANA — and opens your browser there. `--port <n>` still overrides it and
`--port 0` lets the system choose; `--no-open`, `BROWSER=none` or `--json`
leave the browser alone, `BROWSER=<command>` opens with that instead, and a
browser that will not start is a dim line under the URL, never an exit. A busy
port is refused rather than skipped past, and when the squatter is another
`qrntn view` the refusal says so and names its URL. Not a daemon, on purpose:
the graph is exported at start and served as a snapshot, so a server that
outlives the reading would be reporting on a tree that has since changed.
`docs/SERVING.md` decided all of it.

**The server checks `Host`.** A fixed port is what makes DNS rebinding
practical — a page on another origin whose DNS is flipped to `127.0.0.1` can
fetch this server as if same-origin and, with the reading room in the graph,
read every byte of every held skill; the CSP does not defend against it,
because it is not our page making the request. So a request that does not
name this machine — `localhost`, `127.0.0.1` or `[::1]`, at the bound port —
is answered 403 and nothing else, and one with no `Host` at all is 400. The
same check Vite added for CVE-2025-24010 and Next.js for `allowedDevOrigins`,
with the same status. Every response now carries `Server: qrntn-view/<version>`.
A change to *what leaves the machine* in the direction of less; the `view`
row in `docs/THREATS.md` says so.

## 0.3.0 — 2026-09-13

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
reader renders what `cat` renders, and more. `docs/READING.md` decided it,
and records what was built.

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
