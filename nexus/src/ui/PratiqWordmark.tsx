// ui/PratiqWordmark.tsx — the product's own logotype.
//
// App-level, not part of the vendored @nexus/react, for the reason dock.css
// already states about itself: @nexus/react is a copy of an upstream design
// system and shouldn't grow app-specific rules. Its `Wordmark` is *nexus's*
// identity — a skewed stencil with an RGB split — and pratiq's is a different
// thing that happens to sit in the same slot.
//
// The lockup, per brand/BRAND.md: `prati` set in the interface mono, lowercase,
// with the final `q` replaced by signal flag Q on its descender. The bowl
// becomes the flag; the stem stays. Five letters and a signal.
//
// ONE SVG, NOT TEXT PLUS AN INLINE IMAGE. The flag has to land exactly one
// advance width after the `i` and sit exactly on the x-height, and doing that
// across two boxes means guessing at baseline alignment. In one coordinate
// system it is arithmetic.
//
// `textLength` is what makes that arithmetic hold across faces. The geometry
// below assumes a 0.6em advance (IBM Plex Mono, SF Mono); Consolas is 0.55em
// and Menlo 0.6023em, so on a machine without the first two the flag would
// drift into or away from the `i`. Forcing the measure to 336 = 5 x 67.2 and
// letting the renderer distribute the difference as tracking pins the flag
// wherever the word actually ends. `spacing`, not `spacingAndGlyphs`: adjust
// the gaps, never the letterforms.
//
// No chromatic split, deliberately, though nexus's Wordmark has one and the
// surface around this is a CRT composite. The flag is the one colour in the
// system with a measured value (#FEDD00, 14.53:1), and an RGB fringe would
// shift it. The texture is worth less than the colour being right.

const ADVANCE = 67.2 // 0.6em at the 112 font-size below
const MEASURE = ADVANCE * 5 // "prati"
const BASELINE = 90
const XHEIGHT = 58 // IBM Plex Mono's x-height at this size
const DESCENDER = 26

export interface PratiqWordmarkProps {
	/** Rendered height of the lockup. The width follows from the viewBox. */
	size?: string
}

export function PratiqWordmark({ size = '1.5rem' }: PratiqWordmarkProps) {
	const flagX = MEASURE + 2
	const flagTop = BASELINE - XHEIGHT
	const stemX = flagX + 50

	return (
		<svg
			viewBox="0 0 470 130"
			role="img"
			aria-label="pratiq"
			style={{ height: `calc(${size} * 1.16)`, width: 'auto', display: 'block', overflow: 'visible' }}
		>
			<text
				x="0"
				y={BASELINE}
				textLength={MEASURE}
				lengthAdjust="spacing"
				fontFamily="var(--nx-font-mono)"
				fontSize="112"
				fontWeight={600}
				fill="var(--nx-fg-default)"
			>
				prati
			</text>
			{/* The bowl: flag Q, square-cornered like everything else in the system. */}
			<rect x={flagX} y={flagTop} width="50" height={XHEIGHT} fill="var(--nx-fg-accent)" />
			{/* The stem, running the bowl's height plus the descender. */}
			<rect x={stemX} y={flagTop} width="11" height={XHEIGHT + DESCENDER} fill="var(--nx-fg-accent)" />
		</svg>
	)
}
