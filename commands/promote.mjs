#!/usr/bin/env node
// promote — move an adjudicated skill out of quarantine, or refuse to.
//
//   node promote.mjs <name> [--dry-run] [--json]
//
// Every other gate in `skill-adopt` is a condition an agent checks and could
// reason its way past. This one cannot be reasoned with, which is the entire
// reason it exists as a script rather than as a sentence in a spine. The
// material being processed is untrusted text written to be read as
// instructions; an enforcement layer living inside the reader is not an
// enforcement layer.
//
// It re-scans the ADAPTED artefact rather than trusting the scan from stage 00,
// because by this point those are different files.
//
// NOTE, because it is the one thing here that is not read-only: runTests()
// executes `node` against the artefact's own *.test.mjs files. That is the first
// and only point in the whole pipeline where code from an untrusted source runs
// — skill-intake executes nothing, and every earlier stage reads. It happens
// after the scan, the adjudication, the adaptation, the re-scan and an explicit
// human decision to adopt, because a test cannot be verified without running it.
// Deliberate, late, and stated here so nobody has to find it by reading.
//
// Plain Node, no dependencies, in keeping with AUTHORING.md.

import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cpSync, existsSync, lstatSync, readFileSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join, relative, resolve } from 'node:path'
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
	boolean: ['--dry-run', '--json', '--help', '-h'],
	valued: ['--library']
}

// Two roots, and until SK-97 they were one name for both.
//
// TOOL is where this program's own parts live — the scanner it re-scans with,
// the ledger writer, the catalog check. LIBRARY is the user's data: skills/,
// ledger/, inbox/, catalog.json. They were the same directory while the tool
// lived inside the one library it would ever act on, so a single `REPO` served
// both and nothing distinguished them.
//
// The split made them different directories, and four defects followed from the
// code still having one word for two things — all four in this file, because it
// is the only one that spawns other scripts. Naming them apart is what makes
// `join(LIBRARY, …)` and `join(TOOL, …)` claims a reader can check on sight
// rather than after a gate run.
const HERE = dirname(fileURLToPath(import.meta.url))
const TOOL = HERE
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
const INBOX = join(LIBRARY, 'inbox')
const SKILLS = join(LIBRARY, 'skills')

const refusals = []
const refuse = (why, detail) => refusals.push({ why, detail })

// TEXT THE ARTEFACT CHOSE, on its way into a refusal a human reads on a
// terminal. Two details here quote file names from inside the artefact — the
// re-scan's blocking findings, and the files that diverged from ORIGIN.md —
// and a file name is the author's to pick: any length, any byte, on the
// filesystems this runs on. Interpolated raw, a name can carry a live terminal
// escape onto the reader's screen, which is what THREATS.md says the evidence
// channel neutralises and what adopt.mjs was found doing one review earlier.
// This is the gate that runs last, so the same bound applies here: whitespace
// collapsed, capped, anything outside printable ASCII written as its escape.
//
// A second copy of audit-skill.mjs's `fragment` rather than an import, for the
// reason every other sibling here is imported behind a guard: this file is
// deployed alone into a sandbox by its own suite. promote.test.mjs asserts the
// detail equals exactly what the scanner's `fragment` produces, so the copy
// cannot drift silently — the arrangement bin/qrntn.mjs has with VERB_ENV.
function fromArtefact(text, max = 60) {
	const flat = String(text).replace(/\s+/g, ' ').trim()
	const cut = flat.length > max ? `${flat.slice(0, max)}…` : flat
	return cut.replace(/[^\x20-\x7e…]/g, (ch) => {
		const cp = ch.codePointAt(0)
		return cp > 0xffff ? `\\u{${cp.toString(16)}}` : `\\u${cp.toString(16).padStart(4, '0')}`
	})
}

// ── spawning this program's own interpreter ─────────────────────────────
//
// `process.execPath`, never the bare string 'node'. A bare name is a PATH
// lookup, and PATH is not guaranteed to hold the interpreter that is running
// this file — under fnm, volta or asdf it resolves through a shim, and in a
// launch context with a thin environment it resolves to a different Node or to
// nothing at all. Promotion would then re-scan and write the ledger with an
// interpreter nobody chose, or refuse with a reason that names the scanner
// rather than the missing `node`.
//
// check.mjs already spawns its gates this way. These four call sites did not,
// and four copies of one decision is how they came to disagree — so it is a
// helper now, and there is one place left to get it wrong.
const node = (args, opts = {}) => spawnSync(process.execPath, args, { encoding: 'utf8', ...opts })

