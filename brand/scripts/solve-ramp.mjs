#!/usr/bin/env node
// solve-ramp.mjs — reproduce pratiq's neutral ramp.
//
// Nexus's hud-aa ramp is documented as "solved against exact contrast targets,
// hue 100deg sat 13%" — a green tint, chosen when the accent was acid. pratiq's
// accent is the signal flag, so the tint is re-solved warm at the SAME contrast
// targets: every ratio the AA theme cleared, this one clears identically, and
// nothing downstream of a grey moves.
//
// Solves lightness by bisection against the WCAG 2.x contrast formula. No
// dependencies, no eyeballing. Run it to regenerate the table in PALETTE.md.

const GROUND = '#0A0C0B'

// Nexus ships two ramps and pratiq needs both, for the reason nexus needed
// both: the AA ramp is the default, and the immersive one is what the viewer
// actually runs on — its edge register gains were measured off the rendered
// scene against those exact greys, so re-tinting the brand without re-solving
// this ramp would lighten every structural edge in the graph.
const RAMPS = {
	aa: [
		['grey-100', 1.61, 'decorative hairline only'],
		['grey-200', 3.01, 'UI boundary — WCAG 1.4.11'],
		['grey-300', 4.52, 'disabled text — WCAG 1.4.3'],
		['grey-400', 5.50, ''],
		['grey-500', 7.00, ''],
		['grey-600', 10.00, '']
	],
	// The immersive variant, at nexus's own 'hud' targets. These fail AA on
	// purpose: it is an opt-in surface, and the numbers are inherited rather
	// than chosen so the swap changes hue and nothing else.
	immersive: [
		['grey-100', 1.21, ''],
		['grey-200', 1.57, ''],
		['grey-300', 2.14, 'etch — the structural substrate'],
		['grey-400', 2.72, ''],
		['grey-500', 3.80, 'neutral — a verdict that did not land'],
		['grey-600', 4.98, 'affirmed — a verdict that did']
	]
}

const srgbToLin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
const relLum = ([r, g, b]) => 0.2126 * srgbToLin(r / 255) + 0.7152 * srgbToLin(g / 255) + 0.0722 * srgbToLin(b / 255)
const hexToRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))
const toHex = (rgb) => '#' + rgb.map((v) => Math.round(v).toString(16).padStart(2, '0').toUpperCase()).join('')

function contrast(a, b) {
	const [hi, lo] = [relLum(a), relLum(b)].sort((x, y) => y - x)
	return (hi + 0.05) / (lo + 0.05)
}

// HSL -> RGB. The ramp is expressed in HSL because the tint is stated as a hue
// and a saturation; lightness is the only free variable being solved for.
function hslToRgb(h, s, l) {
	const c = (1 - Math.abs(2 * l - 1)) * s
	const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
	const m = l - c / 2
	const seg = [[c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x]][Math.floor(h / 60) % 6]
	return seg.map((v) => (v + m) * 255)
}

/** Bisect lightness until the step hits `target` contrast against the ground. */
function solve(hue, sat, target, ground) {
	let lo = 0, hi = 1
	for (let i = 0; i < 60; i++) {
		const mid = (lo + hi) / 2
		if (contrast(hslToRgb(hue, sat, mid), ground) < target) lo = mid
		else hi = mid
	}
	return hslToRgb(hue, sat, (lo + hi) / 2)
}

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'))
const which = process.argv.includes('--immersive') ? 'immersive' : process.argv.includes('--both') ? 'both' : 'aa'

const hue = Number(args[0] ?? 45)   // warm, to sit under a yellow accent
const sat = Number(args[1] ?? 0.11)
const groundHex = args[2] ?? GROUND
const ground = hexToRgb(groundHex)

function emit(label, targets) {
	console.log(`\n${label} — hue ${hue}deg, sat ${(sat * 100).toFixed(0)}%, ground ${groundHex}\n`)
	console.log('  token       hex        target   measured   for')
	for (const [name, target, note] of targets) {
		// Measure the hex we EMIT, not the ideal colour we solved for. solve()
		// returns floats; toHex() rounds them to 8-bit. Reporting the float's
		// contrast beside the rounded hex prints a ratio for a colour that is
		// not the one shipped — #4C483D was published as 2.14:1 when the hex
		// itself measures 2.15:1. Small, and exactly the kind of gap a tool
		// whose whole claim is "compute, never eyeball" cannot have.
		const hex = toHex(solve(hue, sat, target, ground))
		const got = contrast(hexToRgb(hex), ground)
		console.log(`  ${name.padEnd(10)}  ${hex}  ${target.toFixed(2).padStart(6)}   ${got.toFixed(2).padStart(7)}:1   ${note}`)
	}
}

if (which === 'both') {
	emit('pratiq (AA)', RAMPS.aa)
	emit('pratiq-hud (immersive)', RAMPS.immersive)
} else {
	emit(which === 'immersive' ? 'pratiq-hud (immersive)' : 'pratiq (AA)', RAMPS[which])
}
