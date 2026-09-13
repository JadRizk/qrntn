#!/usr/bin/env node
// Tests for view. Run: node view.test.mjs
//
// Two halves. The first runs view.mjs from a sandbox laid out the way the
// tarball is — commands/ beside a view/ — with a STUB bundle: an index.html,
// one asset, and an export-graph.mjs that honours --library and --out, refuses
// what the real one refuses, and writes a two-node graph. That covers the
// server, the wiring and every refusal without a viewer build, so it runs on
// every Node in the matrix. The second half runs only when the real bundle is
// present, and proves the same wiring against it. The smoke gate does that
// from the tarball; this does it from the checkout.

import { spawn, spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, request } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = mkdtempSync(join(tmpdir(), 'view-test-'))

let pass = 0
const failures = []
const check = (name, cond, detail = '') => {
	if (cond) pass++
	else failures.push(`${name}${detail ? ` — ${detail}` : ''}`)
}

// ── the sandbox: the package as it ships ────────────────────────────────────

const STUB_GRAPH = {
	nodes: [
		{ kind: 'origin', id: 'origin', title: 'stub' },
		{ kind: 'category', id: 'core', title: 'Core', blurb: '' }
	],
	edges: [{ kind: 'origin-clusters-category', from: 'origin', to: 'core', render: true, when: null, note: null, source: null }]
}

// What the real exporter does at its edges, and nothing else: the library by
// name, the output by name, a `refused:` line and exit 2 when the library is
// not one, a thrown Error when it is one with a fact the exporter cannot
// refuse cleanly.
const STUB_EXPORTER = `
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
const argv = process.argv.slice(2)
const at = (f) => { const i = argv.indexOf(f); return i === -1 ? null : argv[i + 1] }
const lib = resolve(at('--library') ?? process.cwd())
const out = at('--out')
if (!out) { console.error('refused: --out needs a file path'); process.exit(2) }
if (!existsSync(join(lib, 'skills'))) { console.error('refused: no skills/ directory in ' + lib + ' — qrntn acts on a library whose skills live in skills/'); process.exit(2) }
if (existsSync(join(lib, 'THROW'))) throw new Error('export-graph: skills/broken has no ledger/broken.json — every held skill must have a ledger entry')
if (existsSync(join(lib, 'GARBAGE'))) { mkdirSync(dirname(out), { recursive: true }); writeFileSync(out, 'not a graph at all'); console.log('stub: claimed success'); process.exit(0) }
mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, JSON.stringify(${JSON.stringify(STUB_GRAPH)}) + '\\n')
console.log('stub: wrote 2 nodes -> ' + out)
`

function sandbox(label, { bundle = true } = {}) {
	const pkg = join(ROOT, label)
	mkdirSync(join(pkg, 'commands'), { recursive: true })
	for (const f of ['view.mjs', 'tint.mjs', 'invoked-as.mjs', 'argv.mjs']) cpSync(join(HERE, f), join(pkg, 'commands', f))
	if (bundle) {
		mkdirSync(join(pkg, 'view', 'assets'), { recursive: true })
		writeFileSync(join(pkg, 'view', 'index.html'), '<!doctype html><title>stub</title><script type="module" src="/assets/app.js"></script>')
		writeFileSync(join(pkg, 'view', 'assets', 'app.js'), 'console.log("stub")')
		writeFileSync(join(pkg, 'view', 'export-graph.mjs'), STUB_EXPORTER)
		// The fixture, planted on purpose: it must never be served. Two files,
		// and the second is the one that matters. `data/graph.json` is caught
		// by the rule that answers the exported graph, so a bundle carrying a
		// fixture at that name is covered whatever happens to the rule below
		// it. Any OTHER name under data/ is only ever refused by that second
		// rule, and refusing a file that is not there proves nothing — so the
		// fixture has to exist at a name nothing else answers.
		mkdirSync(join(pkg, 'view', 'data'), { recursive: true })
		writeFileSync(join(pkg, 'view', 'data', 'graph.json'), JSON.stringify({ nodes: [{ kind: 'origin', id: 'origin', title: 'FIXTURE' }], edges: [] }))
		writeFileSync(join(pkg, 'view', 'data', 'snapshot.json'), JSON.stringify({ nodes: [{ kind: 'origin', id: 'origin', title: 'FIXTURE-SNAPSHOT' }], edges: [] }))
	}
	return join(pkg, 'commands', 'view.mjs')
}