// The tail of a failed spawn, as a sentence a refusal can carry.
//
// `r.stdout` and `r.stderr` are null when the child never launched, and
// `null + null` is 0 rather than '' — so `(r.stdout + r.stderr).trim()` threw a
// TypeError on the one path that most needs to produce a reason, turning three
// named refusals into a raw stack trace. A crash exits non-zero and so reads
// exactly like a refusal, while having refused nothing.
//
// A spawn that fails to start carries its reason in `r.error` and nowhere else.
// Naming it is the difference between 'the ledger write exits non-zero' with an
// empty detail and one that says ENOENT.
//
// The `r.error` branch has no test. It cannot be reached from the CLI now that
// the interpreter is process.execPath, and reaching it directly means importing
// this file — which today runs a promotion on import, because promote.mjs has
// no `isMain` guard where audit-skill, check-catalog, ledger, refresh and usage
// all have one. That guard is the prerequisite, and it is not written yet.
function spawnDetail(r, lines) {
	const out = ((r.stdout ?? '') + (r.stderr ?? '')).trim()
	if (out) return out.split('\n').slice(-lines).join(' · ')
	if (r.error) return `${r.error.code ?? r.error.name}: ${r.error.message}`
	return `exit ${r.status}, no output`
}

// ── the audit record's machine-checkable contract ────────────────────────────
//
// The rules lived here until `adopt` needed them too. This file runs a
// promotion on import, so the only way to share them was to move them out:
// audit-record.mjs holds the placeholders, the disposition rule and the verdict
// row, and both verbs read the same ones. Guarded like the siblings above, but
// with no degraded mode — there is no honest fallback for a contract, so its
// absence is reported as the packaging fault it is.
let auditRecord = null
try {
	auditRecord = await import('./audit-record.mjs')
} catch {
	// Reported by readAudit, once there is somewhere to report it.
}

function readAudit(dir) {
	const path = join(dir, 'AUDIT.md')
	if (!existsSync(path)) {
		refuse('no AUDIT.md', 'nothing has been adjudicated; there is no record to promote against')
		return null
	}
	if (!auditRecord) {
		refuse('audit-record.mjs is missing beside this script', `expected ${join(HERE, 'audit-record.mjs')} — a packaging fault, not something you did; please report it`)
		return null
	}
	const text = readFileSync(path, 'utf8')
	for (const p of auditRecord.checkAuditRecord(text)) refuse(p.why, p.detail)
	return { text, verdict: auditRecord.readVerdict(text) }
}

// ── arrival hashes versus what is on disk now ────────────────────────────────

