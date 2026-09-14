#!/usr/bin/env node
//
// Known-answer tests for overlap.mjs. Run: node overlap.test.mjs
//
// The measure is the whole artefact here, so the assertions are about its
// PROPERTIES rather than about the numbers it happens to produce today. A test
// that pins "apple-design covers animate at 10%" would fail the next time
// anyone edits a description, which is exactly the thing this script exists to
// encourage. So: coverage is asymmetric, cosine is symmetric, a term in every
// document weighs nothing, manual-only skills are out by default, and the
// report never refuses. Those hold whatever the collection grows into.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync, writeSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { analyse, cosine, coverage, declaredPairs, heldSkills, idf, nearestCoverer, rank, render, stem, tokens } from './overlap.mjs'

let pass = 0
const failures = []
// Under the mutation harness the first failure is the whole answer — a mutant
// is caught or it is not — so the suite stops there instead of running the
// rest against a script already known to be broken. mutate.mjs sets this for
// mutant runs only, never for the clean run, and points TMPDIR into the
// sandbox it sweeps, so an early exit leaves nothing behind.
const FAIL_FAST = process.env.QRNTN_FAIL_FAST === '1'
const check = (name, fn) => {
	try {
		fn()
		pass++
	} catch (e) {
		failures.push(`${name}: ${e.message}`)
		if (FAIL_FAST) stopAtFirstFailure()
	}
}
// writeSync, not console: stdout to a pipe is asynchronous on macOS, and a
// line written just before process.exit can be lost — this is the line the
// harness reads the assertion number from.
const stopAtFirstFailure = () => {
	writeSync(1, `\n${pass} passed, 1 failed — stopped at the first, QRNTN_FAIL_FAST\n`)
	writeSync(2, `  FAIL  ${failures[0]}\n`)
	process.exit(1)
}
const ok = (cond, msg) => {
	if (!cond) throw new Error(msg)
}
const eq = (got, want, what = '') => {
	if (JSON.stringify(got) !== JSON.stringify(want))
		throw new Error(`${what} expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`)
}

// -- the tokeniser -----------------------------------------------------------

check('stem merges morphological variants of one word', () => {
	eq(stem('animations'), stem('animation'), 'animations/animation')
	eq(stem('building'), stem('build'), 'building/build')
	eq(stem('transitions'), stem('transition'), 'transitions/transition')
})

check('stem is not a thesaurus — unrelated words stay apart', () => {
	ok(stem('motion') !== stem('animation'), 'motion and animation must NOT merge; that is the stated limit')
})

check('stem protects -ss and leaves short words alone', () => {
	eq(stem('press'), 'press', 'press')
	eq(stem('css'), 'css', 'short word')
})

check('tokens drops stopwords and sub-three-letter words', () => {
	const t = tokens('Use this when the UI is animated')
	ok(!t.includes('use'), 'stopword "use" should be gone')
	ok(!t.includes('the'), 'stopword "the" should be gone')
	ok(t.some((x) => x.startsWith('anim')), `expected an animate-ish stem, got ${JSON.stringify(t)}`)
})

check('surface forms map a stem back to a word actually on the page', () => {
	const a = analyse('Handles animations and transitions')
	const s = stem('animations')
	eq(a.surface.get(s), 'animations', 'surface form')
})

// -- the weights -------------------------------------------------------------

check('a term in every document weighs nothing', () => {
	const docs = [analyse('design colour'), analyse('design motion'), analyse('design layout')]
	const w = idf(docs)
	eq(w.get(stem('design')), 0, 'idf of a universal term')
	ok((w.get(stem('colour')) ?? 0) > 0, 'a term in one of three should carry weight')
})

// -- the two numbers ---------------------------------------------------------

const broad = analyse('animation motion transition spring gesture layout colour typography')
const narrow = analyse('animation motion')

check('cosine is symmetric', () => {
	const w = idf([broad, narrow])
	eq(cosine(broad, narrow, w).toFixed(9), cosine(narrow, broad, w).toFixed(9), 'cosine both ways')
})

check('coverage is asymmetric, and the broad description is the one that covers', () => {
	// Every distinctive word the narrow skill has, the broad one also says —
	// so the broad one covers it completely, while the reverse cannot be true.
	// This asymmetry IS the swallowing phenomenon the report ranks by.
	const w = idf([broad, narrow, analyse('unrelated vocabulary entirely')])
	const forward = coverage(broad, narrow, w)
	const backward = coverage(narrow, broad, w)
	ok(forward > backward, `broad should cover narrow more than the reverse, got ${forward} vs ${backward}`)
	ok(forward > 0.99, `broad says every word narrow says, so coverage should be ~1, got ${forward}`)
})

// -- the collection, against a fixture repository ----------------------------

