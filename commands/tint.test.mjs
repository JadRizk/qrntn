#!/usr/bin/env node
// Tests for tint.mjs — the only module allowed to emit colour. Run: node tint.test.mjs
//
// The property that matters is not "does it colour". It is **does the output
// still say the same thing with the colour stripped**, and **does it stay off
// unless someone is actually looking at a terminal**. A colour module that gets
// either of those wrong corrupts every pipe, log and CI transcript this tool
// writes into, and the failure is invisible from a checkout where nobody pipes
// anything.
//
// So the gates below are mostly about SILENCE: NO_COLOR, TERM=dumb, a non-TTY
// stream, and the precedence between them. The one gate about colour itself
// checks that the bytes are the brand's measured hexes rather than an
// approximation someone typed from memory.
//
// Expected values are derived by hand from brand/PALETTE.md, never captured
// from an earlier run of this tool.

import { spawnSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { __test, refusalLine, tint, tintFor } from './tint.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
// check-catalog.mjs, because its shortest refusal needs no fixture at all:
// a `--library` with no value after it. Any of the nine would do.
const CATALOG = 'check-catalog.mjs'

let pass = 0
const failures = []
const check = (name, cond, detail = '') => {
	if (cond) pass++
	else failures.push(`${name}${detail ? ` — ${detail}` : ''}`)
}

const { level, paint } = __test

// A stand-in for a stream. `isTTY` is the only property level() reads, so this
// is the whole surface — no need to fake a real socket.
const tty = { isTTY: true }
const pipe = { isTTY: false }

// level() reads process.env live, so each case sets exactly what it means and
// clears the rest. Mutating the real env is safe here: this file is spawned as
// its own process by check.mjs.
function withEnv(vars, fn) {
	const saved = {}
	for (const k of ['NO_COLOR', 'FORCE_COLOR', 'TERM', 'COLORTERM']) {
		saved[k] = process.env[k]
		delete process.env[k]
	}
	Object.assign(process.env, vars)
	try {
		return fn()
	} finally {
		for (const k of Object.keys(saved)) {
			if (saved[k] === undefined) delete process.env[k]
			else process.env[k] = saved[k]
		}
	}
}

// ── silence, which is the default ───────────────────────────────────────────
{
	check('a pipe gets no colour', withEnv({}, () => level(pipe)) === 0)
	check('a bare TTY gets basic colour', withEnv({}, () => level(tty)) === 1)
	check(
		'a truecolor TTY gets 24-bit',
		withEnv({ COLORTERM: 'truecolor' }, () => level(tty)) === 3
	)
	check(
		'COLORTERM=24bit is the same claim',
		withEnv({ COLORTERM: '24bit' }, () => level(tty)) === 3
	)
	check('a missing stream is not a TTY', withEnv({}, () => level(undefined)) === 0)
}

// ── NO_COLOR, honoured on presence rather than on value ─────────────────────
{
	check(
		'NO_COLOR silences a TTY',
		withEnv({ NO_COLOR: '1' }, () => level(tty)) === 0
	)
	// The usual way to get this wrong. `NO_COLOR=0` is still NO_COLOR set, and
	// the spec says presence is the signal — reading it as a boolean turns the
	// opt-out into an opt-in for anyone who wrote the obvious thing.
	check(
		'NO_COLOR=0 still means no colour',
		withEnv({ NO_COLOR: '0' }, () => level(tty)) === 0
	)
	check(
		'NO_COLOR= (empty) does NOT silence — the spec wants it unset or non-empty',
		withEnv({ NO_COLOR: '' }, () => level(tty)) === 1
	)
	check(
		'NO_COLOR beats FORCE_COLOR',
		withEnv({ NO_COLOR: '1', FORCE_COLOR: '3' }, () => level(tty)) === 0
	)
	check(
		'TERM=dumb silences a TTY',
		withEnv({ TERM: 'dumb' }, () => level(tty)) === 0
	)
}

// ── FORCE_COLOR, which is what CI uses ──────────────────────────────────────
{
	check(
		'FORCE_COLOR colours a pipe',
		withEnv({ FORCE_COLOR: '1' }, () => level(pipe)) === 1
	)
	check(
		'FORCE_COLOR=3 asks for truecolor on a pipe',
		withEnv({ FORCE_COLOR: '3' }, () => level(pipe)) === 3
	)
	check(
		'FORCE_COLOR=0 is an opt-out, not a truthy string',
		withEnv({ FORCE_COLOR: '0' }, () => level(tty)) === 0
	)
}

// ── the bytes are the brand's, not an approximation ─────────────────────────
{
	// brand/PALETTE.md, by hand: quebec #FEDD00, rust #BF6408, alarm #FF2E63,
	// grey-300 #7F7966. If a primitive moves in the palette and not here, this
	// is the gate that says so.
	// The calls happen INSIDE withEnv, not just the construction. tintFor()
	// returns closures that read the environment when they are invoked, which is
	// what lets one long-lived `tint` respond to a stream being redirected —
	// building it under FORCE_COLOR and calling it outside would measure nothing.
	const painted = withEnv({ FORCE_COLOR: '3' }, () => {
		const t = tintFor(pipe)
		return { state: t.state('x'), warn: t.warn('x'), alarm: t.alarm('x'), dim: t.dim('x'), on: t.enabled() }
	})
	check('state is quebec', painted.state === '\x1b[38;2;254;221;0mx\x1b[0m', JSON.stringify(painted.state))
	check('warn is rust', painted.warn === '\x1b[38;2;191;100;8mx\x1b[0m', JSON.stringify(painted.warn))
	check('alarm is alarm', painted.alarm === '\x1b[38;2;255;46;99mx\x1b[0m', JSON.stringify(painted.alarm))
	check('dim is grey-300', painted.dim === '\x1b[38;2;127;121;102mx\x1b[0m', JSON.stringify(painted.dim))

	const plain = withEnv({}, () => {
		const t = tintFor(pipe)
		return { alarm: t.alarm('x'), on: t.enabled() }
	})
	check('the same calls on a pipe return the input untouched', plain.alarm === 'x', JSON.stringify(plain.alarm))
	check('enabled() reports the stream at call time', plain.on === false && painted.on === true)
}

// ── the ink set is closed ───────────────────────────────────────────────────
{
	// Four inks, and the module offers no route to a fifth. A helper that can
	// paint anything gets used to paint everything — the point of this module is
	// that it cannot. If someone adds `bold` or a raw hex, this fails and they
	// have to argue for it in brand/BRAND.md first.
	const names = Object.keys(__test.INKS).sort()
	check(
		'exactly four inks, named for jobs',
		JSON.stringify(names) === JSON.stringify(['alarm', 'dim', 'state', 'warn']),
		JSON.stringify(names)
	)
	// The four basic codes must differ too. Quebec and rust are both yellows, so
	// the obvious mapping gives both 33 and the flag becomes indistinguishable
	// from a warning on every terminal without COLORTERM — which is most of CI.
	const basics = Object.values(__test.INKS).map((i) => i.basic)
	check('the four basic-ANSI fallbacks are all distinct', new Set(basics).size === 4, JSON.stringify(basics))

	const lvl1 = withEnv({ FORCE_COLOR: '1' }, () => {
		const t = tintFor(pipe)
		return { state: t.state('x'), warn: t.warn('x') }
	})
	check('at level 1 the flag and a warning still differ', lvl1.state !== lvl1.warn, `${JSON.stringify(lvl1.state)} vs ${JSON.stringify(lvl1.warn)}`)

	check('an unknown ink is not silently ignored', (() => {
		try {
			paint('success', 'x', { isTTY: true })
			return false
		} catch {
			return true
		}
	})())
}

// ── the word survives the colour being stripped ─────────────────────────────
{
	// The whole justification for colouring anything here. Warning and critical
	// measure ΔE 7.7 apart under deuteranopia, so meaning can never rest on hue.
	const coloured = withEnv({ FORCE_COLOR: '3' }, () => refusalLine('no such verb'))
	const bare = withEnv({}, () => refusalLine('no such verb'))
	// eslint-disable-next-line no-control-regex
	const stripped = coloured.replace(/\x1b\[[0-9;]*m/g, '')
	check('stripping the escapes recovers the plain line exactly', stripped === bare, `${JSON.stringify(stripped)} vs ${JSON.stringify(bare)}`)
	check('the word is present either way', bare.startsWith('refused:') && stripped.startsWith('refused:'), bare)
}

// ── end to end, through a real command ─────────────────────────────────────
{
	const run = (script, env) => {
		const r = spawnSync(process.execPath, [script, '--library'], { encoding: 'utf8', env: { ...process.env, ...env } })
		return { code: r.status, err: r.stderr ?? '' }
	}
	const installed = join(HERE, CATALOG)

	// spawnSync pipes stderr, so this is the real redirect case, not a mock.
	const piped = run(installed, { NO_COLOR: undefined, FORCE_COLOR: undefined })
	// eslint-disable-next-line no-control-regex
	check('a redirected refusal carries no escape sequences at all', !/\x1b\[/.test(piped.err), JSON.stringify(piped.err))
	check('the refusal still reads as one', /^refused: /.test(piped.err), JSON.stringify(piped.err))
	check('and still refuses with 2', piped.code === 2, `exit ${piped.code}`)

	const forced = run(installed, { FORCE_COLOR: '3' })
	check('FORCE_COLOR reaches a real command', /\x1b\[38;2;255;46;99mrefused:/.test(forced.err), JSON.stringify(forced.err.slice(0, 80)))
	check(
		'the coloured and plain refusals say exactly the same thing',
		// eslint-disable-next-line no-control-regex
		forced.err.replace(/\x1b\[[0-9;]*m/g, '') === piped.err,
		JSON.stringify(forced.err.replace(/\x1b\[[0-9;]*m/g, ''))
	)

	// ── the gate this module exists to keep ──────────────────────────────────
	//
	// THE REGRESSION THIS PINS, which is not hypothetical: a STATIC
	// `import './tint.mjs'` here broke promote.test.mjs and refresh.test.mjs,
	// because the library deploys these scripts by copying ONE FILE into a
	// skill's scripts/ folder and tint.mjs is not beside them there. Node
	// answered with ERR_MODULE_NOT_FOUND before main() ran — a stack trace in
	// place of a refusal, on someone else's machine, after publish.
	//
	// Those two suites only caught it as collateral: their assertions are about
	// promotion and drift, and they would go on passing if a future refactor
	// made the import static again in one of the seven commands they do not
	// copy. This asserts the property directly, and for the command with the
	// cheapest refusal to reach.
	const alone = mkdtempSync(join(tmpdir(), 'pratiq-tint-alone-'))
	try {
		cpSync(join(HERE, CATALOG), join(alone, CATALOG))
		const orphan = run(join(alone, CATALOG), { FORCE_COLOR: '3' })

		check('copied alone: it still runs at all', orphan.code === 2, `exit ${orphan.code} — ${orphan.err.slice(0, 200)}`)
		check('copied alone: it refuses in words, not in a stack trace', /^refused: --library needs a directory/.test(orphan.err), JSON.stringify(orphan.err.slice(0, 200)))
		check('copied alone: no ERR_MODULE_NOT_FOUND', !/ERR_MODULE_NOT_FOUND/.test(orphan.err), JSON.stringify(orphan.err.slice(0, 200)))
		// Even with FORCE_COLOR=3 — there is nothing to colour with, and asking
		// for colour must not be a way to make a missing sibling fatal.
		// eslint-disable-next-line no-control-regex
		check('copied alone: degrades to plain text even under FORCE_COLOR', !/\x1b\[/.test(orphan.err), JSON.stringify(orphan.err.slice(0, 200)))
		check('copied alone: byte-identical to the installed plain refusal', orphan.err === piped.err, `${JSON.stringify(orphan.err)} vs ${JSON.stringify(piped.err)}`)
	} finally {
		rmSync(alone, { recursive: true, force: true })
	}
}

// ── the audit report, which is where findings actually appear ──────────────
{
	const AUDIT = join(HERE, 'audit-skill.mjs')
	const dir = mkdtempSync(join(tmpdir(), 'pratiq-tint-audit-'))
	const runAudit = (target, env) =>
		spawnSync(process.execPath, [AUDIT, target], { encoding: 'utf8', env: { ...process.env, ...env } })
	// eslint-disable-next-line no-control-regex
	const strip = (t) => t.replace(/\x1b\[[0-9;]*m/g, '')

	try {
		// Clean: the one case where this command prints the flag. A verdict of
		// NO BLOCKING FINDINGS is a cleared vessel; nothing else here is.
		const clean = join(dir, 'clean')
		mkdirSync(clean, { recursive: true })
		writeFileSync(join(clean, 'SKILL.md'), '---\nname: clean\ndescription: Does one plain thing. Use when that thing is needed.\n---\n\n# clean\n\nA plain instruction.\n')

		const cleanPlain = runAudit(clean, { NO_COLOR: undefined, FORCE_COLOR: undefined })
		const cleanCol = runAudit(clean, { FORCE_COLOR: '3' })

		check('audit clean: verdict is the flag', /\x1b\[38;2;254;221;0mNO BLOCKING FINDINGS/.test(cleanCol.stdout), JSON.stringify(cleanCol.stdout.slice(-90)))
		check('audit clean: a zero count does not spend an ink', /\x1b\[38;2;127;121;102m0 block/.test(cleanCol.stdout), JSON.stringify(cleanCol.stdout.slice(-140)))

		// Noisy: a script that shells out, which the EXEC-EVAL rule reports as
		// REVIEW. The precondition is asserted rather than assumed — a fixture
		// that quietly stopped exercising this path would make every check under
		// it vacuous.
		const noisy = join(dir, 'noisy')
		mkdirSync(join(noisy, 'scripts'), { recursive: true })
		writeFileSync(join(noisy, 'SKILL.md'), '---\nname: noisy\ndescription: Runs a thing. Use when a thing must be run.\n---\n\n# noisy\n\nSee scripts/go.mjs.\n')
		writeFileSync(join(noisy, 'scripts', 'go.mjs'), "import { spawnSync } from 'node:child_process'\nspawnSync('ls')\n")

		const noisyPlain = runAudit(noisy, { NO_COLOR: undefined, FORCE_COLOR: undefined })
		const noisyCol = runAudit(noisy, { FORCE_COLOR: '3' })

		check('audit noisy: the fixture still produces a REVIEW finding', / REVIEW /.test(noisyPlain.stdout) || /REVIEW /.test(noisyPlain.stdout), JSON.stringify(noisyPlain.stdout.slice(-200)))
		check('audit noisy: REVIEW is rust', /\x1b\[38;2;191;100;8mREVIEW/.test(noisyCol.stdout), JSON.stringify(noisyCol.stdout.slice(0, 160)))
		check('audit noisy: verdict is NOT the flag', !/\x1b\[38;2;254;221;0m/.test(noisyCol.stdout), 'a reviewable skill must not render as cleared')

		// THE ASSERTION THAT EARNS ITS KEEP. It catches two different bugs with
		// one comparison: an ink that changes what the report SAYS, and the
		// padding trap — `f.sev.padEnd(6)` applied AFTER colouring counts the
		// escape bytes as width, so the severity column silently collapses for
		// exactly the readers who turned colour on. Stripping must reproduce the
		// plain report byte for byte, alignment included.
		check('audit: stripping the colour reproduces the plain report byte for byte', strip(noisyCol.stdout) === noisyPlain.stdout, `lengths ${strip(noisyCol.stdout).length} vs ${noisyPlain.stdout.length}`)
		check('audit clean: same, on the clean path', strip(cleanCol.stdout) === cleanPlain.stdout)
		check('audit: colour does not move the exit code', noisyPlain.status === noisyCol.status && cleanPlain.status === cleanCol.status, `${noisyPlain.status}/${noisyCol.status} ${cleanPlain.status}/${cleanCol.status}`)

		// Copied alone, the way promote.test.mjs actually deploys this scanner.
		const alone = join(dir, 'alone')
		mkdirSync(alone, { recursive: true })
		cpSync(AUDIT, join(alone, 'audit-skill.mjs'))
		const orphan = spawnSync(process.execPath, [join(alone, 'audit-skill.mjs'), noisy], { encoding: 'utf8', env: { ...process.env, FORCE_COLOR: '3' } })
		check('audit copied alone: no ERR_MODULE_NOT_FOUND', !/ERR_MODULE_NOT_FOUND/.test(orphan.stderr ?? ''), JSON.stringify((orphan.stderr ?? '').slice(0, 200)))
		check('audit copied alone: identical to the plain report', orphan.stdout === noisyPlain.stdout, `lengths ${(orphan.stdout ?? '').length} vs ${noisyPlain.stdout.length}`)
	} finally {
		rmSync(dir, { recursive: true, force: true })
	}
}

// ── every command, not just the one above ──────────────────────────────────
{
	// The behavioural gate above copies ONE command and proves it degrades. This
	// is the same property asserted for all nine at once, by reading the source
	// — because a future refactor could make the import static in any of the
	// eight that gate does not run, and seven of them are never copied by any
	// fixture, so nothing else would notice.
	//
	// DISCOVERED, never listed. A hand-maintained list of commands goes stale and
	// the missing entry is invisible — the failure this pipeline keeps finding in
	// everything else.
	const commands = readdirSync(HERE)
		.filter((f) => f.endsWith('.mjs'))
		.filter((f) => !/\.test\.mjs$|\.self-test\.mjs$|^tint\.mjs$/.test(f))
		.map((f) => ({ f, src: readFileSync(join(HERE, f), 'utf8') }))

	check('the command set was discovered at all', commands.length >= 9, `found ${commands.length}`)

	// A static import is the exact shape that broke. It must never come back.
	const staticImporters = commands.filter((c) => /^import .*from '\.\/tint\.mjs'/m.test(c.src))
	check(
		'no command imports tint.mjs statically',
		staticImporters.length === 0,
		staticImporters.map((c) => c.f).join(', ')
	)

	// And any command that USES the helper must be the one that guarded it —
	// otherwise `refusalLine` is an undefined free variable and the refusal path
	// throws exactly where it is least affordable.
	// Two kinds of consumer: eight verbs plus check-catalog take `refusalLine`,
	// and audit-skill takes the `tint` object for its severity column. Both must
	// guard, and both must fall back to something that prints the same words.
	const users = commands.filter((c) => /refusalLine\(|tint\.(state|warn|alarm|dim)\(/.test(c.src))
	const unguarded = users.filter((c) => !/await import\('\.\/tint\.mjs'\)/.test(c.src))
	check('every command using an ink guards its import', unguarded.length === 0, unguarded.map((c) => c.f).join(', '))

	// The fallback must be the literal the plain path already printed. A typo
	// here ships a different refusal to anyone running a copied script, and no
	// other gate compares the two.
	const refusers = users.filter((c) => /refusalLine\(/.test(c.src))
	const wrongFallback = refusers.filter((c) => !/let refusalLine = \(message\) => `refused: \$\{message\}`/.test(c.src))
	check('every refusal fallback spells the line identically', wrongFallback.length === 0, wrongFallback.map((c) => c.f).join(', '))

	// The ink fallback has to be SHAPE-COMPATIBLE with the thing it stands in
	// for, not merely sufficient for today's call sites. Comparing key sets
	// against the real export means adding a fifth ink to tint.mjs fails here
	// until every fallback grows it too — rather than failing on a user's
	// machine, in the copied-alone path, months later.
	//
	// It shipped with `enabled` missing for exactly this reason: the fallback
	// was written to satisfy the four calls that existed.
	const realKeys = Object.keys(tint).sort()
	const inkers = users.filter((c) => /\btint\.(state|warn|alarm|dim)\(/.test(c.src))
	check('at least one command takes the ink object', inkers.length >= 1, `${inkers.length}`)

	for (const c of inkers) {
		const literal = /let tint = \{([^}]*)\}/.exec(c.src)?.[1]
		if (!literal) {
			check(`${c.f}: declares an ink fallback object`, false, 'no `let tint = { … }` found')
			continue
		}
		const keys = [...literal.matchAll(/([A-Za-z_$][\w$]*)\s*:/g)].map((m) => m[1]).sort()
		check(`${c.f}: fallback covers every key the real ink object has`, JSON.stringify(keys) === JSON.stringify(realKeys), `${JSON.stringify(keys)} vs ${JSON.stringify(realKeys)}`)
		// Identity, not a value. A fallback that returned anything but its input
		// would make a copied scanner print a different report from an installed
		// one, which is the whole property the copied-alone gate above asserts.
		const nonIdentity = [...literal.matchAll(/([A-Za-z_$][\w$]*)\s*:\s*\(t\)\s*=>\s*([^,}]+)/g)].filter((m) => m[2].trim() !== 't')
		check(`${c.f}: every ink fallback returns its input unchanged`, nonIdentity.length === 0, nonIdentity.map((m) => m[1]).join(', '))
	}

	check('all nine verbs plus the scanner adopted it', users.length >= 10, `${users.length}: ${users.map((c) => c.f).join(', ')}`)
}

// ── packaging ───────────────────────────────────────────────────────────────
{
	// All nine commands import this module, so a tarball without it is nine
	// verbs that print `refused:` in plain text forever and nobody notices —
	// which is a quieter failure than the missing-verb one pratiq.test.mjs
	// guards, and worth its own line. That suite reads the VERB table and cannot
	// see this file, because it is not a verb.
	const files = JSON.parse(readFileSync(join(HERE, '..', 'package.json'), 'utf8')).files ?? []
	check('tint.mjs is in the files allowlist', files.includes('commands/tint.mjs'), JSON.stringify(files))
}

console.log(`\n${pass} passed, ${failures.length} failed`)
for (const f of failures) console.log(`  FAIL  ${f}`)
process.exit(failures.length ? 1 : 0)
