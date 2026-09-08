# pratiq — palette

Every number here is reproducible. The command that produced each table is
printed beside it; re-run it rather than trusting the table.

Validator: `~/.claude/skills/design-direction/scripts/validate-palette.mjs`
Ramp solver: `brand/scripts/solve-ramp.mjs` (in this repository)

> **This is a delta on nexus, not a fork.** Three primitives move, each forced by
> a measurement recorded below. Every other value in `nexus/packages/tokens` is
> inherited unchanged, and the semantic layer is untouched — so a component
> written against nexus renders under pratiq without an edit.

---

## Ground

| | Value | Role |
|---|---|---|
| Canvas | `#08090A` | Page ground |
| Surface | `#0A0C0B` | Panels — **every ratio below is measured against this** |
| Raised | `#12110E` | Insets. Re-tinted warm from nexus's `#11150F` |

Measuring against the panel rather than the canvas is inherited from nexus and
is the conservative choice: the panel is lighter, so every ratio quoted here is
the worst case a token faces.

---

## The accent, and what it forces

```bash
node ~/.claude/skills/design-direction/scripts/validate-palette.mjs accent "#FEDD00" --ground "#0A0C0B"
```

| | |
|---|---|
| Accent | `#FEDD00` — Pantone Yellow C, standing in for "plain yellow" |
| OKLCH | L 0.898 · C 0.186 · H 98.2° |
| Contrast vs surface | 14.53:1 |
| Accent-ink | `#000000` at 15.56:1 |

**A · Series.** L 0.898 is far outside the categorical band L 0.48–0.67. Quebec
cannot be a series colour and the validator fails it. This agrees with the rule
the brand already imposes for a different reason — the accent is never data —
so the constraint is doubly held.

**B · Status hues.** Blocked (red-green collapse below ΔE 12, ~8% of males):
**H 70–160°**, worst at 130° with ΔE 0.9 under deuteranopia. That band takes
amber (7.2 / 5.8) and yellow (4.1 / 2.6) off the table permanently. Orange
clears at **20.3 normal / 15.6 deutan**, so a yellow-accented system's warning
is orange — a constraint, not a preference. Red clears at 37.5 / 26.1.

**C · Success.** Green is **not available**: ΔE 4.1 under protanopia. That is a
red-green collapse, so green and Quebec are one colour to roughly 8% of males.
Success is therefore the accent, and no green ships. The semantics agree
independently — the interface's good state is *cleared*, which means a human
decided, not that a machine found it safe. See `BRAND.md`.

**D · Accent-ink.** Black, at 15.56:1. Paper ink on the flag measures **1.14:1**
and is forbidden.

```bash
node ~/.claude/skills/design-direction/scripts/validate-palette.mjs text "#0A0C0B,#F2ECD9" --ground "#FEDD00"
```

---

## Primitives

Named by appearance. This system's private vocabulary; app code may use these
freely, components may not.

| Token | Value | Named for |
|---|---|---|
| `--pq-void` | `#08090A` | Inherited from nexus unchanged |
| `--pq-panel` | `#0A0C0B` | Inherited from nexus unchanged |
| `--pq-raised` | `#12110E` | Nexus's raised, re-tinted warm |
| `--pq-quebec` | `#FEDD00` | **New.** Signal flag Q, by its name in the code of signals |
| `--pq-paper` | `#F2ECD9` | **New.** Ship's papers, not phosphor |
| `--pq-rust` | `#BF6408` | **New.** Nexus's sodium, dimmed to fix severity ordering |
| `--pq-alarm` | `#FF2E63` | Inherited from nexus unchanged. **RESTRICTED** — reachable only through `--pq-critical` |
| `--pq-grey-100 … 600` | see ramp | Re-solved warm at nexus's own targets |

`--pq-quebec` earns its name: Quebec *is* the flag's designation in the
International Code of Signals, so the primitive is named by appearance and by
citation at once.

### The neutral ramp

Nexus's AA ramp is documented as "hue 100deg sat 13%" — a green tint chosen when
the accent was acid. With a yellow accent the tint is re-solved warm **at the
identical contrast targets**, so every step lands on the number the green ramp
already held and nothing downstream of a grey moves.

```bash
node brand/scripts/solve-ramp.mjs 45 0.11 "#0A0C0B"
```

