# dev.sh — the development loop, in one place.
#
#   source dev.sh
#
# SOURCED, NEVER EXECUTED. The whole point is the environment it leaves behind
# in the shell you are standing in, and a subprocess cannot do that: `./dev.sh`
# would set three variables, exit, and leave you exactly where you started.
# That is checked below rather than left as a comment nobody reads.
#
# What it gives you:
#
#   qrntn            the real binary, run from a symlinked install, so edits to
#                    commands/*.mjs are live and nothing is ever re-packed
#   qrntn-lib-reset  a throwaway library, rebuilt from nothing in one word
#   qrntn-env        what is currently set, and against what
#   qrntn-off        put the shell back
#
# HOME IS NOT EXPORTED, and that is deliberate. The smoke gate points HOME at an
# empty directory because promote.test.mjs once passed twice on a borrowed
# ~/.claude/skills/skill-audit that happened to be installed on the machine, and
# only failed when that install disappeared mid-session. The same protection is
# wanted here — but exporting HOME into an interactive shell breaks git, npm,
# ssh and everything else that reads it. So it is overridden per invocation, by
# the wrapper function, and nowhere else. `command qrntn` bypasses the wrapper
# and runs against your real HOME, which is how you test the install path.

# ── sourced? ────────────────────────────────────────────────────────────────

# bash sets BASH_SOURCE; zsh sets ZSH_EVAL_CONTEXT, whose last element is
# `file` when a file is being sourced and `toplevel` when one is being run.
# Both are checked because both shells are in use here.
if [ -n "${BASH_SOURCE[0]:-}" ] && [ "${BASH_SOURCE[0]}" = "$0" ]; then
	echo "refused: dev.sh must be sourced, not executed — \`source dev.sh\`" >&2
	exit 2
fi
case "${ZSH_EVAL_CONTEXT:-}" in
	*:file) ;;
	toplevel*)
		echo "refused: dev.sh must be sourced, not executed — \`source dev.sh\`" >&2
		exit 2
		;;
esac

# ── where the sandbox lives ─────────────────────────────────────────────────
#
# Outside the repository, always. A dev sandbox inside the working tree is a
# directory that has to be gitignored, that npm pack has to be told to skip,
# and that another session working in this tree can trip over. None of that is
# worth the shorter path.

QRNTN_REPO="${QRNTN_REPO:-$(cd "$(dirname "${BASH_SOURCE[0]:-${(%):-%x}}")" && pwd)}"
QRNTN_DEV_ROOT="${QRNTN_DEV_ROOT:-${TMPDIR:-/tmp}/qrntn-dev}"
QRNTN_DEV_APP="$QRNTN_DEV_ROOT/app"
QRNTN_DEV_HOME="$QRNTN_DEV_ROOT/home"
export SKILL_LIBRARY="${SKILL_LIBRARY:-$QRNTN_DEV_ROOT/lib}"

mkdir -p "$QRNTN_DEV_ROOT" "$QRNTN_DEV_HOME"

# ── the linked install ──────────────────────────────────────────────────────
#
# `npm install <path>` symlinks a local directory rather than copying it, so
# the binary in the sandbox IS this checkout and every edit is live. That is
# the entire reason this is not `npm pack` in a loop.
#
# What it therefore cannot see: the `files` allowlist. A file missing from it
# works perfectly here and is absent for everyone who installs. `npm run smoke`
# is the only thing that catches that, and it is in the table in
# docs/DEVELOPING.md for exactly that reason.

qrntn-relink() {
	rm -rf "$QRNTN_DEV_APP"
	mkdir -p "$QRNTN_DEV_APP"
	( cd "$QRNTN_DEV_APP" \
		&& npm init -y >/dev/null 2>&1 \
		&& npm install --no-audit --no-fund --silent "$QRNTN_REPO" >/dev/null 2>&1 ) \
		|| { echo "qrntn-relink: npm install failed" >&2; return 1; }
	echo "linked  $QRNTN_DEV_APP/node_modules/qrntn -> $QRNTN_REPO"
}

[ -x "$QRNTN_DEV_APP/node_modules/.bin/qrntn" ] || qrntn-relink

case ":$PATH:" in
	*":$QRNTN_DEV_APP/node_modules/.bin:"*) ;;
	*) PATH="$QRNTN_DEV_APP/node_modules/.bin:$PATH"; export PATH ;;
esac

# The wrapper, and the only place HOME is touched. `command qrntn` skips it.
qrntn() { HOME="$QRNTN_DEV_HOME" command qrntn "$@"; }

# ── the throwaway library ───────────────────────────────────────────────────
#
# Rebuilt rather than repaired. Half these verbs mutate the library on purpose
# — promote moves a directory, adopt ends a quarantine — so the useful thing is
# not a library you keep clean but one you can throw away mid-experiment.
#
# `init` needs skills/ to already exist: it makes a folder of skills into a
# library, and cannot make one out of nothing. That is why the skill is written
# before init runs, and not a step that can be dropped.

qrntn-lib-reset() {
	local names=("$@")
	[ ${#names[@]} -eq 0 ] && names=(hello)
	rm -rf "$SKILL_LIBRARY"
	local n
	for n in "${names[@]}"; do
		mkdir -p "$SKILL_LIBRARY/skills/$n"
		cat > "$SKILL_LIBRARY/skills/$n/SKILL.md" <<SKILLMD
---
name: $n
description: A throwaway skill for the development loop, named $n.
---

# $n

Placeholder. Nothing here is a real skill.
SKILLMD
	done
	( cd "$SKILL_LIBRARY" && HOME="$QRNTN_DEV_HOME" command qrntn init >/dev/null ) \
		|| { echo "qrntn-lib-reset: init failed" >&2; return 1; }
	echo "library $SKILL_LIBRARY — ${#names[@]} skill(s), catalog and ledger written"
}

[ -d "$SKILL_LIBRARY/skills" ] || qrntn-lib-reset >/dev/null

# ── saying where you are ────────────────────────────────────────────────────

qrntn-env() {
	echo "  repo     $QRNTN_REPO"
	echo "  library  $SKILL_LIBRARY   (SKILL_LIBRARY — every verb reads it, so --library is optional)"
	echo "  home     $QRNTN_DEV_HOME   (per invocation only; \`command qrntn\` uses your real HOME)"
	# The path on disk, not the wrapper function's name, which is what
	# `command -v` answers once the wrapper is defined and is no help at all.
	echo "  binary   $QRNTN_DEV_APP/node_modules/.bin/qrntn"
	echo
	echo "  qrntn <verb>       live against the checkout"
	echo "  qrntn-lib-reset    throw the library away and build a new one"
	echo "  qrntn-relink       rebuild the symlinked install"
	echo "  qrntn-off          put the shell back"
}

qrntn-off() {
	PATH="${PATH//$QRNTN_DEV_APP\/node_modules\/.bin:/}"
	export PATH
	unset SKILL_LIBRARY
	unset -f qrntn qrntn-lib-reset qrntn-relink qrntn-env qrntn-off 2>/dev/null
	echo "dev.sh: off — PATH restored, SKILL_LIBRARY unset"
}

echo "dev.sh: ready · \`qrntn-env\` for what is set · \`qrntn --help\` for the tool"
