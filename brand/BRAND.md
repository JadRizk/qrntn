# pratiq — brand direction

Signal Quebec. Near-black ground, one yellow signal taken from the maritime code
of signals, hard edges, monospaced body. A port inspection rendered as a
terminal.

## Thesis

**The mark is not designed, it is cited.** A vessel requesting inspection flies
signal flag Q — a plain yellow rectangle with nothing on it — and `pratiq` is
named for the clearance that flag asks for. So the identity does not invent a
symbol for "a recorded permission against a specific arrival." One already
exists, it is in a published international standard, and the correct move is to
take it unmodified rather than to improve it.

The flag carries an inversion the product would otherwise have to argue for.
Historically the yellow jack marked a vessel that **was, or might be, harbouring
disease**; under the modern code, Q flown alone reads **"my vessel is healthy, I
request free pratique."** One rectangle, two opposite meanings, and which one it
means depends entirely on whether an inspection has happened. That is the whole
tool: a skill in quarantine and a skill cleared into the library are the same
bytes under the same flag, and only a recorded human decision separates them.

What this rejects is the visual language of the category it will be shelved
beside. Scanners signal with shields, padlocks, keyholes and green ticks —
iconography that asserts *a machine has determined this is safe*. `pratiq`
refuses that claim in its README and must refuse it in its logo: it is not a
scanner, it makes no safety determination, and a shield would be the interface
lying about what the tool does. A yellow flag says something a shield cannot —
**this is the thing that has not been decided yet, and you are the one who
decides it.**

## Voice

Inherited from the tool's existing output, not newly invented. The CLI already
speaks this way; this records it so the docs, the viewer and the site do too.

- **Label casing** — `lowercase` for verbs and identifiers, exactly as typed:
  `intake`, `audit`, `promote`, `refresh`. `UPPERCASE` with wide tracking for
  chrome labels only: `HELD`, `CLEARED`, `REFUSED`. Never Title Case.
- **Separators** — `·` between peer facts (`pratiq · 0.1.0 · apache-2.0`); `—`
  to introduce a consequence (`refused — network call in a script`). Never `|`.
- **Status vocabulary** — drawn from the port, and already load-bearing in the
  code: **held**, **cleared**, **refused**, **declined**, **quarantine**,
  **pinned**, **drift**, **pratique**. Not *pending / approved / blocked*, which
  describe a queue rather than a decision, and not *safe / unsafe*, which is a
  determination this tool does not make.
- **Identifiers** — versions bare (`0.1.0`, never `v0.1.0`); commits at seven
  characters (`a4f19c2`); digests truncated with an ellipsis and their algorithm
  kept (`sha256:9b1c…e07a`).
- **Refusals** — one line, lowercase, beginning `refused:`, then the reason,
  then what to do. A refusal is a finished answer, so it is never apologetic and
  never suggests the user retry the same thing.

Body copy is **not** written in the chrome voice. Prose is plain, declarative
and full-sentence, and it states findings rather than topics — "the pipeline is
done", not "pipeline status". The existing docs do this well and are the
reference; the instrument vocabulary belongs to labels and chrome only.

## Typography

**IBM Plex Mono carries the body**, which is the inversion worth naming: mono is
usually reserved for code samples, and here it sets the running text as well.
The justification is that `pratiq` is a command before it is a product — the
wordmark is the string you type — and a proportional body face would put the
brand in a different register from the only surface most users ever see. IBM
Plex specifically, over the usual mono choices, because it was drawn as a
documentary and technical family: it belongs on a form, which is what a ship's
papers are.

**Archivo** carries display, at 700 and 900, for headings on marketing surfaces
only. Industrial grotesque, signage register — the lettering on a bulkhead
rather than a masthead. It never appears in the viewer or the CLI.

The scale is **closed** and enumerated in `PALETTE.md`. The system names no font
in component code; both faces resolve through `--pq-font-mono` and
`--pq-font-display`, so a consumer can substitute without touching a component.
Both are declared in `nexus/packages/tokens/src/pratiq.css` and asserted by
`pratiq.contract.test.ts` — this document named them for a while before either
existed, which is the failure that gate was added for.
The terminal ships no face at all — whatever the user has set is correct there,
and overriding it would be the tool asserting something about a surface it does
not own.

## Non-negotiables

- **No shield, no padlock, no keyhole, no checkmark.** Anywhere, at any size.
  These assert a machine-made safety verdict, and the tool's central claim is
  that it makes none. A constraint, not an omission.
- **No green success state.** Two independent reasons, and either alone would be
  enough. Computed: green measures **ΔE 4.1 (protan)** against Quebec, a
  red-green collapse affecting roughly 8% of males, so a green "cleared" would
  be the accent to them. Semantic: green means *safe*, and cleared means *a
  human decided*. Cleared is rendered in the accent.
- **The accent is never data.** Quebec marks live state, focus, and a granted
  clearance. It never colours a node, a series, a row or a category in the
  viewer. This rule is inherited from nexus and is now measured: Quebec sits
  **ΔE 3.8 (deutan)** from the graph's own lime, so the separation between
  "focused" and "content" rests on the rule, not on the hue. Breaking it
  collapses the whole language.
- **Zero radius, everywhere.** Inherited from nexus, restated because a logo is
  where systems usually make the exception. The flag has square corners.
