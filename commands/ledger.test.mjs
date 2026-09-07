#!/usr/bin/env node
// Tests for ledger.mjs. Run: node ledger.test.mjs
//
// Black box against the CLI, same reasoning as promote.test.mjs: each fixture
// is a whole fake library — `repo/skills/<name>/` and the ledger it grows.
//
// It used to copy the real ledger.mjs into `repo/scripts/` as well, because the
// script derived its root from its own file location and there was no other way
// to point it at a fixture. SK-97 removed that: the library is named with
// `--library`, so the tests now run the shipped file against the fixture rather
// than a copy sitting inside it — which is also the arrangement a stranger has,
// and the one no fixture could reproduce while the tool had to live in the tree
// it acted on.
//
// Expected values are derived by hand from the fixture, never captured from
// an earlier run of this tool.

import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const SRC = join(HERE, 'ledger.mjs')
const ROOT = mkdtempSync(join(tmpdir(), 'ledger-test-'))

let pass = 0
const failures = []
const check = (name, cond, detail = '') => {
	if (cond) pass++
	else failures.push(`${name}${detail ? ` — ${detail}` : ''}`)
}

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex')

const SKILL_MD = `---
name: tidy-notes
description: Rename files in a notes directory to a consistent date-prefixed form. Use when notes filenames have drifted apart.
disable-model-invocation: true
---

# Tidy notes

### 00 · Scan → files
Look at what is there.
> **Gate:** every file listed.

### 01 · Rename → disk
Do the rename.
> **Gate:** every file matches the new pattern.
`

/** A fake repo: `repo/scripts/ledger.mjs` (real, copied) and `repo/skills/<name>/…`. */
function mkRepo(label, skills = {}) {
	const repo = join(ROOT, label)
	mkdirSync(join(repo, 'scripts'), { recursive: true })
	cpSync(SRC, join(repo, 'scripts', 'ledger.mjs'))
	for (const [name, files] of Object.entries(skills)) {
		const dir = join(repo, 'skills', name)
		for (const [rel, body] of Object.entries(files)) {
			mkdirSync(dirname(join(dir, rel)), { recursive: true })
			writeFileSync(join(dir, rel), body)
		}
	}
	return repo
}

// SK-97: the tool no longer lives inside the library it acts on, so the fixture
// no longer needs a copy of the script at a shipping depth — it needs to be
// named. This runs the real ledger.mjs, from here, against the fixture library.
function run(repo, args) {
	const r = spawnSync(process.execPath, [SRC, ...args, '--library', repo, '--json'], { encoding: 'utf8' })
	let json = null
	try { json = JSON.parse(r.stdout) } catch { /* asserted by caller */ }
	return { code: r.status, json, raw: r.stdout + r.stderr }
}

const readLedger = (repo, name) => JSON.parse(readFileSync(join(repo, 'ledger', `${name}.json`), 'utf8'))

