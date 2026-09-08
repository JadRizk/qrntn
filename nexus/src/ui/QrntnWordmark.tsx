// ui/QrntnWordmark.tsx — the product's own logotype.
//
// App-level, not part of the vendored @nexus/react, for the reason dock.css
// already states about itself: @nexus/react is a copy of an upstream design
// system and shouldn't grow app-specific rules. Its `Wordmark` is *nexus's*
// identity — a skewed stencil with an RGB split — and qrntn's is a different
// thing that happens to sit in the same slot.
//
// The lockup, per brand/BRAND.md: `rntn` set in the interface mono, lowercase,
// behind a leading `q` replaced by signal flag Q on its descender. The bowl
// becomes the flag; the stem stays. A signal and four letters.
//
// ONE SVG, NOT TEXT PLUS AN INLINE IMAGE. The word has to start exactly one
// advance width after the flag, and the flag has to sit exactly on the
// x-height; doing that across two boxes means guessing at baseline alignment.
// In one coordinate system it is arithmetic.
//
// `textLength` is what makes that arithmetic hold across faces. The geometry
// below assumes a 0.6em advance (IBM Plex Mono, SF Mono); Consolas is 0.55em
// and Menlo 0.6023em, so on a machine without the first two the word would
// drift into or away from the flag. Forcing the measure to 268.8 = 4 x 67.2 and
// letting the renderer distribute the difference as tracking keeps the word
// ending where the geometry says. `spacing`, not `spacingAndGlyphs`: adjust
// the gaps, never the letterforms.
//
// No chromatic split, deliberately, though nexus's Wordmark has one and the
// surface around this is a CRT composite. The flag is the one colour in the
// system with a measured value (#FEDD00, 14.53:1), and an RGB fringe would
// shift it. The texture is worth less than the colour being right.

const ADVANCE = 67.2 // 0.6em at the 112 font-size below
const MEASURE = ADVANCE * 4 // "rntn"
const BASELINE = 90
const XHEIGHT = 58 // IBM Plex Mono's x-height at this size
const DESCENDER = 26

export interface QrntnWordmarkProps {
	/** Rendered height of the lockup. The width follows from the viewBox. */
	size?: string
}

export function QrntnWordmark({ size = '1.5rem' }: QrntnWordmarkProps) {
	const flagX = 0
	const flagTop = BASELINE - XHEIGHT
	const stemX = flagX + 50

	return (
		<svg
			viewBox="0 0 403 130"
			role="img"
			aria-label="qrntn"
			style={{ height: `calc(${size} * 1.16)`, width: 'auto', display: 'block', overflow: 'visible' }}
		>
			{/* The bowl: flag Q, square-cornered like everything else in the system. */}
			<rect x={flagX} y={flagTop} width="50" height={XHEIGHT} fill="var(--nx-fg-accent)" />
			{/* The stem, running the bowl's height plus the descender. */}
			<rect x={stemX} y={flagTop} width="11" height={XHEIGHT + DESCENDER} fill="var(--nx-fg-accent)" />
			<text
				x={ADVANCE}
				y={BASELINE}
				textLength={MEASURE}
				lengthAdjust="spacing"
				fontFamily="var(--nx-font-mono)"
				fontSize="112"
				fontWeight={600}
				fill="var(--nx-fg-default)"
			>
				rntn
			</text>
		</svg>
	)
}
