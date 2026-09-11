# dev.sh — the development loop, in one place.
#
#   source dev.sh                      sandbox: a throwaway library, a sandbox HOME
#   source dev.sh --library <dir>      real: that library and your real HOME — every
#                                      write is a real write; git is the undo
#   source dev.sh --clone <dir>        a disposable git clone of <dir>, sandbox HOME:
#                                      real data, nothing at stake
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
#   qrntn-real       the same, always against your real HOME
#   qrntn-lib-reset  the library back to its starting state, in one word —
#                    rebuilt from nothing in sandbox mode, re-cloned in clone
#                    mode, refused in real mode
#   qrntn-env        what is currently set, and against what
#   qrntn-off        put the shell back
#
# THREE MODES, NAMED, NEVER INFERRED. The library this tool acts on is the one
# thing it must never guess at — SURFACE.md decided that for every verb, and
# the loop that drives them is held to the same rule. Sandbox is the default
# because it is the only mode in which nothing you own can be touched. Real is
# for using the tool on your library, which is the thing it is for; the
# mutating verbs — intake, adopt, promote — do there exactly what they say.
# Nothing installs: qrntn records and checks, and never writes to where your
# agent loads from; promote ends by telling you that step is yours. Clone is
# for exercising those verbs on your real data with none of it being real.
#
# HOME IS NOT EXPORTED, and that is deliberate. The smoke gate points HOME at an
# empty directory because promote.test.mjs once passed twice on a borrowed
# ~/.claude/skills/skill-audit that happened to be installed on the machine, and
# only failed when that install disappeared mid-session. The same protection is
# wanted here — but exporting HOME into an interactive shell breaks git, npm,
# ssh and everything else that reads it. So it is overridden per invocation, by
# a shim, and nowhere else. In real mode the shim does not override it at all:
# `usage` reads transcripts from HOME and `ledger --check --install` compares
# against HOME's ~/.claude/skills, and a sandbox HOME there would make the first
# count nothing and the second report every held skill as not installed.
#
# A SHIM SCRIPT THAT EXECS, NOT A SHELL FUNCTION. The first version of this was
# a function, and it broke the one verb that does not exit: `qrntn view &`
# followed by `kill -INT $!` did nothing, and the server outlived the script.
# A backgrounded function runs in a forked shell, `$!` names that fork, and a
# background job in a non-interactive shell ignores SIGINT — so the signal
# stopped one process short of the dispatcher. Ctrl-C at a prompt hides this,
# because it hits the whole foreground group. The shim execs, so its PID is
# the dispatcher's and a signal to `$!` reaches what it names.

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
QRNTN_DEV_BIN="$QRNTN_DEV_ROOT/bin"

mkdir -p "$QRNTN_DEV_ROOT" "$QRNTN_DEV_HOME" "$QRNTN_DEV_BIN"

# ── which mode ──────────────────────────────────────────────────────────────
#
# Read from the arguments to `source`, which both shells pass through. No
# `shift`: in a sourced file that would move the CALLER's positional
# parameters. A SKILL_LIBRARY already in the environment counts as `--library`
# on a first source — that is how a shell rc points the loop at a library —
# but not on a re-source, where it is only what the last mode left behind.

_qrntn_mode=''
_qrntn_lib_arg=''
_qrntn_next=''
for _qrntn_a in "$@"; do
	if [ -n "$_qrntn_next" ]; then
		_qrntn_lib_arg="$_qrntn_a"
		_qrntn_next=''
		continue
	fi
	case "$_qrntn_a" in
		--library) _qrntn_mode=real; _qrntn_next=1 ;;
		--clone) _qrntn_mode=clone; _qrntn_next=1 ;;
		--sandbox) _qrntn_mode=sandbox ;;
		*) echo "dev.sh: ignoring \`$_qrntn_a\` — takes --library <dir>, --clone <dir>, or nothing" >&2 ;;
	esac
done
if [ -n "$_qrntn_next" ]; then
	echo "refused: $_qrntn_mode needs a directory" >&2
	return 2
fi
if [ -z "$_qrntn_mode" ]; then
	if [ -z "${QRNTN_DEV_MODE:-}" ] && [ -n "${SKILL_LIBRARY:-}" ]; then
		_qrntn_mode=real
		_qrntn_lib_arg="$SKILL_LIBRARY"
	else
		_qrntn_mode=sandbox
	fi
