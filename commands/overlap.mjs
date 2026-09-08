#!/usr/bin/env node
//
// overlap.mjs — which descriptions compete for the same request.
//
//   node overlap.mjs                      rank every model-invocable pair
//   node overlap.mjs --candidate <dir>    rank one incoming skill against what is held
//   node overlap.mjs --all                include manual-only skills too
//   node overlap.mjs --json               machine-readable, same numbers
//   node overlap.mjs --top N              show N pairs (default 12)
//
// Why this exists. REJECTED.md already prices a description in bytes — a
// permanent slot in every session's context. The routing research prices it a
// second time, in the neighbours: as a library grows, routing accuracy decays,
// and the mechanism is descriptions that overlap. A skill whose description
// covers ground three others also cover does not only cost its own bytes, it
// makes those three fire less reliably. Nothing here measured that.
//
// This is the move edges.json already makes, pointed at the relationships
// nobody declared. A declared edge is a relationship someone wrote down and can
// be checked; this finds the ones that exist in the trigger vocabulary whether
// or not anyone noticed. So a pair edges.json already covers is marked
// `declared` — animate and review-animations overlapping is documented and
// intended. Two skills with a high score and no edge between them is the
// finding.
//
// Two decisions in here were forced by running it and reading the output,
// and both are worth knowing before trusting a row:
//
// 1. MANUAL-ONLY SKILLS ARE EXCLUDED BY DEFAULT. A skill with
//    `disable-model-invocation: true` is never routed to automatically, so it
//    cannot swallow anybody's trigger and nobody can swallow its. edges.json
//    already reasons this way about operative edges — "write one at a
//    manual-only skill and it silently never fires". Nine of the fifteen held
//    skills are manual-only, and excluding them also removes an artefact:
//    five of them carry the sentence "Only runs when explicitly invoked; it
//    does not trigger on its own", which is boilerplate about invocation mode
//    and, before this rule, produced the entire top of the ranking on shared
//    tokens `runs, explicitly, invoked, trigger`. That the fix falls out of a
//    principled rule rather than a blacklist is the reason to prefer it.
//    `--all` puts them back, for the separate question of what a description
//    costs in bytes.
//
// 2. THE HEADLINE NUMBER IS ASYMMETRIC. The phenomenon the research
//    describes is one skill SWALLOWING its neighbours' triggers, and that has
//    a direction: a long description covering many topics can cover a short
//    specific one, while the reverse cannot happen. Cosine is symmetric and
//    normalises by length, so it punishes exactly the skill doing the
//    swallowing — measured here, it ranked apple-design's three named
//    neighbours 29th, 35th and 67th of 105. `coverage` is the number that
//    matches the phenomenon; cosine is kept beside it as the "do these two
//    look alike at all" figure.
//
// REPORTS ONLY. Exits 0 whether it finds everything or nothing, edits no file,
// and refuses no promotion. Same rule as skill-audit and stage 02: the report
// stops and asks, and a human decides. A number that could block an adoption
// would become a threshold someone tunes until their own skill passes.
//
// Plain Node, no dependencies.

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// ── colour, which is optional ───────────────────────────────────────────────
//
// The import is GUARDED because these scripts are deployed by copying ONE FILE
// into a skill's scripts/ folder, where commands/tint.mjs is simply not beside
// them — promote.test.mjs and refresh.test.mjs both do exactly that, and a
// static import turns it into an ERR_MODULE_NOT_FOUND before main() ever runs.
//
// The fallback is not a degraded mode, it is the SAME STRING tint.mjs produces
// on anything that is not a terminal. Colour was only ever a second copy of a
// word that is already there, so a script running without its sibling loses
// nothing but the escape sequences.
let refusalLine = (message) => `refused: ${message}`
try {
	const mod = await import('./tint.mjs')
	refusalLine = mod.refusalLine
} catch {
	// Deployed alone. Plain text is correct, not a failure.
}

