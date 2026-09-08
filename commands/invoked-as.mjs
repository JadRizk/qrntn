// invoked-as.mjs — how this command was reached, for the one line that says it back.
//
// The verb is the contract; the filename behind it is not. bin/pratiq.mjs says
// so in its own header and keeps the mapping explicit precisely so a filename
// can change without the surface moving. Every usage line in commands/ then
// went ahead and printed the filename anyway, so a user who typed
// `pratiq promote` was answered with a usage line for `promote.mjs` — a script
// that is not on their PATH, in a directory they have no reason to know about.
//
// The fix cannot be to hardcode `pratiq` either. These scripts are still run
// directly — every suite in this repository spawns them by path, and the
// project's own docs invoke `node commands/init.mjs --library <dir>`. A usage
// line that named a front door the caller did not use would be wrong in the
// other direction, and wrong in the way that is harder to notice.
//
// So the dispatcher says which verb it dispatched, and each command asks. The
// answer is a string for a message, never a branch: nothing in this tool should
// behave differently depending on how it was reached, and if something ever
// does, this is not the module to hang it on.

import { basename } from 'node:path'
import { fileURLToPath } from 'node:url'

// The name bin/pratiq.mjs sets when it spawns. Nothing else sets it.
export const VERB_ENV = 'PRATIQ_VERB'

// Checked rather than trusted. It arrives from the environment and is echoed
// straight into text a user reads, so it is held to the shape of an actual
// verb — the same shape bin/pratiq.mjs's own table uses — instead of whatever
// happens to be in the variable.
const SAFE_VERB = /^[a-z][a-z-]{0,31}$/

/**
 * `pratiq promote` when the front door dispatched this, `node promote.mjs`
 * when it was run directly. Pass `import.meta.url` from the calling script.
 */
export function invokedAs(importMetaUrl) {
	const verb = process.env[VERB_ENV]
	if (verb && SAFE_VERB.test(verb)) return `pratiq ${verb}`
	return `node ${basename(fileURLToPath(importMetaUrl))}`
}