function library(label) {
	const lib = join(ROOT, `${label}-lib`)
	mkdirSync(join(lib, 'skills'), { recursive: true })
	writeFileSync(join(lib, 'catalog.json'), JSON.stringify({ categories: [] }))
	return lib
}

const runSync = (script, args) => {
	const r = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' })
	return { code: r.status, raw: (r.stdout ?? '') + (r.stderr ?? ''), out: r.stdout ?? '', err: r.stderr ?? '' }
}

// EVERY SPAWNED SERVER IS REGISTERED, AND NONE OUTLIVES THIS FILE.
//
// The blocks below stop the process they started, but only on the path where
// its startup line parsed — and under view.self-test.mjs a mutant's output is
// exactly what does not parse. Each such run leaked a listening server, and
// after a dozen mutations the leftovers were enough to fail the clean run at
// the end and make the self-test report a defect in the suite that was really
// a defect in this harness. Found by counting `view.mjs` in the process table
// and seeing six, two of them minutes old.
//
// So: registered on spawn, and swept unconditionally at the end. The explicit
// stops stay, because a test that asserts a clean exit has to ask for one.
const spawned = []
const sweep = () => {
	for (const p of spawned) {
		try {
			p.kill('SIGKILL')
		} catch {
			/* already gone, which is the normal case */
		}
	}
}
process.on('exit', sweep)

/** Start the server, resolve with its first stdout line parsed, or with its exit if it never serves. */
function serve(script, args) {
	return new Promise((resolveP) => {
		const p = spawn(process.execPath, [script, ...args], { encoding: 'utf8' })
		spawned.push(p)
		let out = ''
		let err = ''
		let done = false
		p.stdout.on('data', (d) => {
			out += d
			if (!done && out.includes('\n')) {
				done = true
				let first = null
				try { first = JSON.parse(out.split('\n')[0]) } catch { /* asserted by caller */ }
				resolveP({ p, first, out: () => out, err: () => err })
			}
		})
		p.stderr.on('data', (d) => { err += d })
		p.on('exit', (code) => { if (!done) { done = true; resolveP({ p, first: null, code, out: () => out, err: () => err }) } })
	})
}

const stop = (p, signal = 'SIGINT') =>
	new Promise((resolveP) => {
		p.on('exit', (code, sig) => resolveP({ code, sig }))
		p.kill(signal)
	})

/** A raw request, so the path reaches the server exactly as written. */
const get = (url, path, method = 'GET') =>
	new Promise((resolveP, reject) => {
		const u = new URL(url)
		const req = request({ host: u.hostname, port: u.port, path, method }, (res) => {
			let body = ''
			res.setEncoding('utf8')
			res.on('data', (d) => { body += d })
			res.on('end', () => resolveP({ status: res.statusCode, headers: res.headers, body }))
		})
		req.on('error', reject)
		req.end()
	})

// ── usage ───────────────────────────────────────────────────────────────────
{
	const script = sandbox('usage')
	const help = runSync(script, ['--help'])
	check('--help: exit 0', help.code === 0, `exit ${help.code}`)
	check('--help: names the verb and the flags', /usage: .*view/.test(help.out) && /--port/.test(help.out) && /--library/.test(help.out), help.out.slice(0, 200))

	const unknown = runSync(script, ['--prot', '1'])
	check('unknown flag: exit 2', unknown.code === 2 && /unknown option --prot/.test(unknown.err), unknown.raw.slice(0, 200))
	check('unknown flag: suggests --port', /did you mean --port/.test(unknown.err), unknown.err)

	for (const bad of ['abc', '70000', '--json']) {
		const r = runSync(script, ['--port', bad])
		check(`--port ${bad}: exit 2 with the range`, r.code === 2 && /0 to 65535/.test(r.err), r.raw.slice(0, 200))
	}
}

// ── the bundle is part of the program ───────────────────────────────────────
{
	const script = sandbox('no-bundle', { bundle: false })
	const r = runSync(script, ['--library', library('no-bundle')])
	check('missing bundle: exit 2', r.code === 2, `exit ${r.code}`)
	check('missing bundle: a packaging fault, in the dispatcher\'s words', /missing its viewer bundle/.test(r.err) && /packaging fault/.test(r.err), r.err)
	check('missing bundle: names where it looked', /view[\\/]index\.html/.test(r.err), r.err)
	check('missing bundle: not the dispatcher\'s other wording', !/missing its implementation/.test(r.err), r.err)
}

