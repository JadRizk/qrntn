#!/usr/bin/env node
// view — the graph, served locally against any skill library.
//
//   node view.mjs [--library <dir>] [--port <n>] [--no-open] [--json]
//
// The viewer is `nexus/`, a Vite + React + three.js application, and the CLI
// is zero-dependency plain Node and stays that way. So this ships a PREBUILT
// STATIC BUNDLE in `view/` — the viewer's build output plus the graph exporter
// bundled to one plain-Node file — and this file is the small static server
// in front of it. The user installs no toolchain. SURFACE.md decided that.
//
// ONE EXPORTER. `view/export-graph.mjs` is `nexus/scripts/export-graph.mjs`
// bundled, not reimplemented: a second implementation of the resolution order
// — which name is a held skill, which a refused row, which a ghost — is the
// drift SHIPPING.md §8 rejected on the record. This file runs the bundle
// against the library it is pointed at, into a temporary directory, and
// serves that. The fixture the viewer carries in a checkout never ships and is
// never served: nothing under /data/ is answered but the graph exported here.
//
// LOCAL, ONLY. Bound to 127.0.0.1, and answering only to a Host header that
// names this machine — `localhost`, `127.0.0.1` or `[::1]`, at the bound port
// or none. The check is what a fixed port makes necessary: a page on
// evil.example whose DNS is flipped to 127.0.0.1 after it loads can fetch
// this server as if same-origin, and with the reading room in the graph the
// response is every byte of every held skill. Vite (CVE-2025-24010) and
// Next.js both added the same check in 2025 and both answer 403; so does
// this. Nothing leaves the machine. See docs/SERVING.md.
//
// ONE PORT, REMEMBERED. 7768 — `q r n t` on a telephone keypad, unassigned at
// IANA, on nobody's default list — unless `--port` says otherwise; `--port 0`
// lets the system choose. A busy port is refused, not skipped past: a viewer
// whose URL moves when it is already open in a tab is the problem a fixed
// port exists to fix. When the squatter is another `qrntn view`, the refusal
// says so and names its URL.
//
// THE BROWSER IS OPENED, unless `--no-open`, `--json`, `BROWSER=none`, or
// stdout is not a terminal and BROWSER is unset. The platform's own opener is
// spawned detached, so Ctrl-C here never reaches the browser and a browser
// that will not open is a dim line under the URL, never an exit. The URL is
// still printed; opening it is still available as the reader's act.
//
// Exit codes hold their meaning across a long-running process. 2 when it could
// not start — no bundle, not a library, port in use, or an exporter that
// claimed success and produced something that is not a graph. 1 when it ran and
// the answer is no: the library is set up and something in it does not hold, so
// there is no graph to serve. 0 when it is stopped. SIGINT is handled here so
// that Ctrl-C reads as a clean stop rather than a signal death, which the
// dispatcher would otherwise report as 1.
//
// Plain Node, no dependencies.

