# Reading in the viewer

> **A plan, dated 2026-09-11, and expected to change.** Like
> [`SHIPPING.md`](SHIPPING.md), this is not a record of something measured
> after the fact; it is a decision made before the work, with the facts it
> rests on measured and cited beside it so a reader can disagree with the
> evidence rather than with the conclusion. Edit it as the work lands. Where
> it and the code disagree after that, the code is right and this is a defect.

`qrntn view` shows the library as a graph: every skill, where it came from,
what the audit found, whether it has fired. Pick a node and the drawer says its
name, its kind, its degree and what it connects to — and nothing of what it
*says*. A skill is a folder of text that becomes instructions; a viewer that
cannot show the text is a map of a library whose books are shut.

This decides what the viewer shows when a file is opened, how the bytes get
there, and what the rendering is allowed to hide. The last of those is the
decision that matters, and it is the one a "README viewer" would get wrong.

## What the viewer holds today

Measured on the tree at `0.2.0`.

| Fact | Where |
|---|---|
| The drawer renders label, kind, degree and one row per edge. It is fed `GraphNodeSnapshot` — id, label, category, degree, adjacency — which carries none of the skill's own fields, so not even the description reaches it | `nexus/src/ui/DetailsDrawer.tsx`, `nexus/packages/graph/src/types.ts:154` |
| The drawer is 296 px wide | `nexus/packages/react/src/overlays.tsx:46` |
| The exporter already reads every `SKILL.md`, `references/*`, `assets/*`, `agents/*` and `scripts/*` — to count words, and then discards the text | `nexus/scripts/export-graph.mjs:176–190` |
| The server answers exactly one data path, `/data/graph.json`; everything else under `/data/` is 404, and the test suite asserts it | `commands/view.mjs:269–270`, `commands/view.test.mjs` |
| Neither the served `index.html` nor the server sets a `Content-Security-Policy` | `view/index.html`, `commands/view.mjs` |
| The fixture library is 12 skills and 30,804 words of `SKILL.md` plus references — roughly 200 KB of text against a 28 KB graph | `nexus/public/data/graph.json` |

## What the records already hold

This is the finding that changes what the feature is. The library does not
hold a README per skill. It holds, per skill, the things a reader would have
to reconstruct by hand:

| Record | Carries | Where |
|---|---|---|
| `ledger/<name>.json` → `integrity.files` | a sha256 for every file in the skill, written by the one ledger writer and re-derived by `ledger --check` | `commands/ledger.mjs:51` |
| the audit record → `findings[]` | `code`, `severity`, `at` as `SKILL.md:52:1`, the human's `disposition` — `real`, `accepted`, `false-positive`, `fixed`, `removed`, `not-applicable` — and their `why` | `commands/record.schema.json:110–158` |
| `AUDIT.md`, `ORIGIN.md` | the adjudication and the provenance, in the skill's own folder; the exporter already names them as provenance rather than depth | `export-graph.mjs:142` |
| `REJECTED.md` | the declined and refused rows, with scan, date and reason | parsed into nodes already |

So the honest name for this is not a README viewer. It is a **reading room**:
the exact bytes a decision was recorded against, each file marked as matching
its ledger hash or not, with the audit's findings pinned to the lines they
fired on and the human's disposition beside each. That is the README's
sentence — *before a skill runs, someone has to have actually read it* — made
visible, rather than a documentation pane bolted to the side of a graph.

## The decision that matters: source, not markdown

[`THREATS.md`](THREATS.md) names the adversary's second capability as
**concealment from the reviewer specifically**: HTML comments, invisible and
bidirectional characters, Unicode tag characters, homoglyphs, base64 and
escape-encoded runs. The scanner has a rule for each, and the reason it does
is that a person reading the file *as rendered* would not see any of them.

A markdown renderer hides every one. An HTML comment vanishes. A right-to-left
override reverses the rest of the line. `\u200b` is nothing. A homoglyph is the
letter it imitates. A "README viewer" that renders markdown is therefore a
*worse* surface for the reviewer than `cat`, and it would sit beside the audit
that exists to catch exactly what it hides.

**The reader renders the source.** Monospace, line-numbered, with invisibles
shown as their escapes and bidirectional runs marked. This is the precedent
GitHub set with its bidirectional-text banner and VS Code with its
ambiguous-character highlighting: the reading surface itself surfaces what the
rendering would conceal.

A formatted mode — headings as headings, fences as blocks — is allowed later,
as a toggle that is off by default, and it renders **no raw HTML and no remote
images**. Not because of this document's taste but because of the next section.

## What a reader adds to the threat model