// ── how this was invoked, which is also optional ────────────────────────────
//
// Guarded for the same reason colour is, and it is the same hazard: deployed as
// a single file into a skill's scripts/ folder, invoked-as.mjs is not beside
// this one either.
//
// The fallback is not a degraded mode. A script deployed alone was not reached
// through bin/qrntn.mjs, so QRNTN_VERB is unset and the module would return
// this exact string anyway.
let invokedAs = () => `node ${basename(fileURLToPath(import.meta.url))}`
try {
	const mod = await import('./invoked-as.mjs')
	invokedAs = () => mod.invokedAs(import.meta.url)
} catch {
	// Deployed alone. Naming the file is correct, not a failure.
}

// ── the flags this verb has ─────────────────────────────────────────────────
//
// Guarded like the two above. Without the sibling an unrecognised flag goes
// back to being ignored, which is what every command did before argv.mjs
// existed; the shipped package always carries it and `files` gates that.
let checkFlags = () => null
try {
	const mod = await import('./argv.mjs')
	checkFlags = mod.checkFlags
} catch {
	// Deployed alone. No validation, which is where this started.
}

const FLAGS = {
	boolean: ['--all', '--json', '--help', '-h'],
	valued: ['--library', '--candidate', '--top']
}

const HERE = dirname(fileURLToPath(import.meta.url))
// skills/skill-adopt/scripts -> repo root. Resolved from this file's location
// so a copy dropped into a fixture repo measures that fixture, the same
// property check-catalog.mjs relies on.
// ── the library ─────────────────────────────────────────────────────────────
//
// SK-97. Until the split this was `dirname(...)` of this file's own location,
// because the tool lived inside the one library it would ever act on. It does
// not any more, so the root cannot be inferred from where this script sits —
// it is named, or it is the working directory, and either way it is a thing
// the caller can see and change.
function resolveLibrary(argv = process.argv.slice(2)) {
	const i = argv.indexOf('--library')
	if (i !== -1) {
		const value = argv[i + 1]
		if (!value || value.startsWith('--')) {
			console.error(refusalLine('--library needs a directory'))
			process.exit(2)
		}
		return resolve(value)
	}
	return resolve(process.env.SKILL_LIBRARY ?? process.cwd())
}

const LIBRARY = resolveLibrary()

// -- the measure -------------------------------------------------------------

// Structural English plus the words every description here uses by convention
// ("use when ..."). Listed rather than computed: a stopword list you can read
// is auditable, and one derived from the corpus would quietly change meaning
// every time a skill was added.
const STOP = new Set(
	`a an and are as at be been before but by can could did do does for from
has have had how if in into is it its more no not of on once only or other our out over own same
so than that the their them then there these they this those through to too under until up
use used uses using very was way were what when where which while who why will with within
without you your skill skills`.split(/\s+/)
)

// A deliberately small suffix stripper, added because the first run measured
// its own blind spot: `animate` says "how it interrupts" and apple-design says
// "interruptible transitions", `animate` says "animation" and apple-design says
// "animations". Those are the same trigger vocabulary and the raw tokeniser
// scored them as unrelated — apple-design against animate went from 3.4% to
// 9.6% with this in place, which was the difference between the collection's
// most-suspected pair being invisible and being the top row.
//
// It is a stemmer, not a lemmatiser, and not a thesaurus. It merges
// morphological variants of one word; it will never merge "motion" with
// "animation". The "synonyms are invisible" limit in the report's own footer
// survives this entirely. Conservative on purpose: `-ss` is protected so
// "press" does not become "pres", and nothing shorter than four letters is
// touched.
const stem = (t) =>
	t.length < 4
		? t
		: t
				.replace(/(ibility|ability)$/, 'able')
				.replace(/(ations|ation)$/, 'ate')
				.replace(/(ible|able)$/, 'ate')
				.replace(/(ings|ing)$/, '')
				.replace(/ies$/, 'y')
				.replace(/([^s])es$/, '$1')
				.replace(/([^s])s$/, '$1')
				.replace(/ed$/, '')

const tokens = (text) =>
	text
		.toLowerCase()
		.split(/[^a-z]+/)
		.filter((t) => t.length >= 3 && !STOP.has(t))
		.map(stem)
		.filter((t) => t.length >= 3)