function parseInventory(dir) {
	const path = join(dir, 'ORIGIN.md')
	if (!existsSync(path)) {
		refuse('no ORIGIN.md', 'provenance is missing — this did not come through skill-intake')
		return null
	}
	const text = readFileSync(path, 'utf8')
	if (!/\*\*Resolved commit\*\*\s*\|\s*`[0-9a-f]{7,40}`/.test(text)) {
		refuse('ORIGIN.md records no resolved commit', 'a branch name is not an identity')
	}
	const inventory = new Map()
	for (const line of text.split('\n')) {
		const m = /^\|\s*`([^`]+)`\s*\|\s*\d+ B\s*\|\s*`([0-9a-f]{64})`\s*\|/.exec(line)
		if (m) inventory.set(m[1], m[2])
	}
	return inventory
}

// lstat, not stat. A broken symlink — which intake permits, since it refuses
// only the ones escaping the artefact — made this throw ENOENT and take the
// whole gate down with an uncaught stack trace. A gate that crashes has not
// refused; it has failed to answer, and the exit code looks the same.
//
// Symlinks are then skipped rather than hashed, because ORIGIN.md records them
// without a hash too, so both sides of the comparison agree. The cost is that a
// symlink appearing or changing during adaptation does not by itself oblige an
// adaptation-log entry. The re-scan still reports it as STRUCT-SYMLINK, which
// is where a symlink belongs anyway.
const walk = (dir, root = dir, acc = []) => {
	for (const e of readdirSync(dir)) {
		const abs = join(dir, e)
		const st = lstatSync(abs)
		if (st.isSymbolicLink()) continue
		if (st.isDirectory()) walk(abs, root, acc)
		else acc.push(relative(root, abs))
	}
	return acc
}

const sha256 = (p) => createHash('sha256').update(readFileSync(p)).digest('hex')

function checkAdaptationLog(dir, inventory, audit) {
	if (!inventory || !audit) return
	const RECORD = ['ORIGIN.md', 'AUDIT.md']
	const now = walk(dir).filter((f) => !RECORD.includes(f))
	const changed = now.filter((f) => !inventory.has(f) || inventory.get(f) !== sha256(join(dir, f)))
	const removed = [...inventory.keys()].filter((f) => !now.includes(f))
	const diverged = [...changed, ...removed]
	if (!diverged.length) return

	// The strongest check here. Bytes differing from arrival is expected and
	// fine — it is what adaptation means. Bytes differing with nothing saying
	// why is a record describing a file that no longer exists.
	if (!/##\s*Changes applied/i.test(audit.text)) {
		refuse(
			`${diverged.length} file(s) differ from ORIGIN.md with no adaptation log`,
			// Explicit arrow, not `.map(fromArtefact)`: map hands the index as
			// the second argument, which is `max`, and the first draft of this
			// line bounded every name to zero characters. promote.test.mjs
			// caught it, by comparing against the scanner's own function.
			`changed: ${diverged.slice(0, 6).map((f) => fromArtefact(f)).join(', ')}${diverged.length > 6 ? '…' : ''} — add a "## Changes applied" section to AUDIT.md`
		)
	}
}

// ── the re-scan ──────────────────────────────────────────────────────────────

// The scanner this gate re-scans with, in order of precedence.
//
// SK-97: the sibling comes FIRST, and the order is the point. This gate refuses
// to promote anything it cannot re-scan, so before the split — when the only
// candidates were the library's own copy and whatever is installed under
// ~/.claude — the tool pointed at a foreign library would have refused
// everything, having found no scanner at all.
//
// It also settles a question the old order got backwards. A scanner supplied by
// the library being promoted into is an input from the same place as the
// artefact under audit; letting it decide whether that artefact is safe is the
// shape of the problem, not the solution. The copy that ships with this tool is
// the one whose behaviour these refusals were written against, so it wins, and
// the others remain only as a fallback for a tool running without its own.
function locateScanner() {
	const candidates = [
		join(TOOL, 'audit-skill.mjs'),
		join(SKILLS, 'skill-audit', 'scripts', 'audit-skill.mjs'),
		join(homedir(), '.claude', 'skills', 'skill-audit', 'scripts', 'audit-skill.mjs')
	]
	return candidates.find(existsSync) ?? null
}

// `extraBlocking` names codes that count as blocking here even where
// skill-audit itself rates them REVIEW or NOTE. Used only on the authored
// path: an acquired skill's over-long description or over-cap spine is a
// call stage 02's human adjudication already makes; an authored skill has no
// such stage, so promote.mjs has to hold that line itself. Passing nothing
// reproduces the exact acquired-path filter this had before.
function rescan(dir, extraBlocking = []) {
	const scanner = locateScanner()
	if (!scanner) {
		refuse('skill-audit not found', 'the adapted artefact cannot be re-scanned, so it cannot be promoted')
		return
	}
	const r = node([scanner, dir, '--json', '--exclude', 'AUDIT.md', '--exclude', 'ORIGIN.md'])
	let parsed = null
	try { parsed = JSON.parse(r.stdout) } catch { /* asserted below */ }
	if (!parsed) {
		refuse('the re-scan produced no readable result', spawnDetail(r, 5))
		return
	}
	const blocking = (parsed.findings ?? []).filter((f) => f.sev === 'BLOCK' || extraBlocking.includes(f.code))
	if (blocking.length) {
		refuse(
			`${blocking.length} blocking finding(s) in the adapted artefact`,
			blocking.map((f) => `${f.code} ${fromArtefact(f.file)}`).slice(0, 5).join(', ')
		)
	}
}

// ── authored-only: no ORIGIN.md, no AUDIT.md to check against ────────────────

// Acquired skills get their catalog entry and their listing in the index as a
// stage 06 step, after promotion — the human wiring lags the file move by
// design. An authored skill has no separate adjudication stage to catch a
// listing nobody added, so `skill-new` is asked to file it first and this
// checks that it actually did, before promote.mjs does anything with the
// files.
function checkCatalogEntry(name) {
	const path = join(LIBRARY, 'catalog.json')
	if (!existsSync(path)) {
		refuse('no catalog.json entry', `${path} does not exist`)
		return
	}
	let catalog
	try {
		catalog = JSON.parse(readFileSync(path, 'utf8'))
	} catch (e) {
		refuse('catalog.json is not valid JSON', String(e.message))
		return
	}
	const filed = new Set((catalog.categories ?? []).flatMap((c) => c.skills ?? []))
	if (!filed.has(name)) {
		refuse('no catalog.json entry', `catalog.json has no category listing "${name}" — file it before promoting, not after`)
	}
}

// Runs the repo's own catalog check against catalog.json and edges.json as
// they stand right now — before the artefact moves — so a category malformed
// by hand, a skill no category claims, or an edge that cannot resolve is
// caught here rather than surfacing later as a red gate with no artefact left
// in the inbox to explain it. check-catalog.mjs is the validation half of the
// atlas build this used to run (retired, SK-51): the same refusals, no page.
function checkCatalog() {
	// Sibling first, for the same reason as the scanner and the ledger: this is a
	// tool asset, not library data, and the library is not required to contain a
	// copy of the tool. It is still RUN with the library as its working
	// directory, because what it validates is the library's catalog.
	const script = [join(TOOL, 'check-catalog.mjs'), join(LIBRARY, 'scripts', 'check-catalog.mjs')].find(existsSync)
	if (!script) {
		refuse('check-catalog.mjs not found', `looked beside this script and in ${join(LIBRARY, 'scripts')} — the catalog cannot be verified before promoting`)
		return
	}
	const r = node([script], { cwd: LIBRARY })
	if (r.status !== 0) {
		refuse('the catalog check exits non-zero', spawnDetail(r, 5))
	}
}

// ── the ledger, across a process boundary ───────────────────────────────────
//
// This used to be `import { writeStructural } from '../../../scripts/ledger.mjs'`
// — three levels up, out of the skill and into whichever repository happened to
// contain it. SK-86 measured what that costs: installed anywhere else this
// script cannot start at all, dying on ERR_MODULE_NOT_FOUND before any of its
// own checks run, which is why `skill-adopt` shipped in this repo's plugin
// manifest while being unable to run outside it.
//
// A spawn is the same shape as checkCatalog() above, and it fails the way
// everything else here fails: as a named refusal listing where it looked.
function ledgerScript() {
	// Beside this script once the tool is one repository; under the library's
	// scripts/ while the pipeline still lives inside the collection it serves.
	for (const candidate of [join(TOOL, 'ledger.mjs'), join(LIBRARY, 'scripts', 'ledger.mjs')]) {
		if (existsSync(candidate)) return candidate
	}
	return null
}

function checkLedgerReachable() {
	if (ledgerScript()) return
	refuse(
		'ledger.mjs not found',
		`looked beside this script and in ${join(LIBRARY, 'scripts')} — the ledger entry could not be written`
	)
}

function writeLedgerEntry(name, skillDir, date) {
	const script = ledgerScript()
	const r = node([script, '--write-structural', name, '--skill-dir', skillDir, '--date', date, '--library', LIBRARY])
	if (r.status !== 0) {
		refuse('the ledger write exits non-zero', spawnDetail(r, 3))
		return false
	}
	return true
}

// ── the skill's own tests, where it has any ──────────────────────────────────

// `skillMdText`, when passed, is searched for a written statement that the
// skill ships nothing executable — the escape hatch for a scripts/ directory
// that holds a non-test .mjs file which genuinely computes nothing (a config
// stub, a data file with a .mjs extension). Only the authored path passes it:
// the acquired path has no equivalent record to check here, and adding one
// unasked would be a behaviour change criterion 4 forbids.
function runTests(dir, skillMdText = null) {
	const scripts = join(dir, 'scripts')
	if (!existsSync(scripts)) return { ran: 0 }
	const present = readdirSync(scripts)
	const tests = present.filter((f) => f.endsWith('.test.mjs'))
	const selfTest = present.includes('self-test.mjs') ? 'self-test.mjs' : null
	const computes = present.some((f) => f.endsWith('.mjs') && !f.endsWith('.test.mjs') && f !== 'self-test.mjs')
	const shipsNothingExecutable = skillMdText != null && /ships nothing executable/i.test(skillMdText)

	if (computes && !tests.length) {
		if (!shipsNothingExecutable) {
			refuse('scripts/ ships executables but no *.test.mjs', 'a skill that computes ships the tests that check it')
		}
		return { ran: 0 }
	}
	// AUTHORING.md asks for two layers, and the spine's gate says "both layers
	// exist and pass". Checking only the first would have made that sentence
	// false — a suite that has only ever passed has not been tested.
	if (computes && !selfTest) {
		refuse('scripts/ ships tests but no self-test.mjs', 'the mutation layer is the one that shows the tests catch anything')
		return { ran: tests.length }
	}
	for (const t of [...tests, ...(selfTest ? [selfTest] : [])]) {
		const r = node([join(scripts, t)])
		if (r.status !== 0) refuse(`tests failed: ${t}`, spawnDetail(r, 3))
	}
	return { ran: tests.length + (selfTest ? 1 : 0) }
}

// ── main ─────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2)

// One synopsis, two callers: `--help` asks for it and gets 0, and running with
// no name is a usage error and gets 2. This verb answered --help with 2, which
// says "you made a mistake" to someone who asked a question.
const synopsis = () => `usage: ${invokedAs()} <name> [--dry-run] [--library <dir>] [--json]`

if (args.includes('--help') || args.includes('-h')) {
	console.log(synopsis())
	process.exit(0)
}

{
	const bad = checkFlags(args, FLAGS)
	if (bad) {
		console.error(refusalLine(`unknown option ${bad.flag}`))
		console.error(bad.suggestion ? `  did you mean ${bad.suggestion}?` : `  run \`${invokedAs()} --help\` for what this verb takes`)
		process.exit(2)
	}
}
// `--library <dir>` puts a bare path in argv; it is not the skill name. Same
// guard, and the same reasoning, as refresh.mjs: without the explicit -1 check
// `indexOf` returning -1 makes `libraryAt + 1` equal 0 and silently excludes
// the first positional — here that would turn `promote <name>` into a usage
// error rather than a wrong target, but the fix belongs in both or neither.
const libraryAt = args.indexOf('--library')
const name = args.find((a, i) => !a.startsWith('--') && (libraryAt === -1 || i !== libraryAt + 1))
const DRY = args.includes('--dry-run')