// ── contract: derived from frontmatter and the stage pattern every house-style spine uses ──
{
	const repo = mkRepo('contract', { 'tidy-notes': { 'SKILL.md': SKILL_MD } })
	run(repo, ['--backfill'])
	const entry = readLedger(repo, 'tidy-notes')
	check('contract: modelInvocable false when disable-model-invocation is set', entry.contract.modelInvocable === false, JSON.stringify(entry.contract))
	check(
		'contract: descBytes matches the frontmatter description, hand-counted',
		entry.contract.descBytes === Buffer.byteLength('Rename files in a notes directory to a consistent date-prefixed form. Use when notes filenames have drifted apart.', 'utf8'),
		String(entry.contract.descBytes)
	)
	check('contract: stages counts the two ### NN · Title headings', entry.contract.stages === 2, String(entry.contract.stages))
	check('contract: gated true when every stage has a > **Gate:** line', entry.contract.gated === true, String(entry.contract.gated))
	check('contract: tests null when there is no scripts/ directory', entry.contract.tests === null, JSON.stringify(entry.contract.tests))
}
{
	const modelInvocableMd = SKILL_MD.replace('disable-model-invocation: true\n', '')
	const repo = mkRepo('model-invocable', { 'tidy-notes': { 'SKILL.md': modelInvocableMd } })
	run(repo, ['--backfill'])
	const entry = readLedger(repo, 'tidy-notes')
	check('contract: modelInvocable true when the key is absent', entry.contract.modelInvocable === true, JSON.stringify(entry.contract))
}
{
	const noGateMd = SKILL_MD.replace('> **Gate:** every file matches the new pattern.\n', '')
	const repo = mkRepo('ungated', { 'tidy-notes': { 'SKILL.md': noGateMd } })
	run(repo, ['--backfill'])
	const entry = readLedger(repo, 'tidy-notes')
	check('contract: gated false when one stage has no gate', entry.contract.gated === false, JSON.stringify(entry.contract))
}
{
	const noStagesMd = `---
name: tidy-notes
description: Rename files in a notes directory to a consistent date-prefixed form. Use when notes filenames have drifted apart.
---

# Tidy notes

Prose only, no stage headings.
`
	const repo = mkRepo('no-stages', { 'tidy-notes': { 'SKILL.md': noStagesMd } })
	run(repo, ['--backfill'])
	const entry = readLedger(repo, 'tidy-notes')
	check('contract: gated null when there are no stages to gate', entry.contract.gated === null, JSON.stringify(entry.contract))
}
{
	const repo = mkRepo('tested', {
		'tidy-notes': {
			'SKILL.md': SKILL_MD,
			'scripts/go.mjs': 'console.log(1)\n',
			'scripts/go.test.mjs': 'process.exit(0)\n',
			'scripts/self-test.mjs': 'process.exit(0)\n'
		}
	})
	run(repo, ['--backfill'])
	const entry = readLedger(repo, 'tidy-notes')
	check('contract: tests counts *.test.mjs files', entry.contract.tests.files === 1, JSON.stringify(entry.contract.tests))
	check('contract: tests records self-test.mjs presence', entry.contract.tests.hasSelfTest === true, JSON.stringify(entry.contract.tests))
}

