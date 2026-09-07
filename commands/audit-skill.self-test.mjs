#!/usr/bin/env node
// Self-test: does audit-skill.test.mjs actually catch anything?
//
// A test suite that has only ever passed has not been tested. This mutates the
// auditor in specific ways, runs the suite against each mutant, and asserts the
// suite FAILS every time. A mutation that survives names a check nobody is
// really making.
//
// It matters more here than in most places. This tool's failure mode is not a
// crash — it is reporting "no findings" on a skill that has them, which reads
// exactly like good news. A silent auditor is worse than no auditor, because it
// is the one you believe.
//
//   node self-test.mjs

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, 'audit-skill.mjs');
const TEST = join(HERE, 'audit-skill.test.mjs');

// Each mutation is a defect a careless edit could plausibly introduce. `find`
// must appear exactly once in the source, so a silent no-op cannot masquerade
// as a surviving mutation.
//
// `expect: 'survives'` marks an inert control. A harness that can only ever
// report "caught" proves nothing about itself, so at least one entry here must
// be a change that genuinely alters nothing.
const MUTATIONS = [
  {
    name: 'invisible-character class emptied',
    find: 'const INVISIBLE_RE = /[\\u200B-\\u200F\\u2060-\\u2064\\uFEFF\\u00AD\\u180E\\u2028\\u2029]/g;',
    replace: 'const INVISIBLE_RE = /(?!)/g;'
  },
  {
    name: 'bidi-character class emptied',
    find: 'const BIDI_RE = /[\\u202A-\\u202E\\u2066-\\u2069]/g;',
    replace: 'const BIDI_RE = /(?!)/g;'
  },
  {
    name: 'tag-character (ASCII smuggling) range removed',
    find: "for (const m of text.matchAll(/[\\u{E0000}-\\u{E007F}]/gu)) {",
    replace: 'for (const m of []) {'
  },
  {
    name: 'instruction-override pattern never matches',
    find: 're: /ignore\\s+(?:all\\s+)?(?:the\\s+)?(?:previous|prior|above|earlier|preceding|foregoing)\\s+(?:instructions|prompts?|rules|directions|guidelines)/gi,',
    replace: 're: /(?!)/gi,'
  },
  {
    name: 'concealment finding downgraded from BLOCK to NOTE',
    find: "    code: 'INSTR-CONCEAL',\n    sev: SEV.BLOCK,",
    replace: "    code: 'INSTR-CONCEAL',\n    sev: SEV.NOTE,"
  },
  {
    name: 'base64 never decodes, so encoded payloads stay opaque',
    // Anchored on the decode call, not the printable-ratio return: that line is
    // now shared verbatim with decodeHexRun, so it appears twice.
    find: "    const out = Buffer.from(s, 'base64').toString('utf8');",
    replace: "    const out = '';"
  },
  {
    name: 'fenced blocks no longer recognised (execution patterns go blind in Markdown)',
    find: "  for (const m of text.matchAll(/^```[^\\n]*\\n[\\s\\S]*?^```/gm)) ranges.push([m.index, m.index + m[0].length]);",
    replace: '  // fenced blocks not collected'
  },
  {
    name: 'execution patterns applied to prose as well as code',
    find: '        if (spans && !inRanges(m.index, spans)) continue;',
    replace: '        if (false) continue;'
  },
  {
    name: 'confusables table never resolves (homoglyphs pass)',
    find: '      const looksLike = CONFUSABLES.get(m[0]);',
    replace: '      const looksLike = undefined;'
  },
  {
    name: 'symlinks walked as ordinary files instead of reported',
    find: '        symlinks.push(relative(root, abs));',
    replace: '        // symlink ignored'
  },
  {
    name: 'duplicate frontmatter keys no longer recorded',
    find: '    if (keys.has(key)) duplicates.push(key);',
    replace: '    // duplicates not recorded'
  },
  {
    name: 'wildcard tool grants no longer distinguished from narrow ones',
    find: '        const wild = /\\*|Bash\\s*$|Bash\\s*\\(/.test(v.value);',
    replace: '        const wild = false;'
  },
  {
    name: 'config artefact list emptied',
    // An earlier attempt used `= [].concat([]) && [` and SURVIVED — `[]` is
    // truthy, so the mutation was a no-op and the harness was reporting on a
    // file it had not actually changed. Kept as a note because a mutation that
    // does nothing is indistinguishable from a check that does nothing.
    find: 'const CONFIG_ARTEFACTS = [',
    replace: 'const CONFIG_ARTEFACTS = [];\nconst UNUSED_ARTEFACTS = ['
  },
  {
    name: 'plugin-bundle directories no longer recognised',
    find: "const CONFIG_DIRS = new Set(['.claude-plugin', 'hooks', 'commands']);",
    replace: 'const CONFIG_DIRS = new Set([]);'
  },
  {
    // The discriminator inverted: agents/ beside a SKILL.md would go back to
    // reading as a plugin bundle, which is the false block this rule exists to
    // stop. If nothing catches it, the corpus result was luck.
    name: 'cross-harness agents/ treated as a plugin bundle again',
    find: '    } else if (top === CROSS_HARNESS_DIR) {\n      if (skillFile) {',
    replace: '    } else if (top === CROSS_HARNESS_DIR) {\n      if (false) {'
  },
  {
    // And the other direction: a bundle with no SKILL.md waved through.
    name: 'agents/ without a SKILL.md no longer blocks',
    find: "        add(SEV.BLOCK, 'CONFIG-OUTOFSCOPE', `Lives under ${top}/ with no SKILL.md at the root",
    replace: "        add(SEV.NOTE, 'CONFIG-OUTOFSCOPE', `Lives under ${top}/ with no SKILL.md at the root"
  },
  {
    name: 'spec frontmatter keys emptied (every key reads as unrecognised)',
    find: 'const SPEC_FRONTMATTER_KEYS = new Set([',
    replace: 'const SPEC_FRONTMATTER_KEYS = new Set([]);\nconst UNUSED_SPEC_KEYS = new Set(['
  },
  {
    // Collapsing the harness tier back into "unknown" is precisely the defect
    // the three tiers were introduced to fix, twice over.
    name: 'harness keys collapse back into unknown',
    find: 'const HARNESS_FRONTMATTER_KEYS = new Set([',
    replace: 'const HARNESS_FRONTMATTER_KEYS = new Set([]);\nconst UNUSED_HARNESS_KEYS = new Set(['
  },
  {
    name: 'frontmatter hook registration downgraded below a hooks.json file',
    find: "        if (HOOK_FRONTMATTER_KEYS.has(key)) {\n          add(SEV.BLOCK, 'CONFIG-HOOKFRONTMATTER'",
    replace: "        if (HOOK_FRONTMATTER_KEYS.has(key)) {\n          add(SEV.NOTE, 'CONFIG-HOOKFRONTMATTER'"
  },
  {
    name: 'absolute self-references no longer collected (own scripts read as orphans)',
    find: '    if (selfAbsRe) {',
    replace: '    if (false) {'
  },
  {
    name: 'path collector matches inside slash-chained prose again',
    find: '    for (const m of text.matchAll(/(?<![A-Za-z0-9_-])(?<!\\w\\/)(?:references|scripts|assets|examples)\\/[A-Za-z0-9._/-]+/g)) {',
    replace: '    for (const m of text.matchAll(/(?:references|scripts|assets|examples)\\/[A-Za-z0-9._/-]+/g)) {'
  },
  {
    name: 'trailing punctuation no longer stripped from referenced paths',
    find: "      const path = m[0].replace(/[.,;:!?)\\]}'\"]+$/, '');",
    replace: '      const path = m[0];'
  },
  {
    name: 'description length ceiling removed',
    find: 'const MAX_DESCRIPTION_LENGTH = 1024;',
    replace: 'const MAX_DESCRIPTION_LENGTH = 100000;'
  },
  {
    name: 'orphan grading inverted (unmentioned directories downgraded to a note)',
    find: '    if (mentionedDirs.has(dir)) {',
    replace: '    if (!mentionedDirs.has(dir)) {'
  },
  {
    name: 'CLI guard compares URLs again, going silent through a symlink',
    find: '    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));',
    // Valid JS, and the exact original defect: no realpath resolution, so the
    // guard is false whenever the script is reached through a link. A mutation
    // that merely fails to parse would be "caught" for the wrong reason.
    replace: '    return process.argv[1] === fileURLToPath(import.meta.url);'
  },
  {
    name: 'hex digests treated as base64 again',
    find: "      if (/^[0-9a-fA-F]+$/.test(m[0])) {",
    replace: '      if (false) {'
  },
  {
    name: 'hex runs never decoded, so a hex payload stays opaque',
    find: '  if (s.length % 2 !== 0) return null;',
    replace: '  return null;'
  },
  {
    name: 'bundled-script exemption widened to every home path',
    find: 'const BUNDLED_SCRIPT_RE = /\\.claude\\/skills\\/[A-Za-z0-9._-]+\\/scripts\\//;',
    replace: 'const BUNDLED_SCRIPT_RE = /\\.claude\\/skills\\//;'
  },
  {
    name: 'unfenced-code blind spot no longer reported',
    find: '      if (unfenced >= UNFENCED_CODE_MIN) {',
    replace: '      if (false) {'
  },
  {
    name: 'NUL bytes past the sniff window no longer reported',
    find: '    if (nul !== -1) {',
    replace: '    if (false) {'
  },
  {
    name: 'excluded findings dropped instead of set aside',
    find: '  for (const f of findings) f.excluded = isExcluded(f.file);',
    replace: '  for (const f of findings) f.excluded = false;'
  },
  {
    name: 'exclusion silently suppresses instead of reattributing',
    find: '  for (const f of findings) if (!f.excluded) counts[f.sev]++;',
    replace: '  for (const f of findings) counts[f.sev]++;'
  },
  {
    name: 'dead references attributed to the missing path again',
    find: '      add(SEV.NOTE, \'STRUCT-DEADREF\', `References ${ref}, which does not exist. Either the skill is incomplete, or it was trimmed without updating the spine.`, referrer, null, ref);',
    replace: "      add(SEV.NOTE, 'STRUCT-DEADREF', 'Referenced file does not exist.', ref, null, null);"
  },
  {
    // The record files become ordinary referrers again, which is the state that
    // produced the two apple-design NOTEs and, more seriously, let an
    // attacker-written AUDIT.md vouch a payload file out of STRUCT-ORPHAN.
    name: 'record files treated as ordinary referrers again',
    find: "const RECORD_FILES = new Set(['AUDIT.md', 'ORIGIN.md']);",
    replace: 'const RECORD_FILES = new Set([]);'
  },
  {
    // The other direction. A rule that widens until the spine is a record stops
    // resolving the references the finding exists for, and reports clean.
    name: 'record rule widened to swallow the spine',
    find: "const RECORD_FILES = new Set(['AUDIT.md', 'ORIGIN.md']);",
    replace: "const RECORD_FILES = new Set(['AUDIT.md', 'ORIGIN.md', 'SKILL.md']);"
  },
  {
    // The asymmetry is the security property: a record may accuse, never vouch.
    // Routing its citations into `mentioned` reopens the hole for anyone who
    // writes the path out in full.
    name: 'record citations allowed to vouch (STRUCT-ORPHAN suppressed again)',
    find: '      if (!cited.has(path)) cited.set(path, rel);',
    replace: '      if (!mentioned.has(path)) mentioned.set(path, rel);'
  },
  {
    // And the accusing half: dropping anchored citations turns the base fix into
    // a blanket exemption, which is the outcome that was rejected.
    name: 'anchored citations in a record no longer collected',
    find: '    if (!text || !selfAbsRe) continue;',
    replace: '    if (true) continue;'
  },
  {
    name: 'spine references dropped from the merged reference graph',
    find: '  for (const [ref, referrer] of mentioned) referenced.set(ref, referrer);',
    replace: '  // spine references not merged'
  },
  {
    name: 'exit code always reports success',
    find: '  return { counts, excluded, verdict, exitCode: counts.BLOCK ? 2 : counts.REVIEW ? 1 : 0 };',
    replace: '  return { counts, excluded, verdict, exitCode: 0 };'
  },
  // ── SK-85 · the four published bypasses ────────────────────────────────────
  // Each rule added on 2026-09-06 gets a mutation here. A rule with a fixture
  // but no mutation is a rule whose test nobody has tested: the fixture would
  // keep passing if the rule were quietly weakened, which is precisely the
  // failure mode the literature describes for scanners.
  {
    name: '__pycache__ put back into SKIP_DIRS',
    find: "const SKIP_DIRS = new Set(['.git', 'node_modules', '.venv']);",
    replace: "const SKIP_DIRS = new Set(['.git', 'node_modules', '__pycache__', '.venv']);"
  },
  {
    name: 'archive magic table emptied',
    find: '  for (const [name, magic] of ARCHIVE_MAGIC) {',
    replace: '  for (const [name, magic] of []) {'
  },
  {
    name: 'INSTR-REMOTE demoted from BLOCK',
    find: "    code: 'INSTR-REMOTE',\n    sev: SEV.BLOCK,",
    replace: "    code: 'INSTR-REMOTE',\n    sev: SEV.NOTE,"
  },
  {
    // Restores the exact bug SK-85 fixed: decoded runs matched against the
    // instruction rules only, so a blob decoding to a shell pipeline passed.
    name: 'decoded runs checked against instruction rules only',
    find: 'const hostileIn = (s) => {\n  for (const p of [...INSTRUCTION_PATTERNS, ...EXECUTION_PATTERNS]) {',
    replace: 'const hostileIn = (s) => {\n  for (const p of [...INSTRUCTION_PATTERNS]) {'
  },
  {
    // The folding has two independent halves and needs two mutations. NFKC
    // collapses compatibility forms; the CONFUSABLES table collapses
    // homoglyphs NFKC deliberately leaves alone. With only one fixture, one of
    // these mutations survived — which is how the missing fixture was found.
    name: 'confusable folding removed, NFKC left intact',
    find: '.replace(/[^\\x00-\\x7F]/g, (ch) => CONFUSABLES.get(ch) ?? ch)',
    replace: '.replace(/[^\\x00-\\x7F]/g, (ch) => ch)'
  },
  {
    name: 'Unicode folding made an identity function',
    find: "const foldToAscii = (s) => s.normalize('NFKC')",
    replace: "const foldToAscii = (s) => (s + '').normalize('NFC')"
  },
  {
    name: 'INERT CONTROL — a comment reworded, nothing else',
    find: ' * Exit: 0 clean or NOTE only · 1 at least one REVIEW · 2 at least one BLOCK.',
    replace: ' * Exit codes: 0 for clean, 1 for review, 2 for block.',
    expect: 'survives'
  },
  {
    // A second inert control, sited in the code the five mutations above touch.
    // Without one there, "caught" for those five could just as well mean the
    // record tests fail on any edit to that block at all.
    name: 'INERT CONTROL — a comment in the record-file block reworded',
    find: '  // The record files, separately: only their ANCHORED citations resolve, and',
    replace: '  // Record files, handled apart: only their ANCHORED citations resolve, and',
    expect: 'survives'
  }
].filter((m) => !m.skip);