// Stems are for matching, not for reading. "implementation" stems to
// "implementate" and "writes" to "writ", which are fine as keys and useless in
// a report whose whole job is to send someone to the two descriptions. This
// keeps the first surface form seen for each stem so the output can name words
// that are actually on the page.
const surfaceForms = (text) => {
	const map = new Map()
	for (const raw of text.toLowerCase().split(/[^a-z]+/)) {
		if (raw.length < 3 || STOP.has(raw)) continue
		const s = stem(raw)
		if (s.length >= 3 && !map.has(s)) map.set(s, raw)
	}
	return map
}

const analyse = (description) => ({ terms: tokens(description), surface: surfaceForms(description) })

// Inverse document frequency over the descriptions. A term shared by every
// skill ("design", in a design-skill library) is worth nothing as evidence of
// collision; a term shared by exactly two is worth a lot. Without this the
// ranking is dominated by the vocabulary the whole collection has in common,
// which is precisely the overlap that does not cause mis-routing.
const idf = (docs) => {
	const df = new Map()
	for (const d of docs) for (const t of new Set(d.terms)) df.set(t, (df.get(t) ?? 0) + 1)
	const n = docs.length
	const w = new Map()
	for (const [t, c] of df) w.set(t, Math.log(n / c))
	return w
}

// Cosine over presence, IDF-weighted. Presence rather than count because a
// description is two or three sentences — a repeated word there is style, not
// emphasis.
const cosine = (a, b, w) => {
	const A = new Set(a.terms)
	const B = new Set(b.terms)
	let dot = 0
	for (const t of A) if (B.has(t)) dot += (w.get(t) ?? 0) ** 2
	const norm = (S) => Math.sqrt([...S].reduce((s, t) => s + (w.get(t) ?? 0) ** 2, 0))
	const d = norm(A) * norm(B)
	return d === 0 ? 0 : dot / d
}

// How much of `b`'s distinctive vocabulary `a` also claims, by IDF weight.
// Asymmetric on purpose: this is the swallowing direction. coverage(a, b) near
// 1 means almost everything that makes b findable is also said by a, which is
// the shape of a skill that takes its neighbour's requests. coverage(b, a) can
// be small at the same time, and that asymmetry is the finding, not noise.
const coverage = (a, b, w) => {
	const A = new Set(a.terms)
	const B = new Set(b.terms)
	let shared = 0
	let total = 0
	for (const t of B) {
		const weight = w.get(t) ?? 0
		total += weight
		if (A.has(t)) shared += weight
	}
	return total === 0 ? 0 : shared / total
}

// The terms actually driving a pair's score, heaviest first. This is what makes
// the report a nudge rather than a verdict: the number says "read these two",
// and the terms say where to look.
const drivers = (a, b, w, limit = 6) => {
	const B = new Set(b.terms)
	return [...new Set(a.terms)]
		.filter((t) => B.has(t))
		.sort((x, y) => (w.get(y) ?? 0) - (w.get(x) ?? 0))
		.slice(0, limit)
		.map((t) => a.surface?.get(t) ?? b.surface?.get(t) ?? t)
}

// -- reading the collection --------------------------------------------------

