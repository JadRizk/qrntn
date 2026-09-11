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

The 296 px drawer cannot hold a source file and should not try. Opening a file
replaces the drawer with a reading pane: full height, the file's name and its
`verified` mark in the header, the source below with line numbers, and the
findings for that file — `code`, severity, disposition, why — pinned to their
lines in the gutter. The palette overlay is already 520 px
(`overlays.tsx:173`); the pane is wider than that, and takes the width the
graph does not need while it is open.

From a skill: its `SKILL.md`, and a list of its other files. From a leaf
node: that file. From a declined or refused node: nothing to read — the bytes
were removed with the row, by design (`adopt.mjs`, *quarantine is a state that
ends*) — so the pane shows the row: date, scan, reason, and the pinned commit
the source is re-fetchable at.

## Two questions to settle before the schema moves

**Quarantine.** The exporter walks `skills/` only. The moment a human most
needs to read a skill is before `adopt`, when it sits in `inbox/<name>/` with
an `AUDIT.md` that has findings and no verdict. Showing quarantined skills —
a distinct kind, hatched like a declined one, with its findings and no
dispositions yet — would make `view` part of the audit loop rather than a
retrospective on it. It is the larger change, and it changes the node schema,
which is why it is decided now: **held skills first, quarantine as the next
step, and the schema written so that adding the kind is a new discriminant,
not a rewrite.**

**Formatted mode.** Deferred, as above. If it ships it ships sanitised, off by
default, and with the invisibles it would hide counted in the header — *3
characters this view does not show* — so the toggle itself says what it costs.

## Precedents

- **npm's "Code" tab** and **crates.io's source view** show the files of the
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
   them. Specified in [`READING-ROOM.html`](READING-ROOM.html).
2. **The reader.** `content` in the graph; the reading pane; source
   rendering with invisibles shown; findings pinned to lines. The CSP and the
   `THREATS.md` row land in the same change, because they are the same
   decision.
3. **Then, if wanted:** quarantine in the graph; a formatted toggle.

## Related

- [`THREATS.md`](THREATS.md) — the concealment capability this reader is
  designed around, and the `view` row it rewrites.
- [`SURFACE.md`](SURFACE.md) — why `view` is a prebuilt bundle and the CLI
  stays plain Node.
- [`SHIPPING.md`](SHIPPING.md) — §8, the one-implementation rule the exporter
  follows and this extends.
