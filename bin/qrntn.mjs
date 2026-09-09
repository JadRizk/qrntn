#!/usr/bin/env node
//
// The front door. Every verb resolves to exactly one script in commands/, and
// this file runs it — it does not reimplement, wrap, or re-parse anything.
//
// SPAWN, NOT IMPORT. The reason is not that the commands have top-level side
// effects; six of the eight guard theirs with an `invokedAsScript()` check and
// export their internals, and the two that do not could be made to match in an
// afternoon. The reason is that every suite in this repository tests these as
// spawned CLIs — `run()` in foreign-library.test.mjs, round-trip.test.mjs and
// the rest all spawnSync a script path. An importing dispatcher would reach the
// exit codes and refusal output those suites assert by a different route in
// production than in test, which is a second invocation path that nothing
// checks. One implementation, invoked; that is what SURFACE.md means by "wrap".
//
// Arguments are passed through untouched. This file knows nothing about
// --library, --json or any other flag, and adding a flag to a command must
// never require editing this file. The one thing it owns is the verb.
//
// Exit codes are propagated, not translated. The convention every command
// already follows, and which a publish freezes:
//
//   0   clean
//   1   ran, and the answer is no      (a refusal, a mismatch)
//   2   could not run                  (usage error, not a library, no catalog)
//
// Plain Node, no dependencies, in keeping with the rest of the tool.
//
// NO COLOUR HERE, deliberately, and this is the one surface that stays plain
// even once commands/tint.mjs has consumers. This file's refusals are packaging
// faults — "commands/ is missing" — and a module that reports commands/ is
// missing cannot itself be imported from commands/. Not hypothetical: importing
// tint.mjs here turned the friendly "this is a packaging fault, please report
// it" message into an ERR_MODULE_NOT_FOUND stack trace, and qrntn.test.mjs
// caught it. The front door stays plain so that it still works when nothing
// else does.

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const COMMANDS = join(HERE, '..', 'commands')

// Duplicated from commands/invoked-as.mjs, which exports it under the same
// name, and duplicated ON PURPOSE for the reason in the header: this file
// cannot import from commands/, because its whole job when commands/ is missing
// is to say so. Importing the constant would reintroduce the exact fault that
// header describes, to save one line. commands/qrntn.test.mjs asserts the two
// agree, so the copy cannot drift silently.
const VERB_ENV = 'QRNTN_VERB'

// The verb is the contract; the filename behind it is not. `audit` runs
// audit-skill.mjs and `check` runs check-library.mjs — the latter deliberately
// not named check.mjs, which is this repository's own gate runner and does not
// ship. Keeping the mapping explicit is what lets a filename change without the
// surface moving. Ordered as the lifecycle runs, not alphabetically, because
// this table is also what `qrntn` with no arguments prints.
//
// Two things must stay true of every row, and commands/qrntn.test.mjs asserts
// both: the script exists, and it is listed in package.json's `files` allowlist.
// The second is the one that cannot be caught by running this from a checkout —
// a verb missing from the allowlist works here and is broken in the tarball.
const VERBS = [
	['init', 'init.mjs', 'make a folder of skills into a library — once, before anything else'],
	['intake', 'intake.mjs', 'fetch a skill at a pinned commit into quarantine, without reading it'],
	['audit', 'audit-skill.mjs', 'scan every file as data; report, never edit'],
	['adopt', 'adopt.mjs', 'record the decision — adopted, declined or refused — before anything moves'],
	['promote', 'promote.mjs', 're-scan and move it into the library, or refuse'],
	['refresh', 'refresh.mjs', 're-diff the pin against upstream; report drift, never move the pin'],
	['usage', 'usage.mjs', 'count what actually fired, from local transcripts'],
	['overlap', 'overlap.mjs', 'which descriptions compete for the same request'],
	['ledger', 'ledger.mjs', 'the record per held skill — regenerate and diff it'],
	['check', 'check-library.mjs', 'is this library consistent — every skill filed, every entry matching']
]