const ROOT = mkdtempSync(join(tmpdir(), 'overlap-test-'))
const skill = (name, description, { manual = false } = {}) => {
	const dir = join(ROOT, 'skills', name)
	mkdirSync(dir, { recursive: true })
	const invocation = manual ? 'disable-model-invocation: true\n' : ''
	writeFileSync(join(dir, 'SKILL.md'), `---\nname: ${name}\ndescription: ${description}\n${invocation}---\n\n# ${name}\n`)
}

skill('wide', 'animation motion transition spring gesture typography colour layout')
skill('narrow', 'animation motion')
skill('elsewhere', 'database migrations and query planning')
skill('manual', 'animation motion transition spring gesture', { manual: true })
writeFileSync(
	join(ROOT, 'edges.json'),
	JSON.stringify({ edges: [{ from: 'wide', to: 'elsewhere', type: 'referential' }] }, null, 2)
)

check('manual-only skills are excluded by default and returned by --all', () => {
	const held = heldSkills(ROOT).map((s) => s.name)
	eq(held.length, 4, 'heldSkills reads every skill')
	const routable = rank({ repo: ROOT })
	ok(!routable.pairs.some((p) => p.a === 'manual' || p.b === 'manual'), 'manual-only must not appear by default')
	eq(routable.excluded, 1, 'one skill excluded')
	const all = rank({ repo: ROOT, all: true })
	ok(all.pairs.some((p) => p.a === 'manual' || p.b === 'manual'), '--all must put it back')
})

check('the swallowing pair ranks first, in the swallowing direction', () => {
	const { pairs } = rank({ repo: ROOT })
	eq(pairs[0].covers, 'wide', 'the broad skill is the one covering')
	eq(pairs[0].covered, 'narrow', 'the narrow skill is the one covered')
})

check('a declared edge is marked, and an undeclared pair is not', () => {
	const { pairs } = rank({ repo: ROOT })
	const declared = pairs.find((p) => [p.a, p.b].sort().join(' ') === 'elsewhere wide')
	const undeclared = pairs.find((p) => [p.a, p.b].sort().join(' ') === 'narrow wide')
	eq(declared.declared, true, 'wide/elsewhere is in edges.json')
	eq(undeclared.declared, false, 'wide/narrow is not declared — this is the finding')
})

check('declaredPairs degrades to empty on a malformed edges.json', () => {
	const bad = mkdtempSync(join(tmpdir(), 'overlap-bad-'))
	writeFileSync(join(bad, 'edges.json'), '{ not json')
	eq(declaredPairs(bad).size, 0, 'a broken edges.json is check-catalog.mjs to report, not this script to crash on')
	rmSync(bad, { recursive: true, force: true })
})

check('a candidate is compared against the held skills and joins the weighting', () => {
	const cand = join(ROOT, 'incoming', 'newcomer')
	mkdirSync(dirname(cand), { recursive: true })
	mkdirSync(cand, { recursive: true })
	writeFileSync(join(cand, 'SKILL.md'), `---\nname: newcomer\ndescription: animation motion transition\n---\n\n# newcomer\n`)
	const { pairs, candidate } = rank({ repo: ROOT, candidate: cand })
	eq(candidate.name, 'newcomer', 'candidate name')
	eq(pairs.length, 3, 'one row per routable held skill, and no held-to-held rows')
	ok(pairs.every((p) => p.a === 'newcomer' || p.b === 'newcomer'), 'every row involves the candidate')
})

// -- the contract ------------------------------------------------------------

check('the report states its limits in its own output, not only in comments', () => {
	const text = render(rank({ repo: ROOT }), { top: 3 })
	ok(/Synonyms are invisible/.test(text), 'the synonym limit must travel with the number')
	ok(/There is no threshold/.test(text), 'the no-threshold limit must travel with the number')
	ok(/disambiguates itself scores WORSE/.test(text), 'the self-disambiguation limit must travel with the number')
})

check('a manual-only candidate is told its rows are not about routing', () => {
	const cand = join(ROOT, 'incoming', 'manualnewcomer')
	mkdirSync(cand, { recursive: true })
	writeFileSync(
		join(cand, 'SKILL.md'),
		`---\nname: manualnewcomer\ndescription: animation motion transition\ndisable-model-invocation: true\n---\n\n# m\n`
	)
	const text = render(rank({ repo: ROOT, candidate: cand }), { top: 3 })
	ok(/not routing/.test(text), 'a manual-only candidate must be told the rows are about context cost')
})

// -- the reduction the consumers take --------------------------------------

// nearestCoverer exists because a ranking of every pair is the wrong shape for
// anything downstream, and the obvious fix — keep the pairs above N% — is the
// threshold this script refuses on the record. So the assertions below are
// about it being a RANK: one row per skill, no constant anywhere, and an
// answer that does not depend on the order the pairs arrived in.