// ── the exporter's own answers pass through ─────────────────────────────────
{
	const script = sandbox('not-a-library')
	const notLib = join(ROOT, 'not-a-library-dir')
	mkdirSync(notLib, { recursive: true })
	const r = runSync(script, ['--library', notLib])
	check('not a library: exit 2', r.code === 2, `exit ${r.code} ${r.raw.slice(0, 200)}`)
	check('not a library: the exporter\'s refusal, verbatim', /^refused: no skills\/ directory in/m.test(r.err), r.err)
	check('not a library: no stack trace', !/^\s+at .+\(.+:\d+:\d+\)$/m.test(r.raw), r.raw.slice(0, 300))
}
{
	const script = sandbox('throws')
	const lib = library('throws')
	writeFileSync(join(lib, 'THROW'), '')
	const r = runSync(script, ['--library', lib])
	check('exporter throws: exit 1 — ran, and the library is inconsistent', r.code === 1, `exit ${r.code}`)
	check('exporter throws: the message, not the trace', /^refused: the graph could not be exported — skills\/broken has no ledger/m.test(r.err), r.err)
	check('exporter throws: points at check', /qrntn check/.test(r.err), r.err)
	check('exporter throws: no stack trace', !/^\s+at .+\(.+:\d+:\d+\)$/m.test(r.raw), r.raw.slice(0, 300))
}
{
	// The exporter says it succeeded and writes bytes that are not a snapshot.
	// Nothing was learned about the library, so there is no answer to report:
	// this is 2, could not run, and it is a fault in the tool rather than in
	// anybody's library. Flagged by review as an exit path nothing exercised —
	// and it exited 1, which would have sent the reader to look at their own
	// library for a problem that is not there.
	const script = sandbox('garbage')
	const lib = library('garbage')
	writeFileSync(join(lib, 'GARBAGE'), '')
	const r = runSync(script, ['--library', lib])
	check('exporter writes a non-graph: exit 2 — could not run', r.code === 2, `exit ${r.code} ${r.raw.slice(0, 200)}`)
	check('exporter writes a non-graph: says so, and whose fault it is', /is not a graph/.test(r.err) && /fault in the tool/.test(r.err), r.err.slice(0, 200))
	check('exporter writes a non-graph: no stack trace', !/^\s+at .+\(.+:\d+:\d+\)$/m.test(r.raw), r.raw.slice(0, 300))
}