// ── origin: authored vs acquired, ORIGIN.md preferred over AUDIT.md's older fields ──
{
	const repo = mkRepo('authored', { 'tidy-notes': { 'SKILL.md': SKILL_MD } })
	run(repo, ['--backfill'])
	const entry = readLedger(repo, 'tidy-notes')
	check('origin: authored when neither record exists', entry.origin.kind === 'authored', JSON.stringify(entry.origin))
	check('origin: source/commit/date null for an authored skill', entry.origin.source === null && entry.origin.commit === null && entry.origin.date === null, JSON.stringify(entry.origin))
	check('origin: upstreamHead always null — never checked, never guessed', entry.origin.upstreamHead === null, JSON.stringify(entry.origin))
}
{
	const originMd = `# Origin · \`tidy-notes\`

| | |
|---|---|
| **Source** | https://example.com/x/y |
| **Resolved commit** | \`a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0\` |
| **Fetched** | 2026-08-24 |
`
	const auditMd = `# Audit

| | |
|---|---|
| **Verdict** | ADOPT |
| **Audited** | 2026-08-24 |

## Findings

None.
`
	const repo = mkRepo('acquired-with-origin', {
		'tidy-notes': { 'SKILL.md': SKILL_MD, 'ORIGIN.md': originMd, 'AUDIT.md': auditMd }
	})
	run(repo, ['--backfill'])
	const entry = readLedger(repo, 'tidy-notes')
	check('origin: acquired when AUDIT.md exists', entry.origin.kind === 'acquired', JSON.stringify(entry.origin))
	check('origin: source read from ORIGIN.md', entry.origin.source === 'https://example.com/x/y', JSON.stringify(entry.origin))
	check('origin: commit read from ORIGIN.md\'s Resolved commit row', entry.origin.commit === 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0', JSON.stringify(entry.origin))
	check('origin: date read from ORIGIN.md\'s Fetched row', entry.origin.date === '2026-08-24', JSON.stringify(entry.origin))
}
{
	// The pre-skill-intake shape: no ORIGIN.md, the same facts folded into
	// AUDIT.md's own table under different row labels.
	const oldAuditMd = `# Audit

| | |
|---|---|
| **Verdict** | **ADOPT** — no findings |
| **Source** | \`https://github.com/example/skills\` → \`skills/tidy-notes/\` |
| **Upstream commit** | \`deadbeefcafe0000000000000000000000000000\` |
| **Retrieved** | 2026-08-05, \`git clone --depth 1\` |
`
	const repo = mkRepo('acquired-old-format', { 'tidy-notes': { 'SKILL.md': SKILL_MD, 'AUDIT.md': oldAuditMd } })
	run(repo, ['--backfill'])
	const entry = readLedger(repo, 'tidy-notes')
	check('origin: falls back to AUDIT.md when no ORIGIN.md exists', entry.origin.kind === 'acquired', JSON.stringify(entry.origin))
	check('origin: source read from AUDIT.md\'s Source row', entry.origin.source === 'https://github.com/example/skills', JSON.stringify(entry.origin))
	check('origin: commit read from AUDIT.md\'s Upstream commit row', entry.origin.commit === 'deadbeefcafe0000000000000000000000000000', JSON.stringify(entry.origin))
	check('origin: date read from AUDIT.md\'s Retrieved row', entry.origin.date === '2026-08-05', JSON.stringify(entry.origin))
}
{
	// The real animate/AUDIT.md shape: a commit mentioned only in a sentence,
	// never in a table row. Never mined out of prose — stays null.
	const proseCommitMd = `# Audit

| | |
|---|---|
| **Verdict** | ADOPT |
| **Source** | \`https://github.com/example/skills\` |
| **Retrieved** | 2026-08-05, \`git clone --depth 1\` |

Pinned to \`deadbee\`. The repository was committed to on this date.
`
	const repo = mkRepo('acquired-no-commit', { 'tidy-notes': { 'SKILL.md': SKILL_MD, 'AUDIT.md': proseCommitMd } })
	run(repo, ['--backfill'])
	const entry = readLedger(repo, 'tidy-notes')
	check('origin: commit stays null rather than mined from prose', entry.origin.commit === null, JSON.stringify(entry.origin))
}

// ── audit: verdict, counts and dispositioned, only where a table exists ──
{
	const auditMd = `# Audit

| | |
|---|---|
| **Verdict** | **ADOPT** — one note dispositioned |

## Findings

| # | Code | Location | Disposition | Reason |
|---|---|---|---|---|
| 1 | \`STRUCT-DEADREF\` | \`SKILL.md:4\` | Accepted | benign |
| 2 | \`EXEC-EVAL\` | \`scripts/go.mjs:1\` | Fixed | removed |
`
	const repo = mkRepo('audited', { 'tidy-notes': { 'SKILL.md': SKILL_MD, 'AUDIT.md': auditMd } })
	run(repo, ['--backfill'])
	const entry = readLedger(repo, 'tidy-notes')
	check('audit: verdict tolerant of the house bolded-with-qualifier format', entry.audit.verdict === 'ADOPT', JSON.stringify(entry.audit))
	check('audit: counts.findings matches the table\'s row count', entry.audit.counts.findings === 2, JSON.stringify(entry.audit))
	check('audit: dispositioned true when every row has one', entry.audit.dispositioned === true, JSON.stringify(entry.audit))
	check('audit: reportPath points at this skill\'s AUDIT.md', entry.audit.reportPath === 'skills/tidy-notes/AUDIT.md', JSON.stringify(entry.audit))
}
{
	const undecidedMd = `# Audit

| | |
|---|---|
| **Verdict** | ADOPT |

## Findings

| # | Code | Location | Disposition | Reason |
|---|---|---|---|---|
| 1 | \`STRUCT-DEADREF\` | \`SKILL.md:4\` |  | not looked at |
`
	const repo = mkRepo('undecided', { 'tidy-notes': { 'SKILL.md': SKILL_MD, 'AUDIT.md': undecidedMd } })
	run(repo, ['--backfill'])
	const entry = readLedger(repo, 'tidy-notes')
	check('audit: dispositioned false when a finding has no disposition', entry.audit.dispositioned === false, JSON.stringify(entry.audit))
}
{
	// apple-design's real shape: a verdict and prose, no findings table at all.
	const noTableMd = `# Audit

| | |
|---|---|
| **Verdict** | **ADOPT** — no findings on the authentic artefact |
`
	const repo = mkRepo('no-findings-table', { 'tidy-notes': { 'SKILL.md': SKILL_MD, 'AUDIT.md': noTableMd } })
	run(repo, ['--backfill'])
	const entry = readLedger(repo, 'tidy-notes')
	check('audit: counts null when there is no parseable findings table', entry.audit.counts === null, JSON.stringify(entry.audit))
	check('audit: dispositioned null alongside a null counts, not false', entry.audit.dispositioned === null, JSON.stringify(entry.audit))
	check('audit: verdict still reads even with no table', entry.audit.verdict === 'ADOPT', JSON.stringify(entry.audit))
}

// ── integrity: file count and sha256, symlinks skipped ──
{
	const repo = mkRepo('integrity', { 'tidy-notes': { 'SKILL.md': SKILL_MD, 'references/depth.md': 'more detail\n' } })
	symlinkSync('./nowhere', join(repo, 'skills', 'tidy-notes', 'dangling.md'))
	run(repo, ['--backfill'])
	const entry = readLedger(repo, 'tidy-notes')
	check('integrity: fileCount excludes the symlink', entry.integrity.fileCount === 2, JSON.stringify(entry.integrity))
	check('integrity: SKILL.md hash matches an independent sha256', entry.integrity.files['SKILL.md'] === sha256(Buffer.from(SKILL_MD)), entry.integrity.files['SKILL.md'])
	check('integrity: nested file hashed under its relative path', entry.integrity.files['references/depth.md'] === sha256(Buffer.from('more detail\n')), JSON.stringify(entry.integrity.files))
	check('integrity: the symlink itself is not a key', !('dangling.md' in entry.integrity.files), JSON.stringify(entry.integrity.files))
}

// ── --check: catches a hand edit, a missing ledger, an orphaned one ──
{
	const repo = mkRepo('check-clean', { 'tidy-notes': { 'SKILL.md': SKILL_MD } })
	run(repo, ['--backfill'])
	const r = run(repo, ['--check'])
	check('check: a freshly backfilled ledger has zero mismatches', r.json?.errors?.length === 0, JSON.stringify(r.json))
	check('check: exits 0 when clean', r.code === 0, `exit ${r.code}`)
}
{
	const repo = mkRepo('check-missing', { 'tidy-notes': { 'SKILL.md': SKILL_MD } })
	const r = run(repo, ['--check'])
	check('check: a held skill with no ledger entry is refused', r.json?.errors?.some((e) => e.includes('no ledger/tidy-notes.json')), JSON.stringify(r.json))
	check('check: exits non-zero', r.code === 1, `exit ${r.code}`)
}
{
	const repo = mkRepo('check-handedit', { 'tidy-notes': { 'SKILL.md': SKILL_MD } })
	run(repo, ['--backfill'])
	const path = join(repo, 'ledger', 'tidy-notes.json')
	const edited = JSON.parse(readFileSync(path, 'utf8'))
	edited.contract.descBytes = 999999
	writeFileSync(path, JSON.stringify(edited, null, 2))
	const r = run(repo, ['--check'])
	check('check: a hand-edited contract field is caught', r.json?.errors?.some((e) => e.includes('tidy-notes: ledger .contract')), JSON.stringify(r.json))
}
{
	const repo = mkRepo('check-orphan', { 'tidy-notes': { 'SKILL.md': SKILL_MD } })
	run(repo, ['--backfill'])
	rmSync(join(repo, 'skills', 'tidy-notes'), { recursive: true })
	const r = run(repo, ['--check'])
	check('check: a ledger entry for a skill no longer held is flagged as orphaned', r.json?.errors?.some((e) => e.includes('orphaned ledger entry')), JSON.stringify(r.json))
}
{
	// usage.json is SK-10's aggregate, not a per-skill entry — must never be
	// mistaken for one, or every real repo's --check fails on it forever.
	const repo = mkRepo('check-usage-exempt', { 'tidy-notes': { 'SKILL.md': SKILL_MD } })
	run(repo, ['--backfill'])
	mkdirSync(join(repo, 'ledger'), { recursive: true })
	writeFileSync(join(repo, 'ledger', 'usage.json'), '{}')
	const r = run(repo, ['--check'])
	check('check: usage.json is not treated as an orphaned per-skill entry', !r.json?.errors?.some((e) => e.includes('usage.json')), JSON.stringify(r.json))
}
{
	// origin.date, upstreamHead, integrity.lastVerified, install and usage are
	// point-in-time or external facts — --check must not regenerate them, or
	// a legitimately-recorded promotion date would read as corruption.
	const repo = mkRepo('check-preserves-pointintime', { 'tidy-notes': { 'SKILL.md': SKILL_MD } })
	run(repo, ['--backfill'])
	const path = join(repo, 'ledger', 'tidy-notes.json')
	const edited = JSON.parse(readFileSync(path, 'utf8'))
	edited.origin.date = '2020-01-01'
	edited.integrity.lastVerified = '2020-01-01'
	edited.usage = { invocations: { d7: 1, d30: 1, d90: 1, all: 1 }, lastInvoked: '2020-01-01' }
	writeFileSync(path, JSON.stringify(edited, null, 2))
	const r = run(repo, ['--check'])
	check('check: a legitimate origin.date is not flagged as a mismatch', r.json?.errors?.length === 0, JSON.stringify(r.json))
}

// ── --backfill: skips what exists, --force rewrites structural, preserves usage ──
{
	const repo = mkRepo('backfill-skip', { 'tidy-notes': { 'SKILL.md': SKILL_MD } })
	run(repo, ['--backfill'])
	const r = run(repo, ['--backfill'])
	check('backfill: a second run skips an existing entry', r.json?.skipped?.includes('tidy-notes'), JSON.stringify(r.json))
	check('backfill: nothing was written the second time', !r.json?.written?.includes('tidy-notes'), JSON.stringify(r.json))
}
{
	const repo = mkRepo('backfill-force', { 'tidy-notes': { 'SKILL.md': SKILL_MD } })
	run(repo, ['--backfill'])
	const path = join(repo, 'ledger', 'tidy-notes.json')
	const before = JSON.parse(readFileSync(path, 'utf8'))
	before.usage = { invocations: { d7: 3, d30: 3, d90: 3, all: 3 }, lastInvoked: '2026-08-01' }
	writeFileSync(path, JSON.stringify(before, null, 2))
	writeFileSync(join(repo, 'skills', 'tidy-notes', 'extra.md'), 'new file\n')

	const r = run(repo, ['--backfill', '--force'])
	check('backfill --force: rewrites even though an entry exists', r.json?.written?.includes('tidy-notes'), JSON.stringify(r.json))
	const after = JSON.parse(readFileSync(path, 'utf8'))
	check('backfill --force: integrity reflects the new file', 'extra.md' in after.integrity.files, JSON.stringify(after.integrity))
	check('backfill --force: usage is preserved, not reset to null', after.usage?.invocations?.all === 3, JSON.stringify(after.usage))
}

console.log(`\n${pass} passed, ${failures.length} failed`)
for (const f of failures) console.log(`  FAIL  ${f}`)
process.exit(failures.length ? 1 : 0)
