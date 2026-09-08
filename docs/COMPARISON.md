# What `qrntn` is not

`qrntn` sits beside four categories of tool it is routinely mistaken for. Each
of them establishes something real that `qrntn` does not, and naming the
difference is more useful than claiming to be better than any of them.

## Not a scanner

There is a scanner inside `qrntn` and it is not the claim. A scan reports what
it recognises; `qrntn` records what a person decided. The scanner exists to
produce evidence for that decision, and [`THREATS.md`](THREATS.md) states what
it does not catch.

Detection has a recall ceiling. Independent teams have bypassed the detectors
they tested — several inside an hour — and a scanner examines a fixed artefact
while whoever wrote it can keep adjusting until it passes. That asymmetry is the
reason detection is not the last line here, and it is not a criticism of any
particular scanner. Run one. Run several.

## Not a registry, and not signing

A signature proves a skill came from who it says it came from and arrived
unmodified. That is worth having and it is a different claim: it does not
establish that anybody looked at what the skill does.

`qrntn` runs on your machine, against the bytes you actually received, and
requires trusting neither the registry nor the publisher's key.

## Not an eval

An evaluation produces a score. A score is a machine's assessment with nobody's
name against it. The design here is that a named person is answerable for the
row, which is a different artefact serving a different purpose.

## Not a sandbox

Containment is an explicit non-goal, recorded in [`THREATS.md`](THREATS.md).
`qrntn` governs what you let in; a sandbox governs what it does once it is in.
These are complementary controls, and a skill you adopted is outside `qrntn`'s
model entirely from the moment it loads.

---

Compressed to one line: **a scan reports what it recognises · a signature proves
origin · an eval produces a score · a ledger row records that somebody decided.**

## Where everything sits

| | What it establishes | What it leaves undecided |
|---|---|---|
| Scanners | A detector looked and recognised nothing | Whatever it does not recognise, which is measurable and not zero |
| Registry provenance and signing | Who published it, and that the bytes are the published ones | Whether anyone on your side decided. Requires trusting the registry and the publisher's key |
| Automated evaluation | How a skill performs, expressed as a score | A score is not a decision, and no person is answerable for it |
| Contributor vouching | Who may contribute | What any given artefact contains |
| `cargo-vet` (Rust) | A recorded human audit against a specific crate version, enforced by a policy layer | Nothing — it is the pattern this borrows, in a different ecosystem |
| `qrntn` | That a named person decided about these exact bytes, and that a gate enforces the decision | Everything in [`THREATS.md`](THREATS.md) |

The rows above describe categories, not verdicts on particular products, and a
working setup will draw from several of them at once.

## On the numbers in this space

Three widely-quoted figures are commonly mangled. Anyone citing them, including
this project, should date and attribute them.

**The ClawHavoc count has two versions.** The original disclosure is Koi
Security, 2026-02-01: 341 malicious skills of 2,857 then on ClawHub, 335
attributed to the campaign. The **1,184** figure circulating from around
2026-02-19 is a later, expanded count. Both are real and they are snapshots at
different dates — cite one, date it, and say which.

**Snyk's ToxicSkills numbers are four different quantities.** Of 3,984 skills
scanned on 2026-02-05: **1,467** had at least one security flaw · **534** had a
critical issue · **76** were confirmed malicious payloads under human review ·
**8** were still publicly available at publication. Secondary coverage
routinely reports the first figure as though it were the last. The
malicious-payload number is 76.

**The widely-cited scanner benchmark is vendor-authored** — the tool that wins
it is the publisher's own. It is directionally consistent with independent work
finding low recall for pattern-based methods, but the spread should not be
quoted as a neutral measurement.

## Sources

- Trail of Bits, *"The sorry state of skill distribution"*, 2026-06-03 — scanner
  bypasses, including a truncation-window evasion.
- Palo Alto Unit 42 and AIR Security, both 2026-06-23 — further bypasses,
  independently.
- Andrew Nesbitt, *"Skills Registry Threat Models"*, 2026-06-03 — that almost no
  skill loader records the commit SHA it used, and that lockfiles record a name
  and a version rather than the bytes.
- Koi Security, 2026-02-01 — the ClawHavoc disclosure.
- Snyk, *ToxicSkills*, 2026-02-05 — the ecosystem audit.
- OWASP Agentic Skills Top 10, v1.0, 2026-08-17 — AST01 malicious skills, AST02
  supply chain compromise, AST07 update drift.
- *Skill-Inject*, arXiv 2602.20156, 2026-02 — up to 80% attack success against
  frontier models, concluding that the problem needs context-aware
  authorization rather than input filtering.