check('nearestCoverer keeps one row per skill, and it is the strongest', () => {
	const { pairs } = rank({ repo: ROOT })
	const best = nearestCoverer(pairs)
	// At most one row per skill, however many pairs name it. That is the bound,
	// and it holds by construction rather than by a cutoff.
	ok(best.size <= heldSkills(ROOT).length, 'more rows than there are skills')
	eq(best.get('narrow').covers, 'wide', 'narrow is covered by wide')
	// And it really is the maximum, not the first one seen.
	const forNarrow = pairs.filter((p) => p.covered === 'narrow' && !p.declared)
	eq(best.get('narrow').coverage, Math.max(...forNarrow.map((p) => p.coverage)), 'the strongest coverer')
})

check('a declared pair is dropped by default and returned on request', () => {
	// Synthetic rather than off the fixture, because the assertion is about the
	// reduction and the fixture's declared pair is two skills with nothing in
	// common — it is excluded by the zero rule before `declared` is ever read,
	// which would make this pass for the wrong reason. The real path, on a
	// library where a declared pair genuinely overlaps, is covered where it
	// matters: nexus/src/data/export.test.ts draws no measured edge between
	// two skills edges.json already joins.
	const declared = [{ covers: 'wide', covered: 'twin', coverage: 0.8, shared: ['typography'], declared: true }]
	eq(nearestCoverer(declared).size, 0, 'a declared pair survived the default reduction')
	const kept = nearestCoverer(declared, { includeDeclared: true })
	eq(kept.size, 1, 'includeDeclared dropped the row instead of keeping it')
	eq(kept.get('twin').covers, 'wide', 'the coverer')
})

check('the answer does not depend on the order the pairs arrived in', () => {
	// A caller that filtered or concatenated its own list has not promised
	// rank()'s sort order. Two coverers at the same share must resolve the same
	// way whichever is seen first, or the report churns between runs.
	const tie = (covers, covered) => ({ covers, covered, coverage: 0.5, shared: [], declared: false })
	const forwards = nearestCoverer([tie('alpha', 'target'), tie('beta', 'target')])
	const backwards = nearestCoverer([tie('beta', 'target'), tie('alpha', 'target')])
	eq(forwards.get('target').covers, backwards.get('target').covers, 'a tie resolved by arrival order')
	eq(forwards.get('target').covers, 'alpha', 'a tie breaks on the coverers name')
})

check('an empty ranking reduces to nothing, not to a crash', () => {
	eq(nearestCoverer([]).size, 0, 'an empty ranking')
})

check('a skill nothing overlaps has no coverer, rather than a weakest one', () => {
	// `elsewhere` is about database migrations and shares no distinctive
	// vocabulary with anything here. A reduction that takes the maximum would
	// hand it whichever pair scored zero least recently and call that its
	// nearest coverer — a relationship asserted where none exists at all. Zero
	// is the absence of the measurement, not a small value of it.
	const { pairs } = rank({ repo: ROOT })
	ok(pairs.some((p) => p.covered === 'elsewhere' || p.covers === 'elsewhere'), 'the fixture no longer has an unrelated skill')
	const best = nearestCoverer(pairs)
	ok(!best.has('elsewhere'), 'a skill with nothing in common was given a coverer')
	for (const p of best.values()) ok(p.coverage > 0, `${p.covers} -> ${p.covered} was drawn at zero`)
})

// -- where the skills are read from ------------------------------------------

check('the skills directory can be named apart from the library', () => {
	// usage.mjs takes --library and --skills as independent flags. The measure
	// has to be pointable at the directory the rows it is joined to came from,
	// or one table ends up holding two populations.
	const elsewhere = mkdtempSync(join(tmpdir(), 'overlap-skills-'))
	try {
		mkdirSync(join(elsewhere, 'only-one'), { recursive: true })
		writeFileSync(join(elsewhere, 'only-one', 'SKILL.md'), `---\nname: only-one\ndescription: animation motion transition\n---\n\n# only-one\n`)
		const names = heldSkills(ROOT, elsewhere).map((s) => s.name)
		eq(names, ['only-one'], 'the named directory was not the one read')
		// edges.json still comes from the library, not from the skills tree.
		const { pairs } = rank({ repo: ROOT, skillsDir: elsewhere })
		eq(pairs, [], 'one skill cannot pair with anything')
	} finally {
		rmSync(elsewhere, { recursive: true, force: true })
	}
})

rmSync(ROOT, { recursive: true, force: true })

console.log(`\n  ${pass} passed · ${failures.length} failed\n`)
for (const f of failures) console.log(`  FAIL  ${f}`)
process.exit(failures.length ? 1 : 0)