// Only `description` is read, and only from frontmatter. The body is never
// touched: what routes a request is the description, and a skill that competes
// for the same requests while documenting the difference in its spine still
// competes at the moment routing happens.
const frontmatterOf = (dir) => {
	const p = join(dir, 'SKILL.md')
	if (!existsSync(p)) return {}
	const text = readFileSync(p, 'utf8')
	if (!text.startsWith('---')) return {}
	const end = text.indexOf('\n---', 3)
	if (end === -1) return {}
	const out = {}
	for (const line of text.slice(4, end).split('\n')) {
		const colon = line.indexOf(':')
		if (colon === -1 || /^\s/.test(line)) continue
		const k = line.slice(0, colon).trim()
		if (k) out[k] = line.slice(colon + 1).trim().replace(/^["']|["']$/g, '')
	}
	return out
}

const descriptionOf = (dir) => frontmatterOf(dir).description ?? null

const heldSkills = (repo = LIBRARY) => {
	const dir = join(repo, 'skills')
	if (!existsSync(dir)) return []
	return readdirSync(dir)
		.filter((n) => !n.startsWith('.'))
		.map((n) => ({ name: n, dir: join(dir, n) }))
		.filter((s) => existsSync(join(s.dir, 'SKILL.md')))
		.map((s) => {
			const fm = frontmatterOf(s.dir)
			return {
				...s,
				description: fm.description ?? null,
				manualOnly: String(fm['disable-model-invocation']).toLowerCase() === 'true',
			}
		})
		.filter((s) => s.description)
		.map((s) => ({ ...s, ...analyse(s.description) }))
		.sort((a, b) => a.name.localeCompare(b.name))
}

// A pair already named in edges.json is a relationship someone declared and
// argued for. It still appears — a declared edge is not a licence for any
// amount of overlap — but it is marked, because the unmarked rows are what this
// report exists to surface.
const declaredPairs = (repo = LIBRARY) => {
	const p = join(repo, 'edges.json')
	if (!existsSync(p)) return new Set()
	try {
		const { edges = [] } = JSON.parse(readFileSync(p, 'utf8'))
		return new Set(edges.map((e) => [e.from, e.to].sort().join(' ')))
	} catch {
		// A malformed edges.json is check-catalog.mjs's finding to report, not
		// this script's to duplicate. Degrade to "nothing declared".
		return new Set()
	}
}

const key = (a, b) => [a, b].sort().join(' ')

function rank({ repo = LIBRARY, candidate = null, all = false } = {}) {
	const everything = heldSkills(repo)
	const declared = declaredPairs(repo)
	// IDF is computed over the routable corpus, not the whole collection: the
	// weights should describe the vocabulary a request is actually routed
	// against.
	const held = all ? everything : everything.filter((s) => !s.manualOnly)
	const excluded = everything.length - held.length
	let docs = held
	let cand = null

	if (candidate) {
		const fm = frontmatterOf(candidate)
		if (!fm.description) throw new Error(`no frontmatter description in ${candidate}/SKILL.md`)
		cand = {
			name: basename(candidate),
			dir: candidate,
			description: fm.description,
			manualOnly: String(fm['disable-model-invocation']).toLowerCase() === 'true',
			...analyse(fm.description),
		}
		// The candidate joins the corpus before IDF is computed. It is about to
		// become the next permanent slot, so it is weighed as one.
		docs = [...held, cand]
	}

	const w = idf(docs)
	const source = cand
		? held.map((h) => [cand, h])
		: docs.flatMap((a, i) => docs.slice(i + 1).map((b) => [a, b]))

	const pairs = source.map(([a, b]) => {
		const ab = coverage(a, b, w)
		const ba = coverage(b, a, w)
		// Reported in the swallowing direction: the wider description first.
		const [from, to, cov] = ab >= ba ? [a.name, b.name, ab] : [b.name, a.name, ba]
		return {
			a: a.name,
			b: b.name,
			score: cosine(a, b, w),
			coverage: cov,
			covers: from,
			covered: to,
			declared: declared.has(key(a.name, b.name)),
			shared: drivers(a, b, w),
		}
	})
	// Ranked by the asymmetric number, because that is the phenomenon.
	pairs.sort((x, y) => y.coverage - x.coverage || `${x.a}${x.b}`.localeCompare(`${y.a}${y.b}`))
	return { pairs, held, excluded, candidate: cand, all }
}

// -- report ------------------------------------------------------------------

// Stated in the output, not only in a comment, because the number travels and
// the caveat has to travel with it. Anyone reading a ranking without these four
// sentences will read it as a verdict.
const LIMITS = `  How to read this. "covers" is the headline: the share of one skill's
  distinctive vocabulary, by IDF weight, that the other also claims. It is
  asymmetric, and it is reported in the swallowing direction. "cos" is
  symmetric cosine over the same weights, kept as the do-these-look-alike
  figure. Both are lexical, not semantic, and both have limits worth knowing
  before acting on any row:

    - Synonyms are invisible. "motion" and "animation" are different tokens, so
      two skills competing for the same request in different words score low.
      A low score is not evidence of no collision.
    - A description that disambiguates itself scores WORSE. "For critiquing
      existing motion use review-animations" names the neighbour, which raises
      lexical overlap while lowering real confusion - the opposite of the
      truth. Rows marked (declared) are usually this, and that is what the
      mark is for.
    - There is no threshold. Nothing here is "overlapping" and nothing is
      "fine". The ranking says which two descriptions to read side by side.
    - The corpus is small, so IDF is noisy. A term appearing in two of six
      routable descriptions carries a lot of weight on thin evidence.

  The decision is yours, and it is not in this file.`

function render({ pairs, candidate, excluded, all }, { top = 12 } = {}) {
	const out = ['']
	out.push(
		candidate
			? `overlap - ${candidate.name} against ${pairs.length} routable skill(s)`
			: `overlap - ${pairs.length} pair(s) over the routable skills`
	)
	if (excluded && !all)
		out.push(`           ${excluded} manual-only skill(s) excluded - nothing routes to them, so nothing can swallow their triggers (--all to include)`)
	// The same argument that excludes manual-only skills from the corpus
	// applies to a manual-only candidate. Saying so is the difference between
	// a number that means nothing and a number someone acts on.
	if (candidate?.manualOnly)
		out.push(`           ${candidate.name} is itself manual-only, so these rows are about context cost, not routing - nothing will route to it either way`)
	out.push('')
	const shown = pairs.slice(0, top)
	const width = Math.max(...shown.map((p) => `${p.covers} covers ${p.covered}`.length), 0)
	for (const p of shown) {
		const label = `${p.covers} covers ${p.covered}`.padEnd(width)
		out.push(`  ${(p.coverage * 100).toFixed(0).padStart(3)}%  cos ${p.score.toFixed(3)}  ${label}${p.declared ? '  (declared)' : ''}`)
		if (p.shared.length) out.push(`                     shared: ${p.shared.join(', ')}`)
	}
	if (pairs.length > shown.length)
		out.push(`\n  ... ${pairs.length - shown.length} further pair(s) below ${(shown[shown.length - 1].coverage * 100).toFixed(0)}%`)
	out.push('')
	out.push(LIMITS)
	out.push('')
	return out.join('\n')
}

function main(argv) {
	// This one did not refuse — it ignored the flag and ran the analysis, so a
	// caller asking how to use it got a ranked table instead of an answer. The
	// quieter of the two failures and the easier to keep: nothing looks broken.
	if (argv.includes('--help') || argv.includes('-h')) {
		console.log(`usage: ${invokedAs()} [--candidate <dir>] [--top <n>] [--all] [--library <dir>] [--json]`)
		console.log('  with no --candidate, ranks the held skills against each other')
		return 0
	}
	const bad = checkFlags(argv, FLAGS)
	if (bad) {
		console.error(refusalLine(`unknown option ${bad.flag}`))
		console.error(bad.suggestion ? `  did you mean ${bad.suggestion}?` : `  run \`${invokedAs()} --help\` for what this verb takes`)
		return 2
	}
	const at = (flag) => {
		const i = argv.indexOf(flag)
		return i === -1 ? null : argv[i + 1]
	}
	const candidate = at('--candidate')
	const top = Number(at('--top') ?? 12)
	let result
	try {
		result = rank({
			candidate: candidate ? resolve(process.cwd(), candidate) : null,
			all: argv.includes('--all'),
		})
	} catch (e) {
		console.error(`overlap: ${e.message}`)
		return 2
	}
	if (argv.includes('--json')) {
		console.log(JSON.stringify({ pairs: result.pairs }, null, 2))
		return 0
	}
	console.log(render(result, { top }))
	// Always 0 on a successful read. This reports; it never refuses.
	return 0
}

if (process.argv[1] && process.argv[1].endsWith('overlap.mjs')) process.exit(main(process.argv.slice(2)))

export { tokens, stem, analyse, surfaceForms, idf, cosine, coverage, drivers, frontmatterOf, descriptionOf, heldSkills, declaredPairs, rank, render, STOP }