// ── serving ─────────────────────────────────────────────────────────────────
{
	const script = sandbox('serves')
	const lib = library('serves')
	const s = await serve(script, ['--library', lib, '--json'])
	check('serves: started', s.first !== null, `exit ${s.code} ${s.out()} ${s.err()}`)
	if (s.first) {
		const { url } = s.first
		check('serves: --json names the url, the counts and the graph', /^http:\/\/127\.0\.0\.1:\d+\/$/.test(url) && s.first.nodes === 2 && s.first.edges === 1 && existsSync(s.first.graph), JSON.stringify(s.first))
		check('serves: the library it was pointed at', s.first.library === lib, s.first.library)

		const graph = await get(url, '/data/graph.json')
		check('serves: /data/graph.json is the graph exported for this library', graph.status === 200 && JSON.parse(graph.body).nodes[0].title === 'stub', graph.body.slice(0, 200))
		check('serves: as json, uncached', /application\/json/.test(graph.headers['content-type']) && graph.headers['cache-control'] === 'no-store', JSON.stringify(graph.headers))

		const absent = await get(url, '/data/other.json')
		check('serves: nothing else under /data/', absent.status === 404, `${absent.status}`)

		// The reader renders held skills' full artefact text (READING.md), so
		// the page ships under a policy that admits no remote fetch, and no
		// response is ever sniffed into another type. The header is the belt;
		// nexus/index.html's <meta> is the braces, held to the same string.
		const page = await get(url, '/')
		const csp = page.headers['content-security-policy'] ?? ''
		check('serves: index.html carries a Content-Security-Policy', /default-src 'self'/.test(csp) && /connect-src 'self'/.test(csp) && /object-src 'none'/.test(csp) && !/unsafe-eval/.test(csp), csp)
		check('serves: the policy admits no remote source', !/https?:/.test(csp) && !/\*/.test(csp), csp)
		check('serves: nosniff and no referrer, on every response', page.headers['x-content-type-options'] === 'nosniff' && page.headers['referrer-policy'] === 'no-referrer' && graph.headers['x-content-type-options'] === 'nosniff' && absent.headers['x-content-type-options'] === 'nosniff', JSON.stringify([page.headers, absent.headers]))
		// The one that has teeth: this file EXISTS in the bundle. Without the
		// rule that refuses everything under /data/, it is found on disk and
		// served, and a fixture answers as though it were this library.
		const planted = await get(url, '/data/snapshot.json')
		check('serves: a fixture that exists in the bundle is still refused', planted.status === 404 && !planted.body.includes('FIXTURE'), `${planted.status} ${planted.body.slice(0, 80)}`)
		const fixtureByName = await get(url, '/data/../data/graph.json')
		check('serves: the planted fixture is not reachable by any spelling', fixtureByName.status === 200 && !fixtureByName.body.includes('FIXTURE'), fixtureByName.body.slice(0, 100))

		const index = await get(url, '/')
		check('serves: / is index.html', index.status === 200 && /<title>stub<\/title>/.test(index.body) && /text\/html/.test(index.headers['content-type']), `${index.status}`)
		const asset = await get(url, '/assets/app.js')
		check('serves: an asset, with its type', asset.status === 200 && /text\/javascript/.test(asset.headers['content-type']), `${asset.status} ${asset.headers['content-type']}`)
		const missing = await get(url, '/nope.js')
		check('serves: 404 for what is not in the bundle', missing.status === 404, `${missing.status}`)
		// A directory is not a file. Reading one throws EISDIR, which without
		// this rule is an uncaught exception rather than an answer — the server
		// dies mid-request and every later assertion fails for the wrong
		// reason. Asked before the traversal cases for that reason.
		const dir = await get(url, '/assets')
		check('serves: a directory is refused, not read', dir.status === 404, `${dir.status}`)
		const stillUp = await get(url, '/data/graph.json')
		check('serves: and the server survived being asked', stillUp.status === 200, `${stillUp.status}`)

		const doubled = await get(url, '//data/graph.json')
		check('serves: a doubled slash is the same path, not a protocol-relative host', doubled.status === 200 && /"stub"/.test(doubled.body), `${doubled.status}`)
		const hostish = await get(url, '//evil.example/index.html')
		check('serves: and never a different host', hostish.status === 404, `${hostish.status}`)

		for (const p of ['/../package.json', '/..%2fpackage.json', '/assets/../../commands/view.mjs', '/%2e%2e/commands/view.mjs']) {
			const r = await get(url, p)
			check(`serves: ${p} does not leave the bundle`, r.status === 404 && !/view — the graph/.test(r.body), `${r.status} ${r.body.slice(0, 80)}`)
		}
		const post = await get(url, '/', 'POST')
		check('serves: only GET and HEAD', post.status === 405, `${post.status}`)
		const head = await get(url, '/data/graph.json', 'HEAD')
		check('serves: HEAD answers without a body', head.status === 200 && head.body === '', `${head.status} ${head.body.length}`)

		const graphPath = s.first.graph
		const stopped = await stop(s.p)
		check('serves: Ctrl-C stops it with exit 0, not a signal death', stopped.code === 0 && stopped.sig === null, JSON.stringify(stopped))
		check('serves: the exported graph is cleaned up', !existsSync(graphPath) && !existsSync(dirname(graphPath)), graphPath)
	}
}
{
	const script = sandbox('human')
	const lib = library('human')
	const p = spawn(process.execPath, [script, '--library', lib], { encoding: 'utf8' })
	spawned.push(p)
	let out = ''
	await new Promise((resolveP) => {
		// Bounded: a mutant that prints nothing would otherwise stall the suite
		// here rather than fail it, and a stalled suite reports nothing at all.
		const timer = setTimeout(resolveP, 20000)
		const done = () => { clearTimeout(timer); resolveP() }
		// Waits for the LAST line of the block, not the URL. The URL is printed
		// two lines before the end, and stdout arrives in chunks: resolving on
		// it read the assertions below against a half-written report and failed
		// roughly one run in six. A readiness test has to name the end of the
		// thing it is waiting for.
		p.stdout.on('data', (d) => { out += d; if (/nothing leaves this machine/.test(out)) done() })
		p.on('exit', done)
	})
	check('human output: names the library, the counts and the url', /view · human-lib/.test(out) && /2 nodes · 1 edges/.test(out) && /http:\/\/127\.0\.0\.1:\d+\//.test(out), out)
	check('human output: says how to stop and that nothing leaves', /Ctrl-C/.test(out) && /nothing leaves/.test(out), out)
	const stopped = await stop(p, 'SIGTERM')
	check('human output: SIGTERM stops it with 0 too', stopped.code === 0, JSON.stringify(stopped))
}
{
	// A port already taken: refused with 2, before anything is served.
	const script = sandbox('busy-port')
	const lib = library('busy-port')
	const holder = createServer(() => {})
	await new Promise((resolveP) => holder.listen(0, '127.0.0.1', resolveP))
	const port = holder.address().port
	const r = runSync(script, ['--library', lib, '--port', String(port)])
	holder.close()
	check('busy port: exit 2', r.code === 2, `exit ${r.code} ${r.raw.slice(0, 200)}`)
	check('busy port: says which port and what to do', new RegExp(`port ${port} is in use`).test(r.err) && /--port/.test(r.err), r.err)
}
{
	// A fixed port is honoured.
	const script = sandbox('fixed-port')
	const lib = library('fixed-port')
	const holder = createServer(() => {})
	await new Promise((resolveP) => holder.listen(0, '127.0.0.1', resolveP))
	const port = holder.address().port
	await new Promise((resolveP) => holder.close(resolveP))
	const s = await serve(script, ['--library', lib, '--port', String(port), '--json'])
	check('--port: listens where it was told', s.first?.port === port && s.first?.url === `http://127.0.0.1:${port}/`, JSON.stringify(s.first) + s.err())
	if (s.first) await stop(s.p)
}

// ── the real bundle, when it is there ───────────────────────────────────────
//
// Built by nexus/scripts/build-view.mjs, gitignored, so present only after a
// build. Skipped with a line rather than silently, for the reason check.mjs
// gives: a gate that quietly covers less than it appears to.
{
	const REAL = join(HERE, '..', 'view')
	if (!existsSync(join(REAL, 'index.html')) || !existsSync(join(REAL, 'export-graph.mjs'))) {
		console.log('  (the real bundle is not built — view/ absent — so only the stub half ran; `npm run build:cli --prefix nexus` builds it)')
	} else {
		const lib = join(ROOT, 'real-lib')
		mkdirSync(join(lib, 'skills'), { recursive: true })
		const init = spawnSync(process.execPath, [join(HERE, 'init.mjs'), '--library', lib], { encoding: 'utf8' })
		check('real bundle: a library was made to view', init.status === 0, init.stdout + init.stderr)
		const s = await serve(join(HERE, 'view.mjs'), ['--library', lib, '--json'])
		check('real bundle: the bundled exporter ran and the server started', s.first !== null, `exit ${s.code} ${s.out()} ${s.err()}`)
		if (s.first) {
			const graph = await get(s.first.url, '/data/graph.json')
			const snapshot = JSON.parse(graph.body)
			check('real bundle: an init-made library graphs to its origin and one category', snapshot.nodes.map((n) => n.kind).sort().join(',') === 'category,origin', graph.body.slice(0, 200))
			check('real bundle: the origin is named after the library, not the tool', snapshot.nodes.find((n) => n.kind === 'origin')?.title !== 'Nexus', JSON.stringify(snapshot.nodes[0]))
			const index = await get(s.first.url, '/')
			check('real bundle: index.html is the viewer', index.status === 200 && /<div id="root">/.test(index.body), index.body.slice(0, 200))
			// Two places, one policy: the <meta> the viewer's own page carries is
			// the header the server sets, verbatim — so `vite dev` and the
			// bundle are held to the same rule (READING.md).
			const metaCsp = /http-equiv="Content-Security-Policy"\s+content="([^"]+)"/.exec(index.body)?.[1] ?? ''
			check('real bundle: the page\'s own <meta> policy is the served header, verbatim', metaCsp !== '' && metaCsp === (index.headers['content-security-policy'] ?? ''), `${metaCsp}\n${index.headers['content-security-policy']}`)
			const assetPath = /src="(\/assets\/[^"]+\.js)"/.exec(index.body)?.[1]
			const asset = assetPath ? await get(s.first.url, assetPath) : { status: 0 }
			check('real bundle: the viewer\'s script is served', asset.status === 200, `${assetPath} -> ${asset.status}`)
			const fixture = await get(s.first.url, '/data/graph.json')
			check('real bundle: the served graph is not the 49-node fixture', JSON.parse(fixture.body).nodes.length < 10, `${JSON.parse(fixture.body).nodes.length} nodes`)
			const stopped = await stop(s.p)
			check('real bundle: stops clean', stopped.code === 0, JSON.stringify(stopped))
		}
	}
}

rmSync(ROOT, { recursive: true, force: true })

console.log(`\n${pass} passed, ${failures.length} failed`)
if (failures.length) {
	for (const f of failures) console.error(`  FAIL  ${f}`)
	process.exit(1)
}