| Token | Value | Target | Measured | For |
|---|---|---|---|---|
| `--pq-grey-100` | `#38352D` | 1.61 | 1.61:1 | Decorative hairline. **Never text** |
| `--pq-grey-200` | `#625E4F` | 3.01 | 3.01:1 | UI boundary — WCAG 1.4.11 |
| `--pq-grey-300` | `#7F7966` | 4.52 | 4.52:1 | Disabled text — WCAG 1.4.3 |
| `--pq-grey-400` | `#8E8772` | 5.50 | 5.47:1 | |
| `--pq-grey-500` | `#A09A89` | 7.00 | 6.99:1 | |
| `--pq-grey-600` | `#BDB9AD` | 10.00 | 10.00:1 | |

The 5.47 and 6.99 are the solver hitting its target and the validator rounding
the same colour a hair differently. Both clear their floors; neither is a miss.

### The immersive ramp — and it is the one that ships

Nexus carries two ramps and pratiq inherits both, for the reason nexus needed
both: `packages/graph`'s edge register gains were **measured off the rendered
scene** against the immersive greys (`nexus/src/adapt/toGraphCanvas.ts`'s
`EDGE_HEX`), so a brand that shipped only the AA ramp would silently lighten
every structural edge in the graph.

`nexus/src/main.tsx` selects **`pratiq-hud`**, so this is what the viewer
actually renders — not the table above.

```bash
node brand/scripts/solve-ramp.mjs 45 0.11 "#0A0C0B" --immersive
```

| Token | Value | Target | Measured | Clears 4.5:1 |
|---|---|---|---|---|
| `--pq-grey-100` | `#22201B` | 1.21 | 1.21:1 | no |
| `--pq-grey-200` | `#36342C` | 1.57 | 1.57:1 | no |
| `--pq-grey-300` | `#4C483D` | 2.14 | 2.14:1 | **no** |
| `--pq-grey-400` | `#5C5749` | 2.72 | 2.72:1 | **no** |
| `--pq-grey-500` | `#736D5C` | 3.80 | 3.80:1 | **no** |
| `--pq-grey-600` | `#87806C` | 4.98 | 4.98:1 | yes |

**Four of these back text roles and three of them fail the floor**, which is
stated here rather than left to be discovered: `grey-300` is `--pq-ink-disabled`,
`grey-400` is nexus's `fg-tertiary`, `grey-500` is `--pq-ink-subtle`. The
targets are nexus's own `hud` numbers, inherited unchanged so that the swap
moved hue and nothing else — but inheriting them means inheriting the failure,
and `BRAND.md`'s contrast non-negotiable carries the matching exception.

This is the open decision, not a settled one. Either the viewer moves to
`pratiq` (AA) and the edge gains are re-measured against the lighter ramp, or
the immersive variant stays and is documented as an opt-in surface the way
nexus documents its own.

---

## Roles

Named by job. **These names are the contract.**

```bash
node ~/.claude/skills/design-direction/scripts/validate-palette.mjs \
  text "#F2ECD9,#BDB9AD,#A09A89,#8E8772,#7F7966" --ground "#0A0C0B"
```

| Role | Maps to | Ratio | Job |
|---|---|---|---|
| `--pq-canvas` | `--pq-void` | — | Page ground |
| `--pq-surface` | `--pq-panel` | — | Panels, insets, table headers |
| `--pq-ambient` | `--pq-grey-100` | — | Subdivision inside a panel. **Never text** |
| `--pq-line` | `--pq-grey-200` | — | The edge of a thing. The default boundary |
| `--pq-ink` | `--pq-paper` | 16.61:1 | Headings, emphasis |
| `--pq-ink-muted` | `--pq-grey-600` | 10.00:1 | Body copy |
| `--pq-ink-subtle` | `--pq-grey-500` | 6.99:1 | Labels, metadata, eyebrows |
| `--pq-ink-disabled` | `--pq-grey-300` | 4.52:1 | Disabled text |
| `--pq-accent` | `--pq-quebec` | 14.53:1 | The signal |
| `--pq-accent-ink` | `#000000` | 15.56:1 | Text on the accent |
| `--pq-warning` | `--pq-rust` | 4.71:1 | Degraded — drift found, pin moved |
| `--pq-critical` | `--pq-alarm` | 5.44:1 | Refused, destructive |

**The primary form device is line.** There is no elevation and no surface step
worth the name, so the boundary ladder carries all structure. One hairline is
never enough — nexus's own component sheet shipped a single 1px border for every
boundary, and a page of them has no hierarchy at squint distance.