if (!name) {
	console.error(synopsis())
	process.exit(2)
}

const dir = join(INBOX, name)
let tests = { ran: 0 }
let origin = null

if (!existsSync(dir)) {
	refuse(`inbox/${name} does not exist`, 'nothing to promote')
} else if (existsSync(join(SKILLS, name))) {
	refuse(`skills/${name} already exists`, 'promotion never overwrites a held skill')
} else if (!existsSync(join(dir, 'SKILL.md'))) {
	refuse('no SKILL.md at the artefact root', 'nothing here can load as a skill')
} else if (!existsSync(join(dir, 'ORIGIN.md')) && !existsSync(join(dir, 'AUDIT.md'))) {
	// Authored, not acquired: `skill-new` writes neither file, because there is
	// no arrival to record provenance against and no adjudication of someone
	// else's bytes to write up. Nothing here re-derives that decision from
	// content — it is read straight off which records are and are not present,
	// the same way the acquired branch below does for a missing ORIGIN.md or
	// AUDIT.md individually.
	origin = 'authored'
	rescan(dir, ['STRUCT-LONGDESC', 'STRUCT-LONGBODY'])
	checkCatalogEntry(name)
	checkCatalog()
	tests = runTests(dir, readFileSync(join(dir, 'SKILL.md'), 'utf8'))
} else {
	origin = 'acquired'
	const audit = readAudit(dir)
	const inventory = parseInventory(dir)
	checkAdaptationLog(dir, inventory, audit)
	rescan(dir)
	tests = runTests(dir)
}