const original = readFileSync(SRC, 'utf8');
const originalTest = readFileSync(TEST, 'utf8');

// Mutate a COPY in a temp directory; never write to the shipped auditor.
// try/finally survives an exception but not a signal, and one Ctrl-C at the
// wrong moment would leave a silently blind auditor on disk — the exact failure
// this file exists to prevent.
//
// The test resolves the script it exercises from its OWN directory, so copying
// both files into the sandbox is what points it at the mutant.
const dir = mkdtempSync(join(tmpdir(), 'audit-selftest-'));
const sandboxSrc = join(dir, 'audit-skill.mjs');
const sandboxTest = join(dir, 'audit-skill.test.mjs');
writeFileSync(sandboxTest, originalTest);

let unexpected = 0;
let asExpected = 0;

try {
  for (const m of MUTATIONS) {
    const expectSurvival = m.expect === 'survives';
    const occurrences = original.split(m.find).length - 1;
    if (occurrences !== 1) {
      console.error(
        `  ERROR     "${m.name}" — anchor found ${occurrences} times, expected exactly 1.\n` +
          '            The source has drifted; update the mutation before trusting this run.'
      );
      unexpected++;
      continue;
    }

    writeFileSync(sandboxSrc, original.replace(m.find, m.replace));
    const r = spawnSync('node', [sandboxTest], { encoding: 'utf8' });
    const survived = r.status === 0;

    if (survived === expectSurvival) {
      asExpected++;
      const label = expectSurvival ? 'survived  ' : 'caught    ';
      const failed = (r.stdout.match(/(\d+) failed/) ?? [])[1] ?? '0';
      console.log(`  ${label}${m.name}${expectSurvival ? '' : `  (${failed} assertion(s))`}`);
    } else {
      unexpected++;
      console.error(
        expectSurvival
          ? `  BROKE     ${m.name} — an inert change failed the suite, so the suite is testing something it should not.`
          : `  SURVIVED  ${m.name}`
      );
    }
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}

// The sandbox must have been a faithful copy, or every "caught" above could be
// an artefact of the copy rather than of the mutation.
if (readFileSync(SRC, 'utf8') !== original) {
  console.error('  ERROR     the shipped auditor changed during this run — it should never be written.');
  unexpected++;
}

// The suite must also pass on the unmutated source, or "caught" means nothing.
const clean = spawnSync('node', [TEST], { encoding: 'utf8' });
console.log(`\nclean run: ${clean.status === 0 ? 'PASS' : 'FAIL'}`);

console.log(`self-test: ${asExpected} as expected, ${unexpected} not`);
if (unexpected || clean.status !== 0) {
  console.error(
    '\nA surviving mutation means the suite is not checking what it appears to.\n' +
      'Add the assertion that would have caught it.'
  );
  process.exit(1);
}