fi

case "$_qrntn_mode" in
	sandbox)
		export SKILL_LIBRARY="$QRNTN_DEV_ROOT/lib"
		QRNTN_LIB_ORIGIN=''
		;;
	real)
		_qrntn_abs="$(cd "$_qrntn_lib_arg" 2>/dev/null && pwd)" || {
			echo "refused: --library $_qrntn_lib_arg is not a directory" >&2
			unset _qrntn_abs
			return 2
		}
		_qrntn_lib_arg="$_qrntn_abs"; unset _qrntn_abs
		if [ ! -d "$_qrntn_lib_arg/skills" ]; then
			echo "refused: no skills/ directory in $_qrntn_lib_arg — qrntn acts on a library whose skills live in skills/" >&2
			return 2
		fi
		export SKILL_LIBRARY="$_qrntn_lib_arg"
		QRNTN_LIB_ORIGIN=''
		;;
	clone)
		_qrntn_abs="$(cd "$_qrntn_lib_arg" 2>/dev/null && pwd)" || {
			echo "refused: --clone $_qrntn_lib_arg is not a directory" >&2
			unset _qrntn_abs
			return 2
		}
		_qrntn_lib_arg="$_qrntn_abs"; unset _qrntn_abs
		if [ ! -d "$_qrntn_lib_arg/.git" ]; then
			echo "refused: --clone $_qrntn_lib_arg is not a git repository — a clone is the only copy this makes, so the source has to be one" >&2
			return 2
		fi
		QRNTN_LIB_ORIGIN="$_qrntn_lib_arg"
		export SKILL_LIBRARY="$QRNTN_DEV_ROOT/clone"
		;;
esac
QRNTN_DEV_MODE="$_qrntn_mode"
unset _qrntn_mode _qrntn_lib_arg _qrntn_next _qrntn_a

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

# The shims. Rewritten on every source, because the mode decides what `qrntn`
# does with HOME and the mode may have changed; they are two lines each and
# the cost of rewriting is nothing.
if [ "$QRNTN_DEV_MODE" = real ]; then
	cat > "$QRNTN_DEV_BIN/qrntn" <<SHIM
#!/bin/sh
exec "$QRNTN_DEV_APP/node_modules/.bin/qrntn" "\$@"
SHIM
else
	cat > "$QRNTN_DEV_BIN/qrntn" <<SHIM
#!/bin/sh
HOME="$QRNTN_DEV_HOME" exec "$QRNTN_DEV_APP/node_modules/.bin/qrntn" "\$@"
SHIM
fi
cat > "$QRNTN_DEV_BIN/qrntn-real" <<SHIM
#!/bin/sh
exec "$QRNTN_DEV_APP/node_modules/.bin/qrntn" "\$@"
SHIM
chmod +x "$QRNTN_DEV_BIN/qrntn" "$QRNTN_DEV_BIN/qrntn-real"

case ":$PATH:" in
	*":$QRNTN_DEV_BIN:"*) ;;
	*) PATH="$QRNTN_DEV_BIN:$PATH"; export PATH ;;
esac
# zsh caches command lookups; a shim that did not exist a moment ago is not
# found until the cache is told. bash does not need this and does not mind it.
hash -r 2>/dev/null

# ── the library ─────────────────────────────────────────────────────────────
#
# Rebuilt rather than repaired. Half these verbs mutate the library on purpose
# — promote moves a directory, adopt ends a quarantine — so the useful thing is
# not a library you keep clean but one you can throw away mid-experiment.
#
# `init` needs skills/ to already exist: it makes a folder of skills into a
# library, and cannot make one out of nothing. That is why the skill is written
# before init runs, and not a step that can be dropped.