`THREATS.md`'s row for `view` reads: *the browser renders held skills' names
and descriptions, which is artefact text — but into a page on this machine,
not into a context, and only for skills a human already adopted*. A reader
widens that on purpose — full artefact text, not names — and the row is
rewritten before the code lands, not after. Three consequences, each a
constraint on the implementation:

**1. A `Content-Security-Policy`, whatever the rendering.** There is none
today, and today that is harmless: React escapes the description into a text
node. The moment artefact text is rendered as anything richer, an
`<img src="https://…">` in a README is a beacon, and *nothing leaves the
machine* is false. The served page carries
`default-src 'self'; img-src 'self' data:; connect-src 'self'` — set by
`view.mjs` as a header on `index.html`, and mirrored as a `<meta>` in
`nexus/index.html` so `vite dev` is held to the same rule. Belt and braces,
with the belt named, as `view.mjs` already says of its traversal check.

**2. Artefact bytes are never answered as HTML.** If files are served (see
below), an `assets/foo.html` answered as `text/html` on the viewer's origin is
script with access to everything the server serves. Text is `text/plain` with
`X-Content-Type-Options: nosniff`; anything else is refused, not sniffed.

**3. Two readers, still.** The CLI prints a URL and counts and never the
graph, so the agent reader sees no artefact text on this path. That holds
exactly as long as `view` keeps writing nothing else to stdout — which is
already the contract, and the reason `--json` reports counts rather than
nodes.

## How the bytes reach the browser

Two ways, and one is chosen.

| | Embed in `graph.json` at export | Serve on demand: `GET /file/<skill>/<path>` |
|---|---|---|
| Server | untouched; the one-data-path contract and its tests stand | a second endpoint, and a second site for the traversal reasoning at `view.mjs:288` |
| `vite dev` with the fixture | works as it does now | needs a dev proxy or a stub |
| Size | fixture: 28 KB → roughly 250 KB, loaded before first paint. A 100-skill library: a few MB | one file at a time |
| Staleness | as today — *re-run to re-export* | live |
| Hash check | the exporter compares each file to `integrity.files` once and ships `verified` per file | the server or the client hashes on every read |
| Schema | `content` and `verified` on leaf nodes and skills, zod-validated, tested | unchanged |

**Embed.** It keeps the viewer static, keeps the fixture working under
`vite dev`, keeps the server's data surface at one path, and puts the sha256
comparison in the one exporter — which is the rule [`SHIPPING.md`](SHIPPING.md)
§8 already enforces for the resolution order: one implementation, no second
copy to drift. Size becomes a problem only at libraries far larger than any
that exists, and moving to lazy loading then is invisible to the UI, because
the UI reads a node's `content` either way.

What is embedded is the text of every file the exporter already lists — the
spine, `references/`, `assets/`, `agents/`, `scripts/` — plus `AUDIT.md` and
`ORIGIN.md`, which the exporter names and currently does not read. Binary
files embed nothing but their size and their hash. The exporter stays the only
place Nexus touches the library, and it still only reads.

## What it looks like

*As built. The first draft of this section described a pane that did not
exist; this describes the one in `nexus/src/ui/ReadingPane.tsx`.*

The 296 px drawer cannot hold a source file and does not try. Selecting a
skill keeps the drawer, which now leads with the **records** — description,
origin, pinned commit at seven characters, verdict in the accent (cleared is
the accent, `BRAND.md`), finding count — and one row per file with its hash
verdict: `matches` as the accent square alone, `drift` in critical, `not in
ledger` in grey, and a path the ledger hashes that is gone as `missing`. The
word is spent on the exception; every row's state is in its accessible name.

Opening a file replaces the drawer with the **reading pane**: the same
right-hand slot, `clamp(560px, 44vw, 760px)` wide, full height. The header
carries the file, `sha256:9b1c…e07a · matches ledger`, lines and bytes, the
pinned commit, and the count of characters the view had to escape. The body
is the source through `reading/tokenise.ts` — line-numbered, never wrapped,
scrolled in both axes, rows windowed so a hundred thousand lines is a fact
the header states rather than a page the browser chokes on. Findings pin as
a row beneath their line: code, severity as colour (`block` critical,
`review` warning, `note` grey — never the accent), the human's disposition
as a chip, `why`. A finding whose line the file no longer has is listed
above the source as *no longer has a line for*, not pinned to a wrong line.

From a leaf or a script fold: straight to the file — the drawer's edge list
for a leaf is one row and not worth a stop. From a declined, refused or ghost
node: nothing to read, by design (`adopt.mjs`, *quarantine is a state that
ends*), so the pane shows the row — date, scan, reason, or *referenced by*.

## What the reader escapes