- **No elevation.** Line and ground contrast carry all structure. No shadow
  ships, including on the marketing site.
- **Dark only.** There is no light theme, because there is no light nexus. The
  cost is real — the mark must therefore survive on a white README background,
  which is why the flag is specified with its dark field rather than as a bare
  rectangle.
- **The glitch never animates on a release surface.** Scanlines and chromatic
  aberration are the system's texture and may live on the site and in the
  viewer; the mark itself is static in every published context. A logo that
  flickers reads as broken, and this tool cannot afford to look unreliable.
- **Text clears 4.5:1** against the canvas, with measured ratios recorded beside
  the tokens. If a label looks too loud, change the hierarchy or the size, never
  the contrast.

  **With one exception, and it is currently load-bearing rather than
  hypothetical.** `pratiq` (the AA theme) holds this floor at every step. The
  viewer ships `pratiq-hud`, whose ramp is inherited verbatim from nexus's own
  immersive variant and puts three text roles below it — `ink-subtle` at
  3.80:1, `fg-tertiary` at 2.72:1, `ink-disabled` at 2.15:1. That was inherited
  along with the ramp so the brand swap moved hue and nothing else, and it is
  the reason the viewer's edge-register gains still hold.

  So the rule is: **AA is the default and the floor for anything new; the
  immersive ramp is an opt-in surface, and shipping it is a decision that has to
  be made out loud.** It has been made out loud exactly once, in
  `nexus/src/main.tsx`. `PALETTE.md` tables both ramps with the failing steps
  marked. This is a stated exception, not an unnoticed violation — and it stays
  open: either the viewer moves to `pratiq` and the gains are re-measured, or
  the exception is made permanent on the record.
- **Decoration and text are different tokens.** `--pq-ambient` is for hairlines,
  grid overlays and idle brackets. Never text.

## References

- **International Code of Signals, flag Q ("Quebec")** — taken entire: the
  proportions, the colour, and the rule that nothing is printed on it. Refused:
  the surrounding alphabet. Using more than one flag would make the system a
  code rather than a name.
- **The yellow jack, pre-1900** — taken: the inversion, which is the thesis.
  Refused: the plague and quarantine imagery that comes with it. The tool holds
  things in quarantine; it does not call them diseased.
- **nexus (`nexus/packages/tokens`)** — taken: the ground, the zero radius, the
  corner ticks, the CRT texture, the restricted-colour discipline, the
  measured-contrast habit. Refused: the acid accent (it collapses against
  Quebec at ΔE 1.8 — see `PALETTE.md`) and the phosphor-green ink.
- **Snyk, Socket, Sigstore** — refused wholesale. Shield-and-lock marks in
  green and blue, asserting machine-determined safety. Named here because the
  npm listing puts `pratiq` next to them, and being the only yellow rectangle
  in that row is a positioning decision before it is an aesthetic one.
- **`cargo-vet`** — taken: the posture. In-tree audit records, named criteria, a
  tool that certifies and never edits. It has almost no visual identity, which
  is the gap this document fills rather than a model to copy.

## Open

- **The yellow is an assumption.** The code of signals predates Pantone and
  specifies only "plain yellow"; no official hex exists. `#FEDD00` is Pantone
  Yellow C, chosen as the archetypal pure yellow and then measured. Every number
  downstream would need re-running if it moves. This is the single most
  falsifiable decision here.
- **Which mark ships is not settled.** Five are drawn in `assets/logo/`. Quebec
  — the bare flag — is the recommendation; the other four exist so it can be
  refused on sight rather than in the abstract.
- **Not tested on anyone.** The CVD figures are computed simulations. Nobody
  with a colour vision deficiency has looked at this, nothing has been seen in
  print or on a physical surface, and the 16px read was judged on one display.
- **The CLI's colour ships, and its restraint is enforced by a test rather than
  by discipline.** `commands/tint.mjs` holds four inks and no fifth — `state`
  for a cleared verdict, `warn` for findings, `alarm` for refusals, `dim` for
  chrome. There is no `bold`, no `success`, and no route to an arbitrary
  colour, because a helper that can paint anything gets used to paint
  everything. `tint.test.mjs` fails if a fifth ink appears.

  All nine verbs colour `refused:`, and `audit-skill` colours its severity
  column, its counts and its verdict. Two rules constrain where it went: a zero
  count never spends an ink (`0 block` in alarm red is the interface shouting
  about the absence of a problem), and the flag itself is spent on exactly one
  string in the whole CLI — the verdict `NO BLOCKING FINDINGS`. A vessel is
  either cleared or it is not.

  **The import is guarded, and that is load-bearing.** These scripts are
  deployed by copying one file into a skill's `scripts/` folder, so `tint.mjs`
  is often not beside them; a static import made a copied script die with
  `ERR_MODULE_NOT_FOUND` before it ran. Each command falls back to plain text —
  which is byte-identical to what `tint.mjs` returns on a pipe anyway, since
  colour was only ever a second copy of a word already on the line. Both halves
  are pinned: one command is copied alone in a test and asserted to still
  refuse in words, and the source of every command is checked for a static
  import.

  `bin/pratiq.mjs` stays plain permanently. Its refusals are packaging faults —
  "commands/ is missing" — and a module that reports that cannot live in
  `commands/`.
