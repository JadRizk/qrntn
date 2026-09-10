#!/usr/bin/env node
//
// prepack.mjs — the bundle is built before the tarball is, or the tarball is
// knowingly built without it.
//
//   npm pack      runs this first, via package.json's `prepack`
//   npm publish   the same, after prepublishOnly has run every gate
//
// `view/` is a build output: gitignored, listed in `files`, made by
// nexus/scripts/build-view.mjs at publish time and never committed, because a
// generated file that is committed is a file that drifts. The cost of that
// decision is a footgun — `npm pack` on a checkout where the bundle was never
// built produces a tarball whose `view` verb refuses as a packaging fault, and
// nothing says so until someone installs it. This closes it: the build is a
// step npm takes, not a step a person remembers.
//
// IT SKIPS RATHER THAN REFUSES when the viewer's toolchain is absent, and the
// distinction is load-bearing in two places. smoke.mjs decides which of its two
// view cases to assert "by the tree, not by a flag" — with a bundle it must
// serve the library's graph, without one it must say it is missing, with exit
// 2. Refusing here would delete the second case from the suite. And npm runs
// prepack when a git dependency is installed, where nexus/node_modules does not
// exist and cannot be made to.
//
// So it says which of the two happened, in the same words check.mjs uses for
// the same condition. A step that skips silently is how a pipeline quietly
// stops covering something.
//
// Plain Node, no dependencies — like everything else at this root.

import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const NEXUS = join(HERE, 'nexus')

if (!existsSync(join(NEXUS, 'node_modules'))) {
	console.log('prepack: skip the viewer bundle — nexus/node_modules absent; run `npm ci --prefix nexus` to ship one')
	console.log('prepack: the tarball will carry no view/, and `qrntn view` from it will refuse as a packaging fault')
	process.exit(0)
}

const r = spawnSync(process.execPath, [join(NEXUS, 'scripts', 'build-view.mjs')], { stdio: 'inherit' })
// The build's own exit code, carried. A bundle that failed to build must stop
// the pack rather than ship half of itself — build-view.mjs already asserts
// that index.html and export-graph.mjs were produced and that the fixture did
// not survive, so a 0 here means those three facts hold.
process.exit(r.status === null ? 1 : r.status)
