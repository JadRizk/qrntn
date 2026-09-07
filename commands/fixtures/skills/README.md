Fixture skills for `usage.test.mjs`.

Not real skills. They exist so the *cost* half of `--report` has a known answer,
the way `../transcripts/` gives the *usage* half one. Each description was
written to a counted length before any of it was run, and two carry an em dash
so that counting characters instead of UTF-8 bytes changes the number.

| Directory | description | chars | bytes | in the transcript fixtures |
|---|---|---|---|---|
| `artifact-design` | `Alpha — beta.` | 13 | 15 | 5 invocations |
| `dataviz` | `Charts — plots.` | 15 | 17 | 3 |
| `run` | `Runs it.` | 8 | 8 | 1, and manual-only |
| `undated-skill` | `Undated — once.` | 15 | 17 | 1, from a record with no timestamp |
| `never-fired` | `Never — not once.` | 17 | 19 | 0 |
| `no-description` | *(none)* | 0 | 0 | 0 |
| `not-a-skill` | *(no SKILL.md at all)* | — | — | not a skill |

`code-review:code-review` and `figma:implement-design` are invoked in the
transcript fixtures and deliberately have no directory here: they are the
"invoked but not held" population, and a report that folded them in would
divide an invocation count by a byte total that never included them.
