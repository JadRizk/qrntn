# brand/

The direction, decided before any of it is implemented.

| File | Carries |
|---|---|
| [`BRAND.md`](BRAND.md) | Thesis, voice, typography, non-negotiables. The document a human reads. |
| [`PALETTE.md`](PALETTE.md) | Every colour, with the measured ratio and the command that produced it. The document an implementation reads. |
| [`references/research.md`](references/research.md) | What was cited, and what was refused. |
| [`../nexus/packages/tokens/src/pratiq.css`](../nexus/packages/tokens/src/pratiq.css) | The brand as two nexus themes. Lives in the tokens package, not here — one source of truth, and the viewer imports it. |
| [`../commands/tint.mjs`](../commands/tint.mjs) | The CLI's four inks, behind a guarded import so a copy-deployed script degrades to plain text. |
| [`scripts/solve-ramp.mjs`](scripts/solve-ramp.mjs) | Regenerates the neutral ramp. Run it rather than trusting the table. |
| [`assets/logo/`](assets/logo/) | Five candidate marks, the wordmark, the favicon. **`mark-flag.svg` is the one that ships.** |
| [`assets/readme-header.svg`](assets/readme-header.svg) | The README banner. `.png` beside it is the rendered copy GitHub actually serves. |
| [`assets/social/social-card.svg`](assets/social/social-card.svg) | 1280x640 og:image. GitHub's social-preview upload takes raster only, so the `.png` is the deliverable. |
| [`../site/index.html`](../site/index.html) | The landing page, built from these tokens. |

Stage 01 (thesis), 02 (voice) and 04 (type and form) landed inside `BRAND.md`
rather than in separate reference files. Splitting them would have meant three
documents restating the same decisions, and a decision recorded twice is a
decision that can drift.

## Reproducing the numbers

Nothing here should be trusted from the table. Every claim in `PALETTE.md`
prints the command beside it; these two cover most of them:

```bash
VP=~/.claude/skills/design-direction/scripts/validate-palette.mjs
node $VP accent "#FEDD00" --ground "#0A0C0B"
node $VP status "warning:#BF6408,critical:#FF2E63" --accent "#FEDD00" --ground "#0A0C0B"
```

```bash
node brand/scripts/solve-ramp.mjs 45 0.11 "#0A0C0B"
```

## Regenerating the rasters

The SVGs are the source; the PNGs are build output and are committed because
GitHub cannot render an SVG into a social preview. Re-run this after any edit to
either SVG — a stale PNG beside an edited SVG is the exact drift this project
keeps refusing elsewhere.

```bash
cd brand/assets
npx --yes @resvg/resvg-js-cli --fit-width 1200 --font-monospace-family Menlo \
  --background "#08090A" readme-header.svg readme-header.png
npx --yes @resvg/resvg-js-cli --fit-width 1280 --font-monospace-family Menlo \
  --background "#08090A" social/social-card.svg social/social-card.png
```

ImageMagick is **not** an option here: it shells out to `rsvg-convert`, which is
not installed, and silently falls back to its own renderer — the same card came
out 737 bytes of 1-bit greyscale. Measured, not assumed.

## What is not decided

**Which mark ships.** Five are drawn. `mark-flag.svg` — the bare flag — is the
recommendation; the other four exist so it can be refused on sight. The wordmark
is a separate decision and survives whichever mark wins.

**Whether anything else earns an ink.** All nine verbs colour `refused:` and
`audit-skill` colours its severity column, counts and verdict. Nothing else
does, and `tint.test.mjs` fails if a fifth ink is added — so extending it is a
decision to argue for in `BRAND.md` first, not a one-line change.
