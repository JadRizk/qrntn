# brand/

The direction, decided before any of it is implemented.

| File | Carries |
|---|---|
| [`BRAND.md`](BRAND.md) | Thesis, voice, typography, non-negotiables. The document a human reads. |
| [`PALETTE.md`](PALETTE.md) | Every colour, with the measured ratio and the command that produced it. The document an implementation reads. |
| [`references/research.md`](references/research.md) | What was cited, and what was refused. |
| [`../nexus/packages/tokens/src/qrntn.css`](../nexus/packages/tokens/src/qrntn.css) | The brand as two nexus themes. Lives in the tokens package, not here — one source of truth, and the viewer imports it. |
| [`../commands/tint.mjs`](../commands/tint.mjs) | The CLI's four inks, behind a guarded import so a copy-deployed script degrades to plain text. |
| [`scripts/solve-ramp.mjs`](scripts/solve-ramp.mjs) | Regenerates the neutral ramp. Run it rather than trusting the table. |
| [`assets/logo/`](assets/logo/) | Five candidate marks, two wordmarks, the favicon. **`mark-flag.svg` is the one that ships.** |
| [`assets/logo/favicon.ico`](assets/logo/favicon.ico) | 16 + 32, packed from two `favicon.svg` renders. The fallback for browsers that skip SVG. |
| [`assets/logo/apple-touch-icon.svg`](assets/logo/apple-touch-icon.svg) | The flag with 20px of room on the ground. `.png` beside it is 180×180 and **opaque** — iOS paints transparency black. |
| [`assets/logo/icon-192.png`](assets/logo/icon-192.png), [`icon-512.png`](assets/logo/icon-512.png) | `mark-flag.svg` rendered at the two sizes the manifest names. |
| [`assets/logo/icon-maskable-512.svg`](assets/logo/icon-maskable-512.svg) | The flag inscribed in the 80% safe circle. `.png` beside it is what Android crops. |
| [`scripts/pack-ico.mjs`](scripts/pack-ico.mjs) | Packs PNGs into an `.ico` without resampling. `png-to-ico`'s CLI takes one input and scales it to every size; this takes the exact renders. |
| [`../site/site.webmanifest`](../site/site.webmanifest) | The PWA manifest. Hex, not tokens — the OS reads it, not the page. `commands/site-kit.test.mjs` pins the copy. |
| [`../site/`](../site/) | Serves copies of the kit and `og.png` (the social card) beside `index.html`. The test above fails if a copy drifts from its source. |
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
GitHub, iOS and every crawler take raster only. Re-run this after any edit to
any SVG — a stale PNG beside an edited SVG is the exact drift this project
keeps refusing elsewhere.

```bash
cd brand/assets
r() { npx --yes @resvg/resvg-js-cli "$@"; }

# The two cards.
r --fit-width 1200 --font-monospace-family Menlo --background "#08090A" readme-header.svg readme-header.png
r --fit-width 1280 --font-monospace-family Menlo --background "#08090A" social/social-card.svg social/social-card.png

# The kit. favicon.ico is 16 + 32 from favicon.svg, packed without resampling.
r --fit-width 16  logo/favicon.svg logo/favicon-16.png
r --fit-width 32  logo/favicon.svg logo/favicon-32.png
node ../scripts/pack-ico.mjs logo/favicon.ico logo/favicon-16.png logo/favicon-32.png
rm logo/favicon-16.png logo/favicon-32.png
r --fit-width 180 --background "#08090A" logo/apple-touch-icon.svg   logo/apple-touch-icon.png
r --fit-width 192 --background "#08090A" logo/mark-flag.svg          logo/icon-192.png
r --fit-width 512 --background "#08090A" logo/mark-flag.svg          logo/icon-512.png
r --fit-width 512 --background "#08090A" logo/icon-maskable-512.svg  logo/icon-maskable-512.png

# What the site serves is a copy, never a reference back into brand/.
cp logo/{favicon.ico,favicon.svg,apple-touch-icon.png,icon-192.png,icon-512.png,icon-maskable-512.png} ../../site/
cp social/social-card.png ../../site/og.png
```

`--background` is belt and braces: every source already paints the ground as
its first rect, and the flag on the ground is the mark. `r` is a function
rather than a variable because zsh does not word-split `$R` — the whole string
becomes one command name that does not exist.

Then check it — every platform spec by script, not by eye:

```bash
node ~/.claude/skills/brand-identity/scripts/check-kit.mjs \
  --dir brand --public site --html site/index.html --manifest site/site.webmanifest
```

Last run, 2026-09-14: `31 pass · 0 advisory · 0 fail`. And
`node commands/site-kit.test.mjs` holds the hex in the head and the manifest to
`--nx-void`, and every file in `site/` to its source under `assets/`.

ImageMagick is **not** an option here: it shells out to `rsvg-convert`, which is
not installed, and silently falls back to its own renderer — the same card came
out 737 bytes of 1-bit greyscale. Measured, not assumed.

## What is not decided

**Which mark ships.** Five are drawn. `mark-flag.svg` — the bare flag — is the
recommendation; the other four exist so it can be refused on sight. The wordmark
is a separate decision and survives whichever mark wins.

**Which wordmark ships.** Two are drawn, and they differ only in whether the
struck vowels are visible. `wordmark.svg` sets the name as typed — flag Q, then
`rntn`. `wordmark-ghost.svg` sets the whole word with `ua`, `a`, `i` and `e`
held at 0.18, so it reads *quarantine* close up and `qrntn` at a glance.
The ghost carries the flag's inversion into the type and costs legibility at
small sizes; the plain one is the recommendation for the favicon and the viewer
whichever way this goes. Neither has been rendered to raster yet.

**Where the site lives.** The head block and the manifest point at
`https://jadrizk.github.io/qrntn/`, chosen on 2026-09-14 because nothing else
was recorded: `qrntn.dev` is noted as *available* in `docs/SHIPPING.md`, not
registered, and GitHub Pages is not yet enabled on the repository. The links in
`site/index.html` are relative and survive either; the four absolute URLs
(canonical, `og:url`, `og:image`, `twitter:image`) assume `site/` is what Pages
publishes as its root. If the origin or the published directory changes, those
four lines and the `Last run` above are what move.

**The tagline.** The head, the card and the README all carry the one-liner —
*records and gates a human decision about an agent skill before it is allowed
to load* — because no tagline has been written. Stage 01 of `brand-identity`
(`references/positioning.md`) is unrun; when it runs, `og:title` and the card
are what change.

**Whether anything else earns an ink.** All nine verbs colour `refused:` and
`audit-skill` colours its severity column, counts and verdict. Nothing else
does, and `tint.test.mjs` fails if a fifth ink is added — so extending it is a
decision to argue for in `BRAND.md` first, not a one-line change.