| Tier | Colour | Weight | Means |
|---|---|---|---|
| ambient | `--pq-ambient` | `--pq-hairline` | Subdivision inside a panel. Not meant to be noticed |
| line | `--pq-line` | `--pq-hairline` | The edge of a thing. The default — when in doubt, this |
| line-strong | `--pq-line` | `--pq-line-strong-width` | A boundary that outranks its neighbours |
| accent | `--pq-accent` | `--pq-line-strong-width` | Live state. Focus, the held row, the finding |

**Four tiers, three colours.** `line-strong` is `--pq-line` drawn at 2px: it
outranks its neighbours by weight, not by hue. There is deliberately no
`line-strong` **colour** token, because a fourth grey between `grey-200` and
the accent would be a second name for one idea — the thing this document's own
rules forbid. The weight is a token (`--pq-line-strong-width`) so the tier is
still nameable in code.

**Focus.** 2px Quebec outline at 2px offset, **plus a 6px outer glow at 35%**.
The glow is what separates it from hover: hover is a border colour change to the
accent, and without the glow the one state a keyboard user depends on looks
identical to something a mouse user causes by accident. Inherited as a problem
from nexus, which expresses focus as a flat accent outline and has exactly that
collision.

**Deliberately absent.** No `success` — see Consequence C. No `info`: nexus's
data cyan exists as a graph content hue, and promoting it to a role would give
it a second meaning on the one surface it already appears. No `hover-surface`,
`selected` or `disabled-surface`: hover is expressed as a border change, and
adding a fill role for one consumer is a role that has not been earned.

---

## Status

```bash
node ~/.claude/skills/design-direction/scripts/validate-palette.mjs \
  status "warning:#BF6408,critical:#FF2E63" --accent "#FEDD00" --ground "#0A0C0B"
```

| Pair | ΔE | Condition | Verdict |
|---|---|---|---|
| warning ↔ accent | 30.4 | deutan | PASS |
| critical ↔ accent | 26.1 | deutan | PASS |
| warning ↔ critical | 7.7 | deutan | WARN — see below |

**Severity ordering.** Contrast against the ground is loudness, so it must rise
with severity.

| State | Value | Contrast |
|---|---|---|
| warning | `#BF6408` | 4.71:1 |
| critical | `#FF2E63` | 5.44:1 |

**This is a repair.** Nexus as it stands ships the inversion: sodium `#FF8A1E` at
**8.32:1** against alarm `#FF2E63` at **5.44:1**, so "degraded" shouts **1.53×
louder** than "this is worse". Both clear every other check, and the palette was
still telling the reader the wrong thing.

Brightening critical was tried first and is the wrong direction — on a near-black
ground the only way up is paler, and `#FF8FA6` restored the ordering by becoming
a pink that collapsed against warning at ΔE 5.0. Darkening warning to `#BF6408`
holds the text floor at 4.71:1, restores the ordering, and raises separation
from the accent from 14.9 to 30.4.

**warning ↔ critical warns at ΔE 7.7, and that is expected.** Red and orange
collapse under deuteranopia in every palette ever shipped. The mitigation is not
a different hue: **state is never carried by colour alone.** Every chip, row and
badge carries its word — `HELD`, `CLEARED`, `REFUSED` — and the word is
load-bearing, not decorative. That is a component rule, recorded here because
this measurement is what makes it mandatory.

---

## Chart series

The viewer carries data. These four are **inherited from nexus unchanged**
(`nexus/src/data/taxonomy.ts`) and are recorded rather than re-derived — they
colour graph content, which the accent change does not touch.

```bash
node ~/.claude/skills/design-direction/scripts/validate-palette.mjs \
  series "#7CFF4F,#17E2E5,#9D7BFF,#FF8A1E" --surface "#08090A,#0A0C0B"
```

| Slot | Value | Kind |
|---|---|---|
| 1 | `#7CFF4F` | skill — primary content |
| 2 | `#17E2E5` | leaf, scriptFold — depth |
| 3 | `#9D7BFF` | category — structural landmark |
| 4 | `#FF8A1E` | vendor, origin — provenance |

**This set does not clear the validator, and that is a known inherited finding,
not a decision made here.** All four sit outside the L 0.48–0.67 band, and
slot 1 ↔ slot 2 measures **ΔE 5.9 under tritanopia** against a floor of 8.
Tritanopia affects ~0.01%, so this is advisory rather than blocking, and the
existing mitigation is real: `taxonomy.ts` disambiguates every kind by **shape**
(hexagon, square, ring, diamond, triangle, circle) before colour. Flagged for
the product team; out of scope for a brand delta.