Every class below is the scanner's own (`commands/audit-skill.mjs`), by
range, so a character the scanner would flag is never one the reader hides.
The confusables table is restated in `reading/confusables.ts` and
`confusables.agreement.test.ts` rebuilds the scanner's map from the
scanner's source text and asserts the two are equal, entry for entry.

| Class | Range | Shown as |
|---|---|---|
| Control | U+0000–0008, 000B, 000C, 000E–001F, 007F–009F | `U+0001` chip, critical |
| Invisible | U+200B–200F, 2060–2064, FEFF, 00AD, 180E, 2028–2029 — `INVISIBLE_RE` | `U+200B` chip |
| Bidi control | U+202A–202E, 2066–2069 — `BIDI_RE` | chip; the run to its terminator underlined |
| Tag character | U+E0000–E007F | `U+E0041` chip |
| Confusable | the scanner's `CONFUSABLES` map, by code point | the character, dotted underline, the letter it imitates on hover |
| Other non-ASCII | everything else above U+007F | rendered as it is; counted in the header |
| Whitespace | tab, CR, NBSP, trailing spaces | `→` `␍` `⍽` `·` in grey |
| HTML comment | `<!-- … -->`, across lines | present, dimmed, italic |

## Links

Links are found and resolved **once, in the exporter** (`src/data/reading.ts`),
and ship on each file as offsets; the viewer colours spans it is handed and
never parses markdown. `SHIPPING.md` §8 again: the one place that knows which
name is a skill, which a refused row and which a ghost is the one place a
link is resolved. **A link never mints a node or an edge** — a markdown link
is a reading affordance; `edges.json` and the operative form are the record.

| In the file | Resolves to | In the pane |
|---|---|---|
| `[t](references/x.md)` · `[t](./STANDARDS.md)` · `[t](assets/x)` · `[t](agents/x.md)` | the skill's **leaf node** for that file | accent, dotted; click selects the leaf and opens it |
| `[t](scripts/x.py)` | the skill's **script fold** | as a leaf; opens the script's source |
| `[t](../other/SKILL.md)` · `[t](../other/)` | through the §5 order: **skill**, **refused**, **declined**, or a ghost the export already minted | accent, solid; click selects it — a skill opens on `SKILL.md`, a row opens on the row |
| `Call the Skill tool with "x"` | the same — already an operative edge | as above |
| `[[x]]` | resolved only if `x` is already a node; never mints one | as above, or plain text with *· no node* |
| `[t](AUDIT.md)` · a nested `references/deep/x.md` · `LICENSE` | a **readable file** of this skill that is not drawn | dotted; opens in the pane, selection stays |
| `[t](#heading)` | an anchor: GitHub-style slugs for each ATX heading | scrolls the pane |
| `https://…` · `<https://…>` · `mailto:` · `file:` · `![](…)` | **external** — the host only | text, dashed, *↗ inert*; never an `<a>` |
| anything else — a sibling skill's inner file, a name the library does not know, a climb out of `skills/`, an empty destination | **unresolved** | plain text |

## How the graph and the pane move together

Selection is the single source of truth; the pane is a view of the selected
node's bytes, held as `{ nodeId, path, line }` beside `selectedId` in
`App.tsx`. Every interaction is a change to one or both.

| Interaction | What happens |
|---|---|
| select a skill | the drawer, with records and files |
| a file row, or a palette action | selection moves to the file's node if it has one, else stays on the skill; the pane opens; the camera focuses the selected node, now landing it in the box the pane leaves free (`GraphCanvas.tsx`'s `focus()` honours `fitInset`, as `applyFit` already did) |
| select a leaf or a script fold | the pane opens straight on the file |
| click a resolved link | the current file is pushed to the pane's own history; the target is selected, its kind revealed if the legend had it off, its primary file opened |
| `[` · `]` | step the open file's pinned findings; the line is brought a third of the way down the pane |
| `alt+←` | walk the pane's history; the browser's history is not used |
| `esc` | first press closes the pane and the drawer returns for the same selection; second press clears the selection |
| `⌘k` | a `reader` scope: *Read SKILL.md / AUDIT.md / ORIGIN.md* for the selected skill; *Next / Previous finding*, *Close reader* while a file is open |
| the address bar | `#<skill>/<path>:L<n>` is written on every change and honoured on load — a line is an address on this machine. A malformed one is ignored |
| a re-run of `qrntn view` | everything re-exported; *re-run to re-export*, unchanged |

## Decided

Five questions were open when the work began; each was settled with the
maintainer on 2026-09-11, before phase 1. Code comments cite them by number.

