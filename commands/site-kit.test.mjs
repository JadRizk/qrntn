#!/usr/bin/env node
// Pins the hex that site/ carries to the token it was copied from. Run: node site-kit.test.mjs
//
// Platform metadata cannot read a token. `theme-color` in site/index.html and
// `theme_color` / `background_color` in site/site.webmanifest are read by the
// browser chrome and the OS, not by the page, so each is a literal hex copied
// from `--nx-void` in nexus/packages/tokens/src/qrntn.css — the ground
// brand/PALETTE.md names `--qrn-void`. Three copies of one number. The day the
// ground moves and one of them does not, the address bar is the wrong colour
// and nothing reports it; this file is what reports it.
//
// It also pins the served kit to its source: every raster in site/ is a copy
// of the one under brand/assets, and a copy that drifts from its source is the
// exact failure brand/README.md's regeneration block exists to prevent.

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const read = (p) => readFileSync(join(ROOT, p), 'utf8')

let pass = 0
const failures = []
const check = (name, cond, detail = '') => {
	if (cond) pass++
	else failures.push(`${name}${detail ? ` — ${detail}` : ''}`)
}

// The source of the number. PALETTE.md's canvas row and the token file must
// agree with each other before anything downstream is compared to them.
const palette = read('brand/PALETTE.md').match(/\| Canvas \| `(#[0-9A-Fa-f]{6})` \|/)?.[1]
const token = read('nexus/packages/tokens/src/qrntn.css').match(/--nx-void:\s*(#[0-9A-Fa-f]{6})/)?.[1]
check('PALETTE.md names the canvas', !!palette)
check('qrntn.css defines --nx-void', !!token)
check('PALETTE.md and qrntn.css agree on the ground', palette?.toLowerCase() === token?.toLowerCase(), `${palette} vs ${token}`)

// The copies.
const html = read('site/index.html')
const themeColor = html.match(/<meta\s+name="theme-color"\s+content="(#[0-9A-Fa-f]{6})"/)?.[1]
check('index.html theme-color is the ground', themeColor?.toLowerCase() === token?.toLowerCase(), `${themeColor} vs ${token}`)

const manifest = JSON.parse(read('site/site.webmanifest'))
check('manifest theme_color is the ground', manifest.theme_color?.toLowerCase() === token?.toLowerCase(), `${manifest.theme_color} vs ${token}`)
check('manifest background_color is the ground', manifest.background_color?.toLowerCase() === token?.toLowerCase(), `${manifest.background_color} vs ${token}`)

// The served kit is byte-for-byte its source.
const copies = {
	'site/favicon.svg': 'brand/assets/logo/favicon.svg',
	'site/favicon.ico': 'brand/assets/logo/favicon.ico',
	'site/apple-touch-icon.png': 'brand/assets/logo/apple-touch-icon.png',
	'site/icon-192.png': 'brand/assets/logo/icon-192.png',
	'site/icon-512.png': 'brand/assets/logo/icon-512.png',
	'site/icon-maskable-512.png': 'brand/assets/logo/icon-maskable-512.png',
	'site/og.png': 'brand/assets/social/social-card.png',
}
for (const [copy, source] of Object.entries(copies)) {
	const same = readFileSync(join(ROOT, copy)).equals(readFileSync(join(ROOT, source)))
	check(`${copy} is a copy of ${source}`, same, 'bytes differ — re-run the regeneration block in brand/README.md')
}

console.log(`\n${pass} passed, ${failures.length} failed`)
for (const f of failures) console.log(`  FAIL  ${f}`)
process.exit(failures.length ? 1 : 0)
