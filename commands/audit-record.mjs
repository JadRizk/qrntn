// audit-record.mjs — what a filled-in AUDIT.md has to contain.
//
// The human's half of the lifecycle is a markdown file, and two verbs read it:
// `promote` refuses to move an artefact whose record is unresolved, and
// `adopt` refuses to write a verdict into one. They have to agree on what
// "unresolved" means, and until this file existed the rules lived inside
// promote.mjs, which runs a promotion on import — so the only way for adopt to
// share them was to type them again. Two copies of one contract is how the two
// verbs come to disagree, and disagreeing here means a record adopt accepted is
// one promote refuses, with the human in between and nothing to say why.
//
// Pure functions over the file's text. No filesystem, no output, no exit: the
// caller decides what a problem costs. Plain Node, no dependencies.

// Placeholders left in place are the commonest way a record looks complete and
// says nothing. Each of these is a token the template ships and a filled record
// cannot contain.
export const VERDICT_MENU = /ADOPT\s*·\s*REVISE\s*·\s*REJECT/

export const PLACEHOLDERS = [
	{ re: /YYYY-MM-DD/, why: 'an unfilled date' },
	{ re: VERDICT_MENU, why: 'the verdict menu, not a verdict' },
	{ re: /Ready\s*·\s*Adopt with changes/, why: 'the quality menu, not an assessment' },
	{ re: /Real \/ Accepted \/ False positive/, why: 'the disposition menu, not a disposition' },
	{ re: /<[a-z][^>\n]{2,}>/i, why: 'an unfilled <angle-bracket> field' }
]

export const DISPOSITIONS = /^(real|accepted|false positive|fixed|removed|n\/a)\b/i

// Tolerant of the house format, which bolds the verdict and appends a
// qualifier — "| **Verdict** | **ADOPT** — no findings |". The first version
// of this demanded a bare "| ADOPT |" and so would have refused every audit
// already written in the library this came from, which is a gate enforcing a
// convention nobody uses.
export const VERDICT_RE = /\|\s*\*\*Verdict\*\*\s*\|[\s*]*(ADOPT|REVISE|REJECT)\b/i

// The whole row, so a writer can replace the cell and nothing else.
export const VERDICT_ROW = /^(\|\s*\*\*Verdict\*\*\s*\|)([^|\n]*)(\|.*)$/m

/**
 * The resolved verdict, uppercased, or null when the row is missing or
 * unfilled.
 *
 * The menu the template ships — `ADOPT · REVISE · REJECT` — begins with a
 * verdict, so the row pattern alone reads an unfilled cell as ADOPT. promote
 * never noticed because the placeholder check refuses the menu first; adopt,
 * whose whole job is to fill that cell, would have refused to touch it on the
 * grounds that it was already decided. An unfilled cell is not a verdict.
 */
export function readVerdict(text) {
	const row = VERDICT_ROW.exec(text)
	if (row && VERDICT_MENU.test(row[2])) return null
	return VERDICT_RE.exec(text)?.[1]?.toUpperCase() ?? null
}

/**
 * Findings rows whose disposition cell is blank. A finding nobody decided
 * about is indistinguishable from one nobody read.
 */
export function undecidedFindings(text) {
	let undecided = 0
	for (const line of text.split('\n')) {
		const m = /^\|\s*\d+\s*\|\s*`?([A-Z]+-[A-Z0-9]+)`?\s*\|([^|]*)\|([^|]*)\|/.exec(line)
		if (!m) continue
		if (!DISPOSITIONS.test(m[3].trim())) undecided++
	}
	return undecided
}

/**
 * Every reason this record is not a finished decision, in the order promote
 * has always reported them. Empty means the record is resolved.
 *
 * `verdictOpen` is adopt's case: the verdict is the cell it is about to fill,
 * so a menu still sitting there is expected rather than a problem, and its
 * absence is not one either — everything else still has to be decided.
 *
 * @returns {{why: string, detail: string}[]}
 */
export function checkAuditRecord(text, { verdictOpen = false } = {}) {
	const problems = []
	for (const p of PLACEHOLDERS) {
		if (verdictOpen && p.re === VERDICT_MENU) continue
		if (p.re.test(text)) problems.push({ why: 'AUDIT.md still carries ' + p.why, detail: String(p.re) })
	}

	if (!verdictOpen) {
		const verdict = readVerdict(text)
		// A menu still in the cell was already reported as the placeholder it
		// is; saying "no resolved verdict" as well would be the same fact twice.
		if (!verdict && !VERDICT_MENU.test(text)) problems.push({ why: 'AUDIT.md has no resolved verdict', detail: 'expected a | **Verdict** | ADOPT | row' })
		else if (verdict === 'REJECT') problems.push({ why: 'the verdict is REJECT', detail: 'a rejected skill is deleted with a REJECTED.md row, never promoted' })
		else if (!['ADOPT', 'REVISE'].includes(verdict)) problems.push({ why: `unrecognised verdict "${verdict}"`, detail: 'expected ADOPT, REVISE or REJECT' })
	}

	const undecided = undecidedFindings(text)
	if (undecided) problems.push({ why: `${undecided} finding(s) with no disposition`, detail: 'every row in the findings table needs one' })

	return problems
}