Rules that ship with this palette: the accent is never a series colour; status
colours are never reused as series; four is the ceiling and slots are assigned
in fixed order, never cycled.

---

## Type scale

Closed. These are the only sizes that exist. Interface steps are nexus's,
inherited at `--pq-font-scale: 1.15`; display steps are new, and exist only on
marketing surfaces.

| Step | Size | Line height | For |
|---|---|---|---|
| `2xs` | 10.35px | 1.5 | Corner ticks, plate numbers, the smallest chrome label |
| `xs` | 11.50px | 1.5 | Default interface size |
| `sm` | 12.65px | 1.5 | Dense table body |
| `md` | 14.95px | 1.5 | Body copy |
| `lg` | 18.40px | 1.4 | Section heads in the viewer |
| `xl` | 24.15px | 1.2 | The largest size the product itself uses |
| `d1` | 30px | 1.15 | Display — site section heads |
| `d2` | 48px | 1.0 | Display — page heads |
| `d3` | 84px | 0.92 | Display — one per page, at most |

| Token | Value | For |
|---|---|---|
| `--pq-font-mono` | IBM Plex Mono, then nexus's original stack | Logotype, interface, body |
| `--pq-font-display` | Archivo, then a grotesque fallback | Headings on marketing surfaces only |
| `--pq-font-scale` | 1.15 (`pratiq`) · 1 (`pratiq-hud`) | Multiplier on every interface step above |
| `--pq-tracking-label` | 0.14em | Uppercase chrome labels |

Body tracking `0.01em`; display tracking `-0.02em`. Neither is a token — one
consumer each, and a role with one consumer is not a role yet.

**The brand faces are named first and fall through nexus's original stack**, so
a machine without them renders what it rendered before rather than a serif.
Nothing is fetched: the product ships no webfont, and the site is the only
surface that loads one.

The smallest step exists for chrome that must not compete with content — plate
numbers, corner labels, the version string. It is never used for anything a
reader has to parse in sequence.

---

## Form

| | |
|---|---|
| Primary device | Line |
| Radius | `0` — everywhere, no exception, including the mark |
| Elevation | None. No shadow ships |
| Corner ticks | 9px arms, accent, on panels only |

**The consequence that reaches furthest:** every surface is hard-edged, so chart
marks are square-ended and the general advice to round data endpoints is
overridden. Sparkline caps, bar ends and the flag's own corners are all square,
and a rounded one anywhere reads as a different system.

---

## Rejected

The most useful section here.

| Candidate | Failed on | Measured |
|---|---|---|
| `#C6F135` acid, kept as accent | Collapses against the flag it would have to sit beside | ΔE 1.8 deutan vs `#FEDD00`, floor 8 |
| `#F5C400` deeper flag yellow | Blocks orange, which is the only warning hue available | orange ΔE 9.7 deutan, floor 12 |
| `#FFCD00`, `#FFD100` flag yellows | Usable, but lower contrast and no compensating gain | 13.07:1 and 13.43:1 vs `#FEDD00`'s 14.53:1 |
| Green as "cleared" | Red-green collapse against the accent | ΔE 4.1 protan, floor 12 |
| `#FF8FA6` brighter critical | Restores ordering by becoming pink; collapses against warning | ΔE 5.0 tritan |
| `#D96E00` darkened warning | Does not go far enough; ordering still inverted | 5.77:1 vs critical 5.44:1 |
| `#B85F10` darkened warning | Drops below the text floor | 4.37:1, floor 4.5 |
| `#DFF5C7` phosphor as ink | Green-tinted white beside a yellow accent reads as two whites | judgment, not measured — recorded as such |

---

## Unverified

- **`#FEDD00` is an assumption.** The code of signals predates Pantone and
  specifies only "plain yellow". Every number in this document is downstream of
  it and would need re-running if it moves.
- **The warm ink and warm ramp are a judgment call**, not a measurement. The
  arithmetic says only that they clear their floors; the argument that a
  green-tinted white beside a yellow accent reads as two different whites is an
  aesthetic claim and should be labelled one.
- **Nothing has been observed.** All CVD figures are computed simulations. No
  one with a colour vision deficiency has seen this, and nothing has been
  checked in print or on a non-emissive surface.
- **The inherited series set is flagged, not fixed.** If the viewer ever renders
  those four as a legend without shape, the tritan collapse becomes real.