const script = (verb) => VERBS.find(([v]) => v === verb)?.[1] ?? null

function refuse(message, detail) {
	console.error(`refused: ${message}`)
	if (detail) console.error(detail)
	// 2 — could not run. A verb this tool does not have is not a failed answer,
	// it is the absence of a question.
	process.exit(2)
}

// Read out of package.json, never carried as a constant here. A constant would
// be a second place the version lives, and the two would disagree at exactly the
// moment it mattered — a release, where the whole question is which bytes are
// running. npm puts package.json in every tarball whatever `files` says, so
// there is no allowlist entry to forget.
//
// Printed bare, with no name and no `v`. `qrntn --version` is something a
// script reads far more often than a person does, and a bare version needs no
// parsing; `qrntn` with no arguments already says what this is.
function version() {
	const manifest = join(HERE, '..', 'package.json')
	// The same packaging fault as a missing command, and said the same way. A
	// tool that cannot find its own manifest is broken in a manner its user did
	// not cause and cannot fix.
	if (!existsSync(manifest)) {
		refuse(
			'cannot read its own version',
			`  expected ${manifest}\n  This is a packaging fault, not something you did — please report it.`
		)
	}
	let declared = null
	try {
		declared = JSON.parse(readFileSync(manifest, 'utf8')).version ?? null
	} catch (e) {
		refuse('cannot read its own version', `  ${manifest}\n  ${e.message}`)
	}
	if (!declared) refuse('its own package.json declares no version', `  ${manifest}`)
	console.log(declared)
}

function usage() {
	const width = Math.max(...VERBS.map(([v]) => v.length))
	console.log('\nqrntn — record and gate a human decision about a skill before it loads\n')
	console.log('  qrntn <verb> [options]\n')
	for (const [verb, , blurb] of VERBS) console.log(`  ${verb.padEnd(width)}  ${blurb}`)
	console.log('\n  Every verb takes --library <dir>, falling back to SKILL_LIBRARY and then')
	console.log('  the working directory. Run a verb with no arguments for its own usage.\n')
}

const [verb, ...rest] = process.argv.slice(2)

if (!verb || verb === '--help' || verb === '-h') {
	usage()
	// Asking what this does is not an error when it is asked directly, and is
	// when it is the result of getting it wrong. `qrntn` bare answers 0.
	process.exit(verb ? 0 : 2)
}

// Before the verb lookup, so it is answered rather than refused as a verb this
// tool does not have — which is what it did until now, and is a confusing thing
// for a CLI to say about `--version`.
if (verb === '--version' || verb === '-v') {
	version()
	process.exit(0)
}

const file = script(verb)
if (!file) {
	refuse(
		`no such verb: "${verb}"`,
		`  qrntn has ${VERBS.length}: ${VERBS.map(([v]) => v).join(', ')}.\n  Run \`qrntn\` for what each one does.`
	)
}

const path = join(COMMANDS, file)
// A verb in the table with no script behind it means this package was built
// wrong — a files allowlist that dropped commands/, most likely. Say that,
// rather than letting Node report a path the reader has no reason to recognise.
if (!existsSync(path)) {
	refuse(
		`${verb} is missing its implementation`,
		`  expected ${path}\n  This is a packaging fault, not something you did — please report it.`
	)
}

// Arguments are still passed through untouched — this is not an argument. The
// command needs to know which verb reached it so its own usage line can say
// `qrntn promote` instead of `promote.mjs`, and the environment is where that
// belongs: a flag would be a flag every command had to parse and every caller
// could set, and the whole point is that this is not something a caller says.
// commands/invoked-as.mjs is the only reader, and it validates rather than
// trusts, because the value ends up in text a user reads.
const r = spawnSync(process.execPath, [path, ...rest], {
	stdio: 'inherit',
	env: { ...process.env, [VERB_ENV]: verb }
})

// Killed by a signal rather than exiting: there is no status to propagate, and
// reporting 0 would say the gate passed. 1 is the honest answer.
if (r.status === null) process.exit(1)
process.exit(r.status)