// Every promotion writes a ledger entry, authored or acquired, so the script
// that writes it has to be reachable on both paths — and the check belongs
// here, before the move, not beside the write. The write happens after the
// artefact has been renamed into skills/; refusing at that point would leave a
// promoted skill with no entry, which is the one state the ledger cannot
// describe. Placing it in the authored branch alone was a real defect, caught
// by promote.test.mjs rather than by reading.
if (origin) checkLedgerReachable()

let promoted = false
let staged = null
let stageError = null
if (!refusals.length && !DRY) {
	const from = join(INBOX, name)
	const to = join(SKILLS, name)
	try {
		renameSync(from, to)
	} catch (e) {
		if (e.code !== 'EXDEV') throw e
		cpSync(from, to, { recursive: true, dereference: false })
		rmSync(from, { recursive: true, force: true })
	}
	// One file per held skill, for the facts that live in neither the skill
	// nor a matter of taste — SK-30. Computed from the artefact at its new
	// path, so integrity hashes describe the bytes as promoted, not as they
	// sat in inbox/. usage.mjs owns the `usage` section only; this writes
	// everything else, which is why it is a section-preserving read-merge-write
	// rather than a fresh file.
	writeLedgerEntry(name, to, new Date().toISOString().slice(0, 10))
	// Staging is a courtesy, not part of the gate. It runs last, after the move
	// and the ledger write, so a library that is not a git repository — or a git
	// invocation that fails for any other reason — used to abort here with a raw
	// execFileSync dump AFTER the promotion had already happened: the work done,
	// the record written, and the command reporting failure. Version control is
	// the library's choice; this tool does not require one, so an unstageable
	// promotion is reported and not thrown.
	try {
		execFileSync('git', ['add', join('skills', name), join('ledger', `${name}.json`)], { cwd: LIBRARY, stdio: 'pipe' })
		staged = true
	} catch (e) {
		staged = false
		stageError = (e.stderr?.toString() ?? e.message ?? '').trim().split('\n')[0]
	}
	promoted = true
}