1. **Pins come from `AUDIT.json` only.** Most records are the `AUDIT.md`
   table, and the table parser lives in `commands/audit-record.mjs`; a second
   parser on the nexus side is the drift §8 rejects. The drawer's counts
   come from the ledger, which needs no parsing; `AUDIT.md` is a readable
   file; a later `qrntn` verb can write the JSON from the table, in the CLI.
2. **The grey ramp is sidestepped.** The pane's body text uses `paper` or
   `grey-600`, which clear 4.5:1 on either ramp; only gutter numbers and
   whitespace marks use the failing greys, as non-text. Whether the viewer
   moves to the AA ramp stays `PALETTE.md`'s own decision.
3. **Nested files are readable, not drawn.** The exporter walks every file
   the ledger's own walk reaches — recursive, symlinks skipped, dotfiles
   included, so nothing the ledger hashes can read as missing — and lists
   them all; the graph's node set is unchanged.
4. **`AUDIT.md` and `ORIGIN.md` are never nodes.** Readable from the skill;
   provenance is not depth.
5. **No scanner re-run at export.** That is `refresh`'s job; the escape
   classes already make every character-level case visible without a
   verdict.

And one builder-level choice: the engine's `GraphNodeSnapshot` carries none
of a skill's fields, and widening the vendored engine's type for them would
be the wrong seam. `App.tsx` keeps one `Map<id, GraphNode>` over the loaded
snapshot and hands the full node to the drawer and the pane.

## Still open

**Quarantine.** The exporter walks `skills/` only. The moment a human most
needs to read a skill is before `adopt`, when it sits in `inbox/<name>/` with
an `AUDIT.md` that has findings and no verdict. Showing quarantined skills —
a distinct kind, hatched like a declined one, with its findings and no
dispositions yet — would make `view` part of the audit loop rather than a
retrospective on it. The schema was written so that adding the kind is a new
discriminant, not a rewrite.

**Formatted mode.** Deferred. If it ships it ships sanitised, off by default,
and with the invisibles it would hide counted in the header — *3 characters
this view does not show* — so the toggle itself says what it costs.

**Hover.** A link under the pointer should light its target on the canvas.
`GraphController` exposes `fit`, `focus`, `reseed`, `getNode` and no hover
setter (`hoverIdx` is internal to `GraphCanvas.tsx`), so this needs a
`hover(id | null)` on the controller first. Polish, not the mechanism.

## Precedents

- **npm's "Code" tab**, **PyPI's inspector** and **docs.rs's source view** show the files of the
  *published tarball*, not the repository — the bytes you received, which is
  the same argument this tool makes for recording against a commit rather
  than a name.
- **`cargo vet inspect`** and **`cargo vet diff`** make reading a named step
  of certification, and hand the reviewer the exact version, not a link to
  the project.
- **GitHub's bidirectional-text warning** and **VS Code's ambiguous-Unicode
  highlighting** put the concealment finding in the reader rather than in a
  separate scanner. That is the model here.

## Order

1. **Records first.** Description, origin and pinned commit, verdict and
   finding counts, and the per-file `verified` mark, in the drawer. No
   artefact text yet, so no new threat surface, and the schema change is the
   small half of the one the reader needs. *Landed 2026-09-11:* skill nodes
   carry `files[]` (path, role, bytes, sha256, `verified` as `matches` /
   `drift` / `unlisted`) and `record` (the ledger's origin and audit fields,
   plus `missing[]` for paths the ledger hashes that are gone); the exporter
   is the one place the comparison runs; `ui/RecordSections.tsx` renders
   them.
2. **The reader.** `content` in the graph; the reading pane; source
   rendering with invisibles shown; findings pinned to lines. The CSP and the
   `THREATS.md` row land in the same change, because they are the same
   decision. *Landed 2026-09-12:* every text file ships its bytes, its
   resolved `links[]` and `anchors[]` (`nexus/src/data/reading.ts`, the one
   resolver); findings from `AUDIT.json` are pinned with `excerptMatches`;
   `ui/ReadingPane.tsx` renders the source through `reading/tokenise.ts`,
   whose character classes are the scanner's and whose confusables table is
   asserted equal to the scanner's by test; the policy is one string in
   `view.mjs` and `nexus/index.html`, asserted equal by `view.test.mjs`. A
   line is an address: `#<skill>/<path>:L<n>`.
3. **Then, if wanted:** the three items under *Still open*.

## Related

- [`THREATS.md`](THREATS.md) — the concealment capability this reader is
  designed around, and the `view` row it rewrites.
- [`SURFACE.md`](SURFACE.md) — why `view` is a prebuilt bundle and the CLI
  stays plain Node.
- [`SHIPPING.md`](SHIPPING.md) — §8, the one-implementation rule the exporter
  follows and this extends.