import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { createServer, request } from 'node:http'
import { tmpdir } from 'node:os'
import { basename, dirname, extname, join, posix, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

// ── colour, which is optional ───────────────────────────────────────────────
//
// Guarded, like every command here: these scripts have been deployed by copying
// one file into a skill's scripts/ folder, where no sibling is beside them. The
// fallback is the same string tint.mjs produces on anything that is not a
// terminal.
let refusalLine = (message) => `refused: ${message}`
let tint = { state: (t) => t, warn: (t) => t, alarm: (t) => t, dim: (t) => t, enabled: () => false }
try {
	const mod = await import('./tint.mjs')
	refusalLine = mod.refusalLine
	tint = mod.tint
} catch {
	// Deployed alone. Plain text is correct, not a failure.
}

let invokedAs = () => `node ${basename(fileURLToPath(import.meta.url))}`
try {
	const mod = await import('./invoked-as.mjs')
	invokedAs = () => mod.invokedAs(import.meta.url)
} catch {
	// Deployed alone. Naming the file is correct, not a failure.
}

let checkFlags = () => null
try {
	const mod = await import('./argv.mjs')
	checkFlags = mod.checkFlags
} catch {
	// Deployed alone. No validation, which is where this started.
}

const FLAGS = {
	boolean: ['--json', '--no-open', '--help', '-h'],
	valued: ['--library', '--port']
}

// `q r n t` on a telephone keypad. Inside IANA's unassigned block 7748–7776
// (registry read 2026-09-13) and the default of no dev server anyone runs
// beside this one — not 3000, 5173, 8080, 8888, and not 5000 or 7000, which
// macOS's AirPlay receiver holds. Fixed so the URL is one a reader remembers.
const DEFAULT_PORT = 7768

// What a request must call this server to be answered. Names for this
// machine only, at the bound port or none; case does not matter, because
// Host does not either. Anything else is a page that reached a loopback
// address by a name that is not ours, which is what DNS rebinding looks like
// from here.
const HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

const HERE = dirname(fileURLToPath(import.meta.url))
// The bundle sits beside commands/, not inside it: `view/` is a build output
// listed in `files`, and commands/ is source. Both resolve from this file's
// own location because both are parts of THIS PROGRAM — the one thing that
// may be found that way. The library never is.
const VIEW = resolve(HERE, '..', 'view')
const EXPORTER = join(VIEW, 'export-graph.mjs')

// Names this process to whoever asks, so a second `qrntn view` refused on a
// busy port can tell the reader the squatter is us. The version comes from
// the package when this file is in one; deployed alone, it is just the name.
const SERVER_HEADER = (() => {
	try {
		const { version } = JSON.parse(readFileSync(join(HERE, '..', 'package.json'), 'utf8'))
		return `qrntn-view/${version}`
	} catch {
		return 'qrntn-view'
	}
})()

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

function synopsis() {
	return `usage: ${invokedAs()} [--library <dir>] [--port <n>] [--no-open] [--json]

  Exports the graph for the library, serves it at http://localhost:${DEFAULT_PORT}/,
  opens your browser there and runs until interrupted. Ctrl-C stops it;
  re-run to re-export.

  --library <dir>   the library — else SKILL_LIBRARY, else the working directory
  --port <n>        listen here instead of ${DEFAULT_PORT}; 0 lets the system choose
  --no-open         print the URL and leave the browser alone — so does BROWSER=none
  --json            one line with the URL and the counts, then serve; never opens

Nothing leaves the machine. The server answers only to localhost, and never
serves the viewer's own data — only the graph exported here, for the library
you named.

Exit codes:  0 stopped · 1 the library is inconsistent, so there is no graph
             2 could not start — no bundle, not a library, port in use
`
}

// The one policy, written once here and once as the <meta> in
// nexus/index.html; view.test.mjs asserts the served header carries it and
// that the two strings agree. `connect-src 'self'` is the line that makes
// an <img src=https://…> in a README a broken image rather than a beacon;
// `img-src` admits data: for the viewer's own inline glyphs and nothing
// remote. `style-src` admits inline styles because index.html carries a
// <style> block and vite dev injects them — and a stylesheet cannot reach
// out on its own: every url() it names is governed by img-src / font-src,
// both 'self'. Scripts are never inline, so script-src is 'self' alone.
const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'"

const CONTENT_TYPES = {
	'.html': 'text/html; charset=utf-8',
	'.js': 'text/javascript; charset=utf-8',
	'.mjs': 'text/javascript; charset=utf-8',
	'.css': 'text/css; charset=utf-8',
	'.json': 'application/json; charset=utf-8',
	'.svg': 'image/svg+xml',
	'.png': 'image/png',
	'.ico': 'image/x-icon',
	'.woff2': 'font/woff2',
	'.woff': 'font/woff',
	'.map': 'application/json; charset=utf-8',
	'.txt': 'text/plain; charset=utf-8'
}

// ── main ────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2)

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

const JSON_OUT = args.includes('--json')
const NO_OPEN = args.includes('--no-open')

let port = DEFAULT_PORT
{
	const i = args.indexOf('--port')
	if (i !== -1) {
		const value = args[i + 1]
		if (value === undefined || value.startsWith('--') || !/^\d{1,5}$/.test(value) || Number(value) > 65535) {
			console.error(refusalLine('--port needs a number from 0 to 65535'))
			process.exit(2)
		}
		port = Number(value)
	}
}

// The bundle is part of this program, and its absence is a packaging fault —
// said in the dispatcher's words, because it is the dispatcher's class of
// fault: the tarball was built without it.
for (const required of [join(VIEW, 'index.html'), EXPORTER]) {
	if (!existsSync(required)) {
		console.error(refusalLine('view is missing its viewer bundle'))
		console.error(`  expected ${required}\n  This is a packaging fault, not something you did — please report it.`)
		process.exit(2)
	}
}

const LIBRARY = resolveLibrary(args)

// ── export ──────────────────────────────────────────────────────────────────

const scratch = mkdtempSync(join(tmpdir(), 'qrntn-view-'))
const GRAPH = join(scratch, 'graph.json')
const cleanup = () => rmSync(scratch, { recursive: true, force: true })

{
	// `process.execPath`, never 'node': a PATH lookup is not guaranteed to find
	// the interpreter running this file. The exporter takes the library by
	// name and the output by name, so nothing here depends on where either of
	// us sits.
	const r = spawnSync(process.execPath, [EXPORTER, '--library', LIBRARY, '--out', GRAPH], { encoding: 'utf8' })
	if (r.status !== 0 || !existsSync(GRAPH)) {
		cleanup()
		const err = (r.stderr ?? '').trim()
		if (/^refused:/m.test(err)) {
			// The exporter's own refusal — not a library, no catalog — in its
			// own words and with its own code, which is already 2.
			console.error(err)
			process.exit(2)
		}
		// Anything else is the exporter failing on a library-shaped fact it
		// does not refuse cleanly — a held skill with no ledger entry, say.
		// The message, not the trace.
		const message = (err.split('\n').find((l) => /Error: /.test(l))?.replace(/^.*Error: /, '') ?? err.split('\n').filter(Boolean).pop() ?? `exit ${r.status}`)
			// The exporter prefixes its own name; here it is already named.
			.replace(/^export-graph: /, '')
		console.error(refusalLine(`the graph could not be exported — ${message}`))
		console.error(`  run \`qrntn check --library ${LIBRARY}\` for what is inconsistent`)
		// 1: it ran, and the answer is no. The library is set up and something
		// in it does not hold — a held skill with no ledger entry, say — which
		// is the same distinction check-library.mjs draws between an
		// inconsistent library and one that was never set up.
		//
		// This read `r.status === null ? 1 : 1` until an independent review of
		// this branch pointed at it: both branches of a ternary the same, a
		// leftover from an edit, doing nothing but implying a distinction that
		// was not there.
		process.exit(1)
	}
}

const graphBytes = readFileSync(GRAPH)
let counts = { nodes: 0, edges: 0 }
try {
	const snapshot = JSON.parse(graphBytes.toString('utf8'))
	counts = { nodes: snapshot.nodes?.length ?? 0, edges: snapshot.edges?.length ?? 0 }
} catch {
	cleanup()
	console.error(refusalLine('the exporter wrote something that is not a graph'))
	console.error('  This is a fault in the tool, not in your library — please report it.')
	// 2, not 1, and the difference is which of the two the reader should go
	// and look at. The exporter said it succeeded and then produced bytes that
	// are not a snapshot: nothing was learned about the library, so there is no
	// answer to report — this could not run.
	process.exit(2)
}

// ── serve ───────────────────────────────────────────────────────────────────

const INDEX = readFileSync(join(VIEW, 'index.html'))

/** The Host header names this machine at this port, or nothing is answered. */
function hostIsOurs(host, boundPort) {
	if (typeof host !== 'string' || host === '') return false
	// `[::1]:7768` — the bracket form keeps its colons; split on the last one
	// only when what follows is a port.
	const m = /^(.*?)(?::(\d{1,5}))?$/.exec(host.trim().toLowerCase())
	if (!m) return false
	const [, name, p] = m
	if (!HOSTS.has(name)) return false
	return p === undefined || Number(p) === boundPort
}

function handle(req, res) {
	if (req.method !== 'GET' && req.method !== 'HEAD') {
		res.writeHead(405, { Allow: 'GET, HEAD' })
		return res.end()
	}
	// BEFORE THE PATH. A request that calls this server by a name that is
	// not this machine's is not answered, whatever it asks for — the file
	// comment at the top says why, and docs/SERVING.md says it at length.
	// 400 when there is no Host at all (HTTP/1.0 allows that; nothing a
	// browser sends does), 403 when there is one and it is not ours. Neither
	// body repeats what was sent: a page probing this port learns that it was
	// refused and not what would have been accepted.
	{
		const host = req.headers.host
		if (host === undefined || host === '') {
			res.writeHead(400, { 'Content-Type': CONTENT_TYPES['.txt'], 'X-Content-Type-Options': 'nosniff', Server: SERVER_HEADER })
			return res.end('a Host header is required\n')
		}
		if (!hostIsOurs(host, server.address()?.port)) {
			res.writeHead(403, { 'Content-Type': CONTENT_TYPES['.txt'], 'X-Content-Type-Options': 'nosniff', Server: SERVER_HEADER })
			return res.end('forbidden: qrntn view answers only as localhost\n')
		}
	}
	// The path, taken from the request line by hand. `new URL(req.url, base)`
	// reads `//host/x` as a protocol-relative URL and answers `/` for it —
	// harmless in a bundle this small, and still the wrong thing to be doing.
	// Query and fragment are dropped; the path is decoded once and normalised,
	// which collapses `//` and resolves `..` before the bundle root check.
	let pathname
	try {
		const raw = req.url ?? '/'
		if (!raw.startsWith('/')) throw new Error('not a path')
		pathname = posix.normalize(decodeURIComponent(raw.split(/[?#]/)[0]))
	} catch {
		res.writeHead(400)
		return res.end()
	}

	// Every response, whatever it carries: never sniffed into another type,
	// never a referrer. And on the page, the policy that makes the reader
	// safe to ship (docs/READING.md): the viewer renders held
	// skills' full artefact text as source, and a policy that admits no
	// remote fetch is what keeps "nothing leaves the machine" true if any of
	// that text is ever rendered as more than text. Mirrored as a <meta> in
	// nexus/index.html so `vite dev` is held to the same rule. Belt and
	// braces, with the belt named — the same phrase as the traversal check
	// below, for the same reason.
	const send = (status, body, type) => {
		const headers = {
			'Content-Type': type,
			'Content-Length': body.length,
			'Cache-Control': 'no-store',
			'X-Content-Type-Options': 'nosniff',
			'Referrer-Policy': 'no-referrer',
			Server: SERVER_HEADER,
		}
		if (type === CONTENT_TYPES['.html']) headers['Content-Security-Policy'] = CSP
		res.writeHead(status, headers)
		res.end(req.method === 'HEAD' ? undefined : body)
	}
	const notFound = () => send(404, Buffer.from('not found\n'), CONTENT_TYPES['.txt'])

	// The one data path, and the only thing under /data/ that is ever served:
	// the graph exported for the library named at start. The viewer's own
	// public/data/ is the fixture, and it does not ship — but even a bundle
	// that carried it would not get to answer with it here.
	if (pathname === '/data/graph.json') return send(200, graphBytes, CONTENT_TYPES['.json'])
	if (pathname.startsWith('/data/')) return notFound()
	if (pathname === '/' || pathname === '/index.html') return send(200, INDEX, CONTENT_TYPES['.html'])

	// Inside the bundle, or nothing.
	//
	// THE NORMALISATION ABOVE IS WHAT STOPS TRAVERSAL, not this line, and it
	// is worth being exact about which is which. `posix.normalize` on a path
	// that already begins with `/` drops every `..` that would climb past the
	// root, so `/../package.json` is `/package.json` before it ever gets here
	// and the prefix check below has nothing left to catch. Measured, not
	// assumed: view.self-test.mjs mutates this line away and records that the
	// suite cannot tell, because on this platform no request can reach it.
	//
	// It stays anyway, and not as decoration. It is the check that still holds
	// if the normalisation above is ever changed or removed, and it is the one
	// that matters on a platform where `\` separates — `posix.normalize`
	// leaves `..\..\x` as a single segment, and `resolve` there would treat it
	// as a climb. Belt and braces, with the belt named.
	const file = resolve(VIEW, `.${pathname}`)
	if (!file.startsWith(VIEW + sep)) return notFound()
	let st
	try {
		st = statSync(file)
	} catch {
		return notFound()
	}
	if (!st.isFile()) return notFound()
	return send(200, readFileSync(file), CONTENT_TYPES[extname(file)] ?? 'application/octet-stream')
}

const server = createServer(handle)

/** One HEAD to the port that refused us: is the squatter another `qrntn view`? Resolves to its Server header, or null. */
function probe(p) {
	return new Promise((resolveP) => {
		const req = request({ host: '127.0.0.1', port: p, method: 'HEAD', path: '/', timeout: 1000 }, (res) => {
			res.resume()
			const named = res.headers.server ?? ''
			resolveP(named.startsWith('qrntn-view') ? named : null)
		})
		req.on('timeout', () => { req.destroy() })
		req.on('error', () => resolveP(null))
		req.end()
	})
}

server.on('error', async (e) => {
	cleanup()
	if (e.code === 'EADDRINUSE') {
		// Refused, not skipped past to the next free port: the fixed port is
		// the point. But whose is it? If it is ours, say so and name the URL —
		// the reader most likely wants that tab, not a second server. Exit is
		// 2 either way: this process exported nothing and served nothing, and
		// the one already up may be serving a graph older than the tree.
		const other = await probe(port)
		if (other) {
			console.error(refusalLine(`another qrntn view is already serving on port ${port} — http://localhost:${port}/`))
			console.error(`  stop it there and re-run to re-export, or --port 0 for a second one`)
		} else {
			console.error(refusalLine(`port ${port} is in use — pick another with --port, or --port 0 to let the system choose`))
		}
	} else {
		console.error(refusalLine(`could not listen on 127.0.0.1:${port} — ${e.code ?? e.message}`))
	}
	process.exit(2)
})

// ── the browser ─────────────────────────────────────────────────────────────
//
// The platform's own opener, handed the URL and nothing else, spawned
// detached with its stdio closed: Ctrl-C here must not reach the browser, and
// a browser writing to a pipe nobody reads must not block this server.
// `BROWSER=<command>` runs that instead, the convention CRA, Vite and Netlify
// share — and, as it happens, the only way to test this without a browser.
// `BROWSER=none` is the same convention's off switch.
//
// Under WSL there is often no `xdg-open`; `wslview` is the usual bridge, and
// the Windows `cmd.exe` is on every WSL PATH by interop. Tried in that order.
function isWSL() {
	if (process.platform !== 'linux') return false
	try {
		return /microsoft/i.test(readFileSync('/proc/version', 'utf8'))
	} catch {
		return false
	}
}

function openerCandidates(url) {
	const browser = process.env.BROWSER
	if (browser) return [[browser, [url]]]
	if (process.platform === 'darwin') return [['open', [url]]]
	if (process.platform === 'win32') return [['cmd', ['/c', 'start', '', url]]]
	if (isWSL()) return [['wslview', [url]], ['cmd.exe', ['/c', 'start', '', url]]]
	return [['xdg-open', [url]]]
}

/** Try each opener in turn; `onFail` runs once when none could be started. */
function openBrowser(url, onFail) {
	const candidates = openerCandidates(url)
	const attempt = (i) => {
		if (i >= candidates.length) return onFail()
		const [cmd, argv] = candidates[i]
		let child
		try {
			child = spawn(cmd, argv, { detached: true, stdio: 'ignore' })
		} catch {
			return attempt(i + 1)
		}
		// ENOENT and its kin arrive as an event, after spawn returned.
		child.on('error', () => attempt(i + 1))
		child.unref()
	}
	attempt(0)
}

// Opened unless told not to, in any of the ways the field already
// recognises. A pipe is a reason on its own only when BROWSER is unset: an
// explicit BROWSER is an instruction, and a test's recorder is one. `--json`
// is not in this expression because it never reaches it: the JSON branch
// below prints its line and returns before the opener is consulted, and
// view.self-test.mjs removes that return to prove the suite would notice.
const OPEN = !NO_OPEN && process.env.BROWSER !== 'none' && (process.stdout.isTTY || Boolean(process.env.BROWSER))

const stop = () => {
	server.close()
	cleanup()
	// 0: stopped, which is what was asked. Not a signal death.
	process.exit(0)
}
process.on('SIGINT', stop)
process.on('SIGTERM', stop)

server.listen(port, '127.0.0.1', () => {
	const bound = server.address().port
	// Two spellings of one address. The reader gets `localhost`, which is the
	// name they will type and remember; the JSON line gets the address that
	// was actually bound, for a client that resolves `localhost` to ::1 alone.
	const url = `http://localhost:${bound}/`
	const boundUrl = `http://127.0.0.1:${bound}/`
	if (JSON_OUT) {
		console.log(JSON.stringify({ library: LIBRARY, url: boundUrl, port: bound, nodes: counts.nodes, edges: counts.edges, graph: GRAPH }))
		return
	}
	console.log(`\nview · ${basename(LIBRARY)}\n`)
	console.log(`  ${tint.dim(LIBRARY)}`)
	console.log(`  ${counts.nodes} nodes · ${counts.edges} edges`)
	console.log(`\n  ${tint.state(url)}\n`)
	console.log(`  ${tint.dim('Ctrl-C to stop · re-run to re-export · nothing leaves this machine')}\n`)
	if (OPEN) openBrowser(url, () => console.log(`  ${tint.dim('could not open a browser — open the URL above yourself')}\n`))
})