if (args.includes('--json')) {
	console.log(JSON.stringify({ name, origin, promoted, staged, stageError, refusals, tests }, null, 2))
} else if (refusals.length) {
	console.log(`\nrefused to promote ${name} — ${refusals.length} unmet condition(s)\n`)
	for (const r of refusals) {
		console.log(`  ✗ ${r.why}`)
		if (r.detail) console.log(`      ${r.detail}`)
	}
	console.log('')
} else if (DRY) {
	console.log(`\n${name} would promote — every condition met${tests.ran ? `, ${tests.ran} test file(s) passed` : ''}\n`)
} else {
	console.log(`\npromoted  inbox/${name} → skills/${name}${tests.ran ? `  (${tests.ran} test file(s) passed)` : ''}`)
	if (staged === false) console.log(`not staged — ${stageError || 'git add failed'}`)
	// SK-97 §5. This used to end with `./install.sh` — a script that belongs to
	// the library this tool was extracted from and does not exist here, so every
	// successful promotion closed with an instruction nobody could follow.
	//
	// The replacement names the step without naming one product's directory.
	// catalog.json and edges are qrntn's own and stay; how a skill gets in front
	// of an agent is the harness's business, and there are around forty of them.
	// `qrntn install` is a real verb worth having and is deferred, not forgotten
	// — until it exists, saying what to do beats naming a file that is not there.
	const next = 'symlink or copy it where your agent loads skills from'
	console.log(origin === 'authored' ? `Declare its edges, then ${next}.\n` : `Add it to catalog.json, declare its edges, then ${next}.\n`)
}

process.exit(refusals.length ? 1 : 0)
