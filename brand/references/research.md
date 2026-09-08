# Stage 00 — research

What this identity is entering, and what it refuses. Cited, not recalled.

## The flag itself

**International Code of Signals — flag Q, "Quebec".** A plain yellow rectangle
with no device on it. The ICS uses only blue, yellow, red, black and white,
chosen for recognisability at sea, and is maintained by the IMO.

- *Taken:* the whole thing — proportion, colour, and the rule that nothing is
  printed on it. The blankness is the specification, not a simplification.
- *Refused:* the rest of the alphabet. A system that used more than one flag
  would be spelling something, and `qrntn` is a name, not a hoist.
- <https://en.wikipedia.org/wiki/International_maritime_signal_flags>
- <https://www.crwflags.com/fotw/flags/xf~ics.html>

**The inversion, which is the thesis.** Historically the yellow jack marked a
vessel that *was, or might be, harbouring a dangerous disease*; yellow marked
infected houses before it ever went to sea. Under the modern code, Q flown alone
reads *"my vessel is healthy, I request free pratique"* — and QQ, "I require
health clearance." Same rectangle, opposite meanings, separated only by whether
an inspection has happened.

- *Taken:* the inversion, entire. It is the product.
- *Refused:* the plague imagery. `qrntn` holds things in quarantine; it does
  not call them diseased, and a skill awaiting a decision is not an infection.
- <https://en.wikipedia.org/wiki/Yellow_Jack_(flag)>
- <https://www.crwflags.com/fotw/flags/xf~q.html>

**No official colour exists.** The code of signals predates Pantone and
specifies only "plain yellow"; flag suppliers differ, and a standards discussion
confirms no formal Pantone assignment was ever made for ICS flags. `#FEDD00`
(Pantone Yellow C) is therefore a choice, recorded as one in `PALETTE.md`.

- <https://forums.sailinganarchy.com/threads/marine-signal-flag-standards.57696/>

## The shelf it lands on

**Snyk.** A geometric shield of interlocking lines with an open centre, in deep
green, with a lowercase sans wordmark.
**Socket.dev**, **Sigstore.** The same family of moves: shield, lock, signature,
green-and-blue, "we verified this for you."

- *Refused wholesale.* Every one of these marks asserts a machine-determined
  safety verdict. `qrntn`'s README opens by refusing exactly that claim — it
  has a scanner inside it and says that is not the claim — so a shield would be
  the logo contradicting the first paragraph of the documentation.
- *Taken:* the positioning lesson only. On an npm page beside these, a yellow
  rectangle is the only mark that is not a blue or green badge, and that
  legibility is worth more than any amount of craft spent on a better shield.
- <https://brandfetch.com/snyk.io> · <https://brandfetch.com/socket.dev> ·
  <https://brandfetch.com/sigstore.dev>

**`cargo-vet` (Mozilla).** The closest thing in any ecosystem to what `qrntn`
does: in-tree audit records, named criteria, a tool that certifies and never
edits.

- *Taken:* the posture — sober, documentary, no salesmanship.
- *Refused:* nothing, because there is almost nothing to refuse. It ships
  essentially no visual identity, which is the gap this work fills rather than a
  model to copy.

## The system it extends

**`nexus/packages/tokens`.** The project's own HUD/CRT system: `#08090A` void,
an acid `#C6F135` accent, phosphor ink, zero radius, corner ticks, a capped
0.94Hz blink held under the WCAG 2.3.1 seizure threshold, and contrast figures
recorded beside every primitive.

- *Taken:* the ground, the discipline, and above all the habit of writing the
  measured ratio next to the colour. That habit is why two real defects in this
  palette were findable at all.
- *Refused:* the acid accent — it measures ΔE 1.8 from the flag under
  deuteranopia and cannot coexist with it — and the phosphor-green ink, which
  reads as a second white beside a yellow accent.
