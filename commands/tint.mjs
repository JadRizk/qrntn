// tint.mjs — the only place this tool is allowed to emit colour.
//
// The decision this module encodes is RESTRAINT, not decoration. `pratiq`
// printed no colour at all until now, and the argument for keeping it that way
// was good: a gate that shouts is easier to misread in a pipe, and every escape
// sequence is another surface to get wrong. What overrode it is that two things
// in this tool's output must never be skimmed past — the word `refused:` and a
// finding count — and everything else stays exactly as plain as it was.
//
// So there are four inks and no more:
//
//   state    the flag. exactly one string in the whole CLI today —
//            audit's verdict when it is NO BLOCKING FINDINGS
//   warn     a finding that is not a refusal: REVIEW rows, the review count
//   alarm    refused, and BLOCK. the things that stop a pipeline
//   dim      chrome, and any count that came back zero
//
// There is deliberately no `success`, no `bold`, no `underline` and no way to
// reach an arbitrary colour. A helper that can paint anything gets used to
// paint everything, and then none of it means anything. See brand/BRAND.md.
//
// COLOUR IS NEVER THE ONLY CHANNEL. Every call site already prints the word —
// `refused:`, `REVIEW`, `5 review`, `NO BLOCKING FINDINGS` — because the warn
// and alarm inks measure ΔE 7.7 apart under deuteranopia, which is true of
// every red/orange pair ever shipped. Strip the colour and the output is
// unchanged, byte for byte; tint.test.mjs asserts exactly that against the
// audit report. It is also the test for whether a new call site belongs here.
//
// A ZERO COUNT NEVER SPENDS AN INK. `0 block` rendered in alarm red is the
// interface shouting about the absence of a problem, which is how an alarm
// colour stops meaning anything. Callers pass dim for a count of nothing.
//
// Zero dependencies, matching the rest of the tool.

import { env, stdout, stderr } from 'node:process'

// ── when colour is allowed ──────────────────────────────────────────────────
//
// Four gates, in the order the ecosystem expects them. NO_COLOR is honoured
// on presence, not on value — that is what the spec says, and reading it as a
// boolean is the usual way to get it wrong (`NO_COLOR=0` still means no
// colour).
//
// The TTY check is per-stream on purpose: `pratiq audit > report.txt` should
// write a clean file while still colouring the refusal it prints to stderr.

function level(stream) {
	if ('NO_COLOR' in env && env.NO_COLOR !== '') return 0
	if (env.TERM === 'dumb') return 0
	if (env.FORCE_COLOR === '0') return 0
	if (env.FORCE_COLOR) return env.FORCE_COLOR === '3' ? 3 : 1
	if (!stream || !stream.isTTY) return 0
	// Truecolor is what the brand's measured hexes actually need. Without it
	// the fallbacks below are the nearest basic ANSI, which is a different
	// colour and is fine — the word is carrying the meaning either way.
	if (env.COLORTERM === 'truecolor' || env.COLORTERM === '24bit') return 3
	return 1
}

const RESET = '\x1b[0m'

// brand/PALETTE.md. The basic-ANSI fallbacks are the nearest of the sixteen,
// not an approximation of the hex — at level 1 there is no hex to approximate.
//
// ALL FOUR MUST BE DISTINCT, and getting that wrong is easy: quebec and rust
// are both yellows, so the obvious mapping gives them both 33 and the flag
// becomes indistinguishable from a warning on any terminal without COLORTERM.
// Bright yellow for the flag is also the right way round by luminance — quebec
// measures 14.53:1 against the ground and rust 4.71:1.
const INKS = {
	state: { rgb: [254, 221, 0], basic: '\x1b[93m' }, //   #FEDD00 quebec — bright yellow
	warn: { rgb: [191, 100, 8], basic: '\x1b[33m' }, //    #BF6408 rust   — yellow
	alarm: { rgb: [255, 46, 99], basic: '\x1b[31m' }, //   #FF2E63 alarm  — red
	dim: { rgb: [127, 121, 102], basic: '\x1b[90m' } //    #7F7966 grey-300 — bright black
}

function paint(name, text, stream) {
	const lvl = level(stream)
	if (lvl === 0) return text
	const ink = INKS[name]
	if (lvl === 3) {
		const [r, g, b] = ink.rgb
		return `\x1b[38;2;${r};${g};${b}m${text}${RESET}`
	}
	return `${ink.basic}${text}${RESET}`
}

/**
 * A colouring function bound to one stream, so a command does not have to pass
 * the stream at every call. `tintFor(process.stderr)` colours only when stderr
 * is a terminal — which is the behaviour that makes redirecting stdout safe.
 */
export function tintFor(stream = stdout) {
	return {
		state: (t) => paint('state', t, stream),
		warn: (t) => paint('warn', t, stream),
		alarm: (t) => paint('alarm', t, stream),
		dim: (t) => paint('dim', t, stream),
		/** True when this stream is being coloured at all. For deciding layout, never meaning. */
		enabled: () => level(stream) > 0
	}
}

/** Bound to stdout — the default for anything a command prints as its answer. */
export const tint = tintFor(stdout)

/** Bound to stderr — refusals, which is the one thing that must survive a redirect. */
export const etint = tintFor(stderr)

/**
 * The refusal line, in one place so every command spells it identically.
 * Lowercase, `refused:` first, the reason after it. The word is the signal;
 * the colour is a second copy of it.
 */
export function refusalLine(message) {
	return `${etint.alarm('refused:')} ${message}`
}

/** Exported for tests, which need to assert behaviour without a real TTY. */
export const __test = { level, paint, INKS }