qrntn-lib-reset() {
	# ONLY EVER INSIDE THE SANDBOX. The first thing this does is delete the
	# library, and in real mode that is yours. A real library is git-tracked
	# and would come back, minus whatever was not yet committed; the rule is
	# cheaper than the recovery. The mode is checked, and then the path is
	# checked anyway, because a mode is a variable and a path is a fact.
	if [ "$QRNTN_DEV_MODE" = real ]; then
		echo "refused: the library is real ($SKILL_LIBRARY) — nothing here resets it; \`git -C \"$SKILL_LIBRARY\" status\` is where to look" >&2
		return 2
	fi
	case "$SKILL_LIBRARY" in
		"$QRNTN_DEV_ROOT"/*) ;;
		*)
			echo "refused: SKILL_LIBRARY is $SKILL_LIBRARY, outside $QRNTN_DEV_ROOT — this deletes it, and only sandbox libraries are deleted here" >&2
			return 2
			;;
	esac
	rm -rf "$SKILL_LIBRARY"
	if [ "$QRNTN_DEV_MODE" = clone ]; then
		# The committed state of the source, which is the state a clone has
		# always meant. Uncommitted work in the source is not carried over,
		# and that is the point: it is not this copy's to have.
		git clone --quiet "$QRNTN_LIB_ORIGIN" "$SKILL_LIBRARY" \
			|| { echo "qrntn-lib-reset: clone failed" >&2; return 1; }
		echo "library $SKILL_LIBRARY — cloned from $QRNTN_LIB_ORIGIN at $(git -C "$SKILL_LIBRARY" log -1 --format=%h), $(ls "$SKILL_LIBRARY/skills" | wc -l | tr -d ' ') skill(s)"
		return 0
	fi
	local names=("$@")
	[ ${#names[@]} -eq 0 ] && names=(hello)
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
	( cd "$SKILL_LIBRARY" && "$QRNTN_DEV_BIN/qrntn" init >/dev/null ) \
		|| { echo "qrntn-lib-reset: init failed" >&2; return 1; }
	echo "library $SKILL_LIBRARY — ${#names[@]} skill(s), catalog and ledger written"
}

# The library exists before the prompt comes back: built or cloned on a first
# source, left alone on a re-source so an experiment in progress survives
# switching modes and back.
if [ "$QRNTN_DEV_MODE" != real ] && [ ! -d "$SKILL_LIBRARY/skills" ]; then
	qrntn-lib-reset >/dev/null
fi

# ── saying where you are ────────────────────────────────────────────────────

qrntn-env() {
	echo "  mode     $QRNTN_DEV_MODE"
	echo "  repo     $QRNTN_REPO"
	case "$QRNTN_DEV_MODE" in
		real)  echo "  library  $SKILL_LIBRARY   (REAL — every write is a real write; git is the undo)" ;;
		clone) echo "  library  $SKILL_LIBRARY   (a clone of $QRNTN_LIB_ORIGIN — nothing at stake)" ;;
		*)     echo "  library  $SKILL_LIBRARY   (throwaway)" ;;
	esac
	if [ "$QRNTN_DEV_MODE" = real ]; then
		echo "  home     your real HOME   (usage reads your transcripts; ledger --check --install compares against ~/.claude/skills)"
	else
		echo "  home     $QRNTN_DEV_HOME   (per invocation only; \`qrntn-real\` uses your real HOME)"
	fi
	echo "  binary   $QRNTN_DEV_APP/node_modules/.bin/qrntn"
	echo
	echo "  qrntn <verb>       live against the checkout; --library is optional, SKILL_LIBRARY is set"
	echo "  qrntn-real <verb>  the same, always your real HOME"
	echo "  qrntn-lib-reset    the library back to its starting state"
	echo "  qrntn-relink       rebuild the symlinked install"
	echo "  qrntn-off          put the shell back"
}

qrntn-off() {
	PATH="${PATH//$QRNTN_DEV_BIN:/}"
	export PATH
	hash -r 2>/dev/null
	unset SKILL_LIBRARY QRNTN_DEV_MODE QRNTN_LIB_ORIGIN
	unset -f qrntn-lib-reset qrntn-relink qrntn-env qrntn-off 2>/dev/null
	echo "dev.sh: off — PATH restored, SKILL_LIBRARY unset"
}

case "$QRNTN_DEV_MODE" in
	real)  echo "dev.sh: REAL — $SKILL_LIBRARY, your HOME · every write is a real write · \`qrntn-env\` for the rest" ;;
	clone) echo "dev.sh: clone of $QRNTN_LIB_ORIGIN · sandbox HOME · \`qrntn-lib-reset\` re-clones · \`qrntn-env\` for the rest" ;;
	*)     echo "dev.sh: sandbox · \`qrntn-env\` for what is set · \`qrntn --help\` for the tool" ;;
esac
