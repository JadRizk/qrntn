//
// argv.mjs — refuse a flag this tool does not have, instead of ignoring it.
//
// Every command parsed argv with `includes` and `indexOf` and took what it
// recognised. Nothing looked at what was left over, so an unrecognised flag was
// silently dropped and the command ran with its defaults. That is not a
// cosmetic fault:
//
//     qrntn check --librray /some/other/library
//     1 skill(s), 0 edge(s) — clean            exit 0
//
// One transposed letter, and a gate reported `clean` about a library it never
// opened — the working directory answered instead. The correctly spelled
// invocation refuses that same library with exit 2. A CI job consuming the exit
// code cannot tell those apart, and the one thing this tool sells is that
// `clean` means something.
//
// It is also PORTABILITY.md finding 4 arriving by a different road. `refresh`
// run from a foreign directory used to refresh the tree it lived in and say
// nothing about which tree that was; it wrote ten ledger entries by accident
// and was only caught by someone reading `git status`. That was fixed in root
// resolution. The argument parser could still do it, because a flag it did not
// recognise was a flag it did not mention.
//
// So: a token that looks like a flag and is not in the command's own list is a
// usage error, and a usage error is exit 2 — `could not run`, not `ran and the
// answer is no`. The README freezes that distinction and this is the case it
// exists for.
//
// `--library=/x` is refused too, and deliberately. No command here parses the
// `=` form — they all read `argv[indexOf(flag) + 1]` — so before this it was a
// second silent path to the wrong library. Refusing names it.
//
// Values are consumed, never inspected. A value may legitimately look like a
// flag (`--name --weird`), and second-guessing that is how a parser starts
// disagreeing with the command it is parsing for.
//
// No dependencies, and no state. Imported the way tint.mjs and invoked-as.mjs
// are — guarded — because these scripts are still deployed by copying one file
// into a skill's scripts/ folder, where no sibling is beside them.

/**
 * The first token that is not a flag this command has.
 *
 * @param {string[]} argv                 arguments, already sliced past the script
 * @param {{boolean?: string[], valued?: string[]}} spec  what this command takes
 * @returns {{flag: string, suggestion: string|null}|null}  null when every flag is known
 */
export function checkFlags(argv, spec) {
	const valued = new Set(spec.valued ?? [])
	const known = new Set([...(spec.boolean ?? []), ...valued])

	for (let i = 0; i < argv.length; i++) {
		const token = argv[i]

		// A value-taking flag eats the next token whatever it looks like.
		if (valued.has(token)) {
			i++
			continue
		}
		if (known.has(token)) continue

		// Everything after a bare `--` is positional by convention, including
		// a path that begins with a dash.
		if (token === '--') break

		// A lone `-` is a conventional stand-in for stdin, and a bare word is a
		// positional argument. Neither is this function's business.
		if (!token.startsWith('-') || token === '-') continue

		return { flag: token, suggestion: nearest(token, known) }
	}
	return null
}

/**
 * The known flag closest to what was typed, when one is close enough to be
 * worth naming. Two edits on a short flag is already a different word, so the
 * threshold scales with length and stays conservative — a wrong guess sends the
 * reader somewhere worse than no guess at all.
 */
export function nearest(token, known) {
	// `--library=/x` should suggest `--library`, and the distance from the whole
	// string would never find it.
	const head = token.includes('=') ? token.slice(0, token.indexOf('=')) : token
	if (known.has(head)) return head

	const budget = Math.max(1, Math.floor(head.replace(/^-+/, '').length / 4))
	let best = null
	let bestAt = Infinity
	for (const candidate of known) {
		const d = distance(head, candidate)
		if (d < bestAt) {
			bestAt = d
			best = candidate
		}
	}
	return bestAt <= budget ? best : null
}

/**
 * Damerau-Levenshtein (optimal string alignment), which counts a transposition
 * as one edit rather than two.
 *
 * That distinction is the whole reason this function is here. `--librray` for
 * `--library` is a swapped pair — the commonest typo there is, and the one in
 * the defect this module was written for. Plain Levenshtein scores it 2, which
 * falls outside the budget for a flag that length, and the reader gets no
 * suggestion in precisely the case a suggestion is most useful.
 */
function distance(a, b) {
	if (a === b) return 0
	let twoBack = null
	let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
	for (let i = 1; i <= a.length; i++) {
		const row = [i]
		for (let j = 1; j <= b.length; j++) {
			row[j] = Math.min(
				prev[j] + 1,
				row[j - 1] + 1,
				prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
			)
			if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
				row[j] = Math.min(row[j], twoBack[j - 2] + 1)
			}
		}
		twoBack = prev
		prev = row
	}
	return prev[b.length]
}
