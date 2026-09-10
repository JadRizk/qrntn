#!/usr/bin/env node
// view — the graph, served locally against any skill library.
//
//   node view.mjs [--library <dir>] [--port <n>] [--json]
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
// LOCAL, ONLY. Bound to 127.0.0.1, no browser opened, nothing leaves the
// machine. The URL is printed; opening it is the reader's act.
//
// Exit codes hold their meaning across a long-running process: 2 when it
// could not start — no bundle, not a library, port in use — and 0 when it is
// stopped. SIGINT is handled here so that Ctrl-C reads as a clean stop rather
// than a signal death, which the dispatcher would otherwise report as 1.
//
// Plain Node, no dependencies.

import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
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
	boolean: ['--json', '--help', '-h'],
	valued: ['--library', '--port']
}

const HERE = dirname(fileURLToPath(import.meta.url))
// The bundle sits beside commands/, not inside it: `view/` is a build output
// listed in `files`, and commands/ is source. Both resolve from this file's
// own location because both are parts of THIS PROGRAM — the one thing that
// may be found that way. The library never is.
const VIEW = resolve(HERE, '..', 'view')
const EXPORTER = join(VIEW, 'export-graph.mjs')

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
	return `usage: ${invokedAs()} [--library <dir>] [--port <n>] [--json]

  Exports the graph for the library, serves it on 127.0.0.1, prints the URL
  and runs until interrupted. Ctrl-C stops it; re-run to re-export.

  --library <dir>   the library — else SKILL_LIBRARY, else the working directory
  --port <n>        listen here rather than on a free port the system picks
  --json            one line with the URL and the counts, then serve

Nothing leaves the machine. The viewer's own data is never served — only the
graph exported here, for the library you named.

Exit codes:  0 stopped · 2 could not start — no bundle, not a library, port in use
`
}

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

let port = 0
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
		process.exit(r.status === null ? 1 : 1)
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
	process.exit(1)
}

// ── serve ───────────────────────────────────────────────────────────────────

const INDEX = readFileSync(join(VIEW, 'index.html'))

function handle(req, res) {
	if (req.method !== 'GET' && req.method !== 'HEAD') {
		res.writeHead(405, { Allow: 'GET, HEAD' })
		return res.end()
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

	const send = (status, body, type) => {
		res.writeHead(status, { 'Content-Type': type, 'Content-Length': body.length, 'Cache-Control': 'no-store' })
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

server.on('error', (e) => {
	cleanup()
	if (e.code === 'EADDRINUSE') {
		console.error(refusalLine(`port ${port} is in use — pick another with --port, or none to let the system choose`))
	} else {
		console.error(refusalLine(`could not listen on 127.0.0.1:${port} — ${e.code ?? e.message}`))
	}
	process.exit(2)
})

const stop = () => {
	server.close()
	cleanup()
	// 0: stopped, which is what was asked. Not a signal death.
	process.exit(0)
}
process.on('SIGINT', stop)
process.on('SIGTERM', stop)

server.listen(port, '127.0.0.1', () => {
	const url = `http://127.0.0.1:${server.address().port}/`
	if (JSON_OUT) {
		console.log(JSON.stringify({ library: LIBRARY, url, port: server.address().port, nodes: counts.nodes, edges: counts.edges, graph: GRAPH }))
		return
	}
	console.log(`\nview · ${basename(LIBRARY)}\n`)
	console.log(`  ${tint.dim(LIBRARY)}`)
	console.log(`  ${counts.nodes} nodes · ${counts.edges} edges`)
	console.log(`\n  ${tint.state(url)}\n`)
	console.log(`  ${tint.dim('Ctrl-C to stop · re-run to re-export · nothing leaves this machine')}\n`)
})
